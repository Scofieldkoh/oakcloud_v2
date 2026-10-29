'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Package,
  Users,
  Plus,
  Trash2,
  Building2,
  Globe,
  Loader2,
  X,
} from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { LoadingState } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';
import { AsyncSearchSelect, type AsyncSearchSelectOption } from '@/components/ui/async-search-select';
import { useCompanies } from '@/hooks/use-companies';
import {
  useContactAliases,
  useCreateContactAlias,
  useDeleteContactAlias,
  type ContactAlias,
} from '@/hooks/use-contact-aliases';
import { formatDate } from '@/lib/utils';

interface ContactAliasesModalProps {
  isOpen: boolean;
  onClose: () => void;
  contactId: string;
  contactName: string;
  canEdit: boolean;
}

// Company option type for AsyncSearchSelect
interface CompanyOption extends AsyncSearchSelectOption {
  uen?: string | null;
}

// Add Alias Form
interface AddAliasFormProps {
  onSubmit: (data: { type: 'vendor' | 'customer'; companyId: string | null; rawName: string }) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}

function AddAliasForm({ onSubmit, onCancel, isLoading }: AddAliasFormProps) {
  const [aliasType, setAliasType] = useState<'vendor' | 'customer'>('vendor');
  const [scope, setScope] = useState<'tenant' | 'company'>('tenant');
  const [companyId, setCompanyId] = useState('');
  const [rawName, setRawName] = useState('');
  const [companySearchQuery, setCompanySearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce company search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(companySearchQuery), 300);
    return () => clearTimeout(timer);
  }, [companySearchQuery]);

  const { data: companiesData, isLoading: companiesLoading } = useCompanies({
    query: debouncedQuery || undefined,
    limit: 50,
    sortBy: 'name',
    sortOrder: 'asc',
  });

  const companyOptions: CompanyOption[] = useMemo(
    () =>
      (companiesData?.companies || []).map((c) => ({
        id: c.id,
        label: c.name,
        description: c.uen || undefined,
        uen: c.uen,
      })),
    [companiesData?.companies]
  );

  const handleSubmit = async () => {
    if (!rawName.trim()) return;
    if (scope === 'company' && !companyId) return;

    await onSubmit({
      type: aliasType,
      companyId: scope === 'company' ? companyId : null,
      rawName: rawName.trim(),
    });
  };

  const isValid = rawName.trim() && (scope === 'tenant' || companyId);

  return (
    <div className="space-y-4 p-4 bg-surface-secondary rounded-lg border border-border-primary">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-text-primary">Add New Alias</h4>
        <button onClick={onCancel} className="text-text-muted hover:text-text-secondary">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Alias Type */}
      <div>
        <label className="label">Alias Type</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAliasType('vendor')}
            className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
              aliasType === 'vendor'
                ? 'border-oak-primary bg-oak-primary/10 text-oak-primary'
                : 'border-border-primary text-text-secondary hover:border-border-secondary'
            }`}
          >
            <Package className="w-4 h-4 inline-block mr-1.5" />
            Vendor
          </button>
          <button
            type="button"
            onClick={() => setAliasType('customer')}
            className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
              aliasType === 'customer'
                ? 'border-oak-primary bg-oak-primary/10 text-oak-primary'
                : 'border-border-primary text-text-secondary hover:border-border-secondary'
            }`}
          >
            <Users className="w-4 h-4 inline-block mr-1.5" />
            Customer
          </button>
        </div>
      </div>

      {/* Scope */}
      <div>
        <label className="label">Scope</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setScope('tenant');
              setCompanyId('');
            }}
            className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
              scope === 'tenant'
                ? 'border-oak-primary bg-oak-primary/10 text-oak-primary'
                : 'border-border-primary text-text-secondary hover:border-border-secondary'
            }`}
          >
            <Globe className="w-4 h-4 inline-block mr-1.5" />
            Tenant-wide
          </button>
          <button
            type="button"
            onClick={() => setScope('company')}
            className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
              scope === 'company'
                ? 'border-oak-primary bg-oak-primary/10 text-oak-primary'
                : 'border-border-primary text-text-secondary hover:border-border-secondary'
            }`}
          >
            <Building2 className="w-4 h-4 inline-block mr-1.5" />
            Company-specific
          </button>
        </div>
        <p className="text-xs text-text-muted mt-1">
          {scope === 'tenant'
            ? 'This alias will apply across all companies in your organization'
            : 'This alias will only apply to the selected company'}
        </p>
      </div>

      {/* Company Selection (if company-specific) */}
      {scope === 'company' && (
        <div>
          <label className="label">Company</label>
          <AsyncSearchSelect<CompanyOption>
            value={companyId}
            onChange={(id) => setCompanyId(id)}
            options={companyOptions}
            isLoading={companiesLoading}
            searchQuery={companySearchQuery}
            onSearchChange={setCompanySearchQuery}
            placeholder="Search companies..."
            icon={<Building2 className="w-4 h-4" />}
            emptySearchText="Type to search companies"
            noResultsText="No companies found"
          />
        </div>
      )}

      {/* Alias Name */}
      <div>
        <label className="label">Alias Name (Raw Name)</label>
        <input
          type="text"
          value={rawName}
          onChange={(e) => setRawName(e.target.value)}
          placeholder="e.g., ABC TRADING, ACME Corp, John D."
          className="input input-sm w-full"
        />
        <p className="text-xs text-text-muted mt-1">
          This is the name as it appears in documents that should resolve to this contact
        </p>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={isLoading || !isValid}
        >
          {isLoading && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
          Add Alias
        </Button>
      </div>
    </div>
  );
}

