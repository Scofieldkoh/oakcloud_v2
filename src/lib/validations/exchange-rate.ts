/**
 * Exchange Rate Validation Schemas
 *
 * Zod schemas and constants for exchange rate operations.
 * All currencies are based on MAS (Monetary Authority of Singapore) supported currencies.
 */

import { z } from 'zod';

// ============================================================================
// CURRENCY CONSTANTS
// ============================================================================

/**
 * All currencies supported by MAS Exchange Rate API.
 * Rates are quoted against SGD (Singapore Dollar).
 */
export const SUPPORTED_CURRENCIES = [
  'SGD', // Singapore Dollar (base currency)
  'USD', // US Dollar
  'EUR', // Euro
  'GBP', // British Pound
  'JPY', // Japanese Yen
  'AUD', // Australian Dollar
  'CAD', // Canadian Dollar
  'CNY', // Chinese Yuan
  'HKD', // Hong Kong Dollar
  'INR', // Indian Rupee
  'IDR', // Indonesian Rupiah
  'KRW', // Korean Won
  'MYR', // Malaysian Ringgit
  'NZD', // New Zealand Dollar
  'PHP', // Philippine Peso
  'QAR', // Qatari Riyal
  'SAR', // Saudi Riyal
  'CHF', // Swiss Franc
  'TWD', // Taiwan Dollar
  'THB', // Thai Baht
  'AED', // UAE Dirham
  'VND', // Vietnamese Dong
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * Human-readable currency names for display in UI.
 */
export const CURRENCY_NAMES: Record<SupportedCurrency, string> = {
  SGD: 'Singapore Dollar',
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  JPY: 'Japanese Yen',
  AUD: 'Australian Dollar',
  CAD: 'Canadian Dollar',
  CNY: 'Chinese Yuan',
  HKD: 'Hong Kong Dollar',
  INR: 'Indian Rupee',
  IDR: 'Indonesian Rupiah',
  KRW: 'Korean Won',
  MYR: 'Malaysian Ringgit',
  NZD: 'New Zealand Dollar',
  PHP: 'Philippine Peso',
  QAR: 'Qatari Riyal',
  SAR: 'Saudi Riyal',
  CHF: 'Swiss Franc',
  TWD: 'Taiwan Dollar',
  THB: 'Thai Baht',
  AED: 'UAE Dirham',
  VND: 'Vietnamese Dong',
};

/**
 * Currency symbols for display formatting.
 */
export const CURRENCY_SYMBOLS: Partial<Record<SupportedCurrency, string>> = {
  SGD: 'S$',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  AUD: 'A$',
  CAD: 'C$',
  CNY: '¥',
  HKD: 'HK$',
  INR: '₹',
  IDR: 'Rp',
  KRW: '₩',
  MYR: 'RM',
  NZD: 'NZ$',
  PHP: '₱',
  QAR: 'QR',
  SAR: 'SR',
  CHF: 'CHF',
  TWD: 'NT$',
  THB: '฿',
  AED: 'AED',
  VND: '₫',
};

/**
 * Foreign currencies (excludes SGD base currency).
 * Used for exchange rate operations where we need source currencies.
 */
export const FOREIGN_CURRENCIES = SUPPORTED_CURRENCIES.filter((c) => c !== 'SGD');

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

export const currencySchema = z.enum(SUPPORTED_CURRENCIES);

/**
 * Exchange rate type schema matching Prisma ExchangeRateType enum.
 * Supports: MAS_DAILY_RATE, MAS_MONTHLY_RATE, ECB_DAILY_RATE, MANUAL_RATE
 */
export const exchangeRateTypeSchema = z.enum([
  'MAS_DAILY_RATE',
  'MAS_MONTHLY_RATE',
  'ECB_DAILY_RATE',
  'MANUAL_RATE',
]);
export type ExchangeRateTypeValue = z.infer<typeof exchangeRateTypeSchema>;

// Source filter for API queries
export const exchangeRateSourceSchema = z.enum(['MAS_DAILY', 'MAS_MONTHLY', 'MANUAL', 'ALL']);
export type ExchangeRateSourceType = z.infer<typeof exchangeRateSourceSchema>;

/**
 * Rate preference options for workspace settings.
 * MONTHLY = Use MAS monthly end-of-period rates (default)
 * DAILY = Use MAS daily rates
 */
export const RATE_PREFERENCES = ['MONTHLY', 'DAILY'] as const;
export type RatePreference = (typeof RATE_PREFERENCES)[number];

export const ratePreferenceSchema = z.enum(RATE_PREFERENCES);

/**
 * Schema for creating a manual exchange rate override.
 */
export const createManualRateSchema = z.object({
  tenantId: z.string().uuid().optional().nullable(),
  sourceCurrency: currencySchema.refine((val) => val !== 'SGD', {
    message: 'Source currency cannot be SGD',
  }),
  targetCurrency: currencySchema.default('SGD'),
  rate: z.coerce
    .number()
    .positive('Rate must be positive')
    .max(999999999, 'Rate exceeds maximum value'),
  rateDate: z.coerce.date(),
  reason: z
    .string()
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Reason must not exceed 500 characters'),
});

export type CreateManualRateInput = z.infer<typeof createManualRateSchema>;

/**
 * Schema for updating an existing exchange rate.
 */
export const updateRateSchema = z.object({
  rate: z.coerce.number().positive('Rate must be positive').optional(),
  reason: z.string().min(5).max(500).optional(),
});

export type UpdateRateInput = z.infer<typeof updateRateSchema>;

/**
 * Schema for searching/filtering exchange rates.
 */
export const rateSearchSchema = z.object({
  tenantId: z.string().uuid().optional(),
  sourceCurrency: currencySchema.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  source: exchangeRateSourceSchema.default('ALL'),
  includeSystem: z.coerce.boolean().default(true),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sortBy: z.enum(['sourceCurrency', 'rate', 'rateDate', 'rateType', 'createdAt']).optional().default('rateDate'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export type RateSearchInput = z.infer<typeof rateSearchSchema>;

/**
 * Schema for rate lookup request.
 */
export const rateLookupSchema = z.object({
  currency: currencySchema,
  date: z.coerce.date(),
  tenantId: z.string().uuid().optional(),
});

export type RateLookupInput = z.infer<typeof rateLookupSchema>;

/**
 * Schema for sync request.
 */
export const syncRequestSchema = z.object({
  date: z.coerce.date().optional(),
});

export type SyncRequestInput = z.infer<typeof syncRequestSchema>;

/**
 * Schema for MAS daily sync request with optional date range.
 */
export const masSyncSchema = z
  .object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine(
    (data) => {
      // If one date is provided, both must be provided
      if (data.startDate || data.endDate) {
        return data.startDate && data.endDate;
      }
      return true;
    },
    {
      message: 'Both startDate and endDate must be provided for date range sync',
    }
  );

export type MASSyncInput = z.infer<typeof masSyncSchema>;

/**
 * Schema for MAS monthly sync request.
 */
export const masMonthlySyncSchema = z.object({
  month: z.string().optional(), // Format: "2024-11"
});

export type MASMonthlySyncInput = z.infer<typeof masMonthlySyncSchema>;

/**
 * Schema for exchange rate sync with source selection.
 */
export const exchangeRateSyncSchema = z.object({
  source: z.enum(['MAS_DAILY', 'MAS_MONTHLY']),
  // MAS daily specific fields
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  // MAS monthly specific fields
  month: z.string().optional(),
});

export type ExchangeRateSyncInput = z.infer<typeof exchangeRateSyncSchema>;

/**
 * Schema for workspace rate preference update.
 */
export const workspaceRatePreferenceSchema = z.object({
  preferredRateType: ratePreferenceSchema,
});

export type WorkspaceRatePreferenceInput = z.infer<typeof workspaceRatePreferenceSchema>;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a currency code is valid.
 */
export function isValidCurrency(code: string): code is SupportedCurrency {
  return SUPPORTED_CURRENCIES.includes(code as SupportedCurrency);
}

/**
 * Get display label for currency (code + name).
 */
export function getCurrencyLabel(code: SupportedCurrency): string {
  return `${code} - ${CURRENCY_NAMES[code]}`;
}

/**
 * Get currency symbol for formatting.
 */
export function getCurrencySymbol(code: SupportedCurrency): string {
  return CURRENCY_SYMBOLS[code] || code;
}

/**
 * Format rate for display (6 decimal places).
 */
export function formatRate(rate: number | string, decimals = 6): string {
  const num = typeof rate === 'string' ? parseFloat(rate) : rate;
  if (isNaN(num)) return '-';
  return num.toFixed(decimals);
}
