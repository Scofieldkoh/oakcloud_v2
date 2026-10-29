'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, FileUp, RefreshCw } from 'lucide-react';

import { BizFileReviewWorkspace } from '@/components/companies/bizfile-review/bizfile-review-workspace';
import { DocumentPageViewer } from '@/components/processing';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { useAssistantTurn } from '@/hooks/use-business-assistant';
import { postFormDataWithFallback } from '@/lib/browser-upload';
import type { BusinessAssistantTurnRequest } from '@/lib/validations/business-assistant';
import type { ExtractedBizFileData } from '@/services/bizfile/types';

export const BIZFILE_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const BIZFILE_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);
const BIZFILE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';

interface BizFileConflict {
  type: 'IN_RECYCLE_BIN' | 'ALREADY_EXISTS';
  companyId: string;
  companyName: string;
  uen: string;
}

interface UploadResponse {
  documentId: string;
  fileName: string;
  fileSize: number;
}

interface ExtractionResponse {
  success: true;
  extractedData: ExtractedBizFileData;
  conflict: BizFileConflict | null;
  aiMetadata?: {
    modelName?: string;
    formattedCost?: string;
  };
}

type UploadPhase =
  | 'upload'
  | 'uploading'
  | 'extracting'
  | 'error'
  | 'active-conflict'
  | 'recycled-conflict'
  | 'review';

interface BizFileUploadDialogProps {
  isOpen: boolean;
  workspaceId: string;
  conversationId?: string | null;
  message?: string;
  onClose: () => void;
  onAccepted: (conversationId: string) => void;
}

interface BuildTurnArgs {
  conversationId?: string | null;
  message?: string;
  documentId: string;
  reviewedData: ExtractedBizFileData;
  targetCompanyId?: string;
}

export function validateBizFileUpload(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (file.size > BIZFILE_MAX_UPLOAD_BYTES) {
    return 'BizFile must be 10 MB or smaller.';
  }
  if (!BIZFILE_ALLOWED_MIME_TYPES.has(file.type)) {
    return 'Only PDF and image files (PNG, JPG, WebP) are allowed.';
  }
  return null;
}

export function buildBizFileAssistantTurnRequest({
  conversationId,
  message,
  documentId,
  reviewedData,
  targetCompanyId,
}: BuildTurnArgs): Omit<BusinessAssistantTurnRequest, 'clientRequestId'> {
  const companyName = reviewedData.entityDetails?.name?.trim() || 'this company';
  const userMessage = message?.trim()
    || (targetCompanyId
      ? `Review and update ${companyName} from this BizFile.`
      : `Review and import ${companyName} from this BizFile.`);

  return {
    ...(conversationId ? { conversationId } : {}),
    message: userMessage,
    resources: [
      { resourceType: 'document', resourceId: documentId, role: 'source' },
      ...(targetCompanyId
        ? [{ resourceType: 'company', resourceId: targetCompanyId, role: 'target' as const }]
        : []),
    ],
    context: {
      route: '/business-assistant',
      capabilityId: 'bizfile.import_and_review',
      capabilityVersion: '1.0',
    },
    capabilityInput: {
      documentId,
      mode: targetCompanyId ? 'UPDATE' : 'CREATE',
      ...(targetCompanyId ? { targetCompanyId } : {}),
      extractedData: reviewedData,
    },
  };
}

async function readResponseError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
  return fallback;
}

