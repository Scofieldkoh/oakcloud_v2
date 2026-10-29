import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import { createAuditLog, createAuditLogBatch } from '@/lib/audit';
import {
  resolveConnector,
  incrementConnectorUsage,
  updateConnector,
} from '@/services/connector.service';
import { createContactDetail } from '@/services/contact-detail.service';

const log = createLogger('outlook-email-ingestion');

interface MicrosoftGraphCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

interface GraphEmailAddress {
  address?: string | null;
  name?: string | null;
}

interface GraphParticipant {
  emailAddress?: GraphEmailAddress | null;
}

interface GraphMessageBody {
  contentType?: string | null;
  content?: string | null;
}

interface GraphMessage {
  id?: string;
  conversationId?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  body?: GraphMessageBody | null;
  receivedDateTime?: string | null;
  from?: GraphParticipant | null;
  toRecipients?: GraphParticipant[] | null;
  ccRecipients?: GraphParticipant[] | null;
}

interface GraphMessageResponse {
  value?: GraphMessage[];
  '@odata.nextLink'?: string;
}

interface GraphErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number;
}

interface CompanyDomainState {
  companyName: string;
  domains: Set<string>;
  existingEmails: Set<string>;
  nextDisplayOrder: number;
}

interface CandidateCommunication {
  companyId: string;
  externalMessageId: string;
  threadId: string | null;
  subject: string | null;
  body: string;
  sentAt: Date | null;
  toEmails: string[];
}

const UNMATCHED_COMMUNICATIONS_UEN = '__SYSTEM_UNMATCHED_COMMUNICATIONS__';
const UNMATCHED_COMMUNICATIONS_NAME = '[System] Unmatched Communications';

export interface OutlookConnectorStatus {
  configured: boolean;
  reason?: 'missing_connector' | 'missing_mailboxes';
  message?: string;
  provider?: 'ONEDRIVE' | 'SHAREPOINT';
  source?: 'workspace' | 'tenant' | 'system';
  connectorId?: string;
  mailboxUserIds: string[];
  ingestAllEmails: boolean;
}

export interface TenantCommunicationListItem {
  id: string;
  companyId: string;
  companyName: string;
  isUnmatched: boolean;
  subject: string | null;
  preview: string;
  body: string;
  fromEmail: string | null;
  toEmails: string[];
  mailboxUserId: string | null;
  receivedAt: string;
}

export interface IngestTenantOutlookCommunicationsInput {
  tenantId: string;
  userId: string;
  lookbackDays?: number;
  maxMessagesPerMailbox?: number;
}

export interface IngestTenantOutlookCommunicationsResult {
  connectorProvider: 'ONEDRIVE' | 'SHAREPOINT';
  connectorSource: 'workspace' | 'tenant' | 'system';
  mailboxUserIds: string[];
  lookbackDays: number;
  scannedMessages: number;
  matchedCompanies: number;
  storedCommunications: number;
  skippedExistingCommunications: number;
  importedCompanyEmails: number;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const tokenCache = new Map<string, TokenCacheEntry>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value);
}

function extractDomain(email: string): string | null {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) return null;
  const parts = normalized.split('@');
  const domain = parts[1]?.trim();
  return domain || null;
}

function normalizeMessageBody(message: GraphMessage): string {
  const bodyContent =
    typeof message.body?.content === 'string'
      ? message.body.content.trim()
      : '';
  if (bodyContent) {
    return bodyContent.replace(/\r\n/g, '\n');
  }
  return (message.bodyPreview?.trim() || '').replace(/\r\n/g, '\n');
}

function buildCommunicationPreview(body: string, maxLength: number = 220): string {
  if (body.length <= maxLength) {
    return body;
  }
  return `${body.slice(0, maxLength - 3)}...`;
}

function getGraphCredentials(credentials: Record<string, unknown>): MicrosoftGraphCredentials {
  const clientId = typeof credentials.clientId === 'string' ? credentials.clientId.trim() : '';
  const clientSecret =
    typeof credentials.clientSecret === 'string' ? credentials.clientSecret.trim() : '';
  const tenantId = typeof credentials.tenantId === 'string' ? credentials.tenantId.trim() : '';

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('Microsoft connector credentials are incomplete');
  }

  return { clientId, clientSecret, tenantId };
}

