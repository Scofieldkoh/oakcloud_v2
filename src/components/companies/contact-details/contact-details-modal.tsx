'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Mail,
  Phone,
  Plus,
  Trash2,
  Pencil,
  Building2,
  User,
  X,
  Check,
  Star,
  Loader2,
} from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { LoadingState } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';
import { CopyButton } from './copy-button';
import { PurposeToggle, PurposeBadges } from '@/components/contacts/purpose-toggle';
import {
  useCompanyContactDetails,
  useCreateContactDetail,
  useUpdateContactDetail,
  useDeleteContactDetail,
  type ContactDetail,
  type ContactWithDetails,
  type CreateContactDetailInput,
} from '@/hooks/use-contact-details';
import { useLinkContactToCompany, useUnlinkContactFromCompany } from '@/hooks/use-contacts';
import { ContactSearchSelect } from '@/components/ui/contact-search-select';
import type { ContactDetailType } from '@/generated/prisma';
import {
  DETAIL_TYPE_CONFIG,
  LABEL_SUGGESTIONS,
  RELATIONSHIP_OPTIONS,
} from '@/lib/constants/contact-details';
import { AddContactDetailModal } from './add-contact-detail-modal';

interface ContactDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  canEdit: boolean;
}

// ============================================================================
// LINK CONTACT MODAL
// ============================================================================

interface LinkContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (contactId: string, relationship: string) => Promise<void>;
  isLoading: boolean;
  companyName: string;
}

