/**
 * ACRA company-name availability assessment (local ACRA mirror).
 *
 * The registry mirror is not the Bizfile+ name-reservation engine, so this
 * module predicts Bizfile+ outcomes from:
 *   1. ACRA's published identical-name rules; and
 *   2. empirical Bizfile+ checks captured on 2026-09-11.
 *
 * Keep the matching stages conservative. In particular, do not introduce
 * generic edit-distance, phonetic, stemming, or embedding thresholds here:
 * observed Bizfile+ results allow one-character typos and phonetic variants
 * that such approaches would incorrectly flag.
 */

import { Prisma } from '@/generated/prisma';
import logger from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAcraSyncState } from '@/services/acra-sync.service';

const MAX_RECORDS = 10;
const DB_QUERY_LIMIT = 500;
const MIN_SEARCH_ANCHOR_LENGTH = 3;
const MAX_SEARCH_ANCHOR_LENGTH = 12;

export const COMPANY_NAME_MAX_LENGTH = 300;
export const COMPANY_NAME_RECORD_COUNT_CAP = MAX_RECORDS;

export type CompanyNameAssessment =
  | 'AVAILABLE'
  | 'SIMILAR_WARNING'
  | 'IDENTICAL'
  | 'REVIEW_REQUIRED';

export type CompanyNameMatchType = Exclude<CompanyNameAssessment, 'AVAILABLE' | 'REVIEW_REQUIRED'>;

export interface CompanyNameCheckRecord {
  uen: string;
  entityName: string;
  entityStatus: string;
  matchType?: CompanyNameMatchType;
}

export interface CompanyNameCheckResult {
  /**
   * Backward-compatible form flag. SIMILAR_WARNING remains false because the
   * existing public-form UX intentionally requires a name without a warning.
   * Consumers that need Bizfile-like nuance should use `assessment`.
   */
  available: boolean;
  assessment: CompanyNameAssessment;
  checkedAt: string;
  /** Last-updated time of the ACRA collection the check was run against. */
  dataAsOf: string | null;
  records: CompanyNameCheckRecord[];
  reasonCodes: string[];
}

export interface CanonicalCompanyName {
  normalized: string;
  structuralTokens: string[];
  identicalKey: string;
}

export class CompanyNameCheckUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompanyNameCheckUnavailableError';
  }
}

/**
 * Terms ACRA/Bizfile treats as non-distinctive when they occur at the end of a
 * proposed name. Multi-token entries are matched longest-first and stripped
 * repeatedly, which is required for e.g. "... GROUP INTERNATIONAL".
 */
const TERMINAL_IGNORED_EXPRESSIONS = [
  'SOUTH EAST ASIA',
  'ASIA PACIFIC',
  'SOUTH ASIA',
  'AND COMPANY',
  'INTERNATIONAL',
  'PARTNERSHIPS',
  'INCORPORATED',
  'CORPORATION',
  'ASSOCIATES',
  'PARTNERSHIP',
  'WORLDWIDE',
  'SINGAPORE',
  'HOLDINGS',
  'PARTNERS',
  'COMPANY',
  'TRADING',
  'HOLDING',
  'PARTNER',
  'GROUP',
  'ASIA',
] as const;

/** Entity-form expressions ignored for name identity. */
const ENTITY_SUFFIX_EXPRESSIONS = [
  'PUBLIC ACCOUNTING CORPORATION',
  'LIMITED LIABILITY PARTNERSHIP',
  'LIMITED PARTNERSHIP',
  'PRIVATE LIMITED',
  'SENDIRIAN BERHAD',
  'BERHAD',
  'LIMITED',
  'PRIVATE',
  'LLP',
  'PAC',
  'SDN',
  'BHD',
  'PTE',
  'LTD',
  'LP',
] as const;

/**
 * Empirically confirmed terminal representations. Deliberately exclude APAC,
 * HLDGS, ASSOC, SGP and WW: Bizfile+ returned those as available in testing.
 */
const TERMINAL_ALIASES: Readonly<Record<string, string>> = {
  SG: 'SINGAPORE',
  INTL: 'INTERNATIONAL',
  CORP: 'CORPORATION',
  CO: 'COMPANY',
};

/**
 * Bizfile+ does not simply strip a trailing "s". Use an explicit inflection
 * lexicon instead. The first entries are directly observed; the remaining
 * common business nouns are conservative starting coverage for ordinary noun
 * singular/plural pairs.
 */
