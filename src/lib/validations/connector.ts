/**
 * Connector Validation Schemas
 *
 * Zod schemas for validating connector-related API inputs.
 */

import { z } from 'zod';
import { sharePointFolderRefSchema } from '@/lib/sharepoint/folder-reference';

// ============================================================================
// Enums
// ============================================================================

export const connectorTypeEnum = z.enum(['AI_PROVIDER', 'STORAGE']);
export type ConnectorType = z.infer<typeof connectorTypeEnum>;

export const connectorProviderEnum = z.enum([
  'OPENAI',
  'ANTHROPIC',
  'GOOGLE',
  'MISTRAL',
  'OPENROUTER',
  'ONEDRIVE',
  'SHAREPOINT',
]);
export type ConnectorProvider = z.infer<typeof connectorProviderEnum>;

// ============================================================================
// Provider-Specific Credential Schemas
// ============================================================================

export const openaiCredentialsSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  organization: z.string().optional(),
});

export const anthropicCredentialsSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
});

export const googleCredentialsSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
});

export const mistralCredentialsSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
});

export const openrouterCredentialsSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(1, 'API key is required')
    .refine((value) => value.startsWith('sk-or-'), 'OpenRouter API key must start with sk-or-'),
});

export type OpenRouterCredentials = z.infer<typeof openrouterCredentialsSchema>;

export const onedriveCredentialsSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  tenantId: z.string().min(1, 'Microsoft Tenant ID is required'),
});

export const sharepointCredentialsSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  tenantId: z.string().min(1, 'Microsoft Tenant ID is required'),
  siteId: z.string().min(1, 'SharePoint Site ID is required'),
  driveId: z.string().optional(), // Optional - defaults to root document library
});

export type OpenAICredentials = z.infer<typeof openaiCredentialsSchema>;
export type AnthropicCredentials = z.infer<typeof anthropicCredentialsSchema>;
export type GoogleCredentials = z.infer<typeof googleCredentialsSchema>;
export type MistralCredentials = z.infer<typeof mistralCredentialsSchema>;
export type OneDriveCredentials = z.infer<typeof onedriveCredentialsSchema>;
export type SharePointCredentials = z.infer<typeof sharepointCredentialsSchema>;

// Union type for all credentials
export type ConnectorCredentials =
  | OpenAICredentials
  | AnthropicCredentials
  | GoogleCredentials
  | MistralCredentials
  | OpenRouterCredentials
  | OneDriveCredentials
  | SharePointCredentials;

// ============================================================================
// Provider-Specific Settings Schemas
// ============================================================================

export const aiProviderSettingsSchema = z
  .object({
    defaultModel: z.string().optional(),
    maxTokens: z.number().int().min(1).max(200000).optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .optional();

export const onedriveSettingsSchema = z
  .object({
    rootFolder: z.string().optional(), // Default folder path
    syncEnabled: z.boolean().optional(),
  })
  .optional();

export const signedDocumentFilingSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  enabledAt: z.string().datetime().optional(),
  lastVerifiedAt: z.string().datetime().optional(),
  configVersion: z.number().int().min(1).default(1),
  clientDocumentsRoot: sharePointFolderRefSchema.optional(),
  orphanDocumentsFolder: sharePointFolderRefSchema.optional(),
}).passthrough();

/**
 * This schema is intentionally non-stripping. Connector settings are shared by
 * conversion, sync, mailbox ingestion, and future integrations; parsing must
 * never erase keys owned by another feature.
 */
export const sharepointSettingsSchema = z
  .object({
    rootFolder: z.string().optional(), // Default folder path within the library
    syncEnabled: z.boolean().optional(),
    documentLibraryName: z.string().optional(), // For display purposes
    mailboxUserId: z.string().optional(),
    mailboxUserIds: z.array(z.string()).optional(),
    ingestAllEmails: z.boolean().optional(),
    signedDocumentFiling: signedDocumentFilingSettingsSchema.optional(),
  })
  .passthrough()
  .optional()
  .nullable();

export const sharepointSignedFilingUpdateSchema = z.object({
  connectorId: z.string().uuid(),
  clientDocumentsRoot: sharePointFolderRefSchema.nullable().optional(),
  orphanDocumentsFolder: sharePointFolderRefSchema.nullable().optional(),
  enabled: z.boolean().optional(),
}).strict();

export type SharePointSettings = z.infer<typeof sharepointSettingsSchema>;
export type SharePointSignedFilingUpdate = z.infer<typeof sharepointSignedFilingUpdateSchema>;

export interface ParsedSharePointSettings {
  [key: string]: unknown;
  signedDocumentFiling: {
    enabled: boolean;
    configVersion: number;
    enabledAt?: string;
    lastVerifiedAt?: string;
    clientDocumentsRoot?: z.infer<typeof sharePointFolderRefSchema>;
    orphanDocumentsFolder?: z.infer<typeof sharePointFolderRefSchema>;
  };
}

