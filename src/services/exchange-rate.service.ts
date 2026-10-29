/**
 * Exchange Rate Service
 *
 * Business logic for exchange rate management including:
 * - Syncing rates from MAS API (daily and monthly rates)
 * - CRUD operations for manual rates
 * - Rate lookup with fallback logic and tenant preference support
 * - Historical rate queries
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import type { ExchangeRate, ExchangeRateType } from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import {
  fetchLatestRates,
  fetchRatesForDateRange,
  fetchMonthlyEndOfPeriodRates,
  fetchLatestMonthlyRates,
  getPreviousMonth,
  type ParsedExchangeRate,
} from '@/lib/external/mas-api';
import type {
  CreateManualRateInput,
  UpdateRateInput,
  RateSearchInput,
  SupportedCurrency,
  RatePreference,
} from '@/lib/validations/exchange-rate';
import { createLogger } from '@/lib/logger';

const log = createLogger('exchange-rate-service');

// ============================================================================
// Types
// ============================================================================

export interface TenantAwareParams {
  tenantId?: string | null;
  userId: string;
  isSuperAdmin: boolean;
}

export interface ExchangeRateWithMetadata {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  rate: Prisma.Decimal;
  inverseRate: Prisma.Decimal | null;
  rateType: ExchangeRateType;
  rateDate: Date;
  isManualOverride: boolean;
  isSystemRate: boolean; // tenantId === null
  tenantId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RateLookupResult {
  rate: Prisma.Decimal;
  inverseRate: Prisma.Decimal;
  source: 'tenant_override' | 'system' | 'fallback';
  rateDate: Date;
  rateType: ExchangeRateType;
}

export interface SyncResult {
  success: boolean;
  ratesCreated: number;
  ratesUpdated: number;
  errors: string[];
  syncedAt: Date;
  source?: 'MAS_DAILY' | 'MAS_MONTHLY';
}

/**
 * Tenant settings structure for exchange rate preferences.
 */
export interface TenantExchangeRateSettings {
  preferredRateType?: RatePreference; // 'MONTHLY' | 'DAILY'
}

