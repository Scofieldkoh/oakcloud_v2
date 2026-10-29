'use client';

import { useState } from 'react';
import { ReasoningEffortSelect } from '@/components/connectors/reasoning-effort-select';
import { readReasoningDefaults } from '@/lib/ai/reasoning-settings';
import {
  useUpdateConnector,
  useConnectorModels,
  useToggleConnectorModel,
  useAddConnectorModel,
  useTestConnectorModelPdf,
  useDeleteConnectorModel,
  getProviderDisplayName,
  getCredentialFields,
  type Connector,
  type ConnectorModelConfig,
} from '@/hooks/use-connectors';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Alert } from '@/components/ui/alert';
import { useToast } from '@/components/ui/toast';
import {
  Plus,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SharePointFilingSettings } from '@/components/connectors/sharepoint/sharepoint-filing-settings';
import {
  MODEL_DEFAULT_GROUPS,
  parseMailboxUserIdsInput,
  extractMailboxUserIdsFromSettings,
  extractModelDefaultsFromSettings,
  getCredentialPlaceholder,
  type ModelDefaults,
  type EditFormData,
} from './connector-admin-config';

interface ConnectorEditModalProps {
  connector: Connector;
  onClose: () => void;
  /** The signed-in user's own workspace; SharePoint filing settings show only for its connectors. */
  tenantId: string | null | undefined;
  onShowSetupGuide: (provider: 'SHAREPOINT' | 'ONEDRIVE') => void;
}

function buildEditForm(connector: Connector): EditFormData {
  return {
    name: connector.name,
    credentials: {}, // Don't pre-fill credentials
    mailboxUserIdsText: extractMailboxUserIdsFromSettings(connector.settings).join(', '),
    modelDefaults: extractModelDefaultsFromSettings(connector.settings),
    reasoningDefaults: readReasoningDefaults(connector.settings?.reasoningDefaults),
    isEnabled: connector.isEnabled,
  };
}

