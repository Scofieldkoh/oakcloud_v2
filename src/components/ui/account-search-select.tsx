'use client';

import { useState, useEffect } from 'react';
import { Hash } from 'lucide-react';
import { useChartOfAccounts, type ChartOfAccount } from '@/hooks/use-chart-of-accounts';
import { AsyncSearchSelect, type AsyncSearchSelectOption } from './async-search-select';

// Extend the base option interface with Account-specific fields
interface AccountOption extends AsyncSearchSelectOption {
  code: string;
  accountType: string;
  account: ChartOfAccount;
}

interface AccountSearchSelectProps {
  label?: string;
  /** Currently selected account code */
  value: string;
  /** Callback when selection changes - returns account code (not ID) */
  onChange: (accountCode: string, account: ChartOfAccount | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Tenant ID for scoping (for super admins) */
  tenantId?: string | null;
  /** Company ID for scoping */
  companyId?: string | null;
}

export function AccountSearchSelect({
  label,
  value,
  onChange,
  placeholder = 'Search accounts...',
  disabled = false,
  className,
  tenantId,
  companyId,
}: AccountSearchSelectProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch accounts with server-side search
  const { data: accountsData, isLoading, error, refetch } = useChartOfAccounts({
    search: debouncedQuery || undefined,
    tenantId: tenantId ?? undefined,
    companyId: companyId ?? undefined,
    limit: 50,
    sortBy: 'code',
    sortOrder: 'asc',
    status: 'ACTIVE',
  });

  // Transform accounts to options format
  // Note: Using code as id since that's how accounts are referenced in line items
  const options: AccountOption[] = (accountsData?.accounts || []).map((account) => ({
    id: account.code, // Use code as the identifier
    label: account.name,
    description: `${account.code} • ${account.accountType}`,
    code: account.code,
    accountType: account.accountType,
    account,
  }));

  const handleChange = (code: string, option: AccountOption | null) => {
    onChange(code, option?.account || null);
  };

  return (
    <AsyncSearchSelect<AccountOption>
      label={label}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      options={options}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      icon={<Hash className="w-4 h-4" />}
      emptySearchText="Type to search accounts"
      noResultsText="No accounts match your search"
      error={error ? "Couldn't load accounts." : undefined}
      onRetry={() => void refetch()}
    />
  );
}
