import type { ContactIdentityCandidate, ContactMatchPreview } from '@/types/contact-identity';

const MAX_PREVIEW_BATCH_SIZE = 100;
type ContactPreviewFetcher = (input: string, init: RequestInit) => Promise<Response>;

function comparableName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function isExactIdentifierContactMatch(
  incomingName: string,
  match: ContactMatchPreview | null | undefined,
): boolean {
  if (!match?.contact || match.blockedByIdentifierConflict || match.conflicts.length > 0) return false;
  const identifierMatches = match.reasons.some((reason) => reason === 'IDENTIFIER' || reason === 'CORPORATE_UEN');
  return identifierMatches && comparableName(incomingName) === comparableName(match.contact.fullName);
}

export async function fetchBizFileContactMatchPreviews(
  candidates: ContactIdentityCandidate[],
  fetcher: ContactPreviewFetcher = fetch,
  tenantId?: string,
): Promise<Record<string, ContactMatchPreview | null>> {
  const batches: ContactIdentityCandidate[][] = [];
  for (let index = 0; index < candidates.length; index += MAX_PREVIEW_BATCH_SIZE) {
    batches.push(candidates.slice(index, index + MAX_PREVIEW_BATCH_SIZE));
  }

  const results = await Promise.all(batches.map(async (batch) => {
    const response = await fetcher('/api/contacts/match-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates: batch, ...(tenantId ? { tenantId } : {}) }),
    });
    if (!response.ok) throw new Error('Unable to preview contact matches');
    const result = await response.json() as { matches?: Record<string, ContactMatchPreview | null> };
    if (!result.matches) throw new Error('Unable to preview contact matches');
    return result.matches;
  }));

  return Object.assign({}, ...results);
}
