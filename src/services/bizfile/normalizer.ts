/**
 * BizFile Normalizer Service
 *
 * Handles data normalization and address formatting for BizFile data.
 */

import { normalizeName, normalizeCompanyName, normalizeAddress } from '@/lib/utils';
import { normalizeCompanyAlias } from '@/lib/company-display-label';
import type { ExtractedBizFileData } from './types';

const CURRENCY_NAME_MAP: Record<string, string> = {
  'SINGAPORE DOLLAR': 'SGD',
  'SINGAPORE DOLLARS': 'SGD',
  S: 'SGD',
};

/**
 * Normalize currency values to ISO 4217 3-letter codes when possible.
 * Example: "SINGAPORE DOLLAR" -> "SGD"
 */
function normalizeCurrency(value?: string): string | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // Handle clean 3-letter ISO codes (case-insensitive)
  const compact = trimmed.toUpperCase().replace(/[^A-Z]/g, '');
  if (compact.length === 3) {
    return compact;
  }

  // Handle currency names / aliases
  const normalizedName = trimmed.toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
  const codeToken = normalizedName.match(/\b[A-Z]{3}\b/)?.[0];
  if (codeToken) {
    return codeToken;
  }

  if (CURRENCY_NAME_MAP[normalizedName]) {
    return CURRENCY_NAME_MAP[normalizedName];
  }

  // Preserve unknown values (uppercase) to avoid silent data loss
  return trimmed.toUpperCase();
}

function normalizeCountry(value?: string): string | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (trimmed.toUpperCase() === 'SINGAPORE') {
    return 'Singapore';
  }

  return normalizeCompanyName(trimmed) || trimmed;
}

const LEADING_WORDS_THAT_ARE_NOT_BRANDS = new Set(['A', 'AN', 'AND', 'AT', 'BY', 'FOR', 'IN', 'OF', 'ON', 'OR', 'THE', 'TO']);

function normalizeBizFileCompanyName(value: string): string {
  const source = value.trim();
  let result = normalizeCompanyName(source) || source;
  const firstSourceWord = source.split(/\s+/)[0];
  if (/^[A-Z][A-Z0-9&]{1,3}$/.test(firstSourceWord) && !LEADING_WORDS_THAT_ARE_NOT_BRANDS.has(firstSourceWord)) {
    result = result.replace(/^\S+/, firstSourceWord);
  }
  return result
    .replace(/\bPTE\.?\s+LTD\.?\b/gi, 'Pte Ltd')
    .replace(/\bPRIVATE\s+LIMITED\b/gi, 'Private Limited')
    .replace(/\bPUBLIC\s+LIMITED\b/gi, 'Public Limited');
}

