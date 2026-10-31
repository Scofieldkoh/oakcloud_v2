'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { AlertCircle, Ban, Loader2, Shield } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormInput } from '@/components/ui/form-input';
import { useToast } from '@/components/ui/toast';
import { useIsMobile } from '@/hooks/use-media-query';
import { DocumentPageViewer } from '@/components/processing/document-page-viewer';
import type { BoundingBox } from '@/components/processing/document-page-viewer';
import type {
  EsigningFieldDefinitionDto,
  EsigningFieldValueDto,
  EsigningSignedSignatureDto,
  EsigningSigningSessionDto,
  EsigningSigningSessionStatusDto,
} from '@/types/esigning';
import { EsigningConsentScreen } from '@/components/esigning/signing/esigning-consent-screen';
import { EsigningFieldInputModal } from '@/components/esigning/signing/esigning-field-input-modal';
import { EsigningSigningHeader } from '@/components/esigning/signing/esigning-signing-header';
import { EsigningFieldOverlay } from '@/components/esigning/signing/esigning-field-overlay';
import { EsigningPostItTab } from '@/components/esigning/signing/esigning-post-it-tab';
import { EsigningSignatureProgressHint } from '@/components/esigning/signing/esigning-signature-progress-hint';
import { EsigningSignatureModal } from '@/components/esigning/signing/esigning-signature-modal';
import { EsigningCompletionScreen } from '@/components/esigning/signing/esigning-completion-screen';
import { EsigningDeclineModal } from '@/components/esigning/signing/esigning-decline-modal';

// =============================================================================
// Types
// =============================================================================

type SigningFlowState = 'loading' | 'requires-code' | 'consent' | 'signing' | 'completed' | 'declined' | 'error';
type SigningErrorKind = 'general' | 'network' | 'cancelled' | 'expired' | 'session-expired';

interface ExchangeResult {
  requiresAccessCode: boolean;
  envelopeId: string;
  recipientId: string;
  envelopeTitle: string;
  recipientName: string;
}

interface DraftValue {
  fieldDefinitionId: string;
  value?: string | null;
  signatureDataUrl?: string | null;
  signaturePreviewUrl?: string | null;
  locallyEdited?: boolean;
}

const PNG_DATA_URL_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const EMPTY_SIGNED_SIGNATURES: EsigningSignedSignatureDto[] = [];

interface SigningErrorState {
  kind: SigningErrorKind;
  message: string;
}

// =============================================================================
// Helpers
// =============================================================================

function buildDraftState(fieldValues: EsigningFieldValueDto[]): Record<string, DraftValue> {
  return Object.fromEntries(
    fieldValues.map((fieldValue) => [
      fieldValue.fieldDefinitionId,
      {
        fieldDefinitionId: fieldValue.fieldDefinitionId,
        value: fieldValue.value,
        signatureDataUrl: null,
        signaturePreviewUrl: fieldValue.signaturePreviewUrl ?? null,
        locallyEdited: false,
      },
    ])
  );
}

function mergeDraftState(
  currentDraftValues: Record<string, DraftValue>,
  serverFieldValues: EsigningFieldValueDto[]
): Record<string, DraftValue> {
  const serverDraftValues = buildDraftState(serverFieldValues);
  const fieldDefinitionIds = new Set([
    ...Object.keys(currentDraftValues),
    ...Object.keys(serverDraftValues),
  ]);

  return Object.fromEntries(
    Array.from(fieldDefinitionIds).map((fieldDefinitionId) => {
      const currentDraftValue = currentDraftValues[fieldDefinitionId];
      const serverDraftValue = serverDraftValues[fieldDefinitionId];
      if (!serverDraftValue) {
        return [
          fieldDefinitionId,
          currentDraftValue ?? {
            fieldDefinitionId,
            value: null,
            signatureDataUrl: null,
            signaturePreviewUrl: null,
            locallyEdited: false,
          },
        ];
      }

      const preserveLocalDraft = currentDraftValue?.locallyEdited === true;
      return [
        fieldDefinitionId,
        {
          fieldDefinitionId,
          value: preserveLocalDraft ? currentDraftValue?.value : serverDraftValue.value,
          signatureDataUrl: preserveLocalDraft ? currentDraftValue?.signatureDataUrl : null,
          signaturePreviewUrl:
            preserveLocalDraft
              ? currentDraftValue?.signaturePreviewUrl
              : serverDraftValue.signaturePreviewUrl ?? null,
          locallyEdited: preserveLocalDraft,
        } satisfies DraftValue,
      ];
    })
  );
}

function serializeValues(values: Record<string, DraftValue>): Array<{
  fieldDefinitionId: string;
  value?: string | null;
  signatureDataUrl?: string | null;
}> {
  return Object.values(values)
    .filter((entry) => entry.value !== undefined || entry.signatureDataUrl)
    .map(({ fieldDefinitionId, value, signatureDataUrl }) => ({
      fieldDefinitionId,
      value,
      signatureDataUrl,
    }));
}

function isDraftValueComplete(draftValue: DraftValue | undefined): boolean {
  return Boolean(draftValue?.value || draftValue?.signatureDataUrl || draftValue?.signaturePreviewUrl);
}

function isPngDataUrl(value: string | null | undefined): value is string {
  return Boolean(value && PNG_DATA_URL_PATTERN.test(value));
}

function buildSignerHighlights(
  fields: EsigningFieldDefinitionDto[],
  documentId: string
): BoundingBox[] {
  return fields
    .filter((f) => f.documentId === documentId)
    .map((f) => ({
      pageNumber: f.pageNumber,
      x: f.xPercent,
      y: f.yPercent,
      width: f.widthPercent,
      height: f.heightPercent,
      label: f.id, // use id as label for lookup
      color: '#294d44',
    }));
}

function getPostItLabel(fieldType: string): string {
  if (fieldType === 'SIGNATURE') return 'Sign';
  if (fieldType === 'INITIALS') return 'Initial';
  if (fieldType === 'CHECKBOX') return 'Check';
  if (fieldType === 'DATE_SIGNED') return 'Date';
  return 'Fill';
}

function getSuggestedFieldValue(
  field: EsigningFieldDefinitionDto,
  session: EsigningSigningSessionDto
): string | null {
  switch (field.type) {
    case 'NAME':
      return session.recipient.name;
    case 'COMPANY':
      return session.envelope.companyName ?? session.envelope.tenantName;
    case 'DATE_SIGNED':
      return getLocalDateInputValue();
    default:
      return null;
  }
}

function getLocalDateInputValue(): string {
  const now = new Date();
  const day = `${now.getDate()}`.padStart(2, '0');
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const year = `${now.getFullYear()}`;
  return `${day}-${month}-${year}`;
}

