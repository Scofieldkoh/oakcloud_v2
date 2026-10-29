'use client';

import { Search, Filter, X, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ContactType, IdentificationType } from '@/generated/prisma';

interface ContactFiltersProps {
  onSearch: (query: string) => void;
  onFilterChange: (filters: FilterValues) => void;
  initialFilters?: FilterValues;
  initialQuery?: string;
  searchInputId?: string;
}

export interface FilterValues {
  contactType?: ContactType;
  // Extended filters for mobile
  fullName?: string;
  identificationType?: IdentificationType;
  identificationNumber?: string;
  nationality?: string;
  email?: string;
  phone?: string;
  companiesMin?: number;
  companiesMax?: number;
}

const contactTypes: { value: ContactType; label: string }[] = [
  { value: 'INDIVIDUAL', label: 'Individual' },
  { value: 'CORPORATE', label: 'Corporate' },
];

const idTypes: { value: IdentificationType; label: string }[] = [
  { value: 'NRIC', label: 'NRIC' },
  { value: 'FIN', label: 'FIN' },
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'UEN', label: 'UEN' },
  { value: 'OTHER', label: 'Other' },
];

export function ContactFilters({
  onSearch,
  onFilterChange,
  initialFilters,
  initialQuery = '',
  searchInputId,
}: ContactFiltersProps) {
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
            placeholder="Search by name, email, ID number, UEN, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input input-sm pl-10"
            aria-label="Search contacts"
            title="Focus search (Ctrl/Cmd+K)"
          />
        </form>
        {/* Filter button - only show on mobile/tablet, hidden on desktop where inline filters are available */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
          aria-controls="contact-filter-panel"
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
        <div id="contact-filter-panel" className="card animate-fade-in lg:hidden">
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
            {/* Name */}
            <div>
              <label className="label">Name</label>
              <input
                type="text"
                value={filters.fullName || ''}
                onChange={(e) => handleFilterChange('fullName', e.target.value || undefined)}
                placeholder="Search name..."
                className="input input-sm"
              />
            </div>

            {/* Contact Type */}
            <div>
              <label className="label">Contact Type</label>
              <select
                value={filters.contactType || ''}
                onChange={(e) => handleFilterChange('contactType', e.target.value as ContactType)}
                className="input input-sm"
              >
                <option value="">All types</option>
                {contactTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {/* ID Type */}
            <div>
              <label className="label">ID Type</label>
              <select
                value={filters.identificationType || ''}
                onChange={(e) => handleFilterChange('identificationType', e.target.value as IdentificationType)}
                className="input input-sm"
              >
                <option value="">All types</option>
                {idTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {/* ID Number */}
            <div>
              <label className="label">ID Number</label>
              <input
                type="text"
                value={filters.identificationNumber || ''}
                onChange={(e) => handleFilterChange('identificationNumber', e.target.value || undefined)}
                placeholder="Search ID number..."
                className="input input-sm"
              />
            </div>

            {/* Nationality */}
            <div>
              <label className="label">Nationality</label>
              <input
                type="text"
                value={filters.nationality || ''}
                onChange={(e) => handleFilterChange('nationality', e.target.value || undefined)}
                placeholder="Search nationality..."
                className="input input-sm"
              />
            </div>

            {/* Email */}
            <div>
              <label className="label">Email</label>
              <input
                type="text"
                value={filters.email || ''}
                onChange={(e) => handleFilterChange('email', e.target.value || undefined)}
                placeholder="Search email..."
                className="input input-sm"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="label">Phone</label>
              <input
                type="text"
                value={filters.phone || ''}
                onChange={(e) => handleFilterChange('phone', e.target.value || undefined)}
                placeholder="Search phone..."
                className="input input-sm"
              />
            </div>

            {/* Companies Range */}
            <div>
              <label className="label">Companies (Min)</label>
              <input
                type="number"
                min="0"
                value={filters.companiesMin ?? ''}
                onChange={(e) => handleFilterChange('companiesMin', e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="Min"
                className="input input-sm"
              />
            </div>
            <div>
              <label className="label">Companies (Max)</label>
              <input
                type="number"
                min="0"
                value={filters.companiesMax ?? ''}
                onChange={(e) => handleFilterChange('companiesMax', e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="Max"
                className="input input-sm"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
