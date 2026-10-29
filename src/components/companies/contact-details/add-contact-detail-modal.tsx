'use client';

import { useState, useEffect, useCallback } from 'react';
import { Building2, User, Loader2, Phone, Mail, Trash2 } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PurposeToggle } from '@/components/contacts/purpose-toggle';
import { CompanySelect } from '@/components/ui/company-select';
import type { CompanySearchOption } from '@/hooks/use-company-search';
import type { DetailScope } from '@/components/ui/scope-toggle';
import type { ContactDetailType } from '@/generated/prisma';
import type { CreateContactDetailInput, ContactDetail } from '@/hooks/use-contact-details';
import {
  DETAIL_TYPE_CONFIG,
  getInputType,
} from '@/lib/constants/contact-details';

interface AddContactDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateContactDetailInput & {
    isCompanySpecific?: boolean;
    selectedCompanyId?: string;
  }) => Promise<void>;
  onUpdate?: (detailId: string, data: { value: string; label?: string | null; purposes?: string[]; isPoc?: boolean }) => Promise<void>;
  onDelete?: (detailId: string) => Promise<void>;
  onUnlinkContact?: () => Promise<void>;
  /** Called after successful submission to reopen the modal for another entry */
  onReopen?: () => void;
  isLoading: boolean;
  targetName: string;
  targetType: 'company' | 'contact';
  contactId?: string;
  // For scope toggle and validation (when targetType is 'contact')
  // If companyId is provided, the modal is in "linked" mode (from company page)
  // If companyId is NOT provided, the modal is in "standalone" mode (from contact page)
  companyId?: string;
  companyName?: string;
  existingDetails?: ContactDetail[];
  /** List of company IDs that are already linked to exclude from search */
  linkedCompanyIds?: string[];
}

// Form state for both phone and email
interface ContactDetailForm {
  phone: {
    countryCode: string;
    number: string;
  };
  email: {
    value: string;
    purposes: string[];
  };
}