function getMailboxUserIds(settings: unknown): string[] {
  if (!settings || typeof settings !== 'object') {
    return [];
  }

  const raw = settings as Record<string, unknown>;
  const values: string[] = [];

  if (typeof raw.mailboxUserId === 'string' && raw.mailboxUserId.trim()) {
    values.push(raw.mailboxUserId.trim());
  }

  if (Array.isArray(raw.mailboxUserIds)) {
    for (const value of raw.mailboxUserIds) {
      if (typeof value === 'string' && value.trim()) {
        values.push(value.trim());
      }
    }
  }

  return [...new Set(values)];
}

function getIngestAllEmails(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') {
    return false;
  }

  return (settings as Record<string, unknown>).ingestAllEmails === true;
}

function isUnmatchedCommunicationsCompanyUen(uen: string | null | undefined): boolean {
  return typeof uen === 'string' && uen === UNMATCHED_COMMUNICATIONS_UEN;
}

async function ensureUnmatchedCommunicationsCompany(tenantId: string): Promise<string> {
  const existing = await prisma.company.findFirst({
    where: {
      tenantId,
      uen: UNMATCHED_COMMUNICATIONS_UEN,
    },
    select: {
      id: true,
      deletedAt: true,
    },
  });

  if (existing) {
    if (existing.deletedAt) {
      await prisma.company.update({
        where: { id: existing.id },
        data: {
          deletedAt: null,
          deletedReason: null,
          name: UNMATCHED_COMMUNICATIONS_NAME,
        },
      });
    }

    return existing.id;
  }

  const company = await prisma.company.create({
    data: {
      tenantId,
      uen: UNMATCHED_COMMUNICATIONS_UEN,
      name: UNMATCHED_COMMUNICATIONS_NAME,
      entityType: 'OTHER',
    },
    select: {
      id: true,
    },
  });

  return company.id;
}

function collectMessageEmails(message: GraphMessage): {
  fromEmail: string | null;
  emails: string[];
} {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const pushEmail = (raw: string | null | undefined) => {
    if (!raw || typeof raw !== 'string') return;
    const email = normalizeEmail(raw);
    if (!isValidEmail(email)) return;
    if (seen.has(email)) return;
    seen.add(email);
    ordered.push(email);
  };

  const fromEmailRaw = message.from?.emailAddress?.address;
  pushEmail(fromEmailRaw);

  for (const participant of message.toRecipients ?? []) {
    pushEmail(participant?.emailAddress?.address);
  }
  for (const participant of message.ccRecipients ?? []) {
    pushEmail(participant?.emailAddress?.address);
  }

  return {
    fromEmail: ordered[0] ?? null,
    emails: ordered,
  };
}

function buildExternalMessageId(mailboxUserId: string, messageId: string): string {
  return `outlook|${encodeURIComponent(mailboxUserId)}|${encodeURIComponent(messageId)}`;
}

function parseMailboxFromExternalMessageId(externalMessageId: string | null): string | null {
  if (!externalMessageId) return null;
  const [prefix, mailboxEncoded] = externalMessageId.split('|');
  if (prefix !== 'outlook' || !mailboxEncoded) return null;
  try {
    return decodeURIComponent(mailboxEncoded);
  } catch {
    return null;
  }
}

