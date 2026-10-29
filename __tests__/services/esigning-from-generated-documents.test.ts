// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { DocumentParty } from '@/lib/document-party';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

const { signersForDocuments } = await import('@/services/esigning-envelope/from-generated-documents');

function party(id: string, name: string, email: string | null, contactId: string | null = null): DocumentParty {
  return { id, contactId, name, detail: null, email, phone: null, address: { full: null, letter: null } };
}

const parties = {
  directors: [party('d1', 'Tan Wei Jie', 'wj@example.com'), party('d2', 'Mary Lee', null)],
  shareholders: [party('s1', 'Mary Lee', null), party('s2', 'Oak Holdings Pte. Ltd.', 'ir@oak.example')],
  contacts: [party('c1', 'Alex Ng', 'alex@example.com', 'contact-1')],
};

describe('signersForDocuments', () => {
  it('uses every director a directors repeater prints, or only the ticked ones', () => {
    expect(signersForDocuments([{ fieldTags: ['repeat.directors'] }], parties)).toEqual([
      { name: 'Tan Wei Jie', email: 'wj@example.com' },
      { name: 'Mary Lee', email: null },
    ]);
    expect(signersForDocuments([{
      fieldTags: ['repeat.directors'],
      configuration: { selectedDirectorIds: ['d2'] },
    }], parties)).toEqual([{ name: 'Mary Lee', email: null }]);
  });

  it('combines documents and drops duplicates by email, then name', () => {
    expect(signersForDocuments([
      { fieldTags: ['repeat.directors'] },
      { fieldTags: ['repeat.shareholders'] },
    ], parties)).toEqual([
      { name: 'Tan Wei Jie', email: 'wj@example.com' },
      { name: 'Mary Lee', email: null },
      { name: 'Oak Holdings Pte. Ltd.', email: 'ir@oak.example' },
    ]);
  });

  it('falls back to the selected director and contacts', () => {
    expect(signersForDocuments([{
      fieldTags: ['selectedDirector.name'],
      selectedParties: { directorId: 'd1', contactIds: ['contact-1'] },
    }], parties)).toEqual([
      { name: 'Tan Wei Jie', email: 'wj@example.com' },
      { name: 'Alex Ng', email: 'alex@example.com' },
    ]);
    expect(signersForDocuments([{ fieldTags: [] }], parties)).toEqual([]);
  });
});
