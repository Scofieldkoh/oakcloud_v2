import {
  Prisma,
  type ContactDetailType,
  type ContactType,
  type IdentificationType,
} from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import { scoreContactIdentityMatch, rankContactMaster } from '@/lib/contact-identity-matching';
import { buildContactIdentityFingerprint } from '@/lib/contact-identity-normalization';
import { prisma } from '@/lib/prisma';
import { acquireBusinessOperationBarrier } from '@/lib/business-operation-backup-barrier';
import { acquireAuthorizationMutationGate } from '@/lib/authorization-mutation-gate';
import type {
  ContactIdentityConflict,
  ContactIdentityRecord,
  ContactMatchReason,
} from '@/types/contact-identity';

const MAX_EXACT_GROUPS_PER_KEY = 200;
const MAX_FUZZY_SEEDS = 200;
const MAX_FUZZY_MATCHES_PER_SEED = 10;
const MAX_FUZZY_PAIRS = 500;
const MAX_DISCOVERY_CONTACTS = 1_000;
const MAX_CANDIDATE_PAIRS = 1_500;

type DiscoveryContact = {
  id: string;
  tenantId: string;
  contactType: ContactType;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  canonicalName: string | null;
  alias: string | null;
  identificationType: IdentificationType | null;
  identificationNumber: string | null;
  nationality: string | null;
  dateOfBirth: Date | null;
  corporateName: string | null;
  corporateUen: string | null;
  fullAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
  contactDetails: Array<{
    detailType: ContactDetailType;
    value: string;
    companyId: string | null;
  }>;
  companyRelations: Array<{
    company: { id: string; name: string; uen: string };
  }>;
  _count: {
    companyRelations: number;
    officerPositions: number;
    shareholdings: number;
    chargeHoldings: number;
    contactDetails: number;
    noteTabs: number;
  };
  documentReferenceCount?: number;
  aliasReferenceCount?: number;
};

type CandidatePair = {
  leftContactId: string;
  rightContactId: string;
  reasons: ContactMatchReason[];
  confidence: number;
  conflicts: ContactIdentityConflict[];
};

