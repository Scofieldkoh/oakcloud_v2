import type { Prisma } from '@/generated/prisma';

export const SORT_FIELDS = new Set([
  'uen',
  'entityName',
  'entityStatus',
  'entityType',
  'companyTypeDescription',
  'registrationIncorporateDate',
  'block',
  'streetName',
  'levelNo',
  'unitNo',
  'buildingName',
  'postalCode',
  'address',
  'accountDueDate',
  'annualReturnDate',
  'primarySsicCode',
  'primarySsicDescription',
  'secondarySsicCode',
  'secondarySsicDescription',
  'noOfOfficers',
  'formerEntityName1',
  'uenOfAuditFirm1',
  'dataAsOf',
  'createdAt',
  'updatedAt',
]);

/** Fields with a free-text filter matched using contains/insensitive. */
const TEXT_FILTER_FIELDS = [
  'uen',
  'entityName',
  'entityStatus',
  'entityType',
  'companyTypeDescription',
  'address',
  'primarySsicCode',
  'primarySsicDescription',
  'secondarySsicCode',
  'secondarySsicDescription',
  'noOfOfficers',
  'formerEntityName1',
  'uenOfAuditFirm1',
  'block',
  'streetName',
  'levelNo',
  'unitNo',
  'buildingName',
  'postalCode',
] as const;

/** Date fields stored as plain ISO YYYY-MM-DD strings. */
const STRING_DATE_FIELDS = [
  'registrationIncorporateDate',
  'accountDueDate',
  'annualReturnDate',
] as const;

function dayStartIso(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

function dayEndIso(dateString: string): Date {
  return new Date(`${dateString}T23:59:59.999Z`);
}

function addDayRange(
  and: Prisma.AcraEntityWhereInput[],
  field: 'createdAt' | 'updatedAt',
  from: string | undefined,
  to: string | undefined
): void {
  if (!from && !to) return;
  const range: Prisma.DateTimeFilter = {};
  if (from) range.gte = dayStartIso(from);
  if (to) range.lte = dayEndIso(to);
  and.push({ [field]: range });
}

/** Build the shared ACRA list/export filter from URL query parameters. */
export function buildAcraEntityWhere(searchParams: URLSearchParams): Prisma.AcraEntityWhereInput {
  const search = searchParams.get('search')?.trim() || undefined;
  const and: Prisma.AcraEntityWhereInput[] = [];

  if (search) {
    and.push({
      OR: [
        { entityName: { contains: search, mode: 'insensitive' } },
        { uen: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  for (const field of TEXT_FILTER_FIELDS) {
    const value = searchParams.get(field)?.trim();
    if (!value) continue;
    and.push({ [field]: { contains: value, mode: 'insensitive' } } as Prisma.AcraEntityWhereInput);
  }

  for (const field of STRING_DATE_FIELDS) {
    const from = searchParams.get(`${field}From`) || undefined;
    const to = searchParams.get(`${field}To`) || undefined;
    if (!from && !to) continue;
    const range: Prisma.StringFilter = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    and.push({ [field]: range } as Prisma.AcraEntityWhereInput);
  }

  // data_as_of is stored as an ISO string with a fixed +08:00 offset.
  const dataAsOfFrom = searchParams.get('dataAsOfFrom') || undefined;
  const dataAsOfTo = searchParams.get('dataAsOfTo') || undefined;
  if (dataAsOfFrom || dataAsOfTo) {
    const range: Prisma.StringFilter = {};
    if (dataAsOfFrom) range.gte = `${dataAsOfFrom}T00:00:00+08:00`;
    if (dataAsOfTo) range.lte = `${dataAsOfTo}T23:59:59+08:00`;
    and.push({ dataAsOf: range });
  }

  addDayRange(
    and,
    'createdAt',
    searchParams.get('createdAtFrom') || undefined,
    searchParams.get('createdAtTo') || undefined
  );
  addDayRange(
    and,
    'updatedAt',
    searchParams.get('updatedAtFrom') || undefined,
    searchParams.get('updatedAtTo') || undefined
  );

  return and.length > 0 ? { AND: and } : {};
}

export function getAcraSort(searchParams: URLSearchParams): {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
} {
  const rawSortBy = searchParams.get('sortBy') || 'entityName';
  const sortByIsValid = SORT_FIELDS.has(rawSortBy);

  return {
    sortBy: sortByIsValid ? rawSortBy : 'entityName',
    sortOrder: sortByIsValid && searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc',
  };
}
