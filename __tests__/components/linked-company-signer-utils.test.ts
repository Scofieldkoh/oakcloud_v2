import { describe, expect, it } from 'vitest';
import type { EsigningEnvelopeRecipientDto } from '@/types/esigning';
import {
  buildLinkedCompanyBulkSignerContacts,
  buildSignerEmailSet,
  buildSignerNameSet,
  getLinkedCompanyQuickAddState,
  normalizeSignerEmail,
  normalizeSignerName,
} from '@/components/esigning/prepare/linked-company-signer-utils';

function recipient(type: 'SIGNER' | 'CC', email: string | null): EsigningEnvelopeRecipientDto {
  return { type, email } as EsigningEnvelopeRecipientDto;
}

describe('linked company recipient shortcut rules', () => {
  it('normalizes signer email addresses for duplicate detection', () => {
    expect(normalizeSignerEmail('  Jane.Example@Example.COM  ')).toBe('jane.example@example.com');
    expect(normalizeSignerEmail(null)).toBe('');
  });

  it('normalizes signer names for name-based duplicate detection', () => {
    expect(normalizeSignerName('  Jane   Example  ')).toBe('jane example');
    expect(normalizeSignerName(null)).toBe('');
  });

  it('builds the duplicate set from signers only', () => {
    const emails = buildSignerEmailSet([
      recipient('SIGNER', 'Signer@Example.com'),
      recipient('CC', 'copy@example.com'),
      recipient('SIGNER', null),
    ]);
    expect([...emails]).toEqual(['signer@example.com']);
  });

  it('builds the signer-name set from signers only', () => {
    const names = buildSignerNameSet([
      { type: 'SIGNER', name: 'Jane Example' } as EsigningEnvelopeRecipientDto,
      { type: 'CC', name: 'Copy Person' } as EsigningEnvelopeRecipientDto,
    ]);
    expect([...names]).toEqual(['jane example']);
  });

  it('keeps a company contact without email available for configuration', () => {
    const state = getLinkedCompanyQuickAddState(
      { id: 'contact-1', fullName: 'No Email', defaultEmail: null },
      new Set(),
    );
    expect(state.isAdded).toBe(false);
    expect(state.email).toBe('');
    expect(state.stateLabel).toContain('configured as a recipient');
  });

  it('keeps a company contact with email available for configuration', () => {
    const state = getLinkedCompanyQuickAddState(
      { id: 'contact-1', fullName: 'Jane Example', defaultEmail: 'jane@example.com' },
      new Set(),
    );
    expect(state.isAdded).toBe(false);
    expect(state.email).toBe('jane@example.com');
  });

  it('recognizes an existing signer case-insensitively', () => {
    const state = getLinkedCompanyQuickAddState(
      { id: 'contact-1', fullName: 'Jane Example', defaultEmail: 'JANE@EXAMPLE.COM' },
      new Set(['jane@example.com']),
    );
    expect(state.isAdded).toBe(true);
    expect(state.stateLabel).toContain('already added');
  });

  it('recognizes a manual-link signer by name when no email is available', () => {
    const state = getLinkedCompanyQuickAddState(
      { id: 'contact-1', fullName: 'Manual Recipient', defaultEmail: null },
      new Set(),
      new Set(['manual recipient']),
    );
    expect(state.isAdded).toBe(true);
  });

  it('does not mark a contact without email as already added just because another manual-link signer has no email', () => {
    const state = getLinkedCompanyQuickAddState(
      { id: 'contact-1', fullName: 'Manual Recipient', defaultEmail: null },
      new Set(),
    );
    expect(state.isAdded).toBe(false);
  });


  it('builds a bulk signer list that skips existing and duplicate company contacts', () => {
    const contacts = buildLinkedCompanyBulkSignerContacts(
      [
        { id: 'contact-1', fullName: 'Existing Person', defaultEmail: 'existing@example.com' },
        { id: 'contact-2', fullName: 'Jane Example', defaultEmail: 'jane@example.com' },
        { id: 'contact-3', fullName: 'Jane Example', defaultEmail: 'jane.secondary@example.com' },
        { id: 'contact-4', fullName: 'No Email', defaultEmail: null },
      ],
      new Set(['existing@example.com']),
      new Set(['existing person']),
      20,
    );

    expect(contacts.map((contact) => contact.id)).toEqual(['contact-2', 'contact-4']);
  });

  it('caps the bulk signer list at the available recipient slots', () => {
    const contacts = buildLinkedCompanyBulkSignerContacts(
      [
        { id: 'contact-1', fullName: 'One', defaultEmail: 'one@example.com' },
        { id: 'contact-2', fullName: 'Two', defaultEmail: 'two@example.com' },
        { id: 'contact-3', fullName: 'Three', defaultEmail: 'three@example.com' },
      ],
      new Set(),
      new Set(),
      2,
    );

    expect(contacts.map((contact) => contact.id)).toEqual(['contact-1', 'contact-2']);
  });
});
