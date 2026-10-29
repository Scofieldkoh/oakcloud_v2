'use client';

import { useMemo, useState } from 'react';
import { Plus, Loader2, X, Filter } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CompanyAccentSection, CompanyAccentButton, CompanyAccentFilter } from '@/components/companies/company-accent-section';
import { useToast } from '@/components/ui/toast';
import {
  useCompanyContactDetails,
  useCreateContactDetail,
  useUpdateContactDetail,
  useDeleteContactDetail,
  useToggleContactPoc,
  type ContactDetail,
  type ContactWithDetails,
  type CreateContactDetailInput,
} from '@/hooks/use-contact-details';
import { useLinkContactToCompany, useUnlinkContactFromCompany } from '@/hooks/use-contacts';
import type { ContactDetailType } from '@/generated/prisma';
import {
  AddContactDetailModal,
  LinkContactModal,
  ContactDetailRow,
  ContactRow,
} from '@/components/companies/contact-details';

interface ContactDetailsTabProps {
  companyId: string;
  companyName: string;
  canEdit: boolean;
}

// Common abbreviations that should remain uppercase
const ABBREVIATIONS = new Set(['CEO', 'CFO', 'COO', 'CTO', 'CIO', 'CMO', 'HR', 'IT', 'VP', 'SVP', 'EVP']);

