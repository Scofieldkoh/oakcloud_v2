import { z } from 'zod';

const UUID = z.string().uuid();
const DEADLINE_COLUMN_IDS = ['dueDate', 'timing', 'company', 'family', 'service', 'milestone', 'type', 'status', 'actions'] as const;
export const DEADLINE_COLUMN_WIDTH_MIN = 96;
export const DEADLINE_COLUMN_WIDTH_MAX = 800;

export const BILLING_TABLE_PREFERENCE_KEY = 'services.billing.table.v1';
export const BILLING_COLUMN_IDS = [
  'expectedDate',
  'timing',
  'company',
  'family',
  'service',
  'feeLine',
  'period',
  'status',
  'amount',
  'billedDate',
  'reference',
  'actions',
] as const;
export type BillingColumnId = (typeof BILLING_COLUMN_IDS)[number];
export const BILLING_COLUMN_WIDTH_MIN = 96;
export const BILLING_COLUMN_WIDTH_MAX = 800;

const billingColumnIdSchema = z.enum(BILLING_COLUMN_IDS);

export const billingTablePreferenceSchema = z.object({
  version: z.literal(1),
  columnWidths: z.record(z.string(), z.number().finite().min(BILLING_COLUMN_WIDTH_MIN).max(BILLING_COLUMN_WIDTH_MAX)).default({}),
  columnOrder: z.array(billingColumnIdSchema).max(20).default([]),
  columnVisibility: z.record(z.string(), z.boolean()).default({}),
  sortBy: z.enum(['expectedDate', 'company', 'family', 'service', 'status', 'amount']).default('expectedDate'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50), z.literal(100)]).default(20),
});

export type BillingTablePreference = z.infer<typeof billingTablePreferenceSchema>;

export const defaultBillingTablePreference: BillingTablePreference = {
  version: 1,
  columnWidths: {},
  columnOrder: [
    'timing',
    'company',
    'family',
    'service',
    'feeLine',
    'period',
    'status',
    'expectedDate',
    'amount',
    'billedDate',
    'reference',
    'actions',
  ],
  columnVisibility: {
    expectedDate: true,
    timing: true,
    company: true,
    family: true,
    service: true,
    feeLine: true,
    period: true,
    status: false,
    amount: true,
    billedDate: true,
    reference: false,
    actions: true,
  },
  sortBy: 'expectedDate',
  sortOrder: 'asc',
  pageSize: 20,
};

/** Restore the versioned billing table contract without letting bad saved data affect queries. */
export function parseBillingTablePreference(value: unknown): BillingTablePreference {
  if (!isRecord(value) || value.version !== 1) return defaultBillingTablePreference;

  const rawWidths = isRecord(value.columnWidths) ? value.columnWidths : {};
  const rawOrder = Array.isArray(value.columnOrder) ? value.columnOrder : [];
  const rawVisibility = isRecord(value.columnVisibility) ? value.columnVisibility : {};
  const parsed = billingTablePreferenceSchema.safeParse({
    ...value,
    columnWidths: {},
    columnOrder: [],
    columnVisibility: {},
    sortBy: value.sortBy ?? 'expectedDate',
    sortOrder: value.sortOrder ?? 'asc',
    pageSize: value.pageSize ?? 20,
  });
  if (!parsed.success) return defaultBillingTablePreference;

  const legacyColumnMap: Record<string, BillingColumnId[]> = {
    familyService: ['family', 'service'],
    feeLinePeriod: ['feeLine', 'period'],
  };
  const legacyWidth = (column: BillingColumnId): number | undefined => {
    if (typeof rawWidths[column] === 'number') return rawWidths[column] as number;
    const legacy = Object.entries(legacyColumnMap).find(([, columns]) => columns.includes(column))?.[0];
    return legacy && typeof rawWidths[legacy] === 'number' ? rawWidths[legacy] as number : undefined;
  };
  const widths = Object.fromEntries(
    BILLING_COLUMN_IDS
      .filter((column) => typeof legacyWidth(column) === 'number' && Number.isFinite(legacyWidth(column)))
      .map((column) => [column, Math.min(BILLING_COLUMN_WIDTH_MAX, Math.max(BILLING_COLUMN_WIDTH_MIN, Math.round(legacyWidth(column)!)))]),
  );
  const knownOrder = rawOrder.flatMap((column) => {
    if (typeof column !== 'string') return [];
    if (BILLING_COLUMN_IDS.includes(column as BillingColumnId)) return [column as BillingColumnId];
    return legacyColumnMap[column] ?? [];
  });
  const columnOrder = [...new Set([...knownOrder, ...BILLING_COLUMN_IDS])];
  const columnVisibility = Object.fromEntries(BILLING_COLUMN_IDS.map((column) => {
    if (column === 'actions') return [column, true];
    if (typeof rawVisibility[column] === 'boolean') return [column, rawVisibility[column]];
    const legacy = Object.entries(legacyColumnMap).find(([, columns]) => columns.includes(column))?.[0];
    return [column, legacy && rawVisibility[legacy] === false ? false : true];
  }));

  return {
    ...defaultBillingTablePreference,
    ...parsed.data,
    columnWidths: widths,
    columnOrder,
    columnVisibility,
  };
}

