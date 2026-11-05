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
const memory = vi.hoisted(() => ({ files: new Map<string, Buffer>(), pdf: null as Buffer | null }));

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

// Rendering a generated document needs Chromium; hand back a real one-page PDF instead.
vi.mock('@/services/document-export.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/document-export.service')>()),
  exportToPDF: vi.fn(async () => ({ buffer: Buffer.from(memory.pdf!), filename: 'Generated.pdf' })),
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
const READ_AND_CREATE: Ability[] = ['read', 'create'];

/**
 * What each actor may do with an envelope of each kind (the result table of the OAK-007 policy).
 * N is a no-company envelope made by somebody else; N2 is a no-company envelope made by aCreator.
 *
 * A no-company envelope is readable by every e-signing user of the tenant (decided by the owner).
 * Changing, sending and deleting it still needs a tenant-wide grant or being its creator. 'create'
 * on it means duplicating it, which any actor who may create a no-company envelope can do.
 */
const POLICY: Record<ActorName, Record<Kind, Ability[]>> = {
  aOnly: { A: ALL_ABILITIES, B: NONE, N: READ_AND_CREATE, N2: READ_AND_CREATE },
  aCreator: { A: ALL_ABILITIES, B: NONE, N: READ_AND_CREATE, N2: ALL_ABILITIES },
  bOnly: { A: NONE, B: ALL_ABILITIES, N: READ_AND_CREATE, N2: READ_AND_CREATE },
  tenantWide: { A: ALL_ABILITIES, B: ALL_ABILITIES, N: ALL_ABILITIES, N2: ALL_ABILITIES },
  admin: { A: ALL_ABILITIES, B: ALL_ABILITIES, N: ALL_ABILITIES, N2: ALL_ABILITIES },
  aReadOnly: { A: ['read'], B: NONE, N: ['read'], N2: ['read'] },
  // Tenant-wide read plus a full company-A role: A is editable (override), everything else read-only.
  mixed: { A: ALL_ABILITIES, B: ['read'], N: ['read', 'create'], N2: ['read', 'create'] },
};