// Helper to normalize and convert to Title Case while preserving abbreviations
// Replaces underscores with spaces and converts to title case
function normalizeRole(str: string): string {
  // First check if the entire string (trimmed, uppercased) is an abbreviation
  const upperStr = str.trim().toUpperCase();
  if (ABBREVIATIONS.has(upperStr)) {
    return upperStr;
  }

  return str
    .replace(/_/g, ' ')  // Replace underscores with spaces
    .toLowerCase()
    .replace(/\b\w+/g, (word) => {
      const upperWord = word.toUpperCase();
      // Keep abbreviations uppercase
      if (ABBREVIATIONS.has(upperWord)) {
        return upperWord;
      }
      // Title case for other words
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
}

// Helper to deduplicate and clean up relationships
// - Normalizes underscores and casing for proper deduplication
// - Removes generic "Shareholder" if there's a more specific one like "Ordinary Shareholder"
function cleanRelationships(relationshipStr: string | undefined): string[] {
  if (!relationshipStr) return [];

  // Split, normalize, and deduplicate
  const normalizedRoles = relationshipStr
    .split(', ')
    .filter(Boolean)
    .map(normalizeRole);

  // Deduplicate after normalization
  const uniqueRoles = [...new Set(normalizedRoles)];

  // Check if there's a specific shareholder type (e.g., "Ordinary Shareholder", "Preference Shareholder")
  const hasSpecificShareholder = uniqueRoles.some(r => r.includes('Shareholder') && r !== 'Shareholder');

  // Filter out generic "Shareholder" if there's a more specific one
  return uniqueRoles.filter(r => {
    if (r === 'Shareholder' && hasSpecificShareholder) return false;
    return true;
  });
}

// Accent header action button - matches Company Profile section actions
export function ContactDetailsTab({ companyId, companyName, canEdit }: ContactDetailsTabProps) {
  const { success } = useToast();
  // Data is prefetched in background by usePrefetchCompanyContactDetails in parent
  const { data, isLoading, error } = useCompanyContactDetails(companyId);

  const createDetailMutation = useCreateContactDetail(companyId);
  const updateDetailMutation = useUpdateContactDetail(companyId);
  const deleteDetailMutation = useDeleteContactDetail(companyId);
  const togglePocMutation = useToggleContactPoc(companyId);
  const linkContactMutation = useLinkContactToCompany();
  const unlinkContactMutation = useUnlinkContactFromCompany();

  // State for add detail modal
  const [showAddDetailModal, setShowAddDetailModal] = useState(false);
  const [addDetailTarget, setAddDetailTarget] = useState<{
    type: 'company' | 'contact';
    id?: string;
    name: string;
    existingDetails?: ContactDetail[];
    relationship?: string;
  }>({
    type: 'company',
    name: companyName,
  });

  // State for add contact modal
  const [showAddContactModal, setShowAddContactModal] = useState(false);

  // Filter state for linked contacts
  const [contactNameFilter, setContactNameFilter] = useState('');
  const [contactRoleFilter, setContactRoleFilter] = useState('');
  const [showCeasedContacts, setShowCeasedContacts] = useState(false);
  const [showContactFilters, setShowContactFilters] = useState(false);

  // State for editing
  const [editingDetailId, setEditingDetailId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    detailType: ContactDetailType;
    value: string;
    label: string;
    purposes: string[];
    isPrimary: boolean;
    isPoc: boolean;
  }>({
    detailType: 'EMAIL',
    value: '',
    label: '',
    purposes: [],
    isPrimary: false,
    isPoc: false,
  });

  // State for delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; value: string } | null>(null);
  const [deletingDetailId, setDeletingDetailId] = useState<string | null>(null);

  // State for POC toggle loading
  const [togglingPocContactId, setTogglingPocContactId] = useState<string | null>(null);

  const handleAddDetail = async (input: CreateContactDetailInput & { isCompanySpecific?: boolean }) => {
    try {
      // If isCompanySpecific is true, the API should use the companyId
      // We pass this as a separate flag, the hook will handle it
      const { isCompanySpecific, ...data } = input;
      await createDetailMutation.mutateAsync({
        ...data,
        // For company-specific details, we tell the API to also set companyId
        ...(isCompanySpecific ? { isCompanySpecific: true } : {}),
      } as CreateContactDetailInput);
      success('Contact detail added');
      setShowAddDetailModal(false);
    } catch {
      // Error handled by mutation
    }
  };

  const handleUpdateDetailFromModal = async (detailId: string, data: { value: string; label?: string | null; purposes?: string[] }) => {
    try {
      await updateDetailMutation.mutateAsync({
        detailId,
        data: {
          value: data.value,
          label: data.label,
          purposes: data.purposes,
        },
      });
      success('Contact detail updated');
      setShowAddDetailModal(false);
    } catch {
      // Error handled by mutation
    }
  };

  const handleDeleteDetailFromModal = async (detailId: string) => {
    try {
      await deleteDetailMutation.mutateAsync(detailId);
      success('Contact detail deleted');
      // Don't close modal - let user continue editing other field
    } catch {
      // Error handled by mutation
    }
  };

  const handleUpdateDetail = async () => {
    if (!editingDetailId || !editForm.value.trim()) return;

    try {
      await updateDetailMutation.mutateAsync({
        detailId: editingDetailId,
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
      setEditingDetailId(null);
    } catch {
      // Error handled by mutation
    }
  };

  const handleDeleteDetail = async () => {
    if (!deleteConfirm) return;

    try {
      setDeletingDetailId(deleteConfirm.id);
      await deleteDetailMutation.mutateAsync(deleteConfirm.id);
      success('Contact detail deleted');
      setDeleteConfirm(null);
    } catch {
      // Error handled by mutation
    } finally {
      setDeletingDetailId(null);
    }
  };

  const handleLinkContact = async (contactId: string, relationship: string) => {
    try {
      await linkContactMutation.mutateAsync({
        contactId,
        companyId,
        relationship,
      });
      success('Contact linked successfully');
      setShowAddContactModal(false);
    } catch {
      // Error handled by mutation
    }
  };

  const handleUnlinkContactFromModal = async () => {
    if (!addDetailTarget.id || !addDetailTarget.relationship) return;

    try {
      await unlinkContactMutation.mutateAsync({
        contactId: addDetailTarget.id,
        companyId,
        relationship: addDetailTarget.relationship,
      });
      success('Contact unlinked successfully');
      setShowAddDetailModal(false);
    } catch {
      // Error handled by mutation
    }
  };

  const handleTogglePoc = async (contactId: string, isPoc: boolean) => {
    try {
      setTogglingPocContactId(contactId);
      await togglePocMutation.mutateAsync({ contactId, isPoc });
      success(isPoc ? 'Set as Point of Contact' : 'Removed Point of Contact');
    } catch {
      // Error handled by mutation
    } finally {
      setTogglingPocContactId(null);
    }
  };

  const startEdit = (detail: ContactDetail) => {
    setEditingDetailId(detail.id);
    setEditForm({
      detailType: detail.detailType,
      value: detail.value,
      label: detail.label || '',
      purposes: detail.purposes || [],
      isPrimary: detail.isPrimary,
      isPoc: detail.isPoc,
    });
  };

  const cancelEdit = () => {
    setEditingDetailId(null);
    setEditForm({ detailType: 'EMAIL', value: '', label: '', purposes: [], isPrimary: false, isPoc: false });
  };

  const updateEditForm = (field: string, value: string | string[] | boolean) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const openAddDetailForCompany = () => {
    setAddDetailTarget({ type: 'company', name: companyName });
    setShowAddDetailModal(true);
  };

  const openAddDetailForContact = (item: ContactWithDetails) => {
    setAddDetailTarget({
      type: 'contact',
      id: item.contact.id,
      name: item.contact.fullName,
      existingDetails: item.details,
      relationship: item.contact.relationship || '',
    });
    setShowAddDetailModal(true);
  };

  const contactDetails = useMemo(() => data?.contactDetails ?? [], [data?.contactDetails]);
  const activeContactCount = contactDetails.filter((contact) => contact.isCurrent).length;
  const pastContactCount = contactDetails.length - activeContactCount;

  const availableContactRoles = useMemo(() => {
    const roles = new Set<string>();
    contactDetails.forEach((item) => {
      cleanRelationships(item.contact.relationship).forEach((role) => roles.add(role));
    });
    return Array.from(roles).sort();
  }, [contactDetails]);

  const filteredContactDetails = useMemo(() => {
    return contactDetails.filter((item) => {
      // Name filter
      if (contactNameFilter) {
        const searchTerm = contactNameFilter.toLowerCase();
        if (!item.contact.fullName.toLowerCase().includes(searchTerm)) return false;
      }

      // Role filter
      if (contactRoleFilter) {
        const roles = cleanRelationships(item.contact.relationship);
        if (!roles.some((role) => role.toLowerCase() === contactRoleFilter.toLowerCase())) return false;
      }

      // Show ceased filter
      if (!showCeasedContacts && !item.isCurrent) return false;

      return true;
    });
  }, [contactDetails, contactNameFilter, contactRoleFilter, showCeasedContacts]);

  const hasActiveContactFilters = contactNameFilter || contactRoleFilter || showCeasedContacts;
  const hasProtectedContactRole = (relationship?: string) =>
    cleanRelationships(relationship).some(
      (rel) => rel.toLowerCase().includes('director') || rel.toLowerCase().includes('shareholder')
    );
  const canUnlinkContactFromModal = canEdit &&
    addDetailTarget.type === 'contact' &&
    !!addDetailTarget.relationship &&
    !hasProtectedContactRole(addDetailTarget.relationship);

  return (
    <>
      <div className="space-y-3">
        {/* Loading state */}
        {isLoading && (
          <div className="py-12 text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-oak-light" />
            <p className="text-sm text-text-secondary mt-2">Loading contact details...</p>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="py-8 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-status-error/10 text-status-error rounded-lg">
              <X className="w-4 h-4" />
              <span className="text-sm">
                {error instanceof Error ? error.message : 'Failed to load contact details'}
              </span>
            </div>
          </div>
        )}

        {data && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {/* Main column - Linked Contacts */}
            <div className="space-y-3 lg:col-span-2">
              <CompanyAccentSection
                title="Linked Contacts"
                actions={
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <span className="whitespace-nowrap text-xs font-medium">
                      {activeContactCount} active{pastContactCount > 0 ? ` · ${pastContactCount} past` : ''}
                    </span>
                    <CompanyAccentFilter label="Show ceased" checked={showCeasedContacts} onChange={setShowCeasedContacts} />
                    {contactDetails.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowContactFilters(!showContactFilters)}
                        className={`rounded p-1 transition-colors hover:bg-white/10 ${showContactFilters || hasActiveContactFilters ? 'bg-white/10' : ''}`}
                        title="Filter contacts"
                      >
                        <Filter className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {canEdit && (
                      <CompanyAccentButton onClick={() => setShowAddContactModal(true)}>
                        <Plus className="h-3.5 w-3.5" />
                        Add Contact
                      </CompanyAccentButton>
                    )}
                  </div>
                }
              >
                {/* Filter Panel */}
                {showContactFilters && (
                  <div className="flex flex-wrap items-end gap-3 border-b border-border-primary bg-surface-secondary px-3 py-2.5 animate-fade-in">
                    <div className="min-w-[120px] max-w-[180px] flex-1">
                      <label htmlFor="contact-name-filter" className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                        Name
                      </label>
                      <input
                        id="contact-name-filter"
                        type="text"
                        value={contactNameFilter}
                        onChange={(e) => setContactNameFilter(e.target.value)}
                        placeholder="Search..."
                        className="input input-xs w-full"
                      />
                    </div>
                    <div className="min-w-[140px]">
                      <label htmlFor="contact-role-filter" className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                        Role
                      </label>
                      <select
                        id="contact-role-filter"
                        value={contactRoleFilter}
                        onChange={(e) => setContactRoleFilter(e.target.value)}
                        className="input input-xs w-full"
                      >
                        <option value="">All Roles</option>
                        {availableContactRoles.map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                    </div>
                    {hasActiveContactFilters && (
                      <button
                        onClick={() => {
                          setContactNameFilter('');
                          setContactRoleFilter('');
                          setShowCeasedContacts(false);
                        }}
                        className="btn-ghost btn-xs text-text-muted hover:text-text-primary"
                      >
                        <X className="h-3.5 w-3.5" />
                        Clear
                      </button>
                    )}
                  </div>
                )}

                {contactDetails.length > 0 ? (
                  <>
                    <div className="divide-y divide-border-primary px-3">
                      {filteredContactDetails.map((item) => (
                        <ContactRow
                          key={item.contact.id}
                          item={item}
                          companyId={companyId}
                          canEdit={canEdit}
                          onAddDetail={() => openAddDetailForContact(item)}
                          onTogglePoc={(isPoc) => handleTogglePoc(item.contact.id, isPoc)}
                          isTogglingPoc={togglingPocContactId === item.contact.id}
                        />
                      ))}
                    </div>
                    {filteredContactDetails.length === 0 && (
                      <p className="px-3 py-3 text-sm text-text-secondary">No contacts match your filters</p>
                    )}
                  </>
                ) : (
                  <p className="px-3 py-3 text-sm text-text-secondary">No linked contacts</p>
                )}
              </CompanyAccentSection>
            </div>

            {/* Aside column - Company Contact Details */}
            <aside className="space-y-3">
              <CompanyAccentSection
                title="Company Contact Details"
                actions={
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <span className="whitespace-nowrap text-xs font-medium">
                      {data.companyDetails.length} {data.companyDetails.length === 1 ? 'detail' : 'details'}
                    </span>
                    {canEdit && (
                      <CompanyAccentButton onClick={openAddDetailForCompany}>
                        <Plus className="h-3.5 w-3.5" />
                        Add Detail
                      </CompanyAccentButton>
                    )}
                  </div>
                }
              >
                {data.companyDetails.length > 0 ? (
                  <div className="divide-y divide-border-primary px-3">
                    {data.companyDetails.map((detail) => (
                      <ContactDetailRow
                        key={detail.id}
                        detail={detail}
                        canEdit={canEdit}
                        isEditing={editingDetailId === detail.id}
                        editForm={editForm}
                        onStartEdit={() => startEdit(detail)}
                        onCancelEdit={cancelEdit}
                        onSaveEdit={handleUpdateDetail}
                        onDelete={() => setDeleteConfirm({ id: detail.id, value: detail.value })}
                        onUpdateForm={updateEditForm}
                        isSaving={updateDetailMutation.isPending}
                        isDeleting={deletingDetailId === detail.id}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="px-3 py-3 text-sm text-text-secondary">No company-level contact details</p>
                )}
              </CompanyAccentSection>
            </aside>
          </div>
        )}
      </div>

      {/* Add Detail Modal */}
      <AddContactDetailModal
        isOpen={showAddDetailModal}
        onClose={() => setShowAddDetailModal(false)}
        onSubmit={handleAddDetail}
        onUpdate={handleUpdateDetailFromModal}
        onDelete={handleDeleteDetailFromModal}
        onUnlinkContact={canUnlinkContactFromModal ? handleUnlinkContactFromModal : undefined}
        onReopen={openAddDetailForCompany}
        isLoading={createDetailMutation.isPending || updateDetailMutation.isPending}
        targetName={addDetailTarget.name}
        targetType={addDetailTarget.type}
        contactId={addDetailTarget.id}
        companyId={companyId}
        companyName={companyName}
        existingDetails={addDetailTarget.existingDetails}
      />

      {/* Link Contact Modal */}
      <LinkContactModal
        isOpen={showAddContactModal}
        onClose={() => setShowAddContactModal(false)}
        onSubmit={handleLinkContact}
        isLoading={linkContactMutation.isPending}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDeleteDetail}
        title="Delete Contact Detail"
        description={`Are you sure you want to delete "${deleteConfirm?.value}"? This action cannot be undone.`}
        variant="danger"
        confirmLabel="Delete"
        isLoading={deleteDetailMutation.isPending}
      />

    </>
  );
}