function LinkContactModal({ isOpen, onClose, onSubmit, isLoading, companyName }: LinkContactModalProps) {
  const [contactId, setContactId] = useState('');
  const [relationship, setRelationship] = useState('');

  const handleSubmit = async () => {
    await onSubmit(contactId, relationship);
    resetForm();
  };

  const resetForm = () => {
    setContactId('');
    setRelationship('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const isValid = contactId && relationship;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Link Contact" size="md">
      <ModalBody className="space-y-4">
        {/* Company indicator */}
        <div className="flex items-center gap-2 p-3 bg-surface-tertiary rounded-lg">
          <Building2 className="w-4 h-4 text-text-tertiary" aria-hidden="true" />
          <span className="text-sm text-text-secondary">Linking to:</span>
          <span className="text-sm font-medium text-text-primary">{companyName}</span>
        </div>

        {/* Contact Search */}
        <ContactSearchSelect
          label="Contact"
          value={contactId}
          onChange={(id) => setContactId(id)}
          placeholder="Search for a contact..."
        />

        {/* Relationship */}
        <div>
          <label className="label">Relationship</label>
          <select
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            className="input input-sm w-full"
          >
            <option value="">Select relationship...</option>
            {RELATIONSHIP_OPTIONS.map((rel) => (
              <option key={rel} value={rel}>{rel}</option>
            ))}
          </select>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={handleClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleSubmit} disabled={isLoading || !isValid}>
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Link Contact
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ============================================================================
// CONTACT DETAIL ROW
// ============================================================================

interface ContactDetailRowProps {
  detail: ContactDetail;
  canEdit: boolean;
  isEditing: boolean;
  editForm: {
    detailType: ContactDetailType;
    value: string;
    label: string;
    purposes: string[];
    isPrimary: boolean;
  };
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onUpdateForm: (field: string, value: string | string[] | boolean) => void;
  isSaving: boolean;
  isDeleting: boolean;
}

function ContactDetailRow({
  detail,
  canEdit,
  isEditing,
  editForm,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onUpdateForm,
  isSaving,
  isDeleting,
}: ContactDetailRowProps) {
  const config = DETAIL_TYPE_CONFIG[detail.detailType];
  const Icon = config.icon;

  if (isEditing && canEdit) {
    return (
      <div className="flex flex-col gap-2 p-3 bg-surface-secondary rounded-lg border border-oak-light/30">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={editForm.detailType}
            onChange={(e) => {
              const newType = e.target.value;
              onUpdateForm('detailType', newType);
              // Clear purposes when switching away from EMAIL
              if (newType !== 'EMAIL') {
                onUpdateForm('purposes', []);
              }
            }}
            className="input input-xs w-24"
          >
            {Object.entries(DETAIL_TYPE_CONFIG).map(([type, cfg]) => (
              <option key={type} value={type}>{cfg.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={editForm.value}
            onChange={(e) => onUpdateForm('value', e.target.value)}
            className="input input-xs flex-1 min-w-[150px]"
            placeholder="Value"
          />
          <input
            type="text"
            value={editForm.label}
            onChange={(e) => onUpdateForm('label', e.target.value)}
            className="input input-xs w-28"
            placeholder="Label"
            list="label-suggestions-edit"
          />
          <button
            onClick={() => onUpdateForm('isPrimary', !editForm.isPrimary)}
            className={`p-1.5 rounded ${editForm.isPrimary ? 'text-status-warning bg-status-warning/10' : 'text-text-muted hover:text-text-secondary'}`}
            aria-label={editForm.isPrimary ? 'Remove primary status' : 'Set as primary'}
            aria-pressed={editForm.isPrimary}
          >
            <Star className="w-4 h-4" fill={editForm.isPrimary ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        </div>
        {/* Purposes in edit mode - only for EMAIL type */}
        {editForm.detailType === 'EMAIL' && (
          <PurposeToggle
            selectedPurposes={editForm.purposes}
            onChange={(purposes) => onUpdateForm('purposes', purposes)}
            size="sm"
          />
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="xs" onClick={onCancelEdit} disabled={isSaving}>
            <X className="w-3.5 h-3.5 mr-1" />
            Cancel
          </Button>
          <Button variant="primary" size="xs" onClick={onSaveEdit} disabled={isSaving || !editForm.value.trim()}>
            {isSaving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
            Save
          </Button>
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
    <div className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-surface-secondary transition-colors group">
      <Icon className="w-4 h-4 text-text-tertiary flex-shrink-0" aria-hidden="true" />
      <span className="text-sm text-text-primary flex-1 truncate">{detail.value}</span>
      {detail.label && (
        <span className="text-xs text-text-muted bg-surface-tertiary px-1.5 py-0.5 rounded flex-shrink-0">
          {detail.label}
        </span>
      )}
      {/* Only show purposes for EMAIL type */}
      {detail.detailType === 'EMAIL' && detail.purposes && detail.purposes.length > 0 && (
        <PurposeBadges purposes={detail.purposes} className="hidden sm:flex flex-shrink-0" />
      )}
      {detail.isPrimary && (
        <Star className="w-3.5 h-3.5 text-status-warning flex-shrink-0" fill="currentColor" aria-label="Primary contact detail" />
      )}
      {canEdit && (
        <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onStartEdit}
            className="text-text-muted hover:text-oak-light p-1 rounded hover:bg-surface-tertiary"
            aria-label={`Edit ${detail.value}`}
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            onClick={onDelete}
            className="text-text-muted hover:text-status-error p-1 rounded hover:bg-surface-tertiary"
            aria-label={`Delete ${detail.value}`}
            disabled={isDeleting}
          >
            {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Helper to convert UPPERCASE to Title Case
// Preserves known acronyms like CEO, CFO
const KNOWN_ACRONYMS = ['CEO', 'CFO'];
function toTitleCase(str: string): string {
  return str
    .split(' ')
    .map(word => {
      const upper = word.toUpperCase();
      if (KNOWN_ACRONYMS.includes(upper)) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

// Helper to deduplicate and clean up relationships
// Removes generic "Shareholder" if there's a more specific one like "Ordinary Shareholder"
function cleanRelationships(relationshipStr: string | undefined): string[] {
  if (!relationshipStr) return [];

  const rawRoles = [...new Set(relationshipStr.split(', ').filter(Boolean))].map(toTitleCase);

  // Check if there's a specific shareholder type (e.g., "Ordinary Shareholder", "Preference Shareholder")
  const hasSpecificShareholder = rawRoles.some(r => r.includes('Shareholder') && r !== 'Shareholder');

  // Filter out generic "Shareholder" if there's a more specific one
  return rawRoles.filter(r => !(r === 'Shareholder' && hasSpecificShareholder));
}

function ContactRow({
  item,
  companyId,
  canEdit,
  onAddDetail,
}: {
  item: ContactWithDetails;
  companyId: string;
  canEdit: boolean;
  onAddDetail: () => void;
}) {
  // Parse relationship to show badges (deduplicated, cleaned, and in title case)
  const relationships = cleanRelationships(item.contact.relationship);

  // Get company-specific email/phone for THIS company, otherwise fall back to contact's default detail
  // Company-specific details must match the current company
  // Default details have contactId but companyId is null
  const companySpecificEmail = item.details.find(
    d => d.detailType === 'EMAIL' && d.companyId === companyId
  );
  const companySpecificPhone = item.details.find(
    d => d.detailType === 'PHONE' && d.companyId === companyId
  );
  const defaultEmail = item.details.find(
    d => d.detailType === 'EMAIL' && d.companyId === null
  );
  const defaultPhone = item.details.find(
    d => d.detailType === 'PHONE' && d.companyId === null
  );
  const displayedEmail = companySpecificEmail?.value || defaultEmail?.value || null;
  const displayedPhone = companySpecificPhone?.value || defaultPhone?.value || null;
  const emailDetail = companySpecificEmail || defaultEmail;
  const emailPurposes = emailDetail?.purposes || [];

  return (
    <div className="flex items-center gap-4 py-3 px-4 hover:bg-surface-secondary rounded-lg transition-colors group">
      {/* Name with link - 320px to fit ~40 characters */}
      <div className="flex-shrink-0 w-[320px] min-w-0">
        <Link
          href={`/contacts/${item.contact.id}`}
          className="font-medium text-text-primary hover:text-oak-light flex items-center gap-1.5 truncate"
        >
          {item.contact.contactType === 'CORPORATE' ? (
            <Building2 className="w-4 h-4 text-text-tertiary flex-shrink-0" aria-hidden="true" />
          ) : (
            <User className="w-4 h-4 text-text-tertiary flex-shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">{item.contact.fullName}</span>
        </Link>
      </div>

      {/* Relationship badges */}
      <div className="flex-shrink-0 w-[180px]">
        <div className="flex flex-wrap gap-1 items-center">
          {relationships.length > 0 ? (
            <>
              {relationships.slice(0, 2).map((rel, idx) => (
                <span key={idx} className="text-xs font-medium text-white bg-oak-light px-2 py-0.5 rounded">
                  {rel}
                </span>
              ))}
              {relationships.length > 2 && (
                <span
                  className="text-xs text-text-muted cursor-help relative group"
                  title={relationships.slice(2).join(', ')}
                >
                  +{relationships.length - 2}
                  {/* Tooltip */}
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                    {relationships.slice(2).join(', ')}
                  </span>
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-text-muted italic">No role</span>
          )}
        </div>
      </div>

      {/* Email */}
      <div className="flex-1 min-w-0">
        {displayedEmail ? (
          <div className="flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" aria-hidden="true" />
            <span className="text-sm text-text-secondary truncate">{displayedEmail}</span>
            <CopyButton value={displayedEmail} label="email address" />
            {emailPurposes.length > 0 && (
              <PurposeBadges purposes={emailPurposes} className="flex-shrink-0" />
            )}
          </div>
        ) : (
          <span className="text-xs text-text-muted italic">No email</span>
        )}
      </div>

      {/* Phone */}
      <div className="flex-shrink-0 w-[120px]">
        {displayedPhone ? (
          <div className="flex items-center gap-1.5">
            <Phone className="w-3.5 h-3.5 text-text-tertiary" aria-hidden="true" />
            <span className="text-sm text-text-secondary">{displayedPhone}</span>
            <CopyButton value={displayedPhone} label="phone number" />
          </div>
        ) : (
          <span className="text-xs text-text-muted italic">No phone</span>
        )}
      </div>

      {/* Actions */}
      {canEdit && (
        <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <button
            onClick={onAddDetail}
            className="text-oak-light hover:text-oak-dark p-1.5 rounded hover:bg-surface-tertiary"
            aria-label={`Add contact detail for ${item.contact.fullName}`}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN MODAL
// ============================================================================

export function ContactDetailsModal({
  isOpen,
  onClose,
  companyId,
  companyName,
  canEdit,
}: ContactDetailsModalProps) {
  const { success } = useToast();
  const { data, isLoading, error } = useCompanyContactDetails(isOpen ? companyId : null);

  const createDetailMutation = useCreateContactDetail(companyId);
  const updateDetailMutation = useUpdateContactDetail(companyId);
  const deleteDetailMutation = useDeleteContactDetail(companyId);
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

  // State for editing
  const [editingDetailId, setEditingDetailId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    detailType: ContactDetailType;
    value: string;
    label: string;
    purposes: string[];
    isPrimary: boolean;
  }>({
    detailType: 'EMAIL',
    value: '',
    label: '',
    purposes: [],
    isPrimary: false,
  });

  // State for delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; value: string } | null>(null);
  const [deletingDetailId, setDeletingDetailId] = useState<string | null>(null);


  const handleAddDetail = async (input: CreateContactDetailInput) => {
    try {
      await createDetailMutation.mutateAsync(input);
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

  const startEdit = (detail: ContactDetail) => {
    setEditingDetailId(detail.id);
    setEditForm({
      detailType: detail.detailType,
      value: detail.value,
      label: detail.label || '',
      purposes: detail.purposes || [],
      isPrimary: detail.isPrimary,
    });
  };

  const cancelEdit = () => {
    setEditingDetailId(null);
    setEditForm({ detailType: 'EMAIL', value: '', label: '', purposes: [], isPrimary: false });
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
      <Modal isOpen={isOpen} onClose={onClose} title="Contact Details" size="6xl">
        <ModalBody className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <div className="space-y-6">
            {/* Company Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">{companyName}</h3>
                <p className="text-sm text-text-secondary mt-1">
                  Manage contact details for this company and linked contacts
                </p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={openAddDetailForCompany}>
                    <Plus className="w-4 h-4 mr-1.5" />
                    Add Detail
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => setShowAddContactModal(true)}>
                    <User className="w-4 h-4 mr-1.5" />
                    Add Contact
                  </Button>
                </div>
              )}
            </div>

            {/* Loading state */}
            {isLoading && (
              <LoadingState message="Loading contact details..." size="lg" />
            )}

            {/* Error state */}
            {error && (
              <ErrorState error={error} size="lg" />
            )}

            {data && (
              <>
                {/* Company-level Contact Details */}
                <div className="card">
                  <div className="px-4 py-3 border-b border-border-primary">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-text-primary flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-text-tertiary" aria-hidden="true" />
                          Company Contact Details
                        </h4>
                        <p className="text-xs text-text-secondary mt-1">
                          Contact information directly associated with the company
                        </p>
                      </div>
                      <span className="text-xs text-text-muted bg-surface-tertiary px-2.5 py-1 rounded-full">
                        {data.companyDetails.length} {data.companyDetails.length === 1 ? 'detail' : 'details'}
                      </span>
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    {data.companyDetails.length > 0 ? (
                      <div className="overflow-x-auto overflow-y-hidden">
                        <div className="w-max min-w-[860px] space-y-1">
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
                      </div>
                    ) : (
                      <div className="text-center py-6">
                        <Building2 className="w-8 h-8 text-text-muted mx-auto mb-2" aria-hidden="true" />
                        <p className="text-sm text-text-muted">No company-level contact details</p>
                        {canEdit && (
                          <button
                            onClick={openAddDetailForCompany}
                            className="text-sm text-oak-light hover:text-oak-dark mt-2 inline-flex items-center gap-1"
                          >
                            <Plus className="w-4 h-4" aria-hidden="true" />
                            Add first detail
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Linked Contacts */}
                <div className="card">
                  <div className="px-4 py-3 border-b border-border-primary">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-text-primary flex items-center gap-2">
                          <User className="w-4 h-4 text-text-tertiary" aria-hidden="true" />
                          Linked Contacts
                        </h4>
                        <p className="text-xs text-text-secondary mt-1">
                          Directors, officers, shareholders, and other contacts linked to this company
                        </p>
                      </div>
                      <span className="text-xs text-text-muted bg-surface-tertiary px-2.5 py-1 rounded-full">
                        {data.contactDetails.length} {data.contactDetails.length === 1 ? 'contact' : 'contacts'}
                      </span>
                    </div>
                  </div>
                  <div className="py-2">
                    {data.contactDetails.length > 0 ? (
                      <>
                        <div className="overflow-x-auto overflow-y-hidden">
                          <div className="w-max min-w-[1040px]">
                            {/* Header row */}
                            <div className="flex w-full items-center gap-2.5 lg:gap-4 py-2 px-3 lg:px-4 text-xs font-medium text-text-muted border-b border-border-secondary">
                              <div className="flex-shrink-0 w-[280px] lg:w-[360px]">Name</div>
                              <div className="flex-shrink-0 w-[220px] lg:w-[300px]">Role</div>
                              <div className="flex-shrink-0 w-[72px] lg:w-[80px] text-center">POC</div>
                              <div className="flex-shrink-0 w-[170px] lg:w-[210px]">Phone</div>
                              <div className="flex-1 min-w-[220px]">Email</div>
                              <div className="flex-shrink-0 w-[56px]"></div>
                            </div>
                            {/* Contact rows */}
                            <div className="w-full divide-y divide-border-secondary">
                              {data.contactDetails.map((item) => (
                                <ContactRow
                                  key={item.contact.id}
                                  item={item}
                                  companyId={companyId}
                                  canEdit={canEdit}
                                  onAddDetail={() => openAddDetailForContact(item)}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-8">
                        <User className="w-8 h-8 text-text-muted mx-auto mb-2" aria-hidden="true" />
                        <p className="text-sm text-text-muted">No linked contacts</p>
                        {canEdit && (
                          <button
                            onClick={() => setShowAddContactModal(true)}
                            className="text-sm text-oak-light hover:text-oak-dark mt-2 inline-flex items-center gap-1"
                          >
                            <Plus className="w-4 h-4" aria-hidden="true" />
                            Add first contact
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </ModalBody>
      </Modal>

      {/* Add Detail Modal */}
      <AddContactDetailModal
        isOpen={showAddDetailModal}
        onClose={() => setShowAddDetailModal(false)}
        onSubmit={handleAddDetail}
        onUpdate={handleUpdateDetailFromModal}
        onDelete={handleDeleteDetailFromModal}
        onUnlinkContact={canUnlinkContactFromModal ? handleUnlinkContactFromModal : undefined}
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
        companyName={companyName}
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