export function BizFileUploadDialog({
  isOpen,
  workspaceId,
  conversationId,
  message,
  onClose,
  onAccepted,
}: BizFileUploadDialogProps) {
  const turn = useAssistantTurn(workspaceId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<{ fingerprint: string; clientRequestId: string } | null>(null);
  const submissionStartedRef = useRef(false);
  const [phase, setPhase] = useState<UploadPhase>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedBizFileData | null>(null);
  const [conflict, setConflict] = useState<BizFileConflict | null>(null);
  const [targetCompanyId, setTargetCompanyId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [errorStage, setErrorStage] = useState<'upload' | 'extract' | null>(null);
  const [aiMetadata, setAiMetadata] = useState<ExtractionResponse['aiMetadata']>();

  const busy = phase === 'uploading' || phase === 'extracting' || turn.isPending;

  const revokePreview = useCallback(() => {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }, []);

  const resetLocalState = useCallback(() => {
    revokePreview();
    setPhase('upload');
    setFile(null);
    setDocumentId(null);
    setExtractedData(null);
    setConflict(null);
    setTargetCompanyId(undefined);
    setError(null);
    setSubmissionError(null);
    setErrorStage(null);
    setAiMetadata(undefined);
    requestRef.current = null;
    submissionStartedRef.current = false;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [revokePreview]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const cleanupPendingDocument = useCallback(async (id = documentId) => {
    if (!id || submissionStartedRef.current) return;
    try {
      await fetch(`/api/documents/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    } catch {
      // Pending-document cleanup is best effort. Never make cancellation fail for it.
    }
  }, [documentId]);

  const closeAndCleanup = useCallback(async () => {
    if (busy) return;
    await cleanupPendingDocument();
    resetLocalState();
    onClose();
  }, [busy, cleanupPendingDocument, onClose, resetLocalState]);

  const resetForAnotherFile = useCallback(async () => {
    if (busy) return;
    await cleanupPendingDocument();
    resetLocalState();
  }, [busy, cleanupPendingDocument, resetLocalState]);

  const extractDocument = useCallback(async (id: string) => {
    setPhase('extracting');
    setError(null);
    setErrorStage(null);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(id)}/extract`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(await readResponseError(response, 'BizFile extraction failed.'));
      }
      const result = await response.json() as ExtractionResponse;
      setExtractedData(result.extractedData);
      setConflict(result.conflict);
      setAiMetadata(result.aiMetadata);
      if (result.conflict?.type === 'IN_RECYCLE_BIN') {
        setPhase('recycled-conflict');
        return;
      }
      if (result.conflict?.type === 'ALREADY_EXISTS') {
        setPhase('active-conflict');
        return;
      }
      setTargetCompanyId(undefined);
      setPhase('review');
    } catch (extractionError) {
      setError(extractionError instanceof Error ? extractionError.message : 'BizFile extraction failed.');
      setErrorStage('extract');
      setPhase('error');
    }
  }, []);

  const uploadAndExtract = useCallback(async (nextFile: File) => {
    const validationError = validateBizFileUpload(nextFile);
    if (validationError) {
      setError(validationError);
      setErrorStage('upload');
      setPhase('upload');
      return;
    }

    revokePreview();
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
    setError(null);
    setSubmissionError(null);
    setErrorStage(null);
    setConflict(null);
    setTargetCompanyId(undefined);
    requestRef.current = null;
    submissionStartedRef.current = false;
    setPhase('uploading');

    try {
      const formData = new FormData();
      formData.append('file', nextFile);
      formData.append('documentType', 'BIZFILE');
      formData.append('tenantId', workspaceId);
      const response = await postFormDataWithFallback('/api/documents/upload', formData);
      if (!response.ok) {
        throw new Error(await readResponseError(response, 'BizFile upload failed.'));
      }
      const uploaded = await response.json() as UploadResponse;
      setDocumentId(uploaded.documentId);
      await extractDocument(uploaded.documentId);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'BizFile upload failed.');
      setErrorStage(documentId ? 'extract' : 'upload');
      setPhase(documentId ? 'error' : 'upload');
    }
  }, [documentId, extractDocument, revokePreview, workspaceId]);

  const handleFileInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (nextFile) void uploadAndExtract(nextFile);
  }, [uploadAndExtract]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (busy) return;
    const nextFile = event.dataTransfer.files?.[0];
    if (nextFile) void uploadAndExtract(nextFile);
  }, [busy, uploadAndExtract]);

  const submitReviewedData = useCallback(async (reviewedData: ExtractedBizFileData) => {
    if (!documentId || turn.isPending) return;
    setSubmissionError(null);
    const request = buildBizFileAssistantTurnRequest({
      conversationId,
      message,
      documentId,
      reviewedData,
      targetCompanyId,
    });
    const fingerprint = JSON.stringify(request);
    if (!requestRef.current || requestRef.current.fingerprint !== fingerprint) {
      requestRef.current = { fingerprint, clientRequestId: crypto.randomUUID() };
    }

    // From this point forward the request may already be durable even if the
    // browser later sees a transport error. Preserve the source as evidence.
    submissionStartedRef.current = true;
    try {
      const accepted = await turn.mutateAsync({
        ...request,
        clientRequestId: requestRef.current.clientRequestId,
      });
      onAccepted(accepted.conversationId);
      resetLocalState();
      onClose();
    } catch (acceptanceError) {
      const messageText = acceptanceError instanceof Error
        ? acceptanceError.message
        : 'Olaf could not prepare this BizFile proposal.';
      setSubmissionError(messageText);
      throw acceptanceError;
    }
  }, [conversationId, documentId, message, onAccepted, onClose, resetLocalState, targetCompanyId, turn]);

  const sourcePanel = file && previewUrl ? (
    file.type === 'application/pdf' ? (
      <DocumentPageViewer
        pdfUrl={previewUrl}
        className="h-full"
        keyboardShortcutScope="focused"
      />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element -- local object URL has no Next image optimization path.
      <img
        src={previewUrl}
        alt={`Uploaded BizFile preview: ${file.name}`}
        className="h-full w-full object-contain bg-background-secondary"
      />
    )
  ) : null;

  const extractionMetadata = aiMetadata?.modelName || aiMetadata?.formattedCost ? (
    <span>
      {[aiMetadata.modelName, aiMetadata.formattedCost ? `Est. ${aiMetadata.formattedCost}` : null]
        .filter(Boolean)
        .join(' · ')}
    </span>
  ) : undefined;

  const reviewContent = extractedData && sourcePanel ? (
    <div className="flex h-full min-h-0 flex-col">
      {submissionError ? (
        <Alert variant="error" title="Could not create proposal" className="m-3 mb-0">
          {submissionError} The uploaded source has been kept so the request can be retried safely.
        </Alert>
      ) : null}
      <div className="min-h-0 flex-1">
        <BizFileReviewWorkspace
          initialData={extractedData}
          sourcePanel={sourcePanel}
          tenantId={workspaceId}
          confirmationStage="PREPARE"
          isSaving={turn.isPending}
          extractionMetadata={extractionMetadata}
          onConfirm={submitReviewedData}
          onCancel={() => void closeAndCleanup()}
          onReset={() => void resetForAnotherFile()}
        />
      </div>
    </div>
  ) : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => void closeAndCleanup()}
      title="Upload BizFile to Olaf"
      description="Upload, review, and correct the BizFile before Olaf prepares any company changes."
      size={phase === 'review' ? 'full' : '2xl'}
      showCloseButton={!busy && phase !== 'review'}
      closeOnOverlayClick={!busy && phase !== 'review'}
      closeOnEscape={!busy && phase !== 'review'}
      className={phase === 'review' ? 'overflow-hidden' : undefined}
    >
      {phase === 'review' ? (
        <div className="h-[min(82vh,840px)] min-h-[420px]">{reviewContent}</div>
      ) : (
        <>
          <ModalBody className="space-y-4">
            {error ? (
              <Alert variant="error" title={errorStage === 'extract' ? 'Extraction failed' : 'Upload failed'}>
                {error}
              </Alert>
            ) : null}

            {phase === 'upload' ? (
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                className="flex min-h-64 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border-secondary bg-background-primary p-8 text-center"
              >
                <FileUp className="mb-4 h-10 w-10 text-oak-primary" aria-hidden="true" />
                <h3 className="text-base font-semibold text-text-primary">Upload a BizFile</h3>
                <p className="mt-1 max-w-md text-sm text-text-secondary">
                  PDF, PNG, JPG, or WebP. Maximum file size 10 MB.
                </p>
                <input
                  ref={fileInputRef}
                  data-testid="bizfile-file-input"
                  type="file"
                  accept={BIZFILE_ACCEPT}
                  onChange={handleFileInput}
                  className="sr-only"
                  aria-label="Choose BizFile"
                />
                <Button
                  type="button"
                  className="mt-5"
                  leftIcon={<FileUp className="h-4 w-4" />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose BizFile
                </Button>
                <p className="mt-3 text-xs text-text-muted">You can also drag a file here.</p>
              </div>
            ) : null}

            {phase === 'uploading' || phase === 'extracting' ? (
              <div className="flex min-h-64 flex-col items-center justify-center text-center" role="status">
                <RefreshCw className="mb-4 h-8 w-8 animate-spin text-oak-primary" aria-hidden="true" />
                <h3 className="text-base font-semibold text-text-primary">
                  {phase === 'uploading' ? 'Uploading BizFile…' : 'Extracting BizFile information…'}
                </h3>
                <p className="mt-1 text-sm text-text-secondary">
                  No company record is changed during upload or extraction.
                </p>
              </div>
            ) : null}

            {phase === 'error' ? (
              <div className="flex min-h-48 flex-col items-center justify-center text-center">
                <FileText className="mb-3 h-8 w-8 text-text-muted" aria-hidden="true" />
                <p className="max-w-md text-sm text-text-secondary">
                  The uploaded document has not changed any company record.
                </p>
              </div>
            ) : null}

            {phase === 'active-conflict' && conflict && extractedData ? (
              <div className="space-y-4">
                <Alert variant="warning" title="Existing company found">
                  <strong>{conflict.companyName}</strong> ({conflict.uen}) already exists in this workspace.
                  Choose the update path explicitly before Olaf prepares a proposal.
                </Alert>
                <div className="rounded-lg border border-border-primary bg-background-primary p-4">
                  <p className="text-sm font-medium text-text-primary">Use this BizFile to review an update?</p>
                  <p className="mt-1 text-sm text-text-secondary">
                    Uploading and reviewing alone will not modify the company. Olaf will prepare the canonical
                    change proposal next, and the final mutation still requires Business Assistant confirmation.
                  </p>
                </div>
              </div>
            ) : null}

            {phase === 'recycled-conflict' && conflict ? (
              <div className="space-y-4">
                <Alert variant="warning" title="Company is in the recycle bin">
                  <strong>{conflict.companyName}</strong> ({conflict.uen}) is currently deleted. Restore it through
                  company administration before retrying this BizFile. Olaf will not restore or permanently delete it automatically.
                </Alert>
                <p className="text-sm text-text-secondary">
                  The uploaded document has not been applied to a company record.
                </p>
              </div>
            ) : null}
          </ModalBody>

          <ModalFooter>
            {phase === 'error' && errorStage === 'extract' && documentId ? (
              <Button variant="secondary" onClick={() => void extractDocument(documentId)}>
                Retry extraction
              </Button>
            ) : null}
            {phase === 'error' || phase === 'active-conflict' || phase === 'recycled-conflict' ? (
              <Button variant="secondary" onClick={() => void resetForAnotherFile()}>
                Upload different file
              </Button>
            ) : null}
            {phase === 'recycled-conflict' ? (
              <Link href="/companies" className="btn-secondary btn-sm">
                Open company management
              </Link>
            ) : null}
            <Button variant="ghost" disabled={busy} onClick={() => void closeAndCleanup()}>
              Cancel
            </Button>
            {phase === 'active-conflict' && conflict && extractedData ? (
              <Button
                onClick={() => {
                  setTargetCompanyId(conflict.companyId);
                  setPhase('review');
                }}
              >
                Review update to existing company
              </Button>
            ) : null}
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
