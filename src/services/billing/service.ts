import { createAuditLog } from '@/lib/audit';
import { getCompanyDisplayLabel } from '@/lib/company-display-label';
import {
  ApiError,
  ErrorCodes,
  NotFoundError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import {
  billingOccurrenceSearchSchema,
  emptyBillingOccurrenceResult,
  resetBillingOverrideSchema,
  updateBillingOccurrenceSchema,
  type BillingOccurrenceSearch,
  type BillingOccurrenceSearchInput,
  type ResetBillingOverrideInput,
  type UpdateBillingOccurrenceInput,
} from '@/lib/validations/billing';
import {
  compareDateOnly,
  currentDateInSingapore,
  formatDateOnly,
  parseDateOnly,
  type DateOnly,
} from '@/services/service-schedule';
import { isPostpaidGenerationKey } from './postpaid-triggers';
import { parseTieredPricing, priceTieredQuantity } from './tiered-pricing';
import type {
  BillingOccurrenceActor,
  BillingOccurrenceDb,
  BillingOccurrenceDto,
  BillingOccurrenceListResult,
  BillingOccurrenceRecord,
  BillingOccurrenceSearchOptions,
  BillingOccurrenceTiming,
} from './types';

type Db = BillingOccurrenceDb | typeof prisma;
type DbRecord = BillingOccurrenceRecord & Record<string, unknown>;

function toDb(db: Db): BillingOccurrenceDb {
  return db as unknown as BillingOccurrenceDb;
}

function asRecord(value: unknown): DbRecord {
  return value as DbRecord;
}

function asDateOnly(value: Date | string): DateOnly {
  if (typeof value === 'string') {
    const candidate = value.slice(0, 10) as DateOnly;
    parseDateOnly(candidate);
    return candidate;
  }
  return formatDateOnly(value);
}

function asNullableDateOnly(value: Date | string | null | undefined): DateOnly | null {
  return value == null ? null : asDateOnly(value);
}

function asInstant(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function moneyString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object' && value !== null && 'toFixed' in value && typeof (value as { toFixed?: unknown }).toFixed === 'function') {
    return (value as { toFixed: (digits: number) => string }).toFixed(2);
  }
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) return text;
  const [whole, fraction = ''] = text.split('.');
  return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

function tenantMatches(value: unknown, tenantId: string): boolean {
  if (value === null) return false;
  if (value === undefined) return true;
  if (typeof value !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(value, 'tenantId')) return true;
  const relatedTenantId = (value as { tenantId?: unknown }).tenantId;
  return relatedTenantId === undefined || relatedTenantId === tenantId;
}

function hasTenantIntegrity(record: DbRecord, tenantId: string): boolean {
  const clientService = record.clientService;
  const variant = clientService?.serviceVariant;
  const family = variant?.family;
  return record.tenantId === tenantId
    && tenantMatches(record.company, tenantId)
    && tenantMatches(clientService, tenantId)
    && tenantMatches(variant, tenantId)
    && tenantMatches(family, tenantId)
    && tenantMatches(record.feeLine, tenantId);
}

function familyFromRecord(record: DbRecord) {
  const family = record.clientService?.serviceVariant?.family;
  return {
    id: family?.id ?? null,
    name: family?.name ?? record.clientService?.familyName ?? '',
    displayColor: family?.displayColor ?? null,
  };
}

/** Derive a presentation timing state from an open row and Singapore date. */
export function deriveBillingTiming(
  status: string,
  expectedDate: DateOnly | Date | string,
  today: DateOnly | Date | string = currentDateInSingapore(),
): BillingOccurrenceTiming | null {
  if (status !== 'OPEN') return null;
  const due = expectedDate instanceof Date ? formatDateOnly(expectedDate) : asDateOnly(expectedDate);
  const current = today instanceof Date ? formatDateOnly(today) : asDateOnly(today);
  const comparison = compareDateOnly(due, current);
  if (comparison > 0) return 'UPCOMING';
  if (comparison === 0) return 'DUE';
  return 'OVERDUE';
}

