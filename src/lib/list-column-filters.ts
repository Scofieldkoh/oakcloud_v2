/**
 * Prisma conditions for the column filters shared by list pages: a person's
 * name typed into a "Created by" filter, and a from/to day range.
 */

/** Matches a user whose first or last name contains `term` (case-insensitive). */
export function personNameFilter(term: string) {
  const value = term.trim();
  return {
    OR: [
      { firstName: { contains: value, mode: 'insensitive' as const } },
      { lastName: { contains: value, mode: 'insensitive' as const } },
    ],
  };
}

/** A whole-day range from YYYY-MM-DD bounds, or undefined when neither is set. */
export function dayRangeFilter(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00.000`) } : {}),
    ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
  };
}