// Alias Row Component
interface AliasRowProps {
  alias: ContactAlias;
  canEdit: boolean;
  onDelete: () => void;
  isDeleting: boolean;
}

function AliasRow({ alias, canEdit, onDelete, isDeleting }: AliasRowProps) {
  const Icon = alias.type === 'vendor' ? Package : Users;
  const typeLabel = alias.type === 'vendor' ? 'Vendor' : 'Customer';
  const typeColor = alias.type === 'vendor' ? 'text-amber-600 bg-amber-50' : 'text-blue-600 bg-blue-50';

  return (
    <div className="flex items-center gap-3 py-3 px-4 hover:bg-surface-secondary rounded-lg transition-colors group">
      {/* Type Badge */}
      <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded ${typeColor}`}>
        <Icon className="w-3.5 h-3.5" />
        {typeLabel}
      </span>

      {/* Alias Name */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">{alias.rawName}</p>
        <p className="text-xs text-text-muted">
          Added {formatDate(alias.createdAt)}
        </p>
      </div>

      {/* Scope */}
      <div className="flex-shrink-0">
        {alias.isTenantWide ? (
          <span className="flex items-center gap-1 text-xs text-text-secondary bg-surface-tertiary px-2 py-1 rounded">
            <Globe className="w-3 h-3" />
            Tenant-wide
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-text-secondary bg-surface-tertiary px-2 py-1 rounded">
            <Building2 className="w-3 h-3" />
            {alias.companyName || 'Company'}
          </span>
        )}
      </div>

      {/* Confidence */}
      {alias.confidence < 1 && (
        <span className="flex-shrink-0 text-xs text-text-muted">
          {Math.round(alias.confidence * 100)}% match
        </span>
      )}

      {/* Delete Action */}
      {canEdit && (
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-status-error p-1.5 rounded hover:bg-status-error/10"
          title="Delete alias"
        >
          {isDeleting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      )}
    </div>
  );
}

// Main Modal Component
export function ContactAliasesModal({
  isOpen,
  onClose,
  contactId,
  contactName,
  canEdit,
}: ContactAliasesModalProps) {
  const { success, error: toastError } = useToast();
  const { data, isLoading, error } = useContactAliases(isOpen ? contactId : null);

  const createMutation = useCreateContactAlias(contactId);
  const deleteMutation = useDeleteContactAlias(contactId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<ContactAlias | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Combine and sort all aliases
  const allAliases = useMemo(() => {
    if (!data) return [];
    return [...data.vendorAliases, ...data.customerAliases].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [data]);

  const handleAddAlias = async (input: {
    type: 'vendor' | 'customer';
    companyId: string | null;
    rawName: string;
  }) => {
    try {
      await createMutation.mutateAsync(input);
      success('Alias added successfully');
      setShowAddForm(false);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to add alias');
    }
  };

  const handleDeleteAlias = async () => {
    if (!deleteConfirm) return;

    try {
      setDeletingId(deleteConfirm.id);
      await deleteMutation.mutateAsync({
        type: deleteConfirm.type,
        aliasId: deleteConfirm.id,
      });
      success('Alias deleted successfully');
      setDeleteConfirm(null);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to delete alias');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Manage Aliases" size="5xl">
        <ModalBody className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">
                  Aliases for <span className="font-medium text-text-primary">{contactName}</span>
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Aliases help map different name variations from documents to this contact
                </p>
              </div>
              {canEdit && !showAddForm && (
                <Button variant="primary" size="sm" onClick={() => setShowAddForm(true)}>
                  <Plus className="w-4 h-4 mr-1.5" />
                  Add Alias
                </Button>
              )}
            </div>

            {/* Add Form */}
            {showAddForm && (
              <AddAliasForm
                onSubmit={handleAddAlias}
                onCancel={() => setShowAddForm(false)}
                isLoading={createMutation.isPending}
              />
            )}

            {/* Loading State */}
            {isLoading && <LoadingState message="Loading aliases..." size="lg" />}

            {/* Error State */}
            {error && <ErrorState error={error} size="lg" />}

            {/* Aliases List */}
            {data && (
              <div className="card">
                <div className="px-4 py-3 border-b border-border-primary">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-text-primary">Linked Aliases</h4>
                    <span className="text-xs text-text-muted bg-surface-tertiary px-2.5 py-1 rounded-full">
                      {allAliases.length} {allAliases.length === 1 ? 'alias' : 'aliases'}
                    </span>
                  </div>
                </div>

                {allAliases.length > 0 ? (
                  <div className="divide-y divide-border-secondary">
                    {allAliases.map((alias) => (
                      <AliasRow
                        key={alias.id}
                        alias={alias}
                        canEdit={canEdit}
                        onDelete={() => setDeleteConfirm(alias)}
                        isDeleting={deletingId === alias.id}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Package className="w-8 h-8 text-text-muted mx-auto mb-2" />
                    <p className="text-sm text-text-muted">No aliases linked to this contact</p>
                    {canEdit && (
                      <button
                        onClick={() => setShowAddForm(true)}
                        className="text-sm text-oak-light hover:text-oak-dark mt-2 inline-flex items-center gap-1"
                      >
                        <Plus className="w-4 h-4" />
                        Add first alias
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDeleteAlias}
        title="Delete Alias"
        description={`Are you sure you want to delete the alias "${deleteConfirm?.rawName}"? This action cannot be undone.`}
        variant="danger"
        confirmLabel="Delete"
        isLoading={deleteMutation.isPending}
      />
    </>
  );
}