export function toBillingOccurrenceDto(
  value: unknown,
  today: DateOnly = currentDateInSingapore(),
): BillingOccurrenceDto {
  const record = asRecord(value);
  const company = record.company ?? {};
  const clientService = record.clientService ?? {};
  const variant = clientService.serviceVariant ?? {};
  const family = familyFromRecord(record);
  const companyName = company.name ?? '';

  return {
    id: record.id,
    tenantId: record.tenantId,
    companyId: record.companyId,
    clientServiceId: record.clientServiceId,
    feeLineId: record.feeLineId,
    billingPeriodKey: record.billingPeriodKey,
    scheduleEntryKey: record.scheduleEntryKey ?? '',
    generationKey: record.generationKey,
    calculatedExpectedDate: asDateOnly(record.calculatedExpectedDate),
    operativeExpectedDate: asDateOnly(record.operativeExpectedDate),
    dateOverridden: record.dateOverridden,
    dateOverrideReason: record.dateOverrideReason ?? null,
    dateOverriddenAt: asInstant(record.dateOverriddenAt),
    dateOverriddenById: record.dateOverriddenById ?? null,
    baseAmount: moneyString(record.baseAmount),
    baseCurrency: record.baseCurrency,
    operativeAmount: moneyString(record.operativeAmount),
    operativeCurrency: record.operativeCurrency,
    quantity: record.quantity == null ? null : moneyString(record.quantity),
    valueOverridden: record.valueOverridden,
    valueOverrideReason: record.valueOverrideReason ?? null,
    valueOverriddenAt: asInstant(record.valueOverriddenAt),
    valueOverriddenById: record.valueOverriddenById ?? null,
    status: record.status,
    timingState: deriveBillingTiming(record.status, record.operativeExpectedDate, today),
    billedDate: asNullableDateOnly(record.billedDate),
    markedBilledAt: asInstant(record.markedBilledAt),
    markedBilledById: record.markedBilledById ?? null,
    externalReference: record.externalReference ?? null,
    notes: record.notes ?? null,
    waivedAt: asInstant(record.waivedAt),
    waivedById: record.waivedById ?? null,
    waiverReason: record.waiverReason ?? null,
    cancelledAt: asInstant(record.cancelledAt),
    cancelledById: record.cancelledById ?? null,
    cancellationReason: record.cancellationReason ?? null,
    cancellationReconciliationRequestId: record.cancellationReconciliationRequestId ?? null,
    createdAt: asInstant(record.createdAt)!,
    updatedAt: asInstant(record.updatedAt)!,
    company: {
      id: company.id ?? record.companyId,
      name: companyName,
      displayAlias: company.displayAlias ?? null,
      displayLabel: getCompanyDisplayLabel({ name: companyName, displayAlias: company.displayAlias }),
      uen: company.uen ?? null,
    },
    family,
    service: {
      id: clientService.id ?? record.clientServiceId,
      name: clientService.serviceName ?? '',
      familyName: clientService.familyName ?? family.name,
      variantId: variant.id ?? null,
      variantName: variant.name ?? null,
    },
    feeLine: {
      id: record.feeLine?.id ?? record.feeLineId,
      description: record.feeLine?.description ?? '',
      amount: record.feeLine?.amount == null ? null : moneyString(record.feeLine.amount),
      currency: record.feeLine?.currency ?? null,
      tieredPricing: isPostpaidGenerationKey(record.generationKey) ? parseTieredPricing(record.feeLine?.tieredPricing) : null,
    },
  };
}

function requestedCompanyIds(input: Pick<BillingOccurrenceSearch, 'companyIds' | 'companyId'>, actor: BillingOccurrenceActor): string[] | undefined {
  const requested = input.companyId ? [input.companyId] : input.companyIds;
  if (actor.companyIds === undefined) return requested.length > 0 ? [...requested] : undefined;
  if (requested.length === 0) return [...actor.companyIds];
  const accessible = new Set(actor.companyIds);
  return requested.filter((companyId) => accessible.has(companyId));
}

