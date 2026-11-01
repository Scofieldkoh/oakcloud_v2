// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * OAK-007: e-signing access follows company scope.
 *
 * Real route handlers, real services and real rbac against oakcloud_test. Only the session
 * (`requireAuth`), object storage and outgoing email are replaced. Every envelope-scoped
 * handler is called as every actor against envelopes in company A, in company B and with no
 * company. A denied request must return exactly 403 and leave the database row untouched; an
 * allowed one must never return 403 (and 2xx for the handlers whose fixtures allow it).
 */

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('E-signing company access PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

const current = vi.hoisted(() => ({ session: null as unknown }));
const memory = vi.hoisted(() => ({ files: new Map<string, Buffer>() }));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  requireAuth: vi.fn(async () => current.session),
}));

vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return {
    ...actual,
    storage: {
      upload: async (key: string, data: Buffer) => {
        memory.files.set(key, Buffer.from(data));
        return { key, size: data.byteLength };
      },
      download: async (key: string) => {
        const data = memory.files.get(key);
        if (!data) throw new Error(`missing object ${key}`);
        return Buffer.from(data);
      },
      delete: async (key: string) => {
        memory.files.delete(key);
      },
      deletePrefix: async (prefix: string) => {
        for (const key of [...memory.files.keys()]) {
          if (key.startsWith(prefix)) memory.files.delete(key);
        }
      },
      exists: async (key: string) => memory.files.has(key),
      copy: async (from: string, to: string) => {
        const data = memory.files.get(from);
        if (!data) throw new Error(`missing object ${from}`);
        memory.files.set(to, Buffer.from(data));
      },
      getSignedUrl: async (key: string) => `https://storage.test/${key}`,
    },
  };
});

vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendEmail: vi.fn(async () => ({ success: true, messageId: 'test' })),
}));

const describePostgres = testDatabaseUrl ? describe : describe.skip;

type Prisma = Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
type State = 'DRAFT' | 'SENT' | 'COMPLETED';
type Kind = 'A' | 'B' | 'N' | 'N2';
type Ability = 'read' | 'update' | 'delete' | 'create';
type ActorName = 'aOnly' | 'aCreator' | 'bOnly' | 'tenantWide' | 'admin' | 'aReadOnly' | 'mixed';

interface Fixture {
  envelopeId: string;
  documentId: string;
  recipientId: string;
}

const ALL_ABILITIES: Ability[] = ['read', 'update', 'delete', 'create'];
const NONE: Ability[] = [];

/**
 * What each actor may do with an envelope of each kind (the result table of the OAK-007 policy).
 * N is a no-company envelope made by somebody else; N2 is a no-company envelope made by aCreator.
 */
const POLICY: Record<ActorName, Record<Kind, Ability[]>> = {
  aOnly: { A: ALL_ABILITIES, B: NONE, N: NONE, N2: NONE },
  aCreator: { A: ALL_ABILITIES, B: NONE, N: NONE, N2: ALL_ABILITIES },
  bOnly: { A: NONE, B: ALL_ABILITIES, N: NONE, N2: NONE },
  tenantWide: { A: ALL_ABILITIES, B: ALL_ABILITIES, N: ALL_ABILITIES, N2: ALL_ABILITIES },
  admin: { A: ALL_ABILITIES, B: ALL_ABILITIES, N: ALL_ABILITIES, N2: ALL_ABILITIES },
  aReadOnly: { A: ['read'], B: NONE, N: NONE, N2: NONE },
  // Tenant-wide read plus a full company-A role: A is editable (override), everything else read-only.
  mixed: { A: ALL_ABILITIES, B: ['read'], N: ['read', 'create'], N2: ['read', 'create'] },
};

/** Envelopes each actor sees in the list, out of the 12 shared fixtures (A, B, N, N2 per state). */
const LIST_KINDS: Record<ActorName, Kind[]> = {
  aOnly: ['A'],
  aCreator: ['A', 'N2'],
  bOnly: ['B'],
  tenantWide: ['A', 'B', 'N', 'N2'],
  admin: ['A', 'B', 'N', 'N2'],
  aReadOnly: ['A'],
  mixed: ['A', 'B', 'N', 'N2'],
};

const ACTORS = Object.keys(POLICY) as ActorName[];
const KINDS: Kind[] = ['A', 'B', 'N', 'N2'];
const STATES: State[] = ['DRAFT', 'SENT', 'COMPLETED'];

interface HandlerSpec {
  name: string;
  /** Abilities the actor needs on the envelope. */
  needs: Ability[];
  state: State;
  /** Allowed requests must answer 2xx (the fixture state lets the operation succeed). */
  expectOk: boolean;
  call: (ctx: Ctx, fx: Fixture) => Promise<Response>;
}

