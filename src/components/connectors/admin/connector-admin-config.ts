import type { Connector } from '@/hooks/use-connectors';
import type { ReasoningDefaults } from '@/lib/ai/reasoning-settings';

/**
 * Convert a Date to a local YYYY-MM-DD string (uses browser timezone, not UTC)
 */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ============================================================================
// Types
// ============================================================================

export type ConnectorType = 'AI_PROVIDER' | 'STORAGE';
export type ConnectorProvider =
  | 'OPENAI'
  | 'ANTHROPIC'
  | 'GOOGLE'
  | 'OPENROUTER'
  | 'MISTRAL'
  | 'ONEDRIVE'
  | 'SHAREPOINT';
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
export const MODEL_DEFAULT_GROUPS = [
  { key: 'general', label: 'General default', description: 'Everyday AI requests and general-purpose work.' },
  { key: 'ocr', label: 'OCR default', description: 'OCR and document text extraction.' },
  { key: 'research', label: 'Research default', description: 'Research and search-oriented tasks.' },
  { key: 'businessAssistant', label: 'Business Assistant default', description: 'Business Assistant planning and actions.' },
  { key: 'bizfileExtraction', label: 'BizFile extraction default', description: 'Structured extraction from BizFile documents.' },
] as const;

export type ModelDefaultGroup = (typeof MODEL_DEFAULT_GROUPS)[number]['key'];
export type ModelDefaults = Record<ModelDefaultGroup, string>;

export const EMPTY_MODEL_DEFAULTS: ModelDefaults = {
  general: '',
  ocr: '',
  research: '',
  businessAssistant: '',
  bizfileExtraction: '',
};

export function parseMailboxUserIdsInput(raw: string): {
  mailboxUserIds: string[];
  invalidValues: string[];
} {
  const values = raw
    .split(/[,\n]/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const unique = [...new Set(values)];
  const invalidValues = unique.filter((value) => !EMAIL_REGEX.test(value));
  return {
    mailboxUserIds: unique.filter((value) => EMAIL_REGEX.test(value)),
    invalidValues,
  };
}

export function extractMailboxUserIdsFromSettings(settings: Record<string, unknown> | null): string[] {
  if (!settings || typeof settings !== 'object') return [];

  const results: string[] = [];
  const mailboxUserId = settings.mailboxUserId;
  if (typeof mailboxUserId === 'string' && mailboxUserId.trim()) {
    results.push(mailboxUserId.trim().toLowerCase());
  }

  const mailboxUserIds = settings.mailboxUserIds;
  if (Array.isArray(mailboxUserIds)) {
    for (const value of mailboxUserIds) {
      if (typeof value === 'string' && value.trim()) {
        results.push(value.trim().toLowerCase());
      }
    }
  }

  return [...new Set(results)];
}

export function extractModelDefaultsFromSettings(settings: Record<string, unknown> | null): ModelDefaults {
  const defaults: ModelDefaults = { ...EMPTY_MODEL_DEFAULTS };
  if (!settings || typeof settings !== 'object') return defaults;

  const modelDefaults = settings.modelDefaults;
  if (modelDefaults && typeof modelDefaults === 'object' && !Array.isArray(modelDefaults)) {
    for (const group of MODEL_DEFAULT_GROUPS) {
      const value = (modelDefaults as Record<string, unknown>)[group.key];
      if (typeof value === 'string') {
        defaults[group.key] = value;
      }
    }
  }

  if (!defaults.general && typeof settings.defaultModel === 'string') {
    defaults.general = settings.defaultModel;
  }

  return defaults;
}

export function maskCredentialPreview(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  if (trimmed.includes('...')) {
    return trimmed;
  }

  if (trimmed.length <= 4) {
    return '*'.repeat(trimmed.length);
  }

  return `xxx${trimmed.slice(-4)}`;
}

export function getCredentialPlaceholder(
  connector: Connector,
  credentialKey: string
): string {
  const currentValue = connector.credentials?.[credentialKey];

  if (typeof currentValue !== 'string' || !currentValue.trim()) {
    return 'Leave blank to keep current';
  }

  return `Current: ${maskCredentialPreview(currentValue)}`;
}

export interface CreateFormData {
  name: string;
  type: ConnectorType;
  provider: ConnectorProvider;
  workspaceId: string | null;
  credentials: Record<string, string>;
  mailboxUserIdsText: string;
  isEnabled: boolean;
}

export interface EditFormData {
  name: string;
  credentials: Record<string, string>;
  mailboxUserIdsText: string;
  modelDefaults: ModelDefaults;
  reasoningDefaults: ReasoningDefaults;
  isEnabled: boolean;
}

// ============================================================================
// Constants
// ============================================================================

export const INITIAL_CREATE_FORM: CreateFormData = {
  name: '',
  type: 'AI_PROVIDER',
  provider: 'OPENAI',
  workspaceId: null,
  credentials: {},
  mailboxUserIdsText: '',
  isEnabled: true,
};
