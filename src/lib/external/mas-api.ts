/**
 * MAS Exchange Rate API Client
 *
 * Fetches exchange rates from the Monetary Authority of Singapore (MAS).
 *
 * API Sources:
 * 1. Monthly End-of-Period Rates (New APIMG Gateway API)
 *    - Endpoint: https://eservices.mas.gov.sg/apimg-gw/server/monthly_statistical_bulletin_non610ora/exchange_rates_end_of_period_monthly
 *    - Requires API Key via KeyId header
 *
 * 2. Daily End-of-Period Rates (New APIMG Gateway API) - pending implementation
 *
 * Key features:
 * - Fetches monthly end-of-period exchange rates against SGD
 * - Handles rate divisors (e.g., JPY/100, CNY/100)
 * - Supports month-specific queries
 * - Requires API key (configured via environment variable)
 */

import { createLogger } from '@/lib/logger';
import type { SupportedCurrency } from '@/lib/validations/exchange-rate';

const log = createLogger('mas-api');

// ============================================================================
// CONSTANTS
// ============================================================================

// New APIMG Gateway endpoints
const MAS_MONTHLY_API_BASE =
  'https://eservices.mas.gov.sg/apimg-gw/server/monthly_statistical_bulletin_non610ora/exchange_rates_end_of_period_monthly/views/exchange_rates_end_of_period_monthly';

const MAS_DAILY_API_BASE =
  'https://eservices.mas.gov.sg/apimg-gw/server/monthly_statistical_bulletin_non610ora/exchange_rates_end_of_period_daily/views/exchange_rates_end_of_period_daily';

// API Keys - should be stored in environment variables in production
// IMPORTANT: These API keys expire on December 26, 2026. Renew before expiry!
const MAS_MONTHLY_API_KEY = process.env.MAS_MONTHLY_API_KEY || '81071805-887e-4b31-b307-debe86a7fc25';
const MAS_DAILY_API_KEY = process.env.MAS_DAILY_API_KEY || '5d724c5d-fbc6-4f86-8865-b1717104db4e';

// API Key expiry date - used to warn admins before expiry
export const MAS_API_KEY_EXPIRY = new Date('2026-12-26');

/**
 * Check if MAS API keys are expiring soon (within 30 days).
 */
export function isMASApiKeyExpiringSoon(): boolean {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return thirtyDaysFromNow >= MAS_API_KEY_EXPIRY;
}

/**
 * Get days until MAS API key expires.
 */
