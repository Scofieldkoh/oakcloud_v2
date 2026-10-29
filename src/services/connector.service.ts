/**
 * Connector Service
 *
 * Business logic for connector management including CRUD operations,
 * credential encryption, connection testing, and resolution logic.
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import type { Connector, ConnectorType, ConnectorProvider } from '@/generated/prisma';
import { encrypt, decrypt, maskSensitive } from '@/lib/encryption';
import { createAuditLog, computeChanges } from '@/lib/audit';
import type {
  CreateConnectorInput,
  UpdateConnectorInput,
  ConnectorSearchInput,
  UpdateWorkspaceAccessInput,
} from '@/lib/validations/connector';
import { validateCredentials } from '@/lib/validations/connector';

// ============================================================================
// Types
// ============================================================================

export interface ConnectorWithDecryptedCredentials extends Omit<Connector, 'credentials'> {
  credentials: Record<string, unknown>;
}

export interface ConnectorWithMaskedCredentials extends Omit<Connector, 'credentials'> {
  credentials: Record<string, unknown>;
  credentialsMasked: boolean;
}

export interface ResolvedConnector {
  connector: ConnectorWithDecryptedCredentials;
  source: 'workspace' | 'system';
}

export interface TenantAwareParams {
  tenantId?: string | null;
  userId: string;
  isSuperAdmin: boolean;
}

export interface WorkspaceAccessEntry {
  workspaceId: string;
  workspaceName: string;
  isEnabled: boolean;
}

export interface TestResult {
  success: boolean;
  error?: string;
  latencyMs?: number;
}

function maskCredentialMap(credentials: Record<string, unknown>): Record<string, unknown> {
  const maskedCredentials: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(credentials)) {
    if (typeof value === 'string') {
      maskedCredentials[key] = maskSensitive(value);
    } else {
      maskedCredentials[key] = value;
    }
  }

  return maskedCredentials;
}

function getMaskedCredentialsForConnector(connector: Connector): {
  credentials: Record<string, unknown>;
  credentialsMasked: boolean;
} {
  try {
    const decrypted = JSON.parse(decrypt(connector.credentials)) as Record<string, unknown>;
    return {
      credentials: maskCredentialMap(decrypted),
      credentialsMasked: true,
    };
  } catch (error) {
    console.error(`Unable to decrypt credentials for connector ${connector.id}:`, error);
    return {
      credentials: {},
      credentialsMasked: false,
    };
  }
}

function formatTestError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unknown error';
  }

  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) {
    return `${error.message}: ${cause.message}`;
  }

  if (cause && typeof cause === 'object') {
    const causeCode =
      'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;
    const causeMessage =
      'message' in cause && typeof cause.message === 'string' ? cause.message : undefined;

    if (causeCode || causeMessage) {
      return [error.message, causeCode, causeMessage].filter(Boolean).join(' | ');
    }
  }

  return error.message;
}

// Fields tracked for audit logging
const TRACKED_FIELDS = ['name', 'isEnabled', 'isDefault', 'settings'];

// ============================================================================
// Create Connector
// ============================================================================

export async function createConnector(
  data: CreateConnectorInput,
  params: TenantAwareParams
): Promise<Connector> {
  const { userId, isSuperAdmin } = params;

  // Only SUPER_ADMIN can create system connectors (workspaceId = null)
  if (data.tenantId === null && !isSuperAdmin) {
    throw new Error('Only super admins can create system connectors');
  }

  // Validate credentials for provider
  const credentialValidation = validateCredentials(
    data.provider as ConnectorProvider,
    data.credentials
  );
  if (!credentialValidation.valid) {
    throw new Error(`Invalid credentials: ${credentialValidation.errors.join(', ')}`);
  }

  // Check for duplicate provider within scope
  const existing = await prisma.connector.findFirst({
    where: {
      workspaceId: data.tenantId ?? null,
      provider: data.provider as ConnectorProvider,
      deletedAt: null,
    },
  });

  if (existing) {
    throw new Error(`A ${data.provider} connector already exists in this scope`);
  }

  // Encrypt credentials
  const encryptedCredentials = encrypt(JSON.stringify(data.credentials));

  // If setting as default, unset other defaults for same type/scope
  if (data.isDefault) {
    await prisma.connector.updateMany({
      where: {
        workspaceId: data.tenantId ?? null,
        type: data.type as ConnectorType,
        isDefault: true,
        deletedAt: null,
      },
      data: { isDefault: false },
    });
  }

  const connector = await prisma.connector.create({
    data: {
      workspaceId: data.tenantId ?? null,
      name: data.name,
      type: data.type as ConnectorType,
      provider: data.provider as ConnectorProvider,
      credentials: encryptedCredentials,
      settings: data.settings ? (data.settings as Prisma.InputJsonValue) : Prisma.JsonNull,
      isEnabled: data.isEnabled ?? true,
      isDefault: data.isDefault ?? false,
    },
  });

  await createAuditLog({
    tenantId: data.tenantId ?? undefined,
    userId,
    action: 'CONNECTOR_CREATED',
    entityType: 'Connector',
    entityId: connector.id,
    entityName: connector.name,
    summary: `Created ${data.provider} connector "${connector.name}"${data.tenantId === null ? ' (system)' : ''}`,
    changeSource: 'MANUAL',
    metadata: {
      type: data.type,
      provider: data.provider,
      isSystem: data.tenantId === null,
    },
  });

  return connector;
}

// ============================================================================
// Update Connector
// ============================================================================

export async function updateConnector(
  id: string,
  data: UpdateConnectorInput,
  params: TenantAwareParams
): Promise<Connector> {
  const { tenantId, userId, isSuperAdmin } = params;

  const existing = await prisma.connector.findFirst({
    where: { id, deletedAt: null },
  });

  if (!existing) {
    throw new Error('Connector not found');
  }

  // Access control
  if (existing.workspaceId === null && !isSuperAdmin) {
    throw new Error('Only super admins can modify system connectors');
  }
  if (existing.workspaceId !== null && existing.workspaceId !== tenantId && !isSuperAdmin) {
    throw new Error('Access denied');
  }

  const updateData: Prisma.ConnectorUpdateInput = {};

  if (data.name !== undefined) updateData.name = data.name;
  if (data.settings !== undefined) {
    if (data.settings === null) {
      updateData.settings = Prisma.JsonNull;
    } else {
      const existingSettings =
        existing.settings && typeof existing.settings === 'object' && !Array.isArray(existing.settings)
          ? (existing.settings as Record<string, unknown>)
          : {};
      const nextSettings = { ...data.settings };

      // Signed-document filing has a dedicated settings API. Preserve it
      // when older/general connector forms submit a stale settings snapshot.
      if (
        Object.prototype.hasOwnProperty.call(existingSettings, 'signedDocumentFiling')
        && !Object.prototype.hasOwnProperty.call(nextSettings, 'signedDocumentFiling')
      ) {
        nextSettings.signedDocumentFiling = existingSettings.signedDocumentFiling;
      }

      updateData.settings = nextSettings as Prisma.InputJsonValue;
    }
  }
  if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;

  // Handle credentials update
  if (data.credentials !== undefined) {
    // Get existing credentials and merge with new values
    const existingCredentials = JSON.parse(decrypt(existing.credentials)) as Record<string, unknown>;

    // Only merge non-empty values from the update
    const mergedCredentials = { ...existingCredentials };
    for (const [key, value] of Object.entries(data.credentials)) {
      if (value !== undefined && value !== null && value !== '') {
        mergedCredentials[key] = value;
      }
    }

    // Validate merged credentials
    const credentialValidation = validateCredentials(
      existing.provider,
      mergedCredentials
    );
    if (!credentialValidation.valid) {
      throw new Error(`Invalid credentials: ${credentialValidation.errors.join(', ')}`);
    }
    updateData.credentials = encrypt(JSON.stringify(mergedCredentials));
  }

  // Handle default flag
  if (data.isDefault === true) {
    await prisma.connector.updateMany({
      where: {
        workspaceId: existing.workspaceId,
        type: existing.type,
        isDefault: true,
        deletedAt: null,
        NOT: { id },
      },
      data: { isDefault: false },
    });
    updateData.isDefault = true;
  } else if (data.isDefault === false) {
    updateData.isDefault = false;
  }

  const connector = await prisma.connector.update({
    where: { id },
    data: updateData,
  });

  // Compute and log changes (excluding credentials for security)
  const changes = computeChanges(
    existing as unknown as Record<string, unknown>,
    data as Record<string, unknown>,
    TRACKED_FIELDS
  );

  if (changes || data.credentials) {
    // Log enable/disable as separate action
    const action =
      data.isEnabled === true
        ? 'CONNECTOR_ENABLED'
        : data.isEnabled === false
          ? 'CONNECTOR_DISABLED'
          : 'CONNECTOR_UPDATED';

    await createAuditLog({
      tenantId: existing.workspaceId ?? undefined,
      userId,
      action,
      entityType: 'Connector',
      entityId: connector.id,
      entityName: connector.name,
      summary: `Updated connector "${connector.name}"`,
      changeSource: 'MANUAL',
      changes: changes ?? undefined,
      metadata: {
        credentialsUpdated: data.credentials !== undefined,
      },
    });
  }

  return connector;
}

// ============================================================================
// Delete Connector
// ============================================================================

export async function deleteConnector(
  id: string,
  params: TenantAwareParams,
  reason: string
): Promise<Connector> {
  const { tenantId, userId, isSuperAdmin } = params;

  const existing = await prisma.connector.findFirst({
    where: { id, deletedAt: null },
  });

  if (!existing) {
    throw new Error('Connector not found');
  }

  // Access control
  if (existing.workspaceId === null && !isSuperAdmin) {
    throw new Error('Only super admins can delete system connectors');
  }
  if (existing.workspaceId !== null && existing.workspaceId !== tenantId && !isSuperAdmin) {
    throw new Error('Access denied');
  }

  const connector = await prisma.connector.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await createAuditLog({
    tenantId: existing.workspaceId ?? undefined,
    userId,
    action: 'CONNECTOR_DELETED',
    entityType: 'Connector',
    entityId: connector.id,
    entityName: connector.name,
    summary: `Deleted connector "${connector.name}"`,
    changeSource: 'MANUAL',
    reason,
    metadata: {
      provider: existing.provider,
      isSystem: existing.workspaceId === null,
    },
  });

  return connector;
}

// ============================================================================
// Get Connector
// ============================================================================

export async function getConnectorById(
  id: string,
  params: TenantAwareParams
): Promise<ConnectorWithDecryptedCredentials | null> {
  const { tenantId, isSuperAdmin } = params;

  const connector = await prisma.connector.findFirst({
    where: { id, deletedAt: null },
  });

  if (!connector) return null;

  // Access control
  if (connector.workspaceId === null && !isSuperAdmin) {
    // Workspace admins can see system connectors but not credentials
    throw new Error('Access denied to system connector credentials');
  }
  if (connector.workspaceId !== null && connector.workspaceId !== tenantId && !isSuperAdmin) {
    throw new Error('Access denied');
  }

  return {
    ...connector,
    credentials: JSON.parse(decrypt(connector.credentials)),
  };
}

/**
 * Get connector with masked credentials (safe for non-owners)
 */