function timingWhere(
  input: BillingOccurrenceSearch,
  today: DateOnly,
): Prisma.BillingOccurrenceWhereInput | null {
  if (input.timing.length === 0) return null;
  const todayDate = parseDateOnly(today);
  const predicates: Prisma.BillingOccurrenceWhereInput[] = [];
  for (const timing of input.timing) {
    if (timing === 'UPCOMING') predicates.push({ operativeExpectedDate: { gt: todayDate } });
    if (timing === 'DUE') predicates.push({ operativeExpectedDate: todayDate });
    if (timing === 'OVERDUE') predicates.push({ operativeExpectedDate: { lt: todayDate } });
  }
  return { status: 'OPEN', OR: predicates };
}

/** Shared tenant/access/date predicate used by list and count queries. */
export function billingOccurrenceWhereForSearch(
  input: BillingOccurrenceSearch,
  actor: BillingOccurrenceActor,
  today: DateOnly = currentDateInSingapore(),
): Prisma.BillingOccurrenceWhereInput {
  const companyIds = requestedCompanyIds(input, actor);
  const familyIds = input.familyId ? [input.familyId] : input.familyIds;
  const servicePredicates: Prisma.ClientServiceWhereInput[] = [];
  if (input.serviceQuery) {
    servicePredicates.push(
      { serviceName: { contains: input.serviceQuery, mode: 'insensitive' } },
      { familyName: { contains: input.serviceQuery, mode: 'insensitive' } },
      { serviceVariant: { name: { contains: input.serviceQuery, mode: 'insensitive' } } },
      { serviceVariant: { family: { name: { contains: input.serviceQuery, mode: 'insensitive' } } } },
    );
  }
  if (input.serviceNameQuery) servicePredicates.push({ serviceName: { contains: input.serviceNameQuery, mode: 'insensitive' } });
  const companyWhere: Prisma.CompanyWhereInput = {
    tenantId: actor.tenantId,
    deletedAt: null,
    ...(companyIds === undefined ? {} : { id: { in: companyIds } }),
    ...(input.companyQuery ? {
      OR: [
        { name: { contains: input.companyQuery, mode: 'insensitive' } },
        { displayAlias: { contains: input.companyQuery, mode: 'insensitive' } },
        { uen: { contains: input.companyQuery, mode: 'insensitive' } },
      ],
    } : {}),
  };
  const clientServiceWhere: Prisma.ClientServiceWhereInput = {
    tenantId: actor.tenantId,
    ...(companyIds === undefined ? {} : { companyId: { in: companyIds } }),
    serviceVariant: {
      tenantId: actor.tenantId,
      family: {
        tenantId: actor.tenantId,
        ...(familyIds.length > 0 ? { id: { in: familyIds } } : {}),
      },
    },
    ...(servicePredicates.length > 0 ? { OR: servicePredicates } : {}),
  };
  const feeLineWhere: Prisma.ClientServiceFeeLineWhereInput = {
    tenantId: actor.tenantId,
    clientService: { tenantId: actor.tenantId },
    ...((input.feeQuery || input.feeLineQuery) ? { description: { contains: input.feeLineQuery || input.feeQuery, mode: 'insensitive' } } : {}),
  };
  const expectedDate = input.expectedDate ? parseDateOnly(input.expectedDate as DateOnly) : null;
  const dateWhere: Prisma.BillingOccurrenceWhereInput = expectedDate
    ? { operativeExpectedDate: expectedDate }
    : input.from && input.to
      ? { operativeExpectedDate: { gte: parseDateOnly(input.from as DateOnly), lte: parseDateOnly(input.to as DateOnly) } }
      : {};
  const amountWhere: Prisma.BillingOccurrenceWhereInput = input.amountMin || input.amountMax
    ? { operativeAmount: { ...(input.amountMin ? { gte: input.amountMin } : {}), ...(input.amountMax ? { lte: input.amountMax } : {}) } }
    : {};
  const where: Prisma.BillingOccurrenceWhereInput = {
    tenantId: actor.tenantId,
    company: companyWhere,
    clientService: clientServiceWhere,
    feeLine: feeLineWhere,
    ...dateWhere,
    ...amountWhere,
    ...(input.billedDate ? { billedDate: parseDateOnly(input.billedDate as DateOnly) } : {}),
    ...(input.referenceQuery ? { externalReference: { contains: input.referenceQuery, mode: 'insensitive' } } : {}),
    ...(companyIds === undefined ? {} : { companyId: { in: companyIds } }),
    ...(input.statuses.length > 0 ? { status: { in: input.statuses } } : {}),
  };
  const and: Prisma.BillingOccurrenceWhereInput[] = [];
  if (input.query) {
    and.push({
      OR: [
        { company: { OR: [{ name: { contains: input.query, mode: 'insensitive' } }, { displayAlias: { contains: input.query, mode: 'insensitive' } }, { uen: { contains: input.query, mode: 'insensitive' } }] } },
        { clientService: { OR: [{ serviceName: { contains: input.query, mode: 'insensitive' } }, { familyName: { contains: input.query, mode: 'insensitive' } }, { serviceVariant: { name: { contains: input.query, mode: 'insensitive' } } }, { serviceVariant: { family: { name: { contains: input.query, mode: 'insensitive' } } } }] } },
        { feeLine: { description: { contains: input.query, mode: 'insensitive' } } },
        { billingPeriodKey: { contains: input.query, mode: 'insensitive' } },
        { externalReference: { contains: input.query, mode: 'insensitive' } },
        { notes: { contains: input.query, mode: 'insensitive' } },
      ],
    });
  }
  if (input.feeQuery) {
    and.push({
      OR: [
        { feeLine: { description: { contains: input.feeQuery, mode: 'insensitive' } } },
        { billingPeriodKey: { contains: input.feeQuery, mode: 'insensitive' } },
      ],
    });
  }
  if (input.feeLineQuery) {
    and.push({ feeLine: { description: { contains: input.feeLineQuery, mode: 'insensitive' } } });
  }
  if (input.periodQuery) {
    and.push({ billingPeriodKey: { contains: input.periodQuery, mode: 'insensitive' } });
  }
  if (input.referenceQuery) {
    and.push({ externalReference: { contains: input.referenceQuery, mode: 'insensitive' } });
  }
  const timing = timingWhere(input, today);
  if (timing) and.push(timing);
  if (and.length > 0) where.AND = and;
  return where;
}

