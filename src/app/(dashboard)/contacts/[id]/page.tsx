'use client';

import { use, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  User,
  AlertCircle,
  Building2,
  RefreshCw,
  Pencil,
  Trash2,
  Tags,
} from 'lucide-react';
import { useContact, useDeleteContact, useLinkContactToCompany, useUnlinkContactFromCompany, useRemoveOfficerPosition, useRemoveShareholding, useUpdateOfficerPosition, useUpdateShareholding, useContactLinkInfo } from '@/hooks/use-contacts';
import { useCompanies } from '@/hooks/use-companies';
import { usePermissions } from '@/hooks/use-permissions';
import { formatDate } from '@/lib/utils';
import { OFFICER_ROLES } from '@/lib/constants';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { AsyncSearchSelect, type AsyncSearchSelectOption } from '@/components/ui/async-search-select';
import { useToast } from '@/components/ui/toast';
import { CompanyRelationships } from '@/components/contacts/company-relationships';
import { ContactDetailsSection } from '@/components/contacts/contact-details-section';
import { CompanyAccentSection, CompanyAccentButton, CompanyFieldLabel } from '@/components/companies/company-accent-section';
import { ContactAliasesModal } from '@/components/contacts/contact-aliases-modal';
import { InternalNotes } from '@/components/notes/internal-notes';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { getSafeListReturnUrl } from '@/lib/list-navigation';
import type { ContactType, IdentificationType } from '@/generated/prisma';

// Company option type for AsyncSearchSelect
interface CompanyOption extends AsyncSearchSelectOption {
  uen?: string | null;
}

const contactTypeConfig: Record<ContactType, { color: string; label: string }> = {
  INDIVIDUAL: { color: 'badge-info', label: 'Individual' },
  CORPORATE: { color: 'badge-neutral', label: 'Corporate' },
};

const idTypeLabels: Record<IdentificationType, string> = {
  NRIC: 'NRIC',
  FIN: 'FIN',
  PASSPORT: 'Passport',
  UEN: 'UEN',
  OTHER: 'Other',
};

// Officer roles derived from centralized constants (creates Officer records)
const officerRoleLabels = OFFICER_ROLES.map((r) => r.label);

// Additional roles not in Prisma enum but used for UI linking
const additionalOfficerRoles = ['Authorized Representative'];

// Combined officer roles for UI
const officerRoles = [...officerRoleLabels, ...additionalOfficerRoles];

// General relationships that create CompanyContact records
const generalRelationships = ['Nominee', 'Beneficial Owner', 'Other'];

// All relationship options
const _relationshipOptions = [...officerRoles, 'Shareholder', ...generalRelationships];

