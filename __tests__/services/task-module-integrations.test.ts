import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  getStageDetail: vi.fn(),
  linkOutcome: vi.fn(),
  reconcileOutcome: vi.fn(),
  outcomeFindMany: vi.fn(),
  stageFindFirst: vi.fn(),
  outcomeFindFirst: vi.fn(),
  documentFindFirst: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/services/tasks/stage.service', () => ({
  getTaskStageDetail: mocks.getStageDetail,
  linkTaskStageOutcome: mocks.linkOutcome,
  reconcileTaskStageOutcome: mocks.reconcileOutcome,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskStage: { findFirst: mocks.stageFindFirst },
    taskStageOutcome: {
      findFirst: mocks.outcomeFindFirst,
      findMany: mocks.outcomeFindMany,
    },
    generatedDocument: { findFirst: mocks.documentFindFirst },
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: mocks.warn }),
}));

import {
  findPreferredEsigningDocument,
  preflightTaskLaunchContext,
  resolveEsigningGeneratedDocument,
  safelyLinkGeneratedDocumentTaskOutcome,
  safelyReconcileEsigningEnvelopeTaskOutcomes,
  linkCompanyTaskOutcome,
  linkEsigningEnvelopeTaskOutcome,
  linkGeneratedDocumentTaskOutcome,
  linkFirstGeneratedDocumentTaskOutcomeForBatch,
  parseTaskLaunchContext,
  reconcileEsigningEnvelopeTaskOutcomes,
  reconcileGeneratedDocumentTaskOutcomes,
} from '@/services/tasks/integration.service';

const context = {
  taskId: '11111111-1111-4111-8111-111111111111',
  taskStageId: '22222222-2222-4222-8222-222222222222',
  returnTo: '/tasks',
};

