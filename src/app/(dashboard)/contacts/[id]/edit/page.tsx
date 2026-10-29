'use client';

import { use, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, AlertCircle, Loader2, ShieldAlert } from 'lucide-react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateContactSchema, type UpdateContactInput } from '@/lib/validations/contact';
import { useContact, useUpdateContact } from '@/hooks/use-contacts';
import { usePermissions } from '@/hooks/use-permissions';
import { useUnsavedNavigationGuard } from '@/hooks/use-unsaved-navigation-guard';
import { useToast } from '@/components/ui/toast';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

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

export default function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: contact, isLoading: contactLoading, error: contactError } = useContact(id, false);
  const updateContact = useUpdateContact();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const toast = useToast();

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateContactInput>({
    resolver: zodResolver(updateContactSchema),
    defaultValues: {
      id,
    },
  });

  // Populate form when contact data loads
  useEffect(() => {
    if (!contact || isDirty) return;

    reset({
      id: contact.id,
      contactType: contact.contactType,
      firstName: contact.firstName || undefined,
      lastName: contact.lastName || undefined,
      alias: contact.alias || undefined,
      identificationType: contact.identificationType || undefined,
      identificationNumber: contact.identificationNumber || undefined,
      nationality: contact.nationality || undefined,
      dateOfBirth: contact.dateOfBirth
        ? new Date(contact.dateOfBirth).toISOString()
        : undefined,
      corporateName: contact.corporateName || undefined,
      corporateUen: contact.corporateUen || undefined,
      fullAddress: contact.fullAddress || undefined,
    });
  }, [contact, isDirty, reset]);

  // Warn about unsaved changes when leaving the page
  const navigationGuard = useUnsavedNavigationGuard((isDirty) && !isSubmitting);

  const contactType = watch('contactType');

  // Get the appropriate ID types based on contact type
  const availableIdTypes = contactType === 'CORPORATE' ? corporateIdTypes : individualIdTypes;

  // Handle validation errors - show toast for root/refine errors
  const onInvalid = (formErrors: FieldErrors<UpdateContactInput>) => {
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
    navigationGuard.requestNavigation(`/contacts/${id}`);
  };

  const onSubmit = async (data: UpdateContactInput) => {
    setSubmitError(null);

    try {
      await updateContact.mutateAsync({ id, data });
      router.push(`/contacts/${id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update contact');
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
      description: 'Save contact',
    },
    ...(can.createContact ? [{
      key: 'F1',
      handler: () => navigationGuard.requestNavigation('/contacts/new'),
      description: 'Create contact',
    }] : []),
  ], !isSubmitting);

  // Loading state
  if (contactLoading || permissionsLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-oak-primary animate-spin" />
      </div>
    );
  }

  // Error state
  if (contactError || !contact) {
    return (
      <div className="p-4 sm:p-6">
        <div className="card p-8 text-center">
          <AlertCircle className="w-12 h-12 text-status-error mx-auto mb-4" />
          <h2 className="text-lg font-medium text-text-primary mb-2">Contact not found</h2>
          <p className="text-sm text-text-secondary mb-4">
            {contactError instanceof Error ? contactError.message : 'The contact you are looking for does not exist.'}
          </p>
          <Link href="/contacts" className="btn-primary btn-sm inline-flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Contacts
          </Link>
        </div>
      </div>
    );
  }

  // Permission check
  if (!can.updateContact) {
    return (
      <div className="p-4 sm:p-6">
        <div className="card p-8 text-center">
          <ShieldAlert className="w-12 h-12 text-status-warning mx-auto mb-4" />
          <h2 className="text-lg font-medium text-text-primary mb-2">Access Denied</h2>
          <p className="text-sm text-text-secondary mb-4">
            You do not have permission to edit contacts.
          </p>
          <Link href={`/contacts/${id}`} className="btn-primary btn-sm inline-flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Contact
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <Link
          href={`/contacts/${id}`}
          title="Back to Contact (Ctrl+Backspace)"
          className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Contact
        </Link>
        <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">Edit Contact</h1>
        <p className="text-sm text-text-secondary mt-1">
          Update the details for {contact.fullName}
        </p>
      </div>

      {/* Error */}
      {submitError && (
        <div className="card border-status-error bg-status-error/5 mb-4">
          <div className="flex items-center gap-3 text-status-error">
            <AlertCircle className="w-5 h-5" />
            <p>{submitError}</p>
          </div>
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
                    <label className="label">First Name</label>
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
                    <label className="label">Last Name</label>
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
                  <label className="label">Corporate Name</label>
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

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link href={`/contacts/${id}`} className="btn-secondary btn-sm" title="Cancel (Ctrl+Backspace)">
            <span className="hidden sm:inline">Cancel (Ctrl+Backspace)</span>
            <span className="sm:hidden">Cancel</span>
          </Link>
          <button
            type="submit"
            disabled={isSubmitting || !isDirty}
            className="btn-primary btn-sm flex items-center gap-2"
            title="Save Changes (Ctrl+S)"
          >
            <Save className="w-4 h-4" />
            {isSubmitting ? 'Saving...' : (
              <>
                <span className="hidden sm:inline">Save Changes (Ctrl+S)</span>
                <span className="sm:hidden">Save Changes</span>
              </>
            )}
          </button>
        </div>
      </form>
      {navigationGuard.dialog}
    </div>
  );
}
