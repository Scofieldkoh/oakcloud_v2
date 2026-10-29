'use client';

import { SEARCH_DEBOUNCE_MS } from '@/hooks/use-debounced-search';
import { useEffect, useId, useMemo, useState } from 'react';
import { Check, ContactRound, LoaderCircle, UserPlus } from 'lucide-react';
import { useDebounce } from 'use-debounce';
import { Button } from '@/components/ui/button';
import {
  ContactMatchReviewRequiredError,
  useContacts,
  useCreateContact,
  useUpdateContact,
} from '@/hooks/use-contacts';
import type { Contact, IdentificationType } from '@/generated/prisma';
import type { CreateContactWithDetailsInput, UpdateContactInput } from '@/lib/validations/contact';

export type CompanyPersonKind = 'officer' | 'shareholder';
export type CompanyPersonRecord = Record<string, unknown>;

const CONTACT_IDENTIFICATION_TYPES = new Set<IdentificationType>(['NRIC', 'FIN', 'PASSPORT', 'UEN', 'OTHER']);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function identificationType(value: unknown): IdentificationType | null {
  return typeof value === 'string' && CONTACT_IDENTIFICATION_TYPES.has(value as IdentificationType)
    ? value as IdentificationType
    : null;
}

function isCorporate(record: CompanyPersonRecord, kind: CompanyPersonKind): boolean {
  return kind === 'shareholder' && record.shareholderType === 'CORPORATE';
}

export function applyContactToCompanyPerson(
  record: CompanyPersonRecord,
  contact: Pick<Contact, 'id' | 'fullName' | 'contactType' | 'identificationType' | 'identificationNumber' | 'corporateUen' | 'nationality' | 'fullAddress'>,
  kind: CompanyPersonKind,
): CompanyPersonRecord {
  const identifier = contact.identificationNumber || contact.corporateUen || '';
  return {
    ...record,
    contactId: contact.id,
    name: contact.fullName,
    ...(kind === 'shareholder' ? { shareholderType: contact.contactType } : {}),
    identificationType: contact.identificationType ?? (contact.corporateUen ? 'UEN' : null),
    identificationNumber: identifier,
    nationality: contact.nationality ?? '',
    address: contact.fullAddress ?? '',
  };
}

export function companyPersonToContactPayload(
  record: CompanyPersonRecord,
  kind: CompanyPersonKind,
): CreateContactWithDetailsInput {
  const name = text(record.name);
  const idType = identificationType(record.identificationType);
  const idNumber = text(record.identificationNumber) || null;
  const nationality = text(record.nationality) || null;
  const fullAddress = text(record.address) || null;

  if (isCorporate(record, kind)) {
    return {
      contactType: 'CORPORATE',
      corporateName: name,
      corporateUen: idType === 'UEN' ? idNumber : null,
      identificationType: idType,
      identificationNumber: idNumber,
      nationality,
      fullAddress,
    };
  }

  return {
    contactType: 'INDIVIDUAL',
    firstName: name,
    lastName: null,
    corporateName: null,
    corporateUen: null,
    identificationType: idType,
    identificationNumber: idNumber,
    nationality,
    fullAddress,
  };
}

export function companyPersonToContactUpdate(
  record: CompanyPersonRecord,
  kind: CompanyPersonKind,
): Partial<UpdateContactInput> {
  const payload = companyPersonToContactPayload(record, kind);
  const { contactDetails: _contactDetails, resolution: _resolution, ...update } = payload;
  return update;
}

interface CompanyPersonContactLinkerProps {
  kind: CompanyPersonKind;
  label: string;
  value: CompanyPersonRecord;
  onChange: (value: CompanyPersonRecord) => void;
}

