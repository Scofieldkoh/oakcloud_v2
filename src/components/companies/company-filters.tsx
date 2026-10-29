'use client';

import { Search, Filter, X, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CompanyStatus, EntityType } from '@/generated/prisma';
import { ENTITY_TYPES } from '@/lib/constants';
import { SUPPORTED_CURRENCIES } from '@/lib/validations/exchange-rate';

interface CompanyFiltersProps {
  onSearch: (query: string) => void;
  onFilterChange: (filters: FilterValues) => void;
  initialFilters?: FilterValues;
  initialQuery?: string;
  searchInputId?: string;
}

export interface FilterValues {
  entityType?: EntityType;
  status?: CompanyStatus;
  hasCharges?: boolean;
  financialYearEndMonth?: number;
  // Extended filters for mobile
  address?: string;
  homeCurrency?: string;
  hasWarnings?: boolean;
  incorporationDateFrom?: string;
  incorporationDateTo?: string;
  officersMin?: number;
  officersMax?: number;
  shareholdersMin?: number;
  shareholdersMax?: number;
  paidUpCapitalMin?: number;
  paidUpCapitalMax?: number;
  issuedCapitalMin?: number;
  issuedCapitalMax?: number;
}

const statuses: { value: CompanyStatus; label: string }[] = [
  { value: 'LIVE', label: 'Live' },
  { value: 'STRUCK_OFF', label: 'Struck Off' },
  { value: 'WINDING_UP', label: 'Winding Up' },
  { value: 'DISSOLVED', label: 'Dissolved' },
  { value: 'IN_LIQUIDATION', label: 'In Liquidation' },
  { value: 'IN_RECEIVERSHIP', label: 'In Receivership' },
];

const months = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