function includeForOccurrence(): Prisma.BillingOccurrenceInclude {
  return {
    company: { select: { id: true, tenantId: true, name: true, displayAlias: true, uen: true } },
    clientService: {
      select: {
        id: true,
        tenantId: true,
        companyId: true,
        serviceName: true,
        familyName: true,
        serviceVariant: {
          select: {
            id: true,
            tenantId: true,
            name: true,
            family: { select: { id: true, tenantId: true, name: true, displayColor: true } },
          },
        },
      },
    },
    feeLine: {
      select: { id: true, tenantId: true, clientServiceId: true, description: true, amount: true, currency: true, tieredPricing: true },
    },
  };
}

function orderByForOccurrence(input: BillingOccurrenceSearch): Prisma.BillingOccurrenceOrderByWithRelationInput[] {
  const direction = input.sortOrder;
  switch (input.sortBy) {
    case 'company':
      return [{ company: { name: direction } }, { operativeExpectedDate: 'asc' }, { id: 'asc' }];
    case 'family':
      return [{ clientService: { familyName: direction } }, { operativeExpectedDate: 'asc' }, { id: 'asc' }];
    case 'service':
      return [{ clientService: { serviceName: direction } }, { operativeExpectedDate: 'asc' }, { id: 'asc' }];
    case 'status':
      return [{ status: direction }, { operativeExpectedDate: 'asc' }, { id: 'asc' }];
    case 'amount':
      return [{ operativeAmount: direction }, { operativeExpectedDate: 'asc' }, { id: 'asc' }];
    case 'expectedDate':
    default:
      return [{ operativeExpectedDate: direction }, { id: 'asc' }];
  }
}

