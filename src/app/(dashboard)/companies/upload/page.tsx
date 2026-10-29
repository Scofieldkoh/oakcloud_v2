'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useDropzone } from 'react-dropzone';
import {
  FileUp,
  File,
  X,
  AlertCircle,
  CheckCircle,
  Loader2,
  Building2,
  Sparkles,
  RefreshCw,
  Users,
  UserPlus,
  UserMinus,
  UserCheck,
  Calendar,
  Briefcase,
  PieChart,
} from 'lucide-react';
import { useSession } from '@/hooks/use-auth';
import { useCompany } from '@/hooks/use-companies';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { AIModelSelector, buildFullContext } from '@/components/ui/ai-model-selector';
import { DocumentPageViewer, ResizableSplitView } from '@/components/processing';
import { postFormDataWithFallback } from '@/lib/browser-upload';
import { applyAutomaticContactResolutions, BizFileReviewWorkspace, buildBizFileContactIdentityCandidates } from '@/components/companies/bizfile-review/bizfile-review-workspace';
import { ContactMatchPanel } from '@/components/companies/bizfile-review/bizfile-review-sections';
import { CompanyCreateSharePointField, type PendingSharePointSelection } from '@/components/companies/company-create-sharepoint-field';
import type { BizFileReviewIssue } from '@/lib/validations/bizfile-review';
import type { ExtractedBizFileData } from '@/services/bizfile/types';
import type { ContactMatchPreview, ContactResolutionDecision } from '@/types/contact-identity';
import { fetchBizFileContactMatchPreviews } from '@/services/bizfile/contact-match-preview.client';
import { BizFilePlanReview } from '@/components/companies/bizfile-review/bizfile-plan-review';
import type { BizFileChangePlan } from '@/services/bizfile/change-plan';
import {
  readTaskLaunchContext,
  withTaskLaunchContext,
} from '@/lib/task-launch-context';

type UploadStep = 'upload' | 'extracting' | 'preview' | 'diff-preview' | 'saving' | 'complete';

interface CanonicalReview {
  plan: BizFileChangePlan;
  preparationToken: string;
  operationId: string;
  update: boolean;
}

interface DiffEntry {
  field: string;
  label: string;
  oldValue: string | number | null | undefined;
  newValue: string | number | null | undefined;
  category: 'entity' | 'ssic' | 'address' | 'compliance' | 'capital';
}

interface OfficerDiffEntry {
  type: 'added' | 'updated' | 'potentially_ceased';
  officerId?: string;
  sourceRecordId?: string;
  name: string;
  role: string;
  changes?: Array<{ field: string; label: string; oldValue: string | null; newValue: string | null }>;
  extractedData?: {
    name: string;
    role: string;
    appointmentDate?: string;
  };
  matchConfidence?: 'high' | 'medium' | 'low';
}

interface ShareholderDiffEntry {
  type: 'added' | 'removed' | 'updated';
  shareholderId?: string;
  sourceRecordId?: string;
  name: string;
  shareholderType: 'INDIVIDUAL' | 'CORPORATE';
  changes?: Array<{ field: string; label: string; oldValue: string | number | null; newValue: string | number | null }>;
  shareholdingChanges?: {
    shareClass?: { old: string; new: string };
    numberOfShares?: { old: number; new: number };
  };
  extractedData?: {
    name: string;
    type: 'INDIVIDUAL' | 'CORPORATE';
    isNominee?: boolean;
    shareClass: string;
    numberOfShares: number;
    percentageHeld?: number;
  };
  matchConfidence?: 'high' | 'medium' | 'low';
}

interface OfficerAction {
  officerId: string;
  action: 'cease' | 'follow_up';
  cessationDate?: string;
}

interface DiffResult {
  hasDifferences: boolean;
  differences: DiffEntry[];
  existingCompany: { name: string; uen: string };
  officerDiffs?: OfficerDiffEntry[];
  shareholderDiffs?: ShareholderDiffEntry[];
  summary?: {
    officersAdded: number;
    officersUpdated: number;
    officersPotentiallyCeased: number;
    shareholdersAdded: number;
    shareholdersUpdated: number;
    shareholdersRemoved: number;
  };
}

/** Safely extract error message from a non-ok fetch response (handles HTML error pages) */
async function safeJsonError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    return data?.error || fallback;
  } catch {
    return `${fallback} (HTTP ${response.status})`;
  }
}

async function fetchWithStageError(
  input: RequestInfo | URL,
  init: RequestInit,
  stage: string
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const detail =
      error instanceof Error && error.message
        ? ` ${error.message}.`
        : '';

    throw new Error(
      `Network error while ${stage}.${detail} Please refresh and try again. ` +
        `If it keeps happening, restart the dev server and retry.`
    );
  }
}

async function uploadWithStageError(
  input: string | URL,
  formData: FormData,
  stage: string
): Promise<Response> {
  try {
    return await postFormDataWithFallback(input, formData);
  } catch (error) {
    const detail =
      error instanceof Error && error.message
        ? ` ${error.message}.`
        : '';

    throw new Error(
      `Network error while ${stage}.${detail} Please refresh and try again. ` +
        `If it keeps happening, restart the dev server and retry.`
    );
  }
}

// AI metadata from extraction
interface AIMetadata {
  modelUsed: string;
  modelName?: string;
  providerUsed: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    pagesProcessed?: number;
  };
  estimatedCost?: number;
  formattedCost?: string;
}

function AIExtractionMetadata({ metadata }: { metadata: AIMetadata | null }) {
  if (!metadata) return null;
  return <div className="flex items-center gap-1.5 text-xs text-text-secondary">
    <Sparkles className="h-3.5 w-3.5 shrink-0 text-oak-primary" />
    <span>
      {metadata.modelName || metadata.modelUsed} ({metadata.providerUsed})
      {metadata.usage && <span className="ml-1 text-text-muted">· {metadata.providerUsed === 'mistral' && metadata.usage.pagesProcessed
        ? `${metadata.usage.pagesProcessed.toLocaleString()} pages`
        : `${metadata.usage.totalTokens.toLocaleString()} tokens`}</span>}
      {metadata.formattedCost && <span className="ml-1 text-text-muted">· Est. {metadata.formattedCost}</span>}
    </span>
  </div>;
}