export async function getConnectorWithMaskedCredentials(
  id: string,
  params: TenantAwareParams
): Promise<ConnectorWithMaskedCredentials | null> {
  const { tenantId, isSuperAdmin } = params;

  const connector = await prisma.connector.findFirst({
    where: { id, deletedAt: null },
  });

  if (!connector) return null;

  // Access control - workspace admins can view system connectors but never receive raw secrets.
  if (!isSuperAdmin && connector.workspaceId !== null && connector.workspaceId !== tenantId) {
    throw new Error('Access denied');
  }

  const decrypted = JSON.parse(decrypt(connector.credentials)) as Record<string, unknown>;
  const credentials = maskCredentialMap(decrypted);

  return {
    ...connector,
    credentials,
    credentialsMasked: true,
  };
}

// ============================================================================
// Search Connectors
// ============================================================================

export async function searchConnectors(
  searchParams: ConnectorSearchInput,
  params: TenantAwareParams
): Promise<{
  connectors: ConnectorWithMaskedCredentials[];
  total: number;
  page: number;
  limit: number;
}> {
  const { tenantId, isSuperAdmin } = params;

  const where: Prisma.ConnectorWhereInput = {
    deletedAt: null,
  };

  // Build scope filter
  if (isSuperAdmin) {
    // SUPER_ADMIN can see all
    if (searchParams.tenantId) {
      // Filter to specific workspace + system connectors
      if (searchParams.includeSystem) {
        where.OR = [{ workspaceId: searchParams.tenantId }, { workspaceId: null }];
      } else {
        where.workspaceId = searchParams.tenantId;
      }
    }
    // If no workspace filter, show all connectors
  } else {
    // Workspace admins can see their own + system
    if (searchParams.includeSystem) {
      where.OR = [{ workspaceId: tenantId }, { workspaceId: null }];
    } else {
      where.workspaceId = tenantId;
    }
  }

  if (searchParams.type) where.type = searchParams.type as ConnectorType;
  if (searchParams.provider) where.provider = searchParams.provider as ConnectorProvider;
  if (searchParams.isEnabled !== undefined) where.isEnabled = searchParams.isEnabled;

  const skip = (searchParams.page - 1) * searchParams.limit;

  const [connectors, total] = await Promise.all([
    prisma.connector.findMany({
      where,
      orderBy: [{ workspaceId: 'asc' }, { type: 'asc' }, { name: 'asc' }],
      skip,
      take: searchParams.limit,
    }),
    prisma.connector.count({ where }),
  ]);

  // Map to masked credentials
  const connectorsWithMasked: ConnectorWithMaskedCredentials[] = connectors.map((connector) => {
    const { credentials, credentialsMasked } = getMaskedCredentialsForConnector(connector);

    return {
      ...connector,
      credentials,
      credentialsMasked,
    };
  });

  return {
    connectors: connectorsWithMasked,
    total,
    page: searchParams.page,
    limit: searchParams.limit,
  };
}

