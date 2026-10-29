'use client';

import { useState } from 'react';
import {
  useCreateConnector,
  getProviderDisplayName,
  getCredentialFields,
  getProvidersForType,
} from '@/hooks/use-connectors';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Alert } from '@/components/ui/alert';
import { useToast } from '@/components/ui/toast';
import {
  Eye,
  EyeOff,
  HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  parseMailboxUserIdsInput,
  INITIAL_CREATE_FORM,
  type ConnectorType,
  type ConnectorProvider,
  type CreateFormData,
} from './connector-admin-config';

interface ConnectorCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  isSuperAdmin: boolean;
  /** The signed-in user's own workspace, used as the scope for workspace admins. */
  tenantId: string | null | undefined;
  /** The workspace a super admin is viewing, offered as "Current Workspace Only". */
  activeWorkspaceId: string | null | undefined;
  onShowSetupGuide: (provider: 'SHAREPOINT' | 'ONEDRIVE') => void;
}

/** Add Connector modal: scope, type, provider, credentials and mailboxes. */
export function ConnectorCreateModal({
  isOpen,
  onClose,
  isSuperAdmin,
  tenantId,
  activeWorkspaceId,
  onShowSetupGuide,
}: ConnectorCreateModalProps) {
  const { success, error: showError } = useToast();
  const createMutation = useCreateConnector();
  const [createForm, setCreateForm] = useState<CreateFormData>(INITIAL_CREATE_FORM);
  const [formError, setFormError] = useState('');
  const [showCredentials, setShowCredentials] = useState<Record<string, boolean>>({});

  const toggleCredentialVisibility = (key: string) => {
    setShowCredentials((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleClose = () => {
    onClose();
    setCreateForm(INITIAL_CREATE_FORM);
    setFormError('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!createForm.name.trim()) {
      setFormError('Name is required');
      return;
    }

    // Validate required credentials
    const fields = getCredentialFields(createForm.provider);
    for (const field of fields) {
      if (field.required && !createForm.credentials[field.key]) {
        setFormError(`${field.label} is required`);
        return;
      }
    }

    const isStorageProvider =
      createForm.provider === 'ONEDRIVE' || createForm.provider === 'SHAREPOINT';
    const parsedMailboxInput = parseMailboxUserIdsInput(createForm.mailboxUserIdsText);
    if (isStorageProvider && parsedMailboxInput.invalidValues.length > 0) {
      setFormError(`Invalid mailbox email(s): ${parsedMailboxInput.invalidValues.join(', ')}`);
      return;
    }

    try {
      const settings =
        isStorageProvider && parsedMailboxInput.mailboxUserIds.length > 0
          ? { mailboxUserIds: parsedMailboxInput.mailboxUserIds }
          : undefined;

      await createMutation.mutateAsync({
        name: createForm.name,
        type: createForm.type,
        provider: createForm.provider,
        tenantId: isSuperAdmin ? createForm.workspaceId : tenantId || null,
        credentials: createForm.credentials,
        settings,
        isEnabled: createForm.isEnabled,
      });
      success('Connector created successfully');
      onClose();
      setCreateForm(INITIAL_CREATE_FORM);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to create connector');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Connector"
      size="md"
    >
      <form onSubmit={handleCreate} autoComplete="off">
        <ModalBody>
          {formError && (
            <Alert variant="error" className="mb-4">
              {formError}
            </Alert>
          )}
          <div className="space-y-4">
            {/* Scope (SUPER_ADMIN only) */}
            {isSuperAdmin && (
              <div>
                <label className="label">Scope</label>
                <select
                  value={createForm.workspaceId ?? 'system'}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      workspaceId: e.target.value === 'system' ? null : e.target.value,
                    })
                  }
                  className="input input-sm w-full"
                >
                  <option value="system">System (available to all workspaces)</option>
                  {activeWorkspaceId && (
                    <option value={activeWorkspaceId}>Current Workspace Only</option>
                  )}
                </select>
              </div>
            )}

            {/* Type */}
            <div>
              <label className="label">Type</label>
              <select
                value={createForm.type}
                onChange={(e) => {
                  const type = e.target.value as ConnectorType;
                  const providers = getProvidersForType(type);
                  setCreateForm({
                    ...createForm,
                    type,
                    provider: providers[0],
                    credentials: {},
                  });
                }}
                className="input input-sm w-full"
              >
                <option value="AI_PROVIDER">AI Provider</option>
                <option value="STORAGE">Storage/ Email</option>
              </select>
            </div>

            {/* Provider */}
            <div>
              <label className="label">Provider</label>
              <select
                value={createForm.provider}
                onChange={(e) =>
                  setCreateForm({
                    ...createForm,
                    provider: e.target.value as ConnectorProvider,
                    credentials: {},
                  })
                }
                className="input input-sm w-full"
              >
                {getProvidersForType(createForm.type).map((p) => (
                  <option key={p} value={p}>
                    {getProviderDisplayName(p)}
                  </option>
                ))}
              </select>
            </div>

            {/* Name */}
            <FormInput
              label="Display Name"
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              placeholder={`e.g., Production ${getProviderDisplayName(createForm.provider)}`}
              inputSize="sm"
            />

            {/* Credentials */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <label className="label mb-0">Credentials</label>
                {(createForm.provider === 'SHAREPOINT' || createForm.provider === 'ONEDRIVE') && (
                  <button
                    type="button"
                    onClick={() => onShowSetupGuide(createForm.provider as 'SHAREPOINT' | 'ONEDRIVE')}
                    className="text-text-muted hover:text-oak-light transition-colors"
                    title="Setup Guide"
                  >
                    <HelpCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
              {getCredentialFields(createForm.provider).map((field) => (
                <div key={field.key} className="relative">
                  <FormInput
                    id={`create-connector-${field.key}`}
                    name={`create-connector-${field.key}`}
                    label={field.label}
                    type={
                      field.type === 'password' && !showCredentials[field.key]
                        ? 'password'
                        : 'text'
                    }
                    value={createForm.credentials[field.key] || ''}
                    autoComplete={field.type === 'password' ? 'new-password' : 'off'}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        credentials: {
                          ...createForm.credentials,
                          [field.key]: e.target.value,
                        },
                      })
                    }
                    placeholder={field.required ? 'Required' : 'Optional'}
                    inputSize="sm"
                  />
                  {field.type === 'password' && (
                    <button
                      type="button"
                      onClick={() => toggleCredentialVisibility(field.key)}
                      className="absolute right-3 top-8 text-text-muted hover:text-text-secondary"
                    >
                      {showCredentials[field.key] ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {(createForm.provider === 'ONEDRIVE' || createForm.provider === 'SHAREPOINT') && (
              <div className="space-y-2">
                <label className="label mb-0">
                  Mailbox Emails (Communication)
                </label>
                <textarea
                  value={createForm.mailboxUserIdsText}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      mailboxUserIdsText: e.target.value,
                    })
                  }
                  placeholder="mailbox1@tenant.com, mailbox2@tenant.com"
                  className="input w-full min-h-24 p-3"
                />
                <p className="text-xs text-text-muted">
                  Optional now. Used by Communication sync to read Outlook mailboxes.
                  Separate multiple values with comma or newline.
                </p>
              </div>
            )}

            {/* Options */}
            <div className="space-y-3">
              {/* Enabled Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-border-primary bg-bg-tertiary">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-text-primary">Enabled</span>
                  <span className="text-xs text-text-muted">
                    {createForm.isEnabled ? 'Connector is active and can be used' : 'Connector is disabled'}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={createForm.isEnabled}
                  onClick={() => setCreateForm({ ...createForm, isEnabled: !createForm.isEnabled })}
                  className={cn(
                    'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-oak-primary focus:ring-offset-2',
                    createForm.isEnabled ? 'bg-oak-primary border-oak-primary' : 'bg-gray-300 border-gray-300 dark:bg-gray-600 dark:border-gray-600'
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out',
                      createForm.isEnabled ? 'translate-x-5' : 'translate-x-0'
                    )}
                  />
                </button>
              </div>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            isLoading={createMutation.isPending}
          >
            Create Connector
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
