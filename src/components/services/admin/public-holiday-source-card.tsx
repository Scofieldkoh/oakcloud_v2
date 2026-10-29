'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCheckPublicHolidays, usePublicHolidaySource, type PublicHolidayCheckResponse } from '@/hooks/use-service-calendars';
import type { PublicHolidaySourceStatus } from '@/services/public-holiday/constants';

interface PublicHolidaySourceCardProps {
  workspaceId: string;
  enabled?: boolean;
}

type SourceState = { label: string; tone: 'success' | 'neutral' | 'warning' | 'error' | 'info' };

const SG_TIME_ZONE = 'Asia/Singapore';

function formatSourceDate(value: string | null): string {
  if (!value) return 'Not yet known';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: SG_TIME_ZONE }).format(date);
}

function formatSourceDateTime(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-SG', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: SG_TIME_ZONE,
  }).format(date);
}

export function publicHolidaySourceState(
  status: PublicHolidaySourceStatus | undefined,
  options: { checking: boolean; lastCheck?: PublicHolidayCheckResponse; checkFailed: boolean },
): SourceState {
  if (options.checking || status?.inProgress) return { label: 'Checking…', tone: 'info' };
  if (options.checkFailed || options.lastCheck?.result.error) return { label: 'Source unavailable', tone: 'error' };
  if (options.lastCheck) {
    const { result } = options.lastCheck;
    return result.sourceChanged || result.calendarsUpdated > 0
      ? { label: 'Updated successfully', tone: 'success' }
      : { label: 'Up to date', tone: 'success' };
  }
  if (!status) return { label: 'Loading…', tone: 'neutral' };
  if (status.lastError) return { label: 'Previous sync failed', tone: 'warning' };
  if (!status.lastCompletedAt && status.recordCount === 0) return { label: 'Never synced', tone: 'neutral' };
  return { label: 'Up to date', tone: 'success' };
}

/**
 * Status of the official Singapore public holiday source (MOM via
 * data.gov.sg) with a "Check for updates" action. Calendars synchronize on
 * the server; there is no separate apply step.
 */
export function PublicHolidaySourceCard({ workspaceId, enabled = true }: PublicHolidaySourceCardProps) {
  const source = usePublicHolidaySource(workspaceId, enabled);
  const check = useCheckPublicHolidays(workspaceId);
  const status = check.data?.status ?? source.data;
  const checkFailed = Boolean(check.error);
  const lastCheck = check.data;
  const state = publicHolidaySourceState(status, { checking: check.isPending, lastCheck, checkFailed });
  const showUnavailable = checkFailed || Boolean(lastCheck?.result.error);
  const coverage = status?.minYear && status.maxYear ? `${status.minYear}–${status.maxYear}` : null;
  const updatedHere = lastCheck && !lastCheck.result.error ? lastCheck.result.calendarsUpdated : 0;

  return (
    <section aria-labelledby="public-holiday-source-heading" className="mb-4 rounded-lg border border-border-primary bg-background-secondary p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="public-holiday-source-heading" className="text-sm font-semibold text-text-primary">Singapore public holidays</h3>
          <p className="mt-1 text-xs text-text-muted">Official holidays are added to your Singapore calendars automatically. Manual holidays are never changed.</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="min-h-11 sm:min-h-8"
          leftIcon={<RefreshCw className="h-4 w-4" />}
          onClick={() => check.mutate()}
          isLoading={check.isPending}
          disabled={check.isPending || status?.inProgress}
        >
          Check for updates
        </Button>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-text-muted">Source</dt><dd className="mt-1 text-text-primary">Ministry of Manpower · data.gov.sg</dd></div>
        <div><dt className="text-xs text-text-muted">Official source updated</dt><dd className="mt-1 text-text-primary">{formatSourceDate(status?.sourceLastUpdatedAt ?? null)}{coverage ? <span className="ml-1 text-xs text-text-muted">({coverage})</span> : null}</dd></div>
        <div><dt className="text-xs text-text-muted">Oakcloud last checked</dt><dd className="mt-1 text-text-primary">{formatSourceDateTime(status?.lastCheckedAt ?? null)}</dd></div>
        <div><dt className="text-xs text-text-muted">Status</dt><dd className="mt-1"><span className={`badge badge-${state.tone}`}>{state.label}</span></dd></div>
      </dl>
      {showUnavailable ? (
        <p role="alert" className="mt-3 text-xs text-status-error">Unable to check MOM public holiday updates. Your existing Business Calendar remains unchanged.</p>
      ) : lastCheck && updatedHere > 0 ? (
        <p className="mt-3 text-xs text-text-secondary">
          {updatedHere} calendar{updatedHere === 1 ? '' : 's'} updated: {lastCheck.result.holidaysAdded} added, {lastCheck.result.holidaysUpdated} renamed, {lastCheck.result.holidaysArchived} archived.
        </p>
      ) : !lastCheck && status?.lastError ? (
        <p className="mt-3 text-xs text-status-warning">The last check did not finish: {status.lastError}. Your Business Calendar keeps its current holidays.</p>
      ) : null}
    </section>
  );
}
