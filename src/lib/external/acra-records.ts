/**
 * ACRA Records Retrieval Utility (server-only)
 *
 * Reads compliance data from the locally synced ACRA entity records
 * (`acra_entity`, synced from data.gov.sg by the ACRA sync task) and
 * calculates the Financial Year End (FYE) based on company type.
 *
 * Server-only: this module queries the database and must not be imported
 * from client components.
 *
 * Usage:
 *   const compliance = await retrieveAcraCompliance(uen, entityType);
 *   // compliance = { accountDueDate, annualReturnDate, dataAsOf, financialYearEndDay, financialYearEndMonth }
 */

import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { calculateFYEFromAccountDueDate, isCompanyEntityType } from './acra-fye';

export interface LocalAcraRecord {
  accountDueDate: string | null;
  annualReturnDate: string | null;
  dataAsOf: string;
}

export interface AcraComplianceResult {
  /** Data-as-of timestamp of the synced ACRA collection. */
  dataAsOf: string | null;
  accountDueDate: string | null;
  annualReturnDate: string | null;
  financialYearEndDay: number | null;
  financialYearEndMonth: number | null;
}

export interface FYEResult {
  day: number;
  month: number;
}

/**
 * Normalize a synced ACRA date value to ISO YYYY-MM-DD, or null when the
 * value is missing or not a real date (e.g., "na" for unfiled annual returns).
 */
function normalizeAcraDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

/**
 * Fetch the locally synced ACRA record for a UEN.
 * Failures (e.g., the table not being provisioned yet) return null.
 */
export async function fetchLocalAcraRecord(uen: string): Promise<LocalAcraRecord | null> {
  try {
    const record = await prisma.acraEntity.findFirst({
      where: { uen: { equals: uen.trim(), mode: 'insensitive' } },
      select: { accountDueDate: true, annualReturnDate: true, dataAsOf: true },
    });
    if (!record) return null;
    return {
      dataAsOf: record.dataAsOf,
      accountDueDate: normalizeAcraDate(record.accountDueDate),
      annualReturnDate: normalizeAcraDate(record.annualReturnDate),
    };
  } catch (error) {
    logger.warn('Local ACRA record lookup failed', { uen, error });
    return null;
  }
}

/**
 * Retrieve compliance data from the local ACRA records for a UEN.
 *
 * Returns the stored account due date and annual return date together with
 * the data-as-of timestamp. When the entity type is a company structure and
 * an account due date is present, the FYE day/month are calculated from it.
 *
 * @param uen - Company UEN
 * @param entityType - Entity type (e.g., PRIVATE_LIMITED)
 * @returns The ACRA compliance data, or null if no local record exists
 */
export async function retrieveAcraCompliance(
  uen: string,
  entityType: string
): Promise<AcraComplianceResult | null> {
  const record = await fetchLocalAcraRecord(uen);
  if (!record) return null;

  const fye =
    record.accountDueDate && isCompanyEntityType(entityType)
      ? calculateFYEFromAccountDueDate(record.accountDueDate, entityType)
      : null;

  return {
    dataAsOf: record.dataAsOf,
    accountDueDate: record.accountDueDate,
    annualReturnDate: record.annualReturnDate,
    financialYearEndDay: fye?.day ?? null,
    financialYearEndMonth: fye?.month ?? null,
  };
}

/**
 * Retrieve FYE from the local ACRA records
 *
 * @param uen - Company UEN
 * @param entityType - Entity type (e.g., PRIVATE_LIMITED)
 * @returns FYE result with day and month, or null if not found
 */
export async function retrieveFYEFromACRA(
  uen: string,
  entityType: string
): Promise<FYEResult | null> {
  const compliance = await retrieveAcraCompliance(uen, entityType);

  if (!compliance?.financialYearEndDay || !compliance.financialYearEndMonth) {
    return null;
  }

  return { day: compliance.financialYearEndDay, month: compliance.financialYearEndMonth };
}

/**
 * Check whether a valid ACRA date is later than the company's stored date.
 */
function acraDateIsLater(acraValue: string, current: Date | null): boolean {
  const acra = new Date(`${acraValue}T00:00:00.000Z`).getTime();
  if (Number.isNaN(acra)) return false;
  return !current || current.getTime() < acra;
}

/**
 * Propagate the freshly synced ACRA compliance dates to all companies.
 *
 * For every non-deleted company with a matching local ACRA record, the last
 * annual return date and accounts due date are updated from the ACRA record
 * when the ACRA value is later than the company's current value (or the
 * company value is missing). Values that are not real dates (e.g., "na") are
 * skipped.
 *
 * @returns The number of companies updated.
 */
export async function updateCompaniesFromAcraRecords(): Promise<number> {
  const companies = await prisma.company.findMany({
    where: { deletedAt: null },
    select: { id: true, uen: true, lastArFiledDate: true, accountsDueDate: true },
  });
  if (companies.length === 0) return 0;

  const records = await prisma.acraEntity.findMany({
    where: { uen: { in: companies.map((company) => company.uen.trim()), mode: 'insensitive' } },
    select: { uen: true, accountDueDate: true, annualReturnDate: true },
  });
  const recordByUen = new Map(
    records.map((record) => [record.uen.trim().toUpperCase(), record])
  );

  let updated = 0;
  for (const company of companies) {
    const record = recordByUen.get(company.uen.trim().toUpperCase());
    if (!record) continue;

    const data: { lastArFiledDate?: Date; accountsDueDate?: Date } = {};
    const annualReturnDate = normalizeAcraDate(record.annualReturnDate);
    if (annualReturnDate && acraDateIsLater(annualReturnDate, company.lastArFiledDate)) {
      data.lastArFiledDate = new Date(`${annualReturnDate}T00:00:00.000Z`);
    }
    const accountDueDate = normalizeAcraDate(record.accountDueDate);
    if (accountDueDate && acraDateIsLater(accountDueDate, company.accountsDueDate)) {
      data.accountsDueDate = new Date(`${accountDueDate}T00:00:00.000Z`);
    }
    if (Object.keys(data).length === 0) continue;

    await prisma.company.update({ where: { id: company.id }, data });
    updated += 1;
  }

  logger.info('Updated company compliance dates from ACRA records', { updated });
  return updated;
}
