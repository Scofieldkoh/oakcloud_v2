import type {
  EsigningActorScope,
  EsigningPermissionFlags,
} from '@/services/esigning-envelope.lib';

const NONE: EsigningPermissionFlags = {
  create: false,
  read: false,
  update: false,
  delete: false,
  manage: false,
};

/** Build an actor scope for tests that mock `resolveEsigningActorScope`. */
export function makeEsigningScope(input: {
  admin?: boolean;
  tenantWide?: Partial<EsigningPermissionFlags>;
  companies?: Record<string, Partial<EsigningPermissionFlags>>;
  any?: Partial<EsigningPermissionFlags>;
} = {}): EsigningActorScope {
  const everything: EsigningPermissionFlags = {
    create: true,
    read: true,
    update: true,
    delete: true,
    manage: true,
  };
  if (input.admin) {
    return {
      tenantId: 'tenant-1',
      isAdmin: true,
      tenantWide: everything,
      companies: {},
      any: everything,
    };
  }

  const tenantWide = { ...NONE, ...input.tenantWide };
  const companies = Object.fromEntries(
    Object.entries(input.companies ?? {}).map(([id, flags]) => [id, { ...NONE, ...flags }])
  );
  const any = { ...NONE, ...tenantWide, ...input.any };
  for (const flags of Object.values(companies)) {
    for (const key of Object.keys(flags) as Array<keyof EsigningPermissionFlags>) {
      if (flags[key]) any[key] = true;
    }
  }

  return { tenantId: 'tenant-1', isAdmin: false, tenantWide, companies, any };
}
