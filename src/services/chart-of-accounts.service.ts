/**
 * Chart of Accounts Service
 *
 * Business logic for chart of accounts management including:
 * - CRUD operations for accounts
 * - Account resolution (company -> tenant -> system fallback)
 * - External platform mapping (Xero, Odoo, etc.)
 * - Hierarchy management
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import type {
  ChartOfAccount,
  ChartOfAccountsMapping,
  AccountType,
  AccountStatus,
  AccountingProvider,
} from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import type {
  CreateAccountInput,
  UpdateAccountInput,
  AccountSearchInput,
  AccountMappingInput,
  BulkMappingInput,
} from '@/lib/validations/chart-of-accounts';
import { createLogger } from '@/lib/logger';

const log = createLogger('chart-of-accounts-service');

// ============================================================================
// Types
// ============================================================================

export interface TenantAwareParams {
  tenantId?: string | null;
  userId: string;
  isSuperAdmin: boolean;
}

export interface AccountWithMetadata {
  id: string;
  code: string;
  name: string;
  description: string | null;
  accountType: AccountType;
  status: AccountStatus;
  parentId: string | null;
  sortOrder: number;
  isSystem: boolean;
  isTaxApplicable: boolean;
  isHeader: boolean;
  tenantId: string | null;
  companyId: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Computed
  scope: 'system' | 'tenant' | 'company';
  parent?: { id: string; code: string; name: string } | null;
  childCount?: number;
  mappingCount?: number;
}

export interface AccountNode extends AccountWithMetadata {
  children: AccountNode[];
}

export interface PaginatedAccounts {
  accounts: AccountWithMetadata[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface MappingWithAccount {
  id: string;
  accountId: string;
  companyId: string;
  provider: AccountingProvider;
  externalCode: string | null;
  externalId: string | null;
  externalName: string | null;
  lastSyncedAt: Date | null;
  syncStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
  account: {
    id: string;
    code: string;
    name: string;
    accountType: AccountType;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function getAccountScope(tenantId: string | null, companyId: string | null): 'system' | 'tenant' | 'company' {
  if (!tenantId && !companyId) return 'system';
  if (tenantId && !companyId) return 'tenant';
  return 'company';
}

function toAccountWithMetadata(
  account: ChartOfAccount & {
    parent?: { id: string; code: string; name: string } | null;
    _count?: { children: number; externalMappings: number };
  }
): AccountWithMetadata {
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    description: account.description,
    accountType: account.accountType,
    status: account.status,
    parentId: account.parentId,
    sortOrder: account.sortOrder,
    isSystem: account.isSystem,
    isTaxApplicable: account.isTaxApplicable,
    isHeader: account.isHeader,
    tenantId: account.tenantId,
    companyId: account.companyId,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    scope: getAccountScope(account.tenantId, account.companyId),
    parent: account.parent || null,
    childCount: account._count?.children ?? 0,
    mappingCount: account._count?.externalMappings ?? 0,
  };
}

// ============================================================================
// Account CRUD Operations
// ============================================================================

/**
 * Get paginated list of accounts with filters.
 */
