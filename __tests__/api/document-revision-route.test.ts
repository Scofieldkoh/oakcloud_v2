import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  class CounterpartyIdentityValidationError extends Error {
    constructor(public issues: Array<{ field: string; message: string }>) {
      super('Invalid counterparty identity');
    }
  }
  return {
    CounterpartyIdentityValidationError,
    parseReviewerCounterpartyIdentity: vi.fn(), validateRevision: vi.fn(),
    requireAuth: vi.fn(), canAccessCompany: vi.fn(), requirePermission: vi.fn(),
    getProcessingDocument: vi.fn(), createAuditLog: vi.fn(),
  };
});

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth, canAccessCompany: mocks.canAccessCompany }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/lib/audit', () => ({ createAuditLog: mocks.createAuditLog }));
vi.mock('@/services/document-processing.service', () => ({ getProcessingDocument: mocks.getProcessingDocument }));
vi.mock('@/services/document-revision.service', () => ({
  CounterpartyIdentityValidationError: mocks.CounterpartyIdentityValidationError,
  parseReviewerCounterpartyIdentity: mocks.parseReviewerCounterpartyIdentity,
  validateRevision: mocks.validateRevision,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: { findUnique: vi.fn() }, documentRevision: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { PATCH } from '@/app/api/processing-documents/[documentId]/revisions/[revisionId]/route';

describe('revision counterparty identity PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-1' });
    mocks.canAccessCompany.mockResolvedValue(true);
    mocks.getProcessingDocument.mockResolvedValue({ documentId: 'base-document', lockVersion: 2 });
    vi.mocked(prisma.document.findUnique).mockResolvedValue({ companyId: 'company-1', tenantId: 'tenant-1' } as never);
    vi.mocked(prisma.documentRevision.findUnique).mockResolvedValue({ id: 'revision-1', status: 'DRAFT', revisionNumber: 1 } as never);
    mocks.validateRevision.mockResolvedValue({ status: 'VALID', issues: [] });
  });

  it('returns 400 with field-level identity issues before writing', async () => {
    mocks.parseReviewerCounterpartyIdentity.mockImplementation(() => {
      throw new mocks.CounterpartyIdentityValidationError([
        { field: 'email', message: 'Enter a valid email address' },
      ]);
    });

    const response = await patch({ counterpartyIdentity: { email: 'bad' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toEqual(expect.objectContaining({
      code: 'VALIDATION_ERROR',
      issues: [{ field: 'email', message: 'Enter a valid email address' }],
    }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes only the server-derived reviewer identity', async () => {
    const derived = {
      identificationType: 'UEN', identificationNumber: '202012345A', email: 'billing@example.sg',
      confidence: { identificationNumber: 1, email: 1 },
    };
    mocks.parseReviewerCounterpartyIdentity.mockReturnValue(derived);
    const tx = {
      documentRevision: { update: vi.fn().mockResolvedValue({}) },
      documentRevisionLineItem: { deleteMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
      processingDocument: { update: vi.fn().mockResolvedValue({}) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: unknown) => (
      callback as (client: typeof tx) => Promise<unknown>
    )(tx) as never);
    mocks.getProcessingDocument
      .mockResolvedValueOnce({ documentId: 'base-document', lockVersion: 2 })
      .mockResolvedValueOnce({ documentId: 'base-document', lockVersion: 3 });

    const response = await patch({
      counterpartyIdentity: {
        identificationType: 'UEN', identificationNumber: '202012345A', email: 'billing@example.sg',
        confidence: { identificationNumber: 0.01, email: 0.01 },
      },
    });

    expect(response.status).toBe(200);
    expect(tx.documentRevision.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ counterpartyIdentity: derived }),
    }));
  });

  async function patch(counterpartyIdentity: unknown) {
    const request = new NextRequest('http://localhost/api/processing-documents/document-1/revisions/revision-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': '2' },
      body: JSON.stringify({ headerUpdates: { counterpartyIdentity } }),
    });
    return PATCH(request, { params: Promise.resolve({ documentId: 'document-1', revisionId: 'revision-1' }) });
  }
});