export async function listBillingOccurrences(
  rawInput: BillingOccurrenceSearchInput,
  actor: BillingOccurrenceActor,
  db: Db = prisma,
  options: BillingOccurrenceSearchOptions = {},
): Promise<BillingOccurrenceListResult> {
  const parsed = billingOccurrenceSearchSchema.parse(rawInput);
  const companyIds = requestedCompanyIds(parsed, actor);
  if (companyIds?.length === 0) return emptyBillingOccurrenceResult(parsed);
  const today = options.today ?? currentDateInSingapore();
  const where = billingOccurrenceWhereForSearch(parsed, actor, today);
  const database = toDb(db);
  const [rows, total] = await Promise.all([
    database.billingOccurrence.findMany({
      where,
      include: includeForOccurrence(),
      orderBy: orderByForOccurrence(parsed),
      skip: (parsed.page - 1) * parsed.limit,
      take: parsed.limit,
    }),
    database.billingOccurrence.count({ where }),
  ]);
  return {
    mode: 'TABLE',
    items: rows.filter((row) => hasTenantIntegrity(asRecord(row), actor.tenantId)).map((row) => toBillingOccurrenceDto(row, today)),
    total,
    page: parsed.page,
    limit: parsed.limit,
    totalPages: total === 0 ? 0 : Math.ceil(total / parsed.limit),
  };
}

function occurrenceIntegrityWhere(id: string, actor: BillingOccurrenceActor): Prisma.BillingOccurrenceWhereInput {
  return {
    id,
    tenantId: actor.tenantId,
    ...(actor.companyIds === undefined ? {} : { companyId: { in: [...actor.companyIds] } }),
    company: { tenantId: actor.tenantId, deletedAt: null },
    clientService: {
      tenantId: actor.tenantId,
      company: { tenantId: actor.tenantId, deletedAt: null },
      serviceVariant: { tenantId: actor.tenantId, family: { tenantId: actor.tenantId } },
    },
    feeLine: { tenantId: actor.tenantId, clientService: { tenantId: actor.tenantId } },
  };
}

export async function getBillingOccurrence(
  id: string,
  actor: BillingOccurrenceActor,
  db: Db = prisma,
): Promise<BillingOccurrenceDto> {
  const row = await toDb(db).billingOccurrence.findFirst({ where: occurrenceIntegrityWhere(id, actor), include: includeForOccurrence() });
  if (!row || !hasTenantIntegrity(asRecord(row), actor.tenantId)) throw new NotFoundError('Billing occurrence not found');
  return toBillingOccurrenceDto(row);
}

async function findMutationRecord(id: string, actor: BillingOccurrenceActor, db: Db): Promise<DbRecord> {
  const row = await toDb(db).billingOccurrence.findFirst({ where: occurrenceIntegrityWhere(id, actor), include: includeForOccurrence() });
  if (!row || !hasTenantIntegrity(asRecord(row), actor.tenantId)) throw new NotFoundError('Billing occurrence not found');
  const record = asRecord(row);
  if (record.status === 'CANCELLED') {
    throw new ApiError(ErrorCodes.OCCURRENCE_IMMUTABLE, 'Cancelled billing occurrences are immutable', 409);
  }
  return record;
}

function assertStatusTransition(current: DbRecord, input: UpdateBillingOccurrenceInput, nextStatus: BillingOccurrenceRecord['status']): void {
  if (nextStatus === 'CANCELLED') {
    throw new ApiError(ErrorCodes.OCCURRENCE_IMMUTABLE, 'Cancelled billing occurrences are system-controlled', 409);
  }
  if (nextStatus !== current.status) {
    const allowed = current.status === 'OPEN'
      ? nextStatus === 'BILLED' || nextStatus === 'WAIVED'
      : (current.status === 'BILLED' || current.status === 'WAIVED') && nextStatus === 'OPEN';
    if (!allowed) throw new ValidationError(`Cannot change a ${current.status.toLowerCase()} billing occurrence directly to ${nextStatus.toLowerCase()}`);
  }
  if ((current.status === 'BILLED' || current.status === 'WAIVED') && nextStatus === 'OPEN' && !input.reason) {
    throw new ValidationError('A reason is required when reopening a billing occurrence');
  }
  if (input.billedDate !== undefined && nextStatus !== 'BILLED' && input.billedDate !== null) {
    throw new ValidationError('A billed date can only be supplied for a billed occurrence');
  }
}

