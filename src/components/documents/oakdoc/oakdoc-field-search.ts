/** Whether any of a field's texts (label, tag, group) contains every word of the panel search. */
export function matchesOakDocFieldQuery(query: string, ...texts: ReadonlyArray<string | undefined>): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = texts.filter(Boolean).join(' ').toLowerCase();
  return words.every((word) => haystack.includes(word));
}
