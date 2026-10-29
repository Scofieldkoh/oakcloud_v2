/**
 * Entity name helpers (for vendor/customer canonicalization).
 */

const LEGAL_STOPWORDS = new Set([
  'pte',
  'ltd',
  'llc',
  'inc',
  'corp',
  'co',
  'company',
  'limited',
  'private',
]);

function stripAcronymParentheticals(input: string): string {
  // Drop short acronym-style parentheticals: "Foo Bar (ACCA)" -> "Foo Bar"
  return input.replace(/\(([^)]*)\)/g, (match, inner: string) => {
    const compact = String(inner ?? '').replace(/[\s.]/g, '');
    if (/^[A-Z0-9]{2,6}$/.test(compact)) return '';
    return match;
  });
}

export function tokenizeEntityName(name: string): string[] {
  const cleaned = stripAcronymParentheticals(name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!cleaned) return [];

  return cleaned
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !LEGAL_STOPWORDS.has(t));
}

export function jaccardSimilarity(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);

  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;

  const union = new Set<string>([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

