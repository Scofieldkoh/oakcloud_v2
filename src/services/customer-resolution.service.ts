/**
 * Customer resolution service
 *
 * Goal: make customer names consistent by linking extracted text to a canonical
 * customer Contact (corporate) via fuzzy matching + CustomerAlias learning.
 */

import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import { normalizeCompanyName } from '@/lib/utils';
import { normalizeVendorName } from '@/lib/vendor-name';
import { jaroWinkler } from '@/lib/string-similarity';
import { jaccardSimilarity, tokenizeEntityName } from '@/lib/entity-name';
import { scoreContactIdentityMatch } from '@/lib/contact-identity-matching';
import { resolveOrCreateContact } from '@/services/contact-identity.service';
import type { CounterpartyIdentityDraft } from './document-revision.service';
import type { ContactIdentityCandidate, ContactIdentityRecord } from '@/types/contact-identity';
import type { PrismaTransactionClient } from '@/services/contact.service';

const log = createLogger('customer-resolution');

export type CustomerResolutionStrategy = 'ALIAS' | 'CONTACT' | 'CREATED' | 'NONE';

export interface CustomerResolutionResult {
  customerName?: string;
  customerId?: string;
  confidence: number;
  strategy: CustomerResolutionStrategy;
  matchedTo?: string;
}

export interface ResolveCustomerInput {
  tenantId: string;
  companyId: string;
  rawCustomerName?: string | null;
  createdById?: string;
  counterpartyIdentity?: CounterpartyIdentityDraft;
  sourceRecordId?: string;
  tx?: PrismaTransactionClient;
}

const DEFAULTS = {
  aliasScanLimit: 1500,
  contactScanLimit: 500,
  autoAcceptThreshold: 0.93,
  tokenJaccardThreshold: 0.8,
};

function normalizeForDisplay(name: string): string {
  return normalizeCompanyName(name)?.trim() || name.trim();
}