function buildAutoSignDraftValues(
  fields: EsigningFieldDefinitionDto[],
  session: EsigningSigningSessionDto,
  currentDraftValues: Record<string, DraftValue>,
  signatureSpecimen: string
): Record<string, DraftValue> {
  const nextValues = { ...currentDraftValues };

  for (const field of fields) {
    if (isDraftValueComplete(nextValues[field.id])) {
      continue;
    }

    const existing = nextValues[field.id];
    const value =
      field.type === 'SIGNATURE'
        ? 'signed'
        : field.type === 'DATE_SIGNED'
          ? getLocalDateInputValue()
          : field.type === 'NAME'
            ? session.recipient.name
            : field.type === 'COMPANY'
              ? session.envelope.companyName ?? session.envelope.tenantName
              : null;

    if (!value) {
      continue;
    }

    nextValues[field.id] = {
      fieldDefinitionId: field.id,
      value,
      signatureDataUrl: field.type === 'SIGNATURE' ? signatureSpecimen : existing?.signatureDataUrl ?? null,
      signaturePreviewUrl:
        field.type === 'SIGNATURE' ? signatureSpecimen : existing?.signaturePreviewUrl ?? null,
      locallyEdited: true,
    };
  }

  return nextValues;
}

function normalizeSigningError(
  error: unknown,
  fallbackMessage: string
): SigningErrorState {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes('failed to fetch') ||
    normalizedMessage.includes('networkerror') ||
    normalizedMessage.includes('network request failed')
  ) {
    return {
      kind: 'network',
      message: 'We lost the network connection. Reconnect and resume signing to continue.',
    };
  }

  if (normalizedMessage.includes('voided') || normalizedMessage.includes('cancelled')) {
    return {
      kind: 'cancelled',
      message: 'This envelope was cancelled by the sender while you were signing.',
    };
  }

  if (normalizedMessage.includes('session expired')) {
    return {
      kind: 'session-expired',
      message: 'Your signing session expired. Resume signing to continue from your saved progress.',
    };
  }

  if (normalizedMessage.includes('expired')) {
    return {
      kind: 'expired',
      message: 'This envelope expired before your signing session could finish.',
    };
  }

  return {
    kind: 'general',
    message,
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function getSigningErrorTitle(errorState: SigningErrorState | null): string {
  switch (errorState?.kind) {
    case 'cancelled':
      return 'Envelope cancelled';
    case 'expired':
      return 'Envelope expired';
    case 'session-expired':
      return 'Session expired';
    case 'network':
      return 'Connection lost';
    default:
      return 'Signing link unavailable';
  }
}

// =============================================================================
// Component
// =============================================================================

export function EsigningSignPage() {
  const toast = useToast();
  const params = useParams();
  const token = params.token as string;
  const isMobile = useIsMobile();

  // Boot / flow state
  const [flowState, setFlowState] = useState<SigningFlowState>('loading');
  const [errorState, setErrorState] = useState<SigningErrorState | null>(null);
  const [session, setSession] = useState<EsigningSigningSessionDto | null>(null);
  const [autoSignRequested, setAutoSignRequested] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [accessCodeError, setAccessCodeError] = useState<string | null>(null);

  // Signing state
  const [draftValues, setDraftValues] = useState<Record<string, DraftValue>>({});
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [viewerPage, setViewerPage] = useState(1);
  const [activeFieldIndex, setActiveFieldIndex] = useState(0);
  const [shouldFocusActiveField, setShouldFocusActiveField] = useState(false);
  const [viewerRetryKey, setViewerRetryKey] = useState(0);
  const [isPortraitMobile, setIsPortraitMobile] = useState(false);
  const [portraitBannerDismissed, setPortraitBannerDismissed] = useState(false);

  // Signature modal
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [signatureModalMode, setSignatureModalMode] = useState<'SIGNATURE' | 'INITIALS'>('SIGNATURE');
  const [activeSignatureFieldId, setActiveSignatureFieldId] = useState<string | null>(null);
  const [isSavedSignaturePromptOpen, setIsSavedSignaturePromptOpen] = useState(false);
  const [activeInputFieldId, setActiveInputFieldId] = useState<string | null>(null);

  // Decline modal
  const [isDeclineModalOpen, setIsDeclineModalOpen] = useState(false);
  const [isFinishLaterDialogOpen, setIsFinishLaterDialogOpen] = useState(false);

  // Cached signatures
  const [adoptedSignature, setAdoptedSignature] = useState<string | null>(null);
  const [adoptedInitials, setAdoptedInitials] = useState<string | null>(null);

  // Loading states
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [isConsenting, setIsConsenting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftValuesRef = useRef<Record<string, DraftValue>>({});
  const savePromiseRef = useRef<Promise<EsigningSigningSessionDto> | null>(null);
  const dirtyRevisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const flowStateRef = useRef<SigningFlowState>('loading');
  const latestStatusRef = useRef<EsigningSigningSessionStatusDto | null>(null);
  const needsSessionRefreshRef = useRef(false);
  const sessionReloadPromiseRef = useRef<Promise<EsigningSigningSessionDto> | null>(null);
  const savedSignatureSpecimenRef = useRef<string | null>(null);
  const autoSignAttemptedRef = useRef(false);
  const [isCompletionTerminal, setIsCompletionTerminal] = useState(false);
  const initializedFieldSequenceRef = useRef<string | null>(null);

  useEffect(() => {
    flowStateRef.current = flowState;
  }, [flowState]);

  useEffect(() => {
    setAutoSignRequested(
      new URLSearchParams(window.location.search).get('autoSign') === '1'
    );
  }, []);

  // ==========================================================================
  // Derived state
  // ==========================================================================

  const selectedDocument = useMemo(
    () => session?.documents.find((doc) => doc.id === selectedDocumentId) ?? session?.documents[0] ?? null,
    [selectedDocumentId, session?.documents]
  );

  const fields = useMemo(() => {
    const documentOrder = new Map(
      (session?.documents ?? []).map((document, index) => [document.id, index])
    );

    return (session?.fields ?? [])
      .map((field, index) => ({ field, index }))
      .sort((left, right) => {
        const sortOrderDifference = left.field.sortOrder - right.field.sortOrder;
        if (sortOrderDifference !== 0) {
          return sortOrderDifference;
        }

        const documentOrderDifference =
          (documentOrder.get(left.field.documentId) ?? Number.MAX_SAFE_INTEGER) -
          (documentOrder.get(right.field.documentId) ?? Number.MAX_SAFE_INTEGER);
        if (documentOrderDifference !== 0) {
          return documentOrderDifference;
        }

        const pageDifference = left.field.pageNumber - right.field.pageNumber;
        if (pageDifference !== 0) {
          return pageDifference;
        }

        return left.index - right.index;
      })
      .map(({ field }) => field);
  }, [session?.documents, session?.fields]);

  const requiredFields = useMemo(
    () => fields.filter((f) => f.required),
    [fields]
  );

  const signatureFields = useMemo(
    () => fields.filter((field) => field.type === 'SIGNATURE' || field.type === 'INITIALS'),
    [fields]
  );
  const signedSignatures = session?.signedSignatures ?? EMPTY_SIGNED_SIGNATURES;

  const signedSignatureCount = useMemo(
    () => signatureFields.filter((field) => isDraftValueComplete(draftValues[field.id])).length,
    [draftValues, signatureFields]
  );

  const completedCount = useMemo(
    () =>
      requiredFields.filter((f) => {
        const d = draftValues[f.id];
        return isDraftValueComplete(d);
      }).length,
    [requiredFields, draftValues]
  );

  const canFinish = completedCount === requiredFields.length && requiredFields.length > 0;

  const currentHighlights = useMemo(
    () => (selectedDocument ? buildSignerHighlights(fields, selectedDocument.id) : []),
    [fields, selectedDocument]
  );

  const activeField = requiredFields[activeFieldIndex] ?? null;
  const postItLabel = activeField ? getPostItLabel(activeField.type) : 'Fill';
  const activeSignatureDraft = activeSignatureFieldId
    ? draftValues[activeSignatureFieldId]
    : undefined;
  const isChangingSignature = Boolean(
    activeSignatureFieldId && isDraftValueComplete(activeSignatureDraft)
  );
  const activeSignatureDataUrl = isPngDataUrl(activeSignatureDraft?.signatureDataUrl)
    ? activeSignatureDraft.signatureDataUrl
    : isPngDataUrl(activeSignatureDraft?.signaturePreviewUrl)
      ? activeSignatureDraft.signaturePreviewUrl
      : null;
  const activeInputField = useMemo(
    () => fields.find((field) => field.id === activeInputFieldId) ?? null,
    [activeInputFieldId, fields]
  );

  useEffect(() => {
    latestDraftValuesRef.current = draftValues;
  }, [draftValues]);

  useEffect(() => {
    if (flowState !== 'signing' || fields.length === 0) {
      return;
    }

    const autoDateValue = getLocalDateInputValue();
    const currentValues = latestDraftValuesRef.current;
    const needsDateInsertion = fields.some(
      (field) => field.type === 'DATE_SIGNED' && !currentValues[field.id]?.value
    );
    if (!needsDateInsertion) {
      return;
    }

    dirtyRevisionRef.current += 1;

    setDraftValues((current) => {
      const next = { ...current };
      let hasChanges = false;

      for (const field of fields) {
        if (field.type !== 'DATE_SIGNED') {
          continue;
        }

        const existing = next[field.id];
        if (existing?.value) {
          continue;
        }

        next[field.id] = {
          fieldDefinitionId: field.id,
          value: autoDateValue,
          signatureDataUrl: existing?.signatureDataUrl ?? null,
          signaturePreviewUrl: existing?.signaturePreviewUrl ?? null,
          locallyEdited: true,
        };
        hasChanges = true;
      }

      return hasChanges ? next : current;
    });
  }, [fields, flowState]);

  useEffect(() => {
    if (requiredFields.length === 0) {
      initializedFieldSequenceRef.current = null;
      return;
    }

    const fieldSequenceKey = requiredFields.map((field) => field.id).join('|');
    if (initializedFieldSequenceRef.current === fieldSequenceKey) {
      return;
    }

    initializedFieldSequenceRef.current = fieldSequenceKey;
    const nextIncompleteIndex = requiredFields.findIndex(
      (field) => !isDraftValueComplete(draftValues[field.id])
    );
    const initialIndex = nextIncompleteIndex === -1 ? requiredFields.length - 1 : nextIncompleteIndex;
    setActiveFieldIndex((current) =>
      current === initialIndex ? current : Math.max(0, Math.min(requiredFields.length - 1, initialIndex))
    );
  }, [draftValues, requiredFields]);

  useEffect(() => {
    if (!autoSignRequested || autoSignAttemptedRef.current || flowState !== 'signing' || !session) {
      return;
    }

    const signatureSpecimen =
      session.savedSignatureSpecimenDataUrl ?? savedSignatureSpecimenRef.current;
    autoSignAttemptedRef.current = true;
    if (!signatureSpecimen) {
      return;
    }

    const nextDraftValues = buildAutoSignDraftValues(
      fields,
      session,
      latestDraftValuesRef.current,
      signatureSpecimen
    );
    latestDraftValuesRef.current = nextDraftValues;
    dirtyRevisionRef.current += 1;
    setDraftValues(nextDraftValues);

    const allRequiredFieldsComplete =
      requiredFields.length > 0 &&
      requiredFields.every((field) => isDraftValueComplete(nextDraftValues[field.id]));
    if (allRequiredFieldsComplete) {
      void completeSigning(nextDraftValues);
    }
    // The ref guards this one-shot intent from rerunning when signing state updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSignRequested, fields, flowState, requiredFields, session]);

  useEffect(() => {
    if (!isMobile) {
      setIsPortraitMobile(false);
      return;
    }

    const syncOrientation = () => {
      setIsPortraitMobile(window.innerHeight >= window.innerWidth);
    };

    syncOrientation();
    window.addEventListener('resize', syncOrientation);
    window.addEventListener('orientationchange', syncOrientation);

    return () => {
      window.removeEventListener('resize', syncOrientation);
      window.removeEventListener('orientationchange', syncOrientation);
    };
  }, [isMobile]);

  // ==========================================================================
  // API helpers
  // ==========================================================================

  const loadSession = useCallback(
    async (options?: { recordView?: boolean; preserveDrafts?: boolean }) => {
      const { recordView = false, preserveDrafts = false } = options ?? {};

      const loadResponse = await fetch('/api/public-bootstrap/esigning/session');
      const loadResult = await loadResponse.json().catch(() => ({}));
      if (!loadResponse.ok) {
        throw new Error(
          (loadResult as { error?: string }).error || 'Failed to load signing session'
        );
      }

      const nextSession =
        (loadResult as { session?: EsigningSigningSessionDto }).session ??
        (loadResult as EsigningSigningSessionDto);
      if (nextSession.savedSignatureSpecimenDataUrl) {
        savedSignatureSpecimenRef.current = nextSession.savedSignatureSpecimenDataUrl;
      }
      const nextSessionWithSpecimen = {
        ...nextSession,
        savedSignatureSpecimenDataUrl:
          nextSession.savedSignatureSpecimenDataUrl ?? savedSignatureSpecimenRef.current,
      };
      setSession(nextSessionWithSpecimen);
      if (preserveDrafts) {
        setDraftValues((current) => mergeDraftState(current, nextSessionWithSpecimen.fieldValues));
      } else {
        setDraftValues(buildDraftState(nextSessionWithSpecimen.fieldValues));
      }
      setSelectedDocumentId((current) => current || nextSessionWithSpecimen.documents[0]?.id || '');

      if (recordView) {
        const viewResponse = await fetch('/api/esigning/sign/session/view', { method: 'POST' });
        if (viewResponse.ok) {
          const viewedSession = (await viewResponse.json()) as EsigningSigningSessionDto;
          const viewedSessionWithSpecimen = {
            ...viewedSession,
            savedSignatureSpecimenDataUrl:
              viewedSession.savedSignatureSpecimenDataUrl ??
              nextSessionWithSpecimen.savedSignatureSpecimenDataUrl ??
              savedSignatureSpecimenRef.current,
          };
          setSession(viewedSessionWithSpecimen);
          if (preserveDrafts) {
            setDraftValues((current) => mergeDraftState(current, viewedSessionWithSpecimen.fieldValues));
          } else {
            setDraftValues(buildDraftState(viewedSessionWithSpecimen.fieldValues));
          }
          return viewedSessionWithSpecimen;
        }
      }

      return nextSessionWithSpecimen;
    },
    []
  );

  const reloadSession = useCallback(
    (options?: { recordView?: boolean; preserveDrafts?: boolean }) => {
      if (sessionReloadPromiseRef.current) {
        return sessionReloadPromiseRef.current;
      }
      const promise = loadSession(options).finally(() => {
        if (sessionReloadPromiseRef.current === promise) {
          sessionReloadPromiseRef.current = null;
        }
      });
      sessionReloadPromiseRef.current = promise;
      return promise;
    },
    [loadSession]
  );

  const refreshSigningStatus = useCallback(async () => {
    const response = await fetch('/api/esigning/sign/session/status');
    const responseBody = (await response.json().catch(() => ({}))) as
      | EsigningSigningSessionStatusDto
      | { error?: string };

    if (!response.ok) {
      throw new Error(
        ('error' in responseBody && responseBody.error) || 'Failed to refresh signing session'
      );
    }

    const result = responseBody as EsigningSigningSessionStatusDto;
    setSaveError(null);
    const previousStatus = latestStatusRef.current;

    const statusChanged =
      !previousStatus ||
      previousStatus.envelope.status !== result.envelope.status ||
      previousStatus.envelope.pdfGenerationStatus !== result.envelope.pdfGenerationStatus ||
      previousStatus.envelope.autoFilingStatus !== result.envelope.autoFilingStatus ||
      previousStatus.envelope.completionDeliveryStatus !==
        result.envelope.completionDeliveryStatus ||
      previousStatus.currentRecipientDeliveryStatus !==
        result.currentRecipientDeliveryStatus ||
      previousStatus.remainingSignerCount !== result.remainingSignerCount ||
      previousStatus.recipient.signedAt !== result.recipient.signedAt;

    const mustHydrate = statusChanged || needsSessionRefreshRef.current;
    if (mustHydrate) {
      needsSessionRefreshRef.current = true;
      try {
        await reloadSession({ preserveDrafts: true });
      } catch (error) {
        const normalizedError = normalizeSigningError(
          error,
          'Failed to refresh signing session'
        );
        if (
          normalizedError.kind === 'session-expired' ||
          normalizedError.kind === 'expired' ||
          normalizedError.kind === 'cancelled'
        ) {
          throw error;
        }
        setSaveError(normalizedError.message);
        return;
      }
      latestStatusRef.current = result;
      needsSessionRefreshRef.current = false;
      setIsCompletionTerminal(result.terminal);
      if (result.recipient.signedAt) {
        setFlowState('completed');
      }
      return;
    }

    latestStatusRef.current = result;
    setIsCompletionTerminal(result.terminal);
    if (result.recipient.signedAt && flowStateRef.current !== 'completed') {
      setFlowState('completed');
    }
  }, [reloadSession]);

  // ==========================================================================
  // Bootstrap
  // ==========================================================================

  const bootstrapSigning = useCallback(async () => {
    setFlowState('loading');
    setErrorState(null);

    try {
      const response = await fetch(`/api/esigning/sign/${encodeURIComponent(token)}`, {
        method: 'POST',
      });
      const result = (await response.json().catch(() => ({}))) as Partial<ExchangeResult> & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error || 'Signing link is invalid');
      }

      if (result.requiresAccessCode) {
        setFlowState('requires-code');
        return;
      }

      const nextSession = await loadSession({ recordView: true });
      setSaveError(null);

      if (nextSession.recipient.signedAt) {
        setFlowState('completed');
      } else if (!nextSession.recipient.consentedAt) {
        setFlowState('consent');
      } else {
        setFlowState('signing');
      }
    } catch (error) {
      setErrorState(normalizeSigningError(error, 'Failed to load signing flow'));
      setFlowState('error');
    }
  }, [loadSession, token]);

  useEffect(() => {
    void bootstrapSigning();
  }, [bootstrapSigning]);

  // ==========================================================================
  // Autosave
  // ==========================================================================

  useEffect(() => {
    if (flowState !== 'signing') return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      void saveProgress().catch(() => undefined);
    }, 500);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [draftValues, flowState]);

  useEffect(() => {
    const shouldPoll =
      flowState === 'signing' || (flowState === 'completed' && !isCompletionTerminal);
    if (!shouldPoll) {
      return;
    }

    const runStatusRefresh = () => {
      void (async () => {
        try {
          await refreshSigningStatus();
        } catch (error) {
          const normalizedError = normalizeSigningError(error, 'Failed to refresh signing session');
          if (normalizedError.kind === 'network') {
            setSaveError(normalizedError.message);
            return;
          }

          setErrorState(normalizedError);
          setFlowState('error');
        }
      })();
    };

    const intervalId = window.setInterval(runStatusRefresh, 30_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runStatusRefresh();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [flowState, isCompletionTerminal, refreshSigningStatus]);

  // ==========================================================================
  // Draft helpers
  // ==========================================================================

  function setDraft(fieldDefinitionId: string, patch: Partial<DraftValue>) {
    dirtyRevisionRef.current += 1;
    setDraftValues((current) => ({
      ...current,
      [fieldDefinitionId]: {
        ...current[fieldDefinitionId],
        ...patch,
        fieldDefinitionId,
        locallyEdited: true,
      },
    }));
  }

  function openInputModal(field: EsigningFieldDefinitionDto) {
    setActiveInputFieldId(field.id);
  }

  // ==========================================================================
  // Field navigation
  // ==========================================================================

  function goToNextField() {
    if (activeFieldIndex < requiredFields.length - 1) {
      goToFieldIndex(activeFieldIndex + 1);
    }
  }

  function goToNextUnfilledField(fromFieldId: string) {
    const startIndex = requiredFields.findIndex((field) => field.id === fromFieldId);
    for (let offset = 1; offset <= requiredFields.length; offset += 1) {
      const index = (startIndex + offset) % requiredFields.length;
      if (!isDraftValueComplete(draftValues[requiredFields[index].id])) {
        goToFieldIndex(index);
        return;
      }
    }
  }

  function findNextIncompleteFieldIndex(): number {
    const currentField = requiredFields[activeFieldIndex];
    if (currentField) {
      const currentDraft = draftValues[currentField.id];
      const currentIsComplete = Boolean(
        currentDraft?.value || currentDraft?.signatureDataUrl || currentDraft?.signaturePreviewUrl
      );

      if (!currentIsComplete) {
        return activeFieldIndex;
      }
    }

    const nextAfterCurrent = requiredFields.findIndex((field, index) => {
      if (index <= activeFieldIndex) {
        return false;
      }

      const draft = draftValues[field.id];
      return !draft?.value && !draft?.signatureDataUrl && !draft?.signaturePreviewUrl;
    });

    if (nextAfterCurrent !== -1) {
      return nextAfterCurrent;
    }

    return requiredFields.findIndex((field) => {
      const draft = draftValues[field.id];
      return !draft?.value && !draft?.signatureDataUrl && !draft?.signaturePreviewUrl;
    });
  }

  function goToFieldIndex(index: number) {
    if (requiredFields.length === 0) {
      return;
    }

    const clamped = Math.max(0, Math.min(requiredFields.length - 1, index));
    setShouldFocusActiveField(true);
    setActiveFieldIndex(clamped);
    const field = requiredFields[clamped];
    if (field) {
      if (field.documentId !== selectedDocumentId) setSelectedDocumentId(field.documentId);
      setViewerPage(field.pageNumber);
    }
  }

  function handlePrimaryAction() {
    if (canFinish) {
      void completeSigning();
      return;
    }

    const nextIndex = findNextIncompleteFieldIndex();
    if (nextIndex === -1) {
      return;
    }

    const nextField = requiredFields[nextIndex];
    if (!nextField) {
      return;
    }

    goToFieldIndex(nextIndex);
  }

  // ==========================================================================
  // Field click
  // ==========================================================================

  function handleFieldClick(field: EsigningFieldDefinitionDto) {
    // Set active field index
    const idx = requiredFields.findIndex((f) => f.id === field.id);
    if (idx !== -1) setActiveFieldIndex(idx);

    if (field.type === 'SIGNATURE' || field.type === 'INITIALS') {
      const existingDraft = draftValues[field.id];
      const fieldIsFilled = isDraftValueComplete(existingDraft);

      setActiveSignatureFieldId(field.id);
      setSignatureModalMode(field.type);

      // Clicking a completed signature reopens the editor so the signer can
      // change it before final submission. Completed sessions never render
      // this signing surface, keeping finalized values immutable.
      if (fieldIsFilled) {
        setIsSavedSignaturePromptOpen(false);
        setIsSignatureModalOpen(true);
        return;
      }

      const cached = field.type === 'SIGNATURE' ? adoptedSignature : adoptedInitials;
      if (cached) {
        setDraft(field.id, { signatureDataUrl: cached, signaturePreviewUrl: cached, value: 'signed' });
      } else {
        if (field.type === 'SIGNATURE' && session?.savedSignatureSpecimenDataUrl) {
          setIsSavedSignaturePromptOpen(true);
        } else {
          setIsSignatureModalOpen(true);
        }
      }
    } else if (field.type === 'CHECKBOX') {
      const current = draftValues[field.id]?.value;
      setDraft(field.id, { value: current === 'true' ? null : 'true' });
    } else if (field.type === 'DATE_SIGNED') {
      setDraft(field.id, { value: getLocalDateInputValue() });
    } else if (
      field.type === 'TEXT' ||
      field.type === 'NAME' ||
      field.type === 'COMPANY' ||
      field.type === 'TITLE'
    ) {
      openInputModal(field);
    }
  }

  // ==========================================================================
  // Signature modal adoption
  // ==========================================================================

  function handleAdoptSignature({ dataUrl, applyToAll }: { dataUrl: string; applyToAll: boolean }) {
    if (signatureModalMode === 'SIGNATURE') {
      if (applyToAll) setAdoptedSignature(dataUrl);
    } else {
      if (applyToAll) setAdoptedInitials(dataUrl);
    }
    if (activeSignatureFieldId) {
      setDraft(activeSignatureFieldId, {
        signatureDataUrl: dataUrl,
        signaturePreviewUrl: dataUrl,
        value: 'signed',
      });
    }
    setIsSignatureModalOpen(false);
  }

  function handleUseSavedSignature() {
    const dataUrl = session?.savedSignatureSpecimenDataUrl;
    if (!dataUrl || !activeSignatureFieldId) {
      setIsSavedSignaturePromptOpen(false);
      return;
    }

    setAdoptedSignature(dataUrl);
    setDraft(activeSignatureFieldId, {
      signatureDataUrl: dataUrl,
      signaturePreviewUrl: dataUrl,
      value: 'signed',
    });
    setIsSavedSignaturePromptOpen(false);
  }

  function clearSignature(fieldId: string) {
    const field = fields.find((candidate) => candidate.id === fieldId);
    if (!field || (field.type !== 'SIGNATURE' && field.type !== 'INITIALS')) {
      return;
    }

    setDraft(fieldId, {
      value: null,
      signatureDataUrl: null,
      signaturePreviewUrl: null,
    });
    setIsSavedSignaturePromptOpen(false);
    setIsSignatureModalOpen(false);
  }

  function handleChooseAnotherSignature() {
    setIsSavedSignaturePromptOpen(false);
    setIsSignatureModalOpen(true);
  }

  // ==========================================================================
  // API actions
  // ==========================================================================

  async function verifyAccessCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccessCodeError(null);
    try {
      setFlowState('loading');
      const response = await fetch('/api/esigning/sign/session/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Access code is incorrect');
      }
      const nextSession = await loadSession({ recordView: true });
      if (nextSession.recipient.signedAt) {
        setFlowState('completed');
      } else if (!nextSession.recipient.consentedAt) {
        setFlowState('consent');
      } else {
        setFlowState('signing');
      }
    } catch (error) {
      setAccessCodeError(error instanceof Error ? error.message : 'Failed to verify access code');
      setFlowState('requires-code');
    }
  }

  async function saveProgress(values: Record<string, DraftValue> = latestDraftValuesRef.current) {
    let nextValues = values;
    if (dirtyRevisionRef.current === savedRevisionRef.current) {
      return;
    }

    if (savePromiseRef.current) {
      await savePromiseRef.current.catch(() => undefined);
      nextValues = latestDraftValuesRef.current;
      if (dirtyRevisionRef.current === savedRevisionRef.current) {
        return;
      }
    }

    const serializedValues = serializeValues(nextValues);
    if (serializedValues.length === 0) {
      return;
    }

    const savingRevision = dirtyRevisionRef.current;

    const requestPromise = (async () => {
      setIsSaving(true);
      let attempt = 0;

      while (attempt < 3) {
        try {
          const response = await fetch('/api/esigning/sign/session/fields', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: serializedValues }),
          });
          const result = (await response.json().catch(() => ({}))) as EsigningSigningSessionDto & {
            error?: string;
          };

          if (!response.ok) {
            const requestError = new Error(result.error || 'Failed to save progress');
            if (response.status >= 500 && attempt < 2) {
              attempt += 1;
              await wait(400 * 2 ** attempt);
              continue;
            }
            throw requestError;
          }

          setSession({
            ...result,
            savedSignatureSpecimenDataUrl:
              result.savedSignatureSpecimenDataUrl ?? savedSignatureSpecimenRef.current,
          });
          setSaveError(null);
          return result;
        } catch (error) {
          const normalizedError = normalizeSigningError(error, 'Failed to save progress');

          if (normalizedError.kind === 'network' && attempt < 2) {
            attempt += 1;
            await wait(400 * 2 ** attempt);
            continue;
          }

          if (
            normalizedError.kind === 'cancelled' ||
            normalizedError.kind === 'expired' ||
            normalizedError.kind === 'session-expired'
          ) {
            setErrorState(normalizedError);
            setFlowState('error');
          } else {
            setSaveError(normalizedError.message);
          }

          throw error;
        }
      }

      throw new Error('Failed to save progress');
    })();

    savePromiseRef.current = requestPromise;
    try {
      const result = await requestPromise;
      savedRevisionRef.current = savingRevision;
      return result;
    } finally {
      if (savePromiseRef.current === requestPromise) {
        savePromiseRef.current = null;
      }
      setIsSaving(false);
    }
  }

  async function flushPendingSaves(values: Record<string, DraftValue> = latestDraftValuesRef.current) {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    if (savePromiseRef.current) {
      await savePromiseRef.current;
    }

    await saveProgress(values);
  }

  async function completeSigning(values: Record<string, DraftValue> = latestDraftValuesRef.current) {
    try {
      setIsCompleting(true);
      await flushPendingSaves(values);
      const response = await fetch('/api/esigning/sign/session/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: serializeValues(values) }),
      });
      const result = await response.json().catch(() => ({})) as EsigningSigningSessionDto & { error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Failed to complete signing');
      }
      setSession({
        ...result,
        savedSignatureSpecimenDataUrl:
          result.savedSignatureSpecimenDataUrl ?? savedSignatureSpecimenRef.current,
      });
      setFlowState('completed');
      setSaveError(null);
    } catch (error) {
      const normalizedError = normalizeSigningError(error, 'Failed to complete signing');
      if (
        normalizedError.kind === 'cancelled' ||
        normalizedError.kind === 'expired' ||
        normalizedError.kind === 'session-expired'
      ) {
        setErrorState(normalizedError);
        setFlowState('error');
      } else {
        toast.error(normalizedError.message);
      }
    } finally {
      setIsCompleting(false);
    }
  }

  async function recordConsent(): Promise<boolean> {
    setIsConsenting(true);
    try {
      const response = await fetch('/api/esigning/sign/session/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consented: true }),
      });
      const result = await response.json().catch(() => ({})) as EsigningSigningSessionDto & { error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Failed to record consent');
      }
      if (!result.recipient?.consentedAt) {
        throw new Error('Consent was not confirmed by the server');
      }
      setSession({
        ...result,
        savedSignatureSpecimenDataUrl:
          result.savedSignatureSpecimenDataUrl ?? savedSignatureSpecimenRef.current,
      });
      setSaveError(null);
      return true;
    } catch (error) {
      const normalizedError = normalizeSigningError(error, 'Failed to record consent');
      if (
        normalizedError.kind === 'cancelled' ||
        normalizedError.kind === 'expired' ||
        normalizedError.kind === 'session-expired' ||
        normalizedError.kind === 'network'
      ) {
        setErrorState(normalizedError);
        setFlowState('error');
        return false;
      }

      toast.error(normalizedError.message);
      return false;
    } finally {
      setIsConsenting(false);
    }
  }

  async function declineSigning(reason: string) {
    try {
      setIsDeclining(true);
      const response = await fetch('/api/esigning/sign/session/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Failed to decline');
      }
      setIsDeclineModalOpen(false);
      setFlowState('declined');
    } finally {
      setIsDeclining(false);
    }
  }

  async function finishLater() {
    try {
      await flushPendingSaves();
      setIsFinishLaterDialogOpen(false);
      toast.success('Progress saved. You can return to this link later.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save progress');
    }
  }

  // ==========================================================================
  // Render: loading
  // ==========================================================================

  if (flowState === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background-primary p-6">
        <Loader2 className="h-8 w-8 animate-spin text-oak-primary" />
        <p className="text-sm text-text-secondary">Loading your signing session…</p>
      </div>
    );
  }

  // ==========================================================================
  // Render: error
  // ==========================================================================

  if (flowState === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-primary p-6">
        <div className="w-full max-w-lg rounded-3xl border border-border-primary bg-background-secondary p-8 shadow-sm">
          <AlertCircle className="mx-auto h-10 w-10 text-rose-500" />
          <h1 className="mt-4 text-center text-2xl font-semibold text-text-primary">
            {getSigningErrorTitle(errorState)}
          </h1>
          <p className="mt-2 text-center text-sm text-text-secondary">
            {errorState?.message ?? 'This signing link is not available right now.'}
          </p>
          {(errorState?.kind === 'network' || errorState?.kind === 'session-expired') && (
            <div className="mt-6 flex justify-center">
              <Button
                type="button"
                onClick={() => {
                  setViewerRetryKey((current) => current + 1);
                  void bootstrapSigning();
                }}
              >
                Resume signing
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: requires-code
  // ==========================================================================

  if (flowState === 'requires-code') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-primary p-6">
        <div className="w-full max-w-lg rounded-3xl border border-border-primary bg-background-secondary p-8 shadow-sm">
          <Shield className="mx-auto h-10 w-10 text-oak-primary" />
          <h1 className="mt-4 text-center text-2xl font-semibold text-text-primary">
            Access code required
          </h1>
          <p className="mt-2 text-center text-sm text-text-secondary">
            Enter the access code the sender gave you to continue.
          </p>
          {accessCodeError ? (
            <Alert variant="error" className="mt-4">
              {accessCodeError}
            </Alert>
          ) : null}
          <form onSubmit={verifyAccessCode} className="mt-5 space-y-4">
            <FormInput
              label="Access code"
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              placeholder="Enter access code"
              required
            />
            <Button type="submit" className="w-full">
              Continue to signing
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: consent
  // ==========================================================================

  if (flowState === 'consent' && session) {
    return (
      <EsigningConsentScreen
        envelopeTitle={session.envelope.title}
        senderName={session.envelope.senderName}
        tenantName={session.envelope.tenantName}
        documents={session.documents.map((d) => ({ id: d.id, fileName: d.fileName }))}
        isSubmitting={isConsenting}
        onConsent={async () => {
          if (await recordConsent()) {
            setFlowState('signing');
          }
        }}
        onDecline={() => setIsDeclineModalOpen(true)}
      />
    );
  }

  // ==========================================================================
  // Render: completed
  // ==========================================================================

  if (flowState === 'completed' && session) {
    return (
      <EsigningCompletionScreen
        envelopeTitle={session.envelope.title}
        recipientName={session.recipient.name}
        signedAt={session.recipient.signedAt}
        isAllPartiesDone={session.envelope.status === 'COMPLETED'}
        remainingSignerCount={session.recipients.filter(
          (recipient) => recipient.type === 'SIGNER' && recipient.status !== 'SIGNED'
        ).length}
        expiresAt={session.envelope.expiresAt}
        pdfGenerationStatus={session.envelope.pdfGenerationStatus}
        autoFilingStatus={session.envelope.autoFilingStatus}
        completionDeliveryStatus={session.envelope.completionDeliveryStatus}
        currentRecipientDeliveryStatus={session.currentRecipientDeliveryStatus}
        documents={session.documents}
        downloadToken={session.downloadToken}
        certificateId={session.envelope.certificateId}
      />
    );
  }

  // ==========================================================================
  // Render: declined
  // ==========================================================================

  if (flowState === 'declined') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-primary p-6">
        <div className="w-full max-w-lg rounded-3xl border border-border-primary bg-background-secondary p-8 shadow-sm text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 border border-gray-200">
            <Ban className="h-8 w-8 text-gray-400" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-text-primary">Signing declined</h1>
          <p className="mt-2 text-sm text-text-secondary">
            You have chosen not to sign. The sender has been notified.
          </p>
          <p className="mt-4 rounded-2xl border border-border-primary bg-background-primary px-4 py-3 text-sm text-text-secondary">
            No further action is required from you. If you changed your mind, please contact the
            sender to request a new signing link.
          </p>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: signing
  // ==========================================================================

  if (!session) return null;

  return (
    <div data-testid="signing-document" className="min-h-screen bg-background-primary">
      {/* Sticky header */}
      <EsigningSigningHeader
        envelopeTitle={session.envelope.title}
        senderName={session.envelope.senderName}
        tenantName={session.envelope.tenantName}
        completedCount={completedCount}
        requiredCount={requiredFields.length}
        canFinish={canFinish}
        onPrimaryAction={handlePrimaryAction}
        onDecline={() => setIsDeclineModalOpen(true)}
        onFinishLater={() => setIsFinishLaterDialogOpen(true)}
        onDownloadOriginal={() => {
          if (selectedDocument) {
            window.open(selectedDocument.pdfUrl, '_blank', 'noreferrer');
          }
        }}
        recipientName={session.recipient.name}
        recipientEmail={session.recipient.email}
        envelopeId={session.envelope.id}
        isFinishing={isCompleting}
      />

      <div className="mx-auto w-full max-w-7xl px-4 py-4">
        {isPortraitMobile && !portraitBannerDismissed ? (
          <Alert variant="info" className="mb-4 flex items-center justify-between gap-3">
            <span>Rotate to landscape for a better signing experience on mobile.</span>
            <button
              type="button"
              onClick={() => setPortraitBannerDismissed(true)}
              className="shrink-0 text-xs font-medium text-text-secondary hover:text-text-primary"
            >
              Dismiss
            </button>
          </Alert>
        ) : null}

        {saveError ? (
          <Alert variant="warning" className="mb-4 flex items-center justify-between gap-3">
            <span>{saveError}</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void flushPendingSaves().catch(() => undefined)}
            >
              Retry save
            </Button>
          </Alert>
        ) : null}

        {/* Document tab bar */}
        {session.documents.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {session.documents.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => { setSelectedDocumentId(doc.id); setViewerPage(1); }}
                title={doc.fileName}
                className={
                  (selectedDocument?.id ?? session.documents[0]?.id) === doc.id
                    ? 'min-h-[36px] max-w-[180px] truncate rounded-full border border-oak-primary bg-oak-primary/10 px-3 py-1.5 text-xs font-medium text-oak-primary sm:max-w-[260px] md:max-w-none'
                    : 'min-h-[36px] max-w-[180px] truncate rounded-full border border-border-primary bg-background-primary px-3 py-1.5 text-xs text-text-secondary hover:bg-background-tertiary sm:max-w-[260px] md:max-w-none'
                }
              >
                {doc.fileName}
              </button>
            ))}
          </div>
        )}

        {/* PDF viewer */}
        <div className={isMobile ? 'relative' : 'relative mr-14'} data-testid="signing-preview-frame">
        {selectedDocument ? (
          <DocumentPageViewer
            key={`${selectedDocument.id}:${viewerRetryKey}`}
            pdfUrl={selectedDocument.pdfUrl}
            initialPage={viewerPage}
            onPageChange={setViewerPage}
            highlights={currentHighlights}
            focusedHighlightLabel={shouldFocusActiveField ? activeField?.id : undefined}
            showHighlights
            showHighlightsToggle={false}
            viewMode="continuous"
            allowPagePanel={!isPortraitMobile}
            className="h-[calc(100dvh-10rem)] min-h-96 rounded-2xl border border-border-primary bg-background-primary"
            onRetry={() => setViewerRetryKey((current) => current + 1)}
            pageOverlayInteractive={false}
            showPageSideNavigation={false}
            renderPageOverlay={({ pageNumber, width, height }) => (
              <>
                {signedSignatures
                  .filter(
                    (signature) =>
                      signature.documentId === selectedDocument.id && signature.pageNumber === pageNumber
                  )
                  .map((signature) => {
                    const widthPercent = Math.max(0, Math.min(1, signature.widthPercent));
                    const heightPercent = Math.max(0, Math.min(1, signature.heightPercent));
                    const leftPercent = Math.max(
                      0,
                      Math.min(1 - widthPercent, signature.xPercent)
                    );
                    const topPercent = Math.max(
                      0,
                      Math.min(1 - heightPercent, signature.yPercent)
                    );

                    return (
                      <div
                        key={`signed-signature-${signature.fieldDefinitionId}`}
                        data-testid={`signed-signature-${signature.fieldDefinitionId}`}
                        aria-label={`Signature from ${signature.signerName}`}
                        style={{
                          position: 'absolute',
                          left: `${leftPercent * 100}%`,
                          top: `${topPercent * 100}%`,
                          width: `${widthPercent * 100}%`,
                          height: `${heightPercent * 100}%`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 3,
                          overflow: 'hidden',
                          border: '1px solid rgba(41, 77, 68, 0.22)',
                          borderRadius: 4,
                          background: 'rgba(255, 255, 255, 0.86)',
                          pointerEvents: 'none',
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={signature.signaturePreviewUrl}
                          alt={`Signature from ${signature.signerName}`}
                          title={`Signed by ${signature.signerName}`}
                          style={{
                            maxWidth: '100%',
                            maxHeight: '100%',
                            objectFit: 'contain',
                          }}
                        />
                      </div>
                    );
                  })}
                {signatureFields
                  .filter((field) => field.documentId === selectedDocument.id && field.pageNumber === pageNumber)
                  .map((field) => (
                    <EsigningSignatureProgressHint
                      key={`signature-progress-${field.id}`}
                      fieldId={field.id}
                      field={field}
                      pageWidth={width}
                      pageHeight={height}
                      signedCount={signedSignatureCount}
                      totalCount={signatureFields.length}
                      isComplete={canFinish}
                      onContinue={() => goToNextUnfilledField(field.id)}
                    />
                  ))}
              </>
            )}
            renderHighlightContent={(highlight, _pixelRect, _idx) => {
              const field = fields.find((f) => f.id === highlight.label);
              if (!field) return null;
              const draft = draftValues[field.id];
              const isFilled = !!(draft?.value || draft?.signatureDataUrl || draft?.signaturePreviewUrl);
              const isActive = requiredFields[activeFieldIndex]?.id === field.id;
              return (
                <EsigningFieldOverlay
                  field={field}
                  state={
                    isFilled
                      ? 'filled'
                      : isActive
                        ? 'active'
                        : field.required
                          ? 'unfilled-required'
                          : 'unfilled-optional'
                  }
                  value={draft?.value}
                  signatureImageUrl={draft?.signaturePreviewUrl ?? draft?.signatureDataUrl}
                  recipientColor="#294d44"
                  onClick={() => handleFieldClick(field)}
                />
              );
            }}
          />
        ) : null}
      {/* Post-it tab */}
      {!isMobile && requiredFields.length > 0 && (
        <EsigningPostItTab
          label={canFinish ? 'Finish' : postItLabel}
          isComplete={canFinish}
          currentIndex={activeFieldIndex}
          totalCount={requiredFields.length}
          onClick={() => {
            if (canFinish) {
              void completeSigning();
            } else {
              const field = requiredFields[activeFieldIndex];
              if (!field) return;
              if (field.documentId !== selectedDocumentId || field.pageNumber !== viewerPage) {
                goToFieldIndex(activeFieldIndex);
              } else if (field.type === 'SIGNATURE' || field.type === 'INITIALS') {
                setActiveSignatureFieldId(field.id);
                setSignatureModalMode(field.type);
                setIsSignatureModalOpen(true);
              } else {
                handleFieldClick(field);
              }
            }
          }}
          onNext={goToNextField}
          onPrev={() => goToFieldIndex(activeFieldIndex - 1)}
        />
      )}

        </div>
      </div>

      {/* Signature modal */}
      <EsigningSignatureModal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        onAdopt={handleAdoptSignature}
        mode={signatureModalMode}
        recipientName={session.recipient.name}
        existingSignature={
          activeSignatureDataUrl ??
          (signatureModalMode === 'SIGNATURE' ? adoptedSignature : adoptedInitials)
        }
        titleOverride={
          isChangingSignature
            ? `Change Your ${signatureModalMode === 'SIGNATURE' ? 'Signature' : 'Initials'}`
            : undefined
        }
        confirmLabel={isChangingSignature ? 'Save Change' : undefined}
        onClear={
          isChangingSignature && activeSignatureFieldId
            ? () => clearSignature(activeSignatureFieldId)
            : undefined
        }
        isSubmitting={false}
      />

      <ConfirmDialog
        isOpen={isSavedSignaturePromptOpen}
        onClose={handleChooseAnotherSignature}
        onConfirm={handleUseSavedSignature}
        title="Use your saved signature?"
        description="Your signed-in email matches this signing request. Apply your saved signature specimen to this field?"
        confirmLabel="Use Saved Signature"
        cancelLabel="Choose Another"
        variant="info"
      >
        {session.savedSignatureSpecimenDataUrl ? (
          <div className="flex min-h-24 items-center justify-center rounded-lg border border-border-primary bg-background-tertiary p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={session.savedSignatureSpecimenDataUrl}
              alt="Saved signature specimen"
              className="max-h-20 max-w-full object-contain"
            />
          </div>
        ) : null}
      </ConfirmDialog>

      <EsigningFieldInputModal
        field={activeInputField}
        isOpen={Boolean(activeInputField)}
        initialValue={
          activeInputField ? draftValues[activeInputField.id]?.value ?? null : null
        }
        placeholder={activeInputField?.placeholder ?? undefined}
        suggestedValue={
          activeInputField && session ? getSuggestedFieldValue(activeInputField, session) : null
        }
        onClose={() => setActiveInputFieldId(null)}
        onSave={(value) => {
          if (!activeInputField) return;
          setDraft(activeInputField.id, { value });
          setActiveInputFieldId(null);
        }}
      />

      {/* Decline modal */}
      <EsigningDeclineModal
        isOpen={isDeclineModalOpen}
        onClose={() => setIsDeclineModalOpen(false)}
        onDecline={(reason) => void declineSigning(reason)}
        isSubmitting={isDeclining}
      />
      <ConfirmDialog
        isOpen={isFinishLaterDialogOpen}
        onClose={() => setIsFinishLaterDialogOpen(false)}
        onConfirm={() => void finishLater()}
        title="Save progress and finish later?"
        description="We will save your completed fields so you can return to this same signing link later."
        confirmLabel="Save progress"
        cancelLabel="Keep signing"
        variant="info"
        isLoading={isSaving}
      />

      {/* Save indicator */}
      {isSaving && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full border border-border-primary bg-background-secondary px-4 py-2 text-xs text-text-secondary shadow-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving...
        </div>
      )}
    </div>
  );
}
