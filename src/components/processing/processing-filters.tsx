'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Search, Filter, X, ChevronDown, Tag, Calendar, Eye, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DatePicker, type DatePickerValue } from '@/components/ui/date-picker';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import { CompanySelect } from '@/components/ui/company-select';
import { FilterChip } from '@/components/ui/filter-chip';
import { TagChip, TagManager } from '@/components/processing/document-tags';
import { TAG_COLORS } from '@/lib/validations/document-tag';
import { SUPPORTED_CURRENCIES } from '@/lib/validations/exchange-rate';
import type { PipelineStatus, DuplicateStatus, RevisionStatus, TagColor, DocumentCategory, DocumentSubCategory } from '@/generated/prisma';
import type { AmountFilterValue } from '@/components/ui/amount-filter';

// Tag info type for filter display
export interface TagInfo {
  id: string;
  name: string;
  color: TagColor;
}

// Filter value types
export interface ProcessingFilterValues {
  pipelineStatus?: PipelineStatus;
  duplicateStatus?: DuplicateStatus;
  revisionStatus?: RevisionStatus;
  needsReview?: boolean;
  isContainer?: boolean;
  companyId?: string;
  uploadDatePreset?: 'TODAY';
  uploadDateFrom?: string;
  uploadDateTo?: string;
  documentDateFrom?: string;
  documentDateTo?: string;
  vendorName?: string;
  documentNumber?: string;
  fileName?: string;
  documentCategory?: DocumentCategory;
  documentSubCategory?: DocumentSubCategory;
  tagIds?: string[];
  // Currency filters
  currency?: string;
  homeCurrency?: string;
  // Amount filters
  subtotalFilter?: AmountFilterValue;
  taxFilter?: AmountFilterValue;
  totalFilter?: AmountFilterValue;
  homeSubtotalFilter?: AmountFilterValue;
  homeTaxFilter?: AmountFilterValue;
  homeTotalFilter?: AmountFilterValue;
  // Pagination
  page?: number;
  limit?: number;
}

interface ProcessingFiltersProps {
  onFilterChange: (filters: ProcessingFilterValues) => void;
  initialFilters?: ProcessingFilterValues;
  tags?: TagInfo[];
  onSearchChange?: (query: string) => void;
  initialSearch?: string;
  /** Company ID for tag management (from sidebar or filter) */
  activeCompanyId?: string;
  /** Tenant ID for tag management (for super admins) */
  activeTenantId?: string;
  /** Optional right-side toolbar actions (e.g., Adjust columns) */
  rightActions?: React.ReactNode;
}

// Status configurations
const PIPELINE_STATUS_OPTIONS: SelectOption[] = [
  { value: 'UPLOADED', label: 'Uploaded' },
  { value: 'QUEUED', label: 'Queued' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'SPLIT_PENDING', label: 'Split Pending' },
  { value: 'SPLIT_DONE', label: 'Split Done' },
  { value: 'EXTRACTION_DONE', label: 'Extracted' },
  { value: 'FAILED_RETRYABLE', label: 'Failed (Retry)' },
  { value: 'FAILED_PERMANENT', label: 'Failed' },
  { value: 'DEAD_LETTER', label: 'Dead Letter' },
];

const REVISION_STATUS_OPTIONS: SelectOption[] = [
  { value: 'DRAFT', label: 'Pending Review' },
  { value: 'APPROVED', label: 'Approved' },
];

const DUPLICATE_STATUS_OPTIONS: SelectOption[] = [
  { value: 'NONE', label: 'None' },
  { value: 'SUSPECTED', label: 'Suspected' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'REJECTED', label: 'Not Duplicate' },
];

const DOCUMENT_TYPE_OPTIONS: SelectOption[] = [
  { value: 'true', label: 'Containers Only' },
  { value: 'false', label: 'Children Only' },
];