function buildOutlookFetchErrorMessage(
  mailboxUserId: string,
  status: number,
  errorData: GraphErrorPayload
): string {
  const code = errorData.error?.code?.trim() || '';
  const rawMessage = errorData.error?.message?.trim() || '';
  const lowerCode = code.toLowerCase();
  const lowerMessage = rawMessage.toLowerCase();

  const isAccessDenied =
    status === 401 ||
    status === 403 ||
    lowerCode.includes('accessdenied') ||
    lowerCode.includes('authorization_requestdenied') ||
    lowerMessage.includes('access is denied') ||
    lowerMessage.includes('insufficient privileges');

  if (isAccessDenied) {
    return [
      `Mailbox access denied for "${mailboxUserId}".`,
      'Ensure Microsoft Graph has Mail.Read (Application) with admin consent, and that this mailbox allows app access (Exchange app access policy if configured).',
      rawMessage ? `Graph: ${rawMessage}` : `Graph code: ${code || `HTTP ${status}`}`,
    ].join(' ');
  }

  if (
    status === 404 ||
    lowerCode.includes('resourcenotfound') ||
    lowerMessage.includes('resource could not be discovered')
  ) {
    return [
      `Mailbox "${mailboxUserId}" was not found or is not accessible by this app.`,
      'Verify the mailbox email/user ID is correct and exists in the same Microsoft tenant.',
      rawMessage ? `Graph: ${rawMessage}` : `Graph code: ${code || `HTTP ${status}`}`,
    ].join(' ');
  }

  return [
    `Failed to fetch Outlook messages for mailbox "${mailboxUserId}".`,
    rawMessage || code || `HTTP ${status}`,
  ].join(' ');
}

async function getGraphAccessToken(credentials: MicrosoftGraphCredentials): Promise<string> {
  const cacheKey = `${credentials.tenantId}:${credentials.clientId}`;
  const cached = tokenCache.get(cacheKey);

  // Reuse valid token with safety buffer.
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cached.accessToken;
  }

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
    const errorData = await response.json().catch(() => ({})) as {
      error?: string;
      error_description?: string;
    };
    throw new Error(
      errorData.error_description || errorData.error || 'Failed to acquire Microsoft access token'
    );
  }

  const payload = await response.json() as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new Error('Microsoft token response is missing access token');
  }

  tokenCache.set(cacheKey, {
    accessToken: payload.access_token,
    expiresAt: Date.now() + ((payload.expires_in ?? 3600) - 60) * 1000,
  });

  return payload.access_token;
}

