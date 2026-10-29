export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type ReasoningDefaults = Record<string, { modelId: string; effort: ReasoningEffort }>;
export const REASONING_LABELS: Record<ReasoningEffort, string> = {
  none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum',
};

export function readReasoningDefaults(value: unknown): ReasoningDefaults {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, { modelId: string; effort: ReasoningEffort }] => {
    const item = entry[1];
    return Boolean(item && typeof item === 'object' && typeof item.modelId === 'string' && REASONING_EFFORTS.includes(item.effort));
  }));
}

export function reasoningGroupForOperation(operation?: string): string {
  if (operation === 'business_assistant_answer') return 'businessAssistant';
  if (operation?.startsWith('bizfile_')) return 'bizfileExtraction';
  if (operation?.includes('research')) return 'research';
  if (operation?.includes('extraction') || operation?.includes('ocr')) return 'ocr';
  return 'general';
}

export function getConfiguredReasoningEffort(settings: unknown, modelId: string, operation?: string): ReasoningEffort | undefined {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
  const defaults = readReasoningDefaults((settings as Record<string, unknown>).reasoningDefaults);
  const selected = defaults[reasoningGroupForOperation(operation)];
  return selected?.modelId === modelId ? selected.effort : undefined;
}
