import { Prisma } from '@/generated/prisma';
import { hashConfiguration } from '@/services/service-schedule/hash';

export function summarizeClientServiceFees(fees: Array<{ amount: Prisma.Decimal | string; currency: string }>) {
  const totals = new Map<string, Prisma.Decimal>();
  for (const fee of fees) {
    totals.set(fee.currency, (totals.get(fee.currency) ?? new Prisma.Decimal(0)).add(fee.amount.toString()));
  }
  return {
    count: fees.length,
    totals: Object.fromEntries([...totals].sort(([left], [right]) => left.localeCompare(right)).map(([currency, total]) => [currency, total.toFixed(2)])),
  };
}

const MAX_AUDIT_FEE_LINES = 100;
const MAX_AUDIT_SCHEDULE_ENTRIES = 31;
const MAX_AUDIT_TEXT_LENGTH = 500;

type FeeAuditInput = {
  id?: string | null;
  sourceAgreementFeeLineId?: string | null;
  description: string;
  amount: Prisma.Decimal | string | { toString(): string };
  currency: string;
  billingFrequency: string;
  customFrequencyLabel?: string | null;
  billingStartDate?: Date | string | null;
  scheduleConfig?: unknown;
  isActive?: boolean;
  deletedAt?: Date | string | null;
  deletedReason?: string | null;
  displayOrder?: number;
};

function boundedText(value: unknown): string | null {
  if (value == null) return null;
  return String(value).slice(0, MAX_AUDIT_TEXT_LENGTH);
}

function auditDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function boundedSchedule(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const entries = Array.isArray(record.scheduleEntries)
    ? record.scheduleEntries.slice(0, MAX_AUDIT_SCHEDULE_ENTRIES).map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;
      const expression = row.expression && typeof row.expression === 'object' && !Array.isArray(row.expression)
        ? row.expression as Record<string, unknown>
        : null;
      return {
        key: boundedText(row.key),
        label: boundedText(row.label),
        businessDayAdjustment: boundedText(row.businessDayAdjustment),
        expression: expression ? {
          kind: boundedText(expression.kind),
          day: typeof expression.day === 'number' ? expression.day : null,
          ordinal: typeof expression.ordinal === 'number' ? expression.ordinal : null,
          source: expression.source && typeof expression.source === 'object' && !Array.isArray(expression.source)
            ? { kind: boundedText((expression.source as Record<string, unknown>).kind), key: boundedText((expression.source as Record<string, unknown>).key) }
            : null,
          offset: typeof expression.offset === 'number' ? expression.offset : null,
          unit: boundedText(expression.unit),
        } : null,
      };
    })
    : [];
  return {
    schemaVersion: record.schemaVersion,
    cadence: record.cadence,
    startDate: record.startDate,
    customInterval: record.customInterval && typeof record.customInterval === 'object' && !Array.isArray(record.customInterval)
      ? {
        unit: boundedText((record.customInterval as Record<string, unknown>).unit),
        count: typeof (record.customInterval as Record<string, unknown>).count === 'number' ? (record.customInterval as Record<string, unknown>).count : null,
      }
      : null,
    scheduleEntries: entries,
  };
}

export function snapshotClientServiceFees(fees: FeeAuditInput[]) {
  const items = fees.slice(0, MAX_AUDIT_FEE_LINES).map((fee) => {
    const scheduleConfig = boundedSchedule(fee.scheduleConfig);
    const archived = fee.isActive === false || fee.deletedAt != null;
    return {
      id: fee.id ?? null,
      sourceAgreementFeeLineId: fee.sourceAgreementFeeLineId ?? null,
      description: boundedText(fee.description) ?? '',
      state: archived ? 'ARCHIVED' : 'ACTIVE',
      archiveReason: archived ? boundedText(fee.deletedReason) : null,
      amount: fee.amount.toString(),
      currency: fee.currency,
      billingFrequency: fee.billingFrequency,
      customFrequencyLabel: boundedText(fee.customFrequencyLabel),
      billingStartDate: auditDate(fee.billingStartDate),
      scheduleConfigHash: scheduleConfig ? hashConfiguration(scheduleConfig) : null,
      scheduleConfig,
      displayOrder: fee.displayOrder ?? null,
    };
  });
  return {
    count: fees.length,
    truncated: fees.length > MAX_AUDIT_FEE_LINES,
    items,
  };
}