async function fetchOutlookMessages(
  credentials: MicrosoftGraphCredentials,
  mailboxUserId: string,
  lookbackDays: number,
  maxMessages: number
): Promise<GraphMessage[]> {
  const accessToken = await getGraphAccessToken(credentials);
  const take = clamp(maxMessages, 1, 500);
  const pageSize = Math.min(take, 100);
  const lookbackDate = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const params = new URLSearchParams({
    '$select': 'id,conversationId,subject,bodyPreview,body,receivedDateTime,from,toRecipients,ccRecipients',
    '$orderby': 'receivedDateTime DESC',
    '$top': String(pageSize),
    '$filter': `receivedDateTime ge ${lookbackDate}`,
  });

  let nextUrl: string | null = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxUserId)}/messages?${params.toString()}`;
  const messages: GraphMessage[] = [];

  while (nextUrl && messages.length < take) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.body-content-type="text"',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as GraphErrorPayload;
      throw new Error(
        buildOutlookFetchErrorMessage(mailboxUserId, response.status, errorData)
      );
    }

    const payload = await response.json() as GraphMessageResponse;
    const pageMessages = payload.value ?? [];
    for (const message of pageMessages) {
      messages.push(message);
      if (messages.length >= take) break;
    }

    nextUrl = payload['@odata.nextLink'] ?? null;
  }

  return messages;
}

async function resolveOutlookConnector(tenantId: string) {
  return (
    (await resolveConnector(tenantId, 'STORAGE', 'ONEDRIVE')) ??
    (await resolveConnector(tenantId, 'STORAGE', 'SHAREPOINT'))
  );
}

export async function updateOutlookConnectorMailboxSettings(input: {
  tenantId: string;
  userId: string;
  isSuperAdmin: boolean;
  mailboxUserIds?: string[];
  ingestAllEmails?: boolean;
}): Promise<OutlookConnectorStatus> {
  const resolved = await resolveOutlookConnector(input.tenantId);
  if (!resolved) {
    throw new Error('No Microsoft connector found. Configure OneDrive or SharePoint first.');
  }

  if (resolved.source === 'system' && !input.isSuperAdmin) {
    throw new Error(
      'Only super admins can update mailbox settings for a system connector.'
    );
  }

  const existingSettings =
    resolved.connector.settings && typeof resolved.connector.settings === 'object'
      ? (resolved.connector.settings as Record<string, unknown>)
      : {};

  const nextSettings: Record<string, unknown> = {
    ...existingSettings,
  };

  if (input.mailboxUserIds !== undefined) {
    const normalizedMailboxUserIds = [...new Set(
      input.mailboxUserIds
        .map((mailbox) => mailbox.trim().toLowerCase())
        .filter(Boolean)
    )];
    nextSettings.mailboxUserIds = normalizedMailboxUserIds;
    delete nextSettings.mailboxUserId;
  }

  if (input.ingestAllEmails !== undefined) {
    nextSettings.ingestAllEmails = input.ingestAllEmails;
  }

  await updateConnector(
    resolved.connector.id,
    { settings: nextSettings },
    {
      tenantId: input.tenantId,
      userId: input.userId,
      isSuperAdmin: input.isSuperAdmin,
    }
  );

  return getOutlookConnectorStatus(input.tenantId);
}

async function buildCompanyDomainState(
  tenantId: string
): Promise<{
  companyStateById: Map<string, CompanyDomainState>;
  domainToCompanyIds: Map<string, Set<string>>;
}> {
  const companyDetails = await prisma.contactDetail.findMany({
    where: {
      tenantId,
      contactId: null,
      detailType: 'EMAIL',
      deletedAt: null,
      company: {
        deletedAt: null,
      },
    },
    select: {
      companyId: true,
      value: true,
      company: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [{ companyId: 'asc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
  });

  const companyStateById = new Map<string, CompanyDomainState>();
  const domainToCompanyIds = new Map<string, Set<string>>();

  for (const detail of companyDetails) {
    const companyId = detail.companyId;
    if (!companyId) continue;

    const existing = companyStateById.get(companyId);
    const state =
      existing ??
      {
        companyName: detail.company?.name ?? 'Unknown Company',
        domains: new Set<string>(),
        existingEmails: new Set<string>(),
        nextDisplayOrder: 0,
      };

    const normalizedEmail = normalizeEmail(detail.value);
    if (isValidEmail(normalizedEmail)) {
      state.existingEmails.add(normalizedEmail);
      const domain = extractDomain(normalizedEmail);
      if (domain) {
        state.domains.add(domain);
        if (!domainToCompanyIds.has(domain)) {
          domainToCompanyIds.set(domain, new Set<string>());
        }
        domainToCompanyIds.get(domain)!.add(companyId);
      }
    }

    state.nextDisplayOrder += 1;
    companyStateById.set(companyId, state);
  }

  return { companyStateById, domainToCompanyIds };
}

export async function getOutlookConnectorStatus(tenantId: string): Promise<OutlookConnectorStatus> {
  const resolved = await resolveOutlookConnector(tenantId);
  if (!resolved) {
    return {
      configured: false,
      reason: 'missing_connector',
      message: 'No Microsoft connector found. Configure OneDrive or SharePoint first.',
      mailboxUserIds: [],
      ingestAllEmails: false,
    };
  }

  const mailboxUserIds = getMailboxUserIds(resolved.connector.settings);
  const ingestAllEmails = getIngestAllEmails(resolved.connector.settings);
  if (mailboxUserIds.length === 0) {
    return {
      configured: false,
      reason: 'missing_mailboxes',
      message:
        'Mailbox list is not configured. Add settings.mailboxUserIds on the connector.',
      provider: resolved.connector.provider as 'ONEDRIVE' | 'SHAREPOINT',
      source: resolved.source,
      connectorId: resolved.connector.id,
      mailboxUserIds: [],
      ingestAllEmails,
    };
  }

  return {
    configured: true,
    provider: resolved.connector.provider as 'ONEDRIVE' | 'SHAREPOINT',
    source: resolved.source,
    connectorId: resolved.connector.id,
    mailboxUserIds,
    ingestAllEmails,
  };
}

export async function listLatestTenantCommunications(
  tenantId: string,
  limit: number = 100
): Promise<TenantCommunicationListItem[]> {
  const take = clamp(limit, 1, 500);

  const rows = await prisma.communication.findMany({
    where: {
      tenantId,
      direction: 'INBOUND',
      channel: 'EMAIL_CHANNEL',
      externalMessageId: {
        startsWith: 'outlook|',
      },
    },
    orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
    take,
  });

  const companyIds = [...new Set(rows.map((row) => row.companyId))];
  const companies = companyIds.length
    ? await prisma.company.findMany({
        where: {
          id: { in: companyIds },
          tenantId,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          uen: true,
        },
      })
    : [];
  const companyNameMap = new Map(companies.map((company) => [company.id, company.name]));
  const unmatchedCompanyIds = new Set(
    companies
      .filter((company) => isUnmatchedCommunicationsCompanyUen(company.uen))
      .map((company) => company.id)
  );

  return rows.map((row) => {
    const body = row.body || '';
    return {
      id: row.id,
      companyId: row.companyId,
      companyName: companyNameMap.get(row.companyId) ?? 'Unknown Company',
      isUnmatched: unmatchedCompanyIds.has(row.companyId),
      subject: row.subject,
      preview: buildCommunicationPreview(body),
      body,
      fromEmail: row.toEmails[0] ?? null,
      toEmails: row.toEmails,
      mailboxUserId: parseMailboxFromExternalMessageId(row.externalMessageId),
      receivedAt: (row.sentAt ?? row.createdAt).toISOString(),
    };
  });
}

export async function deleteWorkspaceCommunication(input: {
  tenantId: string;
  userId: string;
  communicationId: string;
}): Promise<void> {
  const existing = await prisma.communication.findFirst({
    where: {
      id: input.communicationId,
      tenantId: input.tenantId,
      direction: 'INBOUND',
      channel: 'EMAIL_CHANNEL',
      externalMessageId: {
        startsWith: 'outlook|',
      },
    },
    select: {
      id: true,
      companyId: true,
      subject: true,
      externalMessageId: true,
    },
  });

  if (!existing) {
    throw new Error('Communication not found');
  }

  await prisma.communication.delete({
    where: { id: existing.id },
  });

  await createAuditLog({
    tenantId: input.tenantId,
    userId: input.userId,
    companyId: existing.companyId,
    action: 'DELETE',
    entityType: 'Communication',
    entityId: existing.id,
    entityName: existing.subject || existing.externalMessageId || existing.id,
    summary: `Deleted ingested communication "${existing.subject || '(No subject)'}"`,
    changeSource: 'MANUAL',
    metadata: {
      externalMessageId: existing.externalMessageId,
      source: 'outlook',
    },
  });
}

export async function deleteWorkspaceCommunicationsBulk(input: {
  tenantId: string;
  userId: string;
  communicationIds: string[];
}): Promise<{ deleted: number; skipped: number }> {
  const communicationIds = [...new Set(
    input.communicationIds
      .map((id) => id.trim())
      .filter(Boolean)
  )];

  if (communicationIds.length === 0) {
    throw new Error('No communications selected');
  }

  const existing = await prisma.communication.findMany({
    where: {
      id: { in: communicationIds },
      tenantId: input.tenantId,
      direction: 'INBOUND',
      channel: 'EMAIL_CHANNEL',
      externalMessageId: {
        startsWith: 'outlook|',
      },
    },
    select: {
      id: true,
      companyId: true,
      subject: true,
      externalMessageId: true,
    },
  });

  if (existing.length === 0) {
    throw new Error('No matching communications found');
  }

  const existingIds = existing.map((row) => row.id);
  await prisma.$transaction(async (tx) => {
    await tx.communication.deleteMany({
      where: {
        id: { in: existingIds },
      },
    });

    await createAuditLogBatch(
      existing.map((row) => ({
        tenantId: input.tenantId,
        userId: input.userId,
        companyId: row.companyId,
        action: 'DELETE' as const,
        entityType: 'Communication',
        entityId: row.id,
        entityName: row.subject || row.externalMessageId || row.id,
        summary: `Deleted ingested communication "${row.subject || '(No subject)'}"`,
        changeSource: 'MANUAL' as const,
        metadata: {
          externalMessageId: row.externalMessageId,
          source: 'outlook',
          bulk: true,
        },
      })),
      tx
    );
  });

  return {
    deleted: existing.length,
    skipped: communicationIds.length - existing.length,
  };
}

export async function ingestTenantOutlookCommunications(
  input: IngestTenantOutlookCommunicationsInput
): Promise<IngestTenantOutlookCommunicationsResult> {
  const lookbackDays = clamp(input.lookbackDays ?? 30, 1, 365);
  const maxMessagesPerMailbox = clamp(input.maxMessagesPerMailbox ?? 200, 1, 500);

  const connectorStatus = await getOutlookConnectorStatus(input.tenantId);
  if (!connectorStatus.configured || !connectorStatus.connectorId) {
    throw new Error(
      connectorStatus.message ??
        'Outlook connector is not configured. Configure connector and mailbox list first.'
    );
  }

  const resolvedConnector = await resolveOutlookConnector(input.tenantId);
  if (!resolvedConnector) {
    throw new Error('No Microsoft connector found. Configure OneDrive or SharePoint first.');
  }

  const credentials = getGraphCredentials(resolvedConnector.connector.credentials);
  const mailboxUserIds = connectorStatus.mailboxUserIds;
  const ingestAllEmails = connectorStatus.ingestAllEmails;

  const { companyStateById, domainToCompanyIds } = await buildCompanyDomainState(input.tenantId);
  if ((companyStateById.size === 0 || domainToCompanyIds.size === 0) && !ingestAllEmails) {
    return {
      connectorProvider: resolvedConnector.connector.provider as 'ONEDRIVE' | 'SHAREPOINT',
      connectorSource: resolvedConnector.source,
      mailboxUserIds,
      lookbackDays,
      scannedMessages: 0,
      matchedCompanies: 0,
      storedCommunications: 0,
      skippedExistingCommunications: 0,
      importedCompanyEmails: 0,
    };
  }

  const candidateMap = new Map<string, CandidateCommunication>();
  const newEmailsByCompany = new Map<string, Set<string>>();
  let scannedMessages = 0;
  let unmatchedCompanyId: string | null = null;

  for (const mailboxUserId of mailboxUserIds) {
    const messages = await fetchOutlookMessages(
      credentials,
      mailboxUserId,
      lookbackDays,
      maxMessagesPerMailbox
    );
    scannedMessages += messages.length;

    for (const message of messages) {
      if (!message.id) continue;

      const { fromEmail, emails } = collectMessageEmails(message);
      if (emails.length === 0) continue;

      const matchedCompanyIds = new Set<string>();
      for (const email of emails) {
        const domain = extractDomain(email);
        if (!domain) continue;
        const companyIds = domainToCompanyIds.get(domain);
        if (!companyIds) continue;
        for (const companyId of companyIds) {
          matchedCompanyIds.add(companyId);
        }
      }

      if (matchedCompanyIds.size === 0) {
        if (!ingestAllEmails) continue;
        unmatchedCompanyId ??= await ensureUnmatchedCommunicationsCompany(input.tenantId);
        matchedCompanyIds.add(unmatchedCompanyId);
      }

      const orderedToEmails = [...emails];
      if (fromEmail && orderedToEmails[0] !== fromEmail) {
        orderedToEmails.unshift(fromEmail);
      }
      const uniqueToEmails = [...new Set(orderedToEmails)];

      const externalMessageId = buildExternalMessageId(mailboxUserId, message.id);
      const sentAt = message.receivedDateTime ? new Date(message.receivedDateTime) : null;
      const subject = message.subject?.trim() ? message.subject.trim() : null;
      const body = normalizeMessageBody(message);

      for (const companyId of matchedCompanyIds) {
        const key = `${companyId}::${externalMessageId}`;
        if (!candidateMap.has(key)) {
          candidateMap.set(key, {
            companyId,
            externalMessageId,
            threadId: message.conversationId ?? null,
            subject,
            body,
            sentAt: sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : null,
            toEmails: uniqueToEmails,
          });
        }

        const companyState = companyStateById.get(companyId);
        if (!companyState) continue;

        const matchingEmailsForCompany = emails.filter((email) => {
          const domain = extractDomain(email);
          return !!domain && companyState.domains.has(domain);
        });

        if (matchingEmailsForCompany.length === 0) continue;
        if (!newEmailsByCompany.has(companyId)) {
          newEmailsByCompany.set(companyId, new Set<string>());
        }

        const pendingSet = newEmailsByCompany.get(companyId)!;
        for (const email of matchingEmailsForCompany) {
          if (!companyState.existingEmails.has(email)) {
            pendingSet.add(email);
            companyState.existingEmails.add(email);
          }
        }
      }
    }
  }

  const candidates = [...candidateMap.values()];
  const companyIds = [...new Set(candidates.map((candidate) => candidate.companyId))];
  const externalMessageIds = [...new Set(candidates.map((candidate) => candidate.externalMessageId))];

  const existingCommunications = companyIds.length
    ? await prisma.communication.findMany({
        where: {
          tenantId: input.tenantId,
          companyId: { in: companyIds },
          externalMessageId: { in: externalMessageIds },
        },
        select: {
          companyId: true,
          externalMessageId: true,
        },
      })
    : [];

  const existingKeys = new Set(
    existingCommunications.map((row) => `${row.companyId}::${row.externalMessageId}`)
  );

  const createRows = candidates
    .filter((candidate) => !existingKeys.has(`${candidate.companyId}::${candidate.externalMessageId}`))
    .map((candidate) => ({
      tenantId: input.tenantId,
      companyId: candidate.companyId,
      direction: 'INBOUND' as const,
      channel: 'EMAIL_CHANNEL' as const,
      subject: candidate.subject,
      body: candidate.body,
      toEmails: candidate.toEmails,
      externalMessageId: candidate.externalMessageId,
      threadId: candidate.threadId,
      sentAt: candidate.sentAt,
    }));

  if (createRows.length > 0) {
    await prisma.communication.createMany({
      data: createRows,
    });
  }

  let importedCompanyEmails = 0;
  for (const [companyId, emailSet] of newEmailsByCompany.entries()) {
    const companyState = companyStateById.get(companyId);
    if (!companyState) continue;

    for (const email of emailSet) {
      await createContactDetail(
        {
          companyId,
          detailType: 'EMAIL',
          value: email,
          displayOrder: companyState.nextDisplayOrder,
        },
        {
          tenantId: input.tenantId,
          userId: input.userId,
        }
      );
      companyState.nextDisplayOrder += 1;
      importedCompanyEmails += 1;
    }
  }

  try {
    await incrementConnectorUsage(connectorStatus.connectorId);
  } catch (error) {
    log.warn('Failed to increment connector usage', error);
  }

  const matchedCompanies = new Set([
    ...companyIds,
    ...newEmailsByCompany.keys(),
  ]).size;

  log.info('Tenant Outlook ingestion completed', {
    tenantId: input.tenantId,
    connectorId: connectorStatus.connectorId,
    lookbackDays,
    mailboxCount: mailboxUserIds.length,
    ingestAllEmails,
    scannedMessages,
    matchedCompanies,
    storedCommunications: createRows.length,
    skippedExistingCommunications: candidates.length - createRows.length,
    importedCompanyEmails,
  });

  return {
    connectorProvider: resolvedConnector.connector.provider as 'ONEDRIVE' | 'SHAREPOINT',
    connectorSource: resolvedConnector.source,
    mailboxUserIds,
    lookbackDays,
    scannedMessages,
    matchedCompanies,
    storedCommunications: createRows.length,
    skippedExistingCommunications: candidates.length - createRows.length,
    importedCompanyEmails,
  };
}
