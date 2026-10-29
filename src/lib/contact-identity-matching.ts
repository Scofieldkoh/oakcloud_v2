import {
  canonicalizeContactName,
  canonicalizeCorporateComparisonName,
  isDeterministicIdentifier,
  normalizeContactIdentifier,
} from '@/lib/contact-identity-normalization';
import type {
  ContactIdentityCandidate,
  ContactIdentityConflict,
  ContactIdentityRecord,
  ContactMatchReason,
  ContactMatchResult,
} from '@/types/contact-identity';

const FUZZY_RECOMMENDATION_THRESHOLD = 0.93;
const MINIMUM_FUZZY_CODE_POINTS = 5;
const DETERMINISTIC_CONFIDENCE_THRESHOLD = 0.9;

function identityName(candidate: ContactIdentityCandidate): string {
  return candidate.contactType === 'CORPORATE'
    ? candidate.corporateName ?? ''
    : `${candidate.firstName ?? ''}${candidate.lastName ?? ''}`;
}

function identifierConflict(
  incoming: ContactIdentityCandidate,
  existing: ContactIdentityRecord,
): ContactIdentityConflict | null {
  const incomingIdentifier = normalizeContactIdentifier(
    incoming.identificationNumber,
    incoming.identificationType,
  );
  const existingIdentifier = normalizeContactIdentifier(
    existing.identificationNumber,
    existing.identificationType,
  );
  if (
    hasEligibleIdentificationNumber(incoming) &&
    hasEligibleIdentificationNumber(existing) &&
    incomingIdentifier !== existingIdentifier
  ) {
    return {
      field: 'identificationNumber',
      incomingValue: incomingIdentifier,
      existingValue: existingIdentifier,
    };
  }

  const incomingUen = normalizeContactIdentifier(incoming.corporateUen, 'UEN');
  const existingUen = normalizeContactIdentifier(existing.corporateUen, 'UEN');
  if (
    hasEligibleCorporateUen(incoming) &&
    hasEligibleCorporateUen(existing) &&
    incomingUen !== existingUen
  ) {
    return { field: 'corporateUen', incomingValue: incomingUen, existingValue: existingUen };
  }

  return null;
}

function meetsConfidenceThreshold(confidence: number | undefined): boolean {
  return confidence === undefined || confidence >= DETERMINISTIC_CONFIDENCE_THRESHOLD;
}

function hasEligibleIdentificationNumber(candidate: ContactIdentityCandidate): boolean {
  return (
    meetsConfidenceThreshold(candidate.confidence?.identificationNumber) &&
    isDeterministicIdentifier(candidate.identificationNumber, candidate.identificationType)
  );
}

function hasEligibleCorporateUen(candidate: ContactIdentityCandidate): boolean {
  return (
    meetsConfidenceThreshold(candidate.confidence?.corporateUen) &&
    isDeterministicIdentifier(candidate.corporateUen, 'UEN')
  );
}

function scriptClass(value: string): string | null {
  const scripts = [
    ['Han', /\p{Script=Han}/u],
    ['Hiragana', /\p{Script=Hiragana}/u],
    ['Katakana', /\p{Script=Katakana}/u],
    ['Hangul', /\p{Script=Hangul}/u],
    ['Latin', /\p{Script=Latin}/u],
    ['Cyrillic', /\p{Script=Cyrillic}/u],
    ['Arabic', /\p{Script=Arabic}/u],
    ['Devanagari', /\p{Script=Devanagari}/u],
  ] as const;
  const present = scripts.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
  return present.length === 1 ? present[0] : null;
}

function levenshteinSimilarity(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  if (a.length === 0 || b.length === 0) return a.length === b.length ? 1 : 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }

  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function result(
  existing: ContactIdentityRecord,
  score: number,
  automatic: boolean,
  reasons: ContactMatchReason[],
  conflicts: ContactIdentityConflict[] = [],
): ContactMatchResult {
  return {
    contactId: existing.id,
    score,
    automatic,
    blockedByIdentifierConflict: conflicts.length > 0,
    reasons,
    conflicts,
  };
}