export async function getAccounts(params: AccountSearchInput): Promise<PaginatedAccounts> {
  const {
    search,
    accountType,
    status,
    tenantId,
    companyId,
    includeSystem,
    parentId,
    topLevelOnly,
    page,
    limit,
    sortBy,
    sortOrder,
  } = params;

  const where: Prisma.ChartOfAccountWhereInput = {
    deletedAt: null,
  };

  // Search filter
  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Account type filter
  if (accountType) {
    where.accountType = accountType;
  }

  // Status filter
  if (status) {
    where.status = status;
  }

  // Parent filter
  if (topLevelOnly) {
    where.parentId = null;
  } else if (parentId !== undefined) {
    where.parentId = parentId;
  }

  // Scope filter - build OR conditions for scope
  const scopeConditions: Prisma.ChartOfAccountWhereInput[] = [];

  if (includeSystem) {
    scopeConditions.push({ tenantId: null, companyId: null });
  }

  if (tenantId) {
    scopeConditions.push({ tenantId, companyId: null });
  }

  if (companyId && tenantId) {
    scopeConditions.push({ tenantId, companyId });
  }

  if (scopeConditions.length > 0) {
    if (where.OR) {
      // If there's already an OR (from search), combine with AND
      const existingOr = where.OR;
      delete where.OR;
      where.AND = [
        { OR: existingOr },
        { OR: scopeConditions },
      ];
    } else {
      where.OR = scopeConditions;
    }
  }

  // Get total count
  const total = await prisma.chartOfAccount.count({ where });

  // Get paginated results
  const accounts = await prisma.chartOfAccount.findMany({
    where,
    include: {
      parent: {
        select: { id: true, code: true, name: true },
      },
      _count: {
        select: { children: true, externalMappings: true },
      },
    },
    orderBy: { [sortBy]: sortOrder },
    skip: (page - 1) * limit,
    take: limit,
  });

  return {
    accounts: accounts.map(toAccountWithMetadata),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Get a single account by ID.
 */
export async function getAccountById(id: string): Promise<AccountWithMetadata | null> {
  const account = await prisma.chartOfAccount.findFirst({
    where: { id, deletedAt: null },
    include: {
      parent: {
        select: { id: true, code: true, name: true },
      },
      _count: {
        select: { children: true, externalMappings: true },
      },
    },
  });

  return account ? toAccountWithMetadata(account) : null;
}

/**
 * Get account by code with scope resolution.
 * Resolution order: company -> tenant -> system
 */
export async function getAccountByCode(
  code: string,
  companyId?: string | null,
  tenantId?: string | null
): Promise<AccountWithMetadata | null> {
  // Check company-level first
  if (companyId && tenantId) {
    const companyAccount = await prisma.chartOfAccount.findFirst({
      where: { code, companyId, tenantId, deletedAt: null, status: 'ACTIVE' },
      include: {
        parent: { select: { id: true, code: true, name: true } },
        _count: { select: { children: true, externalMappings: true } },
      },
    });
    if (companyAccount) return toAccountWithMetadata(companyAccount);
  }

  // Check tenant-level
  if (tenantId) {
    const tenantAccount = await prisma.chartOfAccount.findFirst({
      where: { code, tenantId, companyId: null, deletedAt: null, status: 'ACTIVE' },
      include: {
        parent: { select: { id: true, code: true, name: true } },
        _count: { select: { children: true, externalMappings: true } },
      },
    });
    if (tenantAccount) return toAccountWithMetadata(tenantAccount);
  }

  // Check system-level
  const systemAccount = await prisma.chartOfAccount.findFirst({
    where: { code, tenantId: null, companyId: null, deletedAt: null, status: 'ACTIVE' },
    include: {
      parent: { select: { id: true, code: true, name: true } },
      _count: { select: { children: true, externalMappings: true } },
    },
  });

  return systemAccount ? toAccountWithMetadata(systemAccount) : null;
}

/**
 * Resolve account by code - alias for getAccountByCode used in line item processing.
 */
export async function resolveAccount(
  code: string,
  companyId: string,
  tenantId: string
): Promise<AccountWithMetadata | null> {
  return getAccountByCode(code, companyId, tenantId);
}

/**
 * Get account hierarchy as a tree structure.
 */
export async function getAccountHierarchy(
  tenantId?: string | null,
  companyId?: string | null,
  includeSystem = true,
  accountType?: AccountType,
  status: AccountStatus = 'ACTIVE'
): Promise<AccountNode[]> {
  // Build scope conditions
  const scopeConditions: Prisma.ChartOfAccountWhereInput[] = [];

  if (includeSystem) {
    scopeConditions.push({ tenantId: null, companyId: null });
  }

  if (tenantId) {
    scopeConditions.push({ tenantId, companyId: null });
  }

  if (companyId && tenantId) {
    scopeConditions.push({ tenantId, companyId });
  }

  const where: Prisma.ChartOfAccountWhereInput = {
    deletedAt: null,
    status,
    OR: scopeConditions.length > 0 ? scopeConditions : undefined,
  };

  if (accountType) {
    where.accountType = accountType;
  }

  const allAccounts = await prisma.chartOfAccount.findMany({
    where,
    include: {
      _count: { select: { children: true, externalMappings: true } },
    },
    orderBy: [{ code: 'asc' }],
  });

  // Build tree structure
  const accountMap = new Map<string, AccountNode>();
  const rootNodes: AccountNode[] = [];

  // First pass: create all nodes
  for (const account of allAccounts) {
    const node: AccountNode = {
      ...toAccountWithMetadata(account),
      children: [],
    };
    accountMap.set(account.id, node);
  }

  // Second pass: build tree
  for (const account of allAccounts) {
    const node = accountMap.get(account.id)!;
    if (account.parentId) {
      const parent = accountMap.get(account.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // Parent not in current scope, treat as root
        rootNodes.push(node);
      }
    } else {
      rootNodes.push(node);
    }
  }

  return rootNodes;
}

/**
 * Get accounts for select dropdown (simplified output).
 * Filters out header accounts by default since they are not selectable.
 *
 * @param headersOnly - If true, only return header accounts (for parent selection)
 */
export async function getAccountsForSelect(
  tenantId?: string | null,
  companyId?: string | null,
  accountType?: AccountType,
  includeHeaders = false,
  headersOnly = false
): Promise<Array<{ id: string; code: string; name: string; accountType: AccountType }>> {
  // Build scope conditions - always include system accounts
  const scopeConditions: Prisma.ChartOfAccountWhereInput[] = [
    { tenantId: null, companyId: null },
  ];

  if (tenantId) {
    scopeConditions.push({ tenantId, companyId: null });
  }

  if (companyId && tenantId) {
    scopeConditions.push({ tenantId, companyId });
  }

  const where: Prisma.ChartOfAccountWhereInput = {
    deletedAt: null,
    status: 'ACTIVE',
    OR: scopeConditions,
  };

  if (accountType) {
    where.accountType = accountType;
  }

  // Filter header accounts based on parameters
  if (headersOnly) {
    // Only return header accounts (for parent selection)
    where.isHeader = true;
  } else if (!includeHeaders) {
    // Filter out header accounts (default behavior)
    where.isHeader = false;
  }
  // If includeHeaders is true and headersOnly is false, no filter is applied

  const accounts = await prisma.chartOfAccount.findMany({
    where,
    select: {
      id: true,
      code: true,
      name: true,
      accountType: true,
    },
    orderBy: [{ code: 'asc' }],
  });

  return accounts;
}

/**
 * Create a new account.
 */
export async function createAccount(
  data: CreateAccountInput,
  ctx: TenantAwareParams
): Promise<AccountWithMetadata> {
  const { code, name, description, accountType, parentId, sortOrder, isTaxApplicable, isHeader, tenantId, companyId } = data;

  // Validate that code is unique within scope
  const existing = await prisma.chartOfAccount.findFirst({
    where: {
      tenantId: tenantId || null,
      companyId: companyId || null,
      code,
      deletedAt: null,
    },
  });

  if (existing) {
    throw new Error(`Account code "${code}" already exists in this scope`);
  }

  // Validate parent exists if specified
  if (parentId) {
    const parent = await prisma.chartOfAccount.findFirst({
      where: { id: parentId, deletedAt: null },
    });
    if (!parent) {
      throw new Error('Parent account not found');
    }
  }

  const account = await prisma.chartOfAccount.create({
    data: {
      code,
      name,
      description: description || null,
      accountType,
      parentId: parentId || null,
      sortOrder: sortOrder ?? 0,
      isTaxApplicable: isTaxApplicable ?? true,
      isHeader: isHeader ?? false,
      tenantId: tenantId || null,
      companyId: companyId || null,
      isSystem: false,
      createdById: ctx.userId,
    },
    include: {
      parent: { select: { id: true, code: true, name: true } },
      _count: { select: { children: true, externalMappings: true } },
    },
  });

  // Audit log
  await createAuditLog({
    tenantId: tenantId || undefined,
    userId: ctx.userId,
    action: 'CHART_OF_ACCOUNTS_CREATED',
    entityType: 'ChartOfAccount',
    entityId: account.id,
    changeSource: 'MANUAL',
    metadata: {
      summary: `Created account ${code} - ${name}`,
      accountType,
      scope: getAccountScope(tenantId || null, companyId || null),
    },
  });

  log.info(`Created account: ${code} - ${name}`);

  return toAccountWithMetadata(account);
}

/**
 * Update an existing account.
 */
export async function updateAccount(
  id: string,
  data: UpdateAccountInput,
  ctx: TenantAwareParams
): Promise<AccountWithMetadata> {
  const existing = await prisma.chartOfAccount.findFirst({
    where: { id, deletedAt: null },
  });

  if (!existing) {
    throw new Error('Account not found');
  }

  // If code is being changed, validate uniqueness
  if (data.code && data.code !== existing.code) {
    const duplicate = await prisma.chartOfAccount.findFirst({
      where: {
        tenantId: existing.tenantId,
        companyId: existing.companyId,
        code: data.code,
        deletedAt: null,
        id: { not: id },
      },
    });
    if (duplicate) {
      throw new Error(`Account code "${data.code}" already exists in this scope`);
    }
  }

  // Validate parent if specified
  if (data.parentId !== undefined && data.parentId !== null) {
    if (data.parentId === id) {
      throw new Error('Account cannot be its own parent');
    }
    const parent = await prisma.chartOfAccount.findFirst({
      where: { id: data.parentId, deletedAt: null },
    });
    if (!parent) {
      throw new Error('Parent account not found');
    }
  }

  const account = await prisma.chartOfAccount.update({
    where: { id },
    data: {
      code: data.code,
      name: data.name,
      description: data.description,
      accountType: data.accountType,
      status: data.status,
      parentId: data.parentId,
      sortOrder: data.sortOrder,
      isTaxApplicable: data.isTaxApplicable,
      isHeader: data.isHeader,
    },
    include: {
      parent: { select: { id: true, code: true, name: true } },
      _count: { select: { children: true, externalMappings: true } },
    },
  });

  // Audit log
  await createAuditLog({
    tenantId: existing.tenantId || undefined,
    userId: ctx.userId,
    action: 'CHART_OF_ACCOUNTS_UPDATED',
    entityType: 'ChartOfAccount',
    entityId: account.id,
    changeSource: 'MANUAL',
    metadata: {
      summary: `Updated account ${account.code} - ${account.name}`,
      changes: data,
    },
  });

  log.info(`Updated account: ${account.code} - ${account.name}`);

  return toAccountWithMetadata(account);
}

/**
 * Soft delete an account.
 */
export async function deleteAccount(
  id: string,
  reason: string,
  ctx: TenantAwareParams
): Promise<void> {
  const account = await prisma.chartOfAccount.findFirst({
    where: { id, deletedAt: null },
    include: {
      _count: { select: { children: true } },
    },
  });

  if (!account) {
    throw new Error('Account not found');
  }

  // Prevent deletion if has children
  if (account._count.children > 0) {
    throw new Error('Cannot delete account with child accounts. Delete children first.');
  }

  await prisma.chartOfAccount.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  // Audit log
  await createAuditLog({
    tenantId: account.tenantId || undefined,
    userId: ctx.userId,
    action: 'CHART_OF_ACCOUNTS_DELETED',
    entityType: 'ChartOfAccount',
    entityId: id,
    changeSource: 'MANUAL',
    reason,
    metadata: {
      summary: `Deleted account ${account.code} - ${account.name}`,
    },
  });

  log.info(`Deleted account: ${account.code} - ${account.name}`);
}

// ============================================================================
// Account Mapping Operations
// ============================================================================

/**
 * Get all mappings for a specific account.
 */
export async function getAccountMappings(
  accountId: string,
  companyId?: string
): Promise<ChartOfAccountsMapping[]> {
  const where: Prisma.ChartOfAccountsMappingWhereInput = { accountId };
  if (companyId) {
    where.companyId = companyId;
  }

  return prisma.chartOfAccountsMapping.findMany({
    where,
    orderBy: { provider: 'asc' },
  });
}

/**
 * Get all mappings for a company, optionally filtered by provider.
 */
export async function getCompanyMappings(
  companyId: string,
  provider?: AccountingProvider
): Promise<MappingWithAccount[]> {
  const where: Prisma.ChartOfAccountsMappingWhereInput = { companyId };
  if (provider) {
    where.provider = provider;
  }

  const mappings = await prisma.chartOfAccountsMapping.findMany({
    where,
    include: {
      account: {
        select: {
          id: true,
          code: true,
          name: true,
          accountType: true,
        },
      },
    },
    orderBy: [{ account: { code: 'asc' } }],
  });

  return mappings;
}

/**
 * Create or update an account mapping.
 */
export async function upsertAccountMapping(
  data: AccountMappingInput,
  ctx: TenantAwareParams
): Promise<ChartOfAccountsMapping> {
  const { accountId, companyId, provider, externalCode, externalId, externalName } = data;

  // Verify account exists
  const account = await prisma.chartOfAccount.findFirst({
    where: { id: accountId, deletedAt: null },
  });
  if (!account) {
    throw new Error('Account not found');
  }

  // Verify company exists
  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: { tenantId: true },
  });
  if (!company) {
    throw new Error('Company not found');
  }

  // Upsert the mapping
  const mapping = await prisma.chartOfAccountsMapping.upsert({
    where: {
      accountId_companyId_provider: {
        accountId,
        companyId,
        provider,
      },
    },
    create: {
      accountId,
      companyId,
      provider,
      externalCode: externalCode || null,
      externalId: externalId || null,
      externalName: externalName || null,
      createdById: ctx.userId,
    },
    update: {
      externalCode: externalCode || null,
      externalId: externalId || null,
      externalName: externalName || null,
    },
  });

  // Audit log
  await createAuditLog({
    tenantId: company.tenantId,
    userId: ctx.userId,
    companyId,
    action: 'CHART_OF_ACCOUNTS_MAPPING_UPDATED',
    entityType: 'ChartOfAccountsMapping',
    entityId: mapping.id,
    changeSource: 'MANUAL',
    metadata: {
      summary: `Updated ${provider} mapping for account ${account.code}`,
      provider,
      externalCode,
    },
  });

  log.info(`Upserted mapping for account ${account.code} to ${provider}: ${externalCode}`);

  return mapping;
}