interface Ctx {
  tenantId: string;
  routes: Routes;
  documentPdf: Buffer;
}

interface Routes {
  envelopes: typeof import('@/app/api/esigning/envelopes/route');
  detail: typeof import('@/app/api/esigning/envelopes/[id]/route');
  send: typeof import('@/app/api/esigning/envelopes/[id]/send/route');
  voidRoute: typeof import('@/app/api/esigning/envelopes/[id]/void/route');
  download: typeof import('@/app/api/esigning/envelopes/[id]/download/route');
  duplicate: typeof import('@/app/api/esigning/envelopes/[id]/duplicate/route');
  events: typeof import('@/app/api/esigning/envelopes/[id]/events/route');
  fields: typeof import('@/app/api/esigning/envelopes/[id]/fields/route');
  resend: typeof import('@/app/api/esigning/envelopes/[id]/resend/route');
  resendRecipient: typeof import('@/app/api/esigning/envelopes/[id]/resend/[recipientId]/route');
  retry: typeof import('@/app/api/esigning/envelopes/[id]/retry-processing/route');
  manualLink: typeof import('@/app/api/esigning/envelopes/[id]/manual-link/[recipientId]/route');
  documents: typeof import('@/app/api/esigning/envelopes/[id]/documents/route');
  document: typeof import('@/app/api/esigning/envelopes/[id]/documents/[docId]/route');
  documentPdf: typeof import('@/app/api/esigning/envelopes/[id]/documents/[docId]/pdf/route');
  documentSignedPdf: typeof import('@/app/api/esigning/envelopes/[id]/documents/[docId]/signed-pdf/route');
  recipients: typeof import('@/app/api/esigning/envelopes/[id]/recipients/route');
  recipient: typeof import('@/app/api/esigning/envelopes/[id]/recipients/[recipientId]/route');
  reorder: typeof import('@/app/api/esigning/envelopes/[id]/recipients/reorder/route');
  fromDocuments: typeof import('@/app/api/esigning/envelopes/from-documents/route');
}

function url(ctx: Ctx, path: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `http://localhost/api/esigning${path}${separator}tenantId=${ctx.tenantId}`;
}

function json(ctx: Ctx, path: string, method: string, body?: Record<string, unknown>): NextRequest {
  return new NextRequest(url(ctx, path), {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantId: ctx.tenantId, ...body }),
  });
}

function plain(ctx: Ctx, path: string, method = 'GET'): NextRequest {
  return new NextRequest(url(ctx, path), { method });
}

