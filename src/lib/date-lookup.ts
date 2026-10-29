/**
 * Coerce a caller-supplied date string into a safe lookup date.
 *
 * Invalid dates fall back to "now" so callers can preserve best-effort
 * behavior instead of failing an entire request on malformed upstream data.
 */
export function resolveLookupDate(rawValue?: string | null): {
  date: Date;
  isoDate: string;
  rawValue?: string | null;
  usedFallback: boolean;
} {
  const parsed = rawValue ? new Date(rawValue) : new Date();

  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date();
    return {
      date: fallback,
      isoDate: fallback.toISOString().split('T')[0],
      rawValue,
      usedFallback: true,
    };
  }

  return {
    date: parsed,
    isoDate: parsed.toISOString().split('T')[0],
    rawValue,
    usedFallback: false,
  };
}