function buildMutationData(
  current: DbRecord,
  input: UpdateBillingOccurrenceInput,
  actor: BillingOccurrenceActor,
): { data: Record<string, unknown>; valueData: Record<string, unknown>; next: DbRecord } {
  const now = new Date();
  const nextStatus = input.status ?? current.status;
  assertStatusTransition(current, input, nextStatus);
  const data: Record<string, unknown> = {};
  const valueData: Record<string, unknown> = {};

  if (input.status !== undefined) {
    data.status = input.status;
    if (input.status === 'BILLED') {
      data.markedBilledAt = current.status === 'BILLED' && current.markedBilledAt ? current.markedBilledAt : now;
      data.markedBilledById = current.status === 'BILLED' && current.markedBilledById ? current.markedBilledById : actor.userId;
      data.waivedAt = null;
      data.waivedById = null;
      data.waiverReason = null;
    } else if (input.status === 'WAIVED') {
      data.waivedAt = now;
      data.waivedById = actor.userId;
      data.waiverReason = input.reason;
      data.markedBilledAt = null;
      data.markedBilledById = null;
      data.billedDate = null;
    } else {
      data.markedBilledAt = null;
      data.markedBilledById = null;
      data.billedDate = null;
      data.waivedAt = null;
      data.waivedById = null;
      data.waiverReason = null;
    }
  }

  if (input.billedDate !== undefined) data.billedDate = input.billedDate === null ? null : parseDateOnly(input.billedDate as DateOnly);
  if (input.operativeExpectedDate !== undefined) {
    data.operativeExpectedDate = parseDateOnly(input.operativeExpectedDate as DateOnly);
    data.dateOverridden = true;
    data.dateOverrideReason = input.reason;
    data.dateOverriddenById = actor.userId;
    data.dateOverriddenAt = now;
  }
  if (input.amount !== undefined) data.operativeAmount = input.amount;
  if (input.currency !== undefined) data.operativeCurrency = input.currency;
  if (input.amount !== undefined || input.currency !== undefined) {
    data.valueOverridden = true;
    data.valueOverrideReason = input.reason;
    data.valueOverriddenById = actor.userId;
    data.valueOverriddenAt = now;
    if (input.amount !== undefined) valueData.operativeAmount = input.amount;
    if (input.currency !== undefined) valueData.operativeCurrency = input.currency;
    valueData.valueOverridden = true;
    valueData.valueOverrideReason = input.reason;
    valueData.valueOverriddenById = actor.userId;
    valueData.valueOverriddenAt = now;
  }
  const pricing = isPostpaidGenerationKey(current.generationKey) ? parseTieredPricing(current.feeLine?.tieredPricing) : null;
  if (pricing && input.status === 'BILLED' && current.quantity == null && input.quantity === undefined && !current.valueOverridden && input.amount === undefined) {
    throw new ValidationError('Enter the quantity before marking this fee billed');
  }
  if (input.quantity !== undefined) {
    // A tiered postpaid entry bills the tier price of its quantity.
    if (!pricing) throw new ValidationError('Only fees priced by quantity tiers take a quantity');
    if (current.status !== 'OPEN') throw new ValidationError('Reopen the billing entry to change its quantity');
    const amount = priceTieredQuantity(pricing, input.quantity);
    data.quantity = input.quantity;
    data.baseAmount = amount;
    if (!current.valueOverridden && input.amount === undefined) data.operativeAmount = amount;
  }
  if (input.externalReference !== undefined) data.externalReference = input.externalReference;
  if (input.notes !== undefined) data.notes = input.notes;
  data.updatedAt = now;
  valueData.updatedAt = now;

  return { data, valueData, next: { ...current, ...data } as DbRecord };
}

