'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, RefreshCw, UserRound, UsersRound } from 'lucide-react';
import type { EsigningRecipientAccessMode, EsigningRecipientType } from '@/generated/prisma';
import type { EsigningEnvelopeRecipientDto } from '@/types/esigning';
import type { EsigningRecipientInput } from '@/lib/validations/esigning';
import { ESIGNING_LIMITS } from '@/lib/validations/esigning';
import { ESIGNING_ACCESS_MODE_LABELS, ESIGNING_RECIPIENT_TYPE_LABELS } from '@/components/esigning/esigning-shared';
import { ContactSearchSelect, type SearchableContact } from '@/components/ui/contact-search-select';
import { FormInput } from '@/components/ui/form-input';
import { Button } from '@/components/ui/button';
import { useDocumentPartyOptions } from '@/hooks/use-document-party-options';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  buildLinkedCompanyBulkSignerContacts,
  buildSignerEmailSet,
  buildSignerNameSet,
  getLinkedCompanyQuickAddState,
  normalizeSignerEmail,
} from './linked-company-signer-utils';

interface LinkedCompanySignerQuickAddProps {
  companyId: string;
  companyName?: string;
  recipients: EsigningEnvelopeRecipientDto[];
  canEdit: boolean;
  onAddRecipient: (data: EsigningRecipientInput) => Promise<void>;
}

interface RecipientDraft {
  name: string;
  email: string;
  type: EsigningRecipientType;
  accessMode: EsigningRecipientAccessMode;
  accessCode: string;
}

interface CompanyQuickAddContact {
  id: string;
  fullName: string;
  defaultEmail: string | null;
  appointments: string[];
}

const EMPTY_DRAFT: RecipientDraft = { name: '', email: '', type: 'SIGNER', accessMode: 'MANUAL_LINK', accessCode: '' };
const EDITABLE_CONTROL_CLASS_NAME = [
  'bg-emerald-50',
  'dark:bg-emerald-950/30',
  'disabled:bg-background-primary',
  'dark:disabled:bg-background-secondary',
].join(' ');

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function buildDraft(contact: { fullName: string; defaultEmail?: string | null }): RecipientDraft {
  const email = contact.defaultEmail?.trim() ?? '';
  return { name: contact.fullName.trim(), email, type: 'SIGNER', accessMode: 'MANUAL_LINK', accessCode: '' };
}

function asSearchableContact(contact: CompanyQuickAddContact): SearchableContact {
  return {
    id: contact.id,
    fullName: contact.fullName,
    defaultEmail: contact.defaultEmail,
  } as SearchableContact;
}