// ============================================================================
// Connector Resolution (Workspace -> System fallback)
// ============================================================================

/**
 * Resolve the best available connector for a given type/provider
 *
 * Resolution logic:
 * 1. Check workspace connector -> use if exists & enabled
 * 2. Check WorkspaceConnectorAccess for system connector â†’ blocked if isEnabled=false
 * 3. Check system connector â†’ use if exists & enabled
 * 4. No connector â†’ return null
 */
export async function resolveConnector(
  tenantId: string | null,
  type: ConnectorType,
  provider?: ConnectorProvider
): Promise<ResolvedConnector | null> {
  // Step 1: Try workspace connector
  if (tenantId) {
    const workspaceConnector = await prisma.connector.findFirst({
      where: {
        workspaceId: tenantId,
        type,
        isEnabled: true,
        deletedAt: null,
        ...(provider ? { provider } : { isDefault: true }),
      },
      orderBy: { isDefault: 'desc' },
    });

    if (workspaceConnector) {
      return {
        connector: {
          ...workspaceConnector,
          credentials: JSON.parse(decrypt(workspaceConnector.credentials)),
        },
        source: 'workspace',
      };
    }
  }

  // Step 2: Check for system connector
  const systemConnector = await prisma.connector.findFirst({
    where: {
      workspaceId: null,
      type,
      isEnabled: true,
      deletedAt: null,
      ...(provider ? { provider } : { isDefault: true }),
    },
    orderBy: { isDefault: 'desc' },
  });

  if (!systemConnector) {
    return null;
  }

  // Step 3: Check WorkspaceConnectorAccess if workspace is specified
  if (tenantId) {
    const access = await prisma.workspaceConnectorAccess.findUnique({
      where: {
        workspaceId_connectorId: {
          workspaceId: tenantId,
          connectorId: systemConnector.id,
        },
      },
    });

    // If access record exists and is disabled, block
    if (access && !access.isEnabled) {
      return null;
    }
  }

  return {
    connector: {
      ...systemConnector,
      credentials: JSON.parse(decrypt(systemConnector.credentials)),
    },
    source: 'system',
  };
}

