export const TIMEZONE_VALUES = [
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Manila',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
] as const;

function getTimezoneOffsetMinutes(timezone: string): number | null {
  try {
    const date = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const utcTimestamp = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour === '24' ? '0' : values.hour),
      Number(values.minute),
      Number(values.second)
    );

    return Math.round((utcTimestamp - date.getTime()) / 60000);
  } catch {
    return null;
  }
}

export function getTimezoneLabel(timezone: string): string {
  const offsetMinutes = timezone === 'UTC' ? 0 : getTimezoneOffsetMinutes(timezone);
  if (offsetMinutes === null) return timezone;

  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, '0');
  const minutes = String(absoluteMinutes % 60).padStart(2, '0');
  return `UTC ${sign}${hours}:${minutes} - ${timezone}`;
}

export const TIMEZONE_OPTIONS = TIMEZONE_VALUES.map((timezone) => ({
  value: timezone,
  label: getTimezoneLabel(timezone),
}));
