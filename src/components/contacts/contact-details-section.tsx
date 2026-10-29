'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Mail, Plus, Building2, User, Loader2, Pencil, Trash2, Star, X, Check } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { LoadingState } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';
import { CompanyAccentSection, CompanyAccentButton, CompanyFieldLabel } from '@/components/companies/company-accent-section';
import { CopyButton } from '@/components/companies/contact-details/copy-button';
import { PurposeToggle, PurposeBadges } from '@/components/contacts/purpose-toggle';
import { AddContactDetailModal } from '@/components/companies/contact-details/add-contact-detail-modal';
import {
  useContactDetailsGrouped,
  useContactDetails,
  useCreateContactLevelDetail,
  useUpdateContactLevelDetail,
  useDeleteContactLevelDetail,
  type ContactDetail,
  type CreateContactDetailInput,
} from '@/hooks/use-contact-details';
import type { ContactDetailType } from '@/generated/prisma';
import {
  DETAIL_TYPE_CONFIG,
  LABEL_SUGGESTIONS,
  createInitialFormState,
  type ContactDetailFormState,
} from '@/lib/constants/contact-details';

interface ContactDetailsSectionProps {
  contactId: string;
  contactName: string;
  canEdit: boolean;
}

export function ContactDetailsSection({ contactId, contactName, canEdit }: ContactDetailsSectionProps) {
  const { success } = useToast();
  const { data, isLoading, error } = useContactDetailsGrouped(contactId);

  // Get flat list of all contact details for the modal (for validation)
  const { data: allDetails } = useContactDetails(contactId);

  const createMutation = useCreateContactLevelDetail(contactId);
  const updateMutation = useUpdateContactLevelDetail(contactId);
  const deleteMutation = useDeleteContactLevelDetail(contactId);

  // Add modal state
  const [showAddModal, setShowAddModal] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ContactDetailFormState>(createInitialFormState());

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; value: string } | null>(null);

  // Get list of company IDs that already have company-specific details
  const linkedCompanyIds = useMemo(() => {
    if (!data?.companyDetails) return [];
    return data.companyDetails.map(c => c.companyId);
  }, [data?.companyDetails]);

  // Handle add submit from modal
  const handleAddSubmit = async (input: CreateContactDetailInput) => {
    try {
      // Pass all fields including selectedCompanyId for company-specific details
      await createMutation.mutateAsync({
        detailType: input.detailType,
        value: input.value,
        label: input.label,
        purposes: input.purposes,
        isPrimary: input.isPrimary,
        isCompanySpecific: input.isCompanySpecific,
        selectedCompanyId: input.selectedCompanyId,
      });
      success('Contact detail added');
      setShowAddModal(false);
    } catch {
      // Error handled by mutation
    }
  };

  // Handle update from modal
  const handleUpdateFromModal = async (
    detailId: string,
    data: { value: string; label?: string | null; purposes?: string[] }
  ) => {
    try {
      await updateMutation.mutateAsync({
        detailId,
        data: {
          value: data.value,
          label: data.label,
          purposes: data.purposes,
        },
      });
      success('Contact detail updated');
    } catch {
      // Error handled by mutation
    }
  };

  // Handle delete from modal
  const handleDeleteFromModal = async (detailId: string) => {
    try {
      await deleteMutation.mutateAsync(detailId);
      success('Contact detail deleted');
    } catch {
      // Error handled by mutation
    }
  };

  const startEdit = (detail: ContactDetail) => {
    setEditingId(detail.id);
    setEditForm({
      detailType: detail.detailType,
      value: detail.value,
      label: detail.label || '',
      purposes: detail.purposes || [],
      isPrimary: detail.isPrimary,
      isPoc: detail.isPoc,
    });
  };

  const handleUpdate = async () => {
    if (!editingId) return;

    try {
      await updateMutation.mutateAsync({
        detailId: editingId,
        data: {
          detailType: editForm.detailType,
          value: editForm.value.trim(),
          label: editForm.label.trim() || null,
          purposes: editForm.purposes,
          isPrimary: editForm.isPrimary,
          isPoc: editForm.isPoc,
        },
      });
      success('Contact detail updated');
      setEditingId(null);
    } catch {
      // Error handled by mutation
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;

    try {
      await deleteMutation.mutateAsync(deleteConfirm.id);
      success('Contact detail deleted');
      setDeleteConfirm(null);
    } catch {
      // Error handled by mutation
    }
  };

  const handleEditPurposesChange = (purposes: string[]) => {
    setEditForm(prev => ({ ...prev, purposes }));
  };

  const renderDetailRow = (detail: ContactDetail, isEditing: boolean) => {
    const config = DETAIL_TYPE_CONFIG[detail.detailType];
    const Icon = config.icon;

    if (isEditing && canEdit) {
      return (
        <div key={detail.id} className="-mx-3 space-y-2 bg-surface-secondary px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={editForm.detailType}
              onChange={(e) => {
                const newType = e.target.value as ContactDetailType;
                setEditForm(prev => ({
                  ...prev,
                  detailType: newType,
                  purposes: newType === 'EMAIL' ? prev.purposes : [],
                }));
              }}
              className="input input-xs w-28"
              aria-label="Detail type"
            >
              {Object.entries(DETAIL_TYPE_CONFIG).map(([type, cfg]) => (
                <option key={type} value={type}>{cfg.label}</option>
              ))}
            </select>
            <input
              type="text"
              value={editForm.value}
              onChange={(e) => setEditForm(prev => ({ ...prev, value: e.target.value }))}
              className="input input-xs min-w-[150px] flex-1"
              placeholder="Value"
              aria-label="Value"
            />
            <input
              type="text"
              value={editForm.label}
              onChange={(e) => setEditForm(prev => ({ ...prev, label: e.target.value }))}
              className="input input-xs w-28"
              placeholder="Label"
              list="label-suggestions-edit"
              aria-label="Label"
            />
            <button
              onClick={() => setEditForm(prev => ({ ...prev, isPrimary: !prev.isPrimary }))}
              className={`rounded p-1 ${editForm.isPrimary ? 'text-amber-500 hover:text-amber-600' : 'text-text-muted hover:text-amber-500'}`}
              title={editForm.isPrimary ? 'Primary' : 'Set as primary'}
            >
              <Star className="h-4 w-4" fill={editForm.isPrimary ? 'currentColor' : 'none'} />
            </button>
          </div>
          {editForm.detailType === 'EMAIL' && (
            <PurposeToggle
              selectedPurposes={editForm.purposes}
              onChange={handleEditPurposesChange}
              size="sm"
            />
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => setEditingId(null)}
              disabled={updateMutation.isPending}
              className="btn-ghost btn-xs text-text-muted hover:text-text-primary"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
            <button
              onClick={handleUpdate}
              disabled={updateMutation.isPending || !editForm.value.trim()}
              className="btn-ghost btn-xs text-oak-light hover:text-oak-dark disabled:opacity-50"
              title="Save"
            >
              {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save
            </button>
          </div>
          <datalist id="label-suggestions-edit">
            {LABEL_SUGGESTIONS.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </div>
      );
    }

    return (
      <div key={detail.id} className="group flex items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
            <Icon className="h-4 w-4 flex-shrink-0 text-text-tertiary" aria-hidden="true" />
            <span className="truncate">{detail.value}</span>
            <CopyButton value={detail.value} />
            {detail.isPrimary && (
              <span className="text-amber-500" title="Primary contact detail">
                <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              </span>
            )}
          </div>
          {detail.label && (
            <p className="mt-1 text-xs text-text-secondary">{detail.label}</p>
          )}
          {detail.detailType === 'EMAIL' && detail.purposes && detail.purposes.length > 0 && (
            <PurposeBadges purposes={detail.purposes} className="mt-1" />
          )}
        </div>
        {canEdit && (
          <div className="flex flex-shrink-0 items-center gap-1">
            <button
              onClick={() => startEdit(detail)}
              className="rounded p-1 text-text-muted transition-colors hover:bg-surface-tertiary hover:text-oak-light"
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setDeleteConfirm({ id: detail.id, value: detail.value })}
              className="rounded p-1 text-text-muted transition-colors hover:bg-surface-tertiary hover:text-status-error"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <CompanyAccentSection
        title="Contact Details"
        actions={
          canEdit ? (
            <CompanyAccentButton onClick={() => setShowAddModal(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add Detail
            </CompanyAccentButton>
          ) : undefined
        }
      >
        {/* Loading state */}
        {isLoading && (
          <LoadingState message="Loading contact details..." />
        )}

        {/* Error state */}
        {error && (
          <ErrorState error={error} inline className="p-4" />
        )}

        {/* Content */}
        {data && (
          <div>
            {/* Default Details */}
            {data.defaultDetails.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 px-3 pt-3">
                  <User className="h-3.5 w-3.5 text-text-tertiary" aria-hidden="true" />
                  <CompanyFieldLabel>Default</CompanyFieldLabel>
                </div>
                <div className="divide-y divide-border-primary px-3">
                  {data.defaultDetails.map((detail) => renderDetailRow(detail, editingId === detail.id))}
                </div>
              </div>
            )}

            {/* Company-Specific Details */}
            {data.companyDetails.map((company) => (
              <div key={company.companyId} className="border-t border-border-primary">
                <div className="flex items-center gap-1.5 px-3 pt-3">
                  <Building2 className="h-3.5 w-3.5 text-text-tertiary" aria-hidden="true" />
                  <Link
                    href={`/companies/${company.companyId}`}
                    className="text-[11px] font-medium uppercase tracking-wide text-oak-primary hover:underline"
                  >
                    {company.companyName}
                  </Link>
                </div>
                {company.details.length > 0 ? (
                  <div className="divide-y divide-border-primary px-3">
                    {company.details.map((detail) => renderDetailRow(detail, editingId === detail.id))}
                  </div>
                ) : (
                  <p className="px-3 pb-3 text-sm text-text-secondary">No details</p>
                )}
              </div>
            ))}

            {/* Empty state when no details at all */}
            {data.defaultDetails.length === 0 && data.companyDetails.length === 0 && (
              <div className="px-3 py-6 text-center">
                <Mail className="mx-auto mb-2 h-6 w-6 text-text-muted" aria-hidden="true" />
                <p className="text-sm text-text-muted">No contact details</p>
                {canEdit && (
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="mt-2 inline-flex items-center gap-1 text-sm text-oak-light hover:text-oak-dark"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add first detail
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </CompanyAccentSection>

      {/* Add Contact Detail Modal - uses shared modal with company search */}
      <AddContactDetailModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddSubmit}
        onUpdate={handleUpdateFromModal}
        onDelete={handleDeleteFromModal}
        isLoading={createMutation.isPending}
        targetName={contactName}
        targetType="contact"
        contactId={contactId}
        // No companyId means standalone mode - user can search for companies
        existingDetails={allDetails || []}
        linkedCompanyIds={linkedCompanyIds}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDelete}
        title="Delete Contact Detail"
        description={`Are you sure you want to delete "${deleteConfirm?.value}"? This action cannot be undone.`}
        variant="danger"
        confirmLabel="Delete"
        isLoading={deleteMutation.isPending}
      />
    </>
  );
}
