'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, AlertCircle, ChevronDown, MessageSquare, Check } from 'lucide-react';
import { MISTRAL_OCR_MODEL_ID, MISTRAL_OCR_MODEL_NAME } from '@/lib/ocr/constants';

// Types matching the API response
interface AIModel {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  description: string;
  available: boolean;
  supportsJson: boolean;
  supportsVision: boolean;
  isDefault: boolean;
}

interface AIProvider {
  id: string;
  name: string;
  available: boolean;
  configured: boolean;
}

interface GroupedModel {
  id: string;
  name: string;
  description: string;
  available: boolean;
}

interface AIModelsResponse {
  models: AIModel[];
  providers: AIProvider[];
  defaultModel: string | null;
  defaultModels?: {
    general: string | null;
    ocr: string | null;
    research: string | null;
  };
  mistralOcrAvailable?: boolean;
  grouped: {
    openai: GroupedModel[];
    anthropic: GroupedModel[];
    google: GroupedModel[];
    openrouter: GroupedModel[];
  };
}

/** Standard context options that can be injected */
export interface StandardContextOption {
  id: string;
  label: string;
  getValue: () => string;
}

/** Default standard context options */
export const DEFAULT_STANDARD_CONTEXTS: StandardContextOption[] = [
  {
    id: 'datetime',
    label: 'Current Date & Time',
    getValue: () => `Current date and time: ${new Date().toLocaleString()}`,
  },
  {
    id: 'date',
    label: 'Current Date',
    getValue: () => `Current date: ${new Date().toLocaleDateString()}`,
  },
  {
    id: 'timezone',
    label: 'Timezone Info',
    getValue: () => `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
  },
];

interface AIModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  label?: string;
  placeholder?: string;
  autoOptionLabel?: string;
  helpText?: string;
  disabled?: boolean;
  className?: string;
  /** Allow leaving the selector blank to let the backend choose automatically */
  allowAuto?: boolean;
  /** Compact variant without card wrapper */
  variant?: 'default' | 'compact';
  /** Show an empty placeholder option in the select */
  showEmptyOption?: boolean;
  /** Show only models that support JSON mode */
  jsonModeOnly?: boolean;
  /** Show detailed model info */
  showDetails?: boolean;
  /** Show context input field */
  showContextInput?: boolean;
  /** Current context value */
  contextValue?: string;
  /** Callback when context changes */
  onContextChange?: (context: string) => void;
  /** Context field label */
  contextLabel?: string;
  /** Context field placeholder */
  contextPlaceholder?: string;
  /** Context field help text */
  contextHelpText?: string;
  /** Maximum characters for context */
  contextMaxLength?: number;
  /** Show standard context checkboxes */
  showStandardContexts?: boolean;
  /** Custom standard context options (defaults to DEFAULT_STANDARD_CONTEXTS) */
  standardContextOptions?: StandardContextOption[];
  /** Currently selected standard context IDs */
  selectedStandardContexts?: string[];
  /** Callback when standard context selection changes */
  onStandardContextsChange?: (selectedIds: string[]) => void;
  /** Tenant ID for connector-aware model availability (SUPER_ADMIN use) */
  tenantId?: string;
  /** Show a dedicated Mistral OCR option when available */
  includeMistralOcrOption?: boolean;
  /** Which configured connector default should seed this selector */
  defaultGroup?: 'general' | 'ocr' | 'research';
}

/**
 * Reusable AI model selector component
 * Displays a dropdown to select an AI model for various operations,
 * with optional context input field for providing additional instructions to the AI.
 */
export function AIModelSelector({
  value,
  onChange,
  label = 'AI Model',
  placeholder = '-- Select a model --',
  autoOptionLabel = 'Auto (Recommended)',
  helpText,
  disabled = false,
  className = '',
  allowAuto = false,
  variant = 'default',
  showEmptyOption = true,
  jsonModeOnly = false,
  showDetails = true,
  showContextInput = false,
  contextValue = '',
  onContextChange,
  contextLabel = 'Additional Context',
  contextPlaceholder = 'Provide any additional context or instructions for the AI...',
  contextHelpText,
  contextMaxLength = 500,
  showStandardContexts = false,
  standardContextOptions = DEFAULT_STANDARD_CONTEXTS,
  selectedStandardContexts = [],
  onStandardContextsChange,
  tenantId,
  includeMistralOcrOption = false,
  defaultGroup = 'general',
}: AIModelSelectorProps) {
  const [data, setData] = useState<AIModelsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track the previous default model from API to detect when it changes
  const previousDefaultRef = useRef<string | null>(null);
  const hasMistralOcrOption = includeMistralOcrOption && Boolean(data?.mistralOcrAvailable);

  // Fetch available models (re-fetch when tenantId changes)
  useEffect(() => {
    let cancelled = false;

    async function fetchModels() {
      try {
        setIsLoading(true);
        // Pass tenantId for connector-aware model availability
        const url = tenantId ? `/api/ai/models?tenantId=${tenantId}` : '/api/ai/models';
        const response = await fetch(url);

        // Don't update state if this request was cancelled (newer request in flight)
        if (cancelled) return;

        if (!response.ok) {
          throw new Error('Failed to fetch AI models');
        }
        const result = await response.json();

        // Don't update state if this request was cancelled
        if (cancelled) return;

        setData(result);
        const selectedDefaultModel =
          result.defaultModels?.[defaultGroup as keyof typeof result.defaultModels] ??
          result.defaultModel;

        // Auto-select default model in these cases:
        // 1. No value currently selected
        // 2. Current value is not available for this tenant (e.g., tenant changed)
        // 3. The API default changed (e.g., configured default became available after tenant selection)
        const currentModelAvailable = value === MISTRAL_OCR_MODEL_ID
          ? includeMistralOcrOption && Boolean(result.mistralOcrAvailable)
          : result.models?.some(
              (m: { id: string; available: boolean }) => m.id === value && m.available
            );

        const defaultChanged = previousDefaultRef.current !== null &&
                               previousDefaultRef.current !== selectedDefaultModel;

        // Update the ref for next comparison
        previousDefaultRef.current = selectedDefaultModel;

        if (allowAuto) {
          if (value && !currentModelAvailable) {
            onChange('');
          }
          return;
        }

        if (selectedDefaultModel && (!value || !currentModelAvailable || defaultChanged)) {
          onChange(selectedDefaultModel);
          return;
        }

        if (
          includeMistralOcrOption &&
          result.mistralOcrAvailable &&
          (!value || !currentModelAvailable) &&
          !selectedDefaultModel
        ) {
          onChange(MISTRAL_OCR_MODEL_ID);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load models');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchModels();

    // Cleanup: cancel this request if tenantId changes before it completes
    return () => {
      cancelled = true;
    };
  }, [tenantId, defaultGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter models based on requirements
  const filteredModels = data?.models?.filter((m) => {
    if (!m.available) return false;
    if (jsonModeOnly && !m.supportsJson) return false;
    return true;
  });

  // Get selected model info
  const selectedModel = data?.models?.find((m) => m.id === value);
  const selectedSpecialModel = value === MISTRAL_OCR_MODEL_ID && hasMistralOcrOption
    ? {
        providerName: 'Mistral OCR',
        description: 'OCR-first extraction for scanned documents, with optional batch processing.',
      }
    : null;

  // Check if no models are available
  const hasProviderModels = Boolean(filteredModels && filteredModels.length > 0);
  const noModelsAvailable = !isLoading && !hasProviderModels && !hasMistralOcrOption;
  const autoOnlyMode = allowAuto && noModelsAvailable;

  // Handle context change - must be before any early returns
  const handleContextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      if (newValue.length <= contextMaxLength) {
        onContextChange?.(newValue);
      }
    },
    [onContextChange, contextMaxLength]
  );

  // Handle standard context toggle - must be before any early returns
  const handleStandardContextToggle = useCallback(
    (contextId: string) => {
      if (!onStandardContextsChange) return;

      const isSelected = selectedStandardContexts.includes(contextId);
      if (isSelected) {
        onStandardContextsChange(selectedStandardContexts.filter(id => id !== contextId));
      } else {
        onStandardContextsChange([...selectedStandardContexts, contextId]);
      }
    },
    [selectedStandardContexts, onStandardContextsChange]
  );

  const selectElement = (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input input-sm w-full appearance-none pr-8"
        disabled={disabled || isLoading || (!allowAuto && noModelsAvailable)}
      >
        {isLoading ? (
          <option value="">Loading models...</option>
        ) : noModelsAvailable ? (
          allowAuto ? (
            <option value="">{autoOptionLabel}</option>
          ) : (
            <option value="">No AI models available</option>
          )
        ) : (
          <>
            {showEmptyOption && (
              <option value="">{allowAuto ? autoOptionLabel : placeholder}</option>
            )}
            {hasMistralOcrOption && (
              <optgroup label="OCR">
                <option value={MISTRAL_OCR_MODEL_ID}>{MISTRAL_OCR_MODEL_NAME}</option>
              </optgroup>
            )}
            {/* Group by provider */}
            {data?.providers
              ?.filter((p) => p.available)
              .map((provider) => {
                const providerModels = filteredModels?.filter((m) => m.provider === provider.id);
                if (!providerModels?.length) return null;

                return (
                  <optgroup key={provider.id} label={provider.name}>
                    {providerModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                        {model.isDefault ? ' (Default)' : ''}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
          </>
        )}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
    </div>
  );

  // Error state
  if (error) {
    return (
      <div className={`mb-6 ${className}`}>
        <div className="card border-status-error bg-status-error/5">
          <div className="flex items-center gap-3 text-status-error">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // No models available warning
  const noModelsWarning = noModelsAvailable && (
    allowAuto ? (
      <div className="mt-2 p-3 bg-status-info/10 border border-status-info/30 rounded text-sm text-status-info">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>
            No AI models are currently available in the selector. Configure an AI connector in
            Admin &rarr; Connectors, or enable Mistral OCR there if you want the OCR option to appear.
          </span>
        </div>
      </div>
    ) : (
      <div className="mt-2 p-3 bg-status-warning/10 border border-status-warning/30 rounded text-sm text-status-warning">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>
            No AI providers are configured. Please configure an AI connector in Admin &rarr; Connectors,
            or set up environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_AI_API_KEY).
          </span>
        </div>
      </div>
    )
  );

  // Model details
  const modelDetails = showDetails && (selectedModel || selectedSpecialModel) && (
    <div className="mt-2 text-xs text-text-secondary">
      <span className="font-medium">
        {selectedModel?.providerName || selectedSpecialModel?.providerName}
      </span>
      <span className="mx-1">•</span>
      <span>{selectedModel?.description || selectedSpecialModel?.description}</span>
    </div>
  );

  // Standard context checkboxes element
  const standardContextsElement = showStandardContexts && standardContextOptions.length > 0 && (
    <div className="mt-3 mb-2 flex flex-wrap gap-2">
      {standardContextOptions.map((option) => {
        const isSelected = selectedStandardContexts.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => handleStandardContextToggle(option.id)}
            disabled={disabled}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors ${
              isSelected
                ? 'bg-oak-primary/10 border-oak-primary text-oak-primary'
                : 'bg-background-elevated border-border-secondary text-text-secondary hover:border-oak-primary/50'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {isSelected && <Check className="w-3 h-3" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );

  // Context input element
  const contextInputElement = showContextInput && (
    <div className="mt-4 pt-4 border-t border-border-primary">
      <div className="flex items-start gap-3">
        <MessageSquare className="w-4 h-4 text-text-tertiary mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <label className="label mb-1 text-sm">{contextLabel}</label>
          {standardContextsElement}
          <textarea
            value={contextValue}
            onChange={handleContextChange}
            placeholder={contextPlaceholder}
            disabled={disabled}
            rows={2}
            className="input w-full text-sm resize-none mt-2 px-3 py-2.5"
            maxLength={contextMaxLength}
          />
          <div className="flex items-center justify-between mt-2.5 px-0.5">
            {contextHelpText ? (
              <p className="text-xs text-text-muted leading-relaxed pr-4">{contextHelpText}</p>
            ) : (
              <span />
            )}
            <span className="text-xs text-text-tertiary flex-shrink-0">
              {contextValue.length}/{contextMaxLength}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  if (variant === 'compact') {
    return (
      <div className={className}>
        <label className="label mb-2">{label}</label>
        {selectElement}
        {modelDetails}
        {noModelsWarning}
        {!value && helpText && (!noModelsAvailable || autoOnlyMode) && (
          <p className="text-xs text-text-muted mt-1">{helpText}</p>
        )}
        {contextInputElement}
      </div>
    );
  }

  return (
    <div className={`mb-6 ${className}`}>
      <div className="card">
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-oak-light" />
          <div className="flex-1">
            <label className="label mb-1">{label}</label>
            {selectElement}
            {modelDetails}
          </div>
        </div>
        {noModelsWarning}
        {!value && helpText && (!noModelsAvailable || autoOnlyMode) && (
          <p className="text-sm text-text-muted mt-2 ml-8">{helpText}</p>
        )}
        {contextInputElement}
      </div>
    </div>
  );
}

/**
 * Hook to fetch and manage AI models state
 * @param tenantId - Optional tenant ID for connector-aware model availability
 */
export function useAIModels(tenantId?: string) {
  const [data, setData] = useState<AIModelsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchModels() {
      try {
        setIsLoading(true);
        const url = tenantId ? `/api/ai/models?tenantId=${tenantId}` : '/api/ai/models';
        const response = await fetch(url);

        if (cancelled) return;

        if (!response.ok) {
          throw new Error('Failed to fetch AI models');
        }
        const result = await response.json();

        if (cancelled) return;

        setData(result);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load models');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchModels();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return {
    models: data?.models || [],
    providers: data?.providers || [],
    defaultModel: data?.defaultModel,
    defaultModels: data?.defaultModels,
    grouped: data?.grouped,
    mistralOcrAvailable: data?.mistralOcrAvailable ?? false,
    isLoading,
    error,
    hasAvailableModels:
      (data?.models?.some((m) => m.available) ?? false) || (data?.mistralOcrAvailable ?? false),
  };
}

/**
 * Get provider icon for display
 */
export function getProviderIcon(providerId: string): string {
  switch (providerId) {
    case 'openai':
      return 'ðŸ¤–';
    case 'anthropic':
      return 'ðŸ”®';
    case 'google':
      return 'âœ¨';
    default:
      return 'ðŸ§ ';
  }
}

/**
 * Build the full context string including standard contexts and custom text
 *
 * @param selectedStandardContexts - Array of selected standard context IDs
 * @param customContext - Custom context text from the user
 * @param standardContextOptions - Available standard context options (defaults to DEFAULT_STANDARD_CONTEXTS)
 * @returns Combined context string ready to send to the AI
 */
export function buildFullContext(
  selectedStandardContexts: string[],
  customContext: string = '',
  standardContextOptions: StandardContextOption[] = DEFAULT_STANDARD_CONTEXTS
): string {
  const parts: string[] = [];

  // Add selected standard contexts
  for (const contextId of selectedStandardContexts) {
    const option = standardContextOptions.find(o => o.id === contextId);
    if (option) {
      parts.push(option.getValue());
    }
  }

  // Add custom context
  if (customContext.trim()) {
    parts.push(customContext.trim());
  }

  return parts.join('\n');
}