export function LinkedCompanySignerQuickAdd({ companyId, companyName, recipients, canEdit, onAddRecipient }: LinkedCompanySignerQuickAddProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [selectedContact, setSelectedContact] = useState<SearchableContact | null>(null);
  const [selectedContactDefaultEmailDetailId, setSelectedContactDefaultEmailDetailId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecipientDraft>(EMPTY_DRAFT);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddingAll, setIsAddingAll] = useState(false);
  const [isSavingContactEmail, setIsSavingContactEmail] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const {
    contacts: partyContacts,
    isLoading,
    error,
    reload,
  } = useDocumentPartyOptions(companyId);

  const signerEmails = useMemo(() => buildSignerEmailSet(recipients), [recipients]);
  const signerNames = useMemo(() => buildSignerNameSet(recipients), [recipients]);
  const contacts = useMemo<CompanyQuickAddContact[]>(
    () => partyContacts.map((contact) => ({
      id: contact.contactId ?? contact.id,
      fullName: contact.name,
      defaultEmail: contact.email,
      appointments: contact.appointments ?? (contact.detail ? [contact.detail] : []),
    })),
    [partyContacts],
  );
  const availableContacts = useMemo(
    () => contacts.filter((contact) => !getLinkedCompanyQuickAddState(contact, signerEmails, signerNames).isAdded),
    [contacts, signerEmails, signerNames],
  );
  const recipientSlotsRemaining = Math.max(0, ESIGNING_LIMITS.MAX_RECIPIENTS - recipients.length);
  const bulkEligibleContacts = useMemo(
    () => buildLinkedCompanyBulkSignerContacts(contacts, signerEmails, signerNames, contacts.length),
    [contacts, signerEmails, signerNames],
  );
  const bulkContacts = useMemo(
    () => bulkEligibleContacts.slice(0, recipientSlotsRemaining),
    [bulkEligibleContacts, recipientSlotsRemaining],
  );
  const selectedContactEmailChanged = Boolean(
    selectedContact
    && normalizeSignerEmail(draft.email) !== normalizeSignerEmail(selectedContact.defaultEmail),
  );

  function loadDefaultEmailDetail(contactId: string) {
    const groupedUrl = activeTenantId
      ? `/api/contacts/${contactId}/contact-details?grouped=true&tenantId=${encodeURIComponent(activeTenantId)}`
      : `/api/contacts/${contactId}/contact-details?grouped=true`;

    void fetch(groupedUrl, { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to fetch contact details');
        return response.json() as Promise<{
          defaultDetails?: Array<{ id: string; detailType: string; value: string }>;
        }>;
      })
      .then((data) => {
        const emailDetail = data.defaultDetails?.find((detail) => detail.detailType === 'EMAIL') ?? null;
        setSelectedContactDefaultEmailDetailId(emailDetail?.id ?? null);
      })
      .catch(() => {
        setSelectedContactDefaultEmailDetailId(null);
      });
  }

  function selectContact(contactId: string, contact: SearchableContact | null) {
    setSelectedContactId(contactId);
    setSelectedContact(contact);
    setSelectedContactDefaultEmailDetailId(null);
    if (!contact) {
      setDraft(EMPTY_DRAFT);
      return;
    }
    setDraft(buildDraft(contact));
    setIsEditorOpen(true);
    loadDefaultEmailDetail(contactId);
  }

  function selectCompanyContact(contact: CompanyQuickAddContact) {
    selectContact(contact.id, asSearchableContact(contact));
  }

  function closeEditor() {
    setIsEditorOpen(false);
    setSelectedContactId('');
    setSelectedContact(null);
    setSelectedContactDefaultEmailDetailId(null);
    setDraft(EMPTY_DRAFT);
  }

  function handleRoleChange(nextType: EsigningRecipientType) {
    setDraft((current) => ({
      ...current,
      type: nextType,
      accessMode:
        nextType === 'CC'
          ? 'EMAIL_LINK'
          : current.type === 'CC'
            ? 'MANUAL_LINK'
            : current.accessMode,
      accessCode: nextType === 'CC' ? '' : current.accessCode,
    }));
  }

  async function handleAddAllContacts() {
    if (bulkEligibleContacts.length === 0) return;
    if (recipientSlotsRemaining === 0) {
      toast.error(`This envelope already has the maximum of ${ESIGNING_LIMITS.MAX_RECIPIENTS} recipients`);
      return;
    }

    setIsAddingAll(true);
    let addedCount = 0;
    const failedContacts: string[] = [];

    try {
      for (const contact of bulkContacts) {
        const name = contact.fullName.trim();
        const email = normalizeSignerEmail(contact.defaultEmail);

        try {
          await onAddRecipient({
            name,
            email: email || null,
            type: 'SIGNER',
            signingOrder: null,
            accessMode: 'MANUAL_LINK',
          });
          addedCount += 1;
        } catch {
          failedContacts.push(name);
        }
      }

      const skippedForLimit = bulkEligibleContacts.length - bulkContacts.length;
      if (addedCount > 0) {
        const signerLabel = addedCount === 1 ? 'signer' : 'signers';
        const limitMessage = skippedForLimit > 0
          ? ` ${skippedForLimit} contact${skippedForLimit === 1 ? '' : 's'} not added because the envelope limit is ${ESIGNING_LIMITS.MAX_RECIPIENTS} recipients.`
          : '';
        toast.success(`Added ${addedCount} company contact${addedCount === 1 ? '' : 's'} as ${signerLabel}.${limitMessage}`);
      }

      if (failedContacts.length > 0) {
        toast.error(`${failedContacts.length} contact${failedContacts.length === 1 ? '' : 's'} could not be added. Please add ${failedContacts.length === 1 ? 'that contact' : 'them'} individually.`);
      }
    } finally {
      setIsAddingAll(false);
    }
  }

  async function handleSaveContactEmail() {
    if (!selectedContactId) return toast.error('Select a contact first');
    const email = draft.email.trim();
    if (!isValidEmail(email)) return toast.error('Enter a valid email address before saving it to Contacts');

    setIsSavingContactEmail(true);
    try {
      const url = selectedContactDefaultEmailDetailId
        ? `/api/contacts/${selectedContactId}/contact-details/${selectedContactDefaultEmailDetailId}`
        : `/api/contacts/${selectedContactId}/contact-details`;
      const payload = selectedContactDefaultEmailDetailId
        ? { value: email, isPrimary: true, tenantId: activeTenantId }
        : { detailType: 'EMAIL', value: email, isPrimary: true, purposes: [], tenantId: activeTenantId };

      const response = await fetch(url, {
        method: selectedContactDefaultEmailDetailId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to save contact email');

      if (!selectedContactDefaultEmailDetailId && typeof data.id === 'string') {
        setSelectedContactDefaultEmailDetailId(data.id);
      }
      setSelectedContact((current) => current ? { ...current, defaultEmail: email } : current);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts'] }),
        queryClient.invalidateQueries({ queryKey: ['contact', selectedContactId] }),
      ]);
      reload();
      toast.success('Email saved to Contacts');
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Failed to save contact email');
    } finally {
      setIsSavingContactEmail(false);
    }
  }

  async function handleConfirm() {
    const name = draft.name.trim();
    const email = normalizeSignerEmail(draft.email);
    const requiresEmail = draft.type === 'CC' || draft.accessMode !== 'MANUAL_LINK';
    if (!name) return toast.error('Recipient name is required');
    if (requiresEmail && !email) return toast.error('Recipient email is required for this access method');
    if (email && !isValidEmail(email)) return toast.error('Enter a valid recipient email address');
    if (draft.accessMode === 'EMAIL_WITH_CODE' && draft.accessCode.trim().length < ESIGNING_LIMITS.MIN_ACCESS_CODE_LENGTH) return toast.error(`Access code must be at least ${ESIGNING_LIMITS.MIN_ACCESS_CODE_LENGTH} characters`);
    if (draft.type === 'SIGNER' && email && signerEmails.has(email)) return toast.error(`${draft.email.trim()} is already listed as a signer on this envelope`);

    setIsSubmitting(true);
    try {
      await onAddRecipient({ name, email: email || null, type: draft.type, signingOrder: null, accessMode: draft.accessMode, accessCode: draft.accessCode.trim() || undefined });
      toast.success(`${name} added as ${draft.type === 'SIGNER' ? 'a signer' : 'a copy recipient'}`);
      closeEditor();
    } catch (submitError) {
      toast.error(submitError instanceof Error ? submitError.message : 'Failed to add recipient');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!companyId || !canEdit) return null;

  return (
    <div className="rounded-xl border border-border-primary bg-background-secondary p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-secondary">Company contacts</p>
          <p className="truncate text-xs text-text-muted">{companyName ? `${companyName} · ` : ''}Select a contact to configure how they receive this document.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isLoading && bulkEligibleContacts.length > 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<UsersRound className="h-4 w-4" />}
              onClick={() => void handleAddAllContacts()}
              isLoading={isAddingAll}
              disabled={isAddingAll || isSubmitting || isSavingContactEmail || isEditorOpen || bulkContacts.length === 0}
              title={
                recipientSlotsRemaining === 0
                  ? `Maximum of ${ESIGNING_LIMITS.MAX_RECIPIENTS} recipients reached`
                  : isEditorOpen
                    ? 'Close the recipient editor before adding all contacts'
                    : undefined
              }
            >
              Add all as signers
            </Button>
          ) : null}
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-text-muted" aria-label="Loading company contacts" /> : null}
        </div>
      </div>

      {error && contacts.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300/50 px-3 py-2">
          <p className="min-w-0 flex-1 text-xs text-text-muted">{error}</p>
          <button type="button" onClick={reload} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border-primary px-2.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : null}

      {!isLoading && !error && contacts.length === 0 ? <p className="text-xs text-text-muted">No current contacts are linked to this company.</p> : null}
      {!isLoading && contacts.length > 0 && availableContacts.length === 0 ? <p className="text-xs text-text-muted">All linked contacts have already been added.</p> : null}

      {availableContacts.length > 0 ? (
        <div className="flex flex-wrap gap-2" aria-label="Linked company contacts">
          {availableContacts.map((contact) => {
            const appointmentLabel = contact.appointments.join(', ');
            return (
              <button
                key={contact.id}
                type="button"
                onClick={() => selectCompanyContact(contact)}
                disabled={isAddingAll}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary transition-colors hover:border-oak-primary/40 hover:bg-background-tertiary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <UserRound className="h-4 w-4 text-text-muted" aria-hidden="true" />
                <span className="max-w-72 truncate">
                  {contact.fullName}{appointmentLabel ? ` (${appointmentLabel})` : ''}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {isEditorOpen ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-border-primary bg-background-primary">
          <div className="border-b border-border-primary px-4 py-3">
            <p className="text-sm font-semibold text-text-primary">Configure recipient</p>
            <p className="text-xs text-text-muted">Review the contact details, role, and delivery method before adding.</p>
          </div>
          <div className="space-y-3 p-4">
            <ContactSearchSelect
              key={`linked-company-contact-${selectedContactId || 'empty'}`}
              label="Search Contact"
              value={selectedContactId}
              selectedContact={selectedContact}
              onChange={selectContact}
              placeholder="Search contacts..."
              controlClassName={cn('!h-10 !min-h-0', EDITABLE_CONTROL_CLASS_NAME)}
            />
            <FormInput
              label="Full name"
              inputSize="lg"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              className={EDITABLE_CONTROL_CLASS_NAME}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <FormInput
                label="Email address"
                inputSize="lg"
                type="email"
                placeholder="Optional for manual link"
                value={draft.email}
                onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                required={draft.type === 'CC' || draft.accessMode !== 'MANUAL_LINK'}
                hint={draft.type === 'SIGNER' && draft.accessMode === 'MANUAL_LINK' ? 'Optional when using Manual Link.' : undefined}
                className={EDITABLE_CONTROL_CLASS_NAME}
              />
              <label className="flex flex-col gap-2 text-xs font-medium text-text-secondary">
                Role
                <select value={draft.type} onChange={(event) => handleRoleChange(event.target.value as EsigningRecipientType)} className={cn('h-10 rounded-lg border border-border-primary bg-background-secondary px-3 text-sm text-text-primary', EDITABLE_CONTROL_CLASS_NAME)}>
                  {Object.entries(ESIGNING_RECIPIENT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-xs font-medium text-text-secondary">
                Access method
                <select value={draft.accessMode} onChange={(event) => setDraft((current) => ({ ...current, accessMode: event.target.value as EsigningRecipientAccessMode }))} disabled={draft.type === 'CC'} className={cn('h-10 rounded-lg border border-border-primary bg-background-secondary px-3 text-sm text-text-primary disabled:opacity-60', EDITABLE_CONTROL_CLASS_NAME)}>
                  {Object.entries(ESIGNING_ACCESS_MODE_LABELS).filter(([value]) => draft.type !== 'CC' || value !== 'MANUAL_LINK').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
            {draft.type === 'CC' ? <p className="text-xs text-text-muted">Copy recipients require email delivery, so Manual Link is not available.</p> : null}
            {draft.accessMode === 'EMAIL_WITH_CODE' ? <FormInput label="Access code" inputSize="lg" value={draft.accessCode} onChange={(event) => setDraft((current) => ({ ...current, accessCode: event.target.value }))} placeholder={`Min ${ESIGNING_LIMITS.MIN_ACCESS_CODE_LENGTH} characters`} className={EDITABLE_CONTROL_CLASS_NAME} /> : null}
            <div className="flex flex-wrap justify-end gap-2 border-t border-border-primary pt-3">
              <Button type="button" variant="secondary" size="sm" onClick={closeEditor} disabled={isSubmitting || isSavingContactEmail || isAddingAll}>Cancel</Button>
              {selectedContact && selectedContactEmailChanged ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleSaveContactEmail()}
                  isLoading={isSavingContactEmail}
                  disabled={isSubmitting || isSavingContactEmail || isAddingAll || !draft.email.trim()}
                >
                  Save email to Contacts
                </Button>
              ) : null}
              <Button type="button" size="sm" leftIcon={<Check className="h-4 w-4" />} onClick={() => void handleConfirm()} isLoading={isSubmitting} disabled={isSubmitting || isSavingContactEmail || isAddingAll}>Add recipient</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
