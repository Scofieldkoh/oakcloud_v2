/**
 * Vendor name normalization utilities.
 *
 * Note: `normalizeVendorName` is intentionally aggressive; it is used for
 * comparisons (duplicate detection, alias matching), not for display.
 */

export function normalizeVendorName(name: string): string {
  const input = (name ?? '');

  // Drop short acronym-style parentheticals: "Foo Bar (ACCA)" -> "Foo Bar"
  // This improves consistency when AI variably includes/excludes acronyms.
  const withoutAcronyms = input.replace(/\(([^)]*)\)/g, (match, inner: string) => {
    const compact = String(inner ?? '').replace(/[\s.]/g, '');
    if (/^[A-Z0-9]{2,6}$/.test(compact)) return '';
    return match;
  });

  return withoutAcronyms
    .toLowerCase()
    .replace(/\b(pte|ltd|llc|inc|corp|co)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}
