interface CronFieldRange {
  min: number;
  max: number;
  normalize?: (value: number) => number;
}

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

interface ParsedCronExpression {
  minutes: number[];
  hours: number[];
  daysOfMonth: Set<number>;
  months: number[];
  daysOfWeek: Set<number>;
}

const DEFAULT_TIMEZONE = 'UTC';
const SEARCH_HORIZON_YEARS = 5;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  formatterCache.set(timezone, formatter);
  return formatter;
}

function normalizeTimezone(timezone: string | undefined): string {
  if (!timezone) {
    return DEFAULT_TIMEZONE;
  }

  try {
    getFormatter(timezone);
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function getZonedDateParts(date: Date, timezone: string): ZonedDateParts {
  const formatter = getFormatter(timezone);
  const parts = formatter.formatToParts(date);

  const readNumber = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) {
      throw new Error(`Missing ${type} in formatted date parts`);
    }

    return parseInt(value, 10);
  };

  return {
    year: readNumber('year'),
    month: readNumber('month'),
    day: readNumber('day'),
    hour: readNumber('hour'),
    minute: readNumber('minute'),
    second: readNumber('second'),
  };
}

function getTimezoneOffsetMinutes(timezone: string, date: Date): number {
  const zoned = getZonedDateParts(date, timezone);
  const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return (zonedAsUtc - date.getTime()) / (60 * 1000);
}

function parseFieldValue(rawValue: string, range: CronFieldRange): number {
  const value = parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new Error(`Invalid cron value "${rawValue}"`);
  }

  return range.normalize ? range.normalize(value) : value;
}

function addFieldValues(segment: string, range: CronFieldRange, values: Set<number>): void {
  const [rawBase, rawStep] = segment.split('/');
  const step = rawStep ? parseInt(rawStep, 10) : 1;

  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`Invalid cron step "${segment}"`);
  }

  let start: number;
  let end: number;

  if (rawBase === '*') {
    start = range.min;
    end = range.max;
  } else if (rawBase.includes('-')) {
    const [rangeStart, rangeEnd] = rawBase.split('-');
    start = parseFieldValue(rangeStart, range);
    end = parseFieldValue(rangeEnd, range);
  } else {
    start = parseFieldValue(rawBase, range);
    end = rawStep ? range.max : start;
  }

  if (start > end) {
    throw new Error(`Invalid cron range "${segment}"`);
  }

  for (let value = start; value <= end; value += step) {
    values.add(range.normalize ? range.normalize(value) : value);
  }
}

function parseCronField(field: string, range: CronFieldRange): number[] {
  const values = new Set<number>();

  for (const segment of field.split(',')) {
    addFieldValues(segment.trim(), range, values);
  }

  return Array.from(values).sort((left, right) => left - right);
}

function parseCronExpression(cronPattern: string): ParsedCronExpression {
  const parts = cronPattern.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron pattern "${cronPattern}"`);
  }

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = parts;

  return {
    minutes: parseCronField(minuteField, { min: 0, max: 59 }),
    hours: parseCronField(hourField, { min: 0, max: 23 }),
    daysOfMonth: new Set(parseCronField(dayOfMonthField, { min: 1, max: 31 })),
    months: parseCronField(monthField, { min: 1, max: 12 }),
    daysOfWeek: new Set(parseCronField(dayOfWeekField, { min: 0, max: 7, normalize: (value) => value % 7 })),
  };
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getWeekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function zonedDateTimeToUtc(
  input: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string
): Date | null {
  const utcGuess = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0);
  let candidate = new Date(utcGuess);

  for (let attempt = 0; attempt < 4; attempt++) {
    const offsetMinutes = getTimezoneOffsetMinutes(timezone, candidate);
    const adjusted = new Date(utcGuess - offsetMinutes * 60 * 1000);

    if (adjusted.getTime() === candidate.getTime()) {
      candidate = adjusted;
      break;
    }

    candidate = adjusted;
  }

  const resolved = getZonedDateParts(candidate, timezone);
  if (
    resolved.year !== input.year ||
    resolved.month !== input.month ||
    resolved.day !== input.day ||
    resolved.hour !== input.hour ||
    resolved.minute !== input.minute
  ) {
    return null;
  }

  return candidate;
}

export function getNextCronOccurrence(
  cronPattern: string,
  timezone: string = DEFAULT_TIMEZONE,
  fromDate: Date = new Date()
): Date {
  const normalizedTimezone = normalizeTimezone(timezone);
  const expression = parseCronExpression(cronPattern);
  const searchStart = new Date(fromDate.getTime() + 60 * 1000);
  searchStart.setUTCSeconds(0, 0);

  const start = getZonedDateParts(searchStart, normalizedTimezone);

  for (let year = start.year; year <= start.year + SEARCH_HORIZON_YEARS; year++) {
    for (const month of expression.months) {
      if (year === start.year && month < start.month) {
        continue;
      }

      const daysInMonth = getDaysInMonth(year, month);
      const firstDay = year === start.year && month === start.month ? start.day : 1;

      for (let day = firstDay; day <= daysInMonth; day++) {
        if (!expression.daysOfMonth.has(day)) {
          continue;
        }

        if (!expression.daysOfWeek.has(getWeekday(year, month, day))) {
          continue;
        }

        for (const hour of expression.hours) {
          if (year === start.year && month === start.month && day === start.day && hour < start.hour) {
            continue;
          }

          for (const minute of expression.minutes) {
            if (
              year === start.year &&
              month === start.month &&
              day === start.day &&
              hour === start.hour &&
              minute < start.minute
            ) {
              continue;
            }

            const candidate = zonedDateTimeToUtc({ year, month, day, hour, minute }, normalizedTimezone);
            if (candidate && candidate > fromDate) {
              return candidate;
            }
          }
        }
      }
    }
  }

  throw new Error(`Unable to find next run for cron pattern "${cronPattern}" within ${SEARCH_HORIZON_YEARS} years`);
}
