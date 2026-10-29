import type { EsigningEnvelopeRecipientDto } from '@/types/esigning';

export interface LinkedCompanyQuickAddContact {
  id: string;
  fullName: string;
  defaultEmail?: string | null;
}

export interface LinkedCompanyQuickAddState {
  email: string;
  isAdded: boolean;
  stateLabel: string;
}

export function normalizeSignerEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

export function normalizeSignerName(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, ' ').toLowerCase() ?? '';
}

export function buildSignerEmailSet(recipients: EsigningEnvelopeRecipientDto[]): Set<string> {
  return new Set(
    recipients
      .filter((recipient) => recipient.type === 'SIGNER')
      .map((recipient) => normalizeSignerEmail(recipient.email))
      .filter(Boolean),
  );
}

export function buildSignerNameSet(recipients: EsigningEnvelopeRecipientDto[]): Set<string> {
  return new Set(
    recipients
      .filter((recipient) => recipient.type === 'SIGNER')
      .map((recipient) => normalizeSignerName(recipient.name))
      .filter(Boolean),
  );
}

export function buildLinkedCompanyBulkSignerContacts(
  contacts: LinkedCompanyQuickAddContact[],
  signerEmails: Set<string>,
  signerNames: Set<string>,
  maxCount: number,
): LinkedCompanyQuickAddContact[] {
  if (maxCount <= 0) return [];

  const seenEmails = new Set(signerEmails);
  const seenNames = new Set(signerNames);
  const result: LinkedCompanyQuickAddContact[] = [];

  for (const contact of contacts) {
    if (result.length >= maxCount) break;

    const state = getLinkedCompanyQuickAddState(contact, seenEmails, seenNames);
    const normalizedName = normalizeSignerName(contact.fullName);
    if (state.isAdded || !normalizedName) continue;

    result.push(contact);
    if (state.email) seenEmails.add(state.email);
    seenNames.add(normalizedName);
  }

  return result;
}

export function getLinkedCompanyQuickAddState(
  contact: LinkedCompanyQuickAddContact,
  signerEmails: Set<string>,
  signerNames: Set<string> = new Set(),
): LinkedCompanyQuickAddState {
  const email = normalizeSignerEmail(contact.defaultEmail);
  const normalizedName = normalizeSignerName(contact.fullName);
  const isAdded = (Boolean(email) && signerEmails.has(email))
    || (Boolean(normalizedName) && signerNames.has(normalizedName));

  return {
    email,
    isAdded,
    stateLabel: isAdded
      ? `${contact.fullName} is already added as a signer`
      : `${contact.fullName} can be configured as a recipient`,
  };
}
