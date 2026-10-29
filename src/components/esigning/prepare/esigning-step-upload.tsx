'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { Upload, FileText, UserPlus, X, Check, ChevronDown, Loader2 } from 'lucide-react';
import type { EsigningRecipientAccessMode, EsigningRecipientType } from '@/generated/prisma';
import type { EsigningEnvelopeDetailDto, EsigningEnvelopeRecipientDto } from '@/types/esigning';
import type { UpdateEsigningEnvelopeInput } from '@/lib/validations/esigning';
import type { EsigningRecipientInput } from '@/lib/validations/esigning';
import {
  ESIGNING_COMPLETION_BCC_PREFERENCE_KEY,
  parseEsigningCompletionBccPreference,
  updateEsigningEnvelopeSchema,
  type EsigningCompletionBccPreference,
} from '@/lib/validations/esigning';
import { ESIGNING_LIMITS } from '@/lib/validations/esigning';
import {
  ESIGNING_RECIPIENT_TYPE_LABELS,
  ESIGNING_ACCESS_MODE_LABELS,
} from '@/components/esigning/esigning-shared';
import {
  getEsigningUploadAccept,
  isAllowedEsigningUploadFile,
  useEsigningWordUploadAvailability,
} from '@/components/esigning/esigning-upload-files';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { FormInput } from '@/components/ui/form-input';
import { SingleDateInput } from '@/components/ui/single-date-input';
import { CompanySelect } from '@/components/ui/company-select';
import { toCompanySearchOption } from '@/hooks/use-company-search';
import { ContactSearchSelect, type SearchableContact } from '@/components/ui/contact-search-select';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/hooks/use-auth';
import { useCreateContact } from '@/hooks/use-contacts';
import { useUpsertUserPreference, useUserPreference } from '@/hooks/use-user-preferences';
import type { ReorderEsigningRecipientsPayload } from '@/hooks/use-esigning';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { CompanyAccentSection } from '@/components/companies/company-accent-section';
import { CompanySharePointMappingNotice } from '@/components/companies/company-sharepoint-mapping-notice';
import { cn } from '@/lib/utils';
import type { EsigningSigningOrder } from '@/generated/prisma';
import { GeneratedDocumentPicker } from './generated-document-picker';
import { LinkedCompanySignerQuickAdd } from './linked-company-signer-quick-add';
import { DocumentTable } from './step-upload-document-table';
import { RecipientRow } from './step-upload-recipient-row';
import { StepUploadSignerList } from './step-upload-signer-list';
import {
  DEFAULT_RECIPIENT_FORM,
  EDITABLE_CONTROL_CLASS_NAME,
  RECIPIENT_ACCENT_COLORS,
  SIGNING_ORDER_PILL_LABELS,
  arraysEqual,
  buildReorderRecipientsPayload,
  buildSignerGroups,
  dateInputValueToIso,
  flattenSignerGroups,
  getNextSigningOrder,
  isValidEmail,
  normalizeEmail,
  parseCompletionCopyEmails,
  parseOptionalWholeNumber,
  reconcileSignerGroups,
  signerGroupsEqual,
  splitFullName,
  toDateInputValue,
} from './step-upload-helpers';

interface EsigningStepUploadProps {
  envelope: EsigningEnvelopeDetailDto;
  currentUser?: { firstName: string; lastName: string; email: string } | null;
  onUpdateSettings: (settings: UpdateEsigningEnvelopeInput) => Promise<void>;
  isUpdating: boolean;
  onUploadDocuments: (files: FileList) => Promise<void>;
  isUploading: boolean;
  onReorderDocument?: (documentId: string, sortOrder: number) => Promise<void>;
  onToggleDocumentVisibility?: (
    documentId: string,
    visibility: 'SIGNER_ONLY' | 'EVERYONE'
  ) => Promise<void>;
  onRenameDocument?: (documentId: string, fileName: string) => Promise<void>;
  isUpdatingDocument?: boolean;
  onAttachGeneratedDocuments?: (documentIds: string[]) => Promise<void>;
  isAttachingGeneratedDocuments?: boolean;
  onDeleteDocument: (documentId: string) => void;
  onAddRecipient: (data: EsigningRecipientInput) => Promise<void>;
  onReorderRecipients: (payload: ReorderEsigningRecipientsPayload) => Promise<void>;
  isReorderingRecipients: boolean;
  onEditRecipient: (recipientId: string) => void;
  onRemoveRecipient: (recipientId: string) => void;
  onNext: () => void;
  onBack: () => void;
}

// ——— Main component ———