export function CompanyPersonContactLinker({ kind, label, value, onChange }: CompanyPersonContactLinkerProps) {
  const existingContactId = text(value.contactId) || null;
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_MS);
  const [open, setOpen] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(existingContactId);
  const [selectedContactName, setSelectedContactName] = useState<string | null>(existingContactId ? text(value.name) : null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'muted'; text: string } | null>(null);
  const contacts = useContacts({
    query: debouncedQuery || undefined,
    contactType: kind === 'officer' ? 'INDIVIDUAL' : undefined,
    limit: 8,
    sortBy: 'fullName',
    sortOrder: 'asc',
  });
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const name = text(value.name);
  const options = useMemo(() => contacts.data?.contacts ?? [], [contacts.data?.contacts]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    setSelectedContactId(existingContactId);
    setSelectedContactName(existingContactId ? text(value.name) : null);
  }, [existingContactId, value.name]);

  const selectContact = (contact: Contact) => {
    setSelectedContactId(contact.id);
    setSelectedContactName(contact.fullName);
    setMessage({ tone: 'success', text: `Populated fields from ${contact.fullName}.` });
    onChange(applyContactToCompanyPerson(value, contact, kind));
    setOpen(false);
  };

  const clearContact = () => {
    const { contactId: _contactId, ...unlinked } = value;
    setSelectedContactId(null);
    setSelectedContactName(null);
    setMessage({ tone: 'muted', text: 'Contact link cleared; the populated fields were kept.' });
    onChange(unlinked);
  };

  const addContact = async () => {
    if (!name) return;
    setMessage(null);
    try {
      const created = await createContact.mutateAsync(companyPersonToContactPayload(value, kind));
      setSelectedContactId(created.id);
      setSelectedContactName(created.fullName);
      onChange({ ...value, contactId: created.id });
      setMessage({ tone: 'success', text: `Added ${created.fullName} to Contacts and linked it to this ${kind}.` });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof ContactMatchReviewRequiredError
          ? 'A similar Contact already exists. Search and select the matching Contact instead.'
          : error instanceof Error ? error.message : 'Failed to add Contact.',
      });
    }
  };

  const saveContact = async () => {
    if (!selectedContactId || !name) return;
    setMessage(null);
    try {
      const updated = await updateContact.mutateAsync({
        id: selectedContactId,
        data: companyPersonToContactUpdate(value, kind),
      });
      setSelectedContactName(updated.fullName);
      setMessage({ tone: 'success', text: `Updated ${updated.fullName} in Contacts.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to update Contact.' });
    }
  };

  const busy = createContact.isPending || updateContact.isPending;

  return (
    <div className="mb-3 rounded-lg border border-border-primary bg-background-secondary/30 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ContactRound className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-primary">Contact</p>
            <p className="text-xs text-text-muted">Search to populate this {kind}, or save the keyed details to Contacts.</p>
          </div>
        </div>
        {selectedContactId ? (
          <div className="flex items-center gap-1.5 text-xs text-status-success">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="max-w-48 truncate" title={selectedContactName ?? undefined}>{selectedContactName ?? 'Contact selected'}</span>
            <button type="button" className="ml-1 text-text-muted underline-offset-2 hover:text-text-primary hover:underline" onClick={clearContact}>Clear</button>
          </div>
        ) : null}
      </div>

      <div className="relative">
        <input
          className="input input-sm w-full"
          value={query}
          placeholder="Search Contacts by name, ID, email or phone…"
          aria-label={`Search Contacts for ${label}`}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          role="combobox"
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
        />
        {open ? (
          <div id={listboxId} className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-border-primary bg-background-elevated p-1 shadow-elevation-2" role="listbox">
            {contacts.isFetching ? (
              <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-text-muted" role="status"><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Searching Contacts…</div>
            ) : contacts.error ? (
              <div className="px-3 py-4 text-xs text-status-error">Unable to search Contacts.</div>
            ) : options.length === 0 ? (
              <div className="px-3 py-4 text-xs text-text-muted">No matching Contacts.</div>
            ) : options.map((contact) => (
              <button
                key={contact.id}
                type="button"
                role="option"
                aria-selected={selectedContactId === contact.id}
                className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-background-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectContact(contact)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-text-primary">{contact.fullName}</span>
                  <span className="block truncate text-xs text-text-muted">{[contact.identificationNumber || contact.corporateUen, contact.nationality].filter(Boolean).join(' · ') || contact.contactType}</span>
                </span>
                {selectedContactId === contact.id ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {selectedContactId ? (
          <Button size="xs" variant="secondary" onClick={saveContact} disabled={!name || busy} isLoading={updateContact.isPending}>Update contact</Button>
        ) : (
          <Button size="xs" variant="secondary" onClick={addContact} disabled={!name || busy} isLoading={createContact.isPending} leftIcon={<UserPlus />}>Add as contact</Button>
        )}
        {!name ? <span className="text-xs text-text-muted">Enter a name before adding a Contact.</span> : null}
        {message ? <span role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'text-xs text-status-error' : message.tone === 'success' ? 'text-xs text-status-success' : 'text-xs text-text-muted'}>{message.text}</span> : null}
      </div>
    </div>
  );
}
