/**
 * ACRA compliance enrichment for BizFile extraction.
 *
 * After AI extraction, the compliance dates (last AR filed date and accounts
 * due date) are compared against the locally synced ACRA entity records
 * (`acra_entity`, synced from data.gov.sg). When the ACRA value is later than
 * the extracted value (or the extracted value is missing), the extraction is
 * updated with the ACRA value so the review UI and company profile carry the
 * freshest ACRA-registered dates.
 */

import { prisma } from '@/lib/prisma';
import { createLogger, safeErrorMessage } from '@/lib/logger';
import type { ExtractedBizFileData } from './types';

const log = createLogger('bizfile-acra-enrichment');

export type AcraEnrichedComplianceField = 'lastArFiledDate' | 'accountsDueDate';

export interface BizFileAcraEnrichmentResult {
  data: ExtractedBizFileData;
  /** ACRA record metadata when any field was updated from ACRA data. */
  acra?: {
    /** Data-as-of timestamp of the ACRA record used. */
    dataAsOf: string;
    overriddenFields: AcraEnrichedComplianceField[];
  };
}

function utcDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function acraDateIsLater(
  acraValue: string | null,
  extractedValue: string | null | undefined,
): boolean {
  const acra = utcDate(acraValue);
  if (!acra) return false;
  const extracted = utcDate(extractedValue);
  return !extracted || acra.getTime() > extracted.getTime();
}

/**
 * Enrich extracted BizFile compliance dates with ACRA registry data.
 *
 * Looks up the entity by UEN in the locally synced ACRA records and, for each
 * of the annual return date and account due date, replaces the extracted
 * value when the ACRA value is later (or the extracted value is missing).
 * Enrichment failures never block extraction.
 */
export async function enrichBizFileComplianceFromAcra(
  data: ExtractedBizFileData,
): Promise<BizFileAcraEnrichmentResult> {
  const uen = data.entityDetails?.uen?.trim();
  if (!uen) return { data };

  try {
    const record = await prisma.acraEntity.findFirst({
      where: { uen: { equals: uen, mode: 'insensitive' } },
      select: { dataAsOf: true, accountDueDate: true, annualReturnDate: true },
    });
    if (!record) return { data };

    const overriddenFields: AcraEnrichedComplianceField[] = [];
    const compliance = { ...data.compliance };

    if (acraDateIsLater(record.annualReturnDate, compliance.lastArFiledDate)) {
      compliance.lastArFiledDate = record.annualReturnDate ?? undefined;
      overriddenFields.push('lastArFiledDate');
    }
    if (acraDateIsLater(record.accountDueDate, compliance.accountsDueDate)) {
      compliance.accountsDueDate = record.accountDueDate ?? undefined;
      overriddenFields.push('accountsDueDate');
    }

    if (!overriddenFields.length) return { data };

    log.info('Enriched BizFile compliance from ACRA records', {
      uen,
      overriddenFields,
      dataAsOf: record.dataAsOf,
    });

    return {
      data: { ...data, compliance },
      acra: { dataAsOf: record.dataAsOf, overriddenFields },
    };
  } catch (error) {
    log.warn('ACRA compliance enrichment skipped', {
      uen,
      error: safeErrorMessage(error),
    });
    return { data };
  }
}