export interface PaginatedRates {
  rates: ExchangeRateWithMetadata[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ============================================================================
// Sync from MAS
// ============================================================================

/**
 * Sync exchange rates from MAS API.
 * Creates new system rates (tenantId = null) or updates existing ones.
 */
export async function syncFromMAS(): Promise<SyncResult> {
  const syncedAt = new Date();
  const errors: string[] = [];
  let ratesCreated = 0;
  let ratesUpdated = 0;

  log.info('Starting MAS exchange rate sync');

  try {
    // Fetch latest rates from MAS
    const masRates = await fetchLatestRates();

    if (masRates.length === 0) {
      log.warn('No rates returned from MAS API');
      return {
        success: false,
        ratesCreated: 0,
        ratesUpdated: 0,
        errors: ['No rates returned from MAS API'],
        syncedAt,
      };
    }

    // Process each rate
    for (const rate of masRates) {
      try {
        const result = await upsertSystemRate(rate);
        if (result.created) {
          ratesCreated++;
        } else {
          ratesUpdated++;
        }
      } catch (error) {
        const errMsg = `Failed to upsert ${rate.sourceCurrency}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        log.error(errMsg);
        errors.push(errMsg);
      }
    }

    // Audit log the sync operation
    await createAuditLog({
      action: 'EXCHANGE_RATE_SYNCED',
      entityType: 'ExchangeRate',
      entityId: 'MAS_SYNC',
      entityName: 'MAS Daily Rates',
      summary: `Synced ${ratesCreated + ratesUpdated} rates from MAS (${ratesCreated} new, ${ratesUpdated} updated)`,
      metadata: {
        ratesCreated,
        ratesUpdated,
        rateDate: masRates[0]?.rateDate?.toISOString(),
        errors: errors.length > 0 ? errors : undefined,
      },
      changeSource: 'SYSTEM',
    });

    log.info(`MAS sync complete: ${ratesCreated} created, ${ratesUpdated} updated, ${errors.length} errors`);

    return {
      success: errors.length === 0,
      ratesCreated,
      ratesUpdated,
      errors,
      syncedAt,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('MAS sync failed:', error);

    return {
      success: false,
      ratesCreated: 0,
      ratesUpdated: 0,
      errors: [errMsg],
      syncedAt,
    };
  }
}

/**
 * Upsert a system rate (tenantId = null) from MAS data.
 */
async function upsertSystemRate(
  rate: ParsedExchangeRate
): Promise<{ created: boolean }> {
  const rateDate = new Date(rate.rateDate);
  // Normalize to start of day in UTC
  rateDate.setUTCHours(0, 0, 0, 0);

  // Check if rate already exists
  const existing = await prisma.exchangeRate.findFirst({
    where: {
      tenantId: null,
      sourceCurrency: rate.sourceCurrency,
      targetCurrency: rate.targetCurrency,
      rateDate: rateDate,
      rateType: 'MAS_DAILY_RATE',
    },
  });

  if (existing) {
    // Update if rate changed
    const existingRate = existing.rate.toNumber();
    if (Math.abs(existingRate - rate.rate) > 0.00000001) {
      await prisma.exchangeRate.update({
        where: { id: existing.id },
        data: {
          rate: new Prisma.Decimal(rate.rate),
          inverseRate: new Prisma.Decimal(rate.inverseRate),
        },
      });
    }
    return { created: false };
  }

  // Create new rate
  await prisma.exchangeRate.create({
    data: {
      tenantId: null,
      sourceCurrency: rate.sourceCurrency,
      targetCurrency: rate.targetCurrency,
      rate: new Prisma.Decimal(rate.rate),
      inverseRate: new Prisma.Decimal(rate.inverseRate),
      rateType: 'MAS_DAILY_RATE',
      rateDate: rateDate,
      isManualOverride: false,
    },
  });

  return { created: true };
}

// ============================================================================
// Sync MAS Monthly End-of-Period Rates (New APIMG Gateway API)
// ============================================================================

/**
 * Sync monthly end-of-period exchange rates from new MAS APIMG Gateway API.
 * Creates new system rates (tenantId = null) or updates existing ones.
 *
 * @param targetMonth - Optional month in "YYYY-MM" format (e.g., "2025-11"). Defaults to latest.
 */
export async function syncMASMonthly(targetMonth?: string): Promise<SyncResult> {
  const syncedAt = new Date();
  const errors: string[] = [];
  let ratesCreated = 0;
  let ratesUpdated = 0;
  let fetchedMonth: string | undefined;
  let isFallback = false;

  log.info(`Starting MAS monthly rate sync${targetMonth ? ` for ${targetMonth}` : ' (latest)'}`);

  try {
    // Fetch rates from MAS APIMG Gateway API
    let masRates: ParsedExchangeRate[];

    if (targetMonth) {
      masRates = await fetchMonthlyEndOfPeriodRates(targetMonth);
      fetchedMonth = targetMonth;
    } else {
      const result = await fetchLatestMonthlyRates();
      masRates = result.rates;
      fetchedMonth = result.month;
      isFallback = result.isFallback;

      if (isFallback) {
        const expectedMonth = getPreviousMonth();
        const warningMsg = `Warning: Expected rates for ${expectedMonth} but got ${fetchedMonth} (MAS may not have published yet)`;
        log.warn(warningMsg);
        errors.push(warningMsg);
      }
    }

    if (masRates.length === 0) {
      log.warn('No rates returned from MAS Monthly API');
      return {
        success: false,
        ratesCreated: 0,
        ratesUpdated: 0,
        errors: ['No rates returned from MAS Monthly API'],
        syncedAt,
        source: 'MAS_MONTHLY',
      };
    }

    // Process each rate - store as MAS_DAILY_RATE type but with month-end date
    for (const rate of masRates) {
      try {
        const result = await upsertMASMonthlyRate(rate);
        if (result.created) {
          ratesCreated++;
        } else {
          ratesUpdated++;
        }
      } catch (error) {
        const errMsg = `Failed to upsert ${rate.sourceCurrency}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        log.error(errMsg);
        errors.push(errMsg);
      }
    }

    // Audit log the sync operation
    await createAuditLog({
      action: 'EXCHANGE_RATE_SYNCED',
      entityType: 'ExchangeRate',
      entityId: 'MAS_MONTHLY_SYNC',
      entityName: 'MAS Monthly End-of-Period Rates',
      summary: `Synced ${ratesCreated + ratesUpdated} monthly rates from MAS for ${fetchedMonth} (${ratesCreated} new, ${ratesUpdated} updated)${isFallback ? ' [fallback month]' : ''}`,
      metadata: {
        ratesCreated,
        ratesUpdated,
        month: fetchedMonth,
        isFallback,
        errors: errors.length > 0 ? errors : undefined,
      },
      changeSource: 'SYSTEM',
    });

    log.info(`MAS monthly sync complete for ${fetchedMonth}: ${ratesCreated} created, ${ratesUpdated} updated, ${errors.length} errors`);

    // Consider fallback a partial success (rates were synced, but not the expected month)
    return {
      success: !isFallback && errors.length === 0,
      ratesCreated,
      ratesUpdated,
      errors,
      syncedAt,
      source: 'MAS_MONTHLY',
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('MAS monthly sync failed:', error);

    return {
      success: false,
      ratesCreated: 0,
      ratesUpdated: 0,
      errors: [errMsg],
      syncedAt,
      source: 'MAS_MONTHLY',
    };
  }
}

/**
 * Upsert a monthly rate from MAS APIMG Gateway API.
 * MAS returns rates for the last day of the month (e.g., Nov 30).
 * We store them with the first day of the NEXT month (e.g., Dec 1) to make
 * lookups simpler: a document dated Nov 19 uses Nov 1 rate (which represents Oct's end-of-month rate).
 */
async function upsertMASMonthlyRate(
  rate: ParsedExchangeRate
): Promise<{ created: boolean }> {
  const originalDate = new Date(rate.rateDate);
  // Add 1 day to convert last day of month to first day of next month
  // e.g., Nov 30 → Dec 1, Oct 31 → Nov 1
  const rateDate = new Date(originalDate);
  rateDate.setUTCDate(rateDate.getUTCDate() + 1);
  rateDate.setUTCHours(0, 0, 0, 0);

  // Check if rate already exists
  const existing = await prisma.exchangeRate.findFirst({
    where: {
      tenantId: null,
      sourceCurrency: rate.sourceCurrency,
      targetCurrency: rate.targetCurrency,
      rateDate: rateDate,
      rateType: 'MAS_MONTHLY_RATE',
    },
  });

  if (existing) {
    // Update if rate changed
    const existingRate = existing.rate.toNumber();
    if (Math.abs(existingRate - rate.rate) > 0.00000001) {
      await prisma.exchangeRate.update({
        where: { id: existing.id },
        data: {
          rate: new Prisma.Decimal(rate.rate),
          inverseRate: new Prisma.Decimal(rate.inverseRate),
        },
      });
    }
    return { created: false };
  }

  // Create new rate
  await prisma.exchangeRate.create({
    data: {
      tenantId: null,
      sourceCurrency: rate.sourceCurrency,
      targetCurrency: rate.targetCurrency,
      rate: new Prisma.Decimal(rate.rate),
      inverseRate: new Prisma.Decimal(rate.inverseRate),
      rateType: 'MAS_MONTHLY_RATE',
      rateDate: rateDate,
      isManualOverride: false,
      sourceRef: `mas-monthly:${originalDate.toISOString().slice(0, 7)}`,
    },
  });

  return { created: true };
}

// ============================================================================
// Sync MAS with Date Range
// ============================================================================

/**
 * Sync MAS daily rates for a specific date range.
 *
 * @param startDate - Start date of range
 * @param endDate - End date of range
 */
export async function syncMASDateRange(startDate: Date, endDate: Date): Promise<SyncResult> {
  const syncedAt = new Date();
  const errors: string[] = [];
  let ratesCreated = 0;
  let ratesUpdated = 0;

  log.info(`Starting MAS date range sync from ${startDate.toISOString()} to ${endDate.toISOString()}`);

  try {
    // Fetch rates for date range from MAS
    const masRates = await fetchRatesForDateRange(startDate, endDate);

    if (masRates.length === 0) {
      log.warn('No rates returned from MAS API for date range');
      return {
        success: false,
        ratesCreated: 0,
        ratesUpdated: 0,
        errors: ['No rates returned from MAS API for date range'],
        syncedAt,
        source: 'MAS_DAILY',
      };
    }

    // Process each rate
    for (const rate of masRates) {
      try {
        const result = await upsertSystemRate(rate);
        if (result.created) {
          ratesCreated++;
        } else {
          ratesUpdated++;
        }
      } catch (error) {
        const errMsg = `Failed to upsert ${rate.sourceCurrency} for ${rate.rateDate.toISOString()}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        log.error(errMsg);
        errors.push(errMsg);
      }
    }

    // Audit log the sync operation
    await createAuditLog({
      action: 'EXCHANGE_RATE_SYNCED',
      entityType: 'ExchangeRate',
      entityId: 'MAS_RANGE_SYNC',
      entityName: 'MAS Daily Rates (Date Range)',
      summary: `Synced ${ratesCreated + ratesUpdated} rates from MAS for date range (${ratesCreated} new, ${ratesUpdated} updated)`,
      metadata: {
        ratesCreated,
        ratesUpdated,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        errors: errors.length > 0 ? errors : undefined,
      },
      changeSource: 'SYSTEM',
    });

    log.info(`MAS date range sync complete: ${ratesCreated} created, ${ratesUpdated} updated, ${errors.length} errors`);

    return {
      success: errors.length === 0,
      ratesCreated,
      ratesUpdated,
      errors,
      syncedAt,
      source: 'MAS_DAILY',
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('MAS date range sync failed:', error);

    return {
      success: false,
      ratesCreated: 0,
      ratesUpdated: 0,
      errors: [errMsg],
      syncedAt,
      source: 'MAS_DAILY',
    };
  }
}

// ============================================================================
// Tenant Rate Preference
// ============================================================================

/**
 * Get tenant's preferred rate type.
 * Returns 'MONTHLY' (default) or 'DAILY'.
 */
export async function getWorkspaceRatePreference(tenantId: string): Promise<RatePreference> {
  const tenant = await prisma.workspace.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });

  if (!tenant?.settings) {
    return 'MONTHLY'; // Default to monthly
  }

  const settings = tenant.settings as Record<string, unknown>;
  const exchangeRateSettings = settings.exchangeRate as TenantExchangeRateSettings | undefined;

  return exchangeRateSettings?.preferredRateType || 'MONTHLY';
}

/**
 * Update tenant's preferred rate type.
 */
export async function updateWorkspaceRatePreference(
  tenantId: string,
  preference: RatePreference
): Promise<void> {
  const tenant = await prisma.workspace.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });

  const currentSettings = (tenant?.settings as Record<string, unknown>) || {};
  const updatedSettings = {
    ...currentSettings,
    exchangeRate: {
      ...(currentSettings.exchangeRate as Record<string, unknown> || {}),
      preferredRateType: preference,
    },
  };

  await prisma.workspace.update({
    where: { id: tenantId },
    data: { settings: updatedSettings },
  });

  log.info(`Updated tenant ${tenantId} rate preference to ${preference}`);
}

// ============================================================================
// Rate Lookup
// ============================================================================

/**
 * Get exchange rate with tenant preference support.
 *
 * Priority:
 * 1. Tenant manual override for exact date
 * 2. System rate of tenant's preferred type (IRAS monthly or MAS daily)
 * 3. Fallback to any available system rate
 *
 * @param sourceCurrency - Source currency code (e.g., 'USD')
 * @param targetCurrency - Target currency code (default: 'SGD')
 * @param date - Date for the rate lookup
 * @param tenantId - Optional tenant ID for preference lookup
 */
export async function getRateWithPreference(
  sourceCurrency: SupportedCurrency,
  targetCurrency: SupportedCurrency = 'SGD',
  date: Date,
  tenantId?: string | null
): Promise<RateLookupResult | null> {
  // Normalize date to start of day
  const rateDate = new Date(date);
  rateDate.setUTCHours(0, 0, 0, 0);

  // 1. Check tenant manual override first
  if (tenantId) {
    const tenantRate = await prisma.exchangeRate.findFirst({
      where: {
        tenantId,
        sourceCurrency,
        targetCurrency,
        rateDate,
        isManualOverride: true,
      },
    });

    if (tenantRate) {
      return {
        rate: tenantRate.rate,
        inverseRate: tenantRate.inverseRate || new Prisma.Decimal(1).div(tenantRate.rate),
        source: 'tenant_override',
        rateDate: tenantRate.rateDate,
        rateType: tenantRate.rateType,
      };
    }
  }

  // 2. Get tenant's preferred rate type
  const preference = tenantId
    ? await getWorkspaceRatePreference(tenantId)
    : 'MONTHLY'; // Default to monthly

  // Determine lookup date and rate type based on preference
  let lookupDate = rateDate;
  let preferredRateType: ExchangeRateType;

  if (preference === 'MONTHLY') {
    // For monthly preference, use first day of the document's month
    // Monthly rates are stored as first day of month (e.g., Dec 1 for Nov's end-of-month rate)
    // A document dated Nov 19 → look for Nov 1 rate
    lookupDate = new Date(Date.UTC(rateDate.getUTCFullYear(), rateDate.getUTCMonth(), 1));
    preferredRateType = 'MAS_MONTHLY_RATE';
  } else {
    // For daily preference, use exact date
    preferredRateType = 'MAS_DAILY_RATE';
  }

  // 3. Look for system rate of preferred type
  const preferredRate = await prisma.exchangeRate.findFirst({
    where: {
      tenantId: null,
      sourceCurrency,
      targetCurrency,
      rateDate: lookupDate,
      rateType: preferredRateType,
    },
  });

  if (preferredRate) {
    return {
      rate: preferredRate.rate,
      inverseRate: preferredRate.inverseRate || new Prisma.Decimal(1).div(preferredRate.rate),
      source: 'system',
      rateDate: preferredRate.rateDate,
      rateType: preferredRate.rateType,
    };
  }

  // 4. Fallback to any system rate for the date
  const anyRate = await prisma.exchangeRate.findFirst({
    where: {
      tenantId: null,
      sourceCurrency,
      targetCurrency,
      rateDate: lookupDate,
    },
    orderBy: {
      rateType: 'asc', // Prefer IRAS > MAS > ECB > MANUAL
    },
  });

  if (anyRate) {
    return {
      rate: anyRate.rate,
      inverseRate: anyRate.inverseRate || new Prisma.Decimal(1).div(anyRate.rate),
      source: 'system',
      rateDate: anyRate.rateDate,
      rateType: anyRate.rateType,
    };
  }

  // 5. Fallback to most recent system rate of preferred type
  const latestPreferred = await prisma.exchangeRate.findFirst({
    where: {
      tenantId: null,
      sourceCurrency,
      targetCurrency,
      rateDate: { lte: lookupDate },
      rateType: preferredRateType,
    },
    orderBy: {
      rateDate: 'desc',
    },
  });

  if (latestPreferred) {
    return {
      rate: latestPreferred.rate,
      inverseRate: latestPreferred.inverseRate || new Prisma.Decimal(1).div(latestPreferred.rate),
      source: 'fallback',
      rateDate: latestPreferred.rateDate,
      rateType: latestPreferred.rateType,
    };
  }

  // 6. Final fallback to any most recent system rate
  const latestAny = await prisma.exchangeRate.findFirst({
    where: {
      tenantId: null,
      sourceCurrency,
      targetCurrency,
      rateDate: { lte: rateDate },
    },
    orderBy: {
      rateDate: 'desc',
    },
  });

  if (latestAny) {
    return {
      rate: latestAny.rate,
      inverseRate: latestAny.inverseRate || new Prisma.Decimal(1).div(latestAny.rate),
      source: 'fallback',
      rateDate: latestAny.rateDate,
      rateType: latestAny.rateType,
    };
  }

  return null;
}

/**
 * Get exchange rate with fallback logic (legacy function without preference).
 *
 * Priority:
 * 1. Tenant override (if tenantId provided)
 * 2. System rate for exact date
 * 3. Fallback to most recent system rate
 */
export async function getRate(
  sourceCurrency: SupportedCurrency,
  targetCurrency: SupportedCurrency = 'SGD',
  date: Date,
  tenantId?: string | null
): Promise<RateLookupResult | null> {
  // Normalize date to start of day
  const rateDate = new Date(date);
  rateDate.setUTCHours(0, 0, 0, 0);

  // 1. Check tenant override
  if (tenantId) {
    const tenantRate = await prisma.exchangeRate.findFirst({
      where: {
        tenantId,
        sourceCurrency,
        targetCurrency,
        rateDate,
        isManualOverride: true,
      },
    });

    if (tenantRate) {
      return {
        rate: tenantRate.rate,
        inverseRate: tenantRate.inverseRate || new Prisma.Decimal(1).div(tenantRate.rate),
        source: 'tenant_override',
        rateDate: tenantRate.rateDate,
        rateType: tenantRate.rateType,
      };
    }
  }

  // 2. Check system rate for exact date
  const systemRate = await prisma.exchangeRate.findFirst({
    where: {
      tenantId: null,
      sourceCurrency,
      targetCurrency,
      rateDate,
    },
    orderBy: {
      rateType: 'asc', // Prefer MAS_DAILY_RATE over MANUAL_RATE
    },
  });

  if (systemRate) {
    return {
      rate: systemRate.rate,
      inverseRate: systemRate.inverseRate || new Prisma.Decimal(1).div(systemRate.rate),
      source: 'system',
      rateDate: systemRate.rateDate,
      rateType: systemRate.rateType,
    };
  }

  // 3. Fallback to most recent system rate
  const latestRate = await prisma.exchangeRate.findFirst({
    where: {
      tenantId: null,
      sourceCurrency,
      targetCurrency,
      rateDate: { lte: rateDate },
    },
    orderBy: {
      rateDate: 'desc',
    },
  });

  if (latestRate) {
    return {
      rate: latestRate.rate,
      inverseRate: latestRate.inverseRate || new Prisma.Decimal(1).div(latestRate.rate),
      source: 'fallback',
      rateDate: latestRate.rateDate,
      rateType: latestRate.rateType,
    };
  }

  return null;
}

// ============================================================================
// Query Rates
// ============================================================================

/**
 * Get current rates (latest available for each currency).
 */
export async function getCurrentRates(
  tenantId?: string | null
): Promise<ExchangeRateWithMetadata[]> {
  // Get the latest rate date
  const latestRate = await prisma.exchangeRate.findFirst({
    where: { tenantId: null },
    orderBy: { rateDate: 'desc' },
    select: { rateDate: true },
  });

  if (!latestRate) {
    return [];
  }

  // Get all rates for the latest date
  const rates = await prisma.exchangeRate.findMany({
    where: {
      OR: [
        { tenantId: null }, // System rates
        ...(tenantId ? [{ tenantId }] : []), // Tenant rates if specified
      ],
      rateDate: latestRate.rateDate,
    },
    orderBy: [{ sourceCurrency: 'asc' }],
  });

  return rates.map(mapToMetadata);
}

/**
 * Search rates with filters and pagination.
 */
export async function searchRates(
  params: RateSearchInput,
  WorkspaceContext?: { tenantId?: string; isSuperAdmin?: boolean }
): Promise<PaginatedRates> {
  const { page, limit, sourceCurrency, startDate, endDate, source, includeSystem, tenantId, sortBy, sortOrder } =
    params;
  const skip = (page - 1) * limit;

  // Build where clause
  const where: Prisma.ExchangeRateWhereInput = {};

  // Scope filtering
  const scopeConditions: Prisma.ExchangeRateWhereInput[] = [];

  if (includeSystem) {
    scopeConditions.push({ tenantId: null });
  }

  if (tenantId) {
    scopeConditions.push({ tenantId });
  } else if (WorkspaceContext?.tenantId && !WorkspaceContext.isSuperAdmin) {
    // Non-super admin can only see their tenant + system
    scopeConditions.push({ tenantId: WorkspaceContext.tenantId });
  }

  if (scopeConditions.length > 0) {
    where.OR = scopeConditions;
  }

  // Currency filter
  if (sourceCurrency) {
    where.sourceCurrency = sourceCurrency;
  }

  // Date range filter
  if (startDate || endDate) {
    where.rateDate = {};
    if (startDate) where.rateDate.gte = startDate;
    if (endDate) where.rateDate.lte = endDate;
  }

  // Source filter
  if (source !== 'ALL') {
    // Map to ExchangeRateType enum values
    const typeMap: Record<string, ExchangeRateType> = {
      'MAS_DAILY': 'MAS_DAILY_RATE',
      'MAS_MONTHLY': 'MAS_MONTHLY_RATE',
      'MANUAL': 'MANUAL_RATE',
    };
    where.rateType = typeMap[source] || (source as ExchangeRateType);
  }

  // Build orderBy clause
  const orderBy: Prisma.ExchangeRateOrderByWithRelationInput[] = [];
  if (sortBy) {
    orderBy.push({ [sortBy]: sortOrder || 'desc' });
  }
  // Secondary sort by sourceCurrency for consistency
  if (sortBy !== 'sourceCurrency') {
    orderBy.push({ sourceCurrency: 'asc' });
  }

  // Execute query
  const [rates, total] = await Promise.all([
    prisma.exchangeRate.findMany({
      where,
      skip,
      take: limit,
      orderBy,
    }),
    prisma.exchangeRate.count({ where }),
  ]);

  return {
    rates: rates.map(mapToMetadata),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

// ============================================================================
// Manual Rate CRUD
// ============================================================================

/**
 * Create a manual exchange rate override.
 */
export async function createManualRate(
  data: CreateManualRateInput,
  params: TenantAwareParams
): Promise<ExchangeRate> {
  const { userId, isSuperAdmin } = params;

  // Only SUPER_ADMIN can create system rates (tenantId = null)
  if (data.tenantId === null && !isSuperAdmin) {
    throw new Error('Only super admins can create system rates');
  }

  // Check for duplicate
  const existing = await prisma.exchangeRate.findFirst({
    where: {
      tenantId: data.tenantId ?? null,
      sourceCurrency: data.sourceCurrency,
      targetCurrency: data.targetCurrency,
      rateDate: data.rateDate,
      rateType: 'MANUAL_RATE',
    },
  });

  if (existing) {
    throw new Error(
      `A manual rate for ${data.sourceCurrency}/${data.targetCurrency} on this date already exists`
    );
  }

  // Calculate inverse rate
  const inverseRate = 1 / data.rate;

  const rate = await prisma.exchangeRate.create({
    data: {
      tenantId: data.tenantId ?? null,
      sourceCurrency: data.sourceCurrency,
      targetCurrency: data.targetCurrency,
      rate: new Prisma.Decimal(data.rate),
      inverseRate: new Prisma.Decimal(inverseRate),
      rateType: 'MANUAL_RATE',
      rateDate: data.rateDate,
      isManualOverride: true,
      manualReason: data.reason,
      createdById: userId,
    },
  });

  // Audit log
  await createAuditLog({
    tenantId: data.tenantId ?? undefined,
    userId,
    action: 'EXCHANGE_RATE_CREATED',
    entityType: 'ExchangeRate',
    entityId: rate.id,
    entityName: `${data.sourceCurrency}/${data.targetCurrency}`,
    summary: `Created manual rate ${data.sourceCurrency}/${data.targetCurrency} = ${data.rate}`,
    metadata: {
      sourceCurrency: data.sourceCurrency,
      targetCurrency: data.targetCurrency,
      rate: data.rate,
      rateDate: data.rateDate.toISOString(),
      reason: data.reason,
    },
    changeSource: 'MANUAL',
  });

  log.info(`Created manual rate: ${data.sourceCurrency}/${data.targetCurrency} = ${data.rate}`);

  return rate;
}

/**
 * Update an existing exchange rate.
 */
export async function updateRate(
  id: string,
  data: UpdateRateInput,
  params: TenantAwareParams
): Promise<ExchangeRate> {
  const { userId, isSuperAdmin } = params;

  const existing = await prisma.exchangeRate.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new Error('Exchange rate not found');
  }

  // Only SUPER_ADMIN can modify system rates
  if (existing.tenantId === null && !isSuperAdmin) {
    throw new Error('Only super admins can modify system rates');
  }

  // Only allow updating manual rates
  if (!existing.isManualOverride) {
    throw new Error('Cannot modify MAS rates. Create a manual override instead.');
  }

  const updateData: Prisma.ExchangeRateUpdateInput = {};

  if (data.rate !== undefined) {
    updateData.rate = new Prisma.Decimal(data.rate);
    updateData.inverseRate = new Prisma.Decimal(1 / data.rate);
  }

  if (data.reason !== undefined) {
    updateData.manualReason = data.reason;
  }

  const updated = await prisma.exchangeRate.update({
    where: { id },
    data: updateData,
  });

  // Audit log with proper changes format
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  if (data.rate !== undefined) {
    changes.rate = { old: existing.rate.toString(), new: data.rate.toString() };
  }
  if (data.reason !== undefined) {
    changes.reason = { old: existing.manualReason, new: data.reason };
  }

  await createAuditLog({
    tenantId: existing.tenantId ?? undefined,
    userId,
    action: 'EXCHANGE_RATE_UPDATED',
    entityType: 'ExchangeRate',
    entityId: id,
    entityName: `${existing.sourceCurrency}/${existing.targetCurrency}`,
    summary: `Updated rate ${existing.sourceCurrency}/${existing.targetCurrency}`,
    changes,
    changeSource: 'MANUAL',
  });

  return updated;
}

/**
 * Delete an exchange rate.
 */
export async function deleteRate(
  id: string,
  params: TenantAwareParams,
  reason: string
): Promise<void> {
  const { userId, isSuperAdmin } = params;

  const existing = await prisma.exchangeRate.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new Error('Exchange rate not found');
  }

  // Only SUPER_ADMIN can delete system rates
  if (existing.tenantId === null && !isSuperAdmin) {
    throw new Error('Only super admins can delete system rates');
  }

  // Delete the rate
  await prisma.exchangeRate.delete({
    where: { id },
  });

  // Audit log
  await createAuditLog({
    tenantId: existing.tenantId ?? undefined,
    userId,
    action: 'EXCHANGE_RATE_DELETED',
    entityType: 'ExchangeRate',
    entityId: id,
    entityName: `${existing.sourceCurrency}/${existing.targetCurrency}`,
    summary: `Deleted rate ${existing.sourceCurrency}/${existing.targetCurrency}`,
    reason,
    metadata: {
      sourceCurrency: existing.sourceCurrency,
      targetCurrency: existing.targetCurrency,
      rate: existing.rate.toString(),
      rateDate: existing.rateDate.toISOString(),
    },
    changeSource: 'MANUAL',
  });

  log.info(`Deleted rate: ${existing.sourceCurrency}/${existing.targetCurrency}`);
}

/**
 * Get a single rate by ID.
 */
export async function getRateById(
  id: string,
  params?: TenantAwareParams
): Promise<ExchangeRateWithMetadata | null> {
  const rate = await prisma.exchangeRate.findUnique({
    where: { id },
  });

  if (!rate) return null;

  // Access control
  if (params && !params.isSuperAdmin && rate.tenantId !== null && rate.tenantId !== params.tenantId) {
    throw new Error('Access denied');
  }

  return mapToMetadata(rate);
}

// ============================================================================
// Helpers
// ============================================================================

function mapToMetadata(rate: ExchangeRate): ExchangeRateWithMetadata {
  return {
    id: rate.id,
    sourceCurrency: rate.sourceCurrency,
    targetCurrency: rate.targetCurrency,
    rate: rate.rate,
    inverseRate: rate.inverseRate,
    rateType: rate.rateType,
    rateDate: rate.rateDate,
    isManualOverride: rate.isManualOverride,
    isSystemRate: rate.tenantId === null,
    tenantId: rate.tenantId,
    createdAt: rate.createdAt,
    updatedAt: rate.updatedAt,
  };
}

// ============================================================================
// Home Currency Conversion Helpers (Phase 2)
// ============================================================================

/**
 * Convert an amount to home currency with 2 decimal place precision.
 * Uses standard rounding (half-up).
 */
export function convertToHomeCurrency(amount: number, rate: number): number {
  return Math.round(amount * rate * 100) / 100;
}

/**
 * Input type for line item conversion
 */
export interface LineItemForConversion {
  amount: number;
  gstAmount: number | null;
  isHomeAmountOverride?: boolean;
  homeAmount?: number | null;
  isHomeGstOverride?: boolean;
  homeGstAmount?: number | null;
}

/**
 * Result type for line item conversion
 */
export interface ConvertedLineItem {
  homeAmount: number;
  homeGstAmount: number | null;
}

/**
 * Convert line items to home currency with rounding adjustment.
 *
 * The rounding adjustment ensures the sum of line item home amounts
 * exactly equals the header home total. Any rounding difference
 * is pushed to the first non-overridden line item.
 *
 * @param lineItems - Array of line items to convert
 * @param rate - Exchange rate to apply
 * @param headerHomeTotal - Expected home currency total (from header)
 * @returns Array of converted line items with homeAmount and homeGstAmount
 */
export function convertLineItemsWithRounding(
  lineItems: LineItemForConversion[],
  rate: number,
  headerHomeTotal: number
): ConvertedLineItem[] {
  if (lineItems.length === 0) {
    return [];
  }

  // Step 1: Convert each line item (respecting manual overrides)
  const converted = lineItems.map((item) => {
    // If manually overridden, use existing value
    const homeAmount = item.isHomeAmountOverride && item.homeAmount != null
      ? item.homeAmount
      : convertToHomeCurrency(item.amount, rate);

    const homeGstAmount = item.isHomeGstOverride && item.homeGstAmount != null
      ? item.homeGstAmount
      : item.gstAmount != null
        ? convertToHomeCurrency(item.gstAmount, rate)
        : null;

    return { homeAmount, homeGstAmount };
  });

  // Step 2: Calculate sum of converted line items (amount + gst)
  const sumOfLines = converted.reduce((sum, item) => {
    return sum + item.homeAmount + (item.homeGstAmount || 0);
  }, 0);

  // Step 3: Calculate rounding difference
  const roundingDiff = Math.round((headerHomeTotal - sumOfLines) * 100) / 100;

  // Step 4: Apply adjustment to first non-overridden line item
  if (roundingDiff !== 0) {
    // Find first line item that wasn't manually overridden
    const firstNonOverrideIndex = lineItems.findIndex(
      (item) => !item.isHomeAmountOverride
    );

    if (firstNonOverrideIndex >= 0) {
      converted[firstNonOverrideIndex].homeAmount =
        Math.round((converted[firstNonOverrideIndex].homeAmount + roundingDiff) * 100) / 100;
    }
  }

  return converted;
}

/**
 * Calculate home currency header amounts from document currency amounts.
 */
export function calculateHomeHeaderAmounts(
  subtotal: number | null,
  taxAmount: number | null,
  totalAmount: number,
  rate: number
): {
  homeSubtotal: number | null;
  homeTaxAmount: number | null;
  homeTotal: number;
} {
  return {
    homeSubtotal: subtotal != null ? convertToHomeCurrency(subtotal, rate) : null,
    homeTaxAmount: taxAmount != null ? convertToHomeCurrency(taxAmount, rate) : null,
    homeTotal: convertToHomeCurrency(totalAmount, rate),
  };
}