const HANDLERS: HandlerSpec[] = [
  {
    name: 'GET /envelopes/[id] (read)',
    needs: ['read'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) => c.routes.detail.GET(plain(c, `/envelopes/${f.envelopeId}`), { params: Promise.resolve({ id: f.envelopeId }) }),
  },
  {
    name: 'PATCH /envelopes/[id] (update title)',
    needs: ['read', 'update'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) =>
      c.routes.detail.PATCH(json(c, `/envelopes/${f.envelopeId}`, 'PATCH', { title: 'Renamed' }), {
        params: Promise.resolve({ id: f.envelopeId }),
      }),
  },
  {
    name: 'DELETE /envelopes/[id]',
    needs: ['delete'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) => c.routes.detail.DELETE(plain(c, `/envelopes/${f.envelopeId}`, 'DELETE'), { params: Promise.resolve({ id: f.envelopeId }) }),
  },
  {
    name: 'POST /envelopes/[id]/send',
    needs: ['read', 'update'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) => c.routes.send.POST(json(c, `/envelopes/${f.envelopeId}/send`, 'POST'), { params: Promise.resolve({ id: f.envelopeId }) }),
  },
  {
    name: 'POST /envelopes/[id]/void',
    needs: ['read', 'update'],
    state: 'SENT',
    expectOk: true,
    call: (c, f) =>
      c.routes.voidRoute.POST(json(c, `/envelopes/${f.envelopeId}/void`, 'POST', { reason: 'Wrong version' }), {
        params: Promise.resolve({ id: f.envelopeId }),
      }),
  },
  {
    name: 'GET /envelopes/[id]/download',
    needs: ['read'],
    state: 'COMPLETED',
    expectOk: false,
    call: (c, f) => c.routes.download.GET(plain(c, `/envelopes/${f.envelopeId}/download`), { params: Promise.resolve({ id: f.envelopeId }) }),
  },
  {
    name: 'POST /envelopes/[id]/duplicate',
    needs: ['read', 'create'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) => c.routes.duplicate.POST(json(c, `/envelopes/${f.envelopeId}/duplicate`, 'POST'), { params: Promise.resolve({ id: f.envelopeId }) }),
  },
  {
    name: 'GET /envelopes/[id]/events (read)',
    needs: ['read'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) => c.routes.events.GET(plain(c, `/envelopes/${f.envelopeId}/events`), { params: Promise.resolve({ id: f.envelopeId }) }),
  },
  {
    name: 'PUT /envelopes/[id]/fields',
    needs: ['read', 'update'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) =>
      c.routes.fields.PUT(
        json(c, `/envelopes/${f.envelopeId}/fields`, 'PUT', {
          fields: [
            {
              documentId: f.documentId,
              recipientId: f.recipientId,
              type: 'SIGNATURE',
              pageNumber: 1,
              xPercent: 0.1,
              yPercent: 0.1,
              widthPercent: 0.3,
              heightPercent: 0.06,
              sortOrder: 1,
            },
          ],
        }),
        { params: Promise.resolve({ id: f.envelopeId }) }
      ),
  },
  {
    name: 'POST /envelopes/[id]/resend',
    needs: ['read', 'update'],
    state: 'SENT',
    expectOk: true,
    call: (c, f) => c.routes.resend.POST(json(c, `/envelopes/${f.envelopeId}/resend`, 'POST'), { params: Promise.resolve({ id: f.envelopeId }) }),
  },
  {
    name: 'POST /envelopes/[id]/resend/[recipientId]',
    needs: ['read', 'update'],
    state: 'SENT',
    expectOk: true,
    call: (c, f) =>
      c.routes.resendRecipient.POST(json(c, `/envelopes/${f.envelopeId}/resend/${f.recipientId}`, 'POST'), {
        params: Promise.resolve({ id: f.envelopeId, recipientId: f.recipientId }),
      }),
  },
  {
    name: 'POST /envelopes/[id]/retry-processing',
    needs: ['read', 'update'],
    state: 'COMPLETED',
    expectOk: true,
    call: (c, f) => c.routes.retry.POST(json(c, `/envelopes/${f.envelopeId}/retry-processing`, 'POST'), { params: Promise.resolve({ id: f.envelopeId }) }),
  },
  {
    name: 'POST /envelopes/[id]/manual-link/[recipientId]',
    needs: ['read', 'update'],
    state: 'SENT',
    expectOk: true,
    call: (c, f) =>
      c.routes.manualLink.POST(json(c, `/envelopes/${f.envelopeId}/manual-link/${f.recipientId}`, 'POST'), {
        params: Promise.resolve({ id: f.envelopeId, recipientId: f.recipientId }),
      }),
  },
  {
    name: 'POST /envelopes/[id]/documents (upload)',
    needs: ['read', 'update'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) => {
      const form = new FormData();
      form.set('tenantId', c.tenantId);
      form.set('file', new File([new Uint8Array(c.documentPdf)], 'extra.pdf', { type: 'application/pdf' }));
      return c.routes.documents.POST(
        new NextRequest(url(c, `/envelopes/${f.envelopeId}/documents`), { method: 'POST', body: form }),
        { params: Promise.resolve({ id: f.envelopeId }) }
      );
    },
  },
  {
    name: 'PATCH /envelopes/[id]/documents/[docId] (rename)',
    needs: ['read', 'update'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) =>
      c.routes.document.PATCH(json(c, `/envelopes/${f.envelopeId}/documents/${f.documentId}`, 'PATCH', { fileName: 'renamed.pdf' }), {
        params: Promise.resolve({ id: f.envelopeId, docId: f.documentId }),
      }),
  },
  {
    name: 'DELETE /envelopes/[id]/documents/[docId]',
    needs: ['read', 'update'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) =>
      c.routes.document.DELETE(plain(c, `/envelopes/${f.envelopeId}/documents/${f.documentId}`, 'DELETE'), {
        params: Promise.resolve({ id: f.envelopeId, docId: f.documentId }),
      }),
  },
  {
    name: 'GET /envelopes/[id]/documents/[docId]/pdf',
    needs: ['read'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) =>
      c.routes.documentPdf.GET(plain(c, `/envelopes/${f.envelopeId}/documents/${f.documentId}/pdf`), {
        params: Promise.resolve({ id: f.envelopeId, docId: f.documentId }),
      }),
  },
  {
    name: 'GET /envelopes/[id]/documents/[docId]/signed-pdf',
    needs: ['read'],
    state: 'COMPLETED',
    expectOk: false,
    call: (c, f) =>
      c.routes.documentSignedPdf.GET(plain(c, `/envelopes/${f.envelopeId}/documents/${f.documentId}/signed-pdf`), {
        params: Promise.resolve({ id: f.envelopeId, docId: f.documentId }),
      }),
  },
  {
    name: 'POST /envelopes/[id]/recipients',
    needs: ['read', 'update'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) =>
      c.routes.recipients.POST(
        json(c, `/envelopes/${f.envelopeId}/recipients`, 'POST', {
          type: 'CC',
          name: 'Copy Person',
          email: `cc-${randomUUID()}@example.test`,
          accessMode: 'EMAIL_LINK',
        }),
        { params: Promise.resolve({ id: f.envelopeId }) }
      ),
  },
  {
    name: 'PATCH /envelopes/[id]/recipients/[recipientId]',
    needs: ['read', 'update'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) =>
      c.routes.recipient.PATCH(json(c, `/envelopes/${f.envelopeId}/recipients/${f.recipientId}`, 'PATCH', { name: 'New Name' }), {
        params: Promise.resolve({ id: f.envelopeId, recipientId: f.recipientId }),
      }),
  },
  {
    name: 'DELETE /envelopes/[id]/recipients/[recipientId]',
    needs: ['read', 'update'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) =>
      c.routes.recipient.DELETE(plain(c, `/envelopes/${f.envelopeId}/recipients/${f.recipientId}`, 'DELETE'), {
        params: Promise.resolve({ id: f.envelopeId, recipientId: f.recipientId }),
      }),
  },
  {
    name: 'POST /envelopes/[id]/recipients/reorder',
    needs: ['read', 'update'],
    state: 'DRAFT',
    expectOk: true,
    call: (c, f) =>
      c.routes.reorder.POST(json(c, `/envelopes/${f.envelopeId}/recipients/reorder`, 'POST', { recipientIds: [f.recipientId] }), {
        params: Promise.resolve({ id: f.envelopeId }),
      }),
  },
];