export function EsigningStepUpload({
  envelope,
  currentUser,
  onUpdateSettings,
  isUpdating,
  onUploadDocuments,
  isUploading,
  onReorderDocument = async () => undefined,
  onToggleDocumentVisibility = async () => undefined,
  onRenameDocument = async () => undefined,
  isUpdatingDocument = false,
  onAttachGeneratedDocuments = async () => undefined,
  isAttachingGeneratedDocuments = false,
  onDeleteDocument,
  onAddRecipient,
  onReorderRecipients,
  isReorderingRecipients,
  onEditRecipient,
  onRemoveRecipient,
  onNext,
  onBack,
}: EsigningStepUploadProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const createContactMutation = useCreateContact();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);
  const completionBccPreference = useUserPreference<EsigningCompletionBccPreference>(
    ESIGNING_COMPLETION_BCC_PREFERENCE_KEY,
  );
  const saveCompletionBccPreference = useUpsertUserPreference<EsigningCompletionBccPreference>();
  const defaultCompletionBccEmails = useMemo(
    () => parseEsigningCompletionBccPreference(completionBccPreference.data?.value).emails,
    [completionBccPreference.data?.value],
  );
  const wordUploadEnabled = useEsigningWordUploadAvailability(activeTenantId);
  const uploadAccept = getEsigningUploadAccept(wordUploadEnabled);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSyncedEnvelopeIdRef = useRef<string | null>(null);
  const persistedSignerGroupsRef = useRef<string[][]>([]);
  const signerRecipientIdsRef = useRef<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isGeneratedDocumentPickerOpen, setIsGeneratedDocumentPickerOpen] = useState(false);

  // Settings form local state
  const [title, setTitle] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [completionCopyEmailsText, setCompletionCopyEmailsText] = useState('');
  const [message, setMessage] = useState('');
  const [signingOrder, setSigningOrder] = useState<EsigningSigningOrder>('PARALLEL');
  const [expiresAt, setExpiresAt] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [reminderFrequencyDays, setReminderFrequencyDays] = useState('');
  const [reminderStartDays, setReminderStartDays] = useState('');
  const [expiryWarningDays, setExpiryWarningDays] = useState('');
  const [isSettingsDirty, setIsSettingsDirty] = useState(false);
  const [settingsErrors, setSettingsErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const parsedCompletionBcc = useMemo(
    () => parseCompletionCopyEmails(completionCopyEmailsText),
    [completionCopyEmailsText],
  );
  const completionBccMatchesDefault = parsedCompletionBcc.invalid.length === 0
    && arraysEqual(parsedCompletionBcc.emails, defaultCompletionBccEmails);
  const titleRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const emailSubjectRef = useRef<HTMLInputElement>(null);
  const reminderFrequencyRef = useRef<HTMLInputElement>(null);
  const reminderStartRef = useRef<HTMLInputElement>(null);
  const expiryWarningRef = useRef<HTMLInputElement>(null);
  const completionCopyEmailsRef = useRef<HTMLTextAreaElement>(null);

  // Recipient state
  const [isAddingRecipient, setIsAddingRecipient] = useState(false);
  const [newRecipient, setNewRecipient] = useState(DEFAULT_RECIPIENT_FORM);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [selectedContact, setSelectedContact] = useState<SearchableContact | null>(null);
  const [selectedContactDefaultEmailDetailId, setSelectedContactDefaultEmailDetailId] = useState<string | null>(null);
  const [isSavingContactEmail, setIsSavingContactEmail] = useState(false);
  const [selfSignNotice, setSelfSignNotice] = useState(false);
  const [pendingSignerGroups, setPendingSignerGroups] = useState<string[][]>([]);
  const hasSelectedContactEmailChanges = Boolean(
    selectedContact && normalizeEmail(newRecipient.email) !== normalizeEmail(selectedContact.defaultEmail ?? '')
  );
  const [linkedCompanyName, setLinkedCompanyName] = useState<string | null>(envelope.companyName);
  const linkedCompanyOptions = useMemo(
    () => (envelope.companyId && envelope.companyName
      ? [toCompanySearchOption({ id: envelope.companyId, name: envelope.companyName })]
      : undefined),
    [envelope.companyId, envelope.companyName],
  );

  // Initialize from envelope
  useEffect(() => {
    const isDifferentEnvelope = lastSyncedEnvelopeIdRef.current !== envelope.id;
    if (isSettingsDirty && !isDifferentEnvelope) {
      return;
    }

    setTitle(envelope.title);
    setEmailSubject(envelope.emailSubject || envelope.title);
    setCompletionCopyEmailsText((envelope.completionCopyEmails ?? []).join(', '));
    setMessage(envelope.message ?? '');
    setSigningOrder(envelope.signingOrder);
    setExpiresAt(toDateInputValue(envelope.expiresAt));
    setCompanyId(envelope.companyId ?? '');
    setLinkedCompanyName(envelope.companyName);
    setReminderFrequencyDays(envelope.reminderFrequencyDays?.toString() ?? '');
    setReminderStartDays(envelope.reminderStartDays?.toString() ?? '');
    setExpiryWarningDays(envelope.expiryWarningDays?.toString() ?? '');
    setIsSettingsDirty(false);
    lastSyncedEnvelopeIdRef.current = envelope.id;
  }, [envelope, isSettingsDirty]);

  useEffect(() => {
    if (isSettingsDirty) {
      setSubmitError(null);
    }
  }, [isSettingsDirty]);

  const signerRecipients = useMemo(
    () => envelope.recipients.filter((recipient) => recipient.type === 'SIGNER'),
    [envelope.recipients]
  );
  const signerRecipientIds = useMemo(
    () => signerRecipients.map((recipient) => recipient.id),
    [signerRecipients]
  );
  const persistedSignerGroups = useMemo(
    () => buildSignerGroups(signerRecipients, envelope.signingOrder),
    [envelope.signingOrder, signerRecipients]
  );
  const reconciledPendingSignerGroups = useMemo(
    () => reconcileSignerGroups(pendingSignerGroups, signerRecipientIds),
    [pendingSignerGroups, signerRecipientIds]
  );
  const orderedSignerRecipients = useMemo(() => {
    const signerMap = new Map(signerRecipients.map((recipient) => [recipient.id, recipient]));
    const ordered = flattenSignerGroups(reconciledPendingSignerGroups)
      .map((recipientId) => signerMap.get(recipientId))
      .filter((recipient): recipient is EsigningEnvelopeRecipientDto => Boolean(recipient));
    const remaining = signerRecipients.filter((recipient) => !ordered.some((entry) => entry.id === recipient.id));
    return [...ordered, ...remaining];
  }, [reconciledPendingSignerGroups, signerRecipients]);
  const mixedSignerGroups = useMemo(() => {
    const signerMap = new Map(signerRecipients.map((recipient) => [recipient.id, recipient]));

    return reconciledPendingSignerGroups.map((group, groupIndex) => ({
      groupIndex,
      recipientIds: group,
      recipients: group
        .map((recipientId) => signerMap.get(recipientId))
        .filter((recipient): recipient is EsigningEnvelopeRecipientDto => Boolean(recipient)),
    }));
  }, [reconciledPendingSignerGroups, signerRecipients]);
  const ccRecipients = useMemo(
    () => envelope.recipients.filter((recipient) => recipient.type === 'CC'),
    [envelope.recipients]
  );
  const hasEmailRecipients = useMemo(
    () => envelope.recipients.some((recipient) => (
      recipient.accessMode === 'EMAIL_LINK' || recipient.accessMode === 'EMAIL_WITH_CODE'
    )),
    [envelope.recipients]
  );
  const hasSigner = signerRecipients.length > 0;
  const hasDocument = envelope.documents.length > 0;
  const canProceed = hasDocument && hasSigner;
  const newRecipientRequiresEmail = newRecipient.type === 'CC' || newRecipient.accessMode !== 'MANUAL_LINK';
  const signerStructureSignature = useMemo(
    () =>
      `${envelope.signingOrder}:${signerRecipients
        .map((recipient) => `${recipient.id}:${recipient.signingOrder ?? 'null'}`)
        .join('|')}`,
    [envelope.signingOrder, signerRecipients]
  );
  persistedSignerGroupsRef.current = persistedSignerGroups;
  signerRecipientIdsRef.current = signerRecipientIds;

  useEffect(() => {
    setPendingSignerGroups((current) => {
      const latestPersistedSignerGroups = persistedSignerGroupsRef.current;
      const latestSignerRecipientIds = signerRecipientIdsRef.current;

      if (current.length === 0) {
        return signerGroupsEqual(current, latestPersistedSignerGroups)
          ? current
          : latestPersistedSignerGroups;
      }

      const next = reconcileSignerGroups(current, latestSignerRecipientIds);
      return signerGroupsEqual(next, current) ? current : next;
    });
  }, [signerStructureSignature]);

  async function persistSignerGroups(groups: string[][]) {
    if (signingOrder === 'PARALLEL') {
      return;
    }

    if (envelope.signingOrder !== signingOrder) {
      return;
    }

    const nextPayload = buildReorderRecipientsPayload(groups, signingOrder);
    const persistedPayload = buildReorderRecipientsPayload(persistedSignerGroups, envelope.signingOrder);

    if (JSON.stringify(nextPayload) === JSON.stringify(persistedPayload)) {
      return;
    }

    await onReorderRecipients(nextPayload);
  }

  async function handleNext() {
    const completionCopyEmailParse = parsedCompletionBcc;
    if (completionCopyEmailParse.invalid.length > 0) {
      const message = `Enter valid email addresses: ${completionCopyEmailParse.invalid.join(', ')}`;
      setSettingsErrors({ completionCopyEmails: message });
      setSubmitError('Please correct the highlighted settings before continuing.');
      requestAnimationFrame(() => completionCopyEmailsRef.current?.focus());
      return;
    }

    const payload: UpdateEsigningEnvelopeInput = {
      title: title.trim(),
      emailSubject: emailSubject.trim(),
      message: message.trim() || null,
      companyId: companyId || null,
      signingOrder,
      expiresAt: dateInputValueToIso(expiresAt),
      reminderFrequencyDays: parseOptionalWholeNumber(reminderFrequencyDays),
      reminderStartDays: parseOptionalWholeNumber(reminderStartDays),
      expiryWarningDays: parseOptionalWholeNumber(expiryWarningDays),
      completionCopyEmails: completionCopyEmailParse.emails,
    };

    const parsed = updateEsigningEnvelopeSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!fieldErrors[key]) {
          fieldErrors[key] = issue.message;
        }
      }
      setSettingsErrors(fieldErrors);
      setSubmitError('Please correct the highlighted settings before continuing.');
      requestAnimationFrame(() => {
        const firstInvalidField = ['title', 'emailSubject', 'message', 'completionCopyEmails', 'reminderFrequencyDays', 'reminderStartDays', 'expiryWarningDays']
          .find((key) => fieldErrors[key]);
        if (firstInvalidField === 'title') {
          titleRef.current?.focus();
        } else if (firstInvalidField === 'emailSubject') {
          emailSubjectRef.current?.focus();
        } else if (firstInvalidField === 'message') {
          messageRef.current?.focus();
        } else if (firstInvalidField === 'completionCopyEmails') {
          completionCopyEmailsRef.current?.focus();
        } else if (firstInvalidField === 'reminderFrequencyDays') {
          reminderFrequencyRef.current?.focus();
        } else if (firstInvalidField === 'reminderStartDays') {
          reminderStartRef.current?.focus();
        } else if (firstInvalidField === 'expiryWarningDays') {
          expiryWarningRef.current?.focus();
        }
      });
      return;
    }

    setSettingsErrors({});
    setSubmitError(null);

    try {
      await onUpdateSettings(payload);
      setIsSettingsDirty(false);
      if (
        signingOrder !== 'PARALLEL' &&
        orderedSignerRecipients.length > 0 &&
        (envelope.signingOrder !== signingOrder ||
          !signerGroupsEqual(reconciledPendingSignerGroups, persistedSignerGroups))
      ) {
        await onReorderRecipients(
          buildReorderRecipientsPayload(reconciledPendingSignerGroups, signingOrder)
        );
      }
      onNext();
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'Failed to save settings. Please try again.'
      );
    }
  }

  async function handleSetCompletionBccDefault() {
    const parsed = parsedCompletionBcc;
    if (parsed.invalid.length > 0) {
      const message = `Enter valid email addresses: ${parsed.invalid.join(', ')}`;
      setSettingsErrors((current) => ({ ...current, completionCopyEmails: message }));
      completionCopyEmailsRef.current?.focus();
      return;
    }

    try {
      await saveCompletionBccPreference.mutateAsync({
        key: ESIGNING_COMPLETION_BCC_PREFERENCE_KEY,
        value: { version: 1, emails: parsed.emails },
      });
      toast.success(parsed.emails.length > 0
        ? 'Completion BCC default saved'
        : 'Completion BCC default cleared');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save Completion BCC default');
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLElement>) {
    if (!envelope.canEdit || isUploading) {
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLElement>) {
    const nextTarget = e.relatedTarget;
    if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) {
      return;
    }
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent<HTMLElement>) {
    if (!envelope.canEdit || isUploading) {
      return;
    }

    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      if (!validateUploadFiles(e.dataTransfer.files)) {
        return;
      }
      void onUploadDocuments(e.dataTransfer.files);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      if (!validateUploadFiles(e.target.files)) {
        e.currentTarget.value = '';
        return;
      }
      void onUploadDocuments(e.target.files);
      e.currentTarget.value = '';
    }
  }

  function validateUploadFiles(files: FileList): boolean {
    const invalidFile = Array.from(files).find(
      (file) => !isAllowedEsigningUploadFile(file, { wordUploadEnabled })
    );

    if (!invalidFile) {
      return true;
    }

    toast.error(
      wordUploadEnabled
        ? 'Upload a PDF, DOCX, or DOC document.'
        : 'Word upload requires a valid SharePoint or OneDrive connector. Upload a PDF instead.'
    );
    return false;
  }

  async function handleAttachGeneratedDocuments(documentIds: string[]) {
    try {
      await onAttachGeneratedDocuments(documentIds);
      setIsGeneratedDocumentPickerOpen(false);
      toast.success(
        documentIds.length === 1
          ? 'Generated document added'
          : `${documentIds.length} generated documents added`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add generated documents');
    }
  }

  async function moveSequentialSigner(recipientId: string, direction: -1 | 1) {
    const flat = flattenSignerGroups(reconciledPendingSignerGroups);
    const currentIndex = flat.indexOf(recipientId);
    const targetIndex = currentIndex + direction;
    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= flat.length) return;
    const nextOrder = arrayMove(flat, currentIndex, targetIndex);
    const nextGroups = nextOrder.map((id) => [id]);
    const previousGroups = reconciledPendingSignerGroups;
    setPendingSignerGroups(nextGroups);
    try {
      await persistSignerGroups(nextGroups);
    } catch (error) {
      setPendingSignerGroups(previousGroups);
      toast.error(error instanceof Error ? error.message : 'Failed to reorder signers');
    }
  }