describe('task module integration service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getStageDetail.mockResolvedValue({
      id: context.taskStageId,
      taskId: context.taskId,
      actionType: 'DOCUMENT_GENERATION',
    });
    mocks.linkOutcome.mockResolvedValue({ status: 'IN_PROGRESS' });
    mocks.reconcileOutcome.mockResolvedValue({ status: 'COMPLETED' });
  });

  it('preflights tenant, task, stage, and expected action before a business write', async () => {
    mocks.getStageDetail.mockResolvedValueOnce({
      id: context.taskStageId,
      taskId: context.taskId,
      actionType: 'COMPANY_PROFILE',
    });
    await expect(preflightTaskLaunchContext(
      'tenant-a',
      context,
      'COMPANY_PROFILE',
    )).resolves.toMatchObject({ actionType: 'COMPANY_PROFILE' });

    mocks.getStageDetail.mockResolvedValueOnce({
      id: context.taskStageId,
      taskId: context.taskId,
      actionType: 'MANUAL',
    });
    await expect(preflightTaskLaunchContext(
      'tenant-a',
      context,
      'COMPANY_PROFILE',
    )).rejects.toThrow('action');
  });

  it('isolates post-commit task callback failures and records a warning', async () => {
    mocks.getStageDetail.mockRejectedValueOnce(new Error('task store unavailable'));
    await expect(safelyLinkGeneratedDocumentTaskOutcome({
      tenantId: 'tenant-a',
      context,
      authoritativeId: '33333333-3333-4333-8333-333333333333',
      userId: 'user-1',
    })).resolves.toBeUndefined();

    mocks.outcomeFindMany.mockRejectedValueOnce(new Error('task store unavailable'));
    await expect(safelyReconcileEsigningEnvelopeTaskOutcomes(
      'tenant-a',
      '44444444-4444-4444-8444-444444444444',
    )).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledTimes(2);
  });

  it('accepts an absent context and validates the exact launch context shape', () => {
    expect(parseTaskLaunchContext(undefined)).toBeUndefined();
    expect(parseTaskLaunchContext(context)).toEqual(context);
    expect(() => parseTaskLaunchContext({
      ...context,
      taskId: 'not-a-uuid',
    })).toThrow();
    expect(() => parseTaskLaunchContext({
      ...context,
      unexpected: true,
    })).toThrow();
  });

  it.each([
    ['company', linkCompanyTaskOutcome, { type: 'COMPANY', companyId: '33333333-3333-4333-8333-333333333333' }],
    ['document', linkGeneratedDocumentTaskOutcome, {
      type: 'GENERATED_DOCUMENT',
      generatedDocumentId: '33333333-3333-4333-8333-333333333333',
    }],
    ['envelope', linkEsigningEnvelopeTaskOutcome, {
      type: 'ESIGNING_ENVELOPE',
      esigningEnvelopeId: '33333333-3333-4333-8333-333333333333',
    }],
  ])('links an authoritative %s only after validating the task/stage pair', async (
    _label,
    link,
    expectedOutcome,
  ) => {
    await link({
      tenantId: 'tenant-a',
      context,
      authoritativeId: '33333333-3333-4333-8333-333333333333',
      userId: 'user-1',
    });

    expect(mocks.getStageDetail).toHaveBeenCalledWith(
      'tenant-a',
      context.taskId,
      context.taskStageId,
    );
    expect(mocks.linkOutcome).toHaveBeenCalledWith(
      'tenant-a',
      context.taskStageId,
      expectedOutcome,
      'user-1',
      { protectAuthoritativeCompany: true },
    );
    expect(mocks.getStageDetail.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.linkOutcome.mock.invocationCallOrder[0]);
  });

  it('reconciles every linked document stage within the tenant', async () => {
    mocks.outcomeFindMany.mockResolvedValue([
      { taskStageId: 'stage-1' },
      { taskStageId: 'stage-2' },
    ]);

    await reconcileGeneratedDocumentTaskOutcomes(
      'tenant-a',
      '33333333-3333-4333-8333-333333333333',
      'user-1',
    );

    expect(mocks.outcomeFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        generatedDocumentId: '33333333-3333-4333-8333-333333333333',
      },
      select: { taskStageId: true },
    });
    expect(mocks.reconcileOutcome).toHaveBeenCalledTimes(2);
  });

  it('links only the first batch success when the stage has no generated-document outcome', async () => {
    mocks.outcomeFindFirst.mockResolvedValue(null);

    await linkFirstGeneratedDocumentTaskOutcomeForBatch({
      tenantId: 'tenant-a',
      taskContext: context,
      userId: 'user-1',
      successes: [
        { itemId: 'item-1', documentId: '33333333-3333-4333-8333-333333333333', title: 'First' },
        { itemId: 'item-2', documentId: '44444444-4444-4444-8444-444444444444', title: 'Second' },
      ],
    });

    expect(mocks.outcomeFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        taskStageId: context.taskStageId,
        type: 'GENERATED_DOCUMENT',
      },
      select: { id: true },
    });
    expect(mocks.linkOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.linkOutcome).toHaveBeenCalledWith(
      'tenant-a',
      context.taskStageId,
      {
        type: 'GENERATED_DOCUMENT',
        generatedDocumentId: '33333333-3333-4333-8333-333333333333',
      },
      'user-1',
      { protectAuthoritativeCompany: true },
    );
  });

  it('never overwrites an already-linked generated-document outcome on retry', async () => {
    mocks.outcomeFindFirst.mockResolvedValue({ id: 'outcome-1' });

    await linkFirstGeneratedDocumentTaskOutcomeForBatch({
      tenantId: 'tenant-a',
      taskContext: context,
      userId: 'user-1',
      successes: [
        { itemId: 'item-1', documentId: '33333333-3333-4333-8333-333333333333', title: 'First' },
      ],
    });

    expect(mocks.linkOutcome).not.toHaveBeenCalled();
  });

  it('reconciles every linked e-signing stage within the tenant', async () => {
    mocks.outcomeFindMany.mockResolvedValue([{ taskStageId: 'stage-1' }]);

    await reconcileEsigningEnvelopeTaskOutcomes(
      'tenant-a',
      '44444444-4444-4444-8444-444444444444',
    );

    expect(mocks.outcomeFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        esigningEnvelopeId: '44444444-4444-4444-8444-444444444444',
      },
      select: { taskStageId: true },
    });
    expect(mocks.reconcileOutcome).toHaveBeenCalledWith(
      'tenant-a',
      'stage-1',
      undefined,
    );
  });

  it('defaults e-signing to the nearest preceding finalized generated document', async () => {
    mocks.stageFindFirst.mockResolvedValue({
      id: context.taskStageId,
      position: 2,
    });
    mocks.outcomeFindFirst.mockResolvedValue({
      generatedDocument: {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Engagement letter',
        companyId: '55555555-5555-4555-8555-555555555555',
      },
    });

    await expect(findPreferredEsigningDocument('tenant-a', context)).resolves.toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Engagement letter',
      companyId: '55555555-5555-4555-8555-555555555555',
    });
    expect(mocks.outcomeFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        taskStage: {
          taskId: context.taskId,
          position: { lt: 2 },
          actionType: 'DOCUMENT_GENERATION',
        },
        generatedDocument: {
          tenantId: 'tenant-a',
          status: 'FINALIZED',
          deletedAt: null,
        },
      },
      orderBy: { taskStage: { position: 'desc' } },
      select: {
        generatedDocument: {
          select: { id: true, title: true, companyId: true },
        },
      },
    });
  });

  it('uses the preceding finalized document by default and validates an alternate selection', async () => {
    mocks.getStageDetail.mockResolvedValue({
      id: context.taskStageId,
      taskId: context.taskId,
      actionType: 'ESIGNING',
    });
    mocks.stageFindFirst.mockResolvedValue({
      id: context.taskStageId,
      position: 2,
    });
    mocks.outcomeFindFirst.mockResolvedValue({
      generatedDocument: {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Default contract',
        companyId: null,
      },
    });

    await expect(resolveEsigningGeneratedDocument(
      'tenant-a',
      context,
    )).resolves.toMatchObject({ title: 'Default contract' });

    mocks.documentFindFirst.mockResolvedValue({
      id: '66666666-6666-4666-8666-666666666666',
      title: 'Alternate final contract',
      companyId: null,
    });
    await expect(resolveEsigningGeneratedDocument(
      'tenant-a',
      context,
      '66666666-6666-4666-8666-666666666666',
    )).resolves.toMatchObject({ title: 'Alternate final contract' });
    expect(mocks.documentFindFirst).toHaveBeenCalledWith({
      where: {
        id: '66666666-6666-4666-8666-666666666666',
        tenantId: 'tenant-a',
        status: 'FINALIZED',
        deletedAt: null,
      },
      select: { id: true, title: true, companyId: true },
    });

    mocks.documentFindFirst.mockResolvedValueOnce(null);
    await expect(resolveEsigningGeneratedDocument(
      'tenant-a',
      context,
      '77777777-7777-4777-8777-777777777777',
    )).rejects.toThrow('finalized');
  });
});

