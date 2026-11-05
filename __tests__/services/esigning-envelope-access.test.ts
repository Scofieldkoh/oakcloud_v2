import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEsigningScope } from '../helpers/esigning-scope';

const rbacMocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  hasTenantWidePermission: vi.fn(),
  requireAnyPermission: vi.fn(),
}));

vi.mock('@/lib/rbac', () => rbacMocks);
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import {
  assertCanCreateEnvelopeForCompany,
  buildEsigningEnvelopeReadWhere,
  canCreateEnvelopeForCompany,
  canDeleteEnvelope,
  canManageEnvelope,
  canMoveEnvelopeToCompany,
  canMutateEnvelope,
  canReadEnvelope,
  lockEnvelopeForAuthorizedChange,
  requireEsigningReadEntry,
  resolveEsigningActorScope,
  type EsigningActorScope,
} from '@/services/esigning-envelope.lib';

const FULL = { create: true, read: true, update: true, delete: true };

function sessionFor(id: string, companyIds: string[] = []) {
  return {
    id,
    tenantId: 'tenant-1',
    isSuperAdmin: false,
    isWorkspaceAdmin: false,
    hasAllCompaniesAccess: false,
    companyIds,
  } as never;
}

const inA = { createdById: 'someone-else', companyId: 'A' };
const inB = { createdById: 'someone-else', companyId: 'B' };
const noCompany = { createdById: 'someone-else', companyId: null };

type Row = { name: string; scope: EsigningActorScope; userId: string; results: Record<string, boolean[]> };

// [envelope in A, envelope in B, envelope with no company], per operation. An envelope
// with no company can be read by every e-signing user; changing it keeps the older rule.
const rows: Row[] = [
  {
    name: 'company-A-only',
    userId: 'user-a',
    scope: makeEsigningScope({ companies: { A: FULL } }),
    results: { read: [true, false, true], update: [true, false, false], delete: [true, false, false] },
  },
  {
    name: 'company-B-only',
    userId: 'user-b',
    scope: makeEsigningScope({ companies: { B: FULL } }),
    results: { read: [false, true, true], update: [false, true, false], delete: [false, true, false] },
  },
  {
    name: 'tenant-wide',
    userId: 'user-t',
    scope: makeEsigningScope({ tenantWide: FULL }),
    results: { read: [true, true, true], update: [true, true, true], delete: [true, true, true] },
  },
  {
    name: 'workspace admin',
    userId: 'user-admin',
    scope: makeEsigningScope({ admin: true }),
    results: { read: [true, true, true], update: [true, true, true], delete: [true, true, true] },
  },
  {
    name: 'company-A read-only',
    userId: 'user-ro',
    scope: makeEsigningScope({ companies: { A: { read: true } } }),
    results: { read: [true, false, true], update: [false, false, false], delete: [false, false, false] },
  },
  {
    name: 'tenant-wide read + company-A editor',
    userId: 'user-mixed',
    scope: makeEsigningScope({
      tenantWide: { read: true },
      companies: { A: FULL },
    }),
    // A: editor override; B: falls back to tenant-wide read-only; no company: read-only.
    results: { read: [true, true, true], update: [true, false, false], delete: [true, false, false] },
  },
];