const PLURAL_CANONICAL: Readonly<Record<string, string>> = {
  ACCOUNTINGS: 'ACCOUNTING',
  SOLUTIONS: 'SOLUTION',
  CONSULTANTS: 'CONSULTANT',
  CONSULTANCIES: 'CONSULTANCY',
  CONSULTATIONS: 'CONSULTATION',
  SERVICES: 'SERVICE',
  TECHNOLOGIES: 'TECHNOLOGY',
  SYSTEMS: 'SYSTEM',
  INDUSTRIES: 'INDUSTRY',
  ENTERPRISES: 'ENTERPRISE',
  VENTURES: 'VENTURE',
  INVESTMENTS: 'INVESTMENT',
  INVESTORS: 'INVESTOR',
  DEVELOPMENTS: 'DEVELOPMENT',
  DEVELOPERS: 'DEVELOPER',
  DESIGNS: 'DESIGN',
  DESIGNERS: 'DESIGNER',
  LOGISTICS: 'LOGISTIC',
  PRODUCTS: 'PRODUCT',
  RESOURCES: 'RESOURCE',
  HOLDINGS: 'HOLDING',
  PARTNERS: 'PARTNER',
  PARTNERSHIPS: 'PARTNERSHIP',
  ASSOCIATES: 'ASSOCIATE',
};

/**
 * Similar-name families are intentionally explicit. The CONSULT family is
 * directly confirmed by Bizfile+; the others are conservative business-term
 * seed coverage. A family match is only considered when token count/order and
 * every other token are identical, preventing broad fuzzy false positives.
 */
const SIMILARITY_FAMILIES = [
  new Set(['CONSULTING', 'CONSULTANT', 'CONSULTANCY', 'CONSULTATION']),
  new Set(['ACCOUNTING', 'ACCOUNTANT', 'ACCOUNTANCY']),
  new Set(['ADVISORY', 'ADVISER', 'ADVISOR']),
  new Set(['MANAGEMENT', 'MANAGER']),
  new Set(['TECHNOLOGY', 'TECHNOLOGICAL']),
] as const;

/**
 * Confirmed precedence case from Bizfile+ testing. Do not expand this list with
 * general referral words unless verified: referral/restriction semantics differ
 * from ordinary similarity semantics and overblocking would be harmful.
 */
const REVIEW_REQUIRED_TOKENS = new Set(['INC']);

/** Common descriptor words are poor retrieval anchors. */
const WEAK_SEARCH_TOKENS = new Set([
  'AND', 'THE', 'SINGAPORE', 'SG', 'ASIA', 'GROUP', 'HOLDING', 'HOLDINGS',
  'INTERNATIONAL', 'INTL', 'WORLDWIDE', 'COMPANY', 'CO', 'CORPORATION', 'CORP',
  'TRADING', 'PARTNER', 'PARTNERS', 'PARTNERSHIP', 'PARTNERSHIPS', 'ASSOCIATES',
  'CONSULTING', 'CONSULTANT', 'CONSULTANCY', 'CONSULTATION', 'ACCOUNTING',
  'SERVICE', 'SERVICES', 'SOLUTION', 'SOLUTIONS',
  // Entity-form words such as PTE or LTD match most of the registry.
  ...ENTITY_SUFFIX_EXPRESSIONS.filter((expression) => !expression.includes(' ')),
]);