describePostgres('e-signing company access (real routes, rbac and database)', () => {
  let prisma: Prisma;
  let rbac: typeof import('@/lib/rbac');
  let routes: Routes;
  let ctx: Ctx;
  let tenantId: string;
  let companyA: string;
  let companyB: string;
  let documentPdf: Buffer;
  const users = {} as Record<ActorName | 'owner', string>;
  const sessions = {} as Record<ActorName | 'owner', unknown>;
  const shared = {} as Record<State, Record<Kind, Fixture>>;
  const previousLogLevel = process.env.LOG_LEVEL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.LOG_LEVEL = 'silent';
    prisma = (await import('@/lib/prisma')).getPrisma();
    rbac = await import('@/lib/rbac');
    routes = {
      envelopes: await import('@/app/api/esigning/envelopes/route'),
      detail: await import('@/app/api/esigning/envelopes/[id]/route'),
      send: await import('@/app/api/esigning/envelopes/[id]/send/route'),
      voidRoute: await import('@/app/api/esigning/envelopes/[id]/void/route'),
      download: await import('@/app/api/esigning/envelopes/[id]/download/route'),
      duplicate: await import('@/app/api/esigning/envelopes/[id]/duplicate/route'),
      events: await import('@/app/api/esigning/envelopes/[id]/events/route'),
      fields: await import('@/app/api/esigning/envelopes/[id]/fields/route'),
      resend: await import('@/app/api/esigning/envelopes/[id]/resend/route'),
      resendRecipient: await import('@/app/api/esigning/envelopes/[id]/resend/[recipientId]/route'),
      retry: await import('@/app/api/esigning/envelopes/[id]/retry-processing/route'),
      manualLink: await import('@/app/api/esigning/envelopes/[id]/manual-link/[recipientId]/route'),
      documents: await import('@/app/api/esigning/envelopes/[id]/documents/route'),
      document: await import('@/app/api/esigning/envelopes/[id]/documents/[docId]/route'),
      documentPdf: await import('@/app/api/esigning/envelopes/[id]/documents/[docId]/pdf/route'),
      documentSignedPdf: await import('@/app/api/esigning/envelopes/[id]/documents/[docId]/signed-pdf/route'),
      recipients: await import('@/app/api/esigning/envelopes/[id]/recipients/route'),
      recipient: await import('@/app/api/esigning/envelopes/[id]/recipients/[recipientId]/route'),
      reorder: await import('@/app/api/esigning/envelopes/[id]/recipients/reorder/route'),
      fromDocuments: await import('@/app/api/esigning/envelopes/from-documents/route'),
    };

    const original = await PDFDocument.create();
    original.addPage([595, 842]);
    documentPdf = Buffer.from(await original.save());

    const suffix = randomUUID();
    const workspace = await prisma.workspace.create({
      data: { name: `Company access ${suffix}`, slug: `company-access-${suffix}` },
    });
    tenantId = workspace.id;
    ctx = { tenantId, routes, documentPdf };

    companyA = (await prisma.company.create({ data: { tenantId, uen: `A${suffix.slice(0, 8)}`, name: 'Company A' } })).id;
    companyB = (await prisma.company.create({ data: { tenantId, uen: `B${suffix.slice(0, 8)}`, name: 'Company B' } })).id;

    const permissionIds: Record<string, string> = {};
    for (const [resource, action] of [
      ['esigning', 'create'],
      ['esigning', 'read'],
      ['esigning', 'update'],
      ['esigning', 'delete'],
      ['document', 'read'],
      ['document', 'update'],
    ] as const) {
      const permission = await prisma.permission.upsert({
        where: { resource_action: { resource, action } },
        create: { resource, action },
        update: {},
      });
      permissionIds[`${resource}:${action}`] = permission.id;
    }

    async function makeRole(name: string, keys: string[], systemRoleType: string | null = null) {
      const role = await prisma.role.create({ data: { tenantId, name: `${name} ${suffix}`, systemRoleType } });
      await prisma.rolePermission.createMany({
        data: keys.map((key) => ({ roleId: role.id, permissionId: permissionIds[key] })),
      });
      return role.id;
    }
    const fullRole = await makeRole('Esigning full', [
      'esigning:create', 'esigning:read', 'esigning:update', 'esigning:delete', 'document:read', 'document:update',
    ]);
    const readRole = await makeRole('Esigning read', ['esigning:read']);
    const adminRole = await makeRole('Workspace admin', [], 'TENANT_ADMIN');

    const assignments: Record<ActorName | 'owner', Array<{ roleId: string; companyId: string | null }>> = {
      owner: [],
      aOnly: [{ roleId: fullRole, companyId: companyA }],
      aCreator: [{ roleId: fullRole, companyId: companyA }],
      bOnly: [{ roleId: fullRole, companyId: companyB }],
      tenantWide: [{ roleId: fullRole, companyId: null }],
      admin: [{ roleId: adminRole, companyId: null }],
      aReadOnly: [{ roleId: readRole, companyId: companyA }],
      mixed: [{ roleId: readRole, companyId: null }, { roleId: fullRole, companyId: companyA }],
    };

    for (const name of Object.keys(assignments) as Array<ActorName | 'owner'>) {
      const user = await prisma.user.create({
        data: {
          tenantId,
          email: `${name}-${suffix}@example.test`,
          passwordHash: 'not-used',
          firstName: name,
          lastName: 'User',
        },
      });
      users[name] = user.id;
      for (const assignment of assignments[name]) {
        await prisma.userRoleAssignment.create({ data: { userId: user.id, ...assignment } });
      }
      const isAdmin = name === 'admin';
      sessions[name] = {
        id: user.id,
        email: user.email,
        firstName: name,
        lastName: 'User',
        tenantId,
        workspaceId: tenantId,
        internalRole: isAdmin ? 'ADMIN' : 'STAFF',
        isAdmin,
        isManager: false,
        isStaff: !isAdmin,
        isSuperAdmin: false,
        isWorkspaceAdmin: isAdmin,
        hasAllCompaniesAccess: isAdmin || assignments[name].some((entry) => entry.companyId === null),
        companyIds: [...new Set(assignments[name].map((entry) => entry.companyId).filter((id): id is string => Boolean(id)))],
      };
    }

    for (const state of STATES) {
      shared[state] = {} as Record<Kind, Fixture>;
      for (const kind of KINDS) {
        shared[state][kind] = await seedEnvelope(state, kind);
      }
    }
  }, 120_000);

  beforeEach(() => {
    rbac.clearAllPermissionCache();
  });

  afterAll(async () => {
    if (tenantId) {
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.generatedDocument.deleteMany({ where: { tenantId } });
      await prisma.esigningEnvelope.deleteMany({ where: { tenantId } });
      await prisma.role.deleteMany({ where: { tenantId } });
      await prisma.company.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.workspace.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
    if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previousLogLevel;
  });

  function companyOf(kind: Kind): string | null {
    return kind === 'A' ? companyA : kind === 'B' ? companyB : null;
  }

  async function seedEnvelope(state: State, kind: Kind): Promise<Fixture> {
    const id = randomUUID();
    const createdById = kind === 'N2' ? users.aCreator : users.owner;
    const envelope = await prisma.esigningEnvelope.create({
      data: {
        id,
        tenantId,
        createdById,
        title: `${state} ${kind} ${id.slice(0, 6)}`,
        status: state,
        signingOrder: 'SEQUENTIAL',
        certificateId: `OAK-ES-${id.replace(/-/g, '').slice(0, 14).toUpperCase()}`,
        companyId: companyOf(kind),
        completedAt: state === 'COMPLETED' ? new Date() : null,
        pdfGenerationStatus: state === 'COMPLETED' ? 'FAILED' : null,
      },
    });
    const recipient = await prisma.esigningEnvelopeRecipient.create({
      data: {
        tenantId,
        envelopeId: envelope.id,
        type: 'SIGNER',
        name: 'Pat Signer',
        email: `signer-${id}@example.test`,
        signingOrder: 1,
        status: state === 'DRAFT' ? 'QUEUED' : state === 'SENT' ? 'NOTIFIED' : 'SIGNED',
        accessMode: 'EMAIL_LINK',
        colorTag: '#06b6d4',
      },
    });
    const storagePath = `${tenantId}/esigning/${envelope.id}/originals/doc.pdf`;
    memory.files.set(storagePath, documentPdf);
    const document = await prisma.esigningEnvelopeDocument.create({
      data: {
        tenantId,
        envelopeId: envelope.id,
        fileName: 'agreement.pdf',
        originalFileName: 'agreement.pdf',
        storagePath,
        originalHash: 'hash',
        pageCount: 1,
        sortOrder: 1,
        fileSize: documentPdf.byteLength,
      },
    });
    await prisma.esigningDocumentFieldDefinition.create({
      data: {
        tenantId,
        envelopeId: envelope.id,
        documentId: document.id,
        recipientId: recipient.id,
        type: 'SIGNATURE',
        pageNumber: 1,
        xPercent: 0.1,
        yPercent: 0.1,
        widthPercent: 0.3,
        heightPercent: 0.06,
        sortOrder: 1,
      },
    });
    return { envelopeId: envelope.id, documentId: document.id, recipientId: recipient.id };
  }

  async function snapshot(envelopeId: string) {
    const envelope = await prisma.esigningEnvelope.findUnique({
      where: { id: envelopeId },
      select: {
        status: true,
        title: true,
        companyId: true,
        updatedAt: true,
        voidedAt: true,
        _count: { select: { documents: true, recipients: true, fieldDefinitions: true, events: true } },
      },
    });
    return JSON.stringify(envelope);
  }

  function allowed(actor: ActorName, kind: Kind, needs: Ability[]): boolean {
    return needs.every((ability) => POLICY[actor][kind].includes(ability));
  }

  async function asActor<T>(actor: ActorName, run: () => Promise<T>): Promise<T> {
    current.session = sessions[actor];
    return run();
  }

  describe.each(HANDLERS)('$name', (handler) => {
    const denied = ACTORS.flatMap((actor) =>
      KINDS.filter((kind) => !allowed(actor, kind, handler.needs)).map((kind) => [actor, kind] as const)
    );
    const permitted = ACTORS.flatMap((actor) =>
      KINDS.filter((kind) => allowed(actor, kind, handler.needs)).map((kind) => [actor, kind] as const)
    );

    it.each(denied)('returns 403 and changes nothing: %s on %s', async (actor, kind) => {
      const fx = shared[handler.state][kind];
      const before = await snapshot(fx.envelopeId);

      const response = await asActor(actor, () => handler.call(ctx, fx));

      expect(response.status).toBe(403);
      expect(await snapshot(fx.envelopeId)).toBe(before);
    });

    it.each(permitted)('is allowed: %s on %s', async (actor, kind) => {
      const fx = await seedEnvelope(handler.state, kind);

      const response = await asActor(actor, () => handler.call(ctx, fx));
      const body = await response.clone().text();

      expect(response.status, body.slice(0, 300)).not.toBe(403);
      if (handler.expectOk) {
        expect(response.status, body.slice(0, 300)).toBeGreaterThanOrEqual(200);
        expect(response.status, body.slice(0, 300)).toBeLessThan(300);
      } else {
        // State-dependent handlers may answer a state error, but never a missing envelope.
        expect(body).not.toContain('Envelope not found');
      }
    });
  });

  describe('delete leaves the row in place when denied', () => {
    it.each(
      ACTORS.flatMap((actor) =>
        KINDS.filter((kind) => !POLICY[actor][kind].includes('delete')).map((kind) => [actor, kind] as const)
      )
    )('%s cannot delete a %s envelope', async (actor, kind) => {
      const fx = shared.DRAFT[kind];
      const response = await asActor(actor, () =>
        routes.detail.DELETE(plain(ctx, `/envelopes/${fx.envelopeId}`, 'DELETE'), { params: Promise.resolve({ id: fx.envelopeId }) })
      );
      expect(response.status).toBe(403);
      expect(await prisma.esigningEnvelope.count({ where: { id: fx.envelopeId } })).toBe(1);
    });
  });

  describe('GET /envelopes (list, counts and company options)', () => {
    /**
     * What each actor may see, written as a direct database filter that does not use the
     * production helper. The tenant also holds the envelopes other tests created, so the
     * expectation is read from the database rather than from the shared fixtures.
     */
    function visibleTo(actor: ActorName): Record<string, unknown> {
      switch (actor) {
        case 'aOnly':
        case 'aReadOnly':
          return { companyId: companyA };
        case 'aCreator':
          return { OR: [{ companyId: companyA }, { companyId: null, createdById: users.aCreator }] };
        case 'bOnly':
          return { companyId: companyB };
        default:
          return {};
      }
    }

    interface ListBody {
      total: number;
      statusCounts: Record<string, number>;
      companyOptions: Array<{ id: string; count: number }>;
      envelopes: Array<{ id: string }>;
    }

    async function listAll(actor: ActorName, query = '') {
      const ids: string[] = [];
      let first: ListBody | null = null;
      for (let page = 1; page <= 50; page += 1) {
        const response = await asActor(actor, () =>
          routes.envelopes.GET(plain(ctx, `/envelopes?limit=100&page=${page}${query}`))
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as ListBody;
        first ??= body;
        ids.push(...body.envelopes.map((entry) => entry.id));
        if (body.envelopes.length < 100) break;
      }
      const { total, statusCounts, companyOptions } = first!;
      return { ids, total, statusCounts, companyOptions };
    }

    async function expectedFor(actor: ActorName, extra: Record<string, unknown> = {}) {
      const where = { tenantId, deletedAt: null, AND: [visibleTo(actor), extra] };
      const rows = await prisma.esigningEnvelope.findMany({ where, select: { id: true, status: true, companyId: true } });
      return rows;
    }

    it.each(ACTORS)('%s sees exactly the envelopes the policy allows', async (actor) => {
      const result = await listAll(actor);
      const expected = await expectedFor(actor);

      expect([...result.ids].sort()).toEqual(expected.map((row) => row.id).sort());
      expect(result.total).toBe(expected.length);
      expect(Object.values(result.statusCounts).reduce((sum, count) => sum + count, 0)).toBe(expected.length);

      const expectedCompanyCounts = new Map<string, number>();
      for (const row of expected) {
        if (row.companyId) expectedCompanyCounts.set(row.companyId, (expectedCompanyCounts.get(row.companyId) ?? 0) + 1);
      }
      expect(Object.fromEntries(result.companyOptions.map((option) => [option.id, option.count]))).toEqual(
        Object.fromEntries(expectedCompanyCounts)
      );
    });

    it.each(ACTORS)('%s: the fixed fixtures appear exactly where the policy says', async (actor) => {
      const result = await listAll(actor);
      const seen = new Set(result.ids);
      for (const state of STATES) {
        for (const kind of KINDS) {
          const visible = LIST_KINDS[actor].includes(kind);
          expect(seen.has(shared[state][kind].envelopeId), `${actor} ${state} ${kind}`).toBe(visible);
        }
      }
    });

    it.each(ACTORS)('%s search never widens the scope', async (actor) => {
      const result = await listAll(actor, '&query=SENT');
      const expected = await expectedFor(actor, { title: { contains: 'SENT', mode: 'insensitive' } });

      expect([...result.ids].sort()).toEqual(expected.map((row) => row.id).sort());
      expect(result.total).toBe(expected.length);
      expect(Object.values(result.statusCounts).reduce((sum, count) => sum + count, 0)).toBe(expected.length);
    });

    it.each(ACTORS)('%s with createdBy=me narrows the scope instead of replacing it', async (actor) => {
      const result = await listAll(actor, '&createdBy=me');
      const expected = await expectedFor(actor, { createdById: users[actor] });

      expect([...result.ids].sort()).toEqual(expected.map((row) => row.id).sort());
      expect(result.total).toBe(expected.length);
    });

    it('a company filter for another company returns nothing', async () => {
      const result = await listAll('aOnly', `&companyId=${companyB}`);
      expect(result.total).toBe(0);
      expect(result.ids).toEqual([]);
    });
  });

  describe('POST /envelopes (create)', () => {
    async function create(actor: ActorName, companyId: string | null) {
      const title = `Created ${randomUUID()}`;
      const response = await asActor(actor, () =>
        routes.envelopes.POST(json(ctx, '/envelopes', 'POST', { title, ...(companyId ? { companyId } : {}) }))
      );
      const count = await prisma.esigningEnvelope.count({ where: { tenantId, title } });
      return { response, count };
    }

    it.each([
      ['aOnly', 'A', 201],
      ['aOnly', 'B', 403],
      ['aOnly', 'none', 201],
      ['bOnly', 'A', 403],
      ['bOnly', 'B', 201],
      ['tenantWide', 'A', 201],
      ['tenantWide', 'B', 201],
      ['tenantWide', 'none', 201],
      ['admin', 'B', 201],
      ['aReadOnly', 'A', 403],
      ['mixed', 'A', 201],
      ['mixed', 'B', 403],
    ] as const)('%s creating in %s -> %s', async (actor, where, status) => {
      const companyId = where === 'A' ? companyA : where === 'B' ? companyB : null;
      const { response, count } = await create(actor, companyId);
      expect(response.status).toBe(status);
      expect(count).toBe(status === 201 ? 1 : 0);
    });
  });

  describe('POST /envelopes/from-documents (create)', () => {
    async function seedGeneratedDocument(companyId: string) {
      return prisma.generatedDocument.create({
        data: {
          tenantId,
          companyId,
          title: `Draft ${randomUUID().slice(0, 6)}`,
          content: '<p>Hello</p>',
          status: 'DRAFT',
          createdById: users.owner,
        },
      });
    }

    it('refuses documents of another company before finalizing anything', async () => {
      const documentInB = await seedGeneratedDocument(companyB);
      const envelopesBefore = await prisma.esigningEnvelope.count({ where: { tenantId } });

      const response = await asActor('aOnly', () =>
        routes.fromDocuments.POST(
          json(ctx, '/envelopes/from-documents', 'POST', { generatedDocumentIds: [documentInB.id], finalizeDrafts: true })
        )
      );

      expect(response.status).toBe(403);
      expect(await prisma.esigningEnvelope.count({ where: { tenantId } })).toBe(envelopesBefore);
      const after = await prisma.generatedDocument.findUniqueOrThrow({ where: { id: documentInB.id } });
      expect(after.status).toBe('DRAFT');
      expect(after.finalizedAt).toBeNull();
    });
  });

  describe('PATCH /envelopes/[id] moving a draft between companies', () => {
    async function move(actor: ActorName, from: Kind, companyId: string | null) {
      const fx = await seedEnvelope('DRAFT', from);
      const response = await asActor(actor, () =>
        routes.detail.PATCH(json(ctx, `/envelopes/${fx.envelopeId}`, 'PATCH', { companyId }), {
          params: Promise.resolve({ id: fx.envelopeId }),
        })
      );
      const row = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: fx.envelopeId } });
      return { response, row };
    }

    it('refuses a move into a company the actor cannot update', async () => {
      const { response, row } = await move('aOnly', 'A', companyB);
      expect(response.status).toBe(403);
      expect(row.companyId).toBe(companyA);
    });

    it('refuses a move into a company where the actor only has read access', async () => {
      const { response, row } = await move('mixed', 'A', companyB);
      expect(response.status).toBe(403);
      expect(row.companyId).toBe(companyA);
    });

    it('allows a move between two companies the actor can update', async () => {
      const { response, row } = await move('tenantWide', 'A', companyB);
      expect(response.status).toBe(200);
      expect(row.companyId).toBe(companyB);
    });
  });

  describe('a company-A-only creator of a no-company draft', () => {
    it('keeps read, update and delete on it, and cannot reach the same envelope from company B', async () => {
      const fx = shared.DRAFT.N2;
      const read = await asActor('aCreator', () =>
        routes.detail.GET(plain(ctx, `/envelopes/${fx.envelopeId}`), { params: Promise.resolve({ id: fx.envelopeId }) })
      );
      expect(read.status).toBe(200);

      const otherCompanyUser = await asActor('bOnly', () =>
        routes.detail.GET(plain(ctx, `/envelopes/${fx.envelopeId}`), { params: Promise.resolve({ id: fx.envelopeId }) })
      );
      expect(otherCompanyUser.status).toBe(403);
    });

    it('loses access to their own envelope once their company access is revoked', async () => {
      const fx = await seedEnvelope('DRAFT', 'A');
      await prisma.esigningEnvelope.update({ where: { id: fx.envelopeId }, data: { createdById: users.bOnly } });

      // bOnly created an envelope in company A but only holds company B: access is gone.
      const response = await asActor('bOnly', () =>
        routes.detail.GET(plain(ctx, `/envelopes/${fx.envelopeId}`), { params: Promise.resolve({ id: fx.envelopeId }) })
      );
      expect(response.status).toBe(403);
    });
  });
});
