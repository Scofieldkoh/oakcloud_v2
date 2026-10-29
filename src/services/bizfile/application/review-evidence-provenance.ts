import type { FullStateFieldEvidence, FullStateSourceIdentity } from './full-state-independent-review';

interface BoundLaterHumanEdit {
  fieldPath?: unknown;
  previousValue?: unknown;
  resultingValue?: unknown;
  sourceRevision?: unknown;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * A later-human-edit attribution is exculpatory evidence, so it must be bound
 * to the exact field transition and the same independently verified source
 * revision. Loose timestamps or actor labels are not sufficient.
 */
export function hasBoundLaterHumanEditEvidence(
  field: FullStateFieldEvidence,
  source: FullStateSourceIdentity,
  operationCompletedAt: string,
): boolean {
  const edit = field.laterHumanEdit as (FullStateFieldEvidence['laterHumanEdit'] & BoundLaterHumanEdit) | undefined;
  if (!edit || edit.actorType !== 'HUMAN' || !edit.actorId?.trim() || !edit.auditEventId?.trim()) return false;
  if (edit.operationCompletedAt !== operationCompletedAt) return false;
  if (edit.fieldPath !== field.path || edit.sourceRevision !== source.sourceRevision) return false;
  if (stable(edit.previousValue) !== stable(field.beforeValue) || stable(edit.resultingValue) !== stable(field.afterValue)) return false;

  const completedAt = Date.parse(operationCompletedAt);
  const occurredAt = Date.parse(edit.occurredAt);
  return Number.isFinite(completedAt) && Number.isFinite(occurredAt) && occurredAt > completedAt;
}

export function stripUnprovenLaterHumanEditAttribution(
  field: FullStateFieldEvidence,
  source: FullStateSourceIdentity,
  operationCompletedAt: string,
): FullStateFieldEvidence {
  if (!field.laterHumanEdit || hasBoundLaterHumanEditEvidence(field, source, operationCompletedAt)) return field;
  return { ...field, laterHumanEdit: undefined };
}