export interface ContactDuplicatePreview {
  id: string;
  contactType: ContactType;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  corporateName: string | null;
  alias: string | null;
  identificationType: IdentificationType | null;
  identificationNumber: string | null;
  corporateUen: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  fullAddress: string | null;
  contactDetails: DiscoveryContact['contactDetails'];
  companies: Array<{ id: string; name: string; uen: string }>;
  referenceCounts: {
    companyRelations: number;
    officerPositions: number;
    shareholdings: number;
    chargeHoldings: number;
    contactDetails: number;
    noteTabs: number;
    documentRevisions: number;
    aliases: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ContactDuplicateGroup {
  contactIds: string[];
  contacts: ContactDuplicatePreview[];
  reasons: ContactMatchReason[];
  confidence: number;
  conflicts: ContactIdentityConflict[];
  blockedByIdentifierConflict: boolean;
  fingerprints: Record<string, string>;
  recommendedMasterId: string;
}

export interface ListContactDuplicateGroupsResult {
  groups: ContactDuplicateGroup[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RejectContactDuplicatePairInput {
  leftContactId: string;
  rightContactId: string;
  leftFingerprint: string;
  rightFingerprint: string;
  reason: string;
}

function toIdentityRecord(contact: DiscoveryContact): ContactIdentityRecord {
  const populatedFieldCount = [
    contact.firstName,
    contact.lastName,
    contact.corporateName,
    contact.alias,
    contact.identificationNumber,
    contact.corporateUen,
    contact.nationality,
    contact.dateOfBirth,
    contact.fullAddress,
  ].filter((value) => value !== null && value !== '').length + contact._count.contactDetails;

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
    contactDetails: contact.contactDetails.map((detail) => ({
      detailType: detail.detailType,
      value: detail.value,
      companyId: detail.companyId ?? undefined,
    })),
    canonicalName: contact.canonicalName ?? '',
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
    relationshipCount:
      contact._count.companyRelations +
      contact._count.officerPositions +
      contact._count.shareholdings +
      contact._count.chargeHoldings,
    populatedFieldCount,
  };
}

function preview(contact: DiscoveryContact): ContactDuplicatePreview {
  return {
    id: contact.id,
    contactType: contact.contactType,
    fullName: contact.fullName,
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
    contactDetails: contact.contactDetails,
    companies: contact.companyRelations.map(({ company }) => company),
    referenceCounts: {
      companyRelations: contact._count.companyRelations,
      officerPositions: contact._count.officerPositions,
      shareholdings: contact._count.shareholdings,
      chargeHoldings: contact._count.chargeHoldings,
      contactDetails: contact._count.contactDetails,
      noteTabs: contact._count.noteTabs,
      documentRevisions: contact.documentReferenceCount ?? 0,
      aliases: contact.aliasReferenceCount ?? 0,
    },
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

function sortedPair(leftContactId: string, rightContactId: string): [string, string] {
  return leftContactId.localeCompare(rightContactId) <= 0
    ? [leftContactId, rightContactId]
    : [rightContactId, leftContactId];
}

function pairKey(leftContactId: string, rightContactId: string): string {
  return sortedPair(leftContactId, rightContactId).join('\u0000');
}

function isSerializationFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String(error.code);
  return code === 'P2034' || code === '40001';
}

function combinations(contactIds: string[]): Array<[string, string]> {
  const ids = [...contactIds].sort();
  const pairs: Array<[string, string]> = [];
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) pairs.push([ids[left], ids[right]]);
  }
  return pairs;
}

function addPair(
  pairs: Map<string, CandidatePair>,
  left: ContactIdentityRecord,
  right: ContactIdentityRecord,
  fallbackReason?: ContactMatchReason,
): void {
  const score = scoreContactIdentityMatch(left, right);
  const reasons = score.reasons.length > 0 ? score.reasons : fallbackReason ? [fallbackReason] : [];
  if (reasons.length === 0) return;
  const [leftContactId, rightContactId] = sortedPair(left.id, right.id);
  const key = pairKey(leftContactId, rightContactId);
  const prior = pairs.get(key);
  if (!prior && pairs.size >= MAX_CANDIDATE_PAIRS) return;
  pairs.set(key, {
    leftContactId,
    rightContactId,
    reasons: [...new Set([...(prior?.reasons ?? []), ...reasons])].sort() as ContactMatchReason[],
    confidence: Math.max(prior?.confidence ?? 0, score.score),
    conflicts: [...(prior?.conflicts ?? []), ...score.conflicts],
  });
}

function groupBy<T>(items: T[], key: (item: T) => string | null): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    if (!value) continue;
    result.set(value, [...(result.get(value) ?? []), item]);
  }
  return result;
}

function uniqueConflicts(conflicts: ContactIdentityConflict[]): ContactIdentityConflict[] {
  return [...new Map(conflicts.map((conflict) => [JSON.stringify(conflict), conflict])).values()];
}

const MERGE_IDENTITY_FIELDS = [
  'firstName', 'lastName', 'alias', 'identificationType', 'identificationNumber',
  'nationality', 'dateOfBirth', 'corporateName', 'corporateUen', 'fullAddress',
] as const;

function differingIdentityFields(records: ContactIdentityRecord[]): ContactIdentityConflict[] {
  return MERGE_IDENTITY_FIELDS.flatMap((field) => {
    const values = [...new Set(records.map((record) => {
      const value = record[field];
      return value == null ? '' : String(value);
    }).filter(Boolean))];
    return values.length > 1
      ? [{ field, incomingValue: values[0], existingValue: values[1] } satisfies ContactIdentityConflict]
      : [];
  });
}