/** Envelopes each actor sees in the list, out of the 12 shared fixtures (A, B, N, N2 per state). */
const LIST_KINDS: Record<ActorName, Kind[]> = {
  aOnly: ['A', 'N', 'N2'],
  aCreator: ['A', 'N', 'N2'],
  bOnly: ['B', 'N', 'N2'],
  tenantWide: ['A', 'B', 'N', 'N2'],
  admin: ['A', 'B', 'N', 'N2'],
  aReadOnly: ['A', 'N', 'N2'],
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
    memory.pdf = documentPdf;

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

  async function seedEnvelope(
    state: State,
    kind: Kind,
    options: { createdBy?: ActorName | 'owner' } = {}
  ): Promise<Fixture> {
    const id = randomUUID();
    const createdById = users[options.createdBy ?? (kind === 'N2' ? 'aCreator' : 'owner')];
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
        metadata: true,
        pdfGenerationStatus: true,
        autoFilingStatus: true,
        documents: { orderBy: { id: 'asc' }, select: { id: true, originalFileName: true, sortOrder: true } },
        recipients: {
          orderBy: { id: 'asc' },
          select: { id: true, name: true, email: true, status: true, signingOrder: true, sessionVersion: true },
        },
        // Saving fields replaces the rows, so their ids change when a write got through.
        fieldDefinitions: { orderBy: { id: 'asc' }, select: { id: true } },
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
        // State-dependent handlers may answer a state error, but never a missing envelope or
        // document: a permitted actor must not be told the envelope does not exist.
        expect(response.status, body.slice(0, 300)).not.toBe(404);
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
        case 'aCreator':
          // Their company, plus every envelope with no company.
          return { OR: [{ companyId: companyA }, { companyId: null }] };
        case 'bOnly':
          return { OR: [{ companyId: companyB }, { companyId: null }] };
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

  /**
   * Who may create an envelope (or one from generated documents) in company A, in company B,
   * or with no company. With no company, `create` from any assignment is enough.
   */
  const CREATE_POLICY: Record<ActorName, Record<'A' | 'B' | 'none', boolean>> = {
    aOnly: { A: true, B: false, none: true },
    aCreator: { A: true, B: false, none: true },
    bOnly: { A: false, B: true, none: true },
    tenantWide: { A: true, B: true, none: true },
    admin: { A: true, B: true, none: true },
    aReadOnly: { A: false, B: false, none: false },
    // Tenant-wide read only, plus a full role in A: B falls back to read-only.
    mixed: { A: true, B: false, none: true },
  };
  const CREATE_CASES = ACTORS.flatMap((actor) =>
    (['A', 'B', 'none'] as const).map((where) => [actor, where, CREATE_POLICY[actor][where]] as const)
  );

  function companyFor(where: 'A' | 'B' | 'none'): string | null {
    return where === 'A' ? companyA : where === 'B' ? companyB : null;
  }

  describe('POST /envelopes (create)', () => {
    async function create(actor: ActorName, companyId: string | null) {
      const title = `Created ${randomUUID()}`;
      const response = await asActor(actor, () =>
        routes.envelopes.POST(json(ctx, '/envelopes', 'POST', { title, ...(companyId ? { companyId } : {}) }))
      );
      const count = await prisma.esigningEnvelope.count({ where: { tenantId, title } });
      return { response, count };
    }

    it.each(CREATE_CASES)('%s creating in %s -> allowed: %s', async (actor, where, allowedToCreate) => {
      const { response, count } = await create(actor, companyFor(where));
      expect(response.status).toBe(allowedToCreate ? 201 : 403);
      expect(count).toBe(allowedToCreate ? 1 : 0);
    });
  });

  describe('POST /envelopes/from-documents (create)', () => {
    async function seedGeneratedDocument(where: 'A' | 'B' | 'none', status: 'DRAFT' | 'FINALIZED' = 'FINALIZED') {
      return prisma.generatedDocument.create({
        data: {
          tenantId,
          companyId: companyFor(where),
          title: `Generated ${randomUUID().slice(0, 8)}`,
          content: '<p>Hello</p>',
          status,
          revision: 1,
          ...(status === 'FINALIZED' ? { finalizedAt: new Date(), finalizedById: users.owner } : {}),
          createdById: users.owner,
        },
      });
    }

    function fromDocuments(actor: ActorName, documentId: string, finalizeDrafts = false) {
      return asActor(actor, () =>
        routes.fromDocuments.POST(
          json(ctx, '/envelopes/from-documents', 'POST', { generatedDocumentIds: [documentId], finalizeDrafts })
        )
      );
    }

    it.each(CREATE_CASES)('%s with a document of %s -> allowed: %s', async (actor, where, allowedToCreate) => {
      const document = await seedGeneratedDocument(where);
      const envelopesBefore = await prisma.esigningEnvelope.count({ where: { tenantId } });

      const response = await fromDocuments(actor, document.id);
      const body = await response.clone().text();

      if (!allowedToCreate) {
        expect(response.status, body.slice(0, 300)).toBe(403);
        expect(await prisma.esigningEnvelope.count({ where: { tenantId } })).toBe(envelopesBefore);
        expect(await prisma.esigningEnvelopeDocument.count({ where: { generatedDocumentId: document.id } })).toBe(0);
        return;
      }

      expect(response.status, body.slice(0, 300)).toBe(201);
      const { id } = JSON.parse(body) as { id: string };
      const envelope = await prisma.esigningEnvelope.findUniqueOrThrow({
        where: { id },
        include: { documents: true },
      });
      expect(envelope.companyId).toBe(companyFor(where));
      expect(envelope.createdById).toBe(users[actor]);
      expect(envelope.documents.map((entry) => entry.generatedDocumentId)).toEqual([document.id]);
    });

    it('refuses draft documents of another company before finalizing anything', async () => {
      const documentInB = await seedGeneratedDocument('B', 'DRAFT');
      const envelopesBefore = await prisma.esigningEnvelope.count({ where: { tenantId } });

      const response = await fromDocuments('aOnly', documentInB.id, true);

      expect(response.status).toBe(403);
      expect(await prisma.esigningEnvelope.count({ where: { tenantId } })).toBe(envelopesBefore);
      const after = await prisma.generatedDocument.findUniqueOrThrow({ where: { id: documentInB.id } });
      expect(after.status).toBe('DRAFT');
      expect(after.finalizedAt).toBeNull();
    });
  });

  describe('attaching generated documents to an envelope (JSON)', () => {
    type DocWhere = 'A' | 'B' | 'none';
    const DOC_WHERES: DocWhere[] = ['A', 'B', 'none'];
    const kindForCompany: Record<'A' | 'B', Kind> = { A: 'A', B: 'B' };

    async function seedDocument(where: DocWhere) {
      return prisma.generatedDocument.create({
        data: {
          tenantId,
          companyId: companyFor(where),
          title: `Attach ${randomUUID().slice(0, 8)}`,
          content: '<p>Hello</p>',
          status: 'FINALIZED',
          revision: 1,
          finalizedAt: new Date(),
          finalizedById: users.owner,
          createdById: users.owner,
        },
      });
    }

    function attach(actor: ActorName, envelopeId: string, documentId: string) {
      return asActor(actor, () =>
        routes.documents.POST(
          json(ctx, `/envelopes/${envelopeId}/documents`, 'POST', { generatedDocumentIds: [documentId] }),
          { params: Promise.resolve({ id: envelopeId }) }
        )
      );
    }

    /**
     * Allowed when the actor may edit the envelope and, for an envelope with no company (which
     * takes the document's company), may also update that company.
     */
    function expectedToAttach(actor: ActorName, kind: Kind, docWhere: DocWhere): boolean {
      if (!POLICY[actor][kind].includes('update')) return false;
      const envelopeHasCompany = kind === 'A' || kind === 'B';
      if (envelopeHasCompany || docWhere === 'none') return true;
      return POLICY[actor][kindForCompany[docWhere]].includes('update');
    }

    const cases = ACTORS.flatMap((actor) =>
      KINDS.flatMap((kind) =>
        DOC_WHERES
          // A company envelope only takes documents of its own company, or of none.
          // (Compare the letters: the company ids only exist once beforeAll has run.)
          .filter((docWhere) => (kind !== 'A' && kind !== 'B') || docWhere === 'none' || docWhere === kind)
          .map((docWhere) => [actor, kind, docWhere, expectedToAttach(actor, kind, docWhere)] as const)
      )
    );

    it.each(cases)('%s on %s with a document of %s -> allowed: %s', async (actor, kind, docWhere, allowedToAttach) => {
      const { exportToPDF } = await import('@/services/document-export.service');
      vi.mocked(exportToPDF).mockClear();
      const document = await seedDocument(docWhere);

      if (!allowedToAttach) {
        const fx = shared.DRAFT[kind];
        const before = await snapshot(fx.envelopeId);

        const response = await attach(actor, fx.envelopeId, document.id);

        expect(response.status).toBe(403);
        // Refused before anything was rendered, written or moved.
        expect(exportToPDF).not.toHaveBeenCalled();
        expect(await snapshot(fx.envelopeId)).toBe(before);
        expect(await prisma.esigningEnvelopeDocument.count({ where: { generatedDocumentId: document.id } })).toBe(0);
        return;
      }

      const fx = await seedEnvelope('DRAFT', kind);
      const response = await attach(actor, fx.envelopeId, document.id);
      const body = await response.clone().text();

      expect(response.status, body.slice(0, 300)).toBe(201);
      const row = await prisma.esigningEnvelope.findUniqueOrThrow({
        where: { id: fx.envelopeId },
        include: { documents: true },
      });
      // An envelope with no company takes the document's company; otherwise it keeps its own.
      expect(row.companyId).toBe(companyOf(kind) ?? companyFor(docWhere));
      expect(row.documents.some((entry) => entry.generatedDocumentId === document.id)).toBe(true);
    });

    it('does not move an envelope into a company the actor cannot reach, even though the response is 403', async () => {
      // The exact case a reviewer found: company A user, their own no-company draft, a company B document.
      const fx = await seedEnvelope('DRAFT', 'N', { createdBy: 'aOnly' });
      const document = await seedDocument('B');

      const response = await attach('aOnly', fx.envelopeId, document.id);

      expect(response.status).toBe(403);
      const row = await prisma.esigningEnvelope.findUniqueOrThrow({
        where: { id: fx.envelopeId },
        include: { documents: true },
      });
      expect(row.companyId).toBeNull();
      expect(row.documents.some((entry) => entry.generatedDocumentId === document.id)).toBe(false);
    });

    describe('a batch is all or nothing', () => {
      function attachMany(actor: ActorName, envelopeId: string, documentIds: string[]) {
        return asActor(actor, () =>
          routes.documents.POST(
            json(ctx, `/envelopes/${envelopeId}/documents`, 'POST', { generatedDocumentIds: documentIds }),
            { params: Promise.resolve({ id: envelopeId }) }
          )
        );
      }

      const storedKeys = () => [...memory.files.keys()].sort();

      async function resetExport() {
        const { exportToPDF } = await import('@/services/document-export.service');
        vi.mocked(exportToPDF).mockReset();
        vi.mocked(exportToPDF).mockImplementation(async () => ({
          buffer: Buffer.from(memory.pdf!),
          filename: 'Generated.pdf',
        }) as never);
        return exportToPDF;
      }

      it.each([
        ['a document with no company, then one of company B', ['none', 'B'] as DocWhere[]],
        ['a document of company B, then one with no company', ['B', 'none'] as DocWhere[]],
        ['two documents with no company, then one of company B', ['none', 'none', 'B'] as DocWhere[]],
      ])('refuses %s with 403 and leaves no trace', async (_label, wheres) => {
        const exportToPDF = await resetExport();
        const fx = await seedEnvelope('DRAFT', 'N', { createdBy: 'aOnly' });
        const documents = await Promise.all(wheres.map((where) => seedDocument(where)));
        const before = await snapshot(fx.envelopeId);
        const keysBefore = storedKeys();

        const response = await attachMany('aOnly', fx.envelopeId, documents.map((document) => document.id));

        expect(response.status).toBe(403);
        // Refused as a whole, before anything was rendered, uploaded or written.
        expect(exportToPDF).not.toHaveBeenCalled();
        expect(await snapshot(fx.envelopeId)).toBe(before);
        expect(storedKeys()).toEqual(keysBefore);
        expect(
          await prisma.esigningEnvelopeDocument.count({
            where: { generatedDocumentId: { in: documents.map((document) => document.id) } },
          })
        ).toBe(0);
      });

      it('refuses documents of two companies for an actor who may edit both, and changes nothing', async () => {
        const exportToPDF = await resetExport();
        const fx = await seedEnvelope('DRAFT', 'N');
        const documents = [await seedDocument('A'), await seedDocument('B')];
        const before = await snapshot(fx.envelopeId);
        const keysBefore = storedKeys();

        const response = await attachMany('tenantWide', fx.envelopeId, documents.map((document) => document.id));

        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
        expect(exportToPDF).not.toHaveBeenCalled();
        expect(await snapshot(fx.envelopeId)).toBe(before);
        expect(storedKeys()).toEqual(keysBefore);
      });

      it('attaches a fully permitted mixed batch together and gives the envelope the batch company', async () => {
        const exportToPDF = await resetExport();
        const fx = await seedEnvelope('DRAFT', 'N', { createdBy: 'aOnly' });
        const documents = [await seedDocument('none'), await seedDocument('A'), await seedDocument('none')];

        const response = await attachMany('aOnly', fx.envelopeId, documents.map((document) => document.id));
        const body = await response.clone().text();

        expect(response.status, body.slice(0, 300)).toBe(201);
        expect(exportToPDF).toHaveBeenCalledTimes(3);
        const row = await prisma.esigningEnvelope.findUniqueOrThrow({
          where: { id: fx.envelopeId },
          include: { documents: { orderBy: { sortOrder: 'asc' } } },
        });
        expect(row.companyId).toBe(companyA);
        expect(row.documents.map((entry) => entry.generatedDocumentId).filter(Boolean)).toEqual(
          documents.map((document) => document.id)
        );
        for (const entry of row.documents) expect(memory.files.has(entry.storagePath)).toBe(true);
        // The seeded document keeps sort order 1; the batch follows it in the order requested.
        const generated = row.documents.filter((entry) => entry.generatedDocumentId);
        expect(generated.map((entry) => entry.sortOrder)).toEqual([...generated.map((entry) => entry.sortOrder)].sort((a, b) => a - b));
      });

      it('removes every uploaded object and writes nothing when a later document fails to render', async () => {
        const exportToPDF = await resetExport();
        let calls = 0;
        vi.mocked(exportToPDF).mockImplementation(async () => {
          calls += 1;
          if (calls === 2) throw new Error('render failed');
          return { buffer: Buffer.from(memory.pdf!), filename: 'Generated.pdf' } as never;
        });
        const fx = await seedEnvelope('DRAFT', 'A');
        const documents = [await seedDocument('A'), await seedDocument('A'), await seedDocument('A')];
        const before = await snapshot(fx.envelopeId);
        const keysBefore = storedKeys();

        const response = await attachMany('aOnly', fx.envelopeId, documents.map((document) => document.id));

        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(await snapshot(fx.envelopeId)).toBe(before);
        expect(storedKeys()).toEqual(keysBefore);
      });

      it('removes every uploaded object and writes nothing when the envelope is moved while the batch renders', async () => {
        const exportToPDF = await resetExport();
        const fx = await seedEnvelope('DRAFT', 'N', { createdBy: 'aOnly' });
        const documents = [await seedDocument('none'), await seedDocument('none')];
        let calls = 0;
        vi.mocked(exportToPDF).mockImplementation(async () => {
          calls += 1;
          // Between rendering and committing, somebody moves the envelope into company B.
          if (calls === 2) {
            await prisma.esigningEnvelope.update({ where: { id: fx.envelopeId }, data: { companyId: companyB } });
          }
          return { buffer: Buffer.from(memory.pdf!), filename: 'Generated.pdf' } as never;
        });
        const keysBefore = storedKeys();

        const response = await attachMany('aOnly', fx.envelopeId, documents.map((document) => document.id));

        expect(response.status).toBe(403);
        expect(storedKeys()).toEqual(keysBefore);
        const row = await prisma.esigningEnvelope.findUniqueOrThrow({
          where: { id: fx.envelopeId },
          include: { documents: true },
        });
        expect(row.companyId).toBe(companyB);
        expect(row.documents.some((entry) => entry.generatedDocumentId)).toBe(false);
      });
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

    describe('the creator exception covers ordinary edits, not company moves', () => {
      async function patchOwn(actor: ActorName, kind: Kind, body: Record<string, unknown>) {
        const fx = await seedEnvelope('DRAFT', kind, { createdBy: actor });
        const response = await asActor(actor, () =>
          routes.detail.PATCH(json(ctx, `/envelopes/${fx.envelopeId}`, 'PATCH', body), {
            params: Promise.resolve({ id: fx.envelopeId }),
          })
        );
        const row = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: fx.envelopeId } });
        return { response, row };
      }

      it('lets a creator with tenant-wide read and company-A update edit the title of their company-B envelope', async () => {
        const { response, row } = await patchOwn('mixed', 'B', { title: 'Edited by creator' });
        expect(response.status).toBe(200);
        expect(row.title).toBe('Edited by creator');
        expect(row.companyId).toBe(companyB);
      });

      it('refuses the same creator moving that company-B envelope into company A', async () => {
        const { response, row } = await patchOwn('mixed', 'B', { companyId: companyA, title: 'Moved by creator' });
        expect(response.status).toBe(403);
        expect(row.companyId).toBe(companyB);
        expect(row.title).not.toBe('Moved by creator');
      });

      it('refuses a company-A creator moving their envelope into a company they cannot update', async () => {
        const { response, row } = await patchOwn('aCreator', 'A', { companyId: companyB });
        expect(response.status).toBe(403);
        expect(row.companyId).toBe(companyA);
      });

      it('lets the creator of a no-company draft move it into a company they can update', async () => {
        const { response, row } = await patchOwn('aCreator', 'N2', { companyId: companyA });
        expect(response.status).toBe(200);
        expect(row.companyId).toBe(companyA);
      });

      it('refuses the creator of a no-company draft moving it into a company they cannot update', async () => {
        const { response, row } = await patchOwn('aCreator', 'N2', { companyId: companyB });
        expect(response.status).toBe(403);
        expect(row.companyId).toBeNull();
      });
    });
  });

  describe('a company move that commits after the service read the envelope', () => {
    /**
     * The service authorizes against a snapshot read before it opens its write transaction. To
     * land a move in that gap deterministically, another transaction takes the envelope's row
     * lock, the request is started (it reads the stale company and then waits on the lock),
     * and only then is the envelope moved to company B and the lock released.
     */
    async function whileMovedTo(envelopeId: string, companyId: string, run: () => Promise<Response>) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let locked!: () => void;
      const lockedPromise = new Promise<void>((resolve) => { locked = resolve; });

      const mover = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM esigning_envelopes WHERE id = ${envelopeId} FOR UPDATE`;
        locked();
        await gate;
        await tx.esigningEnvelope.update({ where: { id: envelopeId }, data: { companyId } });
      }, { timeout: 30_000 });
      await lockedPromise;

      const pending = run();
      let settledEarly = false;
      void pending.then(() => { settledEarly = true; }, () => { settledEarly = true; });
      const deadline = Date.now() + 10_000;
      let blocked = false;
      while (Date.now() < deadline && !settledEarly && !blocked) {
        const waiting = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
          SELECT count(*) AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
        `;
        blocked = Number(waiting[0].waiting) > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      release();
      await mover;
      const response = await pending;
      return { response, blockedOnTheLock: blocked };
    }

    const writers = HANDLERS.filter(
      (handler) => (handler.needs.includes('update') || handler.needs.includes('delete')) && !handler.needs.includes('create')
    );

    it.each(writers.map((handler) => [handler.name, handler] as const))(
      '%s writes nothing for a company-A-only actor',
      async (_name, handler) => {
        const fx = await seedEnvelope(handler.state, 'A');
        const before = JSON.parse(await snapshot(fx.envelopeId)) as Record<string, unknown>;

        const { response, blockedOnTheLock } = await whileMovedTo(fx.envelopeId, companyB, () =>
          asActor('aOnly', () => handler.call(ctx, fx))
        );
        const body = await response.clone().text();

        expect(blockedOnTheLock, 'the handler never waited on the envelope row lock').toBe(true);
        expect(response.status, body.slice(0, 300)).toBe(403);

        const rowAfter = await prisma.esigningEnvelope.findUnique({ where: { id: fx.envelopeId } });
        expect(rowAfter, 'the envelope must still exist').not.toBeNull();
        const after = JSON.parse(await snapshot(fx.envelopeId)) as Record<string, unknown>;
        // Only the move itself changed the row: the denied request left no write behind.
        delete before.updatedAt;
        delete after.updatedAt;
        expect(after).toEqual({ ...before, companyId: companyB });
      }
    );
  });

  describe('a company-A-only creator of a no-company draft', () => {
    it('keeps read, update and delete on it; a company-B user can read it but not change or delete it', async () => {
      const fx = shared.DRAFT.N2;
      const read = await asActor('aCreator', () =>
        routes.detail.GET(plain(ctx, `/envelopes/${fx.envelopeId}`), { params: Promise.resolve({ id: fx.envelopeId }) })
      );
      expect(read.status).toBe(200);

      const otherCompanyUser = await asActor('bOnly', () =>
        routes.detail.GET(plain(ctx, `/envelopes/${fx.envelopeId}`), { params: Promise.resolve({ id: fx.envelopeId }) })
      );
      expect(otherCompanyUser.status).toBe(200);
      const rename = await asActor('bOnly', () =>
        routes.detail.PATCH(json(ctx, `/envelopes/${fx.envelopeId}`, 'PATCH', { title: 'Taken over' }), {
          params: Promise.resolve({ id: fx.envelopeId }),
        })
      );
      expect(rename.status).toBe(403);
      const remove = await asActor('bOnly', () =>
        routes.detail.DELETE(plain(ctx, `/envelopes/${fx.envelopeId}`, 'DELETE'), { params: Promise.resolve({ id: fx.envelopeId }) })
      );
      expect(remove.status).toBe(403);
      expect(await prisma.esigningEnvelope.count({ where: { id: fx.envelopeId, deletedAt: null } })).toBe(1);
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

  describe('tenant isolation of no-company envelopes', () => {
    let otherTenantId: string;
    let otherUserId: string;
    let otherSession: unknown;
    let otherNoCompanyId: string;
    let otherNoCompanyDocumentId: string;

    beforeAll(async () => {
      const suffix = randomUUID();
      const workspace = await prisma.workspace.create({
        data: { name: `Other tenant ${suffix}`, slug: `other-tenant-${suffix}` },
      });
      otherTenantId = workspace.id;
      const permissions = await prisma.permission.findMany({
        where: { resource: 'esigning', action: { in: ['create', 'read', 'update', 'delete'] } },
      });
      const role = await prisma.role.create({ data: { tenantId: otherTenantId, name: `Esigning full ${suffix}` } });
      await prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      });
      const user = await prisma.user.create({
        data: {
          tenantId: otherTenantId,
          email: `other-${suffix}@example.test`,
          passwordHash: 'not-used',
          firstName: 'Other',
          lastName: 'User',
        },
      });
      otherUserId = user.id;
      await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id, companyId: null } });
      otherSession = {
        id: user.id,
        email: user.email,
        firstName: 'Other',
        lastName: 'User',
        tenantId: otherTenantId,
        workspaceId: otherTenantId,
        internalRole: 'STAFF',
        isAdmin: false,
        isManager: false,
        isStaff: true,
        isSuperAdmin: false,
        isWorkspaceAdmin: false,
        hasAllCompaniesAccess: true,
        companyIds: [],
      };
      otherNoCompanyId = randomUUID();
      await prisma.esigningEnvelope.create({
        data: {
          id: otherNoCompanyId,
          tenantId: otherTenantId,
          createdById: otherUserId,
          title: `OTHER TENANT no company ${otherNoCompanyId.slice(0, 6)}`,
          status: 'DRAFT',
          signingOrder: 'SEQUENTIAL',
          certificateId: `OAK-ES-${otherNoCompanyId.replace(/-/g, '').slice(0, 14).toUpperCase()}`,
          companyId: null,
        },
      });
      const storagePath = `${otherTenantId}/esigning/${otherNoCompanyId}/originals/doc.pdf`;
      memory.files.set(storagePath, documentPdf);
      otherNoCompanyDocumentId = (
        await prisma.esigningEnvelopeDocument.create({
          data: {
            tenantId: otherTenantId,
            envelopeId: otherNoCompanyId,
            fileName: 'other.pdf',
            originalFileName: 'other.pdf',
            storagePath,
            originalHash: 'hash',
            pageCount: 1,
            sortOrder: 1,
            fileSize: documentPdf.byteLength,
          },
        })
      ).id;
    }, 60_000);

    afterAll(async () => {
      if (!otherTenantId) return;
      await prisma.auditLog.deleteMany({ where: { tenantId: otherTenantId } });
      await prisma.esigningEnvelope.deleteMany({ where: { tenantId: otherTenantId } });
      await prisma.role.deleteMany({ where: { tenantId: otherTenantId } });
      await prisma.user.deleteMany({ where: { tenantId: otherTenantId } });
      await prisma.workspace.delete({ where: { id: otherTenantId } });
    });

    function asOther<T>(run: () => Promise<T>): Promise<T> {
      current.session = otherSession;
      return run();
    }

    async function listBody(run: () => Promise<Response>) {
      const response = await run();
      expect(response.status).toBe(200);
      return (await response.json()) as {
        total: number;
        envelopes: Array<{ id: string }>;
        statusCounts: Record<string, number>;
      };
    }

    it.each(ACTORS)("%s never sees the other tenant's no-company envelope, but sees its own tenant's", async (actor) => {
      const fixtureTitle = (
        await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: shared.DRAFT.N.envelopeId }, select: { title: true } })
      ).title;
      const body = await listBody(() =>
        asActor(actor, () => routes.envelopes.GET(plain(ctx, '/envelopes?limit=100')))
      );
      const ids = body.envelopes.map((entry) => entry.id);
      expect(ids).not.toContain(otherNoCompanyId);
      const searched = await listBody(() =>
        asActor(actor, () => routes.envelopes.GET(plain(ctx, `/envelopes?limit=100&query=${encodeURIComponent(fixtureTitle)}`)))
      );
      expect(searched.envelopes.map((entry) => entry.id)).toEqual([shared.DRAFT.N.envelopeId]);
      const inOtherTenant = await prisma.esigningEnvelope.count({
        where: { id: { in: ids }, tenantId: otherTenantId },
      });
      expect(inOtherTenant).toBe(0);
      expect(Object.values(body.statusCounts).reduce((sum, count) => sum + count, 0)).toBe(body.total);
    });

    it("the other tenant sees only its own envelope: list, total and counts exclude this tenant's no-company ones", async () => {
      const body = await listBody(() =>
        asOther(() => routes.envelopes.GET(plain({ ...ctx, tenantId: otherTenantId }, '/envelopes?limit=100')))
      );
      expect(body.envelopes.map((entry) => entry.id)).toEqual([otherNoCompanyId]);
      expect(body.total).toBe(1);
      expect(Object.values(body.statusCounts).reduce((sum, count) => sum + count, 0)).toBe(1);
    });

    it.each(ACTORS)("%s cannot open the other tenant's no-company envelope or its document", async (actor) => {
      for (const target of [otherTenantId, tenantId]) {
        const label = `${actor} with tenantId=${target === tenantId ? 'own' : 'other'}`;
        const detail = await asActor(actor, () =>
          routes.detail.GET(plain({ ...ctx, tenantId: target }, `/envelopes/${otherNoCompanyId}`), {
            params: Promise.resolve({ id: otherNoCompanyId }),
          })
        );
        expect(detail.status, `${label} detail`).not.toBe(200);
        expect(await detail.text()).not.toContain('OTHER TENANT');

        const pdf = await asActor(actor, () =>
          routes.documentPdf.GET(
            plain({ ...ctx, tenantId: target }, `/envelopes/${otherNoCompanyId}/documents/${otherNoCompanyDocumentId}/pdf`),
            { params: Promise.resolve({ id: otherNoCompanyId, docId: otherNoCompanyDocumentId }) }
          )
        );
        expect(pdf.status, `${label} pdf`).not.toBe(200);
      }
    });

    it("a user of the other tenant cannot open this tenant's no-company envelope, whichever tenant they name", async () => {
      const fx = shared.DRAFT.N;
      for (const target of [tenantId, otherTenantId]) {
        const label = `tenantId=${target === tenantId ? 'this' : 'own'}`;
        const detail = await asOther(() =>
          routes.detail.GET(plain({ ...ctx, tenantId: target }, `/envelopes/${fx.envelopeId}`), {
            params: Promise.resolve({ id: fx.envelopeId }),
          })
        );
        expect(detail.status, `${label} detail`).not.toBe(200);
        const pdf = await asOther(() =>
          routes.documentPdf.GET(
            plain({ ...ctx, tenantId: target }, `/envelopes/${fx.envelopeId}/documents/${fx.documentId}/pdf`),
            { params: Promise.resolve({ id: fx.envelopeId, docId: fx.documentId }) }
          )
        );
        expect(pdf.status, `${label} pdf`).not.toBe(200);
      }
    });
  });

  describe('read entry for users whose only e-signing grant is create, update or delete', () => {
    /**
     * No-company envelopes are readable by every e-signing user of the tenant, whatever the
     * action they hold. The entry gates of the read routes must not ask for `read` itself,
     * while company envelopes keep needing `read` in that company and every change keeps its
     * own rule.
     */
    type OnlyActor = 'aCreateOnly' | 'aUpdateOnly' | 'aDeleteOnly' | 'twCreateOnly' | 'noEsigning';
    const ONLY_ACTORS: OnlyActor[] = ['aCreateOnly', 'aUpdateOnly', 'aDeleteOnly', 'twCreateOnly'];
    const onlySessions = {} as Record<OnlyActor, unknown>;

    beforeAll(async () => {
      const suffix = randomUUID();
      const permission = async (resource: string, action: string) =>
        (
          await prisma.permission.upsert({
            where: { resource_action: { resource, action } },
            create: { resource, action },
            update: {},
          })
        ).id;
      const roleWith = async (name: string, keys: Array<[string, string]>) => {
        const role = await prisma.role.create({ data: { tenantId, name: `${name} ${suffix}` } });
        for (const [resource, action] of keys) {
          await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: await permission(resource, action) } });
        }
        return role.id;
      };
      const plan: Record<OnlyActor, { roleId: string; companyId: string | null }> = {
        aCreateOnly: { roleId: await roleWith('Only create', [['esigning', 'create']]), companyId: companyA },
        aUpdateOnly: { roleId: await roleWith('Only update', [['esigning', 'update']]), companyId: companyA },
        aDeleteOnly: { roleId: await roleWith('Only delete', [['esigning', 'delete']]), companyId: companyA },
        twCreateOnly: { roleId: await roleWith('Tenant-wide only create', [['esigning', 'create']]), companyId: null },
        // No e-signing grant at all (a document grant only).
        noEsigning: { roleId: await roleWith('No e-signing', [['document', 'read']]), companyId: companyA },
      };
      for (const name of Object.keys(plan) as OnlyActor[]) {
        const user = await prisma.user.create({
          data: { tenantId, email: `${name}-${suffix}@example.test`, passwordHash: 'not-used', firstName: name, lastName: 'User' },
        });
        await prisma.userRoleAssignment.create({ data: { userId: user.id, ...plan[name] } });
        onlySessions[name] = {
          id: user.id,
          email: user.email,
          firstName: name,
          lastName: 'User',
          tenantId,
          workspaceId: tenantId,
          internalRole: 'STAFF',
          isAdmin: false,
          isManager: false,
          isStaff: true,
          isSuperAdmin: false,
          isWorkspaceAdmin: false,
          hasAllCompaniesAccess: plan[name].companyId === null,
          companyIds: plan[name].companyId ? [plan[name].companyId] : [],
        };
      }
    }, 60_000);

    function as<T>(actor: OnlyActor, run: () => Promise<T>): Promise<T> {
      current.session = onlySessions[actor];
      return run();
    }

    function detailOf(fx: Fixture) {
      return routes.detail.GET(plain(ctx, `/envelopes/${fx.envelopeId}`), { params: Promise.resolve({ id: fx.envelopeId }) });
    }

    it.each(ONLY_ACTORS)('%s lists exactly the no-company envelopes of the tenant', async (actor) => {
      const ids: string[] = [];
      let total = -1;
      for (let page = 1; page <= 50; page += 1) {
        const response = await as(actor, () => routes.envelopes.GET(plain(ctx, `/envelopes?limit=100&page=${page}`)));
        expect(response.status).toBe(200);
        const body = (await response.json()) as { total: number; envelopes: Array<{ id: string }>; companyOptions: unknown[] };
        if (page === 1) total = body.total;
        ids.push(...body.envelopes.map((entry) => entry.id));
        expect(body.companyOptions).toEqual([]);
        if (body.envelopes.length < 100) break;
      }
      const expected = await prisma.esigningEnvelope.findMany({
        where: { tenantId, deletedAt: null, companyId: null },
        select: { id: true },
      });
      expect(expected.length).toBeGreaterThan(0);
      expect([...ids].sort()).toEqual(expected.map((row) => row.id).sort());
      expect(total).toBe(expected.length);
    });

    it.each(ONLY_ACTORS)('%s opens a no-company envelope, its events and its PDF, but not company envelopes', async (actor) => {
      for (const state of STATES) {
        const fx = shared[state].N;
        expect((await as(actor, () => detailOf(fx))).status, `${state} N detail`).toBe(200);
      }
      const fx = shared.DRAFT.N;
      const events = await as(actor, () =>
        routes.events.GET(plain(ctx, `/envelopes/${fx.envelopeId}/events`), { params: Promise.resolve({ id: fx.envelopeId }) })
      );
      expect(events.status).toBe(200);
      const pdf = await as(actor, () =>
        routes.documentPdf.GET(plain(ctx, `/envelopes/${fx.envelopeId}/documents/${fx.documentId}/pdf`), {
          params: Promise.resolve({ id: fx.envelopeId, docId: fx.documentId }),
        })
      );
      expect(pdf.status).toBe(200);
      const done = shared.COMPLETED.N;
      const download = await as(actor, () =>
        routes.download.GET(plain(ctx, `/envelopes/${done.envelopeId}/download`), { params: Promise.resolve({ id: done.envelopeId }) })
      );
      expect(download.status).not.toBe(403);

      // Company envelopes still need `read` in that company: none of these users has it.
      for (const kind of ['A', 'B'] as const) {
        expect((await as(actor, () => detailOf(shared.DRAFT[kind]))).status, `${kind} detail`).toBe(403);
      }
    });

    it.each(ONLY_ACTORS)('%s still cannot change, send or delete a no-company envelope made by somebody else', async (actor) => {
      const fx = shared.DRAFT.N;
      const before = await snapshot(fx.envelopeId);
      const calls = [
        () => routes.detail.PATCH(json(ctx, `/envelopes/${fx.envelopeId}`, 'PATCH', { title: 'Taken' }), { params: Promise.resolve({ id: fx.envelopeId }) }),
        () => routes.detail.DELETE(plain(ctx, `/envelopes/${fx.envelopeId}`, 'DELETE'), { params: Promise.resolve({ id: fx.envelopeId }) }),
        () => routes.send.POST(json(ctx, `/envelopes/${fx.envelopeId}/send`, 'POST'), { params: Promise.resolve({ id: fx.envelopeId }) }),
      ];
      for (const call of calls) {
        expect((await as(actor, call)).status).toBe(403);
      }
      expect(await snapshot(fx.envelopeId)).toBe(before);
      expect(await prisma.esigningEnvelope.count({ where: { id: fx.envelopeId, deletedAt: null } })).toBe(1);
    });

    it('a user with no e-signing grant at all gets 403 from the list, the detail, the events and the PDF', async () => {
      const fx = shared.DRAFT.N;
      expect((await as('noEsigning', () => routes.envelopes.GET(plain(ctx, '/envelopes')))).status).toBe(403);
      expect((await as('noEsigning', () => detailOf(fx))).status).toBe(403);
      const events = await as('noEsigning', () =>
        routes.events.GET(plain(ctx, `/envelopes/${fx.envelopeId}/events`), { params: Promise.resolve({ id: fx.envelopeId }) })
      );
      expect(events.status).toBe(403);
      const pdf = await as('noEsigning', () =>
        routes.documentPdf.GET(plain(ctx, `/envelopes/${fx.envelopeId}/documents/${fx.documentId}/pdf`), {
          params: Promise.resolve({ id: fx.envelopeId, docId: fx.documentId }),
        })
      );
      expect(pdf.status).toBe(403);
    });
  });
});