export function ProcessingFilters({
  onFilterChange,
  initialFilters = {},
  tags = [],
  onSearchChange,
  initialSearch = '',
  activeCompanyId,
  activeTenantId,
  rightActions,
}: ProcessingFiltersProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<ProcessingFilterValues>(initialFilters);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [companyName, setCompanyName] = useState('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Serialize initialFilters for comparison to avoid object reference issues
  const initialFiltersKey = useMemo(() => JSON.stringify(initialFilters), [initialFilters]);

  // Sync filters with initialFilters prop changes (e.g., URL navigation / browser back)
  // Only sync when the serialized value actually changes
  useEffect(() => {
    setFilters(JSON.parse(initialFiltersKey));
  }, [initialFiltersKey]);

  // Sync search with initialSearch prop changes
  useEffect(() => {
    setSearchQuery(initialSearch);
  }, [initialSearch]);

  // Debounced search handler (300ms)
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      onSearchChange?.(value);
    }, 300);
  }, [onSearchChange]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Note: tags are displayed directly as chips in the filter section, not as SelectOptions

  // Count active filters (including search)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (searchQuery.trim()) count++;
    if (filters.needsReview) count++;
    if (filters.pipelineStatus) count++;
    if (filters.duplicateStatus) count++;
    if (filters.revisionStatus) count++;
    if (filters.isContainer !== undefined) count++;
    if (filters.companyId) count++;
    if (filters.uploadDatePreset) count++;
    if (filters.uploadDateFrom || filters.uploadDateTo) count++;
    if (filters.documentDateFrom || filters.documentDateTo) count++;
    if (filters.vendorName) count++;
    if (filters.documentNumber) count++;
    if (filters.fileName) count++;
    if (filters.currency) count++;
    if (filters.homeCurrency) count++;
    if (filters.tagIds && filters.tagIds.length > 0) count += filters.tagIds.length;
    return count;
  }, [filters, searchQuery]);

  const handleFilterChange = useCallback((key: keyof ProcessingFilterValues, value: unknown) => {
    const newFilters = { ...filters, [key]: value || undefined };
    setFilters(newFilters);
    onFilterChange(newFilters);
  }, [filters, onFilterChange]);

  const clearFilter = useCallback((key: keyof ProcessingFilterValues) => {
    const newFilters = { ...filters };
    delete newFilters[key];
    setFilters(newFilters);
    onFilterChange(newFilters);
  }, [filters, onFilterChange]);

  const clearAllFilters = useCallback(() => {
    setFilters({});
    onFilterChange({});
    // Also clear search
    setSearchQuery('');
    onSearchChange?.('');
  }, [onFilterChange, onSearchChange]);

  // Date picker value conversion helpers
  const toDateOnly = useCallback((date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  const toLocalDate = useCallback((value: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split('-').map((v) => parseInt(v, 10));
      return new Date(y, m - 1, d);
    }
    return new Date(value);
  }, []);

  const toggleUploadedToday = useCallback(() => {
    const today = toDateOnly(new Date());
    const next = { ...filters };
    if (next.uploadDateFrom === today && next.uploadDateTo === today) {
      delete next.uploadDateFrom;
      delete next.uploadDateTo;
      delete next.uploadDatePreset;
    } else {
      next.uploadDateFrom = today;
      next.uploadDateTo = today;
      delete next.uploadDatePreset;
    }
    setFilters(next);
    onFilterChange(next);
  }, [filters, onFilterChange, toDateOnly]);

  const toggleNeedsReview = useCallback(() => {
    const next = { ...filters };
    if (next.needsReview) {
      delete next.needsReview;
    } else {
      next.needsReview = true;
      delete next.revisionStatus;
      delete next.duplicateStatus;
    }
    setFilters(next);
    onFilterChange(next);
  }, [filters, onFilterChange]);

  const toggleSuspectedDuplicate = useCallback(() => {
    const next = { ...filters };
    if (next.duplicateStatus === 'SUSPECTED') {
      delete next.duplicateStatus;
    } else {
      next.duplicateStatus = 'SUSPECTED';
      delete next.needsReview;
    }
    setFilters(next);
    onFilterChange(next);
  }, [filters, onFilterChange]);

  const uploadDateValue: DatePickerValue | undefined = useMemo(() => {
    if (filters.uploadDateFrom || filters.uploadDateTo) {
      return {
        mode: 'range' as const,
        range: {
          from: filters.uploadDateFrom ? toLocalDate(filters.uploadDateFrom) : undefined,
          to: filters.uploadDateTo ? toLocalDate(filters.uploadDateTo) : undefined,
        },
      };
    }
    return undefined;
  }, [filters.uploadDateFrom, filters.uploadDateTo, toLocalDate]);

  const documentDateValue: DatePickerValue | undefined = useMemo(() => {
    if (filters.documentDateFrom || filters.documentDateTo) {
      return {
        mode: 'range' as const,
        range: {
          from: filters.documentDateFrom ? toLocalDate(filters.documentDateFrom) : undefined,
          to: filters.documentDateTo ? toLocalDate(filters.documentDateTo) : undefined,
        },
      };
    }
    return undefined;
  }, [filters.documentDateFrom, filters.documentDateTo, toLocalDate]);

  const handleUploadDateChange = useCallback((value: DatePickerValue | undefined) => {
    const newFilters = { ...filters };
    if (!value || value.mode !== 'range' || !value.range) {
      delete newFilters.uploadDateFrom;
      delete newFilters.uploadDateTo;
    } else {
      delete newFilters.uploadDatePreset;
      newFilters.uploadDateFrom = value.range.from ? toDateOnly(value.range.from) : undefined;
      newFilters.uploadDateTo = value.range.to ? toDateOnly(value.range.to) : undefined;
    }
    setFilters(newFilters);
    onFilterChange(newFilters);
  }, [filters, onFilterChange, toDateOnly]);

  const handleDocumentDateChange = useCallback((value: DatePickerValue | undefined) => {
    const newFilters = { ...filters };
    if (!value || value.mode !== 'range' || !value.range) {
      delete newFilters.documentDateFrom;
      delete newFilters.documentDateTo;
    } else {
      newFilters.documentDateFrom = value.range.from ? toDateOnly(value.range.from) : undefined;
      newFilters.documentDateTo = value.range.to ? toDateOnly(value.range.to) : undefined;
    }
    setFilters(newFilters);
    onFilterChange(newFilters);
  }, [filters, onFilterChange, toDateOnly]);

  // Handle tag filter toggle
  const handleTagToggle = useCallback((tagId: string) => {
    const currentTags = filters.tagIds || [];
    const newTags = currentTags.includes(tagId)
      ? currentTags.filter(id => id !== tagId)
      : [...currentTags, tagId];

    const newFilters = { ...filters, tagIds: newTags.length > 0 ? newTags : undefined };
    setFilters(newFilters);
    onFilterChange(newFilters);
  }, [filters, onFilterChange]);

  // Remove a single tag from filter
  const removeTagFilter = useCallback((tagId: string) => {
    const currentTags = filters.tagIds || [];
    const newTags = currentTags.filter(id => id !== tagId);
    const newFilters = { ...filters, tagIds: newTags.length > 0 ? newTags : undefined };
    setFilters(newFilters);
    onFilterChange(newFilters);
  }, [filters, onFilterChange]);

  // Format date for display
  const formatDateDisplay = (dateStr: string | undefined) => {
    if (!dateStr) return '...';
    return toLocalDate(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const isUploadedTodayActive = useMemo(() => {
    if (filters.uploadDatePreset === 'TODAY') return true;
    const today = toDateOnly(new Date());
    return filters.uploadDateFrom === today && filters.uploadDateTo === today;
  }, [filters.uploadDateFrom, filters.uploadDatePreset, filters.uploadDateTo, toDateOnly]);

  return (
    <div className="space-y-2">
      {/* Compact toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by file name, vendor, document number..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="input input-sm pl-10 w-full !text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 hover:bg-background-tertiary rounded"
            >
              <X className="w-3.5 h-3.5 text-text-muted" />
            </button>
          )}
        </div>

        {/* Quick Filters (icon-only) */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleUploadedToday}
            className={cn('btn-ghost btn-xs p-2', isUploadedTodayActive && 'bg-background-tertiary')}
            title="Uploaded today"
          >
            <Calendar className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={toggleNeedsReview}
            className={cn('btn-ghost btn-xs p-2', !!filters.needsReview && 'bg-background-tertiary')}
            title="Needs review (draft, suspected duplicate, warnings/invalid)"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={toggleSuspectedDuplicate}
            className={cn('btn-ghost btn-xs p-2', filters.duplicateStatus === 'SUSPECTED' && 'bg-background-tertiary')}
            title="Suspected duplicates"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
          className={cn(
            'btn-secondary btn-sm flex items-center gap-2',
            activeFilterCount > 0 && 'border-oak-primary'
          )}
        >
          <Filter className="w-4 h-4" />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <span className="bg-oak-primary text-white text-2xs px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {activeFilterCount}
            </span>
          )}
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFilters && 'rotate-180')} />
        </button>

        {rightActions}
      </div>

      {/* Expandable Filter Panel */}
      {showFilters && (
        <div className="card animate-fade-in">
          <h3 className="text-sm font-medium text-text-primary mb-4">Filters</h3>

          {/* Filter Grid - Responsive layout */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Row 1: Status Filters */}
            <div>
              <label className="label">Pipeline Status</label>
              <SearchableSelect
                options={PIPELINE_STATUS_OPTIONS}
                value={filters.pipelineStatus || ''}
                onChange={(v) => handleFilterChange('pipelineStatus', v as PipelineStatus)}
                placeholder="All Statuses"
                size="sm"
              />
            </div>

            <div>
              <label className="label">Review Status</label>
              <SearchableSelect
                options={REVISION_STATUS_OPTIONS}
                value={filters.revisionStatus || ''}
                onChange={(v) => handleFilterChange('revisionStatus', v as RevisionStatus)}
                placeholder="All"
                size="sm"
              />
            </div>

            <div>
              <label className="label">Duplicate Status</label>
              <SearchableSelect
                options={DUPLICATE_STATUS_OPTIONS}
                value={filters.duplicateStatus || ''}
                onChange={(v) => handleFilterChange('duplicateStatus', v as DuplicateStatus)}
                placeholder="All"
                size="sm"
              />
            </div>

            <div>
              <label className="label">Document Type</label>
              <SearchableSelect
                options={DOCUMENT_TYPE_OPTIONS}
                value={filters.isContainer === undefined ? '' : filters.isContainer.toString()}
                onChange={(v) => handleFilterChange('isContainer', v === '' ? undefined : v === 'true')}
                placeholder="All Types"
                size="sm"
              />
            </div>

            {/* Row 2: Company & Date Filters */}
            <div>
              <label className="label">Company</label>
              <CompanySelect
                value={filters.companyId || ''}
                onChange={(id, company) => {
                  handleFilterChange('companyId', id);
                  setCompanyName(company?.name ?? '');
                }}
                placeholder="Search companies..."
              />
            </div>

            <div>
              <label className="label">Upload Date</label>
              <DatePicker
                value={uploadDateValue}
                onChange={handleUploadDateChange}
                placeholder="Select range"
                size="sm"
              />
            </div>

            <div>
              <label className="label">Document Date</label>
              <DatePicker
                value={documentDateValue}
                onChange={handleDocumentDateChange}
                placeholder="Select range"
                size="sm"
              />
            </div>

            {/* Row 3: Text Filters */}
            <div>
              <label className="label">Vendor Name</label>
              <input
                type="text"
                value={filters.vendorName || ''}
                onChange={(e) => handleFilterChange('vendorName', e.target.value)}
                placeholder="Filter by vendor..."
                className="input input-sm"
              />
            </div>

            <div>
              <label className="label">Document Number</label>
              <input
                type="text"
                value={filters.documentNumber || ''}
                onChange={(e) => handleFilterChange('documentNumber', e.target.value)}
                placeholder="Filter by doc #..."
                className="input input-sm"
              />
            </div>

            <div>
              <label className="label">File Name</label>
              <input
                type="text"
                value={filters.fileName || ''}
                onChange={(e) => handleFilterChange('fileName', e.target.value)}
                placeholder="Filter by file..."
                className="input input-sm"
              />
            </div>

            {/* Currency Filters */}
            <div>
              <label className="label">Currency</label>
              <SearchableSelect
                options={[
                  { value: '', label: 'All' },
                  ...SUPPORTED_CURRENCIES.map((code) => ({
                    value: code,
                    label: code
                  }))
                ]}
                value={filters.currency || ''}
                onChange={(v) => handleFilterChange('currency', v)}
                placeholder="All Currencies"
                size="sm"
              />
            </div>

            <div>
              <label className="label">Home Currency</label>
              <SearchableSelect
                options={[
                  { value: '', label: 'All' },
                  ...SUPPORTED_CURRENCIES.map((code) => ({
                    value: code,
                    label: code
                  }))
                ]}
                value={filters.homeCurrency || ''}
                onChange={(v) => handleFilterChange('homeCurrency', v)}
                placeholder="All Currencies"
                size="sm"
              />
            </div>
          </div>

          {/* Tags Filter Section */}
          <div className="pt-4 mt-4 border-t border-border-primary">
            <div className="flex items-center justify-between mb-2">
              <label className="label flex items-center gap-1.5 mb-0">
                <Tag className="w-3.5 h-3.5" />
                Filter by Tags
              </label>
              {/* Show TagManager - works with or without company (tenant tags always available) */}
              <TagManager companyId={activeCompanyId || null} tenantId={activeTenantId} />
            </div>
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => {
                  const isSelected = filters.tagIds?.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => handleTagToggle(tag.id)}
                      className={cn(
                        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all',
                        TAG_COLORS[tag.color].bg,
                        TAG_COLORS[tag.color].text,
                        TAG_COLORS[tag.color].border,
                        isSelected && 'ring-2 ring-oak-primary ring-offset-1',
                        'hover:opacity-80'
                      )}
                    >
                      <Tag className="w-3 h-3" />
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-text-muted">
                No tags created yet. Add tags to documents to create them.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Active Filter Chips - Always visible when there are active filters */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-text-muted">Active:</span>

          {searchQuery.trim() && (
            <FilterChip
              label="Search"
              value={searchQuery}
              onRemove={() => {
                setSearchQuery('');
                onSearchChange?.('');
              }}
            />
          )}
          {filters.uploadDatePreset && (
            <FilterChip
              label="Upload"
              value={filters.uploadDatePreset === 'TODAY' ? 'Today' : filters.uploadDatePreset}
              onRemove={() => clearFilter('uploadDatePreset')}
            />
          )}
          {filters.needsReview && (
            <FilterChip
              label="Review"
              value="Needs Review"
              onRemove={() => clearFilter('needsReview')}
            />
          )}
          {filters.pipelineStatus && (
            <FilterChip
              label="Pipeline"
              value={PIPELINE_STATUS_OPTIONS.find(o => o.value === filters.pipelineStatus)?.label || filters.pipelineStatus}
              onRemove={() => clearFilter('pipelineStatus')}
            />
          )}
          {filters.revisionStatus && (
            <FilterChip
              label="Review"
              value={REVISION_STATUS_OPTIONS.find(o => o.value === filters.revisionStatus)?.label || filters.revisionStatus}
              onRemove={() => clearFilter('revisionStatus')}
            />
          )}
          {filters.duplicateStatus && (
            <FilterChip
              label="Duplicate"
              value={DUPLICATE_STATUS_OPTIONS.find(o => o.value === filters.duplicateStatus)?.label || filters.duplicateStatus}
              onRemove={() => clearFilter('duplicateStatus')}
            />
          )}
          {filters.isContainer !== undefined && (
            <FilterChip
              label="Type"
              value={filters.isContainer ? 'Containers' : 'Children'}
              onRemove={() => clearFilter('isContainer')}
            />
          )}
          {filters.companyId && (
            <FilterChip
              label="Company"
              value={companyName || filters.companyId}
              onRemove={() => {
                clearFilter('companyId');
                setCompanyName('');
              }}
            />
          )}
          {(filters.uploadDateFrom || filters.uploadDateTo) && (
            <FilterChip
              label="Upload"
              value={`${formatDateDisplay(filters.uploadDateFrom)} - ${formatDateDisplay(filters.uploadDateTo)}`}
              onRemove={() => {
                const newFilters = { ...filters };
                delete newFilters.uploadDateFrom;
                delete newFilters.uploadDateTo;
                setFilters(newFilters);
                onFilterChange(newFilters);
              }}
            />
          )}
          {(filters.documentDateFrom || filters.documentDateTo) && (
            <FilterChip
              label="Doc Date"
              value={`${formatDateDisplay(filters.documentDateFrom)} - ${formatDateDisplay(filters.documentDateTo)}`}
              onRemove={() => {
                const newFilters = { ...filters };
                delete newFilters.documentDateFrom;
                delete newFilters.documentDateTo;
                setFilters(newFilters);
                onFilterChange(newFilters);
              }}
            />
          )}
          {filters.vendorName && (
            <FilterChip
              label="Vendor"
              value={filters.vendorName}
              onRemove={() => clearFilter('vendorName')}
            />
          )}
          {filters.documentNumber && (
            <FilterChip
              label="Doc #"
              value={filters.documentNumber}
              onRemove={() => clearFilter('documentNumber')}
            />
          )}
          {filters.fileName && (
            <FilterChip
              label="File"
              value={filters.fileName}
              onRemove={() => clearFilter('fileName')}
            />
          )}
          {filters.currency && (
            <FilterChip
              label="Currency"
              value={filters.currency}
              onRemove={() => clearFilter('currency')}
            />
          )}
          {filters.homeCurrency && (
            <FilterChip
              label="Home Ccy"
              value={filters.homeCurrency}
              onRemove={() => clearFilter('homeCurrency')}
            />
          )}
          {filters.tagIds && filters.tagIds.map((tagId) => {
            const tag = tags.find(t => t.id === tagId);
            if (!tag) return null;
            return (
              <TagChip
                key={tagId}
                name={tag.name}
                color={tag.color}
                size="sm"
                onRemove={() => removeTagFilter(tagId)}
              />
            );
          })}

          <button
            onClick={clearAllFilters}
            className="btn-ghost btn-xs flex items-center gap-1.5 text-text-secondary hover:text-text-primary ml-auto"
          >
            <X className="w-3.5 h-3.5" />
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

export default ProcessingFilters;
