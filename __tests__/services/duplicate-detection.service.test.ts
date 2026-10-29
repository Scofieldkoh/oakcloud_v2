import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    processingDocument: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    documentRevision: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    duplicateDecision: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { prisma } from '@/lib/prisma';
import { checkForDuplicates } from '@/services/duplicate-detection.service';

describe('Duplicate Detection Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not flag content-based duplicates when document numbers do not match', async () => {
    vi.mocked(prisma.processingDocument.findFirst)
      .mockResolvedValueOnce({
        fileHash: 'hash-1',
        currentRevisionId: 'rev-1',
      } as never)
      .mockResolvedValueOnce(null as never);

    vi.mocked(prisma.documentRevision.findUnique).mockResolvedValue({
      vendorName: 'ACME PTE LTD',
      documentNumber: 'INV-001',
      documentDate: new Date('2026-03-01T00:00:00.000Z'),
      totalAmount: new Prisma.Decimal('100.00'),
      currency: 'SGD',
      homeEquivalent: new Prisma.Decimal('100.00'),
      homeCurrency: 'SGD',
    } as never);

    vi.mocked(prisma.processingDocument.findMany).mockResolvedValue([
      {
        id: 'pd-2',
        documentId: 'doc-2',
        currentRevision: {
          vendorName: 'ACME PTE LTD',
          documentNumber: 'INV-999',
          documentDate: new Date('2026-03-01T00:00:00.000Z'),
          totalAmount: new Prisma.Decimal('100.00'),
          currency: 'SGD',
          homeEquivalent: new Prisma.Decimal('100.00'),
          homeCurrency: 'SGD',
        },
      },
    ] as never);

    const result = await checkForDuplicates('pd-1', 'tenant-1', 'company-1');

    expect(result.hasPotentialDuplicate).toBe(false);
    expect(result.candidates).toEqual([]);
  });

  it('still flags content-based duplicates when document numbers match after normalization', async () => {
    vi.mocked(prisma.processingDocument.findFirst)
      .mockResolvedValueOnce({
        fileHash: 'hash-1',
        currentRevisionId: 'rev-1',
      } as never)
      .mockResolvedValueOnce(null as never);

    vi.mocked(prisma.documentRevision.findUnique).mockResolvedValue({
      vendorName: 'ACME PTE LTD',
      documentNumber: 'INV-001',
      documentDate: new Date('2026-03-01T00:00:00.000Z'),
      totalAmount: new Prisma.Decimal('100.00'),
      currency: 'SGD',
      homeEquivalent: new Prisma.Decimal('100.00'),
      homeCurrency: 'SGD',
    } as never);

    vi.mocked(prisma.processingDocument.findMany).mockResolvedValue([
      {
        id: 'pd-2',
        documentId: 'doc-2',
        currentRevision: {
          vendorName: 'ACME PTE LTD',
          documentNumber: 'inv001',
          documentDate: new Date('2026-03-01T00:00:00.000Z'),
          totalAmount: new Prisma.Decimal('100.00'),
          currency: 'SGD',
          homeEquivalent: new Prisma.Decimal('100.00'),
          homeCurrency: 'SGD',
        },
      },
    ] as never);

    const result = await checkForDuplicates('pd-1', 'tenant-1', 'company-1');

    expect(result.hasPotentialDuplicate).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.processingDocumentId).toBe('pd-2');
    expect(result.candidates[0]?.score.signals.documentNumberMatch).toBe(1);
  });
});
