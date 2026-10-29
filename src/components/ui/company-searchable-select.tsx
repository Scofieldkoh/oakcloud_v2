'use client';

import { useMemo } from 'react';
import { SearchableSelect, type SelectOption } from './searchable-select';

interface CompanySearchableSelectCompany {
  id: string;
  name: string;
  uen?: string | null;
}

interface CompanySearchableSelectProps {
  companies: CompanySearchableSelectCompany[];
  value: string;
  onChange: (companyId: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  containerClassName?: string;
  size?: 'sm' | 'md' | 'lg';
  clearable?: boolean;
  variant?: 'default' | 'table-filter';
}

/**
 * Picks from a fixed list the caller already has, such as the companies that
 * have e-signing envelopes. To choose any company in the workspace, use
 * `CompanySelect`, which searches the server and is not capped at one page.
 * Displays company name as label and UEN as description when available.
 */
export function CompanySearchableSelect({
  companies,
  value,
  onChange,
  placeholder = 'Search companies...',
  label,
  disabled = false,
  loading = false,
  className,
  containerClassName,
  size = 'sm',
  clearable = true,
  variant = 'default',
}: CompanySearchableSelectProps) {
  const options = useMemo<SelectOption[]>(
    () =>
      companies.map((company) => ({
        value: company.id,
        label: company.name,
        description: company.uen || undefined,
      })),
    [companies]
  );

  return (
    <SearchableSelect
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      label={label}
      disabled={disabled}
      loading={loading}
      className={className}
      containerClassName={containerClassName}
      size={size}
      variant={variant}
      clearable={clearable}
    />
  );
}

export default CompanySearchableSelect;
