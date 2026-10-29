'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, AlertCircle, Loader2, ShieldAlert, Mail, Building2, User } from 'lucide-react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createContactSchema, type CreateContactInput, type CreateContactWithDetailsInput } from '@/lib/validations/contact';
import { ContactMatchReviewRequiredError, useCreateContact } from '@/hooks/use-contacts';
import { usePermissions } from '@/hooks/use-permissions';
import { useSession } from '@/hooks/use-auth';
import { useUnsavedNavigationGuard } from '@/hooks/use-unsaved-navigation-guard';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { useToast } from '@/components/ui/toast';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { PurposeToggle } from '@/components/contacts/purpose-toggle';
import { CompanySelect } from '@/components/ui/company-select';
import type { CompanySearchOption } from '@/hooks/use-company-search';
import { ContactMatchDialog } from '@/components/contacts/contact-match-dialog';
import type { ContactMatchResult } from '@/types/contact-identity';

const contactTypes = [
  { value: 'INDIVIDUAL', label: 'Individual' },
  { value: 'CORPORATE', label: 'Corporate' },
];

// Separate ID types for Individual and Corporate contacts
const individualIdTypes = [
  { value: 'NRIC', label: 'NRIC' },
  { value: 'FIN', label: 'FIN' },
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'OTHER', label: 'Other' },
];

const corporateIdTypes = [
  { value: 'UEN', label: 'UEN' },
  { value: 'OTHER', label: 'Other' },
];

interface ContactDetailDraft {
  phone: {
    countryCode: string;
    number: string;
  };
  email: {
    value: string;
    purposes: string[];
  };
}

function createInitialContactDetailDraft(): ContactDetailDraft {
  return {
    phone: {
      countryCode: '+65',
      number: '',
    },
    email: {
      value: '',
      purposes: [],
    },
  };
}

function buildPhoneValue(countryCode: string, number: string): string | null {
  const normalizedNumber = number.trim();
  if (!normalizedNumber) {
    return null;
  }
  const normalizedCountryCode = countryCode.trim() || '+65';
  return `${normalizedCountryCode} ${normalizedNumber}`.trim();
}