export default function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { id } = use(params);
  const resolvedSearchParams = use(searchParams);
  const rawReturnTo = Array.isArray(resolvedSearchParams.returnTo)
    ? resolvedSearchParams.returnTo[0]
    : resolvedSearchParams.returnTo;
  const backHref = getSafeListReturnUrl(rawReturnTo, '/contacts');
  const router = useRouter();
  const { data: contact, isLoading, error, refetch, isFetching } = useContact(id);
  const deleteContact = useDeleteContact();
  const linkContact = useLinkContactToCompany();
  const unlinkContact = useUnlinkContactFromCompany();
  const removeOfficer = useRemoveOfficerPosition();
  const removeShareholder = useRemoveShareholding();
  const updateOfficer = useUpdateOfficerPosition();
  const updateShareholder = useUpdateShareholding();
  const { success, error: toastError } = useToast();
  const { can } = usePermissions();

  // Company search state with debounce for async search
  const [companySearchQuery, setCompanySearchQuery] = useState('');
  const [debouncedCompanyQuery, setDebouncedCompanyQuery] = useState('');

  // Debounce company search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCompanyQuery(companySearchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [companySearchQuery]);

  // Fetch companies for linking modal - filter by contact's tenant to prevent cross-tenant linking
  const { data: companiesData, isLoading: companiesLoading } = useCompanies({
    query: debouncedCompanyQuery || undefined,
    limit: 50,
    sortBy: 'name',
    sortOrder: 'asc',
    tenantId: contact?.tenantId,
  });

  // Transform companies to AsyncSearchSelect options
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

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [aliasesModalOpen, setAliasesModalOpen] = useState(false);
  const [editOfficerModalOpen, setEditOfficerModalOpen] = useState(false);
  const [editShareholderModalOpen, setEditShareholderModalOpen] = useState(false);
  const [selectedOfficer, setSelectedOfficer] = useState<{
    id: string;
    companyId: string;
    role: string;
    appointmentDate: string | null;
    cessationDate: string | null;
  } | null>(null);
  const [selectedShareholderEdit, setSelectedShareholderEdit] = useState<{
    id: string;
    companyId: string;
    shareClass: string;
    numberOfShares: number;
  } | null>(null);
  const [editOfficerForm, setEditOfficerForm] = useState({
    role: '',
    appointmentDate: '',
    cessationDate: '',
  });
  const [editShareholderForm, setEditShareholderForm] = useState({
    numberOfShares: '',
    shareClass: '',
  });

  // Fetch link info when delete dialog opens
  const { data: linkInfo } = useContactLinkInfo(deleteDialogOpen ? id : null);

  // Build warning message based on links
  const getDeleteWarning = () => {
    if (!linkInfo?.hasLinks) {
      return 'This action cannot be undone.';
    }

    const parts: string[] = [];
    if (linkInfo.companyRelationCount > 0) parts.push(`${linkInfo.companyRelationCount} company relation(s)`);
    if (linkInfo.officerPositionCount > 0) parts.push(`${linkInfo.officerPositionCount} officer position(s)`);
    if (linkInfo.shareholdingCount > 0) parts.push(`${linkInfo.shareholdingCount} shareholding(s)`);
    if (linkInfo.chargeHolderCount > 0) parts.push(`${linkInfo.chargeHolderCount} charge holder record(s)`);

    return `Warning: This contact has ${parts.join(', ')} linked. Deleting will remove these links, but the underlying company data will remain. This action cannot be undone.`;
  };
  const [unlinkDialogOpen, setUnlinkDialogOpen] = useState(false);
  const [selectedLink, setSelectedLink] = useState<{
    companyId: string;
    relationship: string;
  } | null>(null);
  const [linkForm, setLinkForm] = useState({
    companyId: '',
    relationship: '',
    isPrimary: false,
    appointmentDate: '',
    numberOfShares: '',
    shareClass: 'Ordinary',
  });

  const handleDeleteConfirm = async (reason?: string) => {
    if (!reason) return;

    try {
      await deleteContact.mutateAsync({ id, reason });
      success('Contact deleted successfully');
      router.push(backHref);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to delete contact');
    }
  };

  const handleLinkCompany = async () => {
    if (!linkForm.companyId || !linkForm.relationship) {
      toastError('Please select a company and relationship');
      return;
    }

    // Validate based on relationship type
    const isOfficerRole = officerRoles.includes(linkForm.relationship);
    const isShareholder = linkForm.relationship === 'Shareholder';

    if (isShareholder && !linkForm.numberOfShares) {
      toastError('Please enter number of shares');
      return;
    }

    try {
      await linkContact.mutateAsync({
        contactId: id,
        companyId: linkForm.companyId,
        relationship: linkForm.relationship,
        isPrimary: linkForm.isPrimary,
        // Officer-specific fields
        appointmentDate: isOfficerRole && linkForm.appointmentDate ? linkForm.appointmentDate : undefined,
        // Shareholder-specific fields
        numberOfShares: isShareholder ? parseInt(linkForm.numberOfShares) || 0 : undefined,
        shareClass: isShareholder ? linkForm.shareClass : undefined,
      });
      success('Contact linked to company successfully');
      setLinkModalOpen(false);
      setLinkForm({ companyId: '', relationship: '', isPrimary: false, appointmentDate: '', numberOfShares: '', shareClass: 'Ordinary' });
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to link contact');
    }
  };

  const handleUnlinkCompany = async () => {
    if (!selectedLink) return;

    try {
      await unlinkContact.mutateAsync({
        contactId: id,
        companyId: selectedLink.companyId,
        relationship: selectedLink.relationship,
      });
      success('Contact unlinked from company successfully');
      setUnlinkDialogOpen(false);
      setSelectedLink(null);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to unlink contact');
    }
  };

  const handleEditOfficer = async () => {
    if (!selectedOfficer) return;

    // Validate cessation date is not earlier than appointment date
    if (editOfficerForm.appointmentDate && editOfficerForm.cessationDate) {
      const appointmentDate = new Date(editOfficerForm.appointmentDate);
      const cessationDate = new Date(editOfficerForm.cessationDate);
      if (cessationDate < appointmentDate) {
        toastError('Cessation date cannot be earlier than appointment date');
        return;
      }
    }

    try {
      await updateOfficer.mutateAsync({
        contactId: id,
        officerId: selectedOfficer.id,
        companyId: selectedOfficer.companyId,
        data: {
          role: editOfficerForm.role || null,
          appointmentDate: editOfficerForm.appointmentDate || null,
          cessationDate: editOfficerForm.cessationDate || null,
        },
      });
      success('Officer position updated successfully');
      setEditOfficerModalOpen(false);
      setSelectedOfficer(null);
      setEditOfficerForm({ role: '', appointmentDate: '', cessationDate: '' });
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to update officer position');
    }
  };

  const handleEditShareholder = async () => {
    if (!selectedShareholderEdit) return;

    try {
      await updateShareholder.mutateAsync({
        contactId: id,
        shareholderId: selectedShareholderEdit.id,
        companyId: selectedShareholderEdit.companyId,
        data: {
          numberOfShares: parseInt(editShareholderForm.numberOfShares) || undefined,
          shareClass: editShareholderForm.shareClass || undefined,
        },
      });
      success('Shareholding updated successfully');
      setEditShareholderModalOpen(false);
      setSelectedShareholderEdit(null);
      setEditShareholderForm({ numberOfShares: '', shareClass: '' });
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to update shareholding');
    }
  };

  const handleRefresh = () => {
    refetch();
  };

  useKeyboardShortcuts([
    {
      key: 'Backspace',
      ctrl: true,
      handler: () => router.push(backHref),
      description: 'Back to contacts',
    },
    {
      key: 'r',
      ctrl: true,
      handler: handleRefresh,
      description: 'Refresh contact',
    },
    ...(can.createContact ? [{
      key: 'F1',
      handler: () => router.push('/contacts/new'),
      description: 'Create contact',
    }] : []),
    ...(can.updateContact ? [{
      key: 'e',
      ctrl: true,
      handler: () => router.push(`/contacts/${id}/edit`),
      description: 'Edit contact',
    }] : []),
  ], !deleteDialogOpen && !unlinkDialogOpen && !linkModalOpen && !editOfficerModalOpen && !editShareholderModalOpen && !aliasesModalOpen);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-64 skeleton" />
          <div className="h-4 w-48 skeleton" />
          <div className="grid grid-cols-3 gap-6">
            <div className="h-32 skeleton rounded-lg" />
            <div className="h-32 skeleton rounded-lg" />
            <div className="h-32 skeleton rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div className="p-6">
        <div className="card p-8 text-center">
          <AlertCircle className="w-12 h-12 text-status-error mx-auto mb-4" />
          <h2 className="text-lg font-medium text-text-primary mb-2">Contact not found</h2>
          <p className="text-text-secondary mb-4">
            {error instanceof Error ? error.message : 'The contact you are looking for does not exist.'}
          </p>
          <Link href={backHref} className="btn-primary btn-sm inline-flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Contacts
          </Link>
        </div>
      </div>
    );
  }

  const currentTypeConfig = contactTypeConfig[contact.contactType];

  // Filter out companies that are already linked with the same relationship
  const _linkedCompanyIds = new Set(
    contact.companyRelations?.map((r) => `${r.company.id}-${r.relationship}`) || []
  );

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-3 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Contacts
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">
              {contact.fullName}
            </h1>
            <span className={`badge ${currentTypeConfig.color}`}>{currentTypeConfig.label}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {can.createContact && (
            <Link
              href="/contacts/new"
              className="btn-primary btn-sm flex items-center gap-2"
              title="Add Contact (F1)"
            >
              <User className="w-4 h-4" />
              <span className="hidden sm:inline">Add Contact (F1)</span>
              <span className="sm:hidden">Add</span>
            </Link>
          )}
          <button
            onClick={handleRefresh}
            className="btn-secondary btn-sm flex items-center gap-2"
            title="Refresh (Ctrl+R)"
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh (Ctrl+R)</span>
            <span className="sm:hidden">Refresh</span>
          </button>
          {can.updateContact && (
            <Link
              href={`/contacts/${id}/edit`}
              className="btn-secondary btn-sm flex items-center gap-2"
              title="Edit (Ctrl+E)"
            >
                <Pencil className="w-4 h-4" />
                <span className="hidden sm:inline">Edit (Ctrl+E)</span>
                <span className="sm:hidden">Edit</span>
              </Link>
          )}
          {can.deleteContact && (
            <button
              onClick={() => setDeleteDialogOpen(true)}
              className="btn-danger btn-sm flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-3">
          {/* Contact Information */}
          <CompanyAccentSection
            title="Contact Information"
            actions={
              <CompanyAccentButton onClick={() => setAliasesModalOpen(true)}>
                <Tags className="h-3.5 w-3.5" />
                Manage Aliases
              </CompanyAccentButton>
            }
          >
            <div className="grid grid-cols-1 gap-4 p-3 text-sm sm:grid-cols-2 sm:gap-8 lg:grid-cols-3">
              {contact.contactType === 'INDIVIDUAL' ? (
                <>
                  <div>
                    <CompanyFieldLabel>First Name</CompanyFieldLabel>
                    <p className="text-text-primary">{contact.firstName || '-'}</p>
                  </div>
                  <div>
                    <CompanyFieldLabel>Last Name</CompanyFieldLabel>
                    <p className="text-text-primary">{contact.lastName || '-'}</p>
                  </div>
                  <div>
                    <CompanyFieldLabel>Alias</CompanyFieldLabel>
                    <p className="text-text-primary">{contact.alias || '-'}</p>
                  </div>
                  <div>
                    <CompanyFieldLabel>Nationality</CompanyFieldLabel>
                    <p className="text-text-primary">{contact.nationality || '-'}</p>
                  </div>
                  <div>
                    <CompanyFieldLabel>ID Type</CompanyFieldLabel>
                    <p className="text-text-primary">
                      {contact.identificationType
                        ? idTypeLabels[contact.identificationType]
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <CompanyFieldLabel>ID Number</CompanyFieldLabel>
                    <p className="text-text-primary">{contact.identificationNumber || '-'}</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="sm:col-span-2 lg:col-span-2">
                    <CompanyFieldLabel>Corporate Name</CompanyFieldLabel>
                    <p className="text-text-primary">{contact.corporateName || '-'}</p>
                  </div>
                  <div>
                    <CompanyFieldLabel>UEN</CompanyFieldLabel>
                    <p className="text-text-primary">{contact.corporateUen || '-'}</p>
                  </div>
                </>
              )}
            </div>
          </CompanyAccentSection>

          {/* Contact Details - Full grouped view with default and company-specific */}
          <ContactDetailsSection contactId={id} contactName={contact.fullName} canEdit={can.updateContact} />

          {/* Address */}
          {contact.fullAddress && (
            <CompanyAccentSection title="Address">
              <p className="p-3 text-sm text-text-primary">{contact.fullAddress}</p>
            </CompanyAccentSection>
          )}

          {/* Company Relationships (Unified View) */}
          <CompanyRelationships
            companyRelations={contact.companyRelations}
            officerPositions={contact.officerPositions}
            shareholdings={contact.shareholdings}
            hiddenCompanyCount={contact.hiddenCompanyCount}
            canUpdate={can.updateContact}
            onLinkCompany={() => setLinkModalOpen(true)}
            onUnlinkCompany={(companyId, relationship) => {
              setSelectedLink({ companyId, relationship });
              setUnlinkDialogOpen(true);
            }}
            onUnlinkOfficer={async (officerId, companyId) => {
              try {
                await removeOfficer.mutateAsync({ contactId: id, officerId, companyId });
                success('Officer position removed successfully');
              } catch (err) {
                toastError(err instanceof Error ? err.message : 'Failed to remove officer position');
              }
            }}
            onUnlinkShareholder={async (shareholderId, companyId) => {
              try {
                await removeShareholder.mutateAsync({ contactId: id, shareholderId, companyId });
                success('Shareholding removed successfully');
              } catch (err) {
                toastError(err instanceof Error ? err.message : 'Failed to remove shareholding');
              }
            }}
            onEditOfficer={(officer, companyId) => {
              setSelectedOfficer({
                id: officer.id,
                companyId,
                role: officer.role,
                appointmentDate: officer.appointmentDate,
                cessationDate: officer.cessationDate,
              });
              // Pre-fill form with existing values (convert date strings to YYYY-MM-DD format)
              setEditOfficerForm({
                role: officer.role,
                appointmentDate: officer.appointmentDate ? officer.appointmentDate.split('T')[0] : '',
                cessationDate: officer.cessationDate ? officer.cessationDate.split('T')[0] : '',
              });
              setEditOfficerModalOpen(true);
            }}
            onEditShareholder={(shareholder, companyId) => {
              setSelectedShareholderEdit({
                id: shareholder.id,
                companyId,
                shareClass: shareholder.shareClass,
                numberOfShares: shareholder.numberOfShares,
              });
              // Pre-fill form with existing values
              setEditShareholderForm({
                numberOfShares: shareholder.numberOfShares.toString(),
                shareClass: shareholder.shareClass,
              });
              setEditShareholderModalOpen(true);
            }}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-3">
          {/* Quick Stats */}
          <CompanyAccentSection title="Summary">
            <div className="divide-y divide-border-primary px-3 text-sm">
              <div className="flex items-center justify-between py-3">
                <span className="text-text-secondary">Linked Companies</span>
                <span className="font-medium text-text-primary">
                  {(() => {
                    // Count unique companies across all current (non-ceased) relationship types
                    const companyIds = new Set<string>();
                    contact.companyRelations?.forEach((r) => companyIds.add(r.company.id));
                    contact.officerPositions?.filter((p) => p.isCurrent).forEach((p) => companyIds.add(p.company.id));
                    contact.shareholdings?.filter((s) => s.isCurrent).forEach((s) => companyIds.add(s.company.id));
                    return companyIds.size;
                  })()}
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-text-secondary">Officer Positions</span>
                <span className="font-medium text-text-primary">
                  {contact.officerPositions?.filter((p) => p.isCurrent).length || 0}
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-text-secondary">Shareholdings</span>
                <span className="font-medium text-text-primary">
                  {contact.shareholdings?.filter((s) => s.isCurrent).length || 0}
                </span>
              </div>
            </div>
          </CompanyAccentSection>

          {/* Audit History */}
          <CompanyAccentSection title="Audit History">
            <div className="space-y-3 p-3 text-sm">
              <div>
                <CompanyFieldLabel>Created</CompanyFieldLabel>
                <p className="text-text-primary">{formatDate(contact.createdAt)}</p>
              </div>
              <div className="border-t border-border-primary pt-3">
                <CompanyFieldLabel>Last Updated</CompanyFieldLabel>
                <p className="text-text-primary">{formatDate(contact.updatedAt)}</p>
              </div>
              <div className="border-t border-border-primary pt-3">
                <CompanyFieldLabel>Status</CompanyFieldLabel>
                <span className={`badge ${contact.isActive ? 'badge-success' : 'badge-neutral'}`}>
                  {contact.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            <div className="border-t border-border-primary p-3">
              <Link
                href={`/contacts/${id}/audit`}
                className="btn-secondary btn-sm w-full justify-center"
              >
                View History
              </Link>
            </div>
          </CompanyAccentSection>
        </div>
      </div>

      {/* Internal Notes - Full Width */}
      <InternalNotes
        entityType="contact"
        entityId={id}
        canEdit={can.updateContact}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Contact"
        description={`Are you sure you want to delete "${contact?.fullName}"? ${getDeleteWarning()}`}
        confirmLabel="Delete"
        variant="danger"
        requireReason
        reasonLabel="Reason for deletion"
        reasonPlaceholder="Please provide a reason for deleting this contact..."
        reasonMinLength={10}
        isLoading={deleteContact.isPending}
      />

      {/* Link Company Modal */}
      <Modal
        isOpen={linkModalOpen}
        onClose={() => {
          setLinkModalOpen(false);
          setLinkForm({ companyId: '', relationship: '', isPrimary: false, appointmentDate: '', numberOfShares: '', shareClass: 'Ordinary' });
          setCompanySearchQuery('');
        }}
        title="Link Contact to Company"
        size="lg"
      >
        <ModalBody>
          <div className="space-y-4">
            <div>
              <label className="label">Company</label>
              <AsyncSearchSelect<CompanyOption>
                value={linkForm.companyId}
                onChange={(id) => setLinkForm((prev) => ({ ...prev, companyId: id }))}
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
            <div>
              <label className="label">Role / Relationship</label>
              <select
                value={linkForm.relationship}
                onChange={(e) => setLinkForm((prev) => ({ ...prev, relationship: e.target.value }))}
                className="input input-sm w-full"
              >
                <option value="">Select role</option>
                <optgroup label="Officer Roles">
                  {officerRoles.map((rel) => (
                    <option key={rel} value={rel}>{rel}</option>
                  ))}
                </optgroup>
                <optgroup label="Shareholder">
                  <option value="Shareholder">Shareholder</option>
                </optgroup>
                <optgroup label="Other Relationships">
                  {generalRelationships.map((rel) => (
                    <option key={rel} value={rel}>{rel}</option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Officer-specific fields */}
            {officerRoles.includes(linkForm.relationship) && (
              <div>
                <label className="label">Date of Appointment</label>
                <input
                  type="date"
                  value={linkForm.appointmentDate}
                  onChange={(e) => setLinkForm((prev) => ({ ...prev, appointmentDate: e.target.value }))}
                  className="input input-sm w-full"
                />
              </div>
            )}

            {/* Shareholder-specific fields */}
            {linkForm.relationship === 'Shareholder' && (
              <>
                <div>
                  <label className="label">Number of Shares *</label>
                  <input
                    type="number"
                    min="1"
                    value={linkForm.numberOfShares}
                    onChange={(e) => setLinkForm((prev) => ({ ...prev, numberOfShares: e.target.value }))}
                    className="input input-sm w-full"
                    placeholder="Enter number of shares"
                  />
                </div>
                <div>
                  <label className="label">Share Class</label>
                  <select
                    value={linkForm.shareClass}
                    onChange={(e) => setLinkForm((prev) => ({ ...prev, shareClass: e.target.value }))}
                    className="input input-sm w-full"
                  >
                    <option value="Ordinary">Ordinary</option>
                    <option value="Preference">Preference</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </>
            )}

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isPrimary"
                checked={linkForm.isPrimary}
                onChange={(e) => setLinkForm((prev) => ({ ...prev, isPrimary: e.target.checked }))}
                className="rounded border-border-primary"
              />
              <label htmlFor="isPrimary" className="text-sm text-text-secondary">
                Set as primary contact for this company
              </label>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <button
            onClick={() => {
              setLinkModalOpen(false);
              setLinkForm({ companyId: '', relationship: '', isPrimary: false, appointmentDate: '', numberOfShares: '', shareClass: 'Ordinary' });
            }}
            className="btn-secondary btn-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleLinkCompany}
            disabled={linkContact.isPending}
            className="btn-primary btn-sm"
          >
            {linkContact.isPending ? 'Linking...' : 'Link'}
          </button>
        </ModalFooter>
      </Modal>

      {/* Unlink Confirmation Dialog */}
      <ConfirmDialog
        isOpen={unlinkDialogOpen}
        onClose={() => {
          setUnlinkDialogOpen(false);
          setSelectedLink(null);
        }}
        onConfirm={handleUnlinkCompany}
        title="Unlink Company"
        description="Are you sure you want to remove this company relationship? This can be re-added later."
        confirmLabel="Unlink"
        variant="danger"
        isLoading={unlinkContact.isPending}
      />

      {/* Edit Officer Modal */}
      <Modal
        isOpen={editOfficerModalOpen}
        onClose={() => {
          setEditOfficerModalOpen(false);
          setSelectedOfficer(null);
          setEditOfficerForm({ role: '', appointmentDate: '', cessationDate: '' });
        }}
        title="Edit Officer Position"
      >
        <ModalBody>
          <div className="space-y-4">
            <div>
              <label className="label">Role</label>
              <select
                value={editOfficerForm.role}
                onChange={(e) => setEditOfficerForm((prev) => ({ ...prev, role: e.target.value }))}
                className="input input-sm w-full"
              >
                {OFFICER_ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Date of Appointment</label>
              <input
                type="date"
                value={editOfficerForm.appointmentDate}
                onChange={(e) => setEditOfficerForm((prev) => ({ ...prev, appointmentDate: e.target.value }))}
                className="input input-sm w-full"
              />
            </div>
            <div>
              <label className="label">Date of Cessation</label>
              <input
                type="date"
                value={editOfficerForm.cessationDate}
                onChange={(e) => setEditOfficerForm((prev) => ({ ...prev, cessationDate: e.target.value }))}
                className="input input-sm w-full"
              />
              <p className="text-xs text-text-muted mt-1">Leave empty if the position is still active</p>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <button
            onClick={() => {
              setEditOfficerModalOpen(false);
              setSelectedOfficer(null);
              setEditOfficerForm({ role: '', appointmentDate: '', cessationDate: '' });
            }}
            className="btn-secondary btn-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleEditOfficer}
            disabled={updateOfficer.isPending}
            className="btn-primary btn-sm"
          >
            {updateOfficer.isPending ? 'Saving...' : 'Save'}
          </button>
        </ModalFooter>
      </Modal>

      {/* Edit Shareholder Modal */}
      <Modal
        isOpen={editShareholderModalOpen}
        onClose={() => {
          setEditShareholderModalOpen(false);
          setSelectedShareholderEdit(null);
          setEditShareholderForm({ numberOfShares: '', shareClass: '' });
        }}
        title="Edit Shareholding"
      >
        <ModalBody>
          <div className="space-y-4">
            <div>
              <label className="label">Number of Shares</label>
              <input
                type="number"
                min="1"
                value={editShareholderForm.numberOfShares}
                onChange={(e) => setEditShareholderForm((prev) => ({ ...prev, numberOfShares: e.target.value }))}
                className="input input-sm w-full"
                placeholder="Enter number of shares"
              />
            </div>
            <div>
              <label className="label">Share Class</label>
              <select
                value={editShareholderForm.shareClass}
                onChange={(e) => setEditShareholderForm((prev) => ({ ...prev, shareClass: e.target.value }))}
                className="input input-sm w-full"
              >
                <option value="Ordinary">Ordinary</option>
                <option value="Preference">Preference</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <button
            onClick={() => {
              setEditShareholderModalOpen(false);
              setSelectedShareholderEdit(null);
              setEditShareholderForm({ numberOfShares: '', shareClass: '' });
            }}
            className="btn-secondary btn-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleEditShareholder}
            disabled={updateShareholder.isPending}
            className="btn-primary btn-sm"
          >
            {updateShareholder.isPending ? 'Saving...' : 'Save'}
          </button>
        </ModalFooter>
      </Modal>

      {/* Contact Aliases Modal */}
      <ContactAliasesModal
        isOpen={aliasesModalOpen}
        onClose={() => setAliasesModalOpen(false)}
        contactId={id}
        contactName={contact.fullName}
        canEdit={can.updateContact}
      />
    </div>
  );
}