/**
 * Delete an account mapping.
 */
export async function deleteAccountMapping(
  mappingId: string,
  ctx: TenantAwareParams
): Promise<void> {
  const mapping = await prisma.chartOfAccountsMapping.findUnique({
    where: { id: mappingId },
    include: {
      account: { select: { code: true, name: true } },
      company: { select: { tenantId: true } },
    },
  });

  if (!mapping) {
    throw new Error('Mapping not found');
  }

  await prisma.chartOfAccountsMapping.delete({
    where: { id: mappingId },
  });

  // Audit log
  await createAuditLog({
    tenantId: mapping.company.tenantId,
    userId: ctx.userId,
    companyId: mapping.companyId,
    action: 'CHART_OF_ACCOUNTS_MAPPING_DELETED',
    entityType: 'ChartOfAccountsMapping',
    entityId: mappingId,
    changeSource: 'MANUAL',
    metadata: {
      summary: `Deleted ${mapping.provider} mapping for account ${mapping.account.code}`,
      provider: mapping.provider,
    },
  });

  log.info(`Deleted mapping ${mappingId} for account ${mapping.account.code}`);
}

/**
 * Bulk upsert mappings for a company.
 */
export async function bulkUpsertMappings(
  data: BulkMappingInput,
  ctx: TenantAwareParams
): Promise<{ created: number; updated: number }> {
  const { companyId, provider, mappings } = data;

  // Verify company exists
  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: { tenantId: true },
  });
  if (!company) {
    throw new Error('Company not found');
  }

  let created = 0;
  let updated = 0;

  for (const mapping of mappings) {
    const existing = await prisma.chartOfAccountsMapping.findUnique({
      where: {
        accountId_companyId_provider: {
          accountId: mapping.accountId,
          companyId,
          provider,
        },
      },
    });

    if (existing) {
      await prisma.chartOfAccountsMapping.update({
        where: { id: existing.id },
        data: {
          externalCode: mapping.externalCode || null,
          externalId: mapping.externalId || null,
          externalName: mapping.externalName || null,
        },
      });
      updated++;
    } else {
      await prisma.chartOfAccountsMapping.create({
        data: {
          accountId: mapping.accountId,
          companyId,
          provider,
          externalCode: mapping.externalCode || null,
          externalId: mapping.externalId || null,
          externalName: mapping.externalName || null,
          createdById: ctx.userId,
        },
      });
      created++;
    }
  }

  // Audit log
  await createAuditLog({
    tenantId: company.tenantId,
    userId: ctx.userId,
    companyId,
    action: 'CHART_OF_ACCOUNTS_MAPPING_UPDATED',
    entityType: 'ChartOfAccountsMapping',
    entityId: companyId,
    changeSource: 'MANUAL',
    metadata: {
      summary: `Bulk updated ${provider} mappings: ${created} created, ${updated} updated`,
      provider,
      created,
      updated,
    },
  });

  log.info(`Bulk upserted ${created + updated} mappings for company ${companyId}`);

  return { created, updated };
}
