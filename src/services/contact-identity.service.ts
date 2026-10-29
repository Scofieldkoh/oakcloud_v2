import { Prisma, type Contact } from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import { scoreContactIdentityMatch } from '@/lib/contact-identity-matching';
import {
  buildContactIdentityFingerprint,
  canonicalizeContactAlias,
  canonicalizeContactName,
  canonicalizeCorporateComparisonName,
  isDeterministicIdentifier,
  normalizeContactDetailValue,
  normalizeContactIdentifier,
} from '@/lib/contact-identity-normalization';
import { prisma } from '@/lib/prisma';
import { createContactDetail, updateContactDetail } from '@/services/contact-detail.service';
import type { PrismaTransactionClient, TenantAwareParams } from '@/services/contact.service';
import { acquireBusinessOperationBarrier } from '@/lib/business-operation-backup-barrier';
import { acquireAuthorizationMutationGate } from '@/lib/authorization-mutation-gate';
import type {
  ContactIdentityCandidate,
  ContactIdentityConflict,
  ContactIdentityDetail,
  ContactIdentityRecord,
  ContactMatchResult,
  ContactResolutionDecision,
} from '@/types/contact-identity';

export interface ResolveContactIdentityResult {
  contact: Contact;
  outcome:
    | 'CREATED'
    | 'RESTORED'
    | 'REUSED_IDENTIFIER'
    | 'REUSED_NAME'
    | 'REUSED_ALIAS'
    | 'CREATED_SEPARATE';
  match: ContactMatchResult | null;
  enrichedFields: string[];
  conflicts: ContactIdentityConflict[];
}

type ContactWithIdentityRelations = Contact & {
  contactDetails?: Array<{
    id?: string;
    detailType: Parameters<typeof normalizeContactDetailValue>[0];
    value: string;
    companyId: string | null;
    purposes?: string[];
    label?: string | null;
    description?: string | null;
    displayOrder?: number;
    isPrimary?: boolean;
    isPoc?: boolean;
  }>;
  _count?: {
    companyRelations: number;
    officerPositions: number;
    shareholdings: number;
    contactDetails: number;
  };
};

function identityName(candidate: ContactIdentityCandidate): string {
  return candidate.contactType === 'CORPORATE'
    ? candidate.corporateName ?? ''
    : `${candidate.firstName ?? ''}${candidate.lastName ?? ''}`;
}