async function applyMixedGroupChange(
    updater: (groups: string[][]) => string[][],
    fallbackMessage: string
  ) {
    const previousGroups = reconciledPendingSignerGroups;
    const nextGroups = reconcileSignerGroups(updater(previousGroups), signerRecipientIds);

    if (signerGroupsEqual(previousGroups, nextGroups)) {
      return;
    }

    setPendingSignerGroups(nextGroups);

    try {
      await persistSignerGroups(nextGroups);
    } catch (error) {
      setPendingSignerGroups(previousGroups);
      toast.error(error instanceof Error ? error.message : fallbackMessage);
    }
  }

  function handleCycleSigningOrder() {
    if (!envelope.canEdit) {
      return;
    }

    setSigningOrder((current) => getNextSigningOrder(current));
    setIsSettingsDirty(true);
  }

  function resetRecipientDraft() {
    setNewRecipient(DEFAULT_RECIPIENT_FORM);
    setSelectedContactId('');
    setSelectedContact(null);
    setSelectedContactDefaultEmailDetailId(null);
  }

  async function handleConfirmNewRecipient() {
    if (!newRecipient.name.trim()) {
      toast.error('Recipient name is required');
      return;
    }

    const requiresEmail = newRecipient.type === 'CC' || newRecipient.accessMode !== 'MANUAL_LINK';
    const trimmedEmail = newRecipient.email.trim();
    if (requiresEmail && !trimmedEmail) {
      toast.error('Recipient email is required for this access method');
      return;
    }

    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
      toast.error('Enter a valid recipient email address');
      return;
    }

    if (
      newRecipient.accessMode === 'EMAIL_WITH_CODE' &&
      newRecipient.accessCode.trim().length < ESIGNING_LIMITS.MIN_ACCESS_CODE_LENGTH
    ) {
      toast.error(`Access code must be at least ${ESIGNING_LIMITS.MIN_ACCESS_CODE_LENGTH} characters`);
      return;
    }

    const normalizedEmail = normalizeEmail(trimmedEmail);
    const isDuplicateSigner =
      newRecipient.type === 'SIGNER' &&
      Boolean(normalizedEmail) &&
      envelope.recipients.some(
        (recipient) => recipient.type === 'SIGNER' && normalizeEmail(recipient.email) === normalizedEmail
      );

    if (isDuplicateSigner) {
      toast.error(`${newRecipient.email.trim()} is already listed as a signer on this envelope`);
      return;
    }

    const payload: EsigningRecipientInput = {
      name: newRecipient.name.trim(),
      email: normalizedEmail || null,
      type: newRecipient.type,
      signingOrder: null,
      accessMode: newRecipient.accessMode,
      accessCode: newRecipient.accessCode.trim() || undefined,
    };
    try {
      await onAddRecipient(payload);
      resetRecipientDraft();
      setIsAddingRecipient(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add recipient');
    }
  }

  async function handleSelfSign() {
    if (!currentUser) return;
    const normalizedEmail = normalizeEmail(currentUser.email);
    const alreadySigner = envelope.recipients.some(
      (recipient) => recipient.type === 'SIGNER' && normalizeEmail(recipient.email) === normalizedEmail
    );

    if (alreadySigner) {
      toast.error('You are already listed as a signer on this envelope');
      return;
    }

    const payload: EsigningRecipientInput = {
      name: `${currentUser.firstName} ${currentUser.lastName}`.trim(),
      email: currentUser.email,
      type: 'SIGNER',
      signingOrder: null,
      accessMode: 'MANUAL_LINK',
    };
    await onAddRecipient(payload);
    setSelfSignNotice(true);
    setTimeout(() => setSelfSignNotice(false), 3000);
  }

  function handleContactSelect(contactId: string, contact: SearchableContact | null) {
    setSelectedContactId(contactId);
    setSelectedContact(contact);
    setSelectedContactDefaultEmailDetailId(null);

    if (!contact) {
      return;
    }

    setNewRecipient((prev) => ({
      ...prev,
      name: contact.fullName || prev.name,
      email: contact.defaultEmail || prev.email,
    }));

    if (!contact.defaultEmail && (newRecipient.type === 'CC' || newRecipient.accessMode !== 'MANUAL_LINK')) {
      toast.error('This contact does not have a default email. Add one in Contacts or enter it manually.');
    }

    const groupedUrl = activeTenantId
      ? `/api/contacts/${contactId}/contact-details?grouped=true&tenantId=${encodeURIComponent(activeTenantId)}`
      : `/api/contacts/${contactId}/contact-details?grouped=true`;

    void fetch(groupedUrl, { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to fetch contact details');
        }

        return response.json() as Promise<{
          defaultDetails?: Array<{ id: string; detailType: string; value: string }>;
        }>;
      })
      .then((data) => {
        const defaultEmailDetail = data.defaultDetails?.find((detail) => detail.detailType === 'EMAIL') ?? null;
        setSelectedContactDefaultEmailDetailId(defaultEmailDetail?.id ?? null);
        if (defaultEmailDetail?.value) {
          setSelectedContact((prev) => (prev ? { ...prev, defaultEmail: defaultEmailDetail.value } : prev));
          setNewRecipient((prev) => ({
            ...prev,
            email: defaultEmailDetail.value || prev.email,
          }));
        }
      })
      .catch(() => {
        // Keep the recipient form usable even if contact detail lookup fails.
      });
  }

  async function handleSaveContactEmail() {
    if (!selectedContactId) {
      toast.error('Select a contact first');
      return;
    }

    const nextEmail = newRecipient.email.trim();
    if (!isValidEmail(nextEmail)) {
      toast.error('Enter a valid email address before saving it to the contact');
      return;
    }

    setIsSavingContactEmail(true);
    try {
      const url = selectedContactDefaultEmailDetailId
        ? `/api/contacts/${selectedContactId}/contact-details/${selectedContactDefaultEmailDetailId}`
        : `/api/contacts/${selectedContactId}/contact-details`;
      const payload = selectedContactDefaultEmailDetailId
        ? { value: nextEmail, isPrimary: true, tenantId: activeTenantId }
        : { detailType: 'EMAIL', value: nextEmail, isPrimary: true, purposes: [], tenantId: activeTenantId };

      const response = await fetch(url, {
        method: selectedContactDefaultEmailDetailId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save contact email');
      }

      if (!selectedContactDefaultEmailDetailId && typeof data.id === 'string') {
        setSelectedContactDefaultEmailDetailId(data.id);
      }

      setSelectedContact((prev) => (prev ? { ...prev, defaultEmail: nextEmail } : prev));
      await queryClient.invalidateQueries({ queryKey: ['contacts'] });
      await queryClient.invalidateQueries({ queryKey: ['contact', selectedContactId] });
      toast.success('Default email saved to contact');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save contact email');
    } finally {
      setIsSavingContactEmail(false);
    }
  }

  async function handleQuickAddContact() {
    const contactName = newRecipient.name.trim();
    const contactEmail = newRecipient.email.trim();

    if (!contactName) {
      toast.error('Enter the signer name before creating a contact');
      return;
    }

    if (contactEmail && !isValidEmail(contactEmail)) {
      toast.error('Enter a valid signer email before creating a contact');
      return;
    }
    if (!contactEmail && (newRecipient.type !== 'SIGNER' || newRecipient.accessMode !== 'MANUAL_LINK')) {
      toast.error('Enter a signer email before creating a contact');
      return;
    }

    if (session?.isSuperAdmin && !activeTenantId) {
      toast.error('Workspace context is required before creating a contact');
      return;
    }

    const { firstName, lastName } = splitFullName(contactName);
    if (!firstName) {
      toast.error('Enter the signer name before creating a contact');
      return;
    }

    try {
      const createdContact = await createContactMutation.mutateAsync({
        contactType: 'INDIVIDUAL',
        firstName,
        lastName,
        contactDetails: contactEmail
          ? [{ detailType: 'EMAIL', value: contactEmail, isPrimary: true, purposes: [] }]
          : [],
        tenantId: activeTenantId || undefined,
      });

      handleContactSelect(createdContact.id, {
        ...createdContact,
        defaultEmail: contactEmail || null,
        defaultPhone: null,
      });
      toast.success('Contact created and selected for this signer');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create contact');
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-[1550px] grid-cols-1 items-start gap-4 p-4 sm:gap-6 sm:p-6 lg:grid-cols-2">

      {/* ——— Section 1: Documents ——— */}
      <div
        data-testid="esigning-documents-drop-zone"
        className="relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
      <CompanyAccentSection
        title={`Documents${envelope.documents.length > 0 ? ` (${envelope.documents.length})` : ''}`}
        className="overflow-visible"
        actions={envelope.canEdit ? (
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded border border-white/50 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-white/10"
            >
              <Upload className="h-3.5 w-3.5" />
              Add more
            </button>
            <button
              type="button"
              onClick={() => setIsGeneratedDocumentPickerOpen(true)}
              disabled={isAttachingGeneratedDocuments}
              className="inline-flex items-center gap-1.5 rounded border border-white/50 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FileText className="h-3.5 w-3.5" />
              Add from Generated documents
            </button>
          </div>
        ) : undefined}
      >
        <div className="space-y-4 p-4 sm:p-5">

        <button
          type="button"
          onClick={() => !isUploading && fileInputRef.current?.click()}
          disabled={isUploading}
          aria-describedby="esigning-upload-help"
          className={cn(
            'flex min-h-[88px] w-full flex-col items-center justify-center rounded-xl border border-dashed px-4 py-3 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70',
            isUploading
              ? 'cursor-wait border-oak-primary bg-oak-primary/5'
              : 'cursor-pointer border-border-primary bg-background-primary hover:border-oak-primary/50 hover:bg-background-tertiary',
          )}
        >
          {isUploading ? (
            <Loader2 className="mb-1 h-5 w-5 animate-spin text-oak-primary" />
          ) : (
            <Upload className="mb-1 h-5 w-5 text-text-muted" />
          )}
          <p className="text-sm font-medium text-text-primary">
            {isUploading
              ? 'Uploading...'
              : wordUploadEnabled
                ? 'Drop PDF or Word documents here'
                : 'Drop PDF documents here'}
          </p>
          <span id="esigning-upload-help" className="mt-0.5 text-xs text-text-muted">
            {wordUploadEnabled ? 'PDF, DOCX, or DOC' : 'PDF only'} - max {ESIGNING_LIMITS.MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB each
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={uploadAccept}
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Document table */}
        {envelope.documents.length > 0 && (
          <DocumentTable
            documents={envelope.documents}
            canEdit={envelope.canEdit}
            isUpdating={isUpdatingDocument}
            onReorder={onReorderDocument}
            onToggleVisibility={onToggleDocumentVisibility}
            onRename={onRenameDocument}
            onDelete={onDeleteDocument}
          />
        )}
        </div>
      </CompanyAccentSection>
      {isDragging && envelope.canEdit && !isUploading ? (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-oak-primary bg-oak-primary/10 backdrop-blur-[1px]">
          <div className="rounded-xl bg-background-secondary px-4 py-3 text-center shadow-sm">
            <Upload className="mx-auto mb-1 h-5 w-5 text-oak-primary" />
            <p className="text-sm font-medium text-text-primary">Release to upload documents</p>
          </div>
        </div>
      ) : null}
      </div>

      <GeneratedDocumentPicker
        isOpen={isGeneratedDocumentPickerOpen}
        onClose={() => setIsGeneratedDocumentPickerOpen(false)}
        onConfirm={handleAttachGeneratedDocuments}
        tenantId={activeTenantId}
        attachedDocumentIds={envelope.documents
          .map((document) => document.generatedDocumentId)
          .filter((documentId): documentId is string => Boolean(documentId))}
        isConfirming={isAttachingGeneratedDocuments}
      />

      {/* ——— Section 2: Recipients ——— */}
      <CompanyAccentSection
        title="Add recipients"
        actions={envelope.canEdit ? (
          <div className="flex flex-col items-end gap-0.5 text-right">
              <button
                type="button"
                onClick={handleCycleSigningOrder}
                title="Click to cycle signing order: Parallel → Sequential → Mixed"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded border border-white/50 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-white/10 active:scale-95',
                  signingOrder === 'PARALLEL' && 'border-white/50 bg-white/10 text-white',
                  signingOrder === 'SEQUENTIAL' && 'border-white/50 bg-white/10 text-white',
                  signingOrder === 'MIXED' && 'border-amber-200/70 bg-amber-400/20 text-white'
                )}
              >
                <span className="opacity-75">Order:</span> {SIGNING_ORDER_PILL_LABELS[signingOrder]}
                <ChevronDown className="h-3 w-3 opacity-75" />
              </button>
              <span className="text-[11px] font-normal text-white/75">
                Click to change signing order
              </span>
            </div>
        ) : undefined}
      >
        <div className="space-y-4 p-4 sm:p-5">

        <div className="space-y-2">
          <div>
            <span className="text-xs font-medium text-text-secondary">Linked company</span>
            <p className="mt-0.5 text-xs text-text-muted">
              Select a company to surface its linked contacts for one-click signer selection.
            </p>
          </div>
          <CompanySelect
            value={companyId}
            onChange={(nextCompanyId, company) => {
              setCompanyId(nextCompanyId);
              setLinkedCompanyName(company?.name ?? null);
              setIsSettingsDirty(true);
            }}
            pinned={linkedCompanyOptions}
            allowReselect
            disabled={!envelope.canEdit}
            placeholder="Optional company link"
            controlClassName={envelope.canEdit ? EDITABLE_CONTROL_CLASS_NAME : undefined}
          />
          {companyId ? (
            <CompanySharePointMappingNotice companyId={companyId} companyName={linkedCompanyName ?? undefined} />
          ) : null}
        </div>

        {companyId ? (
          <LinkedCompanySignerQuickAdd
            companyId={companyId}
            companyName={linkedCompanyName ?? undefined}
            recipients={envelope.recipients}
            canEdit={envelope.canEdit}
            onAddRecipient={onAddRecipient}
          />
        ) : null}

        {/* Self-sign row — hidden if user is already a signer */}
        {currentUser && envelope.canEdit && !envelope.recipients.some(
          (r) => r.type === 'SIGNER' && normalizeEmail(r.email) === normalizeEmail(currentUser.email)
        ) && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleSelfSign()}
              className="inline-flex items-center gap-2 rounded-xl border border-border-primary bg-background-primary px-4 py-2 text-sm text-text-primary hover:bg-background-tertiary transition-colors"
            >
              <UserPlus className="h-4 w-4 text-text-muted" />
              I&apos;m signing this document
            </button>
            {selfSignNotice && (
              <span className="text-xs text-green-600">You&apos;ve been added as a signer.</span>
            )}
          </div>
        )}

        {/* Existing recipients */}
        {envelope.recipients.length > 0 && (
          <div className="space-y-4">
            {orderedSignerRecipients.length > 0 && (
              <StepUploadSignerList
                canEdit={envelope.canEdit}
                savedSigningOrder={envelope.signingOrder}
                signingOrder={signingOrder}
                isReorderingRecipients={isReorderingRecipients}
                mixedSignerGroups={mixedSignerGroups}
                orderedSignerRecipients={orderedSignerRecipients}
                onMixedGroupChange={applyMixedGroupChange}
                onMoveSequentialSigner={moveSequentialSigner}
                onEditRecipient={onEditRecipient}
                onRemoveRecipient={onRemoveRecipient}
              />
            )}

            {ccRecipients.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-text-primary">Receives copy</h3>
                {ccRecipients.map((recipient, idx) => (
                  <RecipientRow
                    key={recipient.id}
                    recipient={recipient}
                    index={idx}
                    accentColor={RECIPIENT_ACCENT_COLORS[(orderedSignerRecipients.length + idx) % RECIPIENT_ACCENT_COLORS.length]}
                    canEdit={envelope.canEdit}
                    showIndex={false}
                    onEdit={() => onEditRecipient(recipient.id)}
                    onRemove={() => onRemoveRecipient(recipient.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* New recipient inline form */}
        {isAddingRecipient && (
          <div className="overflow-hidden rounded-2xl border border-border-primary bg-background-primary shadow-sm">
            <div className="flex min-h-12 items-center justify-between gap-2 bg-oak-primary px-4 py-3 text-white">
              <h3 className="text-sm font-semibold leading-5">New recipient</h3>
              <button
                type="button"
                onClick={() => { setIsAddingRecipient(false); resetRecipientDraft(); }}
                className="rounded-lg p-1 text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Close new recipient form"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 p-4">

            {newRecipient.type === 'SIGNER' && (
              <ContactSearchSelect
                key={`recipient-contact-${selectedContactId || 'empty'}`}
                label="Select from Contacts (optional)"
                value={selectedContactId}
                onChange={handleContactSelect}
                placeholder="Search contacts for signer..."
                controlClassName={cn('!h-10 !min-h-0', EDITABLE_CONTROL_CLASS_NAME)}
              />
            )}

            <div className="flex min-w-0 items-end gap-2">
              <div className="min-w-0 flex-1">
                <FormInput
                  label="Full name"
                  inputSize="lg"
                  placeholder="e.g. Jane Smith"
                  value={newRecipient.name}
                  onChange={(e) => setNewRecipient((prev) => ({ ...prev, name: e.target.value }))}
                  className={EDITABLE_CONTROL_CLASS_NAME}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3" data-testid="recipient-details-row">
              <FormInput
                label="Email address"
                inputSize="lg"
                type="email"
                placeholder="e.g. jane@example.com"
                value={newRecipient.email}
                onChange={(e) => setNewRecipient((prev) => ({ ...prev, email: e.target.value }))}
                required={newRecipientRequiresEmail}
                hint={
                  newRecipient.type === 'CC'
                    ? 'Required. The completed signed package is emailed after signing.'
                    : newRecipientRequiresEmail
                      ? undefined
                      : 'Optional for manual-link recipients.'
                }
                className={EDITABLE_CONTROL_CLASS_NAME}
              />
              <label className="flex flex-col gap-2 text-xs font-medium text-text-secondary">
                Role
                <select
                  value={newRecipient.type}
                  onChange={(e) => {
                    const nextType = e.target.value as EsigningRecipientType;
                    setNewRecipient((prev) => ({
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
                    if (nextType !== 'SIGNER') {
                      setSelectedContactId('');
                      setSelectedContact(null);
                      setSelectedContactDefaultEmailDetailId(null);
                    }
                  }}
                  className={cn(
                    'h-10 rounded-lg border border-border-primary bg-background-secondary px-3 text-sm text-text-primary',
                    EDITABLE_CONTROL_CLASS_NAME,
                  )}
                >
                  {Object.entries(ESIGNING_RECIPIENT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-xs font-medium text-text-secondary">
                Access method
                <select
                  value={newRecipient.accessMode}
                  onChange={(e) => setNewRecipient((prev) => ({ ...prev, accessMode: e.target.value as EsigningRecipientAccessMode }))}
                  disabled={newRecipient.type === 'CC'}
                  className={cn(
                    'h-10 rounded-lg border border-border-primary bg-background-secondary px-3 text-sm text-text-primary',
                    EDITABLE_CONTROL_CLASS_NAME,
                  )}
                >
                  {Object.entries(ESIGNING_ACCESS_MODE_LABELS)
                    .filter(([value]) => newRecipient.type !== 'CC' || value === 'EMAIL_LINK')
                    .map(([value, label]) => (
                      <option key={value} value={value}>
                        {newRecipient.type === 'CC' && value === 'EMAIL_LINK' ? 'Email' : label}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            {newRecipient.type === 'CC' ? (
              <p className="text-xs text-text-muted">
                Receives Copy is emailed the completed signed package after signing finishes.
                Document visibility controls signer access and does not limit this completion copy.
              </p>
            ) : null}

            {newRecipient.accessMode === 'EMAIL_WITH_CODE' && (
              <FormInput
                label="Access code"
                inputSize="lg"
                placeholder={`Min ${ESIGNING_LIMITS.MIN_ACCESS_CODE_LENGTH} characters`}
                value={newRecipient.accessCode}
                onChange={(e) => setNewRecipient((prev) => ({ ...prev, accessCode: e.target.value }))}
                className={EDITABLE_CONTROL_CLASS_NAME}
              />
            )}

            <div className="flex justify-end gap-2 border-t border-border-primary pt-3" data-testid="recipient-actions">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => { setIsAddingRecipient(false); resetRecipientDraft(); }}
              >
                Cancel
              </Button>
              {newRecipient.type === 'SIGNER' && !selectedContact && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleQuickAddContact()}
                  isLoading={createContactMutation.isPending}
                  disabled={createContactMutation.isPending}
                >
                  Quick add
                </Button>
              )}
              {newRecipient.type === 'SIGNER' && selectedContact && hasSelectedContactEmailChanges && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleSaveContactEmail()}
                  isLoading={isSavingContactEmail}
                  disabled={isSavingContactEmail || !newRecipient.email.trim()}
                >
                  Update contact
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                leftIcon={<Check className="h-4 w-4" />}
                onClick={() => void handleConfirmNewRecipient()}
              >
                Add recipient
              </Button>
            </div>
            </div>
          </div>
        )}

        {/* Add recipient button */}
        {envelope.canEdit && !isAddingRecipient && (
          <button
            type="button"
            onClick={() => setIsAddingRecipient(true)}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-dashed border-border-primary px-4 py-2 text-sm text-text-primary hover:border-oak-primary/50 hover:bg-background-tertiary transition-colors"
          >
            <UserPlus className="h-4 w-4 text-text-muted" />
            Add recipient
          </button>
        )}
        </div>
      </CompanyAccentSection>

      {/* ——— Section 3: Message ——— */}
      <CompanyAccentSection title="Email subject & message">
        <fieldset
          disabled={!envelope.canEdit || !hasEmailRecipients}
          className={cn('space-y-4 p-4 sm:p-5', !hasEmailRecipients && 'opacity-50')}
        >
          <legend className="sr-only">Email subject and message</legend>
          <p className="mt-0.5 text-xs text-text-muted">
            {hasEmailRecipients
              ? 'Shown in the signing request email sent to email recipients.'
              : 'Add an email recipient to customize the signing request email.'}
          </p>

          <FormInput
            label="Email subject"
            inputSize="lg"
            value={emailSubject}
            ref={emailSubjectRef}
            onChange={(e) => {
              setEmailSubject(e.target.value);
              setIsSettingsDirty(true);
            }}
            disabled={!envelope.canEdit || !hasEmailRecipients}
            error={settingsErrors.emailSubject}
            className={EDITABLE_CONTROL_CLASS_NAME}
          />

          <label className="flex flex-col gap-2 text-xs font-medium text-text-secondary">
            <span>Message</span>
            <textarea
              ref={messageRef}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setIsSettingsDirty(true);
              }}
              disabled={!envelope.canEdit || !hasEmailRecipients}
              rows={4}
              aria-invalid={settingsErrors.message ? 'true' : 'false'}
              className={cn(
                'rounded-xl border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary outline-none resize-none focus:border-oak-primary focus:ring-2 focus:ring-oak-primary/30 disabled:cursor-not-allowed disabled:opacity-60',
                EDITABLE_CONTROL_CLASS_NAME,
              )}
            />
            {settingsErrors.message ? (
              <span className="text-xs text-red-400">{settingsErrors.message}</span>
            ) : null}
          </label>
        </fieldset>
      </CompanyAccentSection>

      {/* ——— Section 4: Settings ——— */}
      <CompanyAccentSection title="Settings">
        <div className="space-y-4 p-4 sm:p-5">
          <FormInput
            label="Envelope name"
            inputSize="lg"
            value={title}
            ref={titleRef}
            onChange={(e) => {
              setTitle(e.target.value);
              setIsSettingsDirty(true);
            }}
            disabled={!envelope.canEdit}
            error={settingsErrors.title}
            className={EDITABLE_CONTROL_CLASS_NAME}
          />

          <SingleDateInput
            label="Expiration"
            value={expiresAt}
            onChange={(value) => {
              setExpiresAt(value);
              setIsSettingsDirty(true);
            }}
            disabled={!envelope.canEdit}
            placeholder="dd mmm yyyy"
            controlClassName={envelope.canEdit ? EDITABLE_CONTROL_CLASS_NAME : undefined}
          />

          <div className="space-y-2">
            <label htmlFor="completion-bcc-emails" className="block text-xs font-medium text-text-secondary">
              Completion BCC (optional)
            </label>
            <textarea
              id="completion-bcc-emails"
              ref={completionCopyEmailsRef}
              value={completionCopyEmailsText}
              onChange={(event) => {
                setCompletionCopyEmailsText(event.target.value);
                setIsSettingsDirty(true);
              }}
              disabled={!envelope.canEdit}
              placeholder="ops@example.com, legal@example.com"
              aria-label="Completion BCC"
              rows={3}
              className={cn(
                'w-full resize-y rounded-xl border border-border-primary bg-background-secondary px-3 py-2.5 text-sm text-text-primary outline-none transition focus:border-oak-primary focus:ring-2 focus:ring-oak-primary/20 disabled:cursor-not-allowed disabled:opacity-60',
                EDITABLE_CONTROL_CLASS_NAME,
              )}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <span className="block text-xs leading-5 text-text-muted">
                These addresses receive the completed envelope and signed PDFs by BCC. Their addresses are hidden from signers, the sender, and one another.
              </span>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                className="shrink-0 self-start"
                onClick={() => void handleSetCompletionBccDefault()}
                isLoading={saveCompletionBccPreference.isPending}
                disabled={
                  !envelope.canEdit
                  || completionBccMatchesDefault
                }
              >
                {defaultCompletionBccEmails.length > 0 ? 'Update default' : 'Set as default'}
              </Button>
            </div>
            {settingsErrors.completionCopyEmails ? (
              <span className="block text-xs text-red-400">{settingsErrors.completionCopyEmails}</span>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
              <FormInput
                label="Reminder every"
                inputSize="lg"
                type="number"
                ref={reminderFrequencyRef}
                min={1}
                max={30}
                value={reminderFrequencyDays}
                onChange={(e) => {
                  setReminderFrequencyDays(e.target.value);
                  setIsSettingsDirty(true);
                }}
                disabled={!envelope.canEdit}
                hint="Days between reminder emails."
                error={settingsErrors.reminderFrequencyDays}
                className={EDITABLE_CONTROL_CLASS_NAME}
              />
              <FormInput
                label="Start reminders after"
                inputSize="lg"
                type="number"
                ref={reminderStartRef}
                min={0}
                max={90}
                value={reminderStartDays}
                onChange={(e) => {
                  setReminderStartDays(e.target.value);
                  setIsSettingsDirty(true);
                }}
                disabled={!envelope.canEdit}
                hint="Days after send before reminders begin."
                error={settingsErrors.reminderStartDays}
                className={EDITABLE_CONTROL_CLASS_NAME}
              />
              <FormInput
                label="Warn before expiry"
                inputSize="lg"
                type="number"
                ref={expiryWarningRef}
                min={0}
                max={30}
                value={expiryWarningDays}
                onChange={(e) => {
                  setExpiryWarningDays(e.target.value);
                  setIsSettingsDirty(true);
                }}
                disabled={!envelope.canEdit}
                hint="Days before expiry to notify the sender."
                error={settingsErrors.expiryWarningDays}
                className={EDITABLE_CONTROL_CLASS_NAME}
              />
          </div>
        </div>
      </CompanyAccentSection>

      {submitError ? (
        <Alert variant="error" className="col-span-full mt-4">
          {submitError}
        </Alert>
      ) : null}

      <div className="col-span-full flex flex-col gap-2 rounded-2xl border border-border-primary bg-background-secondary px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
        <Button variant="secondary" className="w-full sm:w-auto" onClick={onBack}>
          Back
        </Button>
        <div className="min-w-0 flex-1 text-sm">
          {canProceed ? (
            <span className="text-text-muted">Settings and recipients look good.</span>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {!hasDocument && (
                <span className="flex items-center gap-1 text-amber-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Upload at least one document
                </span>
              )}
              {!hasSigner && (
                <span className="flex items-center gap-1 text-amber-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Add at least one signer
                </span>
              )}
            </div>
          )}
        </div>
        <Button
          className="w-full sm:w-auto"
          onClick={() => void handleNext()}
          isLoading={isUpdating}
          disabled={!canProceed}
        >
          <span className="hidden sm:inline">Next: Place Fields →</span>
          <span className="sm:hidden">Next →</span>
        </Button>
      </div>
    </div>
  );
}