/**
 * Get all available connectors for a workspace (resolved)
 * Checks each provider type individually to find all available connectors
 */
export async function getAvailableConnectors(
  tenantId: string | null,
  type?: ConnectorType
): Promise<ResolvedConnector[]> {
  const results: ResolvedConnector[] = [];
  const types: ConnectorType[] = type ? [type] : ['AI_PROVIDER', 'STORAGE'];

  // Define all providers per type
  const providersPerType: Record<ConnectorType, ConnectorProvider[]> = {
    AI_PROVIDER: ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'OPENROUTER', 'MISTRAL'],
    STORAGE: ['ONEDRIVE', 'SHAREPOINT'],
  };

  // Check each provider individually
  for (const t of types) {
    const providers = providersPerType[t];
    for (const provider of providers) {
      try {
        const resolved = await resolveConnector(tenantId, t, provider);
        if (resolved) {
          results.push(resolved);
        }
      } catch (error) {
        console.error(`Unable to resolve ${provider} connector:`, error);
      }
    }
  }

  return results;
}

// ============================================================================
// Connection Testing
// ============================================================================

export async function testConnector(
  id: string,
  params: TenantAwareParams
): Promise<TestResult> {
  const { tenantId, isSuperAdmin } = params;
  const connectorRecord = await prisma.connector.findFirst({
    where: { id, deletedAt: null },
  });

  if (!connectorRecord) {
    throw new Error('Connector not found');
  }

  if (connectorRecord.workspaceId === null && !isSuperAdmin) {
    throw new Error('Access denied to system connector credentials');
  }
  if (connectorRecord.workspaceId !== null && connectorRecord.workspaceId !== tenantId && !isSuperAdmin) {
    throw new Error('Access denied');
  }

  let connector: ConnectorWithDecryptedCredentials | null = null;
  if (!connector) {
    connector = {
      ...connectorRecord,
      credentials: {},
    };
  }

  const startTime = Date.now();
  let success = false;
  let error: string | undefined;

  try {
    connector.credentials = JSON.parse(decrypt(connectorRecord.credentials));

    switch (connector.provider) {
      case 'OPENAI':
        await testOpenAI(connector.credentials as { apiKey: string });
        break;
      case 'ANTHROPIC':
        await testAnthropic(connector.credentials as { apiKey: string });
        break;
      case 'GOOGLE':
        await testGoogle(connector.credentials as { apiKey: string });
        break;
      case 'OPENROUTER':
        await testOpenRouter(connector.credentials as { apiKey: string });
        break;
      case 'MISTRAL':
        await testMistral(connector.credentials as { apiKey: string });
        break;
      case 'ONEDRIVE':
        await testOneDrive(
          connector.credentials as { clientId: string; clientSecret: string; tenantId: string }
        );
        break;
      case 'SHAREPOINT':
        await testSharePoint(
          connector.credentials as {
            clientId: string;
            clientSecret: string;
            tenantId: string;
            siteId: string;
            driveId?: string;
          }
        );
        break;
      default:
        throw new Error(`Unknown provider: ${connector.provider}`);
    }
    success = true;
  } catch (e) {
    error = formatTestError(e);
  }

  const latencyMs = Date.now() - startTime;

  // Update connector test results
  await prisma.connector.update({
    where: { id },
    data: {
      lastTestedAt: new Date(),
      lastTestResult: success ? 'success' : `error:${error}`,
    },
  });

  await createAuditLog({
    tenantId: connector.workspaceId ?? undefined,
    userId: params.userId,
    action: 'CONNECTOR_TESTED',
    entityType: 'Connector',
    entityId: id,
    entityName: connector.name,
    summary: `Tested connector "${connector.name}" - ${success ? 'Success' : 'Failed'}`,
    changeSource: 'MANUAL',
    metadata: { success, error, latencyMs },
  });

  return { success, error, latencyMs };
}