function rankGroupMaster(
  records: ContactIdentityRecord[],
  conflicts: ContactIdentityConflict[],
): ContactIdentityRecord {
  const identificationConflicts = conflicts.some(({ field }) => field === 'identificationNumber');
  const corporateUenConflicts = conflicts.some(({ field }) => field === 'corporateUen');
  const rankingRecords = records.map((record) => ({
    ...record,
    identificationType: identificationConflicts ? null : record.identificationType,
    identificationNumber: identificationConflicts ? null : record.identificationNumber,
    corporateUen: corporateUenConflicts ? null : record.corporateUen,
    populatedFieldCount:
      record.populatedFieldCount -
      (identificationConflicts && record.identificationNumber ? 1 : 0) -
      (corporateUenConflicts && record.corporateUen ? 1 : 0),
  }));
  return rankContactMaster(rankingRecords)[0];
}

function buildGroups(
  contacts: DiscoveryContact[],
  pairs: CandidatePair[],
  fingerprints: Map<string, string>,
  rejectedPairs: Array<[string, string]> = [],
): ContactDuplicateGroup[] {
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const parent = new Map(contacts.map((contact) => [contact.id, contact.id]));
  const find = (id: string): string => {
    const current = parent.get(id)!;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const [root, child] = leftRoot.localeCompare(rightRoot) <= 0
      ? [leftRoot, rightRoot]
      : [rightRoot, leftRoot];
    parent.set(child, root);
  };
  const orderedPairs = [...pairs].sort((left, right) =>
    left.leftContactId.localeCompare(right.leftContactId) ||
    left.rightContactId.localeCompare(right.rightContactId),
  );
  const groupedPairs: CandidatePair[] = [];
  for (const pair of orderedPairs) {
    const leftRoot = find(pair.leftContactId);
    const rightRoot = find(pair.rightContactId);
    const wouldReconnectRejectedPair = rejectedPairs.some(([rejectedLeftId, rejectedRightId]) => {
      const rejectedLeftRoot = find(rejectedLeftId);
      const rejectedRightRoot = find(rejectedRightId);
      return (rejectedLeftRoot === leftRoot && rejectedRightRoot === rightRoot) ||
        (rejectedLeftRoot === rightRoot && rejectedRightRoot === leftRoot);
    });
    if (wouldReconnectRejectedPair) continue;
    union(pair.leftContactId, pair.rightContactId);
    groupedPairs.push(pair);
  }

  const members = new Map<string, string[]>();
  for (const pair of groupedPairs) {
    for (const id of [pair.leftContactId, pair.rightContactId]) {
      const root = find(id);
      if (!members.get(root)?.includes(id)) members.set(root, [...(members.get(root) ?? []), id]);
    }
  }

  return [...members.values()].map((ids) => {
    const contactIds = [...ids].sort();
    const records = contactIds.map((id) => toIdentityRecord(contactById.get(id)!));
    const groupPairs = groupedPairs.filter((pair) =>
      contactIds.includes(pair.leftContactId) && contactIds.includes(pair.rightContactId),
    );
    const allMemberConflicts = combinations(contactIds).flatMap(([leftId, rightId]) =>
      scoreContactIdentityMatch(
        toIdentityRecord(contactById.get(leftId)!),
        toIdentityRecord(contactById.get(rightId)!),
      ).conflicts,
    );
    const conflicts = uniqueConflicts([
      ...groupPairs.flatMap((pair) => pair.conflicts),
      ...allMemberConflicts,
      ...differingIdentityFields(records),
    ]);
    const blockedByIdentifierConflict = conflicts.some(({ field }) =>
      field === 'identificationNumber' || field === 'corporateUen');
    return {
      contactIds,
      contacts: contactIds.map((id) => preview(contactById.get(id)!)),
      reasons: [...new Set(groupPairs.flatMap((pair) => pair.reasons))].sort() as ContactMatchReason[],
      confidence: blockedByIdentifierConflict ? 0 : Math.max(...groupPairs.map((pair) => pair.confidence)),
      conflicts,
      blockedByIdentifierConflict,
      fingerprints: Object.fromEntries(contactIds.map((id) => [id, fingerprints.get(id)!])),
      recommendedMasterId: rankGroupMaster(records, conflicts).id,
    };
  }).sort((left, right) =>
    right.confidence - left.confidence || left.contactIds.join('\u0000').localeCompare(right.contactIds.join('\u0000')),
  );
}