describe('authoritative module callback contracts', () => {
  const source = (relativePath: string) => fs.readFileSync(
    path.join(process.cwd(), relativePath),
    'utf8',
  );
  const envelopeModules = () => ['lifecycle', 'recipients', 'documents', 'delivery']
    .map((name) => source(`src/services/esigning-envelope/${name}.ts`))
    .join('\n');

  it('preserves task context through manual company and BizFile creation', () => {
    const companyRoute = source('src/app/api/companies/route.ts');
    const bizfileRoute = source('src/app/api/documents/[documentId]/confirm/route.ts');

    expect(companyRoute).toContain('parseTaskLaunchContext(body.taskContext)');
    expect(companyRoute).toContain('safelyLinkCompanyTaskOutcome');
    expect(bizfileRoute).toContain('parseTaskLaunchContext');
    expect(bizfileRoute).toContain('safelyLinkCompanyTaskOutcome');
  });

  it('links document drafts and reconciles finalization changes', () => {
    const documentRoute = source('src/app/api/generated-documents/route.ts');
    const sessionRoute = source(
      'src/app/api/generated-documents/generation-sessions/route.ts',
    );
    const generator = source('src/services/document-generator.service.ts');

    expect(documentRoute).toContain('safelyLinkGeneratedDocumentTaskOutcome');
    expect(sessionRoute).toContain('safelyLinkGeneratedDocumentTaskOutcome');
    expect(generator).toContain('safelyReconcileGeneratedDocumentTaskOutcomes');
    expect(generator).toMatch(
      /deleteGeneratedDocument[\s\S]+safelyReconcileGeneratedDocumentTaskOutcomes/,
    );
  });

  it('links envelopes and reconciles every terminal signing lifecycle', () => {
    const envelopeRoute = source('src/app/api/esigning/envelopes/route.ts');
    const envelopeService = envelopeModules();
    const signingService = source('src/services/esigning-signing.service.ts');

    expect(envelopeRoute).toContain('safelyLinkEsigningEnvelopeTaskOutcome');
    expect(envelopeRoute).toContain('resolveEsigningGeneratedDocument');
    expect(envelopeRoute).toContain('uploadGeneratedDocumentToEsigningEnvelope');
    expect(envelopeService).toContain('safelyReconcileEsigningEnvelopeTaskOutcomes');
    expect(signingService).toContain('safelyReconcileEsigningEnvelopeTaskOutcomes');
    expect(envelopeService).toMatch(
      /deleteDraftEsigningEnvelope[\s\S]+safelyReconcileTaskStageIds/,
    );
  });

  it('persists durable creation context and self-heals missed links on stage reads', () => {
    const schema = source('prisma/schema.prisma');
    const company = source('src/services/company.service.ts');
    const generationSession = source('src/services/document-generation-session.service.ts');
    const envelope = envelopeModules();
    const stage = source('src/services/tasks/stage.service.ts');
    const bizfile = source('src/services/bizfile/processor.ts');
    const bizfileRoute = source('src/app/api/documents/[documentId]/confirm/route.ts');

    expect(schema).toContain('taskIntegrationContext');
    expect(schema).toContain('model TaskCompanyRecoveryContext');
    expect(schema).toContain('@@unique([tenantId, taskStageId])');
    expect(schema).toMatch(/task\s+Task\s+@relation/);
    expect(schema).toMatch(/companyId\s+String\?\s+@map\("company_id"\)/);
    expect(schema).toMatch(
      /model TaskCompanyRecoveryContext[\s\S]+company\s+Company\?\s+@relation\([\s\S]+onDelete: SetNull/,
    );
    expect(company).toContain('taskIntegrationContext');
    expect(generationSession).toContain('taskIntegrationContext');
    expect(envelope).toContain('taskIntegrationContext');
    expect(bizfile).toContain('taskIntegrationContext');
    expect(bizfileRoute).toMatch(
      /processBizFileExtraction\([\s\S]+taskContext/,
    );
    expect(stage).toContain('recoverTaskStageOutcomeFromDurableContext');
    expect(stage).toContain('taskCompanyRecoveryContext');
    expect(stage).toContain('reconcileTaskStageOutcome');
  });

  it('checks document read permission before resolving or exporting an E-sign document', () => {
    const route = source('src/app/api/esigning/envelopes/route.ts');
    const permissionIndex = route.indexOf(
      "requirePermission(session, 'document', 'read')",
    );
    const resolutionIndex = route.lastIndexOf('resolveEsigningGeneratedDocument');
    const exportIndex = route.lastIndexOf('uploadGeneratedDocumentToEsigningEnvelope');

    expect(permissionIndex).toBeGreaterThan(-1);
    expect(permissionIndex).toBeLessThan(resolutionIndex);
    expect(permissionIndex).toBeLessThan(exportIndex);
  });

  it('reconciles company delete/restore and compensates failed E-sign imports', () => {
    const company = source('src/services/company.service.ts');
    const envelopeRoute = source('src/app/api/esigning/envelopes/route.ts');

    expect(company).toMatch(
      /deleteCompany[\s\S]+safelyReconcileCompanyTaskOutcomes/,
    );
    expect(company).toMatch(
      /restoreCompany[\s\S]+safelyReconcileCompanyTaskOutcomes/,
    );
    expect(company).toMatch(
      /permanentDeleteCompany[\s\S]+safelyReconcileTaskStageIds/,
    );
    expect(source('src/services/tasks/integration.service.ts')).toMatch(
      /safelyCaptureCompanyTaskStageIds[\s\S]+taskCompanyRecoveryContext\.findMany/,
    );
    expect(source('src/services/tasks/integration.service.ts')).toMatch(
      /safelyReconcileTaskStageIds[\s\S]+getTaskStageDetail\(tenantId, taskId, id, userId\)/,
    );
    expect(envelopeRoute).toMatch(
      /uploadGeneratedDocumentToEsigningEnvelope[\s\S]+deleteDraftEsigningEnvelope/,
    );
  });
});
