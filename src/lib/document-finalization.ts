const FINALIZATION_DIAGNOSTIC_KEYS = [
  'missingPlaceholders',
  'missingPartials',
  'circularPartials',
  'syntaxErrors',
  'unknownPlaceholders',
] as const;

export function metadataHasUnresolvedTemplateData(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const data = metadata as Record<string, unknown>;
  return FINALIZATION_DIAGNOSTIC_KEYS.some((key) => Array.isArray(data[key]) && data[key].length > 0);
}