export function AddContactDetailModal({
  isOpen,
  onClose,
  onSubmit,
  onUpdate,
  onDelete,
  onUnlinkContact,
  onReopen,
  isLoading,
  targetName,
  targetType,
  contactId,
  companyId,
  companyName,
  existingDetails = [],
  linkedCompanyIds = [],
}: AddContactDetailModalProps) {
  // Scope toggle state
  const [scope, setScope] = useState<DetailScope>('default');

  // Determine if we're in "standalone" mode (from contact page without a specific company)
  const isStandaloneMode = targetType === 'contact' && !companyId;

  // For standalone mode: company search state
  const [selectedCompany, setSelectedCompany] = useState<CompanySearchOption | null>(null);
  const clearCompanySelection = useCallback(() => setSelectedCompany(null), []);


  // Show scope toggle when:
  // 1. From company page: targetType is 'contact' and we have companyId (linked mode)
  // 2. From contact page: targetType is 'contact' and we're in standalone mode
  const showScopeToggle = targetType === 'contact';

  // Form state for both phone and email (for contact targetType)
  const [form, setForm] = useState<ContactDetailForm>({
    phone: { countryCode: '+65', number: '' },
    email: { value: '', purposes: [] },
  });

  // Form state for company-level details (for company targetType)
  const [singleForm, setSingleForm] = useState({
    detailType: 'EMAIL' as ContactDetailType,
    label: '',
    value: '',
    purposes: [] as string[],
  });

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; type: 'PHONE' | 'EMAIL'; value: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);

  // Get existing details for the current scope
  const getExistingForScope = (type: ContactDetailType) => {
    return existingDetails.find(d => {
      if (d.detailType !== type) return false;
      if (scope === 'default') {
        return d.contactId && !d.companyId;
      } else {
        // For company-specific scope:
        // - In linked mode, check against the fixed companyId
        // - In standalone mode, check against the selected company
        const effectiveCompanyId = isStandaloneMode ? selectedCompany?.id : companyId;
        return d.contactId && d.companyId === effectiveCompanyId;
      }
    });
  };

  const existingPhone = getExistingForScope('PHONE');
  const existingEmail = getExistingForScope('EMAIL');

  // Helper to parse phone number into country code and number
  const parsePhone = (phoneValue: string): { countryCode: string; number: string } => {
    if (!phoneValue) return { countryCode: '+65', number: '' };

    // Try to extract country code (e.g., +65, +1, +44)
    const match = phoneValue.match(/^(\+\d{1,3})\s*(.*)$/);
    if (match) {
      return { countryCode: match[1], number: match[2].trim() };
    }
    // If no country code found, default to +65
    return { countryCode: '+65', number: phoneValue.trim() };
  };

  // Pre-populate form when modal opens or scope/company changes
  useEffect(() => {
    if (isOpen && targetType === 'contact') {
      // Find existing details for the current scope
      const findExisting = (type: ContactDetailType) => {
        return existingDetails.find(d => {
          if (d.detailType !== type) return false;
          if (scope === 'default') {
            return d.contactId && !d.companyId;
          } else {
            // For company-specific scope, check against effective company ID
            const effectiveCompanyId = isStandaloneMode ? selectedCompany?.id : companyId;
            return d.contactId && d.companyId === effectiveCompanyId;
          }
        });
      };

      const phone = findExisting('PHONE');
      const email = findExisting('EMAIL');

      const phoneValue = phone?.value || '';
      const parsedPhone = parsePhone(phoneValue);

      setForm({
        phone: {
          countryCode: parsedPhone.countryCode,
          number: parsedPhone.number,
        },
        email: {
          value: email?.value || '',
          purposes: email?.purposes || [],
        },
      });
    }
  }, [isOpen, scope, existingDetails, targetType, companyId, isStandaloneMode, selectedCompany?.id]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setScope('default');
      clearCompanySelection();
    }
  }, [isOpen, clearCompanySelection]);

  // Combine country code and number for the full phone value
  const getFullPhoneValue = () => {
    if (!form.phone.number.trim()) return '';
    return `${form.phone.countryCode} ${form.phone.number.trim()}`;
  };

  const handleSubmit = async () => {
    // Submit both phone and email if they have values
    const promises: Promise<void>[] = [];

    // Determine the effective company ID for company-specific details
    const effectiveCompanyId = isStandaloneMode ? selectedCompany?.id : companyId;

    // Submit phone if changed or new
    const fullPhoneValue = getFullPhoneValue();
    if (fullPhoneValue) {
      if (existingPhone && existingPhone.id) {
        // We're updating an existing record
        if (onUpdate) {
          // Normalize values for comparison (trim and normalize whitespace)
          const normalizedExisting = existingPhone.value.trim().replace(/\s+/g, ' ');
          const normalizedNew = fullPhoneValue.trim().replace(/\s+/g, ' ');
          const valueChanged = normalizedExisting !== normalizedNew;

          if (valueChanged) {
            promises.push(onUpdate(existingPhone.id, {
              value: fullPhoneValue,
              purposes: [],
            }));
          }
        }
      } else {
        // No existing record - create new
        const phoneInput: CreateContactDetailInput & {
          isCompanySpecific?: boolean;
          selectedCompanyId?: string;
        } = {
          detailType: 'PHONE',
          value: fullPhoneValue,
          purposes: [],
          isPrimary: false,
        };
        if (contactId) {
          phoneInput.contactId = contactId;
        }
        if (showScopeToggle && scope === 'company') {
          phoneInput.isCompanySpecific = true;
          // For standalone mode, pass the selected company ID
          if (isStandaloneMode && effectiveCompanyId) {
            phoneInput.selectedCompanyId = effectiveCompanyId;
          }
        }
        promises.push(onSubmit(phoneInput));
      }
    }

    // Submit email if changed or new
    if (form.email.value.trim()) {
      // Check if we have an existing email detail record with an ID
      if (existingEmail && existingEmail.id) {
        // We're updating an existing record
        if (onUpdate) {
          const valueChanged = existingEmail.value.trim() !== form.email.value.trim();
          const purposesChanged = JSON.stringify(existingEmail.purposes || []) !== JSON.stringify(form.email.purposes);

          if (valueChanged || purposesChanged) {
            promises.push(onUpdate(existingEmail.id, {
              value: form.email.value.trim(),
              purposes: form.email.purposes,
            }));
          }
        }
      } else {
        // No existing record - create new
        const emailInput: CreateContactDetailInput & {
          isCompanySpecific?: boolean;
          selectedCompanyId?: string;
        } = {
          detailType: 'EMAIL',
          value: form.email.value.trim(),
          purposes: form.email.purposes,
          isPrimary: false,
        };
        if (contactId) {
          emailInput.contactId = contactId;
        }
        if (showScopeToggle && scope === 'company') {
          emailInput.isCompanySpecific = true;
          // For standalone mode, pass the selected company ID
          if (isStandaloneMode && effectiveCompanyId) {
            emailInput.selectedCompanyId = effectiveCompanyId;
          }
        }
        promises.push(onSubmit(emailInput));
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }

    // Reset form and close modal
    setForm({
      phone: { countryCode: '+65', number: '' },
      email: { value: '', purposes: [] },
    });
    setScope('default');
    clearCompanySelection();

    // Close modal if no promises were made (nothing to save)
    if (promises.length === 0) {
      onClose();
    }
  };

  const handleClose = () => {
    setForm({
      phone: { countryCode: '+65', number: '' },
      email: { value: '', purposes: [] },
    });
    setScope('default');
    clearCompanySelection();
    setDeleteConfirm(null);
    setUnlinkConfirmOpen(false);
    onClose();
  };

  const handleDelete = async () => {
    if (!deleteConfirm || !onDelete) return;

    try {
      setIsDeleting(true);
      await onDelete(deleteConfirm.id);

      // Clear the form field that was deleted
      if (deleteConfirm.type === 'PHONE') {
        setForm(prev => ({
          ...prev,
          phone: { countryCode: '+65', number: '' },
        }));
      } else {
        setForm(prev => ({
          ...prev,
          email: { value: '', purposes: [] },
        }));
      }

      setDeleteConfirm(null);
    } catch {
      // Error handled by the mutation hook
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUnlinkContact = async () => {
    if (!onUnlinkContact) return;

    try {
      setIsUnlinking(true);
      await onUnlinkContact();
      setUnlinkConfirmOpen(false);
      handleClose();
    } catch {
      // Error handled by mutation hook
    } finally {
      setIsUnlinking(false);
    }
  };

  const handlePurposesChange = (purposes: string[]) => {
    setForm(prev => ({
      ...prev,
      email: { ...prev.email, purposes },
    }));
  };

  // Check if there are any changes to submit
  const fullPhoneValue = getFullPhoneValue();

  // Helper to normalize phone values for comparison
  const normalizePhoneValue = (value: string) => value.trim().replace(/\s+/g, ' ');

  // Phone has changes if: new value entered (for create), or existing value changed (for update)
  const hasNewPhone = fullPhoneValue && !existingPhone;
  const hasPhoneUpdate = existingPhone?.id && fullPhoneValue && (
    normalizePhoneValue(existingPhone.value) !== normalizePhoneValue(fullPhoneValue)
  );
  const hasPhoneChange = hasNewPhone || hasPhoneUpdate;

  // Email has changes if: new value entered (for create), or existing value changed (for update)
  const hasNewEmail = form.email.value.trim() && !existingEmail;
  const hasEmailUpdate = existingEmail?.id && form.email.value.trim() && (
    existingEmail.value.trim() !== form.email.value.trim() ||
    JSON.stringify(existingEmail.purposes || []) !== JSON.stringify(form.email.purposes)
  );
  const hasEmailChange = hasNewEmail || hasEmailUpdate;

  const hasChanges = hasPhoneChange || hasEmailChange;

  // For standalone mode with company-specific scope, require company selection
  const isCompanySelectionRequired = isStandaloneMode && scope === 'company';
  const hasValidCompanySelection = !isCompanySelectionRequired || !!selectedCompany;

  // Get effective company name for display
  const effectiveCompanyName = isStandaloneMode ? selectedCompany?.label : companyName;

  // For linked contacts (targetType === 'contact'), show the new side-by-side layout
  if (targetType === 'contact') {
    return (
      <>
      <Modal isOpen={isOpen} onClose={handleClose} title={`Edit Contact Details - ${targetName}`} size="2xl">
        <ModalBody className="space-y-5">
          {/* Scope toggle - custom styled without background */}
          {showScopeToggle && (
            <div>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setScope('default')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    scope === 'default'
                      ? 'bg-surface-secondary text-text-primary border border-border-primary'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  <User className="w-3.5 h-3.5" />
                  Default
                </button>
                <button
                  type="button"
                  onClick={() => setScope('company')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    scope === 'company'
                      ? 'bg-surface-secondary text-text-primary border border-border-primary'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  title={effectiveCompanyName ? `Company-specific for ${effectiveCompanyName}` : 'Company-specific'}
                >
                  <Building2 className="w-3.5 h-3.5" />
                  Company specific
                </button>
              </div>
              <p className="text-xs text-text-muted mt-2">
                {scope === 'default'
                  ? 'Default details are used when no company-specific detail exists'
                  : effectiveCompanyName
                    ? `These details will only be used for ${effectiveCompanyName}`
                    : 'Select a company to add company-specific contact details'}
              </p>
            </div>
          )}

          {/* Company selector - only shown in standalone mode with company scope */}
          {isStandaloneMode && scope === 'company' && (
            <>
              <div>
                <label className="label">Company</label>
                <CompanySelect
                  value={selectedCompany?.id ?? ''}
                  onChange={(_id, company) => setSelectedCompany(company)}
                  excludeIds={linkedCompanyIds}
                  placeholder="Search companies..."
                />
              </div>
              <div className="border-t border-border-secondary" />
            </>
          )}

          {/* Phone and Email side by side - 2:3 ratio */}
          <div className="grid grid-cols-5 gap-6">
            {/* Phone Column - 2 parts */}
            <div className="col-span-2 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-border-secondary">
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-text-tertiary" />
                  <span className="text-sm font-medium text-text-primary">Phone</span>
                </div>
                {existingPhone?.id && onDelete && (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm({ id: existingPhone.id, type: 'PHONE', value: existingPhone.value })}
                    className="text-text-muted hover:text-status-error p-1 rounded hover:bg-surface-tertiary transition-colors"
                    title="Delete phone"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div>
                <label className="label">Value</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.phone.countryCode}
                    onChange={(e) => setForm(prev => ({
                      ...prev,
                      phone: { ...prev.phone, countryCode: e.target.value },
                    }))}
                    className="input input-sm w-16"
                    placeholder="+65"
                  />
                  <input
                    type="tel"
                    value={form.phone.number}
                    onChange={(e) => setForm(prev => ({
                      ...prev,
                      phone: { ...prev.phone, number: e.target.value },
                    }))}
                    className="input input-sm flex-1"
                    placeholder="1234 5678"
                  />
                </div>
              </div>
            </div>

            {/* Email Column - 3 parts */}
            <div className="col-span-3 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-border-secondary">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-text-tertiary" />
                  <span className="text-sm font-medium text-text-primary">Email</span>
                </div>
                {existingEmail?.id && onDelete && (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm({ id: existingEmail.id, type: 'EMAIL', value: existingEmail.value })}
                    className="text-text-muted hover:text-status-error p-1 rounded hover:bg-surface-tertiary transition-colors"
                    title="Delete email"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div>
                <label className="label">Value</label>
                <input
                  type="email"
                  value={form.email.value}
                  onChange={(e) => setForm(prev => ({
                    ...prev,
                    email: { ...prev.email, value: e.target.value },
                  }))}
                  className="input input-sm w-full"
                  placeholder="email@example.com"
                />
              </div>

              {/* Purposes for email */}
              <PurposeToggle
                selectedPurposes={form.email.purposes}
                onChange={handlePurposesChange}
                showLabel
                size="sm"
              />
            </div>
          </div>
        </ModalBody>

        <ModalFooter>
          {onUnlinkContact && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setUnlinkConfirmOpen(true)}
              disabled={isLoading || isDeleting || isUnlinking}
            >
              Delete Contact
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={handleClose} disabled={isLoading || isDeleting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={isLoading || isDeleting || isUnlinking || !hasChanges || !hasValidCompanySelection}
          >
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDelete}
        title={`Delete ${deleteConfirm?.type === 'PHONE' ? 'Phone' : 'Email'}`}
        description={`Are you sure you want to delete "${deleteConfirm?.value}"? This action cannot be undone.`}
        variant="danger"
        confirmLabel="Delete"
        isLoading={isDeleting}
      />

      {/* Delete Contact Confirmation Dialog */}
      <ConfirmDialog
        isOpen={unlinkConfirmOpen}
        onClose={() => setUnlinkConfirmOpen(false)}
        onConfirm={handleUnlinkContact}
        title="Delete Contact"
        description={`Are you sure you want to delete "${targetName}" from this company? This will remove the link but keep the contact record.`}
        variant="danger"
        confirmLabel="Delete"
        isLoading={isUnlinking}
      />
    </>
    );
  }

  // Original layout for company-level details (targetType === 'company')
  // This keeps the dropdown for type selection since company details can include WEBSITE
  const handleSingleSubmit = async (reopenAfter: boolean = false) => {
    const input: CreateContactDetailInput = {
      detailType: singleForm.detailType,
      label: singleForm.label.trim() || undefined,
      value: singleForm.value.trim(),
      purposes: singleForm.purposes,
      isPrimary: false,
    };

    await onSubmit(input);
    // Clear form after submission (parent handles success/error and closes modal)
    setSingleForm({ detailType: 'EMAIL', label: '', value: '', purposes: [] });

    // For "Add Another", reopen the modal after a brief delay
    if (reopenAfter && onReopen) {
      setTimeout(() => {
        onReopen();
      }, 50);
    }
  };

  const handleSingleClose = () => {
    setSingleForm({ detailType: 'EMAIL', label: '', value: '', purposes: [] });
    onClose();
  };

  const handleSinglePurposesChange = (purposes: string[]) => {
    setSingleForm(prev => ({ ...prev, purposes }));
  };

  const config = DETAIL_TYPE_CONFIG[singleForm.detailType];
  const ConfigIcon = config.icon;

  return (
    <Modal isOpen={isOpen} onClose={handleSingleClose} title="Add Contact Detail" size="lg">
      <ModalBody className="space-y-4">
        {/* Type selection */}
        <div>
          <label className="label">Type</label>
          <select
            value={singleForm.detailType}
            onChange={(e) => {
              const newType = e.target.value as ContactDetailType;
              setSingleForm(prev => ({
                ...prev,
                detailType: newType,
                purposes: newType === 'EMAIL' ? prev.purposes : [],
              }));
            }}
            className="input input-sm w-full"
          >
            {Object.entries(DETAIL_TYPE_CONFIG).map(([type, cfg]) => (
              <option key={type} value={type}>{cfg.label}</option>
            ))}
          </select>
        </div>

        {/* Value input */}
        <div>
          <label className="label">Label (Optional)</label>
          <input
            type="text"
            value={singleForm.label}
            onChange={(e) => setSingleForm(prev => ({ ...prev, label: e.target.value }))}
            className="input input-sm w-full"
            placeholder="e.g. Main line, Accounts, Billing"
          />
        </div>

        {/* Value input */}
        <div>
          <label className="label">Value</label>
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
              <ConfigIcon className="w-4 h-4" />
            </div>
            <input
              type={getInputType(singleForm.detailType)}
              value={singleForm.value}
              onChange={(e) => setSingleForm(prev => ({ ...prev, value: e.target.value }))}
              className="input input-sm w-full pl-10"
              placeholder={config.placeholder}
            />
          </div>
        </div>

        {/* Purposes selection - only for EMAIL type */}
        {singleForm.detailType === 'EMAIL' && (
          <PurposeToggle
            selectedPurposes={singleForm.purposes}
            onChange={handleSinglePurposesChange}
            showLabel
            showDescription
          />
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={handleSingleClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleSingleSubmit(true)}
          disabled={isLoading || !singleForm.value.trim()}
        >
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Add Another
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => handleSingleSubmit(false)}
          disabled={isLoading || !singleForm.value.trim()}
        >
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Add Detail
        </Button>
      </ModalFooter>
    </Modal>
  );
}