// Provider-specific test functions
async function testOpenAI(credentials: { apiKey: string }): Promise<void> {
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: credentials.apiKey });
  await client.models.list();
}

async function testAnthropic(credentials: { apiKey: string }): Promise<void> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: credentials.apiKey });
  // Just verify the API key by making a minimal request
  await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 10,
    messages: [{ role: 'user', content: 'Hi' }],
  });
}

async function testGoogle(credentials: { apiKey: string }): Promise<void> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const client = new GoogleGenerativeAI(credentials.apiKey);
  const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });
  await model.generateContent('Hi');
}

async function testOpenRouter(credentials: { apiKey: string }): Promise<void> {
  const apiKey = credentials.apiKey.trim();
  if (!apiKey.startsWith('sk-or-')) {
    throw new Error('OpenRouter API key must start with sk-or-');
  }

  // /models is a public catalog endpoint and can succeed without valid
  // credentials. /key requires bearer authentication and is a reliable
  // connection test without spending inference credits.
  const response = await fetch('https://openrouter.ai/api/v1/key', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => null)) as
      | { error?: { message?: string } | string; message?: string }
      | null;
    const errorMessage =
      (typeof errorData?.error === 'string' ? errorData.error : errorData?.error?.message) ||
      errorData?.message ||
      'Failed to validate OpenRouter API credentials';
    throw new Error(errorMessage);
  }
}