/** Apply the compatibility default without rewriting the connector record. */
export function parseSharePointSettings(value: unknown): ParsedSharePointSettings {
  const parsed = sharepointSettingsSchema.parse(value) ?? {};
  return {
    ...parsed,
    signedDocumentFiling: {
      enabled: false,
      configVersion: 1,
      ...(parsed.signedDocumentFiling ?? {}),
    },
  };
}

// ============================================================================
// Create Connector
// ============================================================================

export const createConnectorSchema = z.object({
  tenantId: z.string().uuid('Invalid tenant ID').optional().nullable(),
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters'),
  type: connectorTypeEnum,
  provider: connectorProviderEnum,
  credentials: z.record(z.unknown()),
  settings: z.record(z.unknown()).optional().nullable(),
  isEnabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

export type CreateConnectorInput = z.infer<typeof createConnectorSchema>;

// ============================================================================
// Update Connector
// ============================================================================

export const updateConnectorSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters')
    .optional(),
  credentials: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional().nullable(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export type UpdateConnectorInput = z.infer<typeof updateConnectorSchema>;

// ============================================================================
// Connector Search
// ============================================================================

export const connectorSearchSchema = z.object({
  tenantId: z.string().uuid('Invalid tenant ID').optional(),
  type: connectorTypeEnum.optional(),
  provider: connectorProviderEnum.optional(),
  isEnabled: z.coerce.boolean().optional(),
  includeSystem: z.coerce.boolean().default(true),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ConnectorSearchInput = z.infer<typeof connectorSearchSchema>;

// ============================================================================
// Workspace Connector Access
// ============================================================================

export const updateWorkspaceAccessSchema = z.object({
  workspaceAccess: z.array(
    z.object({
      workspaceId: z.string().uuid('Invalid workspace ID'),
      isEnabled: z.boolean(),
    })
  ),
});

export type UpdateWorkspaceAccessInput = z.infer<typeof updateWorkspaceAccessSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate credentials based on provider type
 */
export function validateCredentials(
  provider: ConnectorProvider,
  credentials: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  switch (provider) {
    case 'OPENAI': {
      const result = openaiCredentialsSchema.safeParse(credentials);
      if (!result.success) {
        errors.push(...result.error.issues.map((i) => i.message));
      }
      break;
    }
    case 'ANTHROPIC': {
      const result = anthropicCredentialsSchema.safeParse(credentials);
      if (!result.success) {
        errors.push(...result.error.issues.map((i) => i.message));
      }
      break;
    }
    case 'GOOGLE': {
      const result = googleCredentialsSchema.safeParse(credentials);
      if (!result.success) {
        errors.push(...result.error.issues.map((i) => i.message));
      }
      break;
    }
    case 'MISTRAL': {
      const result = mistralCredentialsSchema.safeParse(credentials);
      if (!result.success) {
        errors.push(...result.error.issues.map((i) => i.message));
      }
      break;
    }
    case 'OPENROUTER': {
      const result = openrouterCredentialsSchema.safeParse(credentials);
      if (!result.success) {
        errors.push(...result.error.issues.map((i) => i.message));
      }
      break;
    }
    case 'ONEDRIVE': {
      const result = onedriveCredentialsSchema.safeParse(credentials);
      if (!result.success) {
        errors.push(...result.error.issues.map((i) => i.message));
      }
      break;
    }
    case 'SHAREPOINT': {
      const result = sharepointCredentialsSchema.safeParse(credentials);
      if (!result.success) {
        errors.push(...result.error.issues.map((i) => i.message));
      }
      break;
    }
    default:
      errors.push(`Unknown provider: ${provider}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Get provider type for a given provider
 */
export function getProviderType(provider: ConnectorProvider): ConnectorType {
  switch (provider) {
    case 'OPENAI':
    case 'ANTHROPIC':
    case 'GOOGLE':
    case 'MISTRAL':
    case 'OPENROUTER':
      return 'AI_PROVIDER';
    case 'ONEDRIVE':
    case 'SHAREPOINT':
      return 'STORAGE';
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Get providers for a given type
 */
export function getProvidersForType(type: ConnectorType): ConnectorProvider[] {
  switch (type) {
    case 'AI_PROVIDER':
      return ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'MISTRAL', 'OPENROUTER'];
    case 'STORAGE':
      return ['ONEDRIVE', 'SHAREPOINT'];
    default:
      return [];
  }
}

/**
 * Get display name for provider
 */
export function getProviderDisplayName(provider: ConnectorProvider): string {
  const names: Record<ConnectorProvider, string> = {
    OPENAI: 'OpenAI',
    ANTHROPIC: 'Anthropic',
    GOOGLE: 'Google AI',
    MISTRAL: 'Mistral OCR',
    OPENROUTER: 'OpenRouter',
    ONEDRIVE: 'OneDrive',
    SHAREPOINT: 'SharePoint',
  };
  return names[provider] || provider;
}

/**
 * Get display name for connector type
 */
export function getTypeDisplayName(type: ConnectorType): string {
  const names: Record<ConnectorType, string> = {
    AI_PROVIDER: 'AI Provider',
    STORAGE: 'Storage/ Email',
  };
  return names[type] || type;
}
