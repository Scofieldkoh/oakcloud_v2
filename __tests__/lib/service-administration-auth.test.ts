import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@/lib/auth';
import { requireServiceAdministrator } from '@/lib/service-administration-auth';

const session = { isSuperAdmin: false, isWorkspaceAdmin: false } as unknown as SessionUser;

describe('requireServiceAdministrator', () => {
  it('rejects non-admin users', () => {
    expect(() => requireServiceAdministrator(session)).toThrow('Service administration requires');
  });

  it.each([
    { isSuperAdmin: true, isWorkspaceAdmin: false },
    { isSuperAdmin: false, isWorkspaceAdmin: true },
  ])('accepts an administrative session', (roles) => {
    expect(() => requireServiceAdministrator({ ...session, ...roles })).not.toThrow();
  });
});
