'use client';

import { Briefcase, ChevronDown, Check, Building2 } from 'lucide-react';
import { useCompanySearch, type CompanySearchOption } from '@/hooks/use-company-search';
import { useCompanyStore } from '@/stores/company-store';
import { useState, useEffect } from 'react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SelectPopoverMessage } from '@/components/ui/select-popover';

/**
 * Hook to get the active company ID from the centralized store.
 * Returns undefined if no company is selected (means "all companies")
 */
export function useActiveCompanyId(): string | undefined {
  const { selectedCompanyId } = useCompanyStore();
  return selectedCompanyId || undefined;
}

/**
 * Hook to get company store actions and state for components that need to interact with it
 */
export function useCompanySelection() {
  const { selectedCompanyId, selectedCompanyName, setSelectedCompany, clearSelectedCompany } = useCompanyStore();
  return { selectedCompanyId, selectedCompanyName, setSelectedCompany, clearSelectedCompany };
}

interface CompanySelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal for selecting a company - used in the sidebar
 */
export function CompanySelectorModal({ isOpen, onClose }: CompanySelectorModalProps) {
  const {
    searchQuery,
    setSearchQuery,
    options: companyOptions,
    isLoading,
    error,
    retry,
  } = useCompanySearch({
    enabled: isOpen,
    minChars: 0,
    limit: 50,
  });

  const { selectedCompanyId, selectedCompanyName, setSelectedCompany } = useCompanyStore();
  const [tempSelectedCompany, setTempSelectedCompany] = useState<CompanySearchOption | null>(null);

  // Sync temp selection when modal opens
  useEffect(() => {
    if (isOpen) {
      setTempSelectedCompany(
        selectedCompanyId
          ? {
              id: selectedCompanyId,
              name: selectedCompanyName || 'Selected company',
              label: selectedCompanyName || 'Selected company',
              description: '',
              uen: null,
            }
          : null
      );
      setSearchQuery('');
    }
  }, [isOpen, selectedCompanyId, selectedCompanyName, setSearchQuery]);

  const handleSelect = (company: CompanySearchOption) => {
    setTempSelectedCompany(company);
  };

  const handleConfirm = () => {
    if (tempSelectedCompany) {
      setSelectedCompany(tempSelectedCompany.id, tempSelectedCompany.name);
    } else {
      setSelectedCompany('', '');
    }
    onClose();
  };

  const handleClear = () => {
    setTempSelectedCompany(null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Select Company"
      description="Choose a company to filter documents. Leave empty to view all companies."
      size="md"
    >
      <ModalBody>
        {/* Search */}
        <div className="mb-4">
          <input
            type="search"
            aria-label="Search companies"
            placeholder="Search companies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input input-sm text-sm w-full"
          />
        </div>

        {/* Company List */}
        <div className="max-h-64 overflow-y-auto border border-border-primary rounded-lg divide-y divide-border-primary">
          {/* "All Companies" option */}
          <button
            onClick={handleClear}
            className={cn(
              'w-full flex items-center gap-3 p-3 text-left transition-colors',
              tempSelectedCompany === null
                ? 'bg-oak-primary/10'
                : 'hover:bg-background-tertiary'
            )}
          >
            <Building2 className={cn(
              'w-5 h-5 flex-shrink-0',
              tempSelectedCompany === null ? 'text-oak-primary' : 'text-text-muted'
            )} />
            <div className="flex-1 min-w-0">
              <div className={cn(
                'font-medium truncate',
                tempSelectedCompany === null ? 'text-oak-primary' : 'text-text-primary'
              )}>
                All Companies
              </div>
              <div className="text-xs text-text-muted truncate">View documents from all companies</div>
            </div>
            {tempSelectedCompany === null && (
              <Check className="w-5 h-5 text-oak-primary flex-shrink-0" />
            )}
          </button>

          {isLoading ? (
            <SelectPopoverMessage kind="loading">Loading companies…</SelectPopoverMessage>
          ) : error ? (
            <SelectPopoverMessage kind="error" onRetry={() => void retry()}>Couldn&apos;t load companies.</SelectPopoverMessage>
          ) : companyOptions.length === 0 ? (
            <SelectPopoverMessage kind="empty">
              {searchQuery ? 'No companies match your search' : 'No companies available'}
            </SelectPopoverMessage>
          ) : (
            companyOptions.map((company) => (
              <button
                key={company.id}
                onClick={() => handleSelect(company)}
                className={cn(
                  'w-full flex items-center gap-3 p-3 text-left transition-colors',
                  tempSelectedCompany?.id === company.id
                    ? 'bg-oak-primary/10'
                    : 'hover:bg-background-tertiary'
                )}
              >
                <Briefcase className={cn(
                  'w-5 h-5 flex-shrink-0',
                  tempSelectedCompany?.id === company.id ? 'text-oak-primary' : 'text-text-muted'
                )} />
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    'font-medium truncate',
                    tempSelectedCompany?.id === company.id ? 'text-oak-primary' : 'text-text-primary'
                  )}>
                    {company.name}
                  </div>
                  {company.uen && (
                    <div className="text-xs text-text-muted truncate">{company.uen}</div>
                  )}
                </div>
                {tempSelectedCompany?.id === company.id && (
                  <Check className="w-5 h-5 text-oak-primary flex-shrink-0" />
                )}
              </button>
            ))
          )}
        </div>

        {/* Selected info */}
        {tempSelectedCompany && (
          <div className="mt-3 p-2 bg-oak-primary/5 rounded-lg flex items-center justify-between">
            <span className="text-sm text-text-secondary">
              Selected: <span className="font-medium text-text-primary">
                {tempSelectedCompany.name}
              </span>
            </span>
            <button
              onClick={handleClear}
              className="text-xs text-text-muted hover:text-text-secondary"
            >
              Clear
            </button>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleConfirm}>
          Confirm Selection
        </Button>
      </ModalFooter>
    </Modal>
  );
}

interface SidebarCompanyButtonProps {
  collapsed: boolean;
}

/**
 * Company selector button for the sidebar
 */
export function SidebarCompanyButton({ collapsed }: SidebarCompanyButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { selectedCompanyId, selectedCompanyName } = useCompanyStore();

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className={cn(
          'flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors w-full',
          selectedCompanyId
            ? 'bg-oak-primary/10 text-oak-light hover:bg-oak-primary/20'
            : 'text-text-secondary hover:bg-background-tertiary hover:text-text-primary'
        )}
        title={collapsed ? (selectedCompanyName || 'All Companies') : undefined}
      >
        <Briefcase className="w-[18px] h-[18px] flex-shrink-0" />
        {!collapsed && (
          <div className="flex-1 min-w-0 text-left">
            {selectedCompanyId ? (
              <div className="truncate">
                <span className="text-2xs uppercase tracking-wider text-text-muted block">Company</span>
                <span className="font-medium truncate block">{selectedCompanyName || 'Selected'}</span>
              </div>
            ) : (
              <span>All Companies</span>
            )}
          </div>
        )}
        {!collapsed && <ChevronDown className="w-4 h-4 flex-shrink-0 text-text-muted" />}
      </button>
      <CompanySelectorModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
}
