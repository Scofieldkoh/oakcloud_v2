'use client';

import { cn } from '@/lib/utils';
import {
  Wallet,
  CreditCard,
  PiggyBank,
  TrendingUp,
  TrendingDown,
  Globe,
  Building2,
  Building,
} from 'lucide-react';
import type { AccountType, AccountStatus } from '@/generated/prisma';

// ============================================================================
// Account Type Badge
// ============================================================================

const accountTypeConfig: Record<
  AccountType,
  { label: string; color: string; Icon: typeof Wallet }
> = {
  ASSET: {
    label: 'Asset',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    Icon: Wallet,
  },
  LIABILITY: {
    label: 'Liability',
    color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    Icon: CreditCard,
  },
  EQUITY: {
    label: 'Equity',
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    Icon: PiggyBank,
  },
  REVENUE: {
    label: 'Revenue',
    color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    Icon: TrendingUp,
  },
  EXPENSE: {
    label: 'Expense',
    color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    Icon: TrendingDown,
  },
};

interface AccountTypeBadgeProps {
  type: AccountType;
  showIcon?: boolean;
  size?: 'sm' | 'md';
}

export function AccountTypeBadge({ type, showIcon = true, size = 'sm' }: AccountTypeBadgeProps) {
  const config = accountTypeConfig[type];
  const Icon = config.Icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        config.color
      )}
    >
      {showIcon && <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} />}
      {config.label}
    </span>
  );
}

// ============================================================================
// Account Status Badge
// ============================================================================

const accountStatusConfig: Record<AccountStatus, { label: string; color: string }> = {
  ACTIVE: {
    label: 'Active',
    color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  },
  INACTIVE: {
    label: 'Inactive',
    color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
  },
  ARCHIVED: {
    label: 'Archived',
    color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  },
};

interface AccountStatusBadgeProps {
  status: AccountStatus;
  size?: 'sm' | 'md';
}

export function AccountStatusBadge({ status, size = 'sm' }: AccountStatusBadgeProps) {
  const config = accountStatusConfig[status];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        config.color
      )}
    >
      {config.label}
    </span>
  );
}

// ============================================================================
// Account Scope Badge
// ============================================================================

interface AccountScopeBadgeProps {
  tenantId: string | null;
  companyId: string | null;
  isSystem?: boolean;
  size?: 'sm' | 'md';
}

export function AccountScopeBadge({
  tenantId,
  companyId,
  isSystem,
  size = 'sm',
}: AccountScopeBadgeProps) {
  let label: string;
  let color: string;
  let Icon: typeof Globe;

  if (isSystem || (!tenantId && !companyId)) {
    label = 'System';
    color = 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
    Icon = Globe;
  } else if (tenantId && !companyId) {
    label = 'Tenant';
    color = 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    Icon = Building2;
  } else {
    label = 'Company';
    color = 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300';
    Icon = Building;
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        color
      )}
    >
      <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} />
      {label}
    </span>
  );
}