async function testMistral(credentials: { apiKey: string }): Promise<void> {
  // First verify the API key with a lightweight models request.
  const modelsResponse = await fetch('https://api.mistral.ai/v1/models', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!modelsResponse.ok) {
    const errorData = await modelsResponse.json().catch(() => null) as
      | {
          message?: string;
          error?: string | { message?: string };
          detail?: string;
        }
      | null;

    const errorMessage =
      errorData?.message ||
      (typeof errorData?.error === 'string' ? errorData.error : errorData?.error?.message) ||
      errorData?.detail ||
      'Failed to validate Mistral API credentials';

    throw new Error(errorMessage);
  }

  const response = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model: 'mistral-ocr-latest',
      document: {
        type: 'image_url',
        image_url:
          'https://raw.githubusercontent.com/mistralai/cookbook/refs/heads/main/mistral/ocr/receipt.png',
      },
      document_annotation_format: {
        type: 'json_schema',
        json_schema: {
          name: 'connector_test',
          schema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
              },
            },
            required: ['status'],
            additionalProperties: false,
          },
        },
      },
      document_annotation_prompt:
        'Return a JSON object with a single string field named "status".',
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null) as
      | {
          message?: string;
          error?: string | { message?: string };
          detail?: string;
        }
      | null;

    const errorMessage =
      errorData?.message ||
      (typeof errorData?.error === 'string' ? errorData.error : errorData?.error?.message) ||
      errorData?.detail ||
      'Failed to validate Mistral OCR credentials';

    throw new Error(errorMessage);
  }

  await response.json();
}