export const deadlineViewPreferenceSchema = z.object({
  version: z.literal(1),
  defaultView: z.enum(['TABLE', 'CALENDAR']),
  monthCount: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  visibleTypes: z.array(z.enum(['STATUTORY', 'CLIENT', 'INTERNAL'])).max(3),
  familyIds: z.array(UUID).max(50),
  tableColumnWidths: z.record(z.string(), z.number().finite().min(DEADLINE_COLUMN_WIDTH_MIN).max(DEADLINE_COLUMN_WIDTH_MAX)).default({}),
  tableColumnOrder: z.array(z.string()).max(20).default([]),
  tableColumnVisibility: z.record(z.string(), z.boolean()).default({}),
  sortBy: z.enum(['dueDate', 'company', 'family', 'service', 'type', 'status']).default('dueDate'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50), z.literal(100)]).default(20),
  showHolidays: z.boolean().default(true),
});

export type DeadlineViewPreference = z.infer<typeof deadlineViewPreferenceSchema>;

export const defaultDeadlineViewPreference: DeadlineViewPreference = {
  version: 1,
  defaultView: 'TABLE',
  monthCount: null,
  visibleTypes: [],
  familyIds: [],
  tableColumnWidths: {},
  tableColumnOrder: [
    'company',
    'family',
    'service',
    'milestone',
    'dueDate',
    'timing',
    'type',
    'status',
    'actions',
  ],
  tableColumnVisibility: {
    dueDate: true,
    timing: true,
    company: true,
    family: true,
    service: true,
    milestone: true,
    type: true,
    status: true,
    actions: true,
  },
  sortBy: 'dueDate',
  sortOrder: 'asc',
  pageSize: 20,
  showHolidays: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
/** Parse versioned preferences without allowing malformed JSON to affect queries. */
export function parseDeadlineViewPreference(value: unknown): DeadlineViewPreference {
  if (!isRecord(value) || value.version !== 1) return defaultDeadlineViewPreference;

  const rawWidths = isRecord(value.tableColumnWidths) ? value.tableColumnWidths : {};
  const rawOrder = Array.isArray(value.tableColumnOrder) ? value.tableColumnOrder : [];
  const rawVisibility = isRecord(value.tableColumnVisibility) ? value.tableColumnVisibility : {};
  const parsed = deadlineViewPreferenceSchema.safeParse({
    ...value,
    tableColumnWidths: {},
    tableColumnOrder: [],
    tableColumnVisibility: {},
    sortBy: value.sortBy ?? 'dueDate',
    sortOrder: value.sortOrder ?? 'asc',
    pageSize: value.pageSize ?? 20,
    showHolidays: typeof value.showHolidays === 'boolean' ? value.showHolidays : true,
  });
  if (!parsed.success) return defaultDeadlineViewPreference;

  const widths = Object.fromEntries(
    DEADLINE_COLUMN_IDS
      .filter((column) => typeof rawWidths[column] === 'number' && Number.isFinite(rawWidths[column]))
      .map((column) => [column, Math.min(DEADLINE_COLUMN_WIDTH_MAX, Math.max(DEADLINE_COLUMN_WIDTH_MIN, Math.round(rawWidths[column] as number)))]),
  );
  const knownOrder = rawOrder.filter((column): column is (typeof DEADLINE_COLUMN_IDS)[number] => typeof column === 'string' && DEADLINE_COLUMN_IDS.includes(column as (typeof DEADLINE_COLUMN_IDS)[number]));
  const tableColumnOrder = [...new Set([...knownOrder, ...DEADLINE_COLUMN_IDS])];
  const tableColumnVisibility = Object.fromEntries(DEADLINE_COLUMN_IDS.map((column) => [column, column === 'actions' ? true : rawVisibility[column] !== false]));
  return {
    ...defaultDeadlineViewPreference,
    ...parsed.data,
    visibleTypes: parsed.data.visibleTypes,
    tableColumnWidths: widths,
    tableColumnOrder,
    tableColumnVisibility,
  };
}
