// @vitest-environment node
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * OAK-001 regression: two signers finishing together used to leave the envelope
 * IN_PROGRESS with every recipient SIGNED, and a decline or void could overwrite
 * a completion that committed a moment earlier (and vice versa). These tests run
 * the real service functions concurrently against PostgreSQL.
 */

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('E-signing completion race PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

const ROUNDS = 20;
// Offsets (ms) before the later action starts. Even rounds delay the decline/void,
// odd rounds delay the completion, so both orderings of each race are exercised.
const STAGGER_MS = [0, 5, 10, 20, 40, 80];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sessionContext = new AsyncLocalStorage<{ recipientId: string; envelopeId: string }>();

vi.mock('@/lib/esigning-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/esigning-session')>();
  return {
    ...actual,
    getEsigningSessionClaims: vi.fn(async () => {
      const store = sessionContext.getStore();
      return store
        ? { ...store, sessionVersion: 1, sessionId: 'race-session', scope: 'esigning_session' }
        : null;
    }),
    clearEsigningSessionCookie: vi.fn(async () => undefined),
  };
});

vi.mock('@/lib/storage', () => ({
  storage: {
    download: vi.fn(),
    upload: vi.fn(),
    exists: vi.fn(async () => true),
  },
  StorageKeys: {},
}));

vi.mock('@/services/esigning-pdf.service', () => ({
  generateEsigningEnvelopeArtifactsNow: vi.fn(async () => 'generated'),
}));

vi.mock('@/services/esigning-notification.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/esigning-notification.service')>();
  return {
    ...actual,
    sendEsigningDeclinedEmailToSender: vi.fn(async () => ({
      ok: true,
      kind: 'declined',
      to: 'sender@example.test',
      subject: 'Declined',
      attemptedAt: new Date().toISOString(),
    })),
    sendEsigningVoidedEmailToRecipient: vi.fn(async () => ({
      ok: true,
      kind: 'voided',
      to: 'recipient@example.test',
      subject: 'Voided',
      attemptedAt: new Date().toISOString(),
    })),
  };
});

vi.mock('@/services/tasks/integration.service', () => ({
  safelyReconcileEsigningEnvelopeTaskOutcomes: vi.fn(async () => undefined),
  safelyCaptureEsigningTaskStageIds: vi.fn(async () => undefined),
  safelyReconcileTaskStageIds: vi.fn(async () => undefined),
}));

vi.mock('@/services/esigning-envelope.lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/esigning-envelope.lib')>();
  return {
    ...actual,
    resolveEsigningActorScope: vi.fn(async () => ({ canManage: true })),
  };
});

vi.mock('@/services/esigning-envelope/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/esigning-envelope/lifecycle')>();
  return { ...actual, getEsigningEnvelopeDetail: vi.fn(async () => ({})) };
});

const describePostgres = testDatabaseUrl ? describe : describe.skip;

type SeedRecipient = {
  name: string;
  status: 'VIEWED' | 'SIGNED';
};

