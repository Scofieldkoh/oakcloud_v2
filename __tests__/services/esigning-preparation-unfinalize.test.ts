import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  preparationFindFirst: vi.fn(),
  envelopeDocumentFindFirst: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskEsigningPreparation: {
      findFirst: mocks.preparationFindFirst,
    },
    esigningEnvelopeDocument: {
      findFirst: mocks.envelopeDocumentFindFirst,
    },
  },
}));

vi.mock('@/services/esigning-envelope.service', () => ({
  attachGeneratedDocumentToDraftEnvelope: vi.fn(),
  createTaskPreparedEsigningEnvelope: vi.fn(),
  detachGeneratedDocumentFromDraftEnvelope: vi.fn(),
}));

import {
  assertGeneratedDocumentCanBeUnfinalized,
} from '@/services/tasks/esigning-preparation.service';

describe('generated document E-signing unfinalization guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preparationFindFirst.mockResolvedValue(null);
    mocks.envelopeDocumentFindFirst.mockResolvedValue(null);
  });

  it('allows unfinalization when no non-draft prepared or directly linked envelope exists', async () => {
    await expect(assertGeneratedDocumentCanBeUnfinalized(
      'tenant-a',
      'document-1',
    )).resolves.toBeUndefined();

    expect(mocks.preparationFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        generatedDocumentId: 'document-1',
        esigningEnvelope: {
          status: { notIn: ['DRAFT', 'VOIDED'] },
          deletedAt: null,
        },
      },
      select: { esigningEnvelopeId: true },
    });
    expect(mocks.envelopeDocumentFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        generatedDocumentId: 'document-1',
        envelope: {
          status: { notIn: ['DRAFT', 'VOIDED'] },
          deletedAt: null,
        },
      },
      select: { envelopeId: true },
    });
  });

  it('blocks unfinalization when the generated document is directly linked to a non-draft envelope', async () => {
    mocks.envelopeDocumentFindFirst.mockResolvedValue({
      envelopeId: 'envelope-sent',
    });

    await expect(assertGeneratedDocumentCanBeUnfinalized(
      'tenant-a',
      'document-1',
    )).rejects.toThrow(
      'Void the active E-signing envelope before unfinalizing this document',
    );
  });

  it('blocks unfinalization when task preparation owns a non-draft envelope', async () => {
    mocks.preparationFindFirst.mockResolvedValue({
      esigningEnvelopeId: 'envelope-in-progress',
    });

    await expect(assertGeneratedDocumentCanBeUnfinalized(
      'tenant-a',
      'document-1',
    )).rejects.toThrow(
      'Void the active E-signing envelope before unfinalizing this document',
    );
  });

  it('uses the caller transaction client for both envelope checks', async () => {
    const preparationFindFirst = vi.fn().mockResolvedValue(null);
    const envelopeDocumentFindFirst = vi.fn().mockResolvedValue(null);
    const tx = {
      taskEsigningPreparation: { findFirst: preparationFindFirst },
      esigningEnvelopeDocument: { findFirst: envelopeDocumentFindFirst },
    };

    await expect(assertGeneratedDocumentCanBeUnfinalized(
      'tenant-a',
      'document-1',
      tx as never,
    )).resolves.toBeUndefined();

    expect(preparationFindFirst).toHaveBeenCalledOnce();
    expect(envelopeDocumentFindFirst).toHaveBeenCalledOnce();
    expect(mocks.preparationFindFirst).not.toHaveBeenCalled();
    expect(mocks.envelopeDocumentFindFirst).not.toHaveBeenCalled();
  });
});
