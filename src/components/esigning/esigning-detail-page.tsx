'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Copy,
  Trash2,
} from 'lucide-react';
import type {
  EsigningRecipientAccessMode,
  EsigningRecipientType,
} from '@/generated/prisma';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Alert } from '@/components/ui/alert';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { usePermissions } from '@/hooks/use-permissions';
import { useSession } from '@/hooks/use-auth';
import {
  useAddEsigningRecipient,
  useDeleteEsigningDocument,
  useDeleteEsigningEnvelope,
  useDuplicateEsigningEnvelope,
  useEsigningEnvelope,
  useEsigningRecipientManualLink,
  useReorderEsigningRecipients,
  useRemoveEsigningRecipient,
  useResendEsigningRecipient,
  useRetryEsigningEnvelopeProcessing,
  useSaveEsigningFields,
  useSendEsigningEnvelope,
  useUpdateEsigningDocument,
  useUpdateEsigningEnvelope,
  useUpdateEsigningRecipient,
  useUploadEsigningDocument,
  useVoidEsigningEnvelope,
} from '@/hooks/use-esigning';
import { attachGeneratedDocumentsRequest } from '@/hooks/use-esigning';
import type {
  EsigningFieldDefinitionInput,
  EsigningRecipientInput,
  UpdateEsigningRecipientInput,
} from '@/lib/validations/esigning';
import { ESIGNING_LIMITS } from '@/lib/validations/esigning';
import {
  ESIGNING_ACCESS_MODE_LABELS,
  ESIGNING_RECIPIENT_TYPE_LABELS,
} from '@/components/esigning/esigning-shared';
import type { EsigningEnvelopeDetailDto, EsigningManualLinkDto } from '@/types/esigning';
import { cn } from '@/lib/utils';
import { EsigningStepIndicator } from './prepare/esigning-step-indicator';
import { EsigningStepUpload } from './prepare/esigning-step-upload';
import { EsigningStepFields } from './prepare/esigning-step-fields';
import { EsigningStepReview } from './prepare/esigning-step-review';
import { EsigningEnvelopeDetailView } from './esigning-envelope-detail';
import type { PlacedField } from './prepare/esigning-field-canvas';
import {
  readTaskLaunchContext,
  withTaskLaunchContext,
} from '@/lib/task-launch-context';

interface Props {
  envelopeId: string;
}

interface RecipientForm {
  name: string;
  email: string;
  type: EsigningRecipientType;
  signingOrder: string;
  accessMode: EsigningRecipientAccessMode;
  accessCode: string;
}

const DEFAULT_RECIPIENT_FORM: RecipientForm = {
  name: '',
  email: '',
  type: 'SIGNER',
  signingOrder: '1',
  accessMode: 'MANUAL_LINK',
  accessCode: '',
};

function createFieldDraft(partial: Partial<PlacedField> = {}): PlacedField {
  return {
    localId: crypto.randomUUID(),
    documentId: '',
    recipientId: '',
    type: 'SIGNATURE',
    pageNumber: 1,
    xPercent: 0.1,
    yPercent: 0.1,
    widthPercent: 0.24,
    heightPercent: 0.08,
    required: true,
    label: null,
    placeholder: null,
    sortOrder: 0,
    ...partial,
  };
}

