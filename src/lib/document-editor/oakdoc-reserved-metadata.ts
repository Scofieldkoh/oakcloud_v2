import { ValidationError } from '@/lib/errors';
import { OAKDOC_ERROR_REASONS } from '@/types/oakdoc';

/**
 * C01 server-reserved namespaces.
 *
 * Only trusted OakDoc services may create or change these keys. Generic JSON
 * writers may round-trip them unchanged or omit them (existing values are
 * preserved), but can never add, alter or remove them.
 */
export const RESERVED_TEMPLATE_CONTENT_JSON_KEYS = [
  'oakDoc',
  'documentEngine',
  'oakDocMigration',
  'oakDocSeedMigration',
  'oakDocValidation',
  'oakDocPartials',
] as const;

export const RESERVED_GENERATED_METADATA_KEYS = [
  'documentEngine',
  'oakDocGenerated',
  'oakDocReviewDraft',
  'oakDocMigration',
  'oakDocPdfRendition',
  'oakDocValidation',
  'oakDocCloneSource',
] as const;

export const RESERVED_GENERATED_CONTENT_JSON_KEYS = [
  'documentEngine',
  'oakDocDraftSha256',
] as const;

/** Authority that a duplicated/cloned record must never inherit. */
export const TEMPLATE_AUTHORITY_KEYS = [
  'oakDocMigration',
  'oakDocSeedMigration',
  'oakDocValidation',
] as const;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function reservedError(field: string, keys: string[]): ValidationError {
  return new ValidationError(
    `${field} contains server-managed OakDoc fields that cannot be changed here`,
    { reason: OAKDOC_ERROR_REASONS.RESERVED_METADATA, field, keys },
  );
}

/**
 * Merge a user-supplied JSON object over the stored one while protecting
 * reserved keys. Returns the object to persist (or null when the caller
 * cleared it and nothing reserved exists).
 */
export function mergeUserJsonPreservingReserved(
  existing: unknown,
  next: unknown,
  reservedKeys: readonly string[],
  field: string,
): JsonRecord | null {
  const current = isRecord(existing) ? existing : {};
  if (next !== null && next !== undefined && !isRecord(next)) {
    throw new ValidationError(`${field} must be an object`);
  }
  const incoming = isRecord(next) ? next : {};

  const violations = reservedKeys.filter((key) => (
    Object.prototype.hasOwnProperty.call(incoming, key)
    && stableStringify(incoming[key]) !== stableStringify(current[key])
  ));
  if (violations.length > 0) throw reservedError(field, violations);

  const merged: JsonRecord = { ...incoming };
  for (const key of reservedKeys) {
    if (current[key] !== undefined) merged[key] = current[key];
  }
  if (next === null && Object.keys(merged).length === 0) return null;
  return merged;
}

/** Reject any reserved key on a create request from an untrusted caller. */
export function assertNoReservedKeys(
  value: unknown,
  reservedKeys: readonly string[],
  field: string,
): void {
  if (!isRecord(value)) return;
  const present = reservedKeys.filter((key) => value[key] !== undefined);
  if (present.length > 0) throw reservedError(field, present);
}

export function stripKeys<T>(value: T, keys: readonly string[]): T {
  if (!isRecord(value)) return value;
  const copy: JsonRecord = { ...value };
  for (const key of keys) delete copy[key];
  return copy as T;
}