describePostgres('e-signing completion race (PostgreSQL)', () => {
  let prisma: Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
  let signing: typeof import('@/services/esigning-signing.service');
  let envelopeService: typeof import('@/services/esigning-envelope.service');
  const tenantIds: string[] = [];
  const previousLogLevel = process.env.LOG_LEVEL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.LOG_LEVEL = 'silent';
    prisma = (await import('@/lib/prisma')).getPrisma();
    signing = await import('@/services/esigning-signing.service');
    envelopeService = await import('@/services/esigning-envelope.service');
  });

  afterAll(async () => {
    for (const tenantId of tenantIds.splice(0)) {
      await prisma.esigningEnvelope.deleteMany({ where: { tenantId } });
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.workspace.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
    if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previousLogLevel;
  });

  async function seed(input: {
    envelopeStatus?: 'SENT' | 'IN_PROGRESS';
    recipients: SeedRecipient[];
  }) {
    const suffix = randomUUID();
    const workspace = await prisma.workspace.create({
      data: { name: `race ${suffix}`, slug: `race-${suffix}` },
    });
    tenantIds.push(workspace.id);
    const user = await prisma.user.create({
      data: {
        tenantId: workspace.id,
        email: `race-${suffix}@example.test`,
        passwordHash: 'not-used',
        firstName: 'Race',
        lastName: 'Sender',
      },
    });
    const envelope = await prisma.esigningEnvelope.create({
      data: {
        tenantId: workspace.id,
        createdById: user.id,
        title: 'Race',
        status: input.envelopeStatus ?? 'SENT',
        signingOrder: 'PARALLEL',
        certificateId: `race-${suffix}`,
      },
    });
    const document = await prisma.esigningEnvelopeDocument.create({
      data: {
        tenantId: workspace.id,
        envelopeId: envelope.id,
        fileName: 'a.pdf',
        storagePath: 'x',
        originalHash: 'h',
        pageCount: 1,
        sortOrder: 0,
        fileSize: 1,
      },
    });

    const recipients = [];
    for (const [index, entry] of input.recipients.entries()) {
      const recipient = await prisma.esigningEnvelopeRecipient.create({
        data: {
          tenantId: workspace.id,
          envelopeId: envelope.id,
          type: 'SIGNER',
          name: entry.name,
          email: `${entry.name}-${suffix}@example.test`,
          signingOrder: 1,
          status: entry.status,
          signedAt: entry.status === 'SIGNED' ? new Date(Date.now() - (index + 1) * 60_000) : null,
          accessMode: 'EMAIL_LINK',
          consentedAt: new Date(),
          colorTag: '#ffffff',
        },
      });
      await prisma.esigningDocumentFieldDefinition.create({
        data: {
          tenantId: workspace.id,
          envelopeId: envelope.id,
          documentId: document.id,
          recipientId: recipient.id,
          type: 'TEXT',
          pageNumber: 1,
          xPercent: 10,
          yPercent: 10,
          widthPercent: 20,
          heightPercent: 5,
          required: true,
          sortOrder: 0,
        },
      });
      recipients.push(recipient);
    }
    const fieldDefinitions = await prisma.esigningDocumentFieldDefinition.findMany({
      where: { envelopeId: envelope.id },
    });
    return { envelope, recipients, fieldDefinitions, tenantId: workspace.id, userId: user.id };
  }

  function actAs<T>(envelopeId: string, recipientId: string, fn: () => Promise<T>): Promise<T> {
    return sessionContext.run({ envelopeId, recipientId }, fn);
  }

  function complete(
    seeded: Awaited<ReturnType<typeof seed>>,
    recipient: { id: string }
  ) {
    const definition = seeded.fieldDefinitions.find((entry) => entry.recipientId === recipient.id);
    if (!definition) throw new Error('missing field definition');
    return actAs(seeded.envelope.id, recipient.id, () =>
      signing.completeEsigningSigningSession({
        values: [{ fieldDefinitionId: definition.id, value: 'ok' }],
      })
    );
  }

  function decline(seeded: Awaited<ReturnType<typeof seed>>, recipient: { id: string }) {
    return actAs(seeded.envelope.id, recipient.id, () =>
      signing.declineEsigningSigningSession({ reason: 'Changed my mind' })
    );
  }

  async function snapshot(envelopeId: string) {
    const envelope = await prisma.esigningEnvelope.findUniqueOrThrow({
      where: { id: envelopeId },
      include: { recipients: true },
    });
    const events = await prisma.esigningEnvelopeEvent.groupBy({
      by: ['action'],
      where: { envelopeId },
      _count: { _all: true },
    });
    const eventCounts = Object.fromEntries(events.map((entry) => [entry.action, entry._count._all]));
    return { envelope, eventCounts };
  }

  it(`completes the envelope exactly once when the last two signers finish together (${ROUNDS} rounds)`, async () => {
    const failures: string[] = [];

    for (let round = 0; round < ROUNDS; round += 1) {
      const seeded = await seed({
        recipients: [
          { name: 'a', status: 'VIEWED' },
          { name: 'b', status: 'VIEWED' },
        ],
      });
      const results = await Promise.allSettled(
        seeded.recipients.map((recipient) => complete(seeded, recipient))
      );
      const { envelope, eventCounts } = await snapshot(seeded.envelope.id);
      const signed = envelope.recipients.filter((recipient) => recipient.status === 'SIGNED').length;
      const rejected = results.filter((result) => result.status === 'rejected');

      const problems: string[] = [];
      if (envelope.status !== 'COMPLETED') problems.push(`status=${envelope.status}`);
      if (signed !== 2) problems.push(`signed=${signed}/2`);
      if (!envelope.completedAt) problems.push('completedAt missing');
      if (envelope.pdfGenerationStatus !== 'PENDING' && envelope.pdfGenerationStatus !== 'COMPLETED') {
        problems.push(`pdfGenerationStatus=${envelope.pdfGenerationStatus}`);
      }
      if ((eventCounts.COMPLETED ?? 0) !== 1) problems.push(`COMPLETED events=${eventCounts.COMPLETED ?? 0}`);
      if ((eventCounts.SIGNED ?? 0) !== 2) problems.push(`SIGNED events=${eventCounts.SIGNED ?? 0}`);
      if (rejected.length > 0) {
        problems.push(`rejected=${JSON.stringify(rejected.map((r) => (r as PromiseRejectedResult).reason?.message))}`);
      }
      if (problems.length > 0) failures.push(`round ${round}: ${problems.join(', ')}`);
    }

    expect(failures).toEqual([]);
  }, 180_000);

  it(`never lets a decline and a completion by the same signer both win (${ROUNDS} rounds)`, async () => {
    const failures: string[] = [];
    let completedRounds = 0;
    let declinedRounds = 0;

    for (let round = 0; round < ROUNDS; round += 1) {
      const seeded = await seed({
        envelopeStatus: 'IN_PROGRESS',
        recipients: [
          { name: 'signed', status: 'SIGNED' },
          { name: 'last', status: 'VIEWED' },
        ],
      });
      const last = seeded.recipients[1];
      const delay = STAGGER_MS[Math.floor(round / 2) % STAGGER_MS.length];
      const results = await Promise.allSettled([
        sleep(round % 2 === 0 ? 0 : delay).then(() => complete(seeded, last)),
        sleep(round % 2 === 0 ? delay : 0).then(() => decline(seeded, last)),
      ]);
      const { envelope, eventCounts } = await snapshot(seeded.envelope.id);
      const lastRecipient = envelope.recipients.find((recipient) => recipient.id === last.id)!;
      const fulfilled = results.filter((result) => result.status === 'fulfilled').length;

      const problems: string[] = [];
      if (fulfilled !== 1) {
        problems.push(
          `fulfilled=${fulfilled} rejections=${JSON.stringify(
            results.map((result) => (result.status === 'rejected' ? String(result.reason?.message).slice(0, 160) : 'ok'))
          )}`
        );
      }
      if (envelope.status === 'COMPLETED') {
        completedRounds += 1;
        if (lastRecipient.status !== 'SIGNED') problems.push(`COMPLETED but recipient=${lastRecipient.status}`);
        if ((eventCounts.DECLINED ?? 0) !== 0) problems.push('COMPLETED with a DECLINED event');
        if ((eventCounts.COMPLETED ?? 0) !== 1) problems.push(`COMPLETED events=${eventCounts.COMPLETED ?? 0}`);
      } else if (envelope.status === 'DECLINED') {
        declinedRounds += 1;
        if (lastRecipient.status !== 'DECLINED') problems.push(`DECLINED but recipient=${lastRecipient.status}`);
        if ((eventCounts.COMPLETED ?? 0) !== 0) problems.push('DECLINED with a COMPLETED event');
        if (envelope.completedAt) problems.push('DECLINED with completedAt set');
      } else {
        problems.push(`unexpected status=${envelope.status}`);
      }
      if (problems.length > 0) failures.push(`round ${round}: ${problems.join(', ')}`);
    }

    expect(failures).toEqual([]);
    console.info(`complete-vs-decline: completed=${completedRounds} declined=${declinedRounds}`);
  }, 180_000);

  it(`never lets a void and a completion both win (${ROUNDS} rounds)`, async () => {
    const failures: string[] = [];
    let completedRounds = 0;
    let voidedRounds = 0;

    for (let round = 0; round < ROUNDS; round += 1) {
      const seeded = await seed({
        envelopeStatus: 'IN_PROGRESS',
        recipients: [
          { name: 'signed', status: 'SIGNED' },
          { name: 'last', status: 'VIEWED' },
        ],
      });
      const last = seeded.recipients[1];
      const delay = STAGGER_MS[Math.floor(round / 2) % STAGGER_MS.length];
      const results = await Promise.allSettled([
        sleep(round % 2 === 0 ? 0 : delay).then(() => complete(seeded, last)),
        sleep(round % 2 === 0 ? delay : 0).then(() =>
          envelopeService.voidEsigningEnvelope(
            { id: seeded.userId, tenantId: seeded.tenantId } as never,
            seeded.tenantId,
            seeded.envelope.id,
            'Wrong version'
          )
        ),
      ]);
      const { envelope, eventCounts } = await snapshot(seeded.envelope.id);
      const fulfilled = results.filter((result) => result.status === 'fulfilled').length;

      const problems: string[] = [];
      if (fulfilled !== 1) {
        problems.push(
          `fulfilled=${fulfilled} rejections=${JSON.stringify(
            results.map((result) => (result.status === 'rejected' ? String(result.reason?.message).slice(0, 160) : 'ok'))
          )}`
        );
      }
      if (envelope.status === 'COMPLETED') {
        completedRounds += 1;
        if (envelope.voidedAt) problems.push('COMPLETED with voidedAt set');
        if ((eventCounts.VOIDED ?? 0) !== 0) problems.push('COMPLETED with a VOIDED event');
        if ((eventCounts.COMPLETED ?? 0) !== 1) problems.push(`COMPLETED events=${eventCounts.COMPLETED ?? 0}`);
      } else if (envelope.status === 'VOIDED') {
        voidedRounds += 1;
        if (envelope.completedAt) problems.push('VOIDED with completedAt set');
        if ((eventCounts.COMPLETED ?? 0) !== 0) problems.push('VOIDED with a COMPLETED event');
        if ((eventCounts.VOIDED ?? 0) !== 1) problems.push(`VOIDED events=${eventCounts.VOIDED ?? 0}`);
      } else {
        problems.push(`unexpected status=${envelope.status}`);
      }
      if (problems.length > 0) failures.push(`round ${round}: ${problems.join(', ')}`);
    }

    expect(failures).toEqual([]);
    console.info(`complete-vs-void: completed=${completedRounds} voided=${voidedRounds}`);
  }, 180_000);

  it('rejects a decline after completion, and a completion or decline after void', async () => {
    const completed = await seed({
      envelopeStatus: 'IN_PROGRESS',
      recipients: [
        { name: 'signed', status: 'SIGNED' },
        { name: 'last', status: 'VIEWED' },
      ],
    });
    await complete(completed, completed.recipients[1]);
    await expect(decline(completed, completed.recipients[1])).rejects.toThrow(/completed signer|completed/i);
    expect((await snapshot(completed.envelope.id)).envelope.status).toBe('COMPLETED');

    const voided = await seed({
      envelopeStatus: 'IN_PROGRESS',
      recipients: [
        { name: 'signed', status: 'SIGNED' },
        { name: 'last', status: 'VIEWED' },
      ],
    });
    await prisma.esigningEnvelope.update({
      where: { id: voided.envelope.id },
      data: { status: 'VOIDED', voidedAt: new Date() },
    });
    await expect(complete(voided, voided.recipients[1])).rejects.toThrow(/voided/i);
    await expect(decline(voided, voided.recipients[1])).rejects.toThrow(/voided/i);
    expect((await snapshot(voided.envelope.id)).envelope.status).toBe('VOIDED');
  });

  describe('stuck envelope sweeper', () => {
    it('completes IN_PROGRESS envelopes whose signers are all SIGNED, once, and leaves others alone', async () => {
      const stuck = await seed({
        envelopeStatus: 'IN_PROGRESS',
        recipients: [
          { name: 'a', status: 'SIGNED' },
          { name: 'b', status: 'SIGNED' },
        ],
      });
      const unfinished = await seed({
        envelopeStatus: 'IN_PROGRESS',
        recipients: [
          { name: 'a', status: 'SIGNED' },
          { name: 'b', status: 'VIEWED' },
        ],
      });
      const voided = await seed({
        recipients: [
          { name: 'a', status: 'SIGNED' },
          { name: 'b', status: 'SIGNED' },
        ],
      });
      await prisma.esigningEnvelope.update({
        where: { id: voided.envelope.id },
        data: { status: 'VOIDED', voidedAt: new Date() },
      });

      const first = await signing.sweepStuckEsigningEnvelopes({ limit: 1000 });
      expect(first.failed).toBe(0);
      expect(first.completed).toBeGreaterThanOrEqual(1);

      const afterFirst = await snapshot(stuck.envelope.id);
      expect(afterFirst.envelope.status).toBe('COMPLETED');
      expect(afterFirst.envelope.pdfGenerationStatus).toBe('PENDING');
      expect(afterFirst.eventCounts.COMPLETED).toBe(1);
      const latestSignedAt = Math.max(
        ...afterFirst.envelope.recipients.map((recipient) => recipient.signedAt!.getTime())
      );
      expect(afterFirst.envelope.completedAt!.getTime()).toBe(latestSignedAt);

      expect((await snapshot(unfinished.envelope.id)).envelope.status).toBe('IN_PROGRESS');
      expect((await snapshot(voided.envelope.id)).envelope.status).toBe('VOIDED');

      // A second sweep must not complete (or emit events for) the same envelope again.
      await signing.sweepStuckEsigningEnvelopes({ limit: 1000 });
      expect((await snapshot(stuck.envelope.id)).eventCounts.COMPLETED).toBe(1);
    });

    it('is safe to run concurrently with itself', async () => {
      const stuck = await seed({
        envelopeStatus: 'IN_PROGRESS',
        recipients: [
          { name: 'a', status: 'SIGNED' },
          { name: 'b', status: 'SIGNED' },
        ],
      });
      await Promise.all([
        signing.sweepStuckEsigningEnvelopes({ limit: 1000 }),
        signing.sweepStuckEsigningEnvelopes({ limit: 1000 }),
      ]);
      const { envelope, eventCounts } = await snapshot(stuck.envelope.id);
      expect(envelope.status).toBe('COMPLETED');
      expect(eventCounts.COMPLETED).toBe(1);
    });
  });
});
