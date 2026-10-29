import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listEsigningEnvelopes } from '@/services/esigning-envelope.service';

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  groupBy: vi.fn(),
  companyFindMany: vi.fn(),
  transaction: vi.fn(),
}));

const rbacMocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    esigningEnvelope: {
      count: mocks.count,
      findMany: mocks.findMany,
      groupBy: mocks.groupBy,
    },
    company: {
      findMany: mocks.companyFindMany,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/rbac', () => ({
  hasPermission: rbacMocks.hasPermission,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const session = {
  id: 'user-1',
  tenantId: 'tenant-1',
  isSuperAdmin: true,
  isWorkspaceAdmin: true,
} as never;

describe('e-signing envelope list company filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (queries: Promise<unknown>[]) =>
      Promise.all(queries)
    );
    mocks.count.mockResolvedValue(27);
    mocks.findMany.mockResolvedValue([]);
    mocks.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { companyId: 'company-2', _count: { _all: 12 } },
        { companyId: null, _count: { _all: 3 } },
      ]);
    mocks.companyFindMany.mockResolvedValue([{ id: 'company-2', name: 'Acme Pte Ltd' }]);
  });

  it('applies the company filter before count, skip, and take', async () => {
    const result = await listEsigningEnvelopes(session, 'tenant-1', {
      companyId: 'company-2',
      page: 3,
      limit: 20,
      createdBy: 'all',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    expect(mocks.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ companyId: 'company-2' }),
    });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-2' }),
        skip: 40,
        take: 20,
      })
    );
    expect(result.total).toBe(27);
  });

  it('builds company options from all matching envelopes, not returned page rows', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'envelope-1',
        tenantId: 'tenant-1',
        title: 'NDA',
        message: null,
        status: 'COMPLETED',
        signingOrder: 'PARALLEL',
        expiresAt: null,
        reminderFrequencyDays: null,
        reminderStartDays: null,
        expiryWarningDays: null,
        companyId: null,
        company: null,
        certificateId: 'certificate-1',
        completedAt: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        voidedAt: null,
        voidReason: null,
        pdfGenerationStatus: null,
        pdfGenerationError: null,
        autoFilingStatus: 'NOT_REQUIRED',
        createdById: 'user-1',
        createdBy: { id: 'user-1', firstName: 'Sender', lastName: null, email: 'sender@example.com' },
        documents: [],
        recipients: [],
        emailDeliveries: [],
        metadata: null,
      },
    ]);

    const result = await listEsigningEnvelopes(session, 'tenant-1', {
      page: 1,
      limit: 20,
      createdBy: 'all',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    expect(result.envelopes).toHaveLength(1);
    expect(result.companyOptions).toEqual([
      { id: 'company-2', name: 'Acme Pte Ltd', count: 12 },
    ]);
    expect(mocks.companyFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['company-2'] },
        tenantId: 'tenant-1',
      },
      select: { id: true, name: true },
    });
  });

  it('keeps status tab counts scoped to the company but company options scoped to the tab', async () => {
    await listEsigningEnvelopes(session, 'tenant-1', {
      companyId: 'company-2',
      statuses: ['DRAFT'],
      page: 1,
      limit: 20,
      createdBy: 'all',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    expect(mocks.groupBy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        by: ['status'],
        where: expect.objectContaining({
          companyId: 'company-2',
        }),
      })
    );
    expect(mocks.groupBy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        by: ['companyId'],
        where: expect.objectContaining({
          status: { in: ['DRAFT'] },
          companyId: { not: null },
        }),
      })
    );
  });

  it('searches envelope, company, document, recipient name, and recipient email on the server', async () => {
    await listEsigningEnvelopes(session, 'tenant-1', {
      query: 'Tax',
      page: 1,
      limit: 20,
      createdBy: 'all',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    expect(mocks.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { title: { contains: 'Tax', mode: 'insensitive' } },
          {
            company: {
              is: {
                name: { contains: 'Tax', mode: 'insensitive' },
              },
            },
          },
          {
            documents: {
              some: {
                OR: [
                  { fileName: { contains: 'Tax', mode: 'insensitive' } },
                  { originalFileName: { contains: 'Tax', mode: 'insensitive' } },
                ],
              },
            },
          },
          { recipients: { some: { name: { contains: 'Tax', mode: 'insensitive' } } } },
          { recipients: { some: { email: { contains: 'Tax', mode: 'insensitive' } } } },
        ]),
      }),
    });
  });

  it('combines advanced envelope filters before pagination', async () => {
    await listEsigningEnvelopes(session, 'tenant-1', {
      documentName: 'Financial',
      recipientQuery: 'john@example.com',
      recipientStatus: 'VIEWED',
      signingOrder: 'PARALLEL',
      createdFrom: '2026-09-01',
      createdTo: '2026-09-30',
      sentFrom: '2026-09-02',
      sentTo: '2026-09-29',
      completedFrom: '2026-09-03',
      completedTo: '2026-09-28',
      page: 2,
      limit: 20,
      createdBy: 'all',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          documents: {
            some: {
              OR: [
                { fileName: { contains: 'Financial', mode: 'insensitive' } },
                { originalFileName: { contains: 'Financial', mode: 'insensitive' } },
              ],
            },
          },
          recipients: {
            some: {
              OR: [
                { name: { contains: 'john@example.com', mode: 'insensitive' } },
                { email: { contains: 'john@example.com', mode: 'insensitive' } },
              ],
              status: 'VIEWED',
            },
          },
          signingOrder: 'PARALLEL',
          createdAt: {
            gte: new Date('2026-09-01T00:00:00.000Z'),
            lt: new Date('2026-10-01T00:00:00.000Z'),
          },
          completedAt: {
            gte: new Date('2026-09-03T00:00:00.000Z'),
            lt: new Date('2026-09-29T00:00:00.000Z'),
          },
          events: {
            some: {
              action: 'SENT',
              createdAt: {
                gte: new Date('2026-09-02T00:00:00.000Z'),
                lt: new Date('2026-09-30T00:00:00.000Z'),
              },
            },
          },
        }),
        skip: 20,
        take: 20,
      })
    );
  });

  it('returns document names and completed signer progress for both list views', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'envelope-1',
        tenantId: 'tenant-1',
        title: 'Signing package',
        status: 'IN_PROGRESS',
        signingOrder: 'PARALLEL',
        expiresAt: null,
        companyId: null,
        company: null,
        certificateId: 'certificate-1',
        completedAt: null,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-02T00:00:00.000Z'),
        pdfGenerationStatus: null,
        autoFilingStatus: 'NOT_REQUIRED',
        createdById: 'user-1',
        createdBy: { id: 'user-1', firstName: 'Sender', lastName: null, email: 'sender@example.com' },
        documents: [
          { id: 'document-1', fileName: 'FY2026 Financial Statements.pdf' },
          { id: 'document-2', fileName: 'Tax Computation YA2027.pdf' },
        ],
        recipients: [
          {
            id: 'recipient-1',
            name: 'John Tan',
            email: 'john@example.com',
            type: 'SIGNER',
            status: 'SIGNED',
            signingOrder: null,
          },
          {
            id: 'recipient-2',
            name: 'Mary Lim',
            email: 'mary@example.com',
            type: 'SIGNER',
            status: 'VIEWED',
            signingOrder: null,
          },
        ],
        emailDeliveries: [],
        metadata: null,
      },
    ]);

    const result = await listEsigningEnvelopes(session, 'tenant-1', {
      page: 1,
      limit: 20,
      createdBy: 'all',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    expect(result.envelopes[0]).toMatchObject({
      documentCount: 2,
      signerCount: 2,
      completedSignerCount: 1,
      documents: [
        { id: 'document-1', fileName: 'FY2026 Financial Statements.pdf' },
        { id: 'document-2', fileName: 'Tax Computation YA2027.pdf' },
      ],
    });
  });

  it('sorts company by company name on the server', async () => {
    await listEsigningEnvelopes(session, 'tenant-1', {
      page: 1,
      limit: 20,
      createdBy: 'all',
      sortBy: 'companyName',
      sortOrder: 'asc',
    });

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { company: { name: 'asc' } },
          { updatedAt: 'desc' },
        ],
      })
    );
  });

  it('sorts details by document count then recipient count on the server', async () => {
    await listEsigningEnvelopes(session, 'tenant-1', {
      page: 1,
      limit: 20,
      createdBy: 'all',
      sortBy: 'details',
      sortOrder: 'desc',
    });

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { documents: { _count: 'desc' } },
          { recipients: { _count: 'desc' } },
          { updatedAt: 'desc' },
        ],
      })
    );
  });

  it('serializes the real ledger snapshot for delivery health and completion status', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'envelope-1',
        tenantId: 'tenant-1',
        title: 'NDA',
        message: null,
        status: 'COMPLETED',
        signingOrder: 'PARALLEL',
        expiresAt: null,
        reminderFrequencyDays: null,
        reminderStartDays: null,
        expiryWarningDays: null,
        companyId: null,
        company: null,
        certificateId: 'certificate-1',
        completedAt: new Date('2026-08-01T00:00:00.000Z'),
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        voidedAt: null,
        voidReason: null,
        pdfGenerationStatus: 'COMPLETED',
        pdfGenerationError: null,
        autoFilingStatus: 'COMPLETED',
        createdById: 'user-1',
        createdBy: { id: 'user-1', firstName: 'Sender', lastName: null, email: 'sender@example.com' },
        documents: [],
        recipients: [],
        emailDeliveries: [
          {
            kind: 'REQUEST',
            targetKey: 'recipient:recipient-1',
            toEmail: 'signer@example.com',
            subject: 'Signature requested',
            status: 'FAILED_RETRYABLE',
            lastError: 'SMTP rejected recipient',
            lastAttemptedAt: new Date('2026-08-01T01:00:00.000Z'),
          },
        ],
        metadata: null,
      },
    ]);

    const result = await listEsigningEnvelopes(session, 'tenant-1', {
      page: 1,
      limit: 20,
      createdBy: 'all',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    expect(result.envelopes[0].emailDelivery).toMatchObject({
      status: 'failed',
      failures: [
        expect.objectContaining({
          kind: 'request',
          to: 'signer@example.com',
          error: 'SMTP rejected recipient',
        }),
      ],
    });
    expect(result.envelopes[0].postCompletion).toMatchObject({
      completionDeliveryStatus: 'NOT_TRACKED',
      failedCompletionDeliveryCount: 0,
    });
    expect(result.envelopes[0].canRetryCompletionProcessing).toBe(false);
  });

  it('derives completed copy delivery from COMPLETION rows only', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'envelope-1',
        tenantId: 'tenant-1',
        title: 'NDA',
        message: null,
        status: 'COMPLETED',
        signingOrder: 'PARALLEL',
        expiresAt: null,
        reminderFrequencyDays: null,
        reminderStartDays: null,
        expiryWarningDays: null,
        companyId: null,
        company: null,
        certificateId: 'certificate-1',
        completedAt: new Date('2026-08-01T00:00:00.000Z'),
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        voidedAt: null,
        voidReason: null,
        pdfGenerationStatus: 'COMPLETED',
        pdfGenerationError: null,
        autoFilingStatus: 'COMPLETED',
        createdById: 'user-1',
        createdBy: { id: 'user-1', firstName: 'Sender', lastName: null, email: 'sender@example.com' },
        documents: [],
        recipients: [],
        emailDeliveries: [
          {
            kind: 'REQUEST',
            targetKey: 'recipient:recipient-1',
            toEmail: 'signer@example.com',
            subject: 'Signature requested',
            status: 'SUCCEEDED',
            lastError: null,
            lastAttemptedAt: new Date('2026-08-01T01:00:00.000Z'),
          },
          {
            kind: 'COMPLETION',
            targetKey: 'recipient:recipient-1',
            toEmail: 'signer@example.com',
            subject: 'Completed: NDA',
            status: 'SUCCEEDED',
            lastError: null,
            lastAttemptedAt: new Date('2026-08-01T02:00:00.000Z'),
          },
        ],
        metadata: null,
      },
    ]);

    const result = await listEsigningEnvelopes(session, 'tenant-1', {
      page: 1,
      limit: 20,
      createdBy: 'all',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    expect(result.envelopes[0].emailDelivery.status).toBe('ok');
    expect(result.envelopes[0].postCompletion).toMatchObject({
      completionDeliveryStatus: 'COMPLETED',
      failedCompletionDeliveryCount: 0,
    });
  });

  it('matches canRetryCompletionProcessing to update-scope object authorization', async () => {
    rbacMocks.hasPermission.mockImplementation(
      async (_userId: string, _resource: string, permission: string) => permission === 'update'
    );
    const actor = {
      id: 'user-1',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
      isWorkspaceAdmin: false,
    } as never;
    const failedCompletion = {
      kind: 'COMPLETION',
      targetKey: 'recipient:recipient-1',
      toEmail: 'signer@example.com',
      subject: 'Completed: NDA',
      status: 'FAILED_RETRYABLE',
      lastError: 'SMTP rejected recipient',
      lastAttemptedAt: new Date('2026-08-01T02:00:00.000Z'),
    };
    mocks.findMany.mockResolvedValue([
      {
        id: 'envelope-1',
        tenantId: 'tenant-1',
        title: 'NDA',
        message: null,
        status: 'COMPLETED',
        signingOrder: 'PARALLEL',
        expiresAt: null,
        reminderFrequencyDays: null,
        reminderStartDays: null,
        expiryWarningDays: null,
        companyId: null,
        company: null,
        certificateId: 'certificate-1',
        completedAt: new Date('2026-08-01T00:00:00.000Z'),
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        voidedAt: null,
        voidReason: null,
        pdfGenerationStatus: 'COMPLETED',
        pdfGenerationError: null,
        autoFilingStatus: 'COMPLETED',
        createdById: 'user-1',
        createdBy: { id: 'user-1', firstName: 'Sender', lastName: null, email: 'sender@example.com' },
        documents: [],
        recipients: [],
        emailDeliveries: [failedCompletion],
        metadata: null,
      },
    ]);

    const result = await listEsigningEnvelopes(actor, 'tenant-1', {
      page: 1,
      limit: 20,
      createdBy: 'all',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    expect(result.envelopes[0].canRetryCompletionProcessing).toBe(true);
    expect(result.envelopes[0].postCompletion.completionDeliveryStatus).toBe('RETRYING');
  });
});