export function getDaysUntilMASApiKeyExpiry(): number {
  const now = new Date();
  const diffMs = MAS_API_KEY_EXPIRY.getTime() - now.getTime();
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

// Legacy API (deprecated, may not be available)
const MAS_LEGACY_API_BASE = 'https://eservices.mas.gov.sg/api/action/datastore/search.json';
const MAS_DAILY_RATES_RESOURCE_ID = '95932927-c8bc-4e7a-b484-68a66a24edfe';

/**
 * Mapping of MAS API field names to currency codes and divisors.
 * New API uses slightly different field names (e.g., cny_sgd_100 instead of cny_100_sgd)
 */
export const MAS_CURRENCY_MAP: Record<string, { code: SupportedCurrency; divisor: number }> = {
  // Direct rates (per 1 unit)
  usd_sgd: { code: 'USD', divisor: 1 },
  eur_sgd: { code: 'EUR', divisor: 1 },
  gbp_sgd: { code: 'GBP', divisor: 1 },
  aud_sgd: { code: 'AUD', divisor: 1 },
  nzd_sgd: { code: 'NZD', divisor: 1 },
  chf_sgd: { code: 'CHF', divisor: 1 },
  cad_sgd: { code: 'CAD', divisor: 1 },
  // Rates per 100 units (new API format: xxx_sgd_100)
  jpy_sgd_100: { code: 'JPY', divisor: 100 },
  cny_sgd_100: { code: 'CNY', divisor: 100 },
  hkd_sgd_100: { code: 'HKD', divisor: 100 },
  inr_sgd_100: { code: 'INR', divisor: 100 },
  idr_sgd_100: { code: 'IDR', divisor: 100 },
  krw_sgd_100: { code: 'KRW', divisor: 100 },
  myr_sgd_100: { code: 'MYR', divisor: 100 },
  php_sgd_100: { code: 'PHP', divisor: 100 },
  qar_sgd_100: { code: 'QAR', divisor: 100 },
  sar_sgd_100: { code: 'SAR', divisor: 100 },
  twd_sgd_100: { code: 'TWD', divisor: 100 },
  thb_sgd_100: { code: 'THB', divisor: 100 },
  aed_sgd_100: { code: 'AED', divisor: 100 },
  vnd_sgd_100: { code: 'VND', divisor: 100 },
  // Legacy field names (for backward compatibility with old API)
  jpy_100_sgd: { code: 'JPY', divisor: 100 },
  cny_100_sgd: { code: 'CNY', divisor: 100 },
  hkd_100_sgd: { code: 'HKD', divisor: 100 },
  inr_100_sgd: { code: 'INR', divisor: 100 },
  idr_100_sgd: { code: 'IDR', divisor: 100 },
  krw_100_sgd: { code: 'KRW', divisor: 100 },
  myr_100_sgd: { code: 'MYR', divisor: 100 },
  php_100_sgd: { code: 'PHP', divisor: 100 },
  qar_100_sgd: { code: 'QAR', divisor: 100 },
  sar_100_sgd: { code: 'SAR', divisor: 100 },
  twd_100_sgd: { code: 'TWD', divisor: 100 },
  thb_100_sgd: { code: 'THB', divisor: 100 },
  aed_100_sgd: { code: 'AED', divisor: 100 },
  vnd_100_sgd: { code: 'VND', divisor: 100 },
};

// ============================================================================
// TYPES
// ============================================================================

/**
 * Response from new MAS APIMG Gateway API (monthly rates).
 */
export interface MASMonthlyApiResponse {
  name: string;
  elements: MASMonthlyRateRecord[];
}

/**
 * Monthly exchange rate record from new MAS API.
 */
export interface MASMonthlyRateRecord {
  end_of_month: string; // Format: "2025-11"
  preliminary: string; // "0" (final) or "1" (preliminary)
  [key: string]: string | undefined; // Currency rate fields
}

/**
 * Legacy response from old MAS API.
 */
export interface MASApiResponse {
  success: boolean;
  result: {
    resource_id: string;
    fields: Array<{ type: string; id: string }>;
    records: MASExchangeRateRecord[];
    total: number;
    _links?: {
      start: string;
      next?: string;
    };
  };
}

/**
 * Raw exchange rate record from legacy MAS API.
 */
export interface MASExchangeRateRecord {
  end_of_day: string; // Date in YYYY-MM-DD format
  preliminary: string; // "0" (final) or "1" (preliminary)
  timestamp: string; // Last updated timestamp
  [key: string]: string | undefined; // Currency rate fields
}

/**
 * Parsed exchange rate ready for database storage.
 */
export interface ParsedExchangeRate {
  sourceCurrency: SupportedCurrency;
  targetCurrency: 'SGD';
  rate: number; // Rate per 1 unit of source currency
  inverseRate: number; // 1/rate
  rateDate: Date;
  isPreliminary: boolean;
}

// ============================================================================
// NEW API FUNCTIONS (APIMG Gateway)
// ============================================================================

/**
 * Fetch monthly end-of-period exchange rates from new MAS APIMG Gateway API.
 *
 * @param month - The month to fetch rates for in YYYY-MM format (e.g., "2025-11")
 * @returns Array of parsed exchange rates
 */
export async function fetchMonthlyEndOfPeriodRates(month?: string): Promise<ParsedExchangeRate[]> {
  // Default to previous month if not specified
  const targetMonth = month || getPreviousMonth();

  log.debug(`Fetching MAS monthly end-of-period rates for ${targetMonth}`);

  try {
    const url = `${MAS_MONTHLY_API_BASE}?end_of_month=${targetMonth}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json; charset=UTF-8',
        KeyId: MAS_MONTHLY_API_KEY,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      log.error(`MAS Monthly API error response: ${text}`);
      throw new Error(`MAS Monthly API returned ${response.status}: ${response.statusText}`);
    }

    const data: MASMonthlyApiResponse = await response.json();

    if (!data.elements || data.elements.length === 0) {
      log.warn(`No rates found for month ${targetMonth}`);
      return [];
    }

    const record = data.elements[0];
    const rates = parseMonthlyRateRecord(record);

    log.info(`Fetched ${rates.length} monthly rates for ${targetMonth}`);
    return rates;
  } catch (error) {
    log.error('Failed to fetch MAS monthly rates:', error);
    throw error;
  }
}

/**
 * Result from fetching latest monthly rates, includes the month that was actually fetched.
 */
export interface LatestMonthlyRatesResult {
  rates: ParsedExchangeRate[];
  month: string;
  isFallback: boolean;
}

/**
 * Fetch the latest available monthly rates from MAS.
 * Tries previous month first, then falls back to two months ago.
 *
 * @returns Object containing rates, the month fetched, and whether it's a fallback
 */
export async function fetchLatestMonthlyRates(): Promise<LatestMonthlyRatesResult> {
  log.debug('Fetching latest MAS monthly rates');

  // Try previous month first (most likely to be available)
  const prevMonth = getPreviousMonth();
  try {
    const rates = await fetchMonthlyEndOfPeriodRates(prevMonth);
    if (rates.length > 0) {
      log.info(`Successfully fetched ${rates.length} rates for ${prevMonth}`);
      return { rates, month: prevMonth, isFallback: false };
    }
    log.warn(`No rates returned for ${prevMonth} (expected month), trying earlier month`);
  } catch (error) {
    log.warn(`Failed to fetch rates for ${prevMonth}: ${error}`);
  }

  // Try two months ago as fallback
  const twoMonthsAgo = getPreviousMonth(2);
  try {
    const rates = await fetchMonthlyEndOfPeriodRates(twoMonthsAgo);
    log.info(`Fetched ${rates.length} fallback rates for ${twoMonthsAgo} (expected ${prevMonth})`);
    return { rates, month: twoMonthsAgo, isFallback: true };
  } catch (error) {
    log.error(`Failed to fetch fallback rates for ${twoMonthsAgo}: ${error}`);
    throw error;
  }
}

/**
 * Fetch monthly rates for a range of months.
 *
 * @param startMonth - Start month in YYYY-MM format
 * @param endMonth - End month in YYYY-MM format
 * @returns Array of parsed exchange rates for all months in range
 */
export async function fetchMonthlyRatesForRange(
  startMonth: string,
  endMonth: string
): Promise<ParsedExchangeRate[]> {
  log.debug(`Fetching MAS monthly rates from ${startMonth} to ${endMonth}`);

  const months = getMonthRange(startMonth, endMonth);
  const allRates: ParsedExchangeRate[] = [];

  for (const month of months) {
    try {
      const rates = await fetchMonthlyEndOfPeriodRates(month);
      allRates.push(...rates);
    } catch (error) {
      log.warn(`Failed to fetch rates for ${month}: ${error}`);
    }
  }

  log.info(`Fetched ${allRates.length} rates for ${months.length} months`);
  return allRates;
}

// ============================================================================
// NEW DAILY API FUNCTIONS (APIMG Gateway)
// ============================================================================

/**
 * Response from new MAS APIMG Gateway API (daily rates).
 */
export interface MASDailyApiResponse {
  name: string;
  elements: MASDailyRateRecord[];
}

/**
 * Daily exchange rate record from new MAS API.
 */
export interface MASDailyRateRecord {
  end_of_day: string; // Format: "2025-12-24"
  preliminary: string; // "0" (final) or "1" (preliminary)
  [key: string]: string | undefined; // Currency rate fields
}

/**
 * Fetch daily end-of-period exchange rates from new MAS APIMG Gateway API.
 *
 * @param date - The date to fetch rates for (defaults to yesterday)
 * @returns Array of parsed exchange rates
 */
export async function fetchDailyRates(date?: Date): Promise<ParsedExchangeRate[]> {
  // Default to yesterday if not specified (today's rates may not be available yet)
  const targetDate = date || getYesterday();
  const dateStr = formatDateForMAS(targetDate);

  log.debug(`Fetching MAS daily rates for ${dateStr}`);

  try {
    const url = `${MAS_DAILY_API_BASE}?end_of_day=${dateStr}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json; charset=UTF-8',
        KeyId: MAS_DAILY_API_KEY,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      log.error(`MAS Daily API error response: ${text}`);
      throw new Error(`MAS Daily API returned ${response.status}: ${response.statusText}`);
    }

    const data: MASDailyApiResponse = await response.json();

    if (!data.elements || data.elements.length === 0) {
      log.warn(`No daily rates found for date ${dateStr}`);
      return [];
    }

    const record = data.elements[0];
    const rates = parseDailyRateRecord(record);

    log.info(`Fetched ${rates.length} daily rates for ${dateStr}`);
    return rates;
  } catch (error) {
    log.error('Failed to fetch MAS daily rates:', error);
    throw error;
  }
}