const contactSelection = {
  id: true,
  tenantId: true,
  contactType: true,
  firstName: true,
  lastName: true,
  fullName: true,
  canonicalName: true,
  alias: true,
  identificationType: true,
  identificationNumber: true,
  nationality: true,
  dateOfBirth: true,
  corporateName: true,
  corporateUen: true,
  fullAddress: true,
  createdAt: true,
  updatedAt: true,
  contactDetails: {
    where: { deletedAt: null },
    select: { detailType: true, value: true, companyId: true },
  },
  companyRelations: {
    where: { deletedAt: null },
    select: { company: { select: { id: true, name: true, uen: true } } },
  },
  _count: {
    select: {
      companyRelations: true,
      officerPositions: true,
      shareholdings: true,
      chargeHoldings: true,
      contactDetails: true,
      noteTabs: true,
    },
  },
} satisfies Prisma.ContactSelect;

export async function listContactDuplicateGroups({
  tenantId,
  page,
  limit,
}: {
  tenantId: string;
  page: number;
  limit: number;
}): Promise<ListContactDuplicateGroupsResult> {
  const activeScope = { tenantId, deletedAt: null, isActive: true } as const;
  const [canonicalGroups, identifierRows, fuzzyRows] = await Promise.all([
    prisma.contact.groupBy({
      by: ['contactType', 'canonicalName'],
      where: { ...activeScope, canonicalName: { not: null } },
      having: { canonicalName: { _count: { gt: 1 } } },
      orderBy: [{ contactType: 'asc' }, { canonicalName: 'asc' }],
      take: MAX_EXACT_GROUPS_PER_KEY,
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ leftContactId: string; rightContactId: string }>>(Prisma.sql`
      WITH normalized_identifier_candidates AS (
        SELECT id, "contactType",
          'IDENTIFICATION:' || "identificationType"::text AS "matchKind",
          CASE
            WHEN "identificationType" IN ('NRIC', 'FIN', 'UEN')
              THEN regexp_replace(upper(normalize("identificationNumber", NFKC)), '[[:space:]-]+', '', 'g')
            ELSE regexp_replace(trim(upper(normalize("identificationNumber", NFKC))), '[[:space:]]+', ' ', 'g')
          END AS "normalizedIdentifier"
        FROM contacts
        WHERE "tenantId" = ${tenantId}
          AND "deletedAt" IS NULL
          AND "isActive" = true
          AND "identificationType" IS NOT NULL
          AND "identificationNumber" IS NOT NULL

        UNION ALL

        SELECT id, "contactType", 'CORPORATE_UEN' AS "matchKind",
          regexp_replace(upper(normalize("corporateUen", NFKC)), '[[:space:]-]+', '', 'g') AS "normalizedIdentifier"
        FROM contacts
        WHERE "tenantId" = ${tenantId}
          AND "deletedAt" IS NULL
          AND "isActive" = true
          AND "corporateUen" IS NOT NULL
      ), valid_identifier_candidates AS (
        SELECT id, "contactType", "matchKind", "normalizedIdentifier"
        FROM normalized_identifier_candidates
        WHERE "normalizedIdentifier" <> ''
          AND "normalizedIdentifier" !~ '[*•●]'
          AND lower(regexp_replace("normalizedIdentifier", '[[:space:]]+', '', 'g'))
            NOT IN ('unknown', 'notavailable', 'n/a', 'na', 'redacted', 'masked')
          AND length(regexp_replace("normalizedIdentifier", '[^A-Z0-9]', '', 'g')) >= 5
      ), duplicate_identifier_keys AS (
        SELECT "contactType", "matchKind", "normalizedIdentifier"
        FROM valid_identifier_candidates
        GROUP BY "contactType", "matchKind", "normalizedIdentifier"
        HAVING count(*) > 1
        ORDER BY "contactType", "matchKind", "normalizedIdentifier"
        LIMIT ${MAX_EXACT_GROUPS_PER_KEY}
      )
      SELECT left_candidate.id AS "leftContactId", right_candidate.id AS "rightContactId"
      FROM duplicate_identifier_keys duplicate_key
      JOIN valid_identifier_candidates left_candidate
        ON left_candidate."contactType" = duplicate_key."contactType"
        AND left_candidate."matchKind" = duplicate_key."matchKind"
        AND left_candidate."normalizedIdentifier" = duplicate_key."normalizedIdentifier"
      JOIN valid_identifier_candidates right_candidate
        ON right_candidate."contactType" = duplicate_key."contactType"
        AND right_candidate."matchKind" = duplicate_key."matchKind"
        AND right_candidate."normalizedIdentifier" = duplicate_key."normalizedIdentifier"
        AND right_candidate.id > left_candidate.id
      ORDER BY duplicate_key."contactType", duplicate_key."matchKind",
        duplicate_key."normalizedIdentifier", left_candidate.id, right_candidate.id
      LIMIT ${MAX_FUZZY_PAIRS}
    `),
    prisma.$queryRaw<Array<{ leftContactId: string; rightContactId: string }>>(Prisma.sql`
      WITH seeds AS (
        SELECT id, "contactType", "canonicalName"
        FROM contacts
        WHERE "tenantId" = ${tenantId}
          AND "deletedAt" IS NULL
          AND "isActive" = true
          AND "canonicalName" IS NOT NULL
          AND char_length("canonicalName") >= 5
        ORDER BY id
        LIMIT ${MAX_FUZZY_SEEDS}
      )
      SELECT seed.id AS "leftContactId", candidate.id AS "rightContactId"
      FROM seeds seed
      CROSS JOIN LATERAL (
        SELECT contact.id, similarity(contact."canonicalName", seed."canonicalName") AS similarity
        FROM contacts contact
        WHERE contact."tenantId" = ${tenantId}
          AND contact."deletedAt" IS NULL
          AND contact."isActive" = true
          AND contact."contactType" = seed."contactType"
          AND contact.id > seed.id
          AND contact."canonicalName" IS NOT NULL
          AND char_length(contact."canonicalName") >= 5
          AND contact."canonicalName" % seed."canonicalName"
          AND similarity(contact."canonicalName", seed."canonicalName") >= 0.3
        ORDER BY similarity(contact."canonicalName", seed."canonicalName") DESC, contact.id
        LIMIT ${MAX_FUZZY_MATCHES_PER_SEED}
      ) candidate
      ORDER BY seed.id, candidate.similarity DESC, candidate.id
      LIMIT ${MAX_FUZZY_PAIRS}
    `),
  ]);

  const canonicalKeys = (canonicalGroups ?? []).flatMap((group) => group.canonicalName
    ? [{ contactType: group.contactType, canonicalName: group.canonicalName }]
    : []);
  const identifierIds = [...new Set((identifierRows ?? []).flatMap((row) => [row.leftContactId, row.rightContactId]))];
  const fuzzyIds = [...new Set((fuzzyRows ?? []).flatMap((row) => [row.leftContactId, row.rightContactId]))];
  const candidateFilters: Prisma.ContactWhereInput[] = [];
  if (canonicalKeys.length > 0) candidateFilters.push(...canonicalKeys);
  if (identifierIds.length > 0) candidateFilters.push({ id: { in: identifierIds } });
  if (fuzzyIds.length > 0) candidateFilters.push({ id: { in: fuzzyIds } });

  if (candidateFilters.length === 0) {
    return { groups: [], total: 0, page, limit, totalPages: 0 };
  }

  const selectedContacts = await prisma.contact.findMany({
    where: { ...activeScope, OR: candidateFilters },
    select: contactSelection,
    orderBy: { id: 'asc' },
    take: MAX_DISCOVERY_CONTACTS,
  }) as DiscoveryContact[];
  const selectedContactIds = selectedContacts.map(({ id }) => id);
  const [documentReferences, vendorAliases, customerAliases] = await Promise.all([
    prisma.documentRevision.findMany({
      where: {
        processingDocument: { tenantId },
        OR: [
          { vendorId: { in: selectedContactIds } },
          { customerId: { in: selectedContactIds } },
        ],
      },
      select: { id: true, vendorId: true, customerId: true },
    }),
    prisma.vendorAlias.findMany({
      where: { tenantId, deletedAt: null, normalizedContactId: { in: selectedContactIds } },
      select: { id: true, normalizedContactId: true },
    }),
    prisma.customerAlias.findMany({
      where: { tenantId, deletedAt: null, normalizedContactId: { in: selectedContactIds } },
      select: { id: true, normalizedContactId: true },
    }),
  ]);
  const documentIdsByContact = new Map<string, Set<string>>();
  for (const revision of documentReferences) {
    for (const contactId of [revision.vendorId, revision.customerId]) {
      if (!contactId) continue;
      const ids = documentIdsByContact.get(contactId) ?? new Set<string>();
      ids.add(revision.id);
      documentIdsByContact.set(contactId, ids);
    }
  }
  const aliasCounts = new Map<string, number>();
  for (const alias of [...vendorAliases, ...customerAliases]) {
    aliasCounts.set(alias.normalizedContactId, (aliasCounts.get(alias.normalizedContactId) ?? 0) + 1);
  }
  const contacts = selectedContacts.map((contact) => ({
    ...contact,
    documentReferenceCount: documentIdsByContact.get(contact.id)?.size ?? 0,
    aliasReferenceCount: aliasCounts.get(contact.id) ?? 0,
  }));
  const records = new Map(contacts.map((contact) => [contact.id, toIdentityRecord(contact)]));
  const pairs = new Map<string, CandidatePair>();

  const canonicalKeySet = new Set(canonicalKeys.map(({ contactType, canonicalName }) =>
    `${contactType}\u0000${canonicalName}`,
  ));
  for (const bucket of groupBy(contacts, (contact) => contact.canonicalName
    ? `${contact.contactType}\u0000${contact.canonicalName}`
    : null,
  ).values()) {
    if (!canonicalKeySet.has(`${bucket[0].contactType}\u0000${bucket[0].canonicalName}`)) continue;
    for (const [leftId, rightId] of combinations(bucket.map(({ id }) => id))) {
      addPair(pairs, records.get(leftId)!, records.get(rightId)!, 'EXACT_CANONICAL_NAME');
    }
  }
  for (const identifier of identifierRows ?? []) {
    const left = records.get(identifier.leftContactId);
    const right = records.get(identifier.rightContactId);
    if (left && right) addPair(pairs, left, right);
  }
  for (const fuzzy of fuzzyRows ?? []) {
    const left = records.get(fuzzy.leftContactId);
    const right = records.get(fuzzy.rightContactId);
    if (left && right) addPair(pairs, left, right);
  }

  const fingerprints = new Map([...records].map(([id, record]) => [id, buildContactIdentityFingerprint(record)]));
  const participatingContactIds = [...new Set([...pairs.values()].flatMap(({ leftContactId, rightContactId }) =>
    [leftContactId, rightContactId],
  ))].sort();
  const decisions = participatingContactIds.length < 2 ? [] : await prisma.contactDuplicateDecision.findMany({
    where: {
      tenantId,
      decision: { in: ['REJECTED', 'CREATE_SEPARATE'] },
      leftContactId: { in: participatingContactIds },
      rightContactId: { in: participatingContactIds },
    },
    select: { leftContactId: true, rightContactId: true, leftFingerprint: true, rightFingerprint: true },
    orderBy: [{ leftContactId: 'asc' }, { rightContactId: 'asc' }],
  });
  const currentRejectedPairs = (decisions ?? []).flatMap((decision): Array<[string, string]> => {
    const current = fingerprints.get(decision.leftContactId) === decision.leftFingerprint &&
      fingerprints.get(decision.rightContactId) === decision.rightFingerprint;
    return current ? [sortedPair(decision.leftContactId, decision.rightContactId)] : [];
  });
  const rejected = new Set(currentRejectedPairs.map(([leftContactId, rightContactId]) =>
    pairKey(leftContactId, rightContactId),
  ));
  const activePairs = [...pairs.entries()].flatMap(([key, pair]) => rejected.has(key) ? [] : [pair]);
  const groups = buildGroups(contacts, activePairs, fingerprints, currentRejectedPairs);
  const total = groups.length;
  const totalPages = Math.ceil(total / limit);
  return {
    groups: groups.slice((page - 1) * limit, page * limit),
    total,
    page,
    limit,
    totalPages,
  };
}

export async function rejectContactDuplicatePair(
  input: RejectContactDuplicatePairInput,
  params: { tenantId: string; userId: string },
): Promise<{ rejected: true }> {
  if (input.leftContactId === input.rightContactId) throw new Error('Contact IDs must be different');
  if (input.reason.trim().length < 10) throw new Error('Rejection reason must be at least 10 characters');
  const suppliedFingerprints = new Map([
    [input.leftContactId, input.leftFingerprint],
    [input.rightContactId, input.rightFingerprint],
  ]);
  const [leftContactId, rightContactId] = sortedPair(input.leftContactId, input.rightContactId);
  try {
    return await prisma.$transaction(async (tx) => {
      await acquireBusinessOperationBarrier(tx, params.tenantId, 'shared');
      await acquireAuthorizationMutationGate(tx);
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM contacts
        WHERE "tenantId" = ${params.tenantId}
          AND id IN (${Prisma.join([leftContactId, rightContactId])})
          AND "deletedAt" IS NULL
          AND "isActive" = true
        ORDER BY id
        FOR UPDATE
      `);
      const contacts = await tx.contact.findMany({
        where: {
          id: { in: [leftContactId, rightContactId] },
          tenantId: params.tenantId,
          deletedAt: null,
          isActive: true,
        },
        select: contactSelection,
        orderBy: { id: 'asc' },
        take: 2,
      }) as DiscoveryContact[];
      if (contacts.length !== 2) throw new Error('Duplicate contact pair not found');

      const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
      const leftFingerprint = buildContactIdentityFingerprint(toIdentityRecord(contactById.get(leftContactId)!));
      const rightFingerprint = buildContactIdentityFingerprint(toIdentityRecord(contactById.get(rightContactId)!));
      if (
        suppliedFingerprints.get(leftContactId) !== leftFingerprint ||
        suppliedFingerprints.get(rightContactId) !== rightFingerprint
      ) {
        throw new Error('Duplicate recommendation is stale');
      }

      const reason = input.reason.trim();
      const data = {
        tenantId: params.tenantId,
        leftContactId,
        rightContactId,
        leftFingerprint,
        rightFingerprint,
        decision: 'REJECTED',
        reason,
        decidedById: params.userId,
      };
      const decision = await tx.contactDuplicateDecision.upsert({
        where: {
          tenantId_leftContactId_rightContactId: {
            tenantId: params.tenantId,
            leftContactId,
            rightContactId,
          },
        },
        create: data,
        update: data,
      });
      await createAuditLog({
        tenantId: params.tenantId,
        userId: params.userId,
        action: 'UPDATE',
        entityType: 'ContactDuplicateDecision',
        entityId: decision.id,
        reason,
        summary: `Rejected duplicate recommendation for contacts ${leftContactId} and ${rightContactId}`,
        metadata: {
          leftContactId,
          rightContactId,
          leftFingerprint,
          rightFingerprint,
          reason,
          reviewerId: params.userId,
        },
      }, tx);
      return { rejected: true } as const;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isSerializationFailure(error)) throw new Error('Duplicate recommendation is stale');
    throw error;
  }
}
