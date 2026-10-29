'use client';

import { useEffect, useMemo, useState } from 'react';
import { ClientServiceCreator } from '@/components/companies/company-detail/client-service-creator';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { AsyncSearchSelect } from '@/components/ui/async-search-select';
import { useCompanyOptionsPage } from '@/hooks/use-all-company-options';
import type { ClientServiceDto } from '@/services/client-service';

interface AddClientServiceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (service: ClientServiceDto) => void;
}

/** Select an accessible company before mounting the shared company-scoped creator. */
export function AddClientServiceDialog({ isOpen, onClose, onCreated }: AddClientServiceDialogProps) {
  const [companySearch, setCompanySearch] = useState('');
  const [companyPage, setCompanyPage] = useState(0);
  const companyOptions = useCompanyOptionsPage(undefined, {
    enabled: isOpen,
    query: companySearch,
    page: companyPage,
    limit: 20,
  });
  const [companyId, setCompanyId] = useState('');
  const [creatorOpen, setCreatorOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCompanySearch('');
      setCompanyPage(0);
      setCompanyId('');
      setCreatorOpen(false);
    }
  }, [isOpen]);

  const options = useMemo(
    () => (companyOptions.data?.options ?? []).map((company) => ({
      id: company.id,
      label: company.name,
      description: company.uen ?? undefined,
    })),
    [companyOptions.data],
  );

  const openCreator = () => {
    if (!companyId) return;
    setCreatorOpen(true);
  };

  const handleCreated = (service: ClientServiceDto) => {
    setCreatorOpen(false);
    onClose();
    onCreated?.(service);
  };

  return (
    <>
      <Modal
        isOpen={isOpen && !creatorOpen}
        onClose={onClose}
        title="Add service"
        description="Choose an accessible company, then complete the shared service form."
        size="4xl"
      >
        <ModalBody className="space-y-4">
            <AsyncSearchSelect
              label="Company"
              options={options}
              value={companyId}
              onChange={(value) => setCompanyId(value)}
              placeholder="Search accessible companies"
              isLoading={companyOptions.isLoading}
              searchQuery={companySearch}
              onSearchChange={(value) => { setCompanySearch(value); setCompanyPage(0); }}
              emptySearchText="Type to search companies"
              noResultsText="No accessible companies match"
              pagination={{
                page: companyOptions.data?.page ?? companyPage,
                hasPreviousPage: companyPage > 0,
                hasNextPage: companyOptions.data?.hasMore === true,
                onPreviousPage: () => setCompanyPage((page) => Math.max(0, page - 1)),
                onNextPage: () => setCompanyPage((page) => page + 1),
              }}
            />
          {!companyOptions.isLoading && options.length === 0 && !companyOptions.error && companySearch.length === 0 ? (
            <p className="text-sm text-text-secondary">Type to search accessible companies.</p>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={openCreator} disabled={!companyId}>Continue</Button>
        </ModalFooter>
      </Modal>
      <ClientServiceCreator
        companyId={companyId}
        isOpen={isOpen && creatorOpen}
        onClose={() => setCreatorOpen(false)}
        onCreated={handleCreated}
      />
    </>
  );
}