/**
 * Fetch the latest available daily rates from MAS.
 * Tries yesterday first, then falls back to earlier dates.
 *
 * @returns Array of parsed exchange rates
 */
export async function fetchLatestRates(): Promise<ParsedExchangeRate[]> {
  log.debug('Fetching latest MAS daily rates');

  // Try yesterday first
  const yesterday = getYesterday();
  try {
    const rates = await fetchDailyRates(yesterday);
    if (rates.length > 0) {
      return rates;
    }
  } catch {
    log.warn(`Failed to fetch rates for yesterday, trying earlier dates`);
  }

  // Try 2 days ago as fallback (for weekends/holidays)
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  try {
    const rates = await fetchDailyRates(twoDaysAgo);
    if (rates.length > 0) {
      return rates;
    }
  } catch {
    log.warn(`Failed to fetch rates for 2 days ago`);
  }

  // Try 3 days ago as final fallback
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  return fetchDailyRates(threeDaysAgo);
}

/**
 * Fetch daily rates for a date range from new MAS APIMG Gateway API.
 *
 * @param startDate - Start of date range
 * @param endDate - End of date range
 * @returns Array of parsed exchange rates for all dates in range
 */
export async function fetchRatesForDateRange(
  startDate: Date,
  endDate: Date
): Promise<ParsedExchangeRate[]> {
  log.debug(`Fetching MAS daily rates from ${formatDateForMAS(startDate)} to ${formatDateForMAS(endDate)}`);

  const allRates: ParsedExchangeRate[] = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    try {
      const rates = await fetchDailyRates(currentDate);
      allRates.push(...rates);
    } catch {
      // Skip dates with no data (weekends/holidays)
      log.debug(`No rates for ${formatDateForMAS(currentDate)}, skipping`);
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  log.info(`Fetched ${allRates.length} rates for date range`);
  return allRates;
}

/**
 * Parse a daily rate record from new MAS API.
 */
function parseDailyRateRecord(record: MASDailyRateRecord): ParsedExchangeRate[] {
  const rates: ParsedExchangeRate[] = [];
  const rateDate = new Date(record.end_of_day);
  const isPreliminary = record.preliminary === '1';

  const addedCurrencies = new Set<string>();

  for (const [field, config] of Object.entries(MAS_CURRENCY_MAP)) {
    const rawValue = record[field];

    if (!rawValue || rawValue === '' || rawValue === '-') {
      continue;
    }

    if (addedCurrencies.has(config.code)) {
      continue;
    }

    const parsedValue = parseFloat(rawValue);
    if (isNaN(parsedValue) || parsedValue <= 0) {
      log.warn(`Invalid rate value for ${field}: ${rawValue}`);
      continue;
    }

    const rate = parsedValue / config.divisor;
    const inverseRate = 1 / rate;

    rates.push({
      sourceCurrency: config.code,
      targetCurrency: 'SGD',
      rate,
      inverseRate,
      rateDate,
      isPreliminary,
    });

    addedCurrencies.add(config.code);
  }

  return rates;
}

// ============================================================================
// LEGACY API FUNCTIONS (deprecated - kept for reference)
// ============================================================================

/**
 * @deprecated Use fetchDailyRates instead. Legacy API may not be available.
 */
export async function fetchDailyRatesLegacy(date?: Date): Promise<ParsedExchangeRate[]> {
  const targetDate = date || new Date();
  const dateStr = formatDateForMAS(targetDate);

  log.debug(`Fetching MAS daily rates for ${dateStr} (legacy API)`);

  try {
    const url = buildLegacyMASUrl({
      filters: JSON.stringify({ end_of_day: dateStr }),
      limit: 1,
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`MAS Legacy API returned ${response.status}: ${response.statusText}`);
    }

    const data: MASApiResponse = await response.json();

    if (!data.success) {
      throw new Error('MAS Legacy API returned success: false');
    }

    if (!data.result.records || data.result.records.length === 0) {
      log.warn(`No rates found for date ${dateStr}`);
      return [];
    }

    const record = data.result.records[0];
    const rates = parseLegacyExchangeRateRecord(record);

    log.info(`Fetched ${rates.length} rates for ${dateStr}`);
    return rates;
  } catch (error) {
    log.error('Failed to fetch MAS daily rates (legacy):', error);
    throw error;
  }
}

/**
 * @deprecated Use fetchLatestRates instead. Legacy API may not be available.
 */
export async function fetchLatestRatesLegacy(): Promise<ParsedExchangeRate[]> {
  log.debug('Fetching latest MAS rates (legacy API)');

  try {
    const url = buildLegacyMASUrl({
      sort: 'end_of_day desc',
      limit: 1,
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`MAS Legacy API returned ${response.status}: ${response.statusText}`);
    }

    const data: MASApiResponse = await response.json();

    if (!data.success) {
      throw new Error('MAS Legacy API returned success: false');
    }

    if (!data.result.records || data.result.records.length === 0) {
      log.warn('No rates found in MAS Legacy API');
      return [];
    }

    const record = data.result.records[0];
    const rates = parseLegacyExchangeRateRecord(record);

    log.info(`Fetched ${rates.length} latest rates (legacy - date: ${record.end_of_day})`);
    return rates;
  } catch (error) {
    log.error('Failed to fetch latest MAS rates (legacy):', error);
    throw error;
  }
}

/**
 * @deprecated Use fetchRatesForDateRange instead. Legacy API may not be available.
 */
export async function fetchRatesForDateRangeLegacy(
  startDate: Date,
  endDate: Date
): Promise<ParsedExchangeRate[]> {
  const startStr = formatDateForMAS(startDate);
  const endStr = formatDateForMAS(endDate);

  log.debug(`Fetching MAS rates from ${startStr} to ${endStr} (legacy API)`);

  try {
    const filters = {
      end_of_day: { '>=': startStr, '<=': endStr },
    };

    const url = buildLegacyMASUrl({
      filters: JSON.stringify(filters),
      sort: 'end_of_day asc',
      limit: 100,
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`MAS Legacy API returned ${response.status}: ${response.statusText}`);
    }

    const data: MASApiResponse = await response.json();

    if (!data.success) {
      throw new Error('MAS Legacy API returned success: false');
    }

    const allRates: ParsedExchangeRate[] = [];
    for (const record of data.result.records) {
      const rates = parseLegacyExchangeRateRecord(record);
      allRates.push(...rates);
    }

    log.info(
      `Fetched ${allRates.length} rates for date range (legacy) ${startStr} to ${endStr} (${data.result.records.length} days)`
    );
    return allRates;
  } catch (error) {
    log.error('Failed to fetch MAS rates for date range (legacy):', error);
    throw error;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get yesterday's date.
 */
function getYesterday(): Date {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date;
}

/**
 * Get previous month in YYYY-MM format.
 */
export function getPreviousMonth(monthsBack: number = 1): string {
  const date = new Date();
  date.setMonth(date.getMonth() - monthsBack);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Get array of months between start and end (inclusive).
 */
function getMonthRange(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  const [startYear, startMon] = startMonth.split('-').map(Number);
  const [endYear, endMon] = endMonth.split('-').map(Number);

  let year = startYear;
  let month = startMon;

  while (year < endYear || (year === endYear && month <= endMon)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return months;
}

/**
 * Parse a monthly rate record from new MAS API.
 */
function parseMonthlyRateRecord(record: MASMonthlyRateRecord): ParsedExchangeRate[] {
  const rates: ParsedExchangeRate[] = [];

  // Parse month from "2024-11" format to LAST day of month (end-of-period rate)
  const [year, month] = record.end_of_month.split('-').map(Number);
  // Month is 0-indexed in JS Date, so passing `month` (not month-1) gives next month,
  // and day 0 gives the last day of the previous month
  const rateDate = new Date(Date.UTC(year, month, 0)); // Last day of month

  const isPreliminary = record.preliminary === '1';

  // Track which currencies we've already added (avoid duplicates from legacy/new field names)
  const addedCurrencies = new Set<string>();

  for (const [field, config] of Object.entries(MAS_CURRENCY_MAP)) {
    const rawValue = record[field];

    // Skip if no value for this currency
    if (!rawValue || rawValue === '' || rawValue === '-') {
      continue;
    }

    // Skip if we've already added this currency
    if (addedCurrencies.has(config.code)) {
      continue;
    }

    const parsedValue = parseFloat(rawValue);
    if (isNaN(parsedValue) || parsedValue <= 0) {
      log.warn(`Invalid rate value for ${field}: ${rawValue}`);
      continue;
    }

    // Calculate rate per 1 unit of source currency
    const rate = parsedValue / config.divisor;
    const inverseRate = 1 / rate;

    rates.push({
      sourceCurrency: config.code,
      targetCurrency: 'SGD',
      rate,
      inverseRate,
      rateDate,
      isPreliminary,
    });

    addedCurrencies.add(config.code);
  }

  return rates;
}

/**
 * Build legacy MAS API URL with query parameters.
 */
function buildLegacyMASUrl(params: Record<string, string | number>): string {
  const url = new URL(MAS_LEGACY_API_BASE);
  url.searchParams.set('resource_id', MAS_DAILY_RATES_RESOURCE_ID);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

/**
 * Format date for MAS API query (YYYY-MM-DD).
 */
function formatDateForMAS(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Parse a legacy exchange rate record into individual currency rates.
 */
function parseLegacyExchangeRateRecord(record: MASExchangeRateRecord): ParsedExchangeRate[] {
  const rates: ParsedExchangeRate[] = [];
  const rateDate = new Date(record.end_of_day);
  const isPreliminary = record.preliminary === '1';

  const addedCurrencies = new Set<string>();

  for (const [field, config] of Object.entries(MAS_CURRENCY_MAP)) {
    const rawValue = record[field];

    if (!rawValue || rawValue === '' || rawValue === '-') {
      continue;
    }

    if (addedCurrencies.has(config.code)) {
      continue;
    }

    const parsedValue = parseFloat(rawValue);
    if (isNaN(parsedValue) || parsedValue <= 0) {
      log.warn(`Invalid rate value for ${field}: ${rawValue}`);
      continue;
    }

    const rate = parsedValue / config.divisor;
    const inverseRate = 1 / rate;

    rates.push({
      sourceCurrency: config.code,
      targetCurrency: 'SGD',
      rate,
      inverseRate,
      rateDate,
      isPreliminary,
    });

    addedCurrencies.add(config.code);
  }

  return rates;
}

/**
 * Check if new MAS APIMG Gateway API is available.
 * Tests both monthly and daily endpoints.
 */
export async function checkMASApiHealth(): Promise<{ monthly: boolean; daily: boolean }> {
  const results = { monthly: false, daily: false };

  // Test monthly API
  try {
    const prevMonth = getPreviousMonth();
    const monthlyUrl = `${MAS_MONTHLY_API_BASE}?end_of_month=${prevMonth}`;

    const monthlyResponse = await fetch(monthlyUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json; charset=UTF-8',
        KeyId: MAS_MONTHLY_API_KEY,
      },
      cache: 'no-store',
    });

    if (monthlyResponse.ok) {
      const data: MASMonthlyApiResponse = await monthlyResponse.json();
      results.monthly = data.elements && data.elements.length > 0;
    }
  } catch {
    results.monthly = false;
  }

  // Test daily API
  try {
    const yesterday = getYesterday();
    const dailyUrl = `${MAS_DAILY_API_BASE}?end_of_day=${formatDateForMAS(yesterday)}`;

    const dailyResponse = await fetch(dailyUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json; charset=UTF-8',
        KeyId: MAS_DAILY_API_KEY,
      },
      cache: 'no-store',
    });

    if (dailyResponse.ok) {
      const data: MASDailyApiResponse = await dailyResponse.json();
      results.daily = data.elements && data.elements.length > 0;
    }
  } catch {
    results.daily = false;
  }

  return results;
}
