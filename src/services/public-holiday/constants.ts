/**
 * Client-safe public holiday source constants (no server imports).
 */

export const PUBLIC_HOLIDAY_PROVIDER_MOM = 'DATA_GOV_SG_MOM' as const;
export const PUBLIC_HOLIDAY_JURISDICTION_SG = 'SG' as const;

/** MOM "Singapore Public Holidays (consolidated)" on data.gov.sg. */
export const DEFAULT_PUBLIC_HOLIDAY_DATASET_ID = 'd_8ef23381f9417e4d4254ee8b4dcdb176';

export type PublicHolidayProviderCode = typeof PUBLIC_HOLIDAY_PROVIDER_MOM;

export type PublicHolidaySourceStatus = {
  provider: PublicHolidayProviderCode;
  jurisdictionCode: typeof PUBLIC_HOLIDAY_JURISDICTION_SG;
  datasetId: string;
  sourceLastUpdatedAt: string | null;
  dataAsOf: string | null;
  lastCheckedAt: string | null;
  lastCompletedAt: string | null;
  inProgress: boolean;
  recordCount: number;
  minYear: number | null;
  maxYear: number | null;
  lastError: string | null;
};

export type PublicHolidayCalendarSyncSummary = {
  calendarsChecked: number;
  calendarsUpdated: number;
  calendarsFailed: number;
  holidaysAdded: number;
  holidaysUpdated: number;
  holidaysArchived: number;
};

export type PublicHolidayRefreshResult = PublicHolidayCalendarSyncSummary & {
  synced: boolean;
  skipped: boolean;
  reason?: 'lock' | 'up-to-date';
  sourceChanged: boolean;
  recordCount: number;
  dataAsOf: string | null;
  error?: string;
};