export default function UploadBizFilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskContext = useMemo(
    () => readTaskLaunchContext(searchParams),
    [searchParams],
  );
  const returnHref = taskContext?.returnTo ?? '/companies';
  const { data: session } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [step, setStep] = useState<UploadStep>('upload');
  const [error, setError] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedBizFileData | null>(null);
  const [serverIssues, setServerIssues] = useState<BizFileReviewIssue[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const confirmGenerationRef = useRef(0);
  const confirmAbortRef = useRef<AbortController | null>(null);
  const resumedDocumentRef = useRef<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [aiMetadata, setAiMetadata] = useState<AIMetadata | null>(null);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [contactMatchPreviews, setContactMatchPreviews] = useState<Record<string, ContactMatchPreview | null>>({});
  const [updatedFields, setUpdatedFields] = useState<string[]>([]);
  const [officerActions, setOfficerActions] = useState<OfficerAction[]>([]);
  const [canonicalReview, setCanonicalReview] = useState<CanonicalReview | null>(null);
  const [isPreparingPlan, setIsPreparingPlan] = useState(false);
  const [officerChanges, setOfficerChanges] = useState<{ added: number; updated: number; ceased: number; followUp: number } | null>(null);
  const [shareholderChanges, setShareholderChanges] = useState<{ added: number; updated: number; removed: number } | null>(null);
  const [companyUpdatedAt, setCompanyUpdatedAt] = useState<string | null>(null); // For concurrent update detection
  const [concurrentUpdateWarning, setConcurrentUpdateWarning] = useState<string | null>(null);
  const [sharePointSelection, setSharePointSelection] = useState<PendingSharePointSelection>({ kind: 'unmapped' });
  const [sharePointSetupWarning, setSharePointSetupWarning] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    type: 'IN_RECYCLE_BIN' | 'ALREADY_EXISTS';
    companyId: string;
    companyName: string;
    uen: string;
  } | null>(null);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [conflictLoading, setConflictLoading] = useState(false);

  // Check if updating an existing company
  const existingCompanyId = searchParams.get('companyId');
  const { data: existingCompany } = useCompany(existingCompanyId || '');
  const isUpdateMode = !!existingCompanyId;

  // SUPER_ADMIN tenant selection (from centralized store)
  const isSuperAdmin = session?.isSuperAdmin ?? false;
  const activeTenantId = useActiveWorkspaceId(isSuperAdmin, session?.tenantId);

  // AI model selection and context
  const [selectedModelId, setSelectedModelId] = useState('');
  const [aiContext, setAiContext] = useState('');
  const [selectedStandardContexts, setSelectedStandardContexts] = useState<string[]>([]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
      setError(null);
    }
  }, []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/webp': ['.webp'],
    },
    maxSize: 10 * 1024 * 1024, // 10MB
    multiple: false,
  });

  const extractUploadedDocument = useCallback(async (docId: string) => {
    const fullContext = buildFullContext(selectedStandardContexts, aiContext);

    if (isUpdateMode && existingCompanyId) {
      const diffResponse = await fetchWithStageError(`/api/documents/${docId}/preview-diff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: existingCompanyId,
          modelId: selectedModelId || undefined,
          additionalContext: fullContext || undefined,
        }),
      }, 'extracting and comparing the BizFile');

      if (!diffResponse.ok) {
        const err = await safeJsonError(diffResponse, 'Failed to extract and compare data');
        throw new Error(err);
      }

      const {
        extractedData: data,
        diff,
        aiMetadata: metadata,
        companyUpdatedAt: updatedAt,
      } = await diffResponse.json();
      setExtractedData(data);
      setDiffResult(diff);
      setCompanyId(existingCompanyId);
      setAiMetadata(metadata);
      setCompanyUpdatedAt(updatedAt);
      setStep('diff-preview');
      return;
    }

    const extractResponse = await fetchWithStageError(`/api/documents/${docId}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: selectedModelId || undefined,
        additionalContext: fullContext || undefined,
      }),
    }, 'extracting the BizFile');

    if (!extractResponse.ok) {
      const err = await safeJsonError(extractResponse, 'Failed to extract data');
      throw new Error(err);
    }

    const {
      extractedData: data,
      conflict: conflictData,
      aiMetadata: metadata,
    } = await extractResponse.json();
    setExtractedData(data);
    setAiMetadata(metadata);
    setServerIssues([]);

    if (conflictData) {
      setConflict(conflictData);
      setConflictDialogOpen(true);
      setStep('upload');
    } else {
      setStep('preview');
    }
  }, [
    aiContext,
    existingCompanyId,
    isUpdateMode,
    selectedModelId,
    selectedStandardContexts,
  ]);

  useEffect(() => {
    const resumedDocumentId = searchParams.get('documentId');
    if (!resumedDocumentId || resumedDocumentRef.current === resumedDocumentId) return;
    resumedDocumentRef.current = resumedDocumentId;
    setError(null);
    setStep('extracting');

    void (async () => {
      try {
        const sourceResponse = await fetch(`/api/documents/${resumedDocumentId}`);
        if (!sourceResponse.ok) {
          throw new Error(await safeJsonError(sourceResponse, 'Failed to load the uploaded BizFile'));
        }
        const sourceBlob = await sourceResponse.blob();
        const sourceFile = new globalThis.File(
          [sourceBlob],
          searchParams.get('fileName') || 'BizFile document',
          { type: sourceBlob.type || 'application/octet-stream' },
        );
        setFile(sourceFile);
        setDocumentId(resumedDocumentId);
        await extractUploadedDocument(resumedDocumentId);
      } catch (resumeError) {
        setError(resumeError instanceof Error ? resumeError.message : 'Failed to open the uploaded BizFile.');
        setStep('upload');
      }
    })();
  }, [extractUploadedDocument, searchParams]);

  const handleUploadAndExtract = async () => {
    if (!file) return;

    // SUPER_ADMIN must select a tenant
    if (isSuperAdmin && !activeTenantId) {
      setError('Please select a tenant before uploading');
      return;
    }

    setError(null);
    setStep('extracting');

    try {
      // First, create a temporary company or use existing flow
      // For now, we'll upload to a "pending" endpoint and extract
      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', 'BIZFILE');
      // Include tenantId for SUPER_ADMIN
      if (isSuperAdmin && activeTenantId) {
        formData.append('tenantId', activeTenantId);
      }

      // Upload and get document ID
      const uploadResponse = await uploadWithStageError(
        '/api/documents/upload',
        formData,
        'uploading the file'
      );

      if (!uploadResponse.ok) {
        const err = await safeJsonError(uploadResponse, 'Failed to upload file');
        throw new Error(err);
      }

      const { documentId: docId } = await uploadResponse.json();
      setDocumentId(docId);
      await extractUploadedDocument(docId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setStep('upload');
    }
  };

  const applySharePointSelection = async (createdCompanyId: string) => {
    if (isUpdateMode || sharePointSelection.kind === 'unmapped') return;
    let folder = sharePointSelection.kind === 'selected' ? sharePointSelection.folder : null;
    if (!folder) {
      if (sharePointSelection.kind !== 'requested') throw new Error('A SharePoint folder selection is incomplete');
      const requestedSelection = sharePointSelection;
      const rootResponse = await fetch(`/api/settings/sharepoint-filing?connectorId=${encodeURIComponent(requestedSelection.connectorId)}`);
      const settings = await rootResponse.json() as { clientDocumentsRoot?: { itemId: string } | null; error?: string };
      if (!rootResponse.ok || !settings.clientDocumentsRoot) throw new Error(settings.error || 'Client Documents root is not configured');
      const folderResponse = await fetch('/api/sharepoint/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectorId: requestedSelection.connectorId, parentItemId: settings.clientDocumentsRoot.itemId, name: requestedSelection.name, mode: 'client-folder' }),
      });
      const folderBody = await folderResponse.json();
      if (!folderResponse.ok) throw new Error(folderBody.error || 'SharePoint folder could not be created');
      folder = folderBody;
    }
    const mappingResponse = await fetch(`/api/companies/${createdCompanyId}/sharepoint-folder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectorId: sharePointSelection.connectorId, folder }),
    });
    const mappingBody = await mappingResponse.json();
    if (!mappingResponse.ok) throw new Error(mappingBody.error || 'SharePoint company mapping failed');
  };

  const prepareCanonicalReview = async (correctedData: ExtractedBizFileData, update: boolean, selectedChangeIds?: string[]) => {
    if (!documentId) return;
    confirmAbortRef.current?.abort();
    const generation = ++confirmGenerationRef.current;
    const controller = new AbortController();
    confirmAbortRef.current = controller;
    setIsPreparingPlan(true);
    setServerIssues([]);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/prepare-import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extractedData: correctedData, targetCompanyId: update ? companyId : undefined,
          mode: update ? 'UPDATE' : 'CREATE', selectedChangeIds, taskContext,
          officerActions: update && officerActions.length ? officerActions : undefined }),
        signal: controller.signal,
      });
      if (generation !== confirmGenerationRef.current) return;
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string; issues?: BizFileReviewIssue[] } | null;
        if (generation !== confirmGenerationRef.current) return;
        if (Array.isArray(body?.issues)) setServerIssues(body.issues);
        throw new Error(typeof body?.error === 'string' ? body.error : `Could not prepare the reviewed changes (HTTP ${response.status})`);
      }
      const prepared = await response.json() as { plan: BizFileChangePlan; preparationToken: string };
      if (generation !== confirmGenerationRef.current) return;
      if (!prepared.plan || typeof prepared.preparationToken !== 'string' || prepared.plan.documentId !== documentId) throw new Error('The prepared changes are unavailable. Please try again.');
      const review = { plan: prepared.plan, preparationToken: prepared.preparationToken, operationId: crypto.randomUUID(), update };
      if (update) setCanonicalReview(review);
      return review;
    } catch (error) {
      if (generation !== confirmGenerationRef.current || controller.signal.aborted) return;
      throw error;
    } finally {
      if (generation === confirmGenerationRef.current) { setIsPreparingPlan(false); confirmAbortRef.current = null; }
    }
  };

  const handleConfirm = async (correctedData: ExtractedBizFileData, approved?: CanonicalReview) => {
    if (!documentId) return;

    if (!approved) {
      // The upload workspace is the user's review and confirmation for creation.
      try { approved = await prepareCanonicalReview(correctedData, false); }
      catch (error) { setError(error instanceof Error ? error.message : 'Could not prepare the reviewed changes'); throw error; }
      if (!approved) return;
    }

    confirmAbortRef.current?.abort();
    const generation = ++confirmGenerationRef.current;
    const controller = new AbortController();
    confirmAbortRef.current = controller;
    setIsConfirming(true);
    setServerIssues([]);
    setError(null);

    try {
      // Confirm and save the extracted data
      const response = await fetch(`/api/documents/${documentId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extractedData: correctedData, taskContext, plan: approved.plan,
          operationId: approved.operationId, preparationToken: approved.preparationToken }),
        signal: controller.signal,
      });

      if (generation !== confirmGenerationRef.current) return;

      if (!response.ok) {
        if (response.status === 400) {
          const result = await response.json().catch(() => null) as { error?: string; issues?: BizFileReviewIssue[] } | null;
          if (generation !== confirmGenerationRef.current) return;
          const responseIssues = Array.isArray(result?.issues) ? result.issues : null;
          if (responseIssues) {
            setServerIssues(responseIssues);
          }
          const serverError = typeof result?.error === 'string' && result.error.trim() ? result.error : null;
          throw new Error(serverError || (responseIssues
            ? 'Please correct the highlighted fields'
            : result ? 'Failed to save data' : `Failed to save data (HTTP ${response.status})`));
        }
        const err = await safeJsonError(response, 'Failed to save data');
        if (generation !== confirmGenerationRef.current) return;
        throw new Error(err);
      }

      const { companyId: cId } = await response.json();
      if (generation !== confirmGenerationRef.current) return;
      setCompanyId(cId);
      setCanonicalReview(null);
      let sharePointMappingFailed = false;
      try {
        await applySharePointSelection(cId);
      } catch (mappingError) {
        sharePointMappingFailed = true;
        setSharePointSetupWarning(`Company saved, but SharePoint setup needs attention: ${mappingError instanceof Error ? mappingError.message : 'mapping failed'}`);
      }
      if (taskContext && !sharePointMappingFailed) {
        router.push(withTaskLaunchContext(returnHref, taskContext));
        return;
      }
      setStep('complete');
    } catch (err) {
      if (generation !== confirmGenerationRef.current || controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'An error occurred');
      throw err;
    } finally {
      if (generation === confirmGenerationRef.current) {
        confirmAbortRef.current = null;
        setIsConfirming(false);
      }
    }
  };

  const requestContactMatchPreviews = useCallback(async (data: ExtractedBizFileData) => {
    const candidates = buildBizFileContactIdentityCandidates(data, ['officers', 'shareholders']);
    if (candidates.length === 0) return {};
    const matches = await fetchBizFileContactMatchPreviews(candidates, fetch, activeTenantId || undefined);
    setContactMatchPreviews(matches);
    setExtractedData((current) => current ? applyAutomaticContactResolutions(current, matches) : current);
    return matches;
  }, [activeTenantId]);

  const updateIdentitySnapshot = useMemo(() => extractedData
    ? JSON.stringify(buildBizFileContactIdentityCandidates(extractedData, ['officers', 'shareholders']))
    : '', [extractedData]);
  useEffect(() => {
    if (step !== 'diff-preview' || !extractedData) return;
    void requestContactMatchPreviews(extractedData).catch((previewError) => {
      setError(previewError instanceof Error ? previewError.message : 'Failed to preview contact matches');
    });
    // Reviewed decisions do not change identity candidates, so they do not retrigger preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestContactMatchPreviews, step, updateIdentitySnapshot]);

  const setContactResolution = useCallback((
    section: 'officers' | 'shareholders',
    index: number,
    contactResolution: Exclude<ContactResolutionDecision, { action: 'AUTO' }>,
  ) => {
    setExtractedData((current) => {
      if (!current) return current;
      const records = current[section] ?? [];
      return {
        ...current,
        [section]: records.map((record, recordIndex) => recordIndex === index
          ? { ...record, contactResolution }
          : record),
      };
    });
  }, []);

  const sourceIndex = (sourceRecordId?: string) => {
    if (!sourceRecordId) return -1;
    const index = Number(sourceRecordId.split('.')[1]);
    return Number.isInteger(index) && index >= 0 ? index : -1;
  };

  const handleApplyUpdate = async (approved?: CanonicalReview) => {
    if (!documentId || !companyId || !extractedData) return;

    setError(null);

    try {
      const latestMatches = approved ? {} : await requestContactMatchPreviews(extractedData);
      const resolvedData = approved ? approved.plan.reviewedData : applyAutomaticContactResolutions(extractedData, latestMatches);
      setExtractedData(resolvedData);
      const unresolved = Object.entries(latestMatches).find(([path, match]) => {
        if (!match) return false;
        const [section, rawIndex] = path.split('.') as ['officers' | 'shareholders', string];
        const resolution = resolvedData[section]?.[Number(rawIndex)]?.contactResolution;
        return !resolution || (resolution.action === 'REUSE'
          && (resolution.contactId !== match.contactId || match.blockedByIdentifierConflict));
      });
      if (unresolved) {
        setError(`Review the contact match for ${unresolved[0]} before applying changes.`);
        return;
      }
      if (!approved) { await prepareCanonicalReview(resolvedData, true); return; }
      setStep('saving');
      // Apply selective update with only changed fields
      const response = await fetch(`/api/documents/${documentId}/apply-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          extractedData: resolvedData,
          taskContext,
          officerActions: officerActions.length > 0 ? officerActions : undefined,
          expectedUpdatedAt: companyUpdatedAt || undefined, // For concurrent update detection
          plan: approved.plan,
          operationId: approved.operationId,
          preparationToken: approved.preparationToken,
        }),
      });

      if (!response.ok) {
        const err = await safeJsonError(response, 'Failed to apply update');
        throw new Error(err);
      }

      const result = await response.json();
      setCanonicalReview(null);
      setUpdatedFields(result.updatedFields || []);
      setOfficerChanges(result.officerChanges || null);
      setShareholderChanges(result.shareholderChanges || null);
      setConcurrentUpdateWarning(result.concurrentUpdateWarning || null);
      if (taskContext) {
        router.push(withTaskLaunchContext(returnHref, taskContext));
        return;
      }
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setStep('diff-preview');
    }
  };

  const handleReset = () => {
    confirmGenerationRef.current += 1;
    confirmAbortRef.current?.abort();
    confirmAbortRef.current = null;
    setFile(null);
    setStep('upload');
    setError(null);
    setExtractedData(null);
    setServerIssues([]);
    setIsConfirming(false);
    setIsPreparingPlan(false);
    setDocumentId(null);
    setCompanyId(null);
    setAiMetadata(null);
    setAiContext('');
    setSelectedStandardContexts([]);
    setDiffResult(null);
    setContactMatchPreviews({});
    setUpdatedFields([]);
    setOfficerActions([]);
    setCanonicalReview(null);
    setOfficerChanges(null);
    setShareholderChanges(null);
    setCompanyUpdatedAt(null);
    setConcurrentUpdateWarning(null);
    setConflict(null);
    setConflictDialogOpen(false);
    setConflictLoading(false);
    setSharePointSelection({ kind: 'unmapped' });
    setSharePointSetupWarning(null);
  };

  useEffect(() => () => {
    confirmGenerationRef.current += 1;
    confirmAbortRef.current?.abort();
  }, []);

  const cleanupDocument = async (docId: string) => {
    try {
      await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
    } catch {
      // Best-effort cleanup
    }
  };

  const handleConflictCancel = async () => {
    setConflictDialogOpen(false);
    if (documentId) {
      await cleanupDocument(documentId);
    }
    handleReset();
  };

  const handleConflictPermanentDelete = async () => {
    if (!conflict || !documentId) return;
    setConflictLoading(true);
    try {
      const response = await fetch(
        `/api/companies/${conflict.companyId}?action=permanent`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const err = await safeJsonError(response, 'Failed to permanently delete company');
        throw new Error(err);
      }
      setConflictDialogOpen(false);
      setConflict(null);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to permanently delete company');
      setConflictDialogOpen(false);
    } finally {
      setConflictLoading(false);
    }
  };

  const handleConflictViewDiff = async () => {
    if (!conflict || !documentId) return;
    setConflictLoading(true);
    try {
      const fullContext = buildFullContext(selectedStandardContexts, aiContext);
      const diffResponse = await fetch(`/api/documents/${documentId}/preview-diff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: conflict.companyId,
          modelId: selectedModelId || undefined,
          additionalContext: fullContext || undefined,
        }),
      });

      if (!diffResponse.ok) {
        const err = await diffResponse.json();
        throw new Error(err.error || 'Failed to generate diff');
      }

      const { extractedData: data, diff, aiMetadata: metadata, companyUpdatedAt: updatedAt } = await diffResponse.json();
      setExtractedData(data);
      setDiffResult(diff);
      setCompanyId(conflict.companyId);
      setAiMetadata(metadata);
      setCompanyUpdatedAt(updatedAt);
      setConflictDialogOpen(false);
      setConflict(null);
      setStep('diff-preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate diff');
      setConflictDialogOpen(false);
    } finally {
      setConflictLoading(false);
    }
  };

  const handleCancel = () => {
    if (step === 'upload') {
      router.push(taskContext?.returnTo
        ?? (isUpdateMode ? `/companies/${existingCompanyId}` : '/companies'));
      return;
    }

    if (step === 'preview' || step === 'diff-preview') {
      // Clean up pending document when cancelling from preview/diff-preview in create mode
      // (not in update mode, which navigated here with ?companyId= and has no pending doc)
      if (!isUpdateMode && documentId) {
        cleanupDocument(documentId);
      }
      handleReset();
      return;
    }

    if (step === 'complete' && companyId) {
      router.push(taskContext?.returnTo ?? `/companies/${companyId}`);
    }
  };

  useKeyboardShortcuts([
    {
      key: 'Backspace',
      ctrl: true,
      handler: handleCancel,
      description: 'Cancel and go back',
    },
    ...(step === 'diff-preview' ? [{
      key: 's',
      ctrl: true,
      handler: () => { if (!canonicalReview && !isPreparingPlan) void handleApplyUpdate(); },
      description: 'Apply changes',
    }] : []),
    {
      key: 'F1',
      handler: () => router.push(withTaskLaunchContext('/companies/new', taskContext)),
      description: 'Create company',
    },
  ], step !== 'extracting' && step !== 'saving' && step !== 'preview');

  // Handle officer action change (for potentially ceased officers)
  const handleOfficerActionChange = (officerId: string, action: 'cease' | 'follow_up', cessationDate?: string) => {
    setOfficerActions((prev) => {
      const existing = prev.find((a) => a.officerId === officerId);
      if (existing) {
        return prev.map((a) =>
          a.officerId === officerId ? { ...a, action, cessationDate } : a
        );
      }
      return [...prev, { officerId, action, cessationDate }];
    });
  };

  const isPdfFile = !!file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  const isImageFile = !!file && (file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name));
  const previewPanel = (
    <div className="h-full bg-background-secondary border border-border-primary rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border-primary bg-background-tertiary">
        <p className="truncate text-sm font-medium text-text-primary">
          BizFile Preview (File: {file?.name || 'No file selected'})
        </p>
      </div>
      <div className="h-[calc(100%-45px)] bg-background-primary">
        {!file || !previewUrl ? (
          <div className="h-full flex items-center justify-center text-sm text-text-tertiary">
            Upload a file to preview the BizFile pages.
          </div>
        ) : isPdfFile ? (
          <DocumentPageViewer pdfUrl={previewUrl} className="h-full" />
        ) : isImageFile ? (
          <div className="h-full flex items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- Local object URL preview */}
            <img
              src={previewUrl}
              alt="BizFile preview"
              className="max-h-full max-w-full object-contain rounded"
            />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-text-tertiary">
            Preview available for PDF or image files.
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div data-testid="bizfile-upload-page" className={`p-4 sm:p-6 w-full ${(step === 'preview' || step === 'diff-preview') ? 'max-w-none h-dvh overflow-hidden flex flex-col' : 'max-w-7xl'}`}>
      {canonicalReview && <BizFilePlanReview key={canonicalReview.plan.canonicalHash} plan={canonicalReview.plan}
        busy={isPreparingPlan || isConfirming || step === 'saving'} error={error}
        onClose={() => { if (!isPreparingPlan && !isConfirming && step !== 'saving') { setCanonicalReview(null); setError(null); } }}
        onRevise={(selected) => { void prepareCanonicalReview(canonicalReview.plan.reviewedData, canonicalReview.update, selected)
          .catch((error) => setError(error instanceof Error ? error.message : 'Could not revise the proposal')); }}
        onApprove={() => { if (canonicalReview.update) void handleApplyUpdate(canonicalReview);
          else void handleConfirm(canonicalReview.plan.reviewedData, canonicalReview).catch(() => undefined); }} />}
      {/* Header */}
      <div className={(step === 'preview' || step === 'diff-preview') ? 'mb-3 shrink-0' : 'mb-6'}>
        <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">
          {isUpdateMode ? 'Update via BizFile' : 'Upload BizFile'}
        </h1>
      </div>

      {/* Update Mode Notice */}
      {isUpdateMode && existingCompany && (
        <div className="card border-oak-primary/50 bg-oak-primary/5 mb-6">
          <div className="flex items-start gap-3">
            <Building2 className="w-5 h-5 text-oak-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-text-primary">
                Updating: {existingCompany.name}
              </p>
              <p className="text-sm text-text-secondary mt-1">
                UEN: {existingCompany.uen} • This upload will update the existing company record and its related data (officers, shareholders, addresses).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tenant context info for SUPER_ADMIN */}
      {isSuperAdmin && !activeTenantId && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Please select a tenant from the sidebar to upload a BizFile.
          </p>
        </div>
      )}

      {/* Error */}
      {error && !canonicalReview && (
        <div className="card border-status-error bg-status-error/5 mb-4">
          <div className="flex items-center gap-3 text-status-error">
            <AlertCircle className="w-5 h-5" />
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Step: Upload */}
      {step === 'upload' && (
        <div className="space-y-6">
          <div
            {...getRootProps()}
            className={`card p-12 text-center border-2 border-dashed cursor-pointer transition-colors ${
              isDragActive
                ? 'border-oak-primary bg-oak-primary/5'
                : 'border-border-secondary hover:border-oak-primary/50'
            }`}
          >
            <input {...getInputProps()} />
            <FileUp className="w-12 h-12 text-text-muted mx-auto mb-4" />
            <h3 className="text-lg font-medium text-text-primary mb-2">
              {isDragActive ? 'Drop the file here' : 'Drag & drop your BizFile document'}
            </h3>
            <p className="text-text-secondary mb-4">
              or click to browse your files
            </p>
            <p className="text-sm text-text-tertiary">PDF or image files (PNG, JPG), max 10MB</p>
          </div>

          {file && (
            <div className="card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <File className="w-8 h-8 text-oak-light" />
                  <div>
                    <p className="font-medium text-text-primary">{file.name}</p>
                    <p className="text-sm text-text-tertiary">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setFile(null)}
                  className="p-2 hover:bg-background-elevated rounded text-text-tertiary hover:text-text-primary"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* AI Model Selector with Context */}
          <AIModelSelector
            value={selectedModelId}
            onChange={setSelectedModelId}
            label="AI Model for Extraction"
            helpText="Auto uses your BizFile extraction default from Connectors. If none is set, it uses automatic extraction, including Mistral OCR when configured."
            allowAuto
            jsonModeOnly
            showContextInput
            contextValue={aiContext}
            onContextChange={setAiContext}
            contextLabel="Additional Context (Optional)"
            contextPlaceholder="E.g., 'Focus on shareholder details' or 'This is a newly incorporated company'"
            contextHelpText="Provide hints to help the AI extract data more accurately."
            showStandardContexts
            selectedStandardContexts={selectedStandardContexts}
            onStandardContextsChange={setSelectedStandardContexts}
            tenantId={activeTenantId || undefined}
          />

          <div className="flex items-center justify-end gap-3">
            <Link href={returnHref} className="btn-secondary btn-sm" title="Cancel (Ctrl+Backspace)">
              <span className="hidden sm:inline">Cancel (Ctrl+Backspace)</span>
              <span className="sm:hidden">Cancel</span>
            </Link>
            <button
              onClick={handleUploadAndExtract}
              disabled={!file || (isSuperAdmin && !activeTenantId)}
              className="btn-primary btn-sm flex items-center gap-2"
            >
              <FileUp className="w-4 h-4" />
              Upload & Extract
            </button>
          </div>
        </div>
      )}

      {/* Step: Extracting */}
      {step === 'extracting' && (
        <div className="card p-12 text-center">
          <Loader2 className="w-12 h-12 text-oak-primary mx-auto mb-4 animate-spin" />
          <h3 className="text-lg font-medium text-text-primary mb-2">
            Extracting Information...
          </h3>
          <p className="text-text-secondary">
            AI is analyzing your BizFile document. This may take a moment.
          </p>
        </div>
      )}

      {/* Step: Preview */}
      {step === 'preview' && extractedData && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <BizFileReviewWorkspace
            initialData={extractedData}
            sourcePanel={previewPanel}
            isSaving={isPreparingPlan || isConfirming}
            serverIssues={serverIssues}
            tenantId={activeTenantId || undefined}
            extractionMetadata={<AIExtractionMetadata metadata={aiMetadata} />}
            sharePointSetup={!isUpdateMode ? <CompanyCreateSharePointField onChange={setSharePointSelection} /> : undefined}
            confirmationStage="SAVE"
            onConfirm={(data) => handleConfirm(data)}
            onReset={handleReset}
            onCancel={handleCancel}
          />
        </div>
      )}

      {/* Step: Diff Preview (Update Mode) */}
      {step === 'diff-preview' && extractedData && diffResult && (
        <ResizableSplitView
          className="h-[70vh] min-h-[520px]"
          leftPanel={previewPanel}
          rightPanel={
            <div className="h-full overflow-y-auto bg-background-primary p-4">
              <div className="space-y-6">
          <div className="card bg-status-success/5 border-status-success">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-status-success">
                <CheckCircle className="w-5 h-5" />
                <p className="font-medium">Successfully extracted data from BizFile</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="p-4 border-b border-border-primary">
              <h2 className="font-medium text-text-primary flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-oak-primary" />
                Changes to Apply
              </h2>
              <p className="text-sm text-text-tertiary mt-1">
                Comparing extracted data with {diffResult.existingCompany.name} ({diffResult.existingCompany.uen})
              </p>
            </div>

            {diffResult.hasDifferences ? (
              <div className="divide-y divide-border-primary">
                {/* Group differences by category */}
                {(['entity', 'ssic', 'address', 'compliance', 'capital'] as const).map((category) => {
                  const categoryDiffs = diffResult.differences.filter((d) => d.category === category);
                  if (categoryDiffs.length === 0) return null;

                  const categoryLabels = {
                    entity: 'Entity Details',
                    ssic: 'Business Activity',
                    address: 'Address',
                    compliance: 'Compliance',
                    capital: 'Share Capital',
                  };

                  return (
                    <div key={category} className="p-4">
                      <h3 className="text-xs font-medium text-text-tertiary uppercase mb-3">
                        {categoryLabels[category]}
                      </h3>
                      <div className="space-y-3">
                        {categoryDiffs.map((diff, idx) => (
                          <div key={idx} className="grid grid-cols-3 gap-4 text-sm">
                            <div className="text-text-secondary font-medium">{diff.label}</div>
                            <div className="text-status-error bg-status-error/5 px-2 py-1 rounded line-through">
                              {diff.oldValue || <span className="text-text-muted italic">Not set</span>}
                            </div>
                            <div className="text-status-success bg-status-success/5 px-2 py-1 rounded">
                              {diff.newValue || <span className="text-text-muted italic">Not set</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              // Only show "no changes" if there are also no officer/shareholder diffs
              (!diffResult.officerDiffs?.length && !diffResult.shareholderDiffs?.length) && (
                <div className="p-8 text-center">
                  <CheckCircle className="w-10 h-10 text-status-success mx-auto mb-3" />
                  <p className="text-text-primary font-medium">No changes detected</p>
                  <p className="text-sm text-text-secondary mt-1">
                    The company data is already up to date with this BizFile.
                  </p>
                </div>
              )
            )}
          </div>

          {/* Officer Diffs */}
          {diffResult.officerDiffs && diffResult.officerDiffs.length > 0 && (
            <div className="card">
              <div className="p-4 border-b border-border-primary">
                <h2 className="font-medium text-text-primary flex items-center gap-2">
                  <Users className="w-4 h-4 text-oak-primary" />
                  Officer Changes
                </h2>
                <p className="text-sm text-text-tertiary mt-1">
                  {diffResult.summary?.officersAdded || 0} new, {diffResult.summary?.officersUpdated || 0} updated, {diffResult.summary?.officersPotentiallyCeased || 0} potentially ceased
                </p>
              </div>
              <div className="divide-y divide-border-primary">
                {diffResult.officerDiffs.map((officer, idx) => (
                  <div key={idx} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        {officer.type === 'added' && (
                          <div className="w-8 h-8 rounded-full bg-status-success/10 flex items-center justify-center">
                            <UserPlus className="w-4 h-4 text-status-success" />
                          </div>
                        )}
                        {officer.type === 'updated' && (
                          <div className="w-8 h-8 rounded-full bg-status-info/10 flex items-center justify-center">
                            <UserCheck className="w-4 h-4 text-status-info" />
                          </div>
                        )}
                        {officer.type === 'potentially_ceased' && (
                          <div className="w-8 h-8 rounded-full bg-status-warning/10 flex items-center justify-center">
                            <UserMinus className="w-4 h-4 text-status-warning" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-text-primary">{officer.name}</p>
                          <div className="flex items-center gap-2 text-sm text-text-secondary">
                            <Briefcase className="w-3 h-3" />
                            <span>{officer.role?.replace(/_/g, ' ')}</span>
                            {officer.matchConfidence && (
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                officer.matchConfidence === 'high' ? 'bg-status-success/10 text-status-success' :
                                officer.matchConfidence === 'medium' ? 'bg-status-warning/10 text-status-warning' :
                                'bg-status-error/10 text-status-error'
                              }`}>
                                {officer.matchConfidence} match
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className={`text-xs font-medium px-2 py-1 rounded ${
                        officer.type === 'added' ? 'bg-status-success/10 text-status-success' :
                        officer.type === 'updated' ? 'bg-status-info/10 text-status-info' :
                        'bg-status-warning/10 text-status-warning'
                      }`}>
                        {officer.type === 'added' ? 'New' : officer.type === 'updated' ? 'Updated' : 'Not in BizFile'}
                      </span>
                    </div>

                    {/* Show changes for updated officers */}
                    {officer.type === 'updated' && officer.changes && officer.changes.length > 0 && (
                      <div className="mt-3 ml-11 space-y-2">
                        {officer.changes.map((change, cIdx) => (
                          <div key={cIdx} className="grid grid-cols-3 gap-4 text-sm">
                            <div className="text-text-secondary">{change.label}</div>
                            <div className="text-status-error bg-status-error/5 px-2 py-1 rounded line-through">
                              {change.oldValue || <span className="text-text-muted italic">Not set</span>}
                            </div>
                            <div className="text-status-success bg-status-success/5 px-2 py-1 rounded">
                              {change.newValue || <span className="text-text-muted italic">Not set</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {officer.type === 'added' && sourceIndex(officer.sourceRecordId) >= 0
                      && officer.sourceRecordId && contactMatchPreviews[officer.sourceRecordId] && (
                      <div className="mt-3 ml-0 sm:ml-11">
                        <ContactMatchPanel
                          path={officer.sourceRecordId}
                          recordName={officer.name}
                          match={contactMatchPreviews[officer.sourceRecordId]!}
                          resolution={extractedData.officers?.[sourceIndex(officer.sourceRecordId)]?.contactResolution}
                          onChange={(decision) => setContactResolution('officers', sourceIndex(officer.sourceRecordId), decision)}
                        />
                      </div>
                    )}

                    {/* Action controls for potentially ceased officers */}
                    {officer.type === 'potentially_ceased' && officer.officerId && (
                      <div className="mt-3 ml-11 p-3 bg-background-elevated rounded-lg">
                        <p className="text-sm text-text-secondary mb-2">
                          This officer exists in the database but was not found in the BizFile. What would you like to do?
                        </p>
                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`officer-action-${officer.officerId}`}
                              checked={officerActions.find(a => a.officerId === officer.officerId)?.action === 'cease'}
                              onChange={() => handleOfficerActionChange(officer.officerId!, 'cease')}
                              className="w-4 h-4 text-oak-primary"
                            />
                            <span className="text-sm text-text-primary">Mark as ceased</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`officer-action-${officer.officerId}`}
                              checked={officerActions.find(a => a.officerId === officer.officerId)?.action === 'follow_up'}
                              onChange={() => handleOfficerActionChange(officer.officerId!, 'follow_up')}
                              className="w-4 h-4 text-oak-primary"
                            />
                            <span className="text-sm text-text-primary">Follow up later</span>
                          </label>
                        </div>
                        {officerActions.find(a => a.officerId === officer.officerId)?.action === 'cease' && (
                          <div className="mt-2 flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-text-muted" />
                            <input
                              type="date"
                              value={officerActions.find(a => a.officerId === officer.officerId)?.cessationDate || ''}
                              onChange={(e) => handleOfficerActionChange(officer.officerId!, 'cease', e.target.value)}
                              className="text-sm px-2 py-1 border border-border-primary rounded bg-background-primary text-text-primary"
                              placeholder="Cessation date"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Shareholder Diffs */}
          {diffResult.shareholderDiffs && diffResult.shareholderDiffs.length > 0 && (
            <div className="card">
              <div className="p-4 border-b border-border-primary">
                <h2 className="font-medium text-text-primary flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-oak-primary" />
                  Shareholder Changes
                </h2>
                <p className="text-sm text-text-tertiary mt-1">
                  {diffResult.summary?.shareholdersAdded || 0} new, {diffResult.summary?.shareholdersUpdated || 0} updated, {diffResult.summary?.shareholdersRemoved || 0} removed
                </p>
              </div>
              <div className="divide-y divide-border-primary">
                {diffResult.shareholderDiffs.map((shareholder, idx) => (
                  <div key={idx} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        {shareholder.type === 'added' && (
                          <div className="w-8 h-8 rounded-full bg-status-success/10 flex items-center justify-center">
                            <UserPlus className="w-4 h-4 text-status-success" />
                          </div>
                        )}
                        {shareholder.type === 'updated' && (
                          <div className="w-8 h-8 rounded-full bg-status-info/10 flex items-center justify-center">
                            <UserCheck className="w-4 h-4 text-status-info" />
                          </div>
                        )}
                        {shareholder.type === 'removed' && (
                          <div className="w-8 h-8 rounded-full bg-status-error/10 flex items-center justify-center">
                            <UserMinus className="w-4 h-4 text-status-error" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-text-primary">{shareholder.name}</p>
                          <div className="flex items-center gap-2 text-sm text-text-secondary">
                            <span className="capitalize">{shareholder.shareholderType?.toLowerCase()}</span>
                            {shareholder.matchConfidence && (
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                shareholder.matchConfidence === 'high' ? 'bg-status-success/10 text-status-success' :
                                shareholder.matchConfidence === 'medium' ? 'bg-status-warning/10 text-status-warning' :
                                'bg-status-error/10 text-status-error'
                              }`}>
                                {shareholder.matchConfidence} match
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className={`text-xs font-medium px-2 py-1 rounded ${
                        shareholder.type === 'added' ? 'bg-status-success/10 text-status-success' :
                        shareholder.type === 'updated' ? 'bg-status-info/10 text-status-info' :
                        'bg-status-error/10 text-status-error'
                      }`}>
                        {shareholder.type === 'added' ? 'New' : shareholder.type === 'updated' ? 'Updated' : 'Removed'}
                      </span>
                    </div>

                    {/* Show shareholding changes */}
                    {shareholder.shareholdingChanges && (
                      <div className="mt-3 ml-11 space-y-2">
                        {shareholder.shareholdingChanges.shareClass && (
                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div className="text-text-secondary">Share Class</div>
                            <div className="text-status-error bg-status-error/5 px-2 py-1 rounded line-through">
                              {shareholder.shareholdingChanges.shareClass.old}
                            </div>
                            <div className="text-status-success bg-status-success/5 px-2 py-1 rounded">
                              {shareholder.shareholdingChanges.shareClass.new}
                            </div>
                          </div>
                        )}
                        {shareholder.shareholdingChanges.numberOfShares && (
                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div className="text-text-secondary">Number of Shares</div>
                            <div className="text-status-error bg-status-error/5 px-2 py-1 rounded line-through">
                              {shareholder.shareholdingChanges.numberOfShares.old.toLocaleString()}
                            </div>
                            <div className="text-status-success bg-status-success/5 px-2 py-1 rounded">
                              {shareholder.shareholdingChanges.numberOfShares.new.toLocaleString()}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Show general changes for updated shareholders */}
                    {shareholder.type === 'updated' && shareholder.changes && shareholder.changes.length > 0 && (
                      <div className="mt-3 ml-11 space-y-2">
                        {shareholder.changes.map((change, cIdx) => (
                          <div key={cIdx} className="grid grid-cols-3 gap-4 text-sm">
                            <div className="text-text-secondary">{change.label}</div>
                            <div className="text-status-error bg-status-error/5 px-2 py-1 rounded line-through">
                              {change.oldValue ?? <span className="text-text-muted italic">Not set</span>}
                            </div>
                            <div className="text-status-success bg-status-success/5 px-2 py-1 rounded">
                              {change.newValue ?? <span className="text-text-muted italic">Not set</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Show extracted data for new shareholders */}
                    {shareholder.type === 'added' && shareholder.extractedData && (
                      <div className="mt-3 ml-11 grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-text-muted">Shares:</span>{' '}
                          <span className="text-text-primary">{shareholder.extractedData.numberOfShares?.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-text-muted">Class:</span>{' '}
                          <span className="text-text-primary">{shareholder.extractedData.shareClass}</span>
                        </div>
                        {shareholder.extractedData.percentageHeld && (
                          <div>
                            <span className="text-text-muted">Percentage:</span>{' '}
                            <span className="text-text-primary">{shareholder.extractedData.percentageHeld}%</span>
                          </div>
                        )}
                        {shareholder.extractedData.isNominee ? (
                          <div>
                            <span className="text-text-muted">Nominee:</span>{' '}
                            <span className="text-text-primary">Yes</span>
                          </div>
                        ) : null}
                      </div>
                    )}
                    {shareholder.type === 'added' && sourceIndex(shareholder.sourceRecordId) >= 0
                      && shareholder.sourceRecordId && contactMatchPreviews[shareholder.sourceRecordId] && (
                      <div className="mt-3 ml-0 sm:ml-11">
                        <ContactMatchPanel
                          path={shareholder.sourceRecordId}
                          recordName={shareholder.name}
                          match={contactMatchPreviews[shareholder.sourceRecordId]!}
                          resolution={extractedData.shareholders?.[sourceIndex(shareholder.sourceRecordId)]?.contactResolution}
                          onChange={(decision) => setContactResolution('shareholders', sourceIndex(shareholder.sourceRecordId), decision)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <AIExtractionMetadata metadata={aiMetadata} />
              <button onClick={handleReset} className="btn-ghost btn-sm">
                Upload Different File
              </button>
            </div>
            <div className="flex items-center gap-3">
              <Link href={`/companies/${companyId}`} className="btn-secondary btn-sm" title="Cancel (Ctrl+Backspace)">
                <span className="hidden sm:inline">Cancel (Ctrl+Backspace)</span>
                <span className="sm:hidden">Cancel</span>
              </Link>
              {(() => {
                const companyChanges = diffResult.differences.length;
                const officerDiffCount = diffResult.officerDiffs?.length || 0;
                const shareholderDiffCount = diffResult.shareholderDiffs?.length || 0;
                const totalChanges = companyChanges + officerDiffCount + shareholderDiffCount;
                const hasAnyChanges = totalChanges > 0;

                return (
                  <button
                    onClick={() => { if (!isPreparingPlan) void handleApplyUpdate(); }}
                    className="btn-primary btn-sm flex items-center gap-2"
                    title="Review Proposed Changes (Ctrl+S)"
                  >
                    <CheckCircle className="w-4 h-4" />
                    {hasAnyChanges ? (
                      <>
                        <span className="hidden sm:inline">{`Review ${totalChanges} Change${totalChanges > 1 ? 's' : ''} (Ctrl+S)`}</span>
                        <span className="sm:hidden">Review proposed changes</span>
                      </>
                    ) : (
                      <>
                        <span className="hidden sm:inline">Review Document Approval (Ctrl+S)</span>
                        <span className="sm:hidden">Review document approval</span>
                      </>
                    )}
                  </button>
                  );
                })()}
              </div>
            </div>
              </div>
            </div>
          }
        />
      )}

      {/* Step: Saving */}
      {step === 'saving' && (
        <div className="card p-12 text-center">
          <Loader2 className="w-12 h-12 text-oak-primary mx-auto mb-4 animate-spin" />
          <h3 className="text-lg font-medium text-text-primary mb-2">
            {isUpdateMode ? 'Updating Company...' : 'Saving Data...'}
          </h3>
          <p className="text-text-secondary">
            {isUpdateMode
              ? 'Applying changes to company record.'
              : 'Creating company record and linking contacts.'}
          </p>
        </div>
      )}

      {/* Step: Complete */}
      {step === 'complete' && (
        <div className="card p-12 text-center">
          {/* Concurrent update warning */}
          {concurrentUpdateWarning && (
            <div className="mb-6 p-4 bg-status-warning/10 border border-status-warning/30 rounded-lg text-left">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-status-warning">Concurrent Update Detected</p>
                  <p className="text-sm text-text-secondary mt-1">{concurrentUpdateWarning}</p>
                </div>
              </div>
            </div>
          )}
          <CheckCircle className="w-12 h-12 text-status-success mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">
            {isUpdateMode ? 'Company Updated Successfully!' : 'Company Created Successfully!'}
          </h3>
          {sharePointSetupWarning && (
            <div className="mx-auto mb-5 max-w-xl rounded-lg border border-status-warning/30 bg-status-warning/10 p-4 text-left text-sm text-status-warning" role="alert">
              <p>{sharePointSetupWarning}</p>
              {companyId && <Link href={`/companies/${companyId}`} className="mt-2 inline-flex min-h-10 items-center text-oak-primary hover:underline">Open the company to repair its SharePoint mapping</Link>}
            </div>
          )}
          <div className="text-text-secondary mb-6 space-y-2">
            {isUpdateMode ? (
              <>
                {updatedFields.length > 0 && (
                  <p>Updated {updatedFields.length} field{updatedFields.length > 1 ? 's' : ''}: {updatedFields.join(', ')}</p>
                )}
                {officerChanges && (officerChanges.added > 0 || officerChanges.updated > 0 || officerChanges.ceased > 0 || officerChanges.followUp > 0) && (
                  <p className="flex items-center justify-center gap-2">
                    <Users className="w-4 h-4 text-oak-primary" />
                    Officers: {officerChanges.added > 0 && `${officerChanges.added} added`}
                    {officerChanges.updated > 0 && `${officerChanges.added > 0 ? ', ' : ''}${officerChanges.updated} updated`}
                    {officerChanges.ceased > 0 && `${(officerChanges.added > 0 || officerChanges.updated > 0) ? ', ' : ''}${officerChanges.ceased} ceased`}
                    {officerChanges.followUp > 0 && `${(officerChanges.added > 0 || officerChanges.updated > 0 || officerChanges.ceased > 0) ? ', ' : ''}${officerChanges.followUp} to follow up`}
                  </p>
                )}
                {shareholderChanges && (shareholderChanges.added > 0 || shareholderChanges.updated > 0 || shareholderChanges.removed > 0) && (
                  <p className="flex items-center justify-center gap-2">
                    <PieChart className="w-4 h-4 text-oak-primary" />
                    Shareholders: {shareholderChanges.added > 0 && `${shareholderChanges.added} added`}
                    {shareholderChanges.updated > 0 && `${shareholderChanges.added > 0 ? ', ' : ''}${shareholderChanges.updated} updated`}
                    {shareholderChanges.removed > 0 && `${(shareholderChanges.added > 0 || shareholderChanges.updated > 0) ? ', ' : ''}${shareholderChanges.removed} removed`}
                  </p>
                )}
                {updatedFields.length === 0 && !officerChanges && !shareholderChanges && (
                  <p>No changes were needed - company data was already up to date.</p>
                )}
              </>
            ) : (
              <p>The company and all related data have been saved.</p>
            )}
          </div>
          <div className="flex items-center justify-center gap-3">
            <button onClick={handleReset} className="btn-secondary btn-sm">
              Upload Another
            </button>
            {companyId && (
              <Link
                href={`/companies/${companyId}`}
                className="btn-primary btn-sm flex items-center gap-2"
              >
                <Building2 className="w-4 h-4" />
                View Company
              </Link>
            )}
          </div>
        </div>
      )}
      {/* Conflict: Company in recycle bin */}
      {conflictDialogOpen && conflict?.type === 'IN_RECYCLE_BIN' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background-primary border border-border-primary rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle className="w-5 h-5 text-status-warning mt-0.5 shrink-0" />
              <div>
                <h3 className="text-base font-semibold text-text-primary mb-1">
                  Company in Recycle Bin
                </h3>
                <p className="text-sm text-text-secondary">
                  <span className="font-medium">{conflict.companyName}</span>{' '}
                  ({conflict.uen}) is in the recycle bin. You must permanently delete it
                  before creating a new record. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleConflictCancel}
                disabled={conflictLoading}
                className="btn-secondary btn-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleConflictPermanentDelete}
                disabled={conflictLoading}
                className="btn-danger btn-sm flex items-center gap-2"
              >
                {conflictLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                Permanently Delete &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conflict: Company already exists (active) */}
      {conflictDialogOpen && conflict?.type === 'ALREADY_EXISTS' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background-primary border border-border-primary rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle className="w-5 h-5 text-status-warning mt-0.5 shrink-0" />
              <div>
                <h3 className="text-base font-semibold text-text-primary mb-1">
                  Company Already Exists
                </h3>
                <p className="text-sm text-text-secondary">
                  <span className="font-medium">{conflict.companyName}</span>{' '}
                  ({conflict.uen}) already exists. Would you like to update it instead?
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleConflictCancel}
                className="btn-secondary btn-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleConflictViewDiff}
                className="btn-primary btn-sm"
              >
                View Diff &amp; Update
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
