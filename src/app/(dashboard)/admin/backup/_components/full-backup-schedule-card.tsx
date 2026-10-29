'use client';

import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { useUpdateBackupSchedule, type BackupSettings } from '@/hooks/use-full-backup';

type Frequency = 'daily' | 'weekly';

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every Sunday' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, '0')}:00`,
}));

function parseCron(cron: string): { frequency: Frequency; hour: string } {
  const [, hour = '2', , , weekday = '*'] = cron.split(' ');
  return { frequency: weekday === '*' ? 'daily' : 'weekly', hour: /^\d+$/.test(hour) ? hour : '2' };
}

function buildCron(frequency: Frequency, hour: string): string {
  return frequency === 'weekly' ? `0 ${hour} * * 0` : `0 ${hour} * * *`;
}

export function FullBackupScheduleCard({ settings }: { settings: BackupSettings | undefined }) {
  const { success, error: showError } = useToast();
  const updateSchedule = useUpdateBackupSchedule();
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>('daily');
  const [hour, setHour] = useState('2');
  const [maxBackups, setMaxBackups] = useState('14');

  useEffect(() => {
    if (!settings) return;
    const parsed = parseCron(settings.cronPattern);
    setEnabled(settings.scheduleEnabled);
    setFrequency(parsed.frequency);
    setHour(parsed.hour);
    setMaxBackups(String(settings.maxBackups));
  }, [settings]);

  const keep = Number(maxBackups);
  const keepValid = Number.isInteger(keep) && keep >= 1 && keep <= 100;
  const dirty = settings
    ? enabled !== settings.scheduleEnabled ||
      buildCron(frequency, hour) !== settings.cronPattern ||
      keep !== settings.maxBackups
    : false;

  const save = async () => {
    try {
      await updateSchedule.mutateAsync({
        scheduleEnabled: enabled,
        cronPattern: buildCron(frequency, hour),
        timezone: settings?.timezone || 'Asia/Singapore',
        maxBackups: keep,
      });
      success(enabled ? 'Backup schedule saved' : 'Scheduled backups turned off');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to save the schedule');
    }
  };

  return (
    <div className="bg-background-secondary rounded-lg border border-border-primary p-4">
      <div className="flex items-start gap-3 mb-4">
        <CalendarClock className="w-5 h-5 text-text-secondary mt-0.5" />
        <div>
          <div className="text-sm font-medium text-text-primary">Scheduled full backups</div>
          <div className="text-xs text-text-secondary mt-0.5">
            {settings?.scheduleEnabled && settings.nextRunAt
              ? `Next run ${format(new Date(settings.nextRunAt), 'dd MMM yyyy HH:mm')} (Singapore time).`
              : 'Off.'}
            {settings?.lastError ? ` Last run failed: ${settings.lastError}` : ''}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[auto_minmax(8rem,1fr)_minmax(6rem,1fr)_minmax(6rem,1fr)] gap-3 items-end">
        <Toggle label="On" checked={enabled} onChange={setEnabled} labelPosition="top" disabled={!settings?.hasPassword} />
        <SearchableSelect
          label="How often"
          options={FREQUENCY_OPTIONS}
          value={frequency}
          onChange={(value) => setFrequency((value as Frequency) || 'daily')}
          disabled={!enabled}
          size="sm"
        />
        <SearchableSelect
          label="At"
          options={HOUR_OPTIONS}
          value={hour}
          onChange={(value) => setHour(value || '2')}
          disabled={!enabled}
          size="sm"
        />
        <FormInput
          label="Keep the newest"
          type="number"
          min={1}
          max={100}
          inputSize="sm"
          value={maxBackups}
          onChange={(event) => setMaxBackups(event.target.value)}
          error={keepValid ? undefined : 'Between 1 and 100'}
          disabled={!enabled}
        />
      </div>
      <div className="flex justify-end mt-3">
        <Button variant="secondary" size="sm" onClick={save} disabled={!dirty || !keepValid} isLoading={updateSchedule.isPending}>
          Save schedule
        </Button>
      </div>
    </div>
  );
}