describe('esigning envelope access rule', () => {
  describe.each(rows)('$name (not the creator)', ({ userId, scope, results }) => {
    const session = sessionFor(userId);
    const envelopes = [inA, inB, noCompany];

    it('read', () => {
      expect(envelopes.map((e) => canReadEnvelope(scope, session, e))).toEqual(results.read);
    });
    it('update', () => {
      expect(envelopes.map((e) => canMutateEnvelope(scope, session, e))).toEqual(results.update);
    });
    it('delete', () => {
      expect(envelopes.map((e) => canDeleteEnvelope(scope, session, e))).toEqual(results.delete);
    });
    it('void, resend, retry and manual link follow update when manage is not held', () => {
      expect(envelopes.map((e) => canManageEnvelope(scope, session, e))).toEqual(results.update);
    });
  });

  describe('company-A-only user who created a no-company draft', () => {
    const scope = makeEsigningScope({ companies: { A: FULL } });
    const session = sessionFor('creator', ['A']);
    const ownNoCompany = { createdById: 'creator', companyId: null };

    it('keeps full access to their own no-company envelope', () => {
      expect(canReadEnvelope(scope, session, ownNoCompany)).toBe(true);
      expect(canMutateEnvelope(scope, session, ownNoCompany)).toBe(true);
      expect(canDeleteEnvelope(scope, session, ownNoCompany)).toBe(true);
      expect(canManageEnvelope(scope, session, ownNoCompany)).toBe(true);
    });

    it('can open a no-company envelope someone else created, but not change or delete it, and still not company B', () => {
      expect(canReadEnvelope(scope, session, noCompany)).toBe(true);
      expect(canMutateEnvelope(scope, session, noCompany)).toBe(false);
      expect(canDeleteEnvelope(scope, session, noCompany)).toBe(false);
      expect(canManageEnvelope(scope, session, noCompany)).toBe(false);
      expect(canReadEnvelope(scope, session, inB)).toBe(false);
    });

    it('loses access to their own company-B envelope once company-B access is gone', () => {
      expect(canReadEnvelope(scope, session, { createdById: 'creator', companyId: 'B' })).toBe(false);
      expect(canMutateEnvelope(scope, session, { createdById: 'creator', companyId: 'B' })).toBe(false);
    });
  });

  describe('tenant isolation', () => {
    const otherTenant = { createdById: 'someone-else', companyId: null, tenantId: 'tenant-2' };
    const sameTenant = { createdById: 'someone-else', companyId: null, tenantId: 'tenant-1' };

    it.each(rows)('$name cannot read, change or delete an envelope of another tenant', ({ userId, scope }) => {
      const session = sessionFor(userId);
      expect(canReadEnvelope(scope, session, otherTenant)).toBe(false);
      expect(canReadEnvelope(scope, session, { ...otherTenant, companyId: 'A' })).toBe(false);
      expect(canMutateEnvelope(scope, session, otherTenant)).toBe(false);
      expect(canDeleteEnvelope(scope, session, otherTenant)).toBe(false);
      expect(canManageEnvelope(scope, session, otherTenant)).toBe(false);
    });

    it('reads a no-company envelope of its own tenant', () => {
      const scope = makeEsigningScope({ companies: { A: { read: true } } });
      expect(canReadEnvelope(scope, sessionFor('user-ro'), sameTenant)).toBe(true);
    });
  });

  describe('manage', () => {
    it('lets a manage holder act on that company only', () => {
      const scope = makeEsigningScope({ companies: { A: { read: true, manage: true } } });
      const session = sessionFor('manager', ['A']);
      expect(canManageEnvelope(scope, session, inA)).toBe(true);
      expect(canManageEnvelope(scope, session, inB)).toBe(false);
      expect(canManageEnvelope(scope, session, noCompany)).toBe(false);
    });

    it('lets a tenant-wide manage holder act on no-company envelopes', () => {
      const scope = makeEsigningScope({ tenantWide: { read: true, manage: true } });
      expect(canManageEnvelope(scope, sessionFor('manager'), noCompany)).toBe(true);
    });
  });

  describe('create', () => {
    it('needs create for the company', () => {
      const scope = makeEsigningScope({ companies: { A: FULL, B: { read: true } } });
      expect(canCreateEnvelopeForCompany(scope, 'A')).toBe(true);
      expect(canCreateEnvelopeForCompany(scope, 'B')).toBe(false);
      expect(canCreateEnvelopeForCompany(scope, 'C')).toBe(false);
      expect(() => assertCanCreateEnvelopeForCompany(scope, 'B')).toThrow('Permission denied');
    });

    it('allows a company-scoped creator to start a draft with no company', () => {
      const scope = makeEsigningScope({ companies: { A: FULL } });
      expect(canCreateEnvelopeForCompany(scope, null)).toBe(true);
    });

    it('falls back to tenant-wide create for a company without its own assignment', () => {
      const scope = makeEsigningScope({ tenantWide: { create: true } });
      expect(canCreateEnvelopeForCompany(scope, 'any-company')).toBe(true);
    });
  });

  describe('changing the company of a draft', () => {
    const scope = makeEsigningScope({
      companies: { A: FULL, B: { read: true }, C: { read: true, update: true } },
    });
    const session = sessionFor('editor');
    const draftInA = { createdById: 'editor', companyId: 'A' };

    it('needs update on the target company', () => {
      expect(canMoveEnvelopeToCompany(scope, session, draftInA, 'C')).toBe(true);
      expect(canMoveEnvelopeToCompany(scope, session, draftInA, 'B')).toBe(false);
    });

    it('does not let the creator rule stand in for update on the current company', () => {
      // The actor created the draft and holds only read in B: ordinary edits are allowed
      // by the creator rule, but moving it out of B needs a real update grant on B.
      const ownDraftInB = { createdById: 'editor', companyId: 'B' };
      expect(canMutateEnvelope(scope, session, ownDraftInB)).toBe(true);
      expect(canMoveEnvelopeToCompany(scope, session, ownDraftInB, 'A')).toBe(false);
      expect(canMoveEnvelopeToCompany(scope, session, draftInA, 'B')).toBe(false);
    });

    it('does not let a creator pull their envelope into a company they can update', () => {
      // Tenant-wide read plus company-A update: the creator of a company-B envelope may
      // edit it, but must not move it into A.
      const wide = makeEsigningScope({ tenantWide: { read: true }, companies: { A: FULL } });
      const ownDraftInB = { createdById: 'editor', companyId: 'B' };
      expect(canMutateEnvelope(wide, session, ownDraftInB)).toBe(true);
      expect(canMoveEnvelopeToCompany(wide, session, ownDraftInB, 'A')).toBe(false);
    });

    it('lets the creator of a no-company draft move it where they can update', () => {
      const noCompany = { createdById: 'editor', companyId: null };
      expect(canMoveEnvelopeToCompany(scope, session, noCompany, 'C')).toBe(true);
      expect(canMoveEnvelopeToCompany(scope, session, noCompany, 'B')).toBe(false);
      expect(canMoveEnvelopeToCompany(scope, session, { createdById: 'x', companyId: null }, 'C')).toBe(false);
    });

    it('needs update on the current company', () => {
      expect(canMoveEnvelopeToCompany(scope, session, { createdById: 'x', companyId: 'B' }, 'A')).toBe(false);
    });
  });

  describe('buildEsigningEnvelopeReadWhere', () => {
    it('adds no restriction for admins', () => {
      expect(buildEsigningEnvelopeReadWhere(makeEsigningScope({ admin: true }), sessionFor('admin'))).toEqual({});
    });

    it('limits a company-A-only user to company A plus every no-company row', () => {
      const where = buildEsigningEnvelopeReadWhere(
        makeEsigningScope({ companies: { A: FULL } }),
        sessionFor('user-a', ['A'])
      );
      expect(where).toEqual({
        OR: [
          { companyId: null },
          { companyId: { in: ['A'] } },
        ],
      });
    });

    it('shows no-company rows to a user whose only e-signing right is read in one company', () => {
      const where = buildEsigningEnvelopeReadWhere(
        makeEsigningScope({ companies: { A: { read: true } } }),
        sessionFor('user-ro', ['A'])
      );
      expect(where).toEqual({
        OR: [{ companyId: null }, { companyId: { in: ['A'] } }],
      });
    });

    it('lets tenant-wide read see every company and no-company rows', () => {
      const where = buildEsigningEnvelopeReadWhere(
        makeEsigningScope({ tenantWide: FULL }),
        sessionFor('user-t')
      );
      expect(where).toEqual({
        OR: [{ companyId: null }, { companyId: { not: null } }],
      });
    });

    it('keeps explicit companies out of the tenant-wide fallback', () => {
      const where = buildEsigningEnvelopeReadWhere(
        makeEsigningScope({ tenantWide: { read: true }, companies: { A: { update: true } } }),
        sessionFor('user-m', ['A'])
      );
      expect(where).toEqual({
        OR: [
          { companyId: null },
          // A has an assignment without read: only rows this user created.
          { companyId: { in: ['A'] }, createdById: 'user-m' },
          { companyId: { not: null, notIn: ['A'] } },
        ],
      });
    });
  });

  describe('resolveEsigningActorScope', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('resolves tenant-wide and per-company flags separately', async () => {
      rbacMocks.hasTenantWidePermission.mockImplementation(
        async (_user: string, _resource: string, action: string) => action === 'read'
      );
      rbacMocks.hasPermission.mockImplementation(
        async (_user: string, _resource: string, action: string, companyId?: string) => {
          if (companyId === 'A') return ['read', 'update'].includes(action);
          if (companyId) return action === 'read';
          return ['read', 'update'].includes(action);
        }
      );

      const scope = await resolveEsigningActorScope(sessionFor('user-m', ['A']), 'tenant-1');

      expect(scope.isAdmin).toBe(false);
      expect(scope.tenantWide).toEqual({ create: false, read: true, update: false, delete: false, manage: false });
      expect(scope.companies.A).toEqual({ create: false, read: true, update: true, delete: false, manage: false });
      expect(scope.any.update).toBe(true);
    });

    it('rejects an actor with no e-signing permission anywhere', async () => {
      rbacMocks.hasTenantWidePermission.mockResolvedValue(false);
      rbacMocks.hasPermission.mockResolvedValue(false);

      await expect(resolveEsigningActorScope(sessionFor('nobody'), 'tenant-1')).rejects.toThrow(
        'Permission denied: esigning'
      );
    });

    it('refuses another tenant', async () => {
      await expect(resolveEsigningActorScope(sessionFor('user'), 'tenant-2')).rejects.toThrow('Forbidden');
    });
  });

  describe('lockEnvelopeForAuthorizedChange', () => {
    const scope = makeEsigningScope({ companies: { A: FULL } });
    const session = sessionFor('user-a', ['A']);

    function txReturning(rows: unknown[]) {
      return { $queryRaw: vi.fn().mockResolvedValue(rows) } as never;
    }
    function lock(rows: unknown[], tenantId = 'tenant-1') {
      return lockEnvelopeForAuthorizedChange(txReturning(rows), {
        scope,
        session,
        tenantId,
        envelopeId: 'envelope-1',
        check: canMutateEnvelope,
      });
    }
    const row = (companyId: string | null) => ({
      id: 'envelope-1', tenantId: 'tenant-1', status: 'DRAFT', expiresAt: null, createdById: 'someone-else', companyId,
    });

    it('returns the locked row when the actor may still act on it', async () => {
      await expect(lock([row('A')])).resolves.toMatchObject({ companyId: 'A', status: 'DRAFT' });
    });

    it('decides on the locked row, not on what the service read earlier', async () => {
      // The service saw the envelope in company A; by the time it is locked it is in B.
      await expect(lock([row('B')])).rejects.toThrow('Forbidden');
    });

    it('reports a missing envelope and an envelope of another tenant as not found', async () => {
      await expect(lock([])).rejects.toThrow('Envelope not found');
      await expect(lock([row('A')], 'tenant-2')).rejects.toThrow('Envelope not found');
    });
  });

  describe('requireEsigningReadEntry', () => {
    it('asks for any e-signing action, not for read alone', async () => {
      rbacMocks.requireAnyPermission.mockResolvedValue(undefined);
      await requireEsigningReadEntry(sessionFor('user-1', ['A']));
      const [, permissions] = rbacMocks.requireAnyPermission.mock.calls[0];
      expect(permissions).toEqual(
        ['create', 'read', 'update', 'delete', 'manage'].map((action) => ({ resource: 'esigning', action }))
      );
    });

    it('lets a user without any e-signing action through to a 403', async () => {
      rbacMocks.requireAnyPermission.mockRejectedValue(new Error('Permission denied: esigning:create, esigning:read'));
      await expect(requireEsigningReadEntry(sessionFor('user-1', ['A']))).rejects.toThrow('Permission denied');
    });

    it('does not ask the permission layer for admins', async () => {
      rbacMocks.requireAnyPermission.mockClear();
      await requireEsigningReadEntry({ ...(sessionFor('admin') as object), isWorkspaceAdmin: true } as never);
      expect(rbacMocks.requireAnyPermission).not.toHaveBeenCalled();
    });
  });
});
