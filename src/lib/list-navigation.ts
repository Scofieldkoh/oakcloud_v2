export type ListPath = '/contacts' | '/companies';

const INTERNAL_ORIGIN = 'https://oakcloud.local';

export function buildDetailHref(detailPath: string, returnTo: string): string {
  const search = new URLSearchParams({ returnTo });
  return `${detailPath}?${search.toString()}`;
}

export function getSafeListReturnUrl(
  value: string | null | undefined,
  expectedPath: ListPath,
): string {
  if (!value) return expectedPath;

  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    if (
      parsed.origin !== INTERNAL_ORIGIN ||
      parsed.pathname !== expectedPath ||
      parsed.hash
    ) {
      return expectedPath;
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return expectedPath;
  }
}