function parseOptionalInt(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

type WizardStep = 1 | 2 | 3;

type SendEnvelopeResult = {
  envelope: EsigningEnvelopeDetailDto;
  manualLinks: EsigningManualLinkDto[];
};

type PendingAutoSign = {
  signingUrl: string;
  specimen: string;
};

async function loadSavedSignatureSpecimen(): Promise<string | null> {
  try {
    const response = await fetch('/api/auth/signature-specimen', {
      credentials: 'same-origin',
    });
    if (!response.ok) {
      return null;
    }

    const result = (await response.json().catch(() => ({}))) as { dataUrl?: unknown };
    return typeof result.dataUrl === 'string' && result.dataUrl ? result.dataUrl : null;
  } catch {
    return null;
  }
}

export function EsigningDetailPage({ envelopeId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskContext = useMemo(
    () => readTaskLaunchContext(searchParams),
    [searchParams],
  );
  const returnHref = taskContext?.returnTo ?? '/esigning';
  const toast = useToast();
  const { can } = usePermissions();
  const sessionQuery = useSession();
  const envelopeQuery = useEsigningEnvelope(envelopeId);
  const envelope = envelopeQuery.data;

  // Mutations
  const updateEnvelope = useUpdateEsigningEnvelope(envelopeId);
  const uploadDocument = useUploadEsigningDocument(envelopeId);
  const updateDocument = useUpdateEsigningDocument(envelopeId);
  const [isAttachingGeneratedDocuments, setIsAttachingGeneratedDocuments] = useState(false);
  const attachGeneratedDocuments = {
    isPending: isAttachingGeneratedDocuments,
    mutateAsync: async (documentIds: string[]) => {
      setIsAttachingGeneratedDocuments(true);
      try {
        const result = await attachGeneratedDocumentsRequest(envelopeId, documentIds);
        await envelopeQuery.refetch();
        return result;
      } finally {
        setIsAttachingGeneratedDocuments(false);
      }
    },
  };
  const saveFields = useSaveEsigningFields(envelopeId);
  const sendEnvelope = useSendEsigningEnvelope(envelopeId);
  const voidEnvelope = useVoidEsigningEnvelope(envelopeId);
  const retryProcessing = useRetryEsigningEnvelopeProcessing(envelopeId);
  const deleteEnvelope = useDeleteEsigningEnvelope();
  const duplicateEnvelope = useDuplicateEsigningEnvelope();
  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const wizardContentRef = useRef<HTMLDivElement>(null);
  const [manualLinks, setManualLinks] = useState<EsigningManualLinkDto[]>([]);

  // Modal state
  const [isRecipientModalOpen, setIsRecipientModalOpen] = useState(false);
  const [recipientForm, setRecipientForm] = useState<RecipientForm>(DEFAULT_RECIPIENT_FORM);
  const [editingRecipientId, setEditingRecipientId] = useState<string | null>(null);
  const [recipientActionId, setRecipientActionId] = useState<string | null>(null);
  const [documentActionId, setDocumentActionId] = useState<string | null>(null);
  const [isDeleteRecipientOpen, setIsDeleteRecipientOpen] = useState(false);
  const [isDeleteDocumentOpen, setIsDeleteDocumentOpen] = useState(false);
  const [isDeleteEnvelopeOpen, setIsDeleteEnvelopeOpen] = useState(false);
  const [isVoidOpen, setIsVoidOpen] = useState(false);
  const [isLinksModalOpen, setIsLinksModalOpen] = useState(false);
  const [includeSignerNameInCopiedLinks, setIncludeSignerNameInCopiedLinks] = useState(true);
  const [pendingAutoSign, setPendingAutoSign] = useState<PendingAutoSign | null>(null);
  const [isAutoSignPromptOpen, setIsAutoSignPromptOpen] = useState(false);

  // Field drafts
  const [fieldDrafts, setFieldDrafts] = useState<PlacedField[]>([]);
  const [hasUnsavedFieldDrafts, setHasUnsavedFieldDrafts] = useState(false);
  const [fieldUndoStack, setFieldUndoStack] = useState<PlacedField[][]>([]);
  const [fieldRedoStack, setFieldRedoStack] = useState<PlacedField[][]>([]);
  const fieldDraftsRef = useRef<PlacedField[]>([]);
  const lastSyncedEnvelopeIdRef = useRef<string | null>(null);

  const goToDraftStep = useCallback((step: WizardStep) => {
    setCurrentStep(step);
    requestAnimationFrame(() => {
      wizardContentRef.current?.scrollTo({ top: 0, left: 0 });
      window.scrollTo({ top: 0, left: 0 });
      document.getElementById(`esigning-step-${step}-heading`)?.focus();
    });
  }, []);

  // Recipient hooks (keyed by action IDs)
  const addRecipient = useAddEsigningRecipient(envelopeId);
  const reorderRecipients = useReorderEsigningRecipients(envelopeId);
  const updateRecipient = useUpdateEsigningRecipient(envelopeId, editingRecipientId ?? '');
  const removeRecipient = useRemoveEsigningRecipient(envelopeId, recipientActionId ?? '');
  const resendRecipient = useResendEsigningRecipient(envelopeId, recipientActionId ?? '');
  const recipientManualLink = useEsigningRecipientManualLink(envelopeId, recipientActionId ?? '');
  const deleteDocument = useDeleteEsigningDocument(envelopeId, documentActionId ?? '');

  // Derived
  const signerRecipients = useMemo(
    () => (envelope?.recipients ?? []).filter((r) => r.type === 'SIGNER'),
    [envelope?.recipients]
  );
  const signerFieldSummary = useMemo(
    () =>
      new Map(
        signerRecipients.map((recipient) => {
          const recipientFields = fieldDrafts.filter((field) => field.recipientId === recipient.id);
          return [
            recipient.id,
            {
              totalCount: recipientFields.length,
              signatureCount: recipientFields.filter(
                (field) => field.type === 'SIGNATURE' || field.type === 'INITIALS'
              ).length,
            },
          ];
        })
      ),
    [fieldDrafts, signerRecipients]
  );

  const canProceedToStep2 = (envelope?.documents.length ?? 0) >= 1 && signerRecipients.length >= 1;
  const canProceedToStep3 =
    canProceedToStep2 &&
    signerRecipients.every((recipient) => {
      const summary = signerFieldSummary.get(recipient.id);
      return Boolean(summary && summary.totalCount > 0 && summary.signatureCount > 0);
    });
  // Initialize field drafts from envelope
  useEffect(() => {
    if (!envelope) return;
    const isDifferentEnvelope = lastSyncedEnvelopeIdRef.current !== envelope.id;
    if (hasUnsavedFieldDrafts && !isDifferentEnvelope) {
      return;
    }
    const syncedFieldDrafts = envelope.fields.map((field) =>
      createFieldDraft({
        ...field,
        localId: field.id,
        label: field.label ?? null,
        placeholder: field.placeholder ?? null,
      })
    );
    setFieldDrafts(syncedFieldDrafts);
    fieldDraftsRef.current = syncedFieldDrafts;
    setHasUnsavedFieldDrafts(false);
    setFieldUndoStack([]);
    setFieldRedoStack([]);
    lastSyncedEnvelopeIdRef.current = envelope.id;
  }, [envelope, hasUnsavedFieldDrafts]);

  useEffect(() => {
    fieldDraftsRef.current = fieldDrafts;
  }, [fieldDrafts]);

  const updateFieldDrafts = useCallback((nextFields: PlacedField[], options?: {
    recordHistory?: boolean;
    historySnapshot?: PlacedField[];
  }) => {
    if (options?.recordHistory !== false) {
      const historySnapshot = options?.historySnapshot ?? fieldDraftsRef.current;
      setFieldUndoStack((current) => [...current.slice(-49), historySnapshot]);
      setFieldRedoStack([]);
    }
    setFieldDrafts(nextFields);
    fieldDraftsRef.current = nextFields;
    setHasUnsavedFieldDrafts(true);
  }, []);

  const undoFieldDrafts = useCallback(() => {
    setFieldUndoStack((current) => {
      const previous = current[current.length - 1];
      if (!previous) {
        return current;
      }

      setFieldRedoStack((redoCurrent) => [fieldDraftsRef.current, ...redoCurrent].slice(0, 50));
      setFieldDrafts(previous);
      fieldDraftsRef.current = previous;
      setHasUnsavedFieldDrafts(true);
      return current.slice(0, -1);
    });
  }, []);

  const redoFieldDrafts = useCallback(() => {
    setFieldRedoStack((current) => {
      const [next, ...rest] = current;
      if (!next) {
        return current;
      }

      setFieldUndoStack((undoCurrent) => [...undoCurrent.slice(-49), fieldDraftsRef.current]);
      setFieldDrafts(next);
      fieldDraftsRef.current = next;
      setHasUnsavedFieldDrafts(true);
      return rest;
    });
  }, []);

  const buildFieldDefinitionPayload = useCallback(
    () =>
      fieldDrafts.map(
        (field): EsigningFieldDefinitionInput => ({
          id: field.localId,
          documentId: field.documentId,
          recipientId: field.recipientId,
          type: field.type,
          pageNumber: field.pageNumber,
          xPercent: field.xPercent,
          yPercent: field.yPercent,
          widthPercent: field.widthPercent,
          heightPercent: field.heightPercent,
          required: field.required,
          label: field.label || null,
          placeholder: field.placeholder || null,
          sortOrder: field.sortOrder,
        })
      ),
    [fieldDrafts]
  );

  // Handlers
  function openEditRecipient(recipientId: string) {
    const recipient = envelope?.recipients.find((r) => r.id === recipientId);
    if (!recipient) return;
    setEditingRecipientId(recipientId);
    setRecipientForm({
      name: recipient.name,
      email: recipient.email ?? '',
      type: recipient.type,
      signingOrder: recipient.signingOrder?.toString() ?? '',
      accessMode: recipient.type === 'CC' ? 'EMAIL_LINK' : recipient.accessMode,
      accessCode: '',
    });
    setIsRecipientModalOpen(true);
  }

  async function saveRecipient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const signingOrderValue = envelope?.signingOrder ?? 'PARALLEL';
      if (editingRecipientId) {
        const payload: UpdateEsigningRecipientInput = {
          name: recipientForm.name.trim(),
          email: recipientForm.email.trim() || null,
          ...(envelope?.status === 'DRAFT' ? {
            type: recipientForm.type,
            signingOrder:
              recipientForm.type === 'CC' || signingOrderValue === 'PARALLEL'
                ? null
                : parseOptionalInt(recipientForm.signingOrder),
            accessMode: recipientForm.accessMode,
            accessCode: recipientForm.accessCode.trim() || undefined,
          } : {}),
        };
        const result = await updateRecipient.mutateAsync(payload);
        if (result.manualLinks.length > 0) {
          setManualLinks(result.manualLinks);
          setIsLinksModalOpen(true);
        }
      } else {
        const payload: EsigningRecipientInput = {
          name: recipientForm.name.trim(),
          email: recipientForm.email.trim() || null,
          type: recipientForm.type,
          signingOrder:
            recipientForm.type === 'CC' || signingOrderValue === 'PARALLEL'
              ? null
              : parseOptionalInt(recipientForm.signingOrder),
          accessMode: recipientForm.accessMode,
          accessCode: recipientForm.accessCode.trim() || undefined,
        };
        await addRecipient.mutateAsync(payload);
      }
      setIsRecipientModalOpen(false);
      toast.success(
        editingRecipientId
          ? envelope?.status === 'DRAFT'
            ? 'Recipient saved'
            : 'Recipient corrected'
          : 'Recipient saved'
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save recipient');
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      for (const file of Array.from(files)) {
        await uploadDocument.mutateAsync(file);
      }
      toast.success('Documents uploaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload documents');
    }
  }

  async function persistFields(options?: { silent?: boolean }) {
    if (!hasUnsavedFieldDrafts) {
      if (!options?.silent) {
        toast.success('Field layout is already up to date');
      }
      return;
    }

    try {
      await saveFields.mutateAsync(buildFieldDefinitionPayload());
      setHasUnsavedFieldDrafts(false);
      if (!options?.silent) {
        toast.success('Field layout saved');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save fields');
      throw error;
    }
  }

  async function handleDeleteEnvelope() {
    try {
      await deleteEnvelope.mutateAsync(envelopeId);
      toast.success(
        envelope?.status === 'COMPLETED' ? 'Envelope permanently deleted' : 'Draft deleted'
      );
      setIsDeleteEnvelopeOpen(false);
      router.push(returnHref);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : envelope?.status === 'COMPLETED'
            ? 'Failed to delete envelope'
            : 'Failed to delete draft'
      );
    }
  }

  async function handleDuplicateEnvelope() {
    try {
      const duplicated = await duplicateEnvelope.mutateAsync(envelopeId);
      toast.success('Envelope duplicated');
      router.push(withTaskLaunchContext(`/esigning/${duplicated.id}`, taskContext));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to duplicate envelope');
    }
  }

  async function handleEnvelopeSent(result: SendEnvelopeResult) {
    setManualLinks(result.manualLinks);

    const currentUserEmail = sessionQuery.data?.email.trim().toLowerCase();
    const selfSigner = result.envelope.recipients.find(
      (recipient) =>
        recipient.type === 'SIGNER' &&
        currentUserEmail &&
        recipient.email?.trim().toLowerCase() === currentUserEmail
    );
    const selfSigningLink = selfSigner
      ? result.manualLinks.find((link) => link.recipientId === selfSigner.id)
      : null;

    if (selfSigningLink) {
      const specimen = await loadSavedSignatureSpecimen();
      if (specimen) {
        setPendingAutoSign({ signingUrl: selfSigningLink.signingUrl, specimen });
        setIsAutoSignPromptOpen(true);
        return;
      }
    }

    if (result.manualLinks.length > 0) {
      setIsLinksModalOpen(true);
    }
  }

  function closeAutoSignPrompt() {
    setIsAutoSignPromptOpen(false);
    setPendingAutoSign(null);
    if (manualLinks.length > 0) {
      setIsLinksModalOpen(true);
    }
  }

  function confirmAutoSign() {
    const signingUrl = pendingAutoSign?.signingUrl;
    if (!signingUrl) {
      closeAutoSignPrompt();
      return;
    }

    const autoSignUrl = new URL(signingUrl, window.location.origin);
    autoSignUrl.searchParams.set('autoSign', '1');
    setIsAutoSignPromptOpen(false);
    setPendingAutoSign(null);
    window.open(autoSignUrl.toString(), '_blank', 'noopener,noreferrer');
  }

  function openEnvelopeDownload(variant: 'documents' | 'documents_with_certificates' | 'certificates') {
    if (!envelope) {
      return;
    }

    const query = new URLSearchParams({
      variant,
      tenantId: envelope.tenantId,
    });
    window.open(
      `/api/esigning/envelopes/${envelopeId}/download?${query.toString()}`,
      '_blank',
      'noreferrer'
    );
  }

  function openDocumentDownload(
    document: EsigningEnvelopeDetailDto['documents'][number],
    variant: 'original' | 'signed' | 'signed_with_certificate'
  ) {
    const sourceUrl = variant === 'original' ? document.pdfUrl : document.signedPdfUrl;
    if (!sourceUrl) {
      return;
    }

    const url = new URL(sourceUrl, window.location.origin);
    url.searchParams.set('download', 'true');
    if (variant === 'signed_with_certificate') {
      url.searchParams.set('includeCertificate', 'true');
    }

    window.open(`${url.pathname}${url.search}`, '_blank', 'noreferrer');
  }

  // ——— Early returns ———
  if (!can.readEsigning) {
    return (
      <div className="p-6">
        <Alert variant="error" title="Access denied">
          You do not have permission to access this envelope.
        </Alert>
      </div>
    );
  }

  if (envelopeQuery.isLoading) {
    return (
      <div className="p-6">
        <div className="rounded-3xl border border-dashed border-border-primary bg-background-secondary p-10 text-center text-sm text-text-secondary">
          Loading e-signing envelope…
        </div>
      </div>
    );
  }

  if (envelopeQuery.error || !envelope) {
    return (
      <div className="p-6">
        <Alert variant="error" title="Unable to load envelope">
          {envelopeQuery.error instanceof Error
            ? envelopeQuery.error.message
            : 'Envelope not found'}
        </Alert>
      </div>
    );
  }

  // ——— Recipient modal (shared between DRAFT wizard and read-only view) ———
  const recipientRequiresEmail = recipientForm.type === 'CC' || recipientForm.accessMode !== 'MANUAL_LINK';
  const recipientModal = (
    <Modal
      isOpen={isRecipientModalOpen}
      onClose={() => setIsRecipientModalOpen(false)}
      title={
        editingRecipientId
          ? envelope.status === 'DRAFT'
            ? 'Edit recipient'
            : 'Correct recipient'
          : 'Add recipient'
      }
      size="xl"
    >
      <form onSubmit={saveRecipient}>
        <ModalBody className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FormInput
              label="Name"
              value={recipientForm.name}
              onChange={(e) => setRecipientForm((prev) => ({ ...prev, name: e.target.value }))}
              required
            />
            <FormInput
              label={recipientRequiresEmail ? 'Email' : 'Email (optional)'}
              type="email"
              value={recipientForm.email}
              onChange={(e) => setRecipientForm((prev) => ({ ...prev, email: e.target.value }))}
              required={recipientRequiresEmail}
            />
          </div>
          {envelope.status === 'DRAFT' ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-xs font-medium text-text-secondary">
                  <span>Role</span>
                  <select
                    value={recipientForm.type}
                    onChange={(e) => {
                      const nextType = e.target.value as EsigningRecipientType;
                      setRecipientForm((prev) => ({
                        ...prev,
                        type: nextType,
                        accessMode:
                          nextType === 'CC'
                            ? 'EMAIL_LINK'
                            : prev.type === 'CC'
                              ? 'MANUAL_LINK'
                              : prev.accessMode,
                        accessCode: nextType === 'CC' ? '' : prev.accessCode,
                      }));
                    }}
                    className="h-8 rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary"
                  >
                    {Object.entries(ESIGNING_RECIPIENT_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-2 text-xs font-medium text-text-secondary">
                  <span>Access mode</span>
                  <select
                    value={recipientForm.accessMode}
                    onChange={(e) =>
                      setRecipientForm((prev) => ({
                        ...prev,
                        accessMode: e.target.value as EsigningRecipientAccessMode,
                      }))
                    }
                    disabled={recipientForm.type === 'CC'}
                    className="h-8 rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary"
                  >
                    {Object.entries(ESIGNING_ACCESS_MODE_LABELS)
                      .filter(([value]) => recipientForm.type !== 'CC' || value === 'EMAIL_LINK')
                      .map(([value, label]) => (
                        <option key={value} value={value}>
                          {recipientForm.type === 'CC' && value === 'EMAIL_LINK' ? 'Email' : label}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {recipientForm.type === 'SIGNER' && envelope.signingOrder !== 'PARALLEL' && (
                <FormInput
                  label={envelope.signingOrder === 'MIXED' ? 'Signing group' : 'Signing sequence'}
                  type="number"
                  min={1}
                  max={ESIGNING_LIMITS.MAX_RECIPIENTS}
                  value={recipientForm.signingOrder}
                  onChange={(e) =>
                    setRecipientForm((prev) => ({ ...prev, signingOrder: e.target.value }))
                  }
                  hint={
                    envelope.signingOrder === 'MIXED'
                      ? 'Recipients in the same group sign in parallel.'
                      : undefined
                  }
                />
              )}
              {recipientForm.accessMode === 'EMAIL_WITH_CODE' && (
                <FormInput
                  label="Access code"
                  value={recipientForm.accessCode}
                  onChange={(e) =>
                    setRecipientForm((prev) => ({ ...prev, accessCode: e.target.value }))
                  }
                  hint="Minimum 4 characters."
                  required
                />
              )}
            </>
          ) : (
            <Alert variant="info">
              After sending, you can correct only the recipient&apos;s name and email. Oakcloud will keep the routing and access settings unchanged.
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsRecipientModalOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" isLoading={addRecipient.isPending || updateRecipient.isPending}>
            {editingRecipientId
              ? envelope.status === 'DRAFT'
                ? 'Save recipient'
                : 'Save correction'
              : 'Save recipient'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );

  function formatManualLinkForClipboard(link: EsigningManualLinkDto): string {
    return includeSignerNameInCopiedLinks
      ? `${link.recipientName}: ${link.signingUrl}`
      : link.signingUrl;
  }

  const linksModal = (
    <Modal
      isOpen={isLinksModalOpen}
      onClose={() => setIsLinksModalOpen(false)}
      title="Manual signing links"
      size="2xl"
    >
      <ModalBody className="min-w-0 space-y-3">
        {manualLinks.map((link) => (
          <div key={link.recipientId} className="min-w-0 rounded-2xl border border-border-primary bg-background-primary p-4">
            <div className="text-sm font-semibold text-text-primary">{link.recipientName}</div>
            <div className="mt-1 text-xs text-text-secondary">{link.recipientEmail || 'No email — manual link only'}</div>
            <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <a
                href={link.signingUrl}
                target="_blank"
                rel="noreferrer"
                title={link.signingUrl}
                className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-border-primary bg-background-secondary px-3 py-2 text-xs text-text-secondary"
              >
                {link.signingUrl}
              </a>
              <Button
                variant="secondary"
                size="xs"
                leftIcon={<Copy className="h-3.5 w-3.5" />}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(formatManualLinkForClipboard(link))
                    .then(() => toast.success('Manual link copied'))
                    .catch(() => toast.error('Clipboard access failed'))
                }
              >
                Copy
              </Button>
            </div>
          </div>
        ))}
      </ModalBody>
      <ModalFooter className="justify-between">
        <Toggle
          size="sm"
          label="Include signer's name"
          checked={includeSignerNameInCopiedLinks}
          onChange={setIncludeSignerNameInCopiedLinks}
        />
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            leftIcon={<Copy className="h-4 w-4" />}
            onClick={() =>
              void navigator.clipboard
                .writeText(manualLinks.map(formatManualLinkForClipboard).join('\n'))
                .then(() => toast.success('All manual links copied'))
                .catch(() => toast.error('Clipboard access failed'))
            }
            disabled={manualLinks.length === 0}
          >
            Copy All
          </Button>
          <Button onClick={() => setIsLinksModalOpen(false)}>Done</Button>
        </div>
      </ModalFooter>
    </Modal>
  );

  const confirmDialogs = (
    <>
      <ConfirmDialog
        isOpen={isAutoSignPromptOpen}
        onClose={closeAutoSignPrompt}
        onConfirm={confirmAutoSign}
        title="Auto-sign your portion?"
        description="A saved signature specimen is available for your signer account. Apply it to your assigned fields and complete your portion of the envelope?"
        confirmLabel="Auto-sign"
        cancelLabel="Not now"
        variant="info"
      >
        {pendingAutoSign?.specimen ? (
          <div className="flex min-h-24 items-center justify-center rounded-lg border border-border-primary bg-background-tertiary p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pendingAutoSign.specimen}
              alt="Saved signature specimen"
              className="max-h-20 max-w-full object-contain"
            />
          </div>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={isDeleteRecipientOpen}
        onClose={() => setIsDeleteRecipientOpen(false)}
        onConfirm={async () => {
          try {
            await removeRecipient.mutateAsync();
            toast.success('Recipient removed');
            setIsDeleteRecipientOpen(false);
            setRecipientActionId(null);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to remove recipient');
          }
        }}
        title="Remove recipient?"
        confirmLabel="Remove recipient"
        isLoading={removeRecipient.isPending}
      />
      <ConfirmDialog
        isOpen={isDeleteDocumentOpen}
        onClose={() => setIsDeleteDocumentOpen(false)}
        onConfirm={async () => {
          try {
            await deleteDocument.mutateAsync();
            toast.success('Document removed');
            setIsDeleteDocumentOpen(false);
            setDocumentActionId(null);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to remove document');
          }
        }}
        title="Remove document?"
        confirmLabel="Remove document"
        isLoading={deleteDocument.isPending}
      />
      <ConfirmDialog
        isOpen={isDeleteEnvelopeOpen}
        onClose={() => setIsDeleteEnvelopeOpen(false)}
        onConfirm={handleDeleteEnvelope}
        title={envelope?.status === 'COMPLETED' ? 'Delete completed envelope?' : 'Delete draft envelope?'}
        description={
          envelope?.status === 'COMPLETED'
            ? 'This permanently removes the completed envelope, its signed documents, certificates, and download access.'
            : 'This permanently removes the draft envelope and its uploaded source files.'
        }
        confirmLabel={envelope?.status === 'COMPLETED' ? 'Delete envelope' : 'Delete draft'}
        isLoading={deleteEnvelope.isPending}
      />
      <ConfirmDialog
        isOpen={isVoidOpen}
        onClose={() => setIsVoidOpen(false)}
        onConfirm={async (reason) => {
          try {
            await voidEnvelope.mutateAsync(reason ?? null);
            toast.success('Envelope voided');
            setIsVoidOpen(false);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to void envelope');
          }
        }}
        title="Void envelope?"
        description="Signers lose access immediately."
        confirmLabel="Void envelope"
        requireReason
        reasonLabel="Void reason"
        reasonPlaceholder="Explain why the envelope is being voided"
        reasonMinLength={3}
        isLoading={voidEnvelope.isPending}
      />
    </>
  );

  // ——— DRAFT: 3-step wizard ———
  if (envelope.status === 'DRAFT') {
    return (
      <div
        className={cn(
          'flex flex-col bg-background-primary',
          currentStep === 2 || currentStep === 3
            ? 'h-[calc(100dvh-3rem)] overflow-hidden md:h-dvh'
            : 'min-h-screen'
        )}
      >
        {/* Header */}
        <div className="border-b border-border-primary bg-background-secondary px-3 py-3 flex-shrink-0 sm:px-6 sm:py-3">
          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              href={returnHref}
              aria-label="Back to envelopes"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border-primary px-2.5 py-1.5 text-sm text-text-secondary hover:bg-background-tertiary sm:gap-2 sm:px-3"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back</span>
            </Link>
            <div className="flex-1 min-w-0 overflow-x-auto">
              <EsigningStepIndicator
                currentStep={currentStep}
                canProceedToStep2={canProceedToStep2}
                canProceedToStep3={canProceedToStep3}
                onStepClick={goToDraftStep}
              />
            </div>
            {/* Mobile-only spacer mirrors the back-button width so the indicator is visually centered. */}
            <div aria-hidden className="h-9 w-9 shrink-0 sm:hidden" />
            <div className="hidden items-center gap-2 sm:flex">
              {envelope.canDelete ? (
                <Button
                  variant="danger"
                  size="sm"
                  leftIcon={<Trash2 className="h-4 w-4" />}
                  onClick={() => setIsDeleteEnvelopeOpen(true)}
                >
                  Delete draft
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Step content */}
        <div
          ref={wizardContentRef}
          data-wizard-main="true"
          className={currentStep === 2 || currentStep === 3
            ? 'flex flex-1 min-h-0 flex-col overflow-hidden'
            : 'flex-1 overflow-auto'}
        >
          {currentStep === 1 && (
            <>
              <h1
                id="esigning-step-1-heading"
                tabIndex={-1}
                className="px-4 pt-4 text-xl font-semibold text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30 sm:px-6 sm:pt-6"
              >
                Upload documents
              </h1>
              <EsigningStepUpload
                envelope={envelope}
                currentUser={sessionQuery.data ? {
                  firstName: sessionQuery.data.firstName,
                  lastName: sessionQuery.data.lastName,
                  email: sessionQuery.data.email,
                } : null}
                onUpdateSettings={async (settings) => {
                  await updateEnvelope.mutateAsync(settings);
                }}
                isUpdating={updateEnvelope.isPending}
                onUploadDocuments={async (files) => { await uploadFiles(files); }}
                isUploading={uploadDocument.isPending}
                onReorderDocument={async (documentId, sortOrder) => {
                  await updateDocument.mutateAsync({ documentId, sortOrder });
                }}
                onToggleDocumentVisibility={async (documentId, visibility) => {
                  await updateDocument.mutateAsync({ documentId, visibility });
                }}
                onRenameDocument={async (documentId, fileName) => {
                  await updateDocument.mutateAsync({ documentId, fileName });
                }}
                isUpdatingDocument={updateDocument.isPending}
                onAttachGeneratedDocuments={async (documentIds) => {
                  await attachGeneratedDocuments.mutateAsync(documentIds);
                }}
                isAttachingGeneratedDocuments={attachGeneratedDocuments.isPending}
                onDeleteDocument={(docId) => {
                  setDocumentActionId(docId);
                  setIsDeleteDocumentOpen(true);
                }}
                onAddRecipient={async (data) => {
                  await addRecipient.mutateAsync(data);
                  toast.success('Recipient added');
                }}
                onReorderRecipients={async (payload) => {
                  await reorderRecipients.mutateAsync(payload);
                }}
                isReorderingRecipients={reorderRecipients.isPending}
                onEditRecipient={openEditRecipient}
                onRemoveRecipient={(id) => {
                  setRecipientActionId(id);
                  setIsDeleteRecipientOpen(true);
                }}
                onNext={() => goToDraftStep(2)}
                onBack={() => router.push(returnHref)}
              />
            </>
          )}
          {currentStep === 2 && (
            <>
              <h1
                id="esigning-step-2-heading"
                tabIndex={-1}
                className="sr-only"
              >
                Place fields
              </h1>
              <EsigningStepFields
                envelope={envelope}
                fields={fieldDrafts}
                onFieldsChange={updateFieldDrafts}
                onSaveFields={persistFields}
                isSaving={saveFields.isPending}
                canUndo={fieldUndoStack.length > 0}
                canRedo={fieldRedoStack.length > 0}
                onUndo={undoFieldDrafts}
                onRedo={redoFieldDrafts}
                onNext={() => goToDraftStep(3)}
                onBack={() => goToDraftStep(1)}
                canEdit={envelope.canEdit && can.updateEsigning}
              />
            </>
          )}
          {currentStep === 3 && (
            <>
              <h1
                id="esigning-step-3-heading"
                tabIndex={-1}
                className="px-4 pt-4 text-xl font-semibold text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30 sm:px-6 sm:pt-6"
              >
                Review and send
              </h1>
              <EsigningStepReview
                envelope={envelope}
                fields={fieldDrafts}
                onSend={async () => {
                  try {
                    await persistFields({ silent: true });
                    const result = await sendEnvelope.mutateAsync(taskContext);
                    await handleEnvelopeSent(result);
                    toast.success('Envelope sent');
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Failed to send envelope');
                  }
                }}
                isSending={sendEnvelope.isPending}
                onBack={() => goToDraftStep(2)}
                manualLinks={manualLinks}
              />
            </>
          )}
        </div>

        {/* Modals */}
        {recipientModal}
        {linksModal}
        {confirmDialogs}
      </div>
    );
  }

  // ——— Shared non-draft envelope detail ———
  return (
    <>
      <EsigningEnvelopeDetailView
        envelope={envelope}
        returnHref={returnHref}
        canCreateEsigning={can.createEsigning}
        canUpdateEsigning={can.updateEsigning}
        isDuplicating={duplicateEnvelope.isPending}
        isSending={sendEnvelope.isPending}
        recipientActionId={recipientActionId}
        isCopyingRecipientLink={recipientManualLink.isPending}
        isResendingRecipient={resendRecipient.isPending}
        onSend={() => {
          void (async () => {
            try {
              const result = await sendEnvelope.mutateAsync(taskContext);
              await handleEnvelopeSent(result);
              toast.success('Envelope sent');
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : 'Failed to send envelope'
              );
            }
          })();
        }}
        onVoid={() => setIsVoidOpen(true)}
        onDuplicate={() => void handleDuplicateEnvelope()}
        onDelete={() => setIsDeleteEnvelopeOpen(true)}
        onRetryProcessing={() => {
          void (async () => {
            try {
              await retryProcessing.mutateAsync();
              toast.success(
                envelope.pdfGenerationStatus === 'FAILED'
                  ? 'Processing retried'
                  : 'Processing resumed'
              );
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : 'Failed to retry processing'
              );
            }
          })();
        }}
        onEditRecipient={(recipientId) => openEditRecipient(recipientId)}
        onRemoveRecipient={(recipientId) => {
          setRecipientActionId(recipientId);
          setIsDeleteRecipientOpen(true);
        }}
        onCopyRecipientLink={(recipientId) => {
          void (async () => {
            setRecipientActionId(recipientId);
            try {
              const link = await recipientManualLink.mutateAsync();
              await navigator.clipboard.writeText(link.signingUrl);
              toast.success('Signer link copied');
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : 'Failed to copy signer link'
              );
            } finally {
              setRecipientActionId(null);
            }
          })();
        }}
        onResendRecipient={(recipientId) => {
          void (async () => {
            setRecipientActionId(recipientId);
            try {
              const result = await resendRecipient.mutateAsync();
              if (result.manualLinks.length > 0) {
                setManualLinks(result.manualLinks);
                setIsLinksModalOpen(true);
              }
              toast.success('Recipient resent');
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : 'Failed to resend recipient'
              );
            } finally {
              setRecipientActionId(null);
            }
          })();
        }}
        onEnvelopeDownload={openEnvelopeDownload}
        onDocumentDownload={openDocumentDownload}
      />
      {recipientModal}
      {linksModal}
      {confirmDialogs}
    </>
  );
}