export function CompanyFilters({
  onSearch,
  onFilterChange,
  initialFilters,
  initialQuery = '',
  searchInputId,
}: CompanyFiltersProps) {
  const [searchQuery, setSearchQuery] = useState(initialQuery);

  // Follow outside changes, such as Clear filters or a restored URL.
  useEffect(() => setSearchQuery(initialQuery), [initialQuery]);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterValues>(initialFilters || {});

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchQuery);
  };

  const handleFilterChange = (key: keyof FilterValues, value: unknown) => {
    const newFilters = { ...filters, [key]: value || undefined };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const clearFilters = () => {
    setFilters({});
    onFilterChange({});
  };

  return (
    <div className="space-y-3">
      {/* Search and Filter Toggle */}
      <div className="flex items-center gap-3">
        <form onSubmit={handleSearch} className="flex-1 relative" role="search">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" aria-hidden="true" />
          <input
            type="text"
            id={searchInputId}
            placeholder="Search by name, UEN, SSIC, officer, shareholder, address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input input-sm pl-10"
            aria-label="Search companies"
            title="Focus search (Ctrl/Cmd+K)"
          />
        </form>
        {/* Filter button - only show on mobile/tablet, hidden on desktop where inline filters are available */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
          aria-controls="company-filter-panel"
          aria-label={`${showFilters ? 'Hide' : 'Show'} filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
          className={`lg:hidden btn-secondary btn-sm flex items-center gap-2 ${
            activeFilterCount > 0 ? 'border-oak-primary' : ''
          }`}
        >
          <Filter className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <span className="bg-oak-primary text-white text-2xs px-1.5 py-0.5 rounded-full min-w-[18px] text-center" aria-hidden="true">
              {activeFilterCount}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${showFilters ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Filter Panel - Mobile only */}
      {showFilters && (
        <div id="company-filter-panel" className="card animate-fade-in lg:hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-text-primary">Filters</h3>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="btn-ghost btn-xs flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
                aria-label="Clear all filters"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Address */}
            <div>
              <label className="label">Address</label>
              <input
                type="text"
                value={filters.address || ''}
                onChange={(e) => handleFilterChange('address', e.target.value || undefined)}
                placeholder="Search address..."
                className="input input-sm"
              />
            </div>

            {/* Entity Type */}
            <div>
              <label className="label">Entity Type</label>
              <select
                value={filters.entityType || ''}
                onChange={(e) =>
                  handleFilterChange('entityType', e.target.value as EntityType)
                }
                className="input input-sm"
              >
                <option value="">All types</option>
                {ENTITY_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.shortLabel}
                  </option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="label">Status</label>
              <select
                value={filters.status || ''}
                onChange={(e) =>
                  handleFilterChange('status', e.target.value as CompanyStatus)
                }
                className="input input-sm"
              >
                <option value="">All statuses</option>
                {statuses.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Currency */}
            <div>
              <label className="label">Currency</label>
              <select
                value={filters.homeCurrency || ''}
                onChange={(e) => handleFilterChange('homeCurrency', e.target.value || undefined)}
                className="input input-sm"
              >
                <option value="">All currencies</option>
                {SUPPORTED_CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>

            {/* Financial Year End */}
            <div>
              <label className="label">FYE Month</label>
              <select
                value={filters.financialYearEndMonth || ''}
                onChange={(e) =>
                  handleFilterChange(
                    'financialYearEndMonth',
                    e.target.value ? parseInt(e.target.value) : undefined
                  )
                }
                className="input input-sm"
              >
                <option value="">All months</option>
                {months.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Has Warnings */}
            <div>
              <label className="label">Warnings</label>
              <select
                value={filters.hasWarnings === undefined ? '' : filters.hasWarnings.toString()}
                onChange={(e) =>
                  handleFilterChange(
                    'hasWarnings',
                    e.target.value === '' ? undefined : e.target.value === 'true'
                  )
                }
                className="input input-sm"
              >
                <option value="">All companies</option>
                <option value="true">With warnings</option>
                <option value="false">Without warnings</option>
              </select>
            </div>

            {/* Incorporation Date From */}
            <div>
              <label className="label">Incorporated From</label>
              <input
                type="date"
                value={filters.incorporationDateFrom || ''}
                onChange={(e) => handleFilterChange('incorporationDateFrom', e.target.value || undefined)}
                className="input input-sm"
              />
            </div>

            {/* Incorporation Date To */}
            <div>
              <label className="label">Incorporated To</label>
              <input
                type="date"
                value={filters.incorporationDateTo || ''}
                onChange={(e) => handleFilterChange('incorporationDateTo', e.target.value || undefined)}
                className="input input-sm"
              />
            </div>

            {/* Officers Range */}
            <div>
              <label className="label">Officers (Min)</label>
              <input
                type="number"
                min="0"
                value={filters.officersMin ?? ''}
                onChange={(e) => handleFilterChange('officersMin', e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="Min"
                className="input input-sm"
              />
            </div>
            <div>
              <label className="label">Officers (Max)</label>
              <input
                type="number"
                min="0"
                value={filters.officersMax ?? ''}
                onChange={(e) => handleFilterChange('officersMax', e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="Max"
                className="input input-sm"
              />
            </div>

            {/* Shareholders Range */}
            <div>
              <label className="label">Shareholders (Min)</label>
              <input
                type="number"
                min="0"
                value={filters.shareholdersMin ?? ''}
                onChange={(e) => handleFilterChange('shareholdersMin', e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="Min"
                className="input input-sm"
              />
            </div>
            <div>
              <label className="label">Shareholders (Max)</label>
              <input
                type="number"
                min="0"
                value={filters.shareholdersMax ?? ''}
                onChange={(e) => handleFilterChange('shareholdersMax', e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="Max"
                className="input input-sm"
              />
            </div>

            {/* Paid-up Capital Range */}
            <div>
              <label className="label">Paid-up Capital (Min)</label>
              <input
                type="number"
                min="0"
                value={filters.paidUpCapitalMin ?? ''}
                onChange={(e) => handleFilterChange('paidUpCapitalMin', e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="Min amount"
                className="input input-sm"
              />
            </div>
            <div>
              <label className="label">Paid-up Capital (Max)</label>
              <input
                type="number"
                min="0"
                value={filters.paidUpCapitalMax ?? ''}
                onChange={(e) => handleFilterChange('paidUpCapitalMax', e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="Max amount"
                className="input input-sm"
              />
            </div>

            {/* Issued Capital Range */}
            <div>
              <label className="label">Issued Capital (Min)</label>
              <input
                type="number"
                min="0"
                value={filters.issuedCapitalMin ?? ''}
                onChange={(e) => handleFilterChange('issuedCapitalMin', e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="Min amount"
                className="input input-sm"
              />
            </div>
            <div>
              <label className="label">Issued Capital (Max)</label>
              <input
                type="number"
                min="0"
                value={filters.issuedCapitalMax ?? ''}
                onChange={(e) => handleFilterChange('issuedCapitalMax', e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="Max amount"
                className="input input-sm"
              />
            </div>

            {/* Has Charges */}
            <div>
              <label className="label">Charges</label>
              <select
                value={filters.hasCharges === undefined ? '' : filters.hasCharges.toString()}
                onChange={(e) =>
                  handleFilterChange(
                    'hasCharges',
                    e.target.value === '' ? undefined : e.target.value === 'true'
                  )
                }
                className="input input-sm"
              >
                <option value="">All companies</option>
                <option value="true">With charges</option>
                <option value="false">Without charges</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