const TERMINAL_DOMAIN_PATTERN = /\.(?:CO|COM|EDU|GOV|NET|ORG|SG)\s*$/i;
const APOSTROPHE_PATTERN = /[’']/g;
const NON_ALPHANUMERIC_PATTERN = /[^A-Z0-9]+/g;

function removeDiacritics(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeCompanyName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeForRules(value: string): string {
  return removeDiacritics(normalizeCompanyName(value))
    .toUpperCase()
    // S'PORE is empirically treated as Singapore even in a non-terminal position.
    .replace(/\bS\s*[’']\s*PORE\b/g, 'SINGAPORE')
    // Domain endings are explicitly disregarded; remove before punctuation folding.
    .replace(TERMINAL_DOMAIN_PATTERN, ' ')
    .replace(/&/g, ' AND ')
    // Apostrophes are ignored without creating a word boundary: SOLUTION'S -> SOLUTIONS.
    .replace(APOSTROPHE_PATTERN, '')
    .replace(NON_ALPHANUMERIC_PATTERN, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(value: string): string[] {
  return value ? value.split(' ').filter(Boolean) : [];
}

function expressionTokens(expression: string): string[] {
  return expression.split(' ');
}

function endsWithTokens(tokens: string[], suffix: readonly string[]): boolean {
  if (suffix.length > tokens.length) return false;
  const offset = tokens.length - suffix.length;
  return suffix.every((token, index) => tokens[offset + index] === token);
}

function removeLongestTerminalExpression(tokens: string[]): boolean {
  const expressions = [...ENTITY_SUFFIX_EXPRESSIONS, ...TERMINAL_IGNORED_EXPRESSIONS]
    .map(expressionTokens)
    .sort((a, b) => b.length - a.length);

  for (const suffix of expressions) {
    if (!endsWithTokens(tokens, suffix)) continue;
    tokens.splice(tokens.length - suffix.length, suffix.length);
    return true;
  }
  return false;
}

function canonicalizePlural(token: string): string {
  return PLURAL_CANONICAL[token] ?? token;
}

/**
 * Builds the deterministic representation used for identical/similar checks.
 * The compact key intentionally removes all remaining spaces, reproducing
 * observed ABACON CONSULTING / ABACONCONSULTING / ABA CON CONSULTING identity.
 */
export function canonicalizeCompanyName(value: string): CanonicalCompanyName {
  const normalized = normalizeForRules(value);
  const tokens = tokenize(normalized);

  if (tokens[0] === 'THE') {
    tokens.shift();
  }

  // Literal SINGAPORE is empirically ignored in prefix, infix, and suffix positions.
  // Do not do the same for SG; SG is only a confirmed terminal alias.
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index] === 'SINGAPORE') tokens.splice(index, 1);
  }

  // Strip non-distinctive suffixes repeatedly. Resolve a confirmed abbreviation
  // only while it is terminal, so "ABACON SG CONSULTING" remains distinctive.
  while (tokens.length > 0) {
    const terminal = tokens[tokens.length - 1];
    const alias = TERMINAL_ALIASES[terminal];
    if (alias) {
      tokens[tokens.length - 1] = alias;
    }

    if (!removeLongestTerminalExpression(tokens)) break;
  }

  const structuralTokens = tokens.map(canonicalizePlural);
  return {
    normalized,
    structuralTokens,
    identicalKey: structuralTokens.join(''),
  };
}

function sameSimilarityFamily(left: string, right: string): boolean {
  if (left === right) return false;
  return SIMILARITY_FAMILIES.some((family) => family.has(left) && family.has(right));
}

/**
 * Conservative lexical similarity derived from observed Bizfile+ warnings.
 * A warning requires the same token count and order, with exactly one token
 * replaced by a member of the same curated lexical family.
 */
export function areCompanyNamesSimilar(left: string, right: string): boolean {
  const leftTokens = canonicalizeCompanyName(left).structuralTokens;
  const rightTokens = canonicalizeCompanyName(right).structuralTokens;

  if (leftTokens.length === 0 || leftTokens.length !== rightTokens.length) return false;

  let lexicalDifferences = 0;
  for (let index = 0; index < leftTokens.length; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];
    if (leftToken === rightToken) continue;
    if (!sameSimilarityFamily(leftToken, rightToken)) return false;
    lexicalDifferences += 1;
    if (lexicalDifferences > 1) return false;
  }

  return lexicalDifferences === 1;
}

export function classifyCompanyNameMatch(
  proposedName: string,
  existingName: string
): CompanyNameMatchType | null {
  const proposed = canonicalizeCompanyName(proposedName);
  const existing = canonicalizeCompanyName(existingName);

  if (proposed.identicalKey && proposed.identicalKey === existing.identicalKey) {
    return 'IDENTICAL';
  }

  return areCompanyNamesSimilar(proposedName, existingName) ? 'SIMILAR_WARNING' : null;
}

export function requiresCompanyNameReview(value: string): boolean {
  const tokens = tokenize(normalizeForRules(value));
  return tokens.some((token) => REVIEW_REQUIRED_TOKENS.has(token));
}

function getSearchAnchors(value: string): string[] {
  const canonical = canonicalizeCompanyName(value);
  const normalizedTokens = tokenize(canonical.normalized)
    .filter((token) => token.length >= MIN_SEARCH_ANCHOR_LENGTH && !WEAK_SEARCH_TOKENS.has(token));

  const candidates = [
    ...normalizedTokens,
    ...canonical.structuralTokens.filter(
      (token) => token.length >= MIN_SEARCH_ANCHOR_LENGTH && !WEAK_SEARCH_TOKENS.has(token)
    ),
  ];

  // Joined/split variants need an anchor that can still locate the registry row.
  // A short compact prefix works for observed ABACONCONSULTING -> ABACON CONSULTING.
  if (canonical.identicalKey.length >= MIN_SEARCH_ANCHOR_LENGTH) {
    candidates.push(canonical.identicalKey.slice(0, Math.min(8, canonical.identicalKey.length)));
    if (canonical.identicalKey.length > 8) {
      candidates.push(canonical.identicalKey.slice(0, 6));
    }
  }

  return [...new Set(candidates)]
    .map((anchor) => anchor.slice(0, MAX_SEARCH_ANCHOR_LENGTH))
    .filter((anchor) => anchor.length >= MIN_SEARCH_ANCHOR_LENGTH)
    // Prefer longer/distinctive anchors first to limit broad registry scans.
    .sort((a, b) => b.length - a.length)
    .slice(0, 5);
}

function buildCandidateWhere(name: string): Prisma.AcraEntityWhereInput {
  const anchors = getSearchAnchors(name);
  if (anchors.length === 0) {
    return { entityName: { contains: normalizeCompanyName(name), mode: 'insensitive' } };
  }

  return {
    OR: anchors.map((anchor) => ({
      entityName: { contains: anchor, mode: 'insensitive' },
    })),
  };
}

/**
 * Check whether a proposed company name appears to be available for
 * incorporation against the local ACRA entity mirror.
 *
 * `assessment` contains the nuanced prediction. `available` intentionally
 * remains conservative for the existing Form module: both IDENTICAL and
 * SIMILAR_WARNING are false until the Form UI has an explicit "proceed despite
 * warning" interaction.
 */
export async function checkCompanyNameAvailability(
  name: string
): Promise<CompanyNameCheckResult> {
  const normalizedName = normalizeCompanyName(name);

  if (!normalizedName) {
    throw new Error('Company name is required');
  }

  if (normalizedName.length > COMPANY_NAME_MAX_LENGTH) {
    throw new Error(`Company name must be at most ${COMPANY_NAME_MAX_LENGTH} characters`);
  }

  let syncState: { collectionLastUpdatedAt: string | null; entityCount: number } | null = null;
  try {
    syncState = await getAcraSyncState();
  } catch (error) {
    logger.warn('Reading the ACRA sync state failed', { error });
  }

  if (!syncState || syncState.entityCount <= 0) {
    throw new CompanyNameCheckUnavailableError('Company name check is temporarily unavailable');
  }

  const checkedAt = new Date().toISOString();

  if (requiresCompanyNameReview(normalizedName)) {
    logger.info('Company name requires review', { name: normalizedName, reason: 'restricted-term' });
    return {
      available: false,
      assessment: 'REVIEW_REQUIRED',
      checkedAt,
      dataAsOf: syncState.collectionLastUpdatedAt,
      records: [],
      reasonCodes: ['RESTRICTED_OR_PROHIBITED_TERM'],
    };
  }

  logger.info('Checking company name availability', { name: normalizedName });

  let rawRecords: CompanyNameCheckRecord[];
  try {
    rawRecords = await prisma.acraEntity.findMany({
      where: buildCandidateWhere(normalizedName),
      select: { uen: true, entityName: true, entityStatus: true },
      orderBy: { entityName: 'asc' },
      take: DB_QUERY_LIMIT,
    });
  } catch (error) {
    logger.warn('Local ACRA entity query failed', { error });
    throw new CompanyNameCheckUnavailableError('Company name check is temporarily unavailable');
  }

  const seen = new Set<string>();
  const identicalRecords: CompanyNameCheckRecord[] = [];
  const similarRecords: CompanyNameCheckRecord[] = [];

  for (const record of rawRecords) {
    const matchType = classifyCompanyNameMatch(normalizedName, record.entityName);
    if (!matchType) continue;

    const dedupeKey = record.uen || record.entityName.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const classified = { ...record, matchType };
    if (matchType === 'IDENTICAL') identicalRecords.push(classified);
    else similarRecords.push(classified);
  }

  const assessment: CompanyNameAssessment = identicalRecords.length > 0
    ? 'IDENTICAL'
    : similarRecords.length > 0
      ? 'SIMILAR_WARNING'
      : 'AVAILABLE';

  const records = [...identicalRecords, ...similarRecords].slice(0, MAX_RECORDS);
  const reasonCodes = assessment === 'IDENTICAL'
    ? ['IDENTICAL_AFTER_ACRA_NORMALIZATION']
    : assessment === 'SIMILAR_WARNING'
      ? ['CURATED_LEXICAL_FAMILY_MATCH']
      : [];

  logger.info('Company name availability check completed', {
    name: normalizedName,
    assessment,
    recordCount: records.length,
    candidateCount: rawRecords.length,
    dataAsOf: syncState.collectionLastUpdatedAt,
  });

  return {
    available: assessment === 'AVAILABLE',
    assessment,
    checkedAt,
    dataAsOf: syncState.collectionLastUpdatedAt,
    records,
    reasonCodes,
  };
}