export function scoreContactIdentityMatch(
  incoming: ContactIdentityCandidate,
  existing: ContactIdentityRecord,
): ContactMatchResult {
  if (incoming.contactType !== existing.contactType) return result(existing, 0, false, []);

  const conflict = identifierConflict(incoming, existing);
  if (conflict) return result(existing, 0, false, [], [conflict]);

  const incomingIdentifier = normalizeContactIdentifier(
    incoming.identificationNumber,
    incoming.identificationType,
  );
  const existingIdentifier = normalizeContactIdentifier(
    existing.identificationNumber,
    existing.identificationType,
  );
  if (
    incoming.identificationType === existing.identificationType &&
    hasEligibleIdentificationNumber(incoming) &&
    hasEligibleIdentificationNumber(existing) &&
    incomingIdentifier === existingIdentifier
  ) {
    return result(existing, 1, true, ['IDENTIFIER']);
  }

  const incomingUen = normalizeContactIdentifier(incoming.corporateUen, 'UEN');
  const existingUen = normalizeContactIdentifier(existing.corporateUen, 'UEN');
  if (
    hasEligibleCorporateUen(incoming) &&
    hasEligibleCorporateUen(existing) &&
    incomingUen === existingUen
  ) {
    return result(existing, 1, true, ['CORPORATE_UEN']);
  }

  const incomingName = canonicalizeContactName(identityName(incoming));
  const existingName = canonicalizeContactName(identityName(existing));
  const incomingAlias = canonicalizeContactName(incoming.alias);
  const existingAlias = canonicalizeContactName(existing.alias);
  if (
    incomingName &&
    ((existingAlias && incomingName === existingAlias) ||
      (incomingAlias && incomingAlias === existingName))
  ) {
    return result(existing, 1, true, ['APPROVED_ALIAS']);
  }

  if (incomingName && incomingName === existingName) {
    return result(existing, 1, true, ['EXACT_CANONICAL_NAME']);
  }

  if (incoming.contactType === 'CORPORATE') {
    const incomingCorporate = canonicalizeCorporateComparisonName(incoming.corporateName);
    const existingCorporate = canonicalizeCorporateComparisonName(existing.corporateName);
    if (incomingCorporate && incomingCorporate === existingCorporate) {
      return result(existing, 0.99, true, ['CORPORATE_SUFFIX_VARIANT']);
    }
  }

  const incomingScript = scriptClass(incomingName);
  const existingScript = scriptClass(existingName);
  if (
    [...incomingName].length >= MINIMUM_FUZZY_CODE_POINTS &&
    [...existingName].length >= MINIMUM_FUZZY_CODE_POINTS &&
    incomingScript &&
    incomingScript === existingScript
  ) {
    const score = levenshteinSimilarity(incomingName, existingName);
    if (score >= FUZZY_RECOMMENDATION_THRESHOLD) {
      return result(existing, score, false, ['FUZZY_NAME']);
    }
  }

  return result(existing, 0, false, []);
}

function hasStrongIdentifier(record: ContactIdentityRecord): boolean {
  return hasEligibleIdentificationNumber(record) || hasEligibleCorporateUen(record);
}

export function rankContactMaster(records: ContactIdentityRecord[]): ContactIdentityRecord[] {
  return [...records].sort((left, right) => {
    const identifierRank = Number(hasStrongIdentifier(right)) - Number(hasStrongIdentifier(left));
    if (identifierRank !== 0) return identifierRank;
    if (left.populatedFieldCount !== right.populatedFieldCount) {
      return right.populatedFieldCount - left.populatedFieldCount;
    }
    if (left.relationshipCount !== right.relationshipCount) {
      return right.relationshipCount - left.relationshipCount;
    }
    const ageRank = left.createdAt.getTime() - right.createdAt.getTime();
    return ageRank !== 0 ? ageRank : left.id.localeCompare(right.id);
  });
}