function scoreNameSimilarity(a: string, b: string): number {
  const normA = normalizeVendorName(a);
  const normB = normalizeVendorName(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  const jw = jaroWinkler(normA, normB);
  const tokenSim = jaccardSimilarity(tokenizeEntityName(a), tokenizeEntityName(b));
  if (tokenSim < DEFAULTS.tokenJaccardThreshold) return 0;

  return jw;
}

function identityCandidate(input: ResolveCustomerInput, name: string): ContactIdentityCandidate {
  const identity = input.counterpartyIdentity;
  const isUen = identity?.identificationType === 'UEN';
  return {
    source: 'DOCUMENT_VAULT', sourceRecordId: input.sourceRecordId, contactType: 'CORPORATE', corporateName: name,
    identificationType: isUen ? undefined : identity?.identificationType,
    identificationNumber: isUen ? undefined : identity?.identificationNumber,
    corporateUen: isUen ? identity?.identificationNumber : undefined,
    fullAddress: identity?.fullAddress,
    contactDetails: [
      identity?.email ? { detailType: 'EMAIL' as const, value: identity.email, companyId: input.companyId, isPrimary: true } : null,
      identity?.phone ? { detailType: 'PHONE' as const, value: identity.phone, companyId: input.companyId, isPrimary: true } : null,
    ].filter((detail): detail is NonNullable<typeof detail> => detail !== null),
    confidence: {
      ...(isUen ? { corporateUen: identity?.confidence.identificationNumber } : { identificationNumber: identity?.confidence.identificationNumber }),
      fullAddress: identity?.confidence.fullAddress, email: identity?.confidence.email, phone: identity?.confidence.phone,
    },
  };
}

function contactIdentityRecord(contact: Record<string, unknown>, tenantId: string): ContactIdentityRecord {
  const count = contact._count as Record<string, number> | undefined;
  return {
    id: String(contact.id), tenantId, source: 'MANUAL', contactType: 'CORPORATE',
    corporateName: String(contact.corporateName ?? contact.fullName ?? ''), alias: contact.alias as string | null | undefined,
    identificationType: contact.identificationType as ContactIdentityRecord['identificationType'],
    identificationNumber: contact.identificationNumber as string | null | undefined,
    corporateUen: contact.corporateUen as string | null | undefined,
    nationality: contact.nationality as string | null | undefined,
    dateOfBirth: contact.dateOfBirth instanceof Date ? contact.dateOfBirth.toISOString() : null,
    fullAddress: contact.fullAddress as string | null | undefined,
    contactDetails: (contact.contactDetails as ContactIdentityRecord['contactDetails']) ?? [],
    canonicalName: String(contact.canonicalName ?? contact.corporateName ?? contact.fullName ?? ''),
    createdAt: contact.createdAt instanceof Date ? contact.createdAt : new Date(0),
    updatedAt: contact.updatedAt instanceof Date ? contact.updatedAt : new Date(0),
    relationshipCount: (count?.companyRelations ?? 0) + (count?.officerPositions ?? 0) + (count?.shareholdings ?? 0),
    populatedFieldCount: Object.values(contact).filter((value) => value !== null && value !== undefined && value !== '').length,
  };
}

async function upsertCustomerAlias(params: {
  tenantId: string;
  companyId: string;
  rawName: string;
  normalizedContactId: string;
  confidence: number;
  createdById?: string;
  tx?: PrismaTransactionClient;
}): Promise<void> {
  const { tenantId, companyId, rawName, normalizedContactId, confidence, createdById, tx } = params;
  const db = tx ?? prisma;

  const existing = await db.customerAlias.findFirst({
    where: { tenantId, companyId, rawName, deletedAt: null },
    select: { id: true },
  });

  if (existing) {
    await db.customerAlias.update({
      where: { id: existing.id },
      data: {
        normalizedContactId,
        confidence,
        createdById: createdById ?? null,
      },
    });
    return;
  }

  await db.customerAlias.create({
    data: {
      tenantId,
      companyId,
      rawName,
      normalizedContactId,
      confidence,
      createdById: createdById ?? null,
    },
  });
}

export async function learnCustomerAlias(input: {
  tenantId: string;
  companyId: string;
  rawName: string;
  customerId: string;
  confidence?: number;
  createdById?: string;
  tx?: PrismaTransactionClient;
}): Promise<void> {
  const raw = input.rawName?.trim();
  if (!raw) return;

  await upsertCustomerAlias({
    tenantId: input.tenantId,
    companyId: input.companyId,
    rawName: normalizeForDisplay(raw),
    normalizedContactId: input.customerId,
    confidence: Math.max(0, Math.min(1, input.confidence ?? 1.0)),
    createdById: input.createdById,
    tx: input.tx,
  });
}

/**
 * Attempt to resolve a raw customer name to an existing canonical customer Contact.
 * Does not create new Contacts.
 */
export async function resolveCustomer(input: ResolveCustomerInput): Promise<CustomerResolutionResult> {
  const raw = input.rawCustomerName?.trim();
  if (!raw) return { confidence: 0, strategy: 'NONE' };

  const rawDisplay = normalizeForDisplay(raw);
  const db = input.tx ?? prisma;

  const aliases = await db.customerAlias.findMany({
    where: {
      tenantId: input.tenantId,
      deletedAt: null,
      OR: [{ companyId: input.companyId }, { companyId: null }],
    },
    select: { rawName: true, normalizedContactId: true, confidence: true, companyId: true },
    orderBy: { createdAt: 'desc' },
    take: DEFAULTS.aliasScanLimit,
  });

  let bestAlias: {
    normalizedContactId: string;
    rawName: string;
    score: number;
    companyId: string | null;
  } | null = null;
  for (const a of aliases) {
    const score = scoreNameSimilarity(rawDisplay, a.rawName);
    const isCompanyScoped = a.companyId === input.companyId;
    const bestIsCompanyScoped = bestAlias?.companyId === input.companyId;
    if (
      !bestAlias ||
      score > bestAlias.score ||
      (score === bestAlias.score && isCompanyScoped && !bestIsCompanyScoped)
    ) {
      bestAlias = {
        normalizedContactId: a.normalizedContactId,
        rawName: a.rawName,
        score,
        companyId: a.companyId,
      };
    }
  }

  if (bestAlias && bestAlias.score >= DEFAULTS.autoAcceptThreshold) {
    const contact = await db.contact.findUnique({
      where: { id: bestAlias.normalizedContactId },
      select: { id: true, corporateName: true, fullName: true },
    });

    if (contact) {
      return {
        customerId: contact.id,
        customerName: contact.corporateName || contact.fullName,
        confidence: bestAlias.score,
        strategy: 'ALIAS',
        matchedTo: bestAlias.rawName,
      };
    }
  }

  const contacts = await db.contact.findMany({
    where: {
      tenantId: input.tenantId,
      deletedAt: null,
      contactType: 'CORPORATE',
      corporateName: { not: null },
    },
    include: { contactDetails: { where: { deletedAt: null } }, _count: { select: { companyRelations: true, officerPositions: true, shareholdings: true, contactDetails: true } } },
    orderBy: { updatedAt: 'desc' },
    take: DEFAULTS.contactScanLimit,
  });

  let bestContact: { id: string; name: string; score: number } | null = null;
  for (const c of contacts) {
    const name = c.corporateName || c.fullName;
    const match = scoreContactIdentityMatch(identityCandidate(input, rawDisplay), contactIdentityRecord(c as unknown as Record<string, unknown>, input.tenantId));
    const score = match.automatic && !match.blockedByIdentifierConflict ? match.score : 0;
    if (!bestContact || score > bestContact.score) {
      bestContact = { id: c.id, name, score };
    }
  }

  if (bestContact && bestContact.score >= DEFAULTS.autoAcceptThreshold) {
    return {
      customerId: bestContact.id,
      customerName: bestContact.name,
      confidence: bestContact.score,
      strategy: 'CONTACT',
      matchedTo: bestContact.name,
    };
  }

  return { customerName: rawDisplay, confidence: bestContact?.score ?? 0, strategy: 'NONE' };
}

export async function getOrCreateCustomerContact(
  input: ResolveCustomerInput
): Promise<CustomerResolutionResult> {
  const raw = input.rawCustomerName?.trim();
  if (!raw) return { confidence: 0, strategy: 'NONE' };

  const resolved = await resolveCustomer(input);
  const rawDisplay = normalizeForDisplay(raw);

  const identity = identityCandidate(input, rawDisplay);
  const params = { tenantId: input.tenantId, userId: input.createdById ?? 'system', tx: input.tx };
  let resolution;
  try {
    resolution = await resolveOrCreateContact(
      identity,
      resolved.customerId ? { action: 'REUSE', contactId: resolved.customerId } : { action: 'AUTO' },
      params
    );
  } catch (error) {
    if (!resolved.customerId) throw error;
    log.warn(`Saved customer match ${resolved.customerId} conflicted with reviewed identity; resolving automatically`, error);
    resolution = await resolveOrCreateContact(identity, { action: 'AUTO' }, params);
  }
  if (resolution.conflicts.length > 0) {
    log.warn(`Customer identity resolution preserved ${resolution.conflicts.length} existing nonblank field conflict(s)`);
  }
  const created = resolution.contact;

  try {
    await learnCustomerAlias({
      tenantId: input.tenantId,
      companyId: input.companyId,
      rawName: rawDisplay,
      customerId: created.id,
      confidence: resolved.confidence || 1.0,
      createdById: input.createdById,
      tx: input.tx,
    });
  } catch (e) {
    if (input.tx) throw e;
    log.warn(`Failed to create customer alias for "${rawDisplay}"`, e);
  }

  return {
    customerId: created.id,
    customerName: created.corporateName || created.fullName,
    confidence: resolved.confidence || 1.0,
    strategy: resolved.customerId
      ? resolved.strategy
      : resolution.outcome === 'CREATED' || resolution.outcome === 'CREATED_SEPARATE' ? 'CREATED' : 'CONTACT',
    matchedTo: rawDisplay,
  };
}
