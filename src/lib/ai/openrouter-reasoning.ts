import { REASONING_EFFORTS, type ReasoningEffort } from './reasoning-settings';

export function parseReasoningEfforts(model: unknown): ReasoningEffort[] {
  if (!model || typeof model !== 'object') return [];
  const reasoning = (model as { reasoning?: { supported_efforts?: unknown; mandatory?: boolean } }).reasoning;
  if (!reasoning || typeof reasoning !== 'object') return [];
  const supported = reasoning.supported_efforts === null ? REASONING_EFFORTS : reasoning.supported_efforts;
  if (!Array.isArray(supported)) return [];
  return REASONING_EFFORTS.filter((effort) => supported.includes(effort) && !(effort === 'none' && reasoning.mandatory));
}

let cached: { expiresAt: number; models: Map<string, ReasoningEffort[]> } | undefined;
let pending: Promise<Map<string, ReasoningEffort[]> | null> | undefined;

/** Public metadata only; never sends connector credentials or document content. */
export async function getOpenRouterReasoningCatalog(): Promise<Map<string, ReasoningEffort[]> | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.models;
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      const body = await response.json() as { data?: unknown };
      if (!Array.isArray(body.data)) return null;
      const models = new Map<string, ReasoningEffort[]>();
      for (const model of body.data) {
        if (model && typeof model === 'object' && typeof model.id === 'string') models.set(model.id, parseReasoningEfforts(model));
      }
      cached = { expiresAt: Date.now() + 5 * 60_000, models };
      return models;
    } catch {
      return null;
    } finally {
      pending = undefined;
    }
  })();
  return pending;
}