async function testOneDrive(credentials: {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}): Promise<void> {
  // Test OAuth token acquisition using client credentials flow
  const tokenUrl = `https://login.microsoftonline.com/${credentials.tenantId}/oauth2/v2.0/token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error_description || errorData.error || 'Failed to acquire access token'
    );
  }
}

async function testSharePoint(credentials: {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  siteId: string;
  driveId?: string;
}): Promise<void> {
  // Step 1: Acquire OAuth token using client credentials flow
  const tokenUrl = `https://login.microsoftonline.com/${credentials.tenantId}/oauth2/v2.0/token`;
  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });

  if (!tokenResponse.ok) {
    const errorData = await tokenResponse.json().catch(() => ({}));
    throw new Error(
      errorData.error_description || errorData.error || 'Failed to acquire access token'
    );
  }

  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token;

  // Step 2: Verify SharePoint site access
  const siteUrl = `https://graph.microsoft.com/v1.0/sites/${credentials.siteId}`;
  const siteResponse = await fetch(siteUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!siteResponse.ok) {
    const errorData = await siteResponse.json().catch(() => ({}));
    throw new Error(errorData.error?.message || 'Failed to access SharePoint site');
  }

  // Step 3: Verify drive access (optional driveId or default)
  const driveUrl = credentials.driveId
    ? `https://graph.microsoft.com/v1.0/sites/${credentials.siteId}/drives/${credentials.driveId}`
    : `https://graph.microsoft.com/v1.0/sites/${credentials.siteId}/drive`;

  const driveResponse = await fetch(driveUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!driveResponse.ok) {
    const errorData = await driveResponse.json().catch(() => ({}));
    throw new Error(errorData.error?.message || 'Failed to access document library');
  }
}

// ============================================================================
// Usage Tracking
// ============================================================================

export async function incrementConnectorUsage(id: string): Promise<void> {
  await prisma.connector.update({
    where: { id },
    data: {
      callCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
}

// ============================================================================
// Workspace Access Management (for system connectors)
// ============================================================================

/**
 * Get workspace access list for a system connector
 */
export async function getWorkspaceAccess(
  connectorId: string,
  params: TenantAwareParams
): Promise<WorkspaceAccessEntry[]> {
  if (!params.isSuperAdmin) {
    throw new Error('Only super admins can view workspace access');
  }

  const connector = await prisma.connector.findFirst({
    where: { id: connectorId, deletedAt: null },
  });

  if (!connector) {
    throw new Error('Connector not found');
  }

  if (connector.workspaceId !== null) {
    throw new Error('Workspace access only applies to system connectors');
  }

  // Get all workspaces with their access status
  const workspaces = await prisma.workspace.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    orderBy: { name: 'asc' },
  });

  const accessRecords = await prisma.workspaceConnectorAccess.findMany({
    where: { connectorId },
  });

  const accessMap = new Map(accessRecords.map((a) => [a.workspaceId, a.isEnabled]));

  return workspaces.map((workspace) => ({
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    // Default to enabled if no record exists
    isEnabled: accessMap.get(workspace.id) ?? true,
  }));
}

/**
 * Update workspace access for a system connector
 */
export async function updateWorkspaceAccess(
  connectorId: string,
  data: UpdateWorkspaceAccessInput,
  params: TenantAwareParams
): Promise<void> {
  if (!params.isSuperAdmin) {
    throw new Error('Only super admins can update workspace access');
  }

  const connector = await prisma.connector.findFirst({
    where: { id: connectorId, deletedAt: null },
  });

  if (!connector) {
    throw new Error('Connector not found');
  }

  if (connector.workspaceId !== null) {
    throw new Error('Workspace access only applies to system connectors');
  }

  // Upsert access records
  for (const access of data.workspaceAccess) {
    await prisma.workspaceConnectorAccess.upsert({
      where: {
        workspaceId_connectorId: {
          workspaceId: access.workspaceId,
          connectorId,
        },
      },
      create: {
        workspaceId: access.workspaceId,
        connectorId,
        isEnabled: access.isEnabled,
      },
      update: {
        isEnabled: access.isEnabled,
      },
    });

    // Log the change
    const workspace = await prisma.workspace.findUnique({ where: { id: access.workspaceId } });
    await createAuditLog({
      tenantId: access.workspaceId,
      userId: params.userId,
      action: access.isEnabled ? 'CONNECTOR_ENABLED' : 'CONNECTOR_DISABLED',
      entityType: 'Connector',
      entityId: connectorId,
      entityName: connector.name,
      summary: `${access.isEnabled ? 'Enabled' : 'Disabled'} system connector "${connector.name}" for workspace "${workspace?.name}"`,
      changeSource: 'MANUAL',
      metadata: {
        isSystemConnector: true,
        workspaceId: access.workspaceId,
        workspaceName: workspace?.name,
      },
    });
  }
}