function auditState(record: DbRecord): Record<string, unknown> {
  return {
    status: record.status,
    billedDate: asNullableDateOnly(record.billedDate),
    calculatedExpectedDate: asDateOnly(record.calculatedExpectedDate),
    operativeExpectedDate: asDateOnly(record.operativeExpectedDate),
    dateOverridden: record.dateOverridden,
    dateOverrideReason: record.dateOverrideReason,
    dateOverriddenAt: asInstant(record.dateOverriddenAt),
    dateOverriddenById: record.dateOverriddenById,
    baseAmount: moneyString(record.baseAmount),
    baseCurrency: record.baseCurrency,
    operativeAmount: moneyString(record.operativeAmount),
    operativeCurrency: record.operativeCurrency,
    quantity: record.quantity == null ? null : moneyString(record.quantity),
    valueOverridden: record.valueOverridden,
    valueOverrideReason: record.valueOverrideReason,
    valueOverriddenAt: asInstant(record.valueOverriddenAt),
    valueOverriddenById: record.valueOverriddenById,
    markedBilledAt: asInstant(record.markedBilledAt),
    markedBilledById: record.markedBilledById,
    waivedAt: asInstant(record.waivedAt),
    waivedById: record.waivedById,
    waiverReason: record.waiverReason,
    externalReference: record.externalReference,
    notes: record.notes,
  };
}

function auditChanges(before: DbRecord, after: DbRecord): Record<string, { old: unknown; new: unknown }> {
  const oldState = auditState(before);
  const newState = auditState(after);
  return Object.fromEntries(Object.keys(oldState).map((key) => [key, { old: oldState[key], new: newState[key] }])) as Record<string, { old: unknown; new: unknown }>;
}

function optimisticWhere(current: DbRecord, actor: BillingOccurrenceActor, expectedUpdatedAt: string): Prisma.BillingOccurrenceWhereInput {
  return {
    id: current.id,
    tenantId: actor.tenantId,
    updatedAt: new Date(expectedUpdatedAt),
    status: { not: 'CANCELLED' },
  };
}

function futureValueWhere(
  current: DbRecord,
  actor: BillingOccurrenceActor,
  today: DateOnly,
): Prisma.BillingOccurrenceWhereInput {
  const selectedDate = asDateOnly(current.operativeExpectedDate);
  const lowerBound = compareDateOnly(selectedDate, today) > 0 ? selectedDate : today;
  return {
    id: { not: current.id },
    tenantId: actor.tenantId,
    companyId: current.companyId,
    clientServiceId: current.clientServiceId,
    feeLineId: current.feeLineId,
    scheduleEntryKey: current.scheduleEntryKey,
    generationKey: current.generationKey,
    status: 'OPEN',
    operativeExpectedDate: { gte: parseDateOnly(lowerBound) },
  };
}