/** Edit connector modal: credentials, mailboxes, SharePoint filing and AI model routing. */
export function ConnectorEditModal({ connector, onClose, tenantId, onShowSetupGuide }: ConnectorEditModalProps) {
  const { success, error: showError } = useToast();
  const [editForm, setEditForm] = useState<EditFormData>(() => buildEditForm(connector));
  const [formError, setFormError] = useState('');
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [showCredentials, setShowCredentials] = useState<Record<string, boolean>>({});

  const updateMutation = useUpdateConnector(connector.id);
  const { data: connectorModels, isLoading: isLoadingModels } = useConnectorModels(
    connector.type === 'AI_PROVIDER' ? connector.id : undefined
  );
  const toggleModelMutation = useToggleConnectorModel(connector.id);
  const addModelMutation = useAddConnectorModel(connector.id);
  const testModelPdfMutation = useTestConnectorModelPdf(connector.id);
  const deleteModelMutation = useDeleteConnectorModel(connector.id);

  const toggleCredentialVisibility = (key: string) => {
    setShowCredentials((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!editForm.name.trim()) {
      setFormError('Name is required');
      return;
    }

    try {
      const updateData: Record<string, unknown> = {
        name: editForm.name,
        isEnabled: editForm.isEnabled,
      };
      const isStorageProvider =
        connector.provider === 'ONEDRIVE' || connector.provider === 'SHAREPOINT';
      const existingSettings =
        connector.settings && typeof connector.settings === 'object'
          ? connector.settings
          : {};
      const nextSettings: Record<string, unknown> = { ...existingSettings };

      // Signed-document filing is edited by its own settings panel. Do not
      // submit the snapshot captured when this modal opened, or a later save
      // could overwrite newer filing roots/configuration.
      if (isStorageProvider) {
        delete nextSettings.signedDocumentFiling;
      }

      // Only include credentials if they've been modified (non-empty)
      const hasCredentialChanges = Object.values(editForm.credentials).some((v) => v);
      if (hasCredentialChanges) {
        updateData.credentials = editForm.credentials;
      }

      if (isStorageProvider) {
        const parsedMailboxInput = parseMailboxUserIdsInput(editForm.mailboxUserIdsText);
        if (parsedMailboxInput.invalidValues.length > 0) {
          setFormError(`Invalid mailbox email(s): ${parsedMailboxInput.invalidValues.join(', ')}`);
          return;
        }

        if (parsedMailboxInput.mailboxUserIds.length > 0) {
          nextSettings.mailboxUserIds = parsedMailboxInput.mailboxUserIds;
        } else {
          delete nextSettings.mailboxUserIds;
        }
        delete nextSettings.mailboxUserId;
      }

      if (connector.type === 'AI_PROVIDER') {
        if (connectorModels) {
          nextSettings.models = connectorModels.map((model) => ({
            modelId: model.modelId,
            name: model.name,
            description: model.description,
            providerModelId: model.providerModelId,
            isEnabled: model.isEnabled,
            documentInputMode: model.documentInputMode,
            supportsPdfInput: model.supportsPdfInput,
            lastPdfInputTest: model.lastPdfInputTest,
          }));
          delete nextSettings.customModels;
        }

        const nextModelDefaults = Object.fromEntries(
          MODEL_DEFAULT_GROUPS
            .map((group) => [group.key, editForm.modelDefaults[group.key].trim()])
            .filter(([, modelId]) => Boolean(modelId))
        );

        if (Object.keys(nextModelDefaults).length > 0) {
          nextSettings.modelDefaults = nextModelDefaults;
          delete nextSettings.defaultModel;
        } else {
          delete nextSettings.modelDefaults;
          delete nextSettings.defaultModel;
        }
        nextSettings.reasoningDefaults = connector.provider === 'OPENROUTER'
          ? Object.fromEntries(Object.entries(editForm.reasoningDefaults).filter(([group, choice]) => {
            const model = connectorModels?.find((item) => item.modelId === choice.modelId && item.isEnabled);
            return nextModelDefaults[group] === choice.modelId && model &&
              (model.reasoningEfforts == null || model.reasoningEfforts.includes(choice.effort));
          }))
          : {};
      }

      updateData.settings = nextSettings;

      await updateMutation.mutateAsync(updateData);
      success('Connector updated successfully');
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to update connector');
    }
  };

  const handleAddModel = async () => {
    const modelId = newModelId.trim();
    const name = newModelName.trim();
    if (!modelId) {
      setFormError('Model ID is required');
      return;
    }

    try {
      setFormError('');
      await addModelMutation.mutateAsync({
        modelId,
        providerModelId: modelId,
        name: name || modelId,
        isEnabled: true,
      });
      setNewModelId('');
      setNewModelName('');
      success('Model added');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to add model');
    }
  };

  const handleRemoveModel = async (model: ConnectorModelConfig) => {
    try {
      await deleteModelMutation.mutateAsync(model.modelId);
      setEditForm((prev) => ({
        ...prev,
        modelDefaults: Object.fromEntries(
          MODEL_DEFAULT_GROUPS.map((group) => [
            group.key,
            prev.modelDefaults[group.key] === model.modelId ? '' : prev.modelDefaults[group.key],
          ])
        ) as ModelDefaults,
      }));
      success('Model removed');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to remove model');
    }
  };

  const handleUpdateModelDocumentInputMode = async (
    model: ConnectorModelConfig,
    documentInputMode: ConnectorModelConfig['documentInputMode']
  ) => {
    try {
      await addModelMutation.mutateAsync({
        modelId: model.modelId,
        providerModelId: model.providerModelId,
        name: model.name,
        description: model.description,
        isEnabled: model.isEnabled,
        documentInputMode,
        supportsPdfInput: model.supportsPdfInput,
      });
      success('Model document input mode updated');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to update model input mode');
    }
  };

  const handleTestModelPdf = async (model: ConnectorModelConfig) => {
    try {
      const result = await testModelPdfMutation.mutateAsync({ modelId: model.modelId });
      if (result.success) {
        success('PDF input test passed');
      } else {
        showError(`PDF input test failed: ${result.error || 'model rejected PDF input'}`);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to test PDF input');
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Edit ${connector.name}`}
      description={connector ? `${getProviderDisplayName(connector.provider)} · ${connector.type === 'AI_PROVIDER' ? 'AI provider' : 'Storage / email'} connector` : undefined}
      size="4xl"
    >
      <form onSubmit={handleUpdate} autoComplete="off">
        <ModalBody className="p-0">
          {formError && (
            <div className="p-4 pb-0">
              <Alert variant="error">
                {formError}
              </Alert>
            </div>
          )}

          <div className="divide-y divide-border-primary">
            {/* Connection details */}
            <section className="p-4 sm:p-5" aria-labelledby="connector-connection-heading">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 id="connector-connection-heading" className="text-base font-semibold text-text-primary">
                    Connection
                  </h3>
                  <p className="mt-1 text-sm text-text-secondary">
                    Name this connector, update credentials, and control whether it can be used.
                  </p>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-border-primary bg-bg-tertiary px-3 py-2 sm:min-w-52 sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-text-primary">Connector enabled</div>
                    <div className="text-xs text-text-muted">
                      {editForm.isEnabled ? 'Available for use' : 'Currently disabled'}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-label="Enable connector"
                    aria-checked={editForm.isEnabled}
                    onClick={() => setEditForm({ ...editForm, isEnabled: !editForm.isEnabled })}
                    className={cn(
                      'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-oak-primary focus:ring-offset-2',
                      editForm.isEnabled ? 'bg-oak-primary border-oak-primary' : 'bg-gray-300 border-gray-300 dark:bg-gray-600 dark:border-gray-600'
                    )}
                  >
                    <span
                      className={cn(
                        'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out',
                        editForm.isEnabled ? 'translate-x-5' : 'translate-x-0'
                      )}
                    />
                  </button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <FormInput
                  label="Display Name"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  inputSize="sm"
                />

                {getCredentialFields(connector.provider).map((field) => (
                  <div key={field.key} className="relative">
                    <FormInput
                      id={`edit-connector-${field.key}`}
                      name={`edit-connector-${field.key}`}
                      label={field.label}
                      type={
                        field.type === 'password' && !showCredentials[field.key]
                          ? 'password'
                          : 'text'
                      }
                      value={editForm.credentials[field.key] || ''}
                      autoComplete={field.type === 'password' ? 'new-password' : 'off'}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          credentials: {
                            ...editForm.credentials,
                            [field.key]: e.target.value,
                          },
                        })
                      }
                      placeholder={getCredentialPlaceholder(connector, field.key)}
                      inputSize="sm"
                    />
                    {field.type === 'password' && (
                      <button
                        type="button"
                        aria-label={`${showCredentials[field.key] ? 'Hide' : 'Show'} ${field.label}`}
                        onClick={() => toggleCredentialVisibility(field.key)}
                        className="absolute right-3 top-8 text-text-muted transition-colors hover:text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30"
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

              {getCredentialFields(connector.provider).length > 0 && (
                <p className="mt-2 text-xs text-text-muted">
                  Credential fields are write-only. Leave a field blank to keep its current value.
                </p>
              )}

              {(connector.provider === 'SHAREPOINT' || connector.provider === 'ONEDRIVE') && (
                <button
                  type="button"
                  onClick={() => onShowSetupGuide(connector.provider as 'SHAREPOINT' | 'ONEDRIVE')}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-oak-light transition-colors hover:text-oak-primary"
                >
                  <HelpCircle className="w-4 h-4" />
                  Open provider setup guide
                </button>
              )}
            </section>

            {connector &&
              (connector.provider === 'ONEDRIVE' || connector.provider === 'SHAREPOINT') && (
                <section className="p-4 sm:p-5" aria-labelledby="connector-mailboxes-heading">
                  <div className="mb-3">
                    <h3 id="connector-mailboxes-heading" className="text-base font-semibold text-text-primary">
                      Communication mailboxes
                    </h3>
                    <p className="mt-1 text-sm text-text-secondary">
                      Outlook mailboxes that Communication sync is allowed to read.
                    </p>
                  </div>
                  <textarea
                    value={editForm.mailboxUserIdsText}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        mailboxUserIdsText: e.target.value,
                      })
                    }
                    placeholder="mailbox1@tenant.com, mailbox2@tenant.com"
                    className="input w-full min-h-24 p-3"
                    aria-label="Mailbox emails for Communication"
                  />
                  <p className="mt-1 text-xs text-text-muted">
                    Separate multiple values with a comma or a new line.
                  </p>
                </section>
              )}

            {connector.provider === 'SHAREPOINT' && connector.workspaceId === tenantId && (
              <section className="p-4 sm:p-5">
                <SharePointFilingSettings connectorId={connector.id} />
              </section>
            )}

            {/* Models — AI providers only */}
            {connector.type === 'AI_PROVIDER' && (
              <section className="p-4 sm:p-5" aria-labelledby="connector-routing-heading">
                <div className="mb-4">
                  <h3 id="connector-routing-heading" className="text-base font-semibold text-text-primary">
                    Model routing
                  </h3>
                  <p className="mt-1 text-sm text-text-secondary">
                    Choose the default model for each workload. Auto lets Oakcloud select an eligible model at runtime.
                  </p>
                </div>

                {isLoadingModels ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-14 animate-pulse rounded-lg bg-bg-tertiary"
                      />
                    ))}
                  </div>
                ) : connectorModels && connectorModels.length > 0 ? (
                  <div className="overflow-hidden rounded-xl border border-border-primary">
                    <div className="hidden grid-cols-[minmax(150px,0.9fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 border-b border-border-primary bg-bg-tertiary px-3 py-2 md:grid">
                      <span className="text-xs font-medium text-text-secondary">Workload</span>
                      <span className="text-xs font-medium text-text-secondary">Default model</span>
                      {connector.provider === 'OPENROUTER' && (
                        <span className="text-xs font-medium text-text-secondary">Reasoning effort</span>
                      )}
                    </div>
                    <div className="divide-y divide-border-primary">
                      {MODEL_DEFAULT_GROUPS.map((group) => (
                        <div
                          key={group.key}
                          className={cn(
                            'grid gap-3 bg-background-secondary p-3',
                            connector.provider === 'OPENROUTER'
                              ? 'md:grid-cols-[minmax(150px,0.9fr)_minmax(0,1fr)_minmax(0,0.9fr)] md:items-start'
                              : 'md:grid-cols-[minmax(150px,0.9fr)_minmax(0,1fr)] md:items-center'
                          )}
                        >
                          <div className="min-w-0">
                            <label htmlFor={`connector-default-${group.key}`} className="text-sm font-medium text-text-primary">
                              {group.label}
                            </label>
                            <p className="mt-0.5 text-xs text-text-muted">{group.description}</p>
                          </div>
                          <div>
                            <label htmlFor={`connector-default-${group.key}`} className="label md:sr-only">Default model</label>
                            <select
                              id={`connector-default-${group.key}`}
                              aria-label={group.label}
                              value={editForm.modelDefaults[group.key]}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  modelDefaults: {
                                    ...editForm.modelDefaults,
                                    [group.key]: e.target.value,
                                  },
                                  reasoningDefaults: Object.fromEntries(Object.entries(editForm.reasoningDefaults).filter(([key]) => key !== group.key)),
                                })
                              }
                              className="input input-sm w-full"
                            >
                              <option value="">Auto</option>
                              {connectorModels
                                .filter((model) => model.isEnabled)
                                .map((model) => (
                                  <option key={model.modelId} value={model.modelId}>
                                    {model.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                          {connector.provider === 'OPENROUTER' && (
                            <ReasoningEffortSelect
                              label={group.label}
                              efforts={connectorModels.find((model) => model.modelId === editForm.modelDefaults[group.key] && model.isEnabled)?.reasoningEfforts}
                              value={editForm.reasoningDefaults[group.key]?.modelId === editForm.modelDefaults[group.key] ? editForm.reasoningDefaults[group.key]?.effort : undefined}
                              onChange={(effort) => setEditForm((previous) => {
                                const reasoningDefaults = { ...previous.reasoningDefaults };
                                if (effort) reasoningDefaults[group.key] = { modelId: previous.modelDefaults[group.key], effort };
                                else delete reasoningDefaults[group.key];
                                return { ...previous, reasoningDefaults };
                              })}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border-primary p-4 text-sm text-text-muted">
                    No models are registered yet. Add a model below to configure workload defaults.
                  </div>
                )}

                <div className="mt-6 border-t border-border-primary pt-5" aria-labelledby="connector-models-heading">
                  <div className="mb-4">
                    <h4 id="connector-models-heading" className="text-sm font-semibold text-text-primary">
                      Available models
                    </h4>
                    <p className="mt-1 text-xs text-text-muted">
                      Register provider model IDs and manage document input capability per model.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <FormInput
                      label="Model ID"
                      value={newModelId}
                      onChange={(e) => setNewModelId(e.target.value)}
                      placeholder="provider/model-id"
                      inputSize="sm"
                    />
                    <FormInput
                      label="Display name"
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                      placeholder="Optional friendly name"
                      inputSize="sm"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleAddModel}
                      isLoading={addModelMutation.isPending}
                      disabled={!newModelId.trim() || addModelMutation.isPending}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add model
                    </Button>
                  </div>

                  {connectorModels && connectorModels.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {connectorModels.map((model: ConnectorModelConfig) => (
                        <div
                          key={model.modelId}
                          className="flex flex-col gap-3 rounded-lg border border-border-primary bg-background-primary p-3 md:flex-row md:items-center md:justify-between"
                        >
                          <div className="min-w-0 md:mr-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium text-text-primary">
                                {model.name}
                              </span>
                              <span className={cn(
                                'rounded-full px-2 py-0.5 text-2xs font-medium',
                                model.isEnabled
                                  ? 'bg-oak-primary/10 text-oak-light'
                                  : 'bg-bg-tertiary text-text-muted'
                              )}>
                                {model.isEnabled ? 'Enabled' : 'Disabled'}
                              </span>
                            </div>
                            <span className="mt-0.5 block truncate font-mono text-xs text-text-muted">
                              {model.providerModelId}
                            </span>
                            {connector.provider === 'OPENROUTER' && (
                              <span
                                className={cn(
                                  'mt-1 block text-xs',
                                  model.lastPdfInputTest?.success
                                    ? 'text-success'
                                    : model.lastPdfInputTest
                                      ? 'text-error'
                                      : 'text-text-muted'
                                )}
                                title={model.lastPdfInputTest?.error}
                              >
                                {model.lastPdfInputTest?.success
                                  ? 'PDF input verified'
                                  : model.lastPdfInputTest
                                    ? 'PDF input test failed'
                                    : 'PDF input not tested'}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 md:justify-end">
                            {connector.provider === 'OPENROUTER' && (
                              <>
                                <div>
                                  <label htmlFor={`document-mode-${model.modelId}`} className="sr-only">Document input mode for {model.name}</label>
                                  <select
                                    id={`document-mode-${model.modelId}`}
                                    value={model.documentInputMode}
                                    onChange={(e) =>
                                      handleUpdateModelDocumentInputMode(
                                        model,
                                        e.target.value as ConnectorModelConfig['documentInputMode']
                                      )
                                    }
                                    className="input input-sm w-28"
                                    disabled={addModelMutation.isPending}
                                    title="Document input mode"
                                  >
                                    <option value="auto">Auto input</option>
                                    <option value="pdf">PDF</option>
                                    <option value="image">Image</option>
                                  </select>
                                </div>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="xs"
                                  onClick={() => handleTestModelPdf(model)}
                                  isLoading={
                                    testModelPdfMutation.isPending &&
                                    testModelPdfMutation.variables?.modelId === model.modelId
                                  }
                                  disabled={!model.isEnabled || testModelPdfMutation.isPending}
                                >
                                  <RefreshCw className="w-3 h-3 mr-1" />
                                  Test PDF
                                </Button>
                              </>
                            )}
                            <button
                              type="button"
                              role="switch"
                              aria-label={`${model.isEnabled ? 'Disable' : 'Enable'} ${model.name}`}
                              aria-checked={model.isEnabled}
                              disabled={toggleModelMutation.isPending}
                              onClick={() =>
                                toggleModelMutation.mutate({
                                  modelId: model.modelId,
                                  isEnabled: !model.isEnabled,
                                })
                              }
                              className={cn(
                                'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-oak-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
                                model.isEnabled
                                  ? 'bg-oak-primary border-oak-primary'
                                  : 'bg-gray-300 border-gray-300 dark:bg-gray-600 dark:border-gray-600'
                              )}
                            >
                              <span
                                className={cn(
                                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out',
                                  model.isEnabled ? 'translate-x-5' : 'translate-x-0'
                                )}
                              />
                            </button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              iconOnly
                              leftIcon={<Trash2 className="w-4 h-4" />}
                              aria-label={`Remove ${model.name}`}
                              title={`Remove ${model.name}`}
                              disabled={deleteModelMutation.isPending}
                              onClick={() => handleRemoveModel(model)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        </ModalBody>
        <ModalFooter className="bg-background-secondary">
          <Button
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            isLoading={updateMutation.isPending}
          >
            Save Changes
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