export default function NewContactPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const createContact = useCreateContact();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingMatch, setPendingMatch] = useState<ContactMatchResult | null>(null);
  const [pendingPayload, setPendingPayload] = useState<(CreateContactWithDetailsInput & { tenantId?: string }) | null>(null);
  const toast = useToast();

  // SUPER_ADMIN tenant selection (from centralized store)
  const isSuperAdmin = session?.isSuperAdmin ?? false;
  const activeTenantId = useActiveWorkspaceId(isSuperAdmin, session?.tenantId);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CreateContactInput>({
    resolver: zodResolver(createContactSchema),
    defaultValues: {
      contactType: 'INDIVIDUAL',
    },
  });

  const [defaultContactDetails, setDefaultContactDetails] = useState<ContactDetailDraft>(
    createInitialContactDetailDraft
  );
  const [companyContactDetails, setCompanyContactDetails] = useState<ContactDetailDraft>(
    createInitialContactDetailDraft
  );
  const [selectedCompany, setSelectedCompany] = useState<CompanySearchOption | null>(null);

  const hasDefaultContactDetailChanges =
    Boolean(defaultContactDetails.email.value.trim()) ||
    Boolean(defaultContactDetails.phone.number.trim()) ||
    defaultContactDetails.phone.countryCode.trim() !== '+65' ||
    defaultContactDetails.email.purposes.length > 0;

  const hasCompanyContactDetailChanges =
    Boolean(selectedCompany) ||
    Boolean(companyContactDetails.email.value.trim()) ||
    Boolean(companyContactDetails.phone.number.trim()) ||
    companyContactDetails.phone.countryCode.trim() !== '+65' ||
    companyContactDetails.email.purposes.length > 0;

  const hasContactDetailChanges = hasDefaultContactDetailChanges || hasCompanyContactDetailChanges;

  // Warn about unsaved changes when leaving the page
  const navigationGuard = useUnsavedNavigationGuard((isDirty || hasContactDetailChanges) && !isSubmitting);

  const contactType = watch('contactType');

  // Get the appropriate ID types based on contact type
  const availableIdTypes = contactType === 'CORPORATE' ? corporateIdTypes : individualIdTypes;

  // Handle validation errors - show toast for root/refine errors
  const onInvalid = (formErrors: FieldErrors<CreateContactInput>) => {
    // Check for root-level errors (from .refine())
    if (formErrors.root?.message) {
      toast.error(formErrors.root.message);
      return;
    }
    // Show first field error if any
    const firstError = Object.values(formErrors).find(err => err?.message);
    if (firstError?.message) {
      toast.error(firstError.message);
    }
  };

  const handleCancel = () => {
    navigationGuard.requestNavigation('/contacts');
  };

  const onSubmit = async (data: CreateContactInput) => {
    setSubmitError(null);

    // SUPER_ADMIN must select a tenant
    if (isSuperAdmin && !activeTenantId) {
      setSubmitError('Please select a tenant before creating a contact');
      return;
    }

    const defaultPhoneValue = buildPhoneValue(
      defaultContactDetails.phone.countryCode,
      defaultContactDetails.phone.number
    );
    const companyPhoneValue = buildPhoneValue(
      companyContactDetails.phone.countryCode,
      companyContactDetails.phone.number
    );
    const defaultEmailValue = defaultContactDetails.email.value.trim();
    const companyEmailValue = companyContactDetails.email.value.trim();
    const hasCompanySpecificInput = Boolean(companyPhoneValue || companyEmailValue);

    if (defaultContactDetails.email.purposes.length > 0 && !defaultEmailValue) {
      const message = 'Please enter a default email before selecting its purposes';
      setSubmitError(message);
      toast.error(message);
      return;
    }
    if (companyContactDetails.email.purposes.length > 0 && !companyEmailValue) {
      const message = 'Please enter a company-specific email before selecting its purposes';
      setSubmitError(message);
      toast.error(message);
      return;
    }

    if (hasCompanySpecificInput && !selectedCompany) {
      const message = 'Please select a company when adding company-specific contact details';
      setSubmitError(message);
      toast.error(message);
      return;
    }

    const contactDetails: NonNullable<CreateContactWithDetailsInput['contactDetails']> = [];

    if (defaultEmailValue) {
      contactDetails.push({
        detailType: 'EMAIL',
        value: defaultEmailValue,
        purposes: defaultContactDetails.email.purposes,
      });
    }
    if (defaultPhoneValue) {
      contactDetails.push({
        detailType: 'PHONE',
        value: defaultPhoneValue,
        purposes: [],
      });
    }
    if (hasCompanySpecificInput && selectedCompany) {
      if (companyEmailValue) {
        contactDetails.push({
          detailType: 'EMAIL',
          value: companyEmailValue,
          purposes: companyContactDetails.email.purposes,
          companyId: selectedCompany.id,
        });
      }
      if (companyPhoneValue) {
        contactDetails.push({
          detailType: 'PHONE',
          value: companyPhoneValue,
          purposes: [],
          companyId: selectedCompany.id,
        });
      }
    }

    const payload: CreateContactWithDetailsInput & { tenantId?: string } = {
      ...data,
      ...(contactDetails.length > 0 ? { contactDetails } : {}),
      ...(isSuperAdmin && activeTenantId ? { tenantId: activeTenantId } : {}),
    };
    try {
      await submitPayload(payload);
    } catch (err) {
      handleCreateError(err, payload);
    }
  };

  const submitPayload = async (payload: CreateContactWithDetailsInput & { tenantId?: string }) => {
    const contact = await createContact.mutateAsync(payload);
    setPendingMatch(null);
    setPendingPayload(null);
    router.push(`/contacts/${contact.id}`);
  };

  const handleCreateError = (
    error: unknown,
    payload: CreateContactWithDetailsInput & { tenantId?: string },
  ) => {
    if (error instanceof ContactMatchReviewRequiredError) {
      setPendingPayload(payload);
      setPendingMatch(error.match);
      setSubmitError(null);
      return;
    }
    setPendingMatch(null);
    setPendingPayload(null);
    setSubmitError(error instanceof Error ? error.message : 'Failed to create contact');
  };

  const resolvePendingMatch = async (
    resolution: NonNullable<CreateContactWithDetailsInput['resolution']>,
  ) => {
    if (!pendingPayload) return;
    const payload = { ...pendingPayload, resolution };
    setSubmitError(null);
    try {
      await submitPayload(payload);
    } catch (error) {
      handleCreateError(error, payload);
    }
  };

  useKeyboardShortcuts([
    {
      key: 'Backspace',
      ctrl: true,
      handler: handleCancel,
      description: 'Cancel and go back',
    },
    {
      key: 's',
      ctrl: true,
      handler: () => handleSubmit(onSubmit, onInvalid)(),
      description: 'Create contact',
    },
  ], !isSubmitting);

  // Check permission to create
  if (permissionsLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-oak-primary animate-spin" />
      </div>
    );
  }

  if (!can.createContact) {
    return (
      <div className="p-4 sm:p-6">
        <div className="card p-8 text-center">
          <ShieldAlert className="w-12 h-12 text-status-warning mx-auto mb-4" />
          <h2 className="text-lg font-medium text-text-primary mb-2">Access Denied</h2>
          <p className="text-sm text-text-secondary mb-4">
            You do not have permission to create contacts.
          </p>
          <Link href="/contacts" className="btn-primary btn-sm inline-flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Contacts
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      {pendingMatch && (
        <ContactMatchDialog
          match={pendingMatch}
          open
          isLoading={createContact.isPending}
          onUseExisting={() => resolvePendingMatch({ action: 'REUSE', contactId: pendingMatch.contactId })}
          onCreateSeparate={(reason) => resolvePendingMatch({ action: 'CREATE_SEPARATE', reason })}
          onClose={() => {
            setPendingMatch(null);
            setPendingPayload(null);
          }}
        />
      )}
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/contacts"
          title="Back to Contacts (Ctrl+Backspace)"
          className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Contacts
        </Link>
        <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">Add New Contact</h1>
        <p className="text-sm text-text-secondary mt-1">
          Create a new individual or corporate contact.
        </p>
      </div>

      {/* Error */}
      {submitError && (
        <div role="alert" className="card border-status-error bg-status-error/5 mb-4">
          <div className="flex items-center gap-3 text-status-error">
            <AlertCircle className="w-5 h-5" />
            <p>{submitError}</p>
          </div>
        </div>
      )}

      {/* Tenant context info for SUPER_ADMIN */}
      {isSuperAdmin && !activeTenantId && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Please select a tenant from the sidebar to create a contact.
          </p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-6">
        {/* Contact Type */}
        <div className="card">
          <div className="p-4 border-b border-border-primary">
            <h2 className="text-lg font-semibold text-text-primary">Contact Type</h2>
          </div>
          <div className="p-4">
            <div className="flex gap-4">
              {contactTypes.map((type) => (
                <label
                  key={type.value}
                  className={`flex-1 p-4 rounded-lg border cursor-pointer transition-colors ${
                    contactType === type.value
                      ? 'border-oak-primary bg-oak-primary/5'
                      : 'border-border-primary hover:border-border-secondary'
                  }`}
                >
                  <input
                    type="radio"
                    {...register('contactType')}
                    value={type.value}
                    className="sr-only"
                  />
                  <p className="font-medium text-text-primary">{type.label}</p>
                  <p className="text-xs text-text-secondary mt-1">
                    {type.value === 'INDIVIDUAL'
                      ? 'A person (director, shareholder, etc.)'
                      : 'A company or organization'}
                  </p>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Personal/Corporate Information */}
        <div className="card">
          <div className="p-4 border-b border-border-primary">
            <h2 className="text-lg font-semibold text-text-primary">
              {contactType === 'INDIVIDUAL' ? 'Personal Information' : 'Corporate Information'}
            </h2>
          </div>
          <div className="p-4 space-y-4">
            {contactType === 'INDIVIDUAL' ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="label">First Name *</label>
                    <input
                      type="text"
                      {...register('firstName')}
                      placeholder="John"
                      className={`input input-sm ${errors.firstName ? 'input-error' : ''}`}
                    />
                    {errors.firstName && (
                      <p className="text-xs text-status-error mt-1.5">{errors.firstName.message}</p>
                    )}
                  </div>
                  <div>
                    <label className="label">Last Name *</label>
                    <input
                      type="text"
                      {...register('lastName')}
                      placeholder="Doe"
                      className={`input input-sm ${errors.lastName ? 'input-error' : ''}`}
                    />
                    {errors.lastName && (
                      <p className="text-xs text-status-error mt-1.5">{errors.lastName.message}</p>
                    )}
                  </div>
                  <div>
                    <label className="label">Alias</label>
                    <input
                      type="text"
                      {...register('alias')}
                      placeholder="Known as..."
                      className={`input input-sm ${errors.alias ? 'input-error' : ''}`}
                    />
                    {errors.alias && (
                      <p className="text-xs text-status-error mt-1.5">{errors.alias.message}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="label">Nationality</label>
                    <input
                      type="text"
                      {...register('nationality')}
                      placeholder="SINGAPOREAN"
                      className="input input-sm"
                    />
                  </div>
                  <div>
                    <label className="label">ID Type</label>
                    <select {...register('identificationType')} className="input input-sm">
                      <option value="">Select type</option>
                      {availableIdTypes.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">ID Number</label>
                    <input
                      type="text"
                      {...register('identificationNumber')}
                      placeholder="S1234567A"
                      className="input input-sm"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Corporate Name *</label>
                  <input
                    type="text"
                    {...register('corporateName')}
                    placeholder="ABC Holdings Pte Ltd"
                    className={`input input-sm ${errors.corporateName ? 'input-error' : ''}`}
                  />
                  {errors.corporateName && (
                    <p className="text-xs text-status-error mt-1.5">{errors.corporateName.message}</p>
                  )}
                </div>
                <div>
                  <label className="label">UEN / Registration No.</label>
                  <input
                    type="text"
                    {...register('corporateUen')}
                    placeholder="202012345A or overseas reg. no."
                    className="input input-sm uppercase"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Address */}
        <div className="card">
          <div className="p-4 border-b border-border-primary">
            <h2 className="text-lg font-semibold text-text-primary">Address</h2>
          </div>
          <div className="p-4">
            <div>
              <label className="label">Full Address</label>
              <input
                type="text"
                {...register('fullAddress')}
                placeholder="123 Main Street, #01-02, Singapore 123456"
                className="input input-sm"
              />
            </div>
          </div>
        </div>

        {/* Contact Details */}
        <div className="card">
          <div className="p-4 border-b border-border-primary">
            <h2 className="text-lg font-semibold text-text-primary">Contact Details</h2>
            <p className="text-xs text-text-secondary mt-1">
              Optional details for default usage and one company-specific override.
            </p>
          </div>
          <div className="p-4 space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <User className="w-4 h-4 text-text-tertiary" />
                Default
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Phone</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={defaultContactDetails.phone.countryCode}
                      onChange={(e) =>
                        setDefaultContactDetails((prev) => ({
                          ...prev,
                          phone: { ...prev.phone, countryCode: e.target.value },
                        }))
                      }
                      className="input input-sm w-20"
                      placeholder="+65"
                    />
                    <input
                      type="tel"
                      value={defaultContactDetails.phone.number}
                      onChange={(e) =>
                        setDefaultContactDetails((prev) => ({
                          ...prev,
                          phone: { ...prev.phone, number: e.target.value },
                        }))
                      }
                      className="input input-sm flex-1"
                      placeholder="1234 5678"
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Email</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      value={defaultContactDetails.email.value}
                      onChange={(e) =>
                        setDefaultContactDetails((prev) => ({
                          ...prev,
                          email: { ...prev.email, value: e.target.value },
                        }))
                      }
                      className="input input-sm pl-10"
                      placeholder="email@example.com"
                    />
                  </div>
                </div>
              </div>
              <PurposeToggle
                selectedPurposes={defaultContactDetails.email.purposes}
                onChange={(purposes) =>
                  setDefaultContactDetails((prev) => ({
                    ...prev,
                    email: { ...prev.email, purposes },
                  }))
                }
                showLabel
                size="sm"
              />
            </div>

            <div className="pt-4 border-t border-border-primary space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Building2 className="w-4 h-4 text-text-tertiary" />
                Company Specific
              </div>
              <div>
                <label className="label">Company</label>
                <CompanySelect
                  value={selectedCompany?.id ?? ''}
                  onChange={(_id, company) => setSelectedCompany(company)}
                  placeholder="Search companies..."
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Phone</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={companyContactDetails.phone.countryCode}
                      onChange={(e) =>
                        setCompanyContactDetails((prev) => ({
                          ...prev,
                          phone: { ...prev.phone, countryCode: e.target.value },
                        }))
                      }
                      className="input input-sm w-20"
                      placeholder="+65"
                    />
                    <input
                      type="tel"
                      value={companyContactDetails.phone.number}
                      onChange={(e) =>
                        setCompanyContactDetails((prev) => ({
                          ...prev,
                          phone: { ...prev.phone, number: e.target.value },
                        }))
                      }
                      className="input input-sm flex-1"
                      placeholder="1234 5678"
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Email</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      value={companyContactDetails.email.value}
                      onChange={(e) =>
                        setCompanyContactDetails((prev) => ({
                          ...prev,
                          email: { ...prev.email, value: e.target.value },
                        }))
                      }
                      className="input input-sm pl-10"
                      placeholder="email@example.com"
                    />
                  </div>
                </div>
              </div>
              <PurposeToggle
                selectedPurposes={companyContactDetails.email.purposes}
                onChange={(purposes) =>
                  setCompanyContactDetails((prev) => ({
                    ...prev,
                    email: { ...prev.email, purposes },
                  }))
                }
                showLabel
                size="sm"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link href="/contacts" className="btn-secondary btn-sm" title="Cancel (Ctrl+Backspace)">
            <span className="hidden sm:inline">Cancel (Ctrl+Backspace)</span>
            <span className="sm:hidden">Cancel</span>
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary btn-sm flex items-center gap-2"
            title="Create Contact (Ctrl+S)"
          >
            <Save className="w-4 h-4" />
            {isSubmitting ? 'Creating...' : (
              <>
                <span className="hidden sm:inline">Create Contact (Ctrl+S)</span>
                <span className="sm:hidden">Create Contact</span>
              </>
            )}
          </button>
        </div>
      </form>
      {navigationGuard.dialog}
    </div>
  );
}