async function runInSerializableTransaction<T>(db: Db, callback: (tx: BillingOccurrenceDb) => Promise<T>): Promise<T> {
  const database = toDb(db);
  if (typeof database.$transaction === 'function') {
    return database.$transaction(callback, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  return callback(database);
}

export async function updateBillingOccurrence(
  id: string,
  rawInput: UpdateBillingOccurrenceInput,
  actor: BillingOccurrenceActor,
  db: Db = prisma,
): Promise<BillingOccurrenceDto> {
  const input = updateBillingOccurrenceSchema.parse(rawInput);
  const current = await findMutationRecord(id, actor, db);
  const { data, valueData, next } = buildMutationData(current, input, actor);
  // Capture the Singapore civil date once so every future-row predicate in
  // this mutation uses one consistent historical boundary.
  const today = currentDateInSingapore();
  const result = await runInSerializableTransaction(db, async (tx) => {
    const selected = await tx.billingOccurrence.updateMany({ where: optimisticWhere(current, actor, input.expectedUpdatedAt), data });
    if (selected.count !== 1) {
      throw new ApiError(ErrorCodes.VERSION_CONFLICT, 'Billing occurrence was changed by another user', 409);
    }

    let futureCount = 0;
    let futureIds: string[] = [];
    if (input.updateScope === 'THIS_AND_FUTURE' && Object.keys(valueData).some((key) => key !== 'updatedAt')) {
      const futureWhere = futureValueWhere(current, actor, today);
      const futureRows = await tx.billingOccurrence.findMany({ where: futureWhere, select: { id: true } });
      futureIds = (Array.isArray(futureRows) ? futureRows : [])
        .map((row) => (row as { id?: unknown }).id)
        .filter((rowId): rowId is string => typeof rowId === 'string' && rowId !== current.id);
      if (futureIds.length > 0) {
        const future = await tx.billingOccurrence.updateMany({
          where: { ...futureWhere, id: { in: futureIds } },
          data: valueData,
        });
        if (future.count !== futureIds.length) {
          throw new ApiError(ErrorCodes.VERSION_CONFLICT, 'Future billing occurrences were changed by another user', 409);
        }
        futureCount = future.count;
      }
    }

    const affectedCount = 1 + futureCount;
    const affectedIds = [current.id, ...futureIds];
    await createAuditLog({
      tenantId: actor.tenantId,
      userId: actor.userId,
      companyId: current.companyId,
      action: 'UPDATE',
      entityType: 'BillingOccurrence',
      entityId: current.id,
      entityName: current.feeLine?.description ?? current.billingPeriodKey,
      reason: input.reason ?? undefined,
      summary: 'Updated manual billing tracking occurrence',
      changes: auditChanges(current, next),
      metadata: {
        updateScope: input.updateScope,
        affectedCount,
        affectedIds,
        reason: input.reason,
      },
    }, tx as unknown as Prisma.TransactionClient);
    return next;
  });
  return toBillingOccurrenceDto(result);
}

export async function resetBillingOverride(
  id: string,
  rawInput: ResetBillingOverrideInput,
  actor: BillingOccurrenceActor,
  db: Db = prisma,
): Promise<BillingOccurrenceDto> {
  const input = resetBillingOverrideSchema.parse(rawInput);
  const current = await findMutationRecord(id, actor, db);
  const now = new Date();
  const data: Record<string, unknown> = { updatedAt: now };
  if (input.target === 'DATE' || input.target === 'ALL') {
    data.operativeExpectedDate = parseDateOnly(asDateOnly(current.calculatedExpectedDate));
    data.dateOverridden = false;
    data.dateOverrideReason = null;
    data.dateOverriddenById = null;
    data.dateOverriddenAt = null;
  }
  if (input.target === 'VALUE' || input.target === 'ALL') {
    data.operativeAmount = current.baseAmount;
    data.operativeCurrency = current.baseCurrency;
    data.valueOverridden = false;
    data.valueOverrideReason = null;
    data.valueOverriddenById = null;
    data.valueOverriddenAt = null;
  }
  const next = { ...current, ...data } as DbRecord;

  await runInSerializableTransaction(db, async (tx) => {
    const updated = await tx.billingOccurrence.updateMany({
      where: optimisticWhere(current, actor, input.expectedUpdatedAt),
      data,
    });
    if (updated.count !== 1) {
      throw new ApiError(ErrorCodes.VERSION_CONFLICT, 'Billing occurrence was changed by another user', 409);
    }
    await createAuditLog({
      tenantId: actor.tenantId,
      userId: actor.userId,
      companyId: current.companyId,
      action: 'UPDATE',
      entityType: 'BillingOccurrence',
      entityId: current.id,
      entityName: current.feeLine?.description ?? current.billingPeriodKey,
      reason: input.reason,
      summary: 'Reset manual billing tracking override',
      changes: auditChanges(current, next),
      metadata: {
        resetTarget: input.target,
        updateScope: 'THIS_OCCURRENCE',
        affectedCount: 1,
        affectedIds: [current.id],
        reason: input.reason,
      },
    }, tx as unknown as Prisma.TransactionClient);
  });
  return toBillingOccurrenceDto(next);
}

export const searchBillingOccurrences = listBillingOccurrences;
export const getBilling = getBillingOccurrence;
export const updateBilling = updateBillingOccurrence;
