/**
 * String similarity helpers (pure functions).
 *
 * Used for fuzzy matching of extracted vendor names and duplicate detection.
 */

/**
 * Jaro-Winkler similarity (0..1).
 * Higher is more similar; 1 means exact match.
 */
export function jaroWinkler(s1: string, s2: string): number {
  const a = s1 ?? '';
  const b = s2 ?? '';
  const jaro = jaroSimilarity(a, b);
  const prefixLength = Math.min(4, commonPrefixLength(a, b));
  return jaro + prefixLength * 0.1 * (1 - jaro);
}

function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
}

function commonPrefixLength(s1: string, s2: string): number {
  let i = 0;
  while (i < s1.length && i < s2.length && s1[i] === s2[i]) i++;
  return i;
}