function splitLevelAndUnit(level?: string, unit?: string): { level?: string; unit?: string } {
  const cleanLevel = level?.trim().replace(/^#/, '');
  const cleanUnit = unit?.trim().replace(/^#/, '');

  const combined = cleanLevel && !cleanUnit
    ? cleanLevel.match(/^([A-Z0-9]+)-([A-Z0-9]+)$/i)
    : cleanUnit && !cleanLevel
      ? cleanUnit.match(/^([A-Z0-9]+)-([A-Z0-9]+)$/i)
      : null;

  if (combined) {
    return {
      level: combined[1],
      unit: combined[2],
    };
  }

  return {
    level: cleanLevel || undefined,
    unit: cleanUnit || undefined,
  };
}

function normalizeStructuredAddress<T extends {
  streetName: string;
  buildingName?: string;
  level?: string;
  unit?: string;
  country?: string;
}>(address: T): T {
  const normalizedParts = splitLevelAndUnit(address.level, address.unit);

  return {
    ...address,
    level: normalizedParts.level,
    unit: normalizedParts.unit,
    streetName: normalizeAddress(address.streetName) || address.streetName,
    buildingName: address.buildingName
      ? normalizeAddress(address.buildingName)
      : undefined,
    country: normalizeCountry(address.country),
  };
}

/**
 * Build full address string from address components
 */
export function buildFullAddress(addr: {
  block?: string;
  streetName: string;
  level?: string;
  unit?: string;
  buildingName?: string;
  postalCode: string;
}): string {
  const parts: string[] = [];
  if (addr.block) parts.push(addr.block);
  parts.push(addr.streetName);

  // Handle unit - strip any existing # prefix to avoid duplication (e.g., ##09-355)
  const cleanUnit = addr.unit?.replace(/^#/, '');
  const cleanLevel = addr.level?.replace(/^#/, '');

  if (cleanLevel && cleanUnit) {
    parts.push(`#${cleanLevel}-${cleanUnit}`);
  } else if (cleanUnit) {
    // Unit might already include level (e.g., "09-355"), just add # prefix
    parts.push(`#${cleanUnit}`);
  }
  if (addr.buildingName) parts.push(addr.buildingName);
  parts.push(`Singapore ${addr.postalCode}`);
  return normalizeAddress(parts.join(' '));
}

/**
 * Normalize extracted BizFile data before saving to database
 * Applies proper casing to names, company names, and addresses
 */
export function normalizeExtractedData(data: ExtractedBizFileData): ExtractedBizFileData {
  const normalized = { ...data };

  // Normalize currency values
  normalized.homeCurrency = normalizeCurrency(normalized.homeCurrency);

  if (normalized.paidUpCapital) {
    normalized.paidUpCapital = {
      ...normalized.paidUpCapital,
      currency: normalizeCurrency(normalized.paidUpCapital.currency) || 'SGD',
    };
  }

  if (normalized.issuedCapital) {
    normalized.issuedCapital = {
      ...normalized.issuedCapital,
      currency: normalizeCurrency(normalized.issuedCapital.currency) || 'SGD',
    };
  }

  if (normalized.shareCapital) {
    normalized.shareCapital = normalized.shareCapital.map((capital) => {
      const entry: NonNullable<ExtractedBizFileData['shareCapital']>[number] = {
        ...capital,
        currency: normalizeCurrency(capital.currency) || 'SGD',
      };
      // The extracted total is the authoritative value from the document and is
      // never recalculated. Par value is strictly calculated as
      // totalValue / numberOfShares; the extracted per-share value is ignored.
      // Treasury rows carry a total of 0, so no par value applies to them.
      const extractedParValue = capital.parValue;
      const derivedParValue =
        !entry.isTreasury && entry.numberOfShares > 0 && entry.totalValue > 0
          ? entry.totalValue / entry.numberOfShares
          : undefined;
      entry.parValue = derivedParValue;
      if (
        !entry.isTreasury
        && extractedParValue != null
        && derivedParValue != null
        && Math.abs(extractedParValue - derivedParValue) > 1e-9 * Math.max(1, Math.abs(derivedParValue))
      ) {
        entry.reviewFlags = [
          ...(capital.reviewFlags ?? []),
          `Share capital par value corrected from ${entry.currency} ${extractedParValue} to ${entry.currency} ${Number(derivedParValue.toFixed(10))} (recalculated as ${entry.currency} ${entry.totalValue} total / ${entry.numberOfShares} shares). Please verify against the document.`,
        ];
      }
      return entry;
    });
  }

  if (normalized.treasuryShares) {
    normalized.treasuryShares = {
      ...normalized.treasuryShares,
      currency: normalizeCurrency(normalized.treasuryShares.currency),
    };
  }

  // Normalize entity details
  if (normalized.entityDetails) {
    normalized.entityDetails = {
      ...normalized.entityDetails,
      name: normalizeBizFileCompanyName(normalized.entityDetails.name),
      ...(normalized.entityDetails.displayAlias === undefined
        ? {}
        : { displayAlias: normalizeCompanyAlias(normalized.entityDetails.displayAlias) }),
      formerName: normalized.entityDetails.formerName
        ? normalizeCompanyName(normalized.entityDetails.formerName)
        : undefined,
    };

    // Normalize former names array
    if (normalized.entityDetails.formerNames) {
      normalized.entityDetails.formerNames = normalized.entityDetails.formerNames.map((fn) => ({
        ...fn,
        name: normalizeCompanyName(fn.name) || fn.name,
      }));
    }
  }

  // Normalize SSIC descriptions (but not codes)
  if (normalized.ssicActivities) {
    if (normalized.ssicActivities.primary?.description) {
      normalized.ssicActivities.primary.description = normalizeCompanyName(
        normalized.ssicActivities.primary.description
      ) || normalized.ssicActivities.primary.description;
    }
    if (normalized.ssicActivities.secondary?.description) {
      normalized.ssicActivities.secondary.description = normalizeCompanyName(
        normalized.ssicActivities.secondary.description
      ) || normalized.ssicActivities.secondary.description;
    }
  }

  // Normalize addresses
  if (normalized.registeredAddress) {
    normalized.registeredAddress = {
      ...normalizeStructuredAddress(normalized.registeredAddress),
      country: normalizeCountry(normalized.registeredAddress.country) || 'Singapore',
    };
  }

  if (normalized.mailingAddress) {
    normalized.mailingAddress = normalizeStructuredAddress(normalized.mailingAddress);
  }

  // Normalize officers
  if (normalized.officers) {
    normalized.officers = normalized.officers.map((officer) => ({
      ...officer,
      name: normalizeName(officer.name) || officer.name,
      nationality: officer.nationality ? normalizeCompanyName(officer.nationality) : undefined,
      address: officer.address ? normalizeAddress(officer.address) : undefined,
    }));
  }

  // Normalize shareholders
  if (normalized.shareholders) {
    normalized.shareholders = normalized.shareholders.map((shareholder) => ({
      ...shareholder,
      name: shareholder.type === 'CORPORATE'
        ? normalizeCompanyName(shareholder.name) || shareholder.name
        : normalizeName(shareholder.name) || shareholder.name,
      nationality: shareholder.nationality ? normalizeCompanyName(shareholder.nationality) : undefined,
      placeOfOrigin: shareholder.placeOfOrigin ? normalizeCompanyName(shareholder.placeOfOrigin) : undefined,
      address: shareholder.address ? normalizeAddress(shareholder.address) : undefined,
      currency: normalizeCurrency(shareholder.currency),
    }));
  }

  // Normalize auditor
  if (normalized.auditor) {
    normalized.auditor = {
      ...normalized.auditor,
      name: normalizeCompanyName(normalized.auditor.name) || normalized.auditor.name,
      address: normalized.auditor.address ? normalizeAddress(normalized.auditor.address) : undefined,
    };
  }

  // Normalize charges
  if (normalized.charges) {
    normalized.charges = normalized.charges.map((charge) => ({
      ...charge,
      chargeHolderName: normalizeCompanyName(charge.chargeHolderName) || charge.chargeHolderName,
      description: charge.description ? normalizeCompanyName(charge.description) : undefined,
      currency: normalizeCurrency(charge.currency),
    }));
  }

  return normalized;
}