function fullName(candidate: ContactIdentityCandidate): string {
  if (candidate.contactType === 'CORPORATE') return candidate.corporateName?.trim() || 'Unknown Corporate';
  return [candidate.firstName, candidate.lastName].map((part) => part?.trim()).filter(Boolean).join(' ') || 'Unknown';
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function toIdentityRecord(contact: ContactWithIdentityRelations): ContactIdentityRecord {
  const populatedFields = [
    contact.firstName,
    contact.lastName,
    contact.corporateName,
    contact.alias,
    contact.identificationNumber,
    contact.corporateUen,
    contact.nationality,
    contact.dateOfBirth,
    contact.fullAddress,
  ].filter((value) => !isBlank(value)).length + (contact._count?.contactDetails ?? contact.contactDetails?.length ?? 0);

  return {
    id: contact.id,
    tenantId: contact.tenantId,
    source: 'MANUAL',
    contactType: contact.contactType,
    firstName: contact.firstName,
    lastName: contact.lastName,
    corporateName: contact.corporateName,
    alias: contact.alias,
    identificationType: contact.identificationType,
    identificationNumber: contact.identificationNumber,
    corporateUen: contact.corporateUen,
    nationality: contact.nationality,
    dateOfBirth: contact.dateOfBirth?.toISOString() ?? null,
    fullAddress: contact.fullAddress,
    contactDetails: contact.contactDetails?.map((detail) => ({
      detailType: detail.detailType,
      value: detail.value,
      companyId: detail.companyId ?? undefined,
    })),
    canonicalName: contact.canonicalName ?? canonicalizeContactName(contact.fullName),
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
    relationshipCount:
      (contact._count?.companyRelations ?? 0) +
      (contact._count?.officerPositions ?? 0) +
      (contact._count?.shareholdings ?? 0),
    populatedFieldCount: populatedFields,
  };
}

async function findCandidates(
  candidate: ContactIdentityCandidate,
  tenantId: string,
  db: PrismaTransactionClient | typeof prisma,
): Promise<ContactWithIdentityRelations[]> {
  const activeScope = { tenantId, contactType: candidate.contactType, deletedAt: null, isActive: true } as const;
  const unbackfilled = await db.contact.findFirst({
    where: {
      ...activeScope,
      OR: [
        { canonicalName: null },
        { alias: { not: null }, canonicalAlias: null },
      ],
    },
    select: { id: true },
  });
  if (unbackfilled) {
    throw new Error('Canonical identity backfill must complete and be verified before identity traffic can resume');
  }
  const canonicalName = canonicalizeContactName(identityName(candidate));
  const identificationNumber = hasUsableIdentificationNumber(candidate)
    ? candidate.identificationNumber?.trim()
    : null;
  const corporateUen = hasUsableCorporateUen(candidate) ? candidate.corporateUen?.trim() : null;
  const corporateComparison = candidate.contactType === 'CORPORATE'
    ? canonicalizeCorporateComparisonName(candidate.corporateName)
    : null;
  const exactPredicates: Prisma.ContactWhereInput[] = [
    ...(canonicalName ? [{ canonicalName }, { canonicalAlias: canonicalName }] : []),
    ...(canonicalizeContactName(candidate.alias) ? [{ canonicalName: canonicalizeContactName(candidate.alias) }] : []),
    ...(identificationNumber ? [{ identificationType: candidate.identificationType, identificationNumber }] : []),
    ...(corporateUen ? [{ corporateUen }] : []),
  ];
  const exact = await db.contact.findMany({
    where: {
      ...activeScope,
      OR: exactPredicates,
    },
    include: {
      contactDetails: {
        where: { deletedAt: null },
        select: {
          id: true,
          detailType: true,
          value: true,
          companyId: true,
          purposes: true,
          label: true,
          description: true,
          displayOrder: true,
          isPrimary: true,
          isPoc: true,
        },
      },
      _count: {
        select: {
          companyRelations: true,
          officerPositions: true,
          shareholdings: true,
          contactDetails: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 100,
  }) as ContactWithIdentityRelations[];
  const normalizedIdentifiers = await findNormalizedIdentifierCandidates(candidate, tenantId, db);
  const suffixCandidates = corporateComparison
    ? await db.contact.findMany({
      where: { ...activeScope, canonicalName: { startsWith: corporateComparison } },
      include: identityRelationsInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
    }) as ContactWithIdentityRelations[]
    : [];
  return [...new Map([...exact, ...normalizedIdentifiers, ...suffixCandidates].map((contact) => [contact.id, contact])).values()];
}

async function findNormalizedIdentifierCandidates(
  candidate: ContactIdentityCandidate,
  tenantId: string,
  db: PrismaTransactionClient | typeof prisma,
): Promise<ContactWithIdentityRelations[]> {
  if (!('$queryRaw' in db) || typeof db.$queryRaw !== 'function') return [];
  const identificationNumber = hasUsableIdentificationNumber(candidate)
    ? normalizeContactIdentifier(candidate.identificationNumber, candidate.identificationType)
    : null;
  const corporateUen = hasUsableCorporateUen(candidate)
    ? normalizeContactIdentifier(candidate.corporateUen, 'UEN')
    : null;
  if (!identificationNumber && !corporateUen) return [];
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "contacts"
    WHERE "tenantId" = ${tenantId}
      AND "contactType" = ${candidate.contactType}::"ContactType"
      AND "deletedAt" IS NULL AND "isActive" = true
      AND (
        (${identificationNumber}::text IS NOT NULL
          AND "identificationType" = ${candidate.identificationType}::"IdentificationType"
          AND (CASE
            WHEN "identificationType" IN ('NRIC', 'FIN', 'UEN')
              THEN regexp_replace(upper(normalize("identificationNumber", NFKC)), '[[:space:]-]+', '', 'g')
            ELSE regexp_replace(trim(upper(normalize("identificationNumber", NFKC))), '[[:space:]]+', ' ', 'g')
          END) = ${identificationNumber})
        OR (${corporateUen}::text IS NOT NULL
          AND regexp_replace(upper(normalize("corporateUen", NFKC)), '[[:space:]-]+', '', 'g') = ${corporateUen})
      )
    ORDER BY "createdAt" ASC, "id" ASC
    LIMIT 100
  `);
  const ids = rows.map(({ id }) => id);
  if (ids.length === 0) return [];
  return db.contact.findMany({
    where: { id: { in: ids }, tenantId, contactType: candidate.contactType, deletedAt: null, isActive: true },
    include: identityRelationsInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 100,
  }) as Promise<ContactWithIdentityRelations[]>;
}

async function findFuzzyRecommendationCandidates(
  candidate: ContactIdentityCandidate,
  tenantId: string,
  db: PrismaTransactionClient | typeof prisma,
): Promise<ContactWithIdentityRelations[]> {
  const canonicalName = canonicalizeContactName(identityName(candidate));
  if ([...canonicalName].length < 5 || !('$queryRaw' in db) || typeof db.$queryRaw !== 'function') return [];
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "contacts"
    WHERE "tenantId" = ${tenantId}
      AND "contactType" = ${candidate.contactType}::"ContactType"
      AND "deletedAt" IS NULL AND "isActive" = true
      AND "canonicalName" IS NOT NULL
      AND "canonicalName" % ${canonicalName}
      AND similarity("canonicalName", ${canonicalName}) >= 0.3
    ORDER BY similarity("canonicalName", ${canonicalName}) DESC, "createdAt" ASC, "id" ASC
    LIMIT 20
  `);
  const ids = rows.map(({ id }) => id);
  if (ids.length === 0) return [];
  return db.contact.findMany({
    where: { id: { in: ids }, tenantId, contactType: candidate.contactType, deletedAt: null, isActive: true },
    include: identityRelationsInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 20,
  }) as Promise<ContactWithIdentityRelations[]>;
}

function rankMatches(
  candidate: ContactIdentityCandidate,
  contacts: ContactWithIdentityRelations[],
  forceContactId?: string,
): Array<{ contact: ContactWithIdentityRelations; record: ContactIdentityRecord; match: ContactMatchResult }> {
  return contacts
    .filter(
      (contact) =>
        contact.id === forceContactId || isPlausibleCandidate(candidate, toIdentityRecord(contact)),
    )
    .map((contact) => {
      const record = toIdentityRecord(contact);
      const pairConflict = identificationPairConflict(candidate, record);
      const match = pairConflict
        ? {
            contactId: record.id,
            score: 0,
            automatic: false,
            blockedByIdentifierConflict: true,
            reasons: [],
            conflicts: [pairConflict],
          } satisfies ContactMatchResult
        : scoreContactIdentityMatch(candidate, record);
      return { contact, record, match };
    })
    .sort((left, right) => {
      const identifierLeft = Number(left.match.reasons.includes('IDENTIFIER') || left.match.reasons.includes('CORPORATE_UEN'));
      const identifierRight = Number(right.match.reasons.includes('IDENTIFIER') || right.match.reasons.includes('CORPORATE_UEN'));
      return identifierRight - identifierLeft || right.match.score - left.match.score || left.contact.createdAt.getTime() - right.contact.createdAt.getTime() || left.contact.id.localeCompare(right.contact.id);
    });
}

function isPlausibleCandidate(
  incoming: ContactIdentityCandidate,
  existing: ContactIdentityRecord,
): boolean {
  const incomingName = canonicalizeContactName(identityName(incoming));
  const existingName = canonicalizeContactName(identityName(existing));
  const incomingAlias = canonicalizeContactName(incoming.alias);
  const existingAlias = canonicalizeContactName(existing.alias);
  if (incomingName && (
    (existingName && incomingName === existingName) ||
    (existingAlias && incomingName === existingAlias) ||
    (incomingAlias && incomingAlias === existingName)
  )) {
    return true;
  }
  const incomingCorporate = canonicalizeCorporateComparisonName(incoming.corporateName);
  const existingCorporate = canonicalizeCorporateComparisonName(existing.corporateName);
  if (
    incoming.contactType === 'CORPORATE' &&
    incomingCorporate &&
    incomingCorporate === existingCorporate
  ) {
    return true;
  }

  const incomingId = hasUsableIdentificationNumber(incoming)
    ? normalizeContactIdentifier(incoming.identificationNumber, incoming.identificationType)
    : null;
  const existingHasId = isDeterministicIdentifier(
    existing.identificationNumber,
    existing.identificationType,
  );
  const existingId = existingHasId
    ? normalizeContactIdentifier(existing.identificationNumber, existing.identificationType)
    : null;
  if (incomingId && incomingId === existingId) return true;
  if (
    incomingId &&
    existing.identificationType &&
    existing.identificationType !== incoming.identificationType
  ) {
    return false;
  }

  const incomingUen = hasUsableCorporateUen(incoming)
    ? normalizeContactIdentifier(incoming.corporateUen, 'UEN')
    : null;
  const existingHasUen = isDeterministicIdentifier(existing.corporateUen, 'UEN');
  const existingUen = existingHasUen
    ? normalizeContactIdentifier(existing.corporateUen, 'UEN')
    : null;
  if (incomingUen && incomingUen === existingUen) return true;

  // Name-only records remain eligible for fuzzy scoring. Differing strong keys are not
  // plausible unless one of the shared name/alias/corporate rules above qualified them.
  return !(incomingId && existingHasId) && !(incomingUen && existingHasUen);
}

export async function previewContactIdentity(
  candidate: ContactIdentityCandidate,
  tenantId: string,
  tx?: PrismaTransactionClient,
): Promise<ContactMatchResult | null> {
  if (!tenantId) throw new Error('Tenant context required for contact identity preview');
  const db = tx ?? prisma;
  const [exact, fuzzy] = await Promise.all([
    findCandidates(candidate, tenantId, db),
    findFuzzyRecommendationCandidates(candidate, tenantId, db),
  ]);
  const contacts = [...new Map([...exact, ...fuzzy].map((contact) => [contact.id, contact])).values()];
  return rankMatches(candidate, contacts)
    .map(({ match }) => match)
    .find((match) => match.score > 0 || match.conflicts.length > 0) ?? null;
}

function buildLockKeys(
  candidate: ContactIdentityCandidate,
  tenantId: string,
  decision: ContactResolutionDecision,
): string[] {
  const prefix = `contact-identity:${tenantId}:${candidate.contactType}`;
  const keys = [`${prefix}:name:${canonicalizeContactName(identityName(candidate))}`];
  if (hasUsableIdentificationNumber(candidate)) {
    keys.push(`${prefix}:id:${candidate.identificationType}:${normalizeContactIdentifier(candidate.identificationNumber, candidate.identificationType)}`);
  }
  if (hasUsableCorporateUen(candidate)) {
    keys.push(`${prefix}:uen:${normalizeContactIdentifier(candidate.corporateUen, 'UEN')}`);
  }
  if (decision.action === 'REUSE') {
    keys.push(`${prefix}:contact:${decision.contactId}`);
  }
  return [...new Set(keys)].sort();
}

function meetsDeterministicConfidence(confidence: number | undefined): boolean {
  return confidence === undefined || confidence >= 0.9;
}

function hasUsableIdentificationNumber(candidate: ContactIdentityCandidate): boolean {
  return Boolean(candidate.identificationType) &&
    meetsDeterministicConfidence(candidate.confidence?.identificationNumber) &&
    isDeterministicIdentifier(candidate.identificationNumber, candidate.identificationType);
}

function hasUsableCorporateUen(candidate: ContactIdentityCandidate): boolean {
  return meetsDeterministicConfidence(candidate.confidence?.corporateUen) &&
    isDeterministicIdentifier(candidate.corporateUen, 'UEN');
}

function identificationPairConflict(
  incoming: ContactIdentityCandidate,
  existing: ContactIdentityRecord,
): ContactIdentityConflict | null {
  if (!hasUsableIdentificationNumber(incoming)) return null;
  const incomingType = incoming.identificationType!;
  const incomingNumber = normalizeContactIdentifier(incoming.identificationNumber, incomingType);
  if (existing.identificationType && existing.identificationType !== incomingType) {
    return conflict(
      'identificationNumber',
      `${incomingType}:${incomingNumber}`,
      `${existing.identificationType}:${existing.identificationNumber ?? ''}`,
    );
  }
  if (existing.identificationNumber) {
    const existingNumber = normalizeContactIdentifier(
      existing.identificationNumber,
      existing.identificationType ?? incomingType,
    );
    if (incomingNumber !== existingNumber) {
      return conflict('identificationNumber', incomingNumber, existingNumber);
    }
  }
  return null;
}

function conflict(
  field: ContactIdentityConflict['field'],
  incomingValue: unknown,
  existingValue: unknown,
): ContactIdentityConflict {
  const printable = (value: unknown) => value instanceof Date ? value.toISOString() : value == null ? null : String(value);
  return { field, incomingValue: printable(incomingValue), existingValue: printable(existingValue) };
}

function comparable(field: ContactIdentityConflict['field'], value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = value == null ? '' : String(value);
  if (field === 'identificationNumber') return normalizeContactIdentifier(text, null) ?? '';
  return canonicalizeContactName(text);
}

function buildEnrichment(
  candidate: ContactIdentityCandidate,
  existing: ContactWithIdentityRelations,
): { data: Prisma.ContactUpdateInput; fields: string[]; conflicts: ContactIdentityConflict[] } {
  const data: Prisma.ContactUpdateInput = {};
  const fields: string[] = [];
  const conflicts: ContactIdentityConflict[] = [];
  const incomingDob = candidate.dateOfBirth ? new Date(candidate.dateOfBirth) : null;
  const values = [
    ['firstName', candidate.firstName, existing.firstName],
    ['lastName', candidate.lastName, existing.lastName],
    ['corporateName', candidate.corporateName, existing.corporateName],
    ['alias', candidate.alias, existing.alias],
    ['corporateUen', hasUsableCorporateUen(candidate) ? candidate.corporateUen : null, existing.corporateUen],
    ['nationality', candidate.nationality, existing.nationality],
    ['dateOfBirth', incomingDob, existing.dateOfBirth],
    ['fullAddress', candidate.fullAddress, existing.fullAddress],
  ] as const;
  const conflictFields = new Set<ContactIdentityConflict['field']>([
    'firstName', 'lastName', 'corporateName', 'identificationNumber', 'corporateUen', 'dateOfBirth', 'fullAddress',
  ]);

  for (const [field, incoming, current] of values) {
    if (isBlank(incoming)) continue;
    if (isBlank(current)) {
      data[field] = incoming as never;
      fields.push(field);
    } else if (conflictFields.has(field as ContactIdentityConflict['field']) && comparable(field as ContactIdentityConflict['field'], incoming) !== comparable(field as ContactIdentityConflict['field'], current)) {
      conflicts.push(conflict(field as ContactIdentityConflict['field'], incoming, current));
    }
  }
  if ('alias' in data) {
    data.canonicalAlias = canonicalizeContactAlias(data.alias as string | null | undefined);
    fields.push('canonicalAlias');
  }

  if (hasUsableIdentificationNumber(candidate)) {
    const incomingType = candidate.identificationType!;
    const incomingNumber = candidate.identificationNumber!.trim() || null;
    const existingType = existing.identificationType;
    const existingNumber = existing.identificationNumber;
    if (isBlank(existingType) && isBlank(existingNumber)) {
      data.identificationType = incomingType;
      data.identificationNumber = incomingNumber;
      fields.push('identificationType', 'identificationNumber');
    } else if (existingType === incomingType && isBlank(existingNumber)) {
      data.identificationNumber = incomingNumber;
      fields.push('identificationNumber');
    } else if (
      isBlank(existingType) &&
      normalizeContactIdentifier(existingNumber, incomingType) ===
        normalizeContactIdentifier(incomingNumber, incomingType)
    ) {
      data.identificationType = incomingType;
      fields.push('identificationType');
    }
  }

  if (fields.some((field) => field === 'firstName' || field === 'lastName' || field === 'corporateName')) {
    const updatedIdentity: ContactIdentityCandidate = {
      source: candidate.source,
      contactType: existing.contactType,
      firstName: (data.firstName as string | null | undefined) ?? existing.firstName,
      lastName: (data.lastName as string | null | undefined) ?? existing.lastName,
      corporateName: (data.corporateName as string | null | undefined) ?? existing.corporateName,
    };
    const updatedFullName = fullName(updatedIdentity);
    data.fullName = updatedFullName;
    data.canonicalName = canonicalizeContactName(identityName(updatedIdentity));
    fields.push('fullName', 'canonicalName');
  }
  return { data, fields, conflicts };
}

const identityRelationsInclude = {
  contactDetails: {
    where: { deletedAt: null },
    select: {
      id: true,
      detailType: true,
      value: true,
      companyId: true,
      purposes: true,
      label: true,
      description: true,
      displayOrder: true,
      isPrimary: true,
      isPoc: true,
    },
  },
  _count: {
    select: {
      companyRelations: true,
      officerPositions: true,
      shareholdings: true,
      contactDetails: true,
    },
  },
} as const;

async function findRawIdentifierDuplicate(
  candidate: ContactIdentityCandidate,
  tenantId: string,
  db: PrismaTransactionClient | typeof prisma,
): Promise<ContactWithIdentityRelations | null> {
  if (!hasUsableIdentificationNumber(candidate)) return null;
  const identificationNumber = candidate.identificationNumber?.trim() || null;
  if (!identificationNumber || !candidate.identificationType) return null;
  return db.contact.findFirst({
    where: {
      tenantId,
      identificationType: candidate.identificationType,
      identificationNumber,
    },
    include: identityRelationsInclude,
  }) as Promise<ContactWithIdentityRelations | null>;
}

function sourceChangeSource(source: ContactIdentityCandidate['source']): 'MANUAL' | 'BIZFILE_UPLOAD' | 'API' {
  if (source === 'BIZFILE') return 'BIZFILE_UPLOAD';
  return source === 'MANUAL' || source === 'COMPANY_QUICK_CREATE' ? 'MANUAL' : 'API';
}

async function createNewContact(
  candidate: ContactIdentityCandidate,
  params: TenantAwareParams,
  tx: PrismaTransactionClient,
): Promise<Contact> {
  const contact = await tx.contact.create({
    data: {
      tenantId: params.tenantId,
      contactType: candidate.contactType,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      fullName: fullName(candidate),
      canonicalName: canonicalizeContactName(identityName(candidate)),
      alias: candidate.alias,
      canonicalAlias: canonicalizeContactAlias(candidate.alias),
      identificationType: hasUsableIdentificationNumber(candidate) ? candidate.identificationType : null,
      identificationNumber: hasUsableIdentificationNumber(candidate) ? candidate.identificationNumber?.trim() || null : null,
      nationality: candidate.nationality,
      dateOfBirth: candidate.dateOfBirth ? new Date(candidate.dateOfBirth) : null,
      corporateName: candidate.corporateName,
      corporateUen: hasUsableCorporateUen(candidate) ? candidate.corporateUen?.trim() || null : null,
      fullAddress: candidate.fullAddress,
    },
  });
  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'CREATE',
    entityType: 'Contact',
    entityId: contact.id,
    entityName: contact.fullName,
    summary: `Created contact "${contact.fullName}" through identity resolution`,
    changeSource: sourceChangeSource(candidate.source),
    metadata: { source: candidate.source, sourceRecordId: candidate.sourceRecordId },
  }, tx as Prisma.TransactionClient);
  return contact;
}

async function addDistinctDetails(
  candidate: ContactIdentityCandidate,
  contact: ContactWithIdentityRelations,
  params: TenantAwareParams,
  tx: PrismaTransactionClient,
): Promise<string[]> {
  const existing = new Map(
    (contact.contactDetails ?? []).map((detail) => [
      `${detail.detailType}:${detail.companyId ?? ''}:${normalizeContactDetailValue(detail.detailType, detail.value)}`,
      detail,
    ]),
  );
  const incoming = new Map<string, ContactIdentityDetail>();
  for (const detail of candidate.contactDetails ?? []) {
    const normalized = normalizeContactDetailValue(detail.detailType, detail.value);
    if (!normalized) continue;
    const key = `${detail.detailType}:${detail.companyId ?? ''}:${normalized}`;
    const prior = incoming.get(key);
    incoming.set(key, prior
      ? { ...prior, purposes: [...new Set([...(prior.purposes ?? []), ...(detail.purposes ?? [])])] }
      : detail);
  }
  const added: string[] = [];
  for (const [key, detail] of incoming) {
    const normalized = normalizeContactDetailValue(detail.detailType, detail.value);
    if (!normalized) continue;
    const current = existing.get(key);
    if (current) {
      if (!current.id) continue;
      const purposes = [...new Set([...(current.purposes ?? []), ...(detail.purposes ?? [])])];
      const update: Parameters<typeof updateContactDetail>[0] = { id: current.id };
      if (purposes.length !== (current.purposes ?? []).length) update.purposes = purposes;
      if (isBlank(current.label) && !isBlank(detail.label)) update.label = detail.label!;
      if (isBlank(current.description) && !isBlank(detail.description)) update.description = detail.description!;
      if (detail.isPrimary && !current.isPrimary) update.isPrimary = true;
      if (detail.isPoc && !current.isPoc) update.isPoc = true;
      if (
        detail.displayOrder !== undefined &&
        detail.displayOrder !== 0 &&
        (current.displayOrder ?? 0) === 0
      ) {
        update.displayOrder = detail.displayOrder;
      }
      if (Object.keys(update).length > 1) {
        await updateContactDetail(update, { ...params, tx });
        added.push(`contactDetails.${detail.detailType.toLowerCase()}`);
      }
      continue;
    }
    existing.set(key, {
      detailType: detail.detailType,
      value: detail.value,
      companyId: detail.companyId ?? null,
    });
    await createContactDetail({
      contactId: contact.id,
      companyId: detail.companyId,
      detailType: detail.detailType,
      value: detail.value.trim(),
      purposes: detail.purposes,
      label: detail.label,
      description: detail.description,
      displayOrder: detail.displayOrder,
      isPrimary: detail.isPrimary,
      isPoc: detail.isPoc,
    }, { ...params, tx });
    added.push(`contactDetails.${detail.detailType.toLowerCase()}`);
  }
  return added;
}

async function resolveInTransaction(
  candidate: ContactIdentityCandidate,
  decision: ContactResolutionDecision,
  params: TenantAwareParams,
  tx: PrismaTransactionClient,
): Promise<ResolveContactIdentityResult> {
  // Keep identity locks after the shared backup and authorization gates. A
  // canonical company write owns those gates before it resolves contacts;
  // acquiring them here first prevents an identity writer from holding a
  // contact key while waiting for the canonical mutation boundary.
  await acquireBusinessOperationBarrier(tx, params.tenantId, 'shared');
  await acquireAuthorizationMutationGate(tx);
  for (const lockKey of buildLockKeys(candidate, params.tenantId, decision)) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
  }
  let contacts = await findCandidates(candidate, params.tenantId, tx);
  if (decision.action === 'REUSE') {
    const selectedContact = await tx.contact.findFirst({
      where: {
        id: decision.contactId,
        tenantId: params.tenantId,
        contactType: candidate.contactType,
        deletedAt: null,
        isActive: true,
      },
      include: identityRelationsInclude,
    }) as ContactWithIdentityRelations | null;
    if (!selectedContact) throw new Error('Selected contact was not found in this tenant');
    contacts = [...contacts.filter((contact) => contact.id !== decision.contactId), selectedContact];
  }
  const ranked = rankMatches(
    candidate,
    contacts,
    decision.action === 'REUSE' ? decision.contactId : undefined,
  );
  const allConflicts = ranked.flatMap(({ match }) => match.conflicts);
  let selected = decision.action === 'REUSE'
    ? ranked.find(({ contact }) => contact.id === decision.contactId)
    : ranked.find(({ match }) => match.automatic && !match.blockedByIdentifierConflict);

  if (decision.action === 'REUSE' && !selected) {
    throw new Error('Selected contact was not found in this tenant');
  }
  if (
    decision.action === 'REUSE' &&
    selected &&
    (selected.match.score <= 0 || selected.match.blockedByIdentifierConflict)
  ) {
    throw new Error('Selected contact is no longer a qualifying identity match');
  }
  if (decision.action === 'CREATE_SEPARATE') selected = undefined;

  let restoredContactId: string | null = null;
  if (!selected) {
    const identifierDuplicate = await findRawIdentifierDuplicate(candidate, params.tenantId, tx);
    if (identifierDuplicate) {
      const identifierLabel = `${identifierDuplicate.identificationType ?? 'UNKNOWN'}:${identifierDuplicate.identificationNumber ?? ''}`;
      if (decision.action === 'CREATE_SEPARATE') {
        throw new Error(
          `Cannot create a separate contact: ${identifierLabel} already exists on contact "${identifierDuplicate.fullName}"`,
        );
      }
      if (identifierDuplicate.contactType !== candidate.contactType) {
        throw new Error(
          `Contact identifier ${identifierLabel} already exists as a ${identifierDuplicate.contactType} contact "${identifierDuplicate.fullName}"`,
        );
      }
      if (identifierDuplicate.deletedAt !== null || !identifierDuplicate.isActive) {
        restoredContactId = identifierDuplicate.id;
        await tx.contact.update({
          where: { id: identifierDuplicate.id },
          data: { deletedAt: null, isActive: true },
        });
        const restored = await tx.contact.findFirst({
          where: { id: identifierDuplicate.id, tenantId: params.tenantId },
          include: identityRelationsInclude,
        }) as ContactWithIdentityRelations | null;
        if (!restored) {
          throw new Error(`Restored contact ${identifierDuplicate.id} could not be reloaded`);
        }
        await createAuditLog({
          tenantId: params.tenantId,
          userId: params.userId,
          action: 'RESTORE',
          entityType: 'Contact',
          entityId: restored.id,
          entityName: restored.fullName,
          summary: `Restored contact "${restored.fullName}" while resolving a matching identifier`,
          changeSource: sourceChangeSource(candidate.source),
          metadata: { source: candidate.source, sourceRecordId: candidate.sourceRecordId },
        }, tx as Prisma.TransactionClient);
        selected = {
          contact: restored,
          record: toIdentityRecord(restored),
          match: {
            contactId: restored.id,
            score: 1,
            automatic: true,
            blockedByIdentifierConflict: false,
            reasons: ['IDENTIFIER'],
            conflicts: [],
          },
        };
      } else {
        // Active same-type row that the active-scope search missed (e.g. created by a
        // concurrent import under a different lock key). Reuse it instead of colliding.
        selected = {
          contact: identifierDuplicate,
          record: toIdentityRecord(identifierDuplicate),
          match: {
            contactId: identifierDuplicate.id,
            score: 1,
            automatic: true,
            blockedByIdentifierConflict: false,
            reasons: ['IDENTIFIER'],
            conflicts: [],
          },
        };
      }
    }
  }

  if (!selected) {
    const reviewMatch = ranked.find(({ match }) => match.score > 0 || match.conflicts.length > 0);
    if (decision.action === 'CREATE_SEPARATE') {
      if (!reviewMatch) {
        throw new Error('A current review match is required to create a separate contact');
      }
    }
    const created = await createNewContact(candidate, params, tx);
    const enrichedFields = await addDistinctDetails(candidate, { ...created, contactDetails: [] }, params, tx);
    if (decision.action === 'CREATE_SEPARATE') {
      const target = reviewMatch;
      if (!target) {
        throw new Error('A current review match is required to create a separate contact');
      }
      const ordered = [target.contact.id, created.id].sort();
      const fingerprints = new Map([
        [target.contact.id, buildContactIdentityFingerprint(target.record)],
        [created.id, buildContactIdentityFingerprint({ ...candidate })],
      ]);
      const duplicateDecision = await tx.contactDuplicateDecision.create({
        data: {
          tenantId: params.tenantId,
          leftContactId: ordered[0],
          rightContactId: ordered[1],
          leftFingerprint: fingerprints.get(ordered[0])!,
          rightFingerprint: fingerprints.get(ordered[1])!,
          decision: 'CREATE_SEPARATE',
          reason: decision.reason.trim(),
          decidedById: params.userId,
        },
      });
      await createAuditLog({
        tenantId: params.tenantId,
        userId: params.userId,
        action: 'CREATE',
        entityType: 'Contact',
        entityId: created.id,
        entityName: created.fullName,
        summary: `Created separate contact "${created.fullName}" after identity review`,
        changeSource: sourceChangeSource(candidate.source),
        metadata: {
          source: candidate.source,
          sourceRecordId: candidate.sourceRecordId,
          outcome: 'CREATED_SEPARATE',
          matchReason: target.match.reasons,
          duplicateDecisionId: duplicateDecision?.id,
          fingerprints: Object.fromEntries(fingerprints),
          overrideReason: decision.reason.trim(),
        },
      }, tx as Prisma.TransactionClient);
    }
    return {
      contact: created,
      outcome: decision.action === 'CREATE_SEPARATE' ? 'CREATED_SEPARATE' : 'CREATED',
      match: reviewMatch?.match ?? null,
      enrichedFields,
      conflicts: allConflicts,
    };
  }

  const enrichment = buildEnrichment(candidate, selected.contact);
  if (
    enrichment.fields.includes('identificationType') ||
    enrichment.fields.includes('identificationNumber')
  ) {
    const identifierDuplicate = await findRawIdentifierDuplicate(candidate, params.tenantId, tx);
    if (identifierDuplicate && identifierDuplicate.id !== selected.contact.id) {
      throw new Error(
        `Cannot assign ${identifierDuplicate.identificationType ?? 'UNKNOWN'}:${identifierDuplicate.identificationNumber ?? ''} to "${selected.contact.fullName}" because it already exists on contact "${identifierDuplicate.fullName}"`,
      );
    }
  }
  const updated = enrichment.fields.length > 0
    ? await tx.contact.update({ where: { id: selected.contact.id }, data: enrichment.data })
    : selected.contact;
  const detailFields = await addDistinctDetails(candidate, selected.contact, params, tx);
  const enrichedFields = [...enrichment.fields, ...detailFields];
  if (enrichedFields.length > 0) {
    await createAuditLog({
      tenantId: params.tenantId,
      userId: params.userId,
      action: 'UPDATE',
      entityType: 'Contact',
      entityId: updated.id,
      entityName: updated.fullName,
      summary: `Enriched contact "${updated.fullName}" through identity resolution`,
      changeSource: sourceChangeSource(candidate.source),
      metadata: { source: candidate.source, sourceRecordId: candidate.sourceRecordId, enrichedFields },
    }, tx as Prisma.TransactionClient);
  }
  const reasons = selected.match.reasons;
  const outcome = restoredContactId === selected.contact.id
    ? 'RESTORED'
    : reasons.some((reason) => reason === 'IDENTIFIER' || reason === 'CORPORATE_UEN')
    ? 'REUSED_IDENTIFIER'
    : reasons.includes('APPROVED_ALIAS')
      ? 'REUSED_ALIAS'
      : 'REUSED_NAME';
  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'UPDATE',
    entityType: 'Contact',
    entityId: updated.id,
    entityName: updated.fullName,
    summary: outcome === 'RESTORED'
      ? `Restored contact "${updated.fullName}" through identity resolution`
      : `Reused contact "${updated.fullName}" through identity resolution`,
    changeSource: sourceChangeSource(candidate.source),
    metadata: {
      source: candidate.source,
      sourceRecordId: candidate.sourceRecordId,
      outcome,
      matchReason: reasons,
      identityFingerprint: buildContactIdentityFingerprint(selected.record),
    },
  }, tx as Prisma.TransactionClient);
  return {
    contact: updated as Contact,
    outcome,
    match: selected.match,
    enrichedFields,
    conflicts: [...selected.match.conflicts, ...enrichment.conflicts],
  };
}

export async function resolveOrCreateContact(
  candidate: ContactIdentityCandidate,
  decision: ContactResolutionDecision,
  params: TenantAwareParams,
): Promise<ResolveContactIdentityResult> {
  if (!params.tenantId) throw new Error('Tenant context required for contact identity resolution');
  if (decision.action === 'CREATE_SEPARATE' && !decision.reason.trim()) {
    throw new Error('A reason is required to create a separate contact');
  }
  if (params.tx) return resolveInTransaction(candidate, decision, params, params.tx);
  return prisma.$transaction((tx) => resolveInTransaction(candidate, decision, params, tx as PrismaTransactionClient));
}
