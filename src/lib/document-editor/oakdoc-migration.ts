import type { JsonValue } from '@/lib/validations/document-template';
import { isOakDocTemplate } from '@/lib/document-editor/oakdoc-template';

export const OAKDOC_MIGRATION_SCHEMA_VERSION = 1;

export type OakDocMigrationReadiness =
  | 'NOT_MIGRATED'
  | 'OAKDOC_DRAFT'
  | 'PARITY_CHECK_FAILED'
  | 'READY_FOR_SWITCHOVER'
  | 'OAKDOC_PRIMARY';

export type OakDocMigrationPreference = 'LEGACY' | 'OAKDOC';

export type OakDocMigrationInventoryStatus =
  | 'A4_ONLY'
  | 'OAKDOC_ONLY'
  | 'MIGRATED_PAIR'
  | 'MIGRATION_PENDING'
  | 'MIGRATION_VALIDATION_FAILED';

/** Version of the server-side migration checker (M1 static checks). */
export const OAKDOC_MIGRATION_CHECKER_VERSION = 'oakdoc-migration-static/1';

export interface OakDocMigrationValidation {
  checkedAt: string;
  passed: boolean;
  legacyTemplateVersion: number;
  oakDocTemplateVersion: number;
  issueCodes: string[];
  summary?: string;
  /**
   * `server` evidence was produced by the migration checker over exact
   * definition hashes. Anything else is a legacy self-reported result: it is
   * still read for existing routing but can never promote a template.
   */
  authority?: 'server';
  runId?: string;
  checkerVersion?: string;
  legacyDefinitionHash?: string;
  oakDocDefinitionHash?: string;
  /** Real-render comparison runs after L2; until then it stays pending. */
  renderCheck?: 'pending' | 'passed';
}

/** Current definition identities of a linked pair. */
export interface OakDocMigrationDefinitionHashes {
  legacyDefinitionHash: string;
  oakDocDefinitionHash: string;
}

export interface OakDocMigrationMetadata {
  schemaVersion: 1;
  legacyTemplateId: string;
  legacyTemplateVersion: number;
  linkedAt: string;
  preference: OakDocMigrationPreference;
  validation?: OakDocMigrationValidation;
  preferenceChangedAt?: string;
  preferenceChangedBy?: string;
  preferenceReason?: string;
}

export interface OakDocMigrationTemplateRecord {
  id: string;
  name: string;
  version: number;
  contentJson: unknown;
  content?: string;
  placeholders?: unknown;
  isActive?: boolean;
  deletedAt?: Date | string | null;
}

export interface OakDocMigrationInventoryItem {
  status: OakDocMigrationInventoryStatus;
  readiness: OakDocMigrationReadiness;
  legacyTemplate: {
    id: string;
    name: string;
    version: number;
    isActive?: boolean;
  } | null;
  oakDocTemplate: {
    id: string;
    name: string;
    version: number;
    isActive?: boolean;
  } | null;
  metadata: OakDocMigrationMetadata | null;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeIssueCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  )).sort();
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseValidation(value: unknown): OakDocMigrationValidation | undefined {
  if (!isRecord(value)) return undefined;
  const checkedAt = parseIsoDate(value.checkedAt);
  if (
    !checkedAt
    || typeof value.passed !== 'boolean'
    || !Number.isInteger(value.legacyTemplateVersion)
    || Number(value.legacyTemplateVersion) < 1
    || !Number.isInteger(value.oakDocTemplateVersion)
    || Number(value.oakDocTemplateVersion) < 1
  ) {
    return undefined;
  }

  const serverEvidence = value.authority === 'server'
    && typeof value.runId === 'string'
    && typeof value.checkerVersion === 'string'
    && typeof value.legacyDefinitionHash === 'string'
    && typeof value.oakDocDefinitionHash === 'string';

  return {
    checkedAt,
    passed: value.passed,
    legacyTemplateVersion: Number(value.legacyTemplateVersion),
    oakDocTemplateVersion: Number(value.oakDocTemplateVersion),
    issueCodes: sanitizeIssueCodes(value.issueCodes),
    ...(typeof value.summary === 'string' && value.summary.trim()
      ? { summary: value.summary.trim().slice(0, 1000) }
      : {}),
    ...(serverEvidence
      ? {
          authority: 'server' as const,
          runId: value.runId as string,
          checkerVersion: value.checkerVersion as string,
          legacyDefinitionHash: value.legacyDefinitionHash as string,
          oakDocDefinitionHash: value.oakDocDefinitionHash as string,
          renderCheck: value.renderCheck === 'passed' ? 'passed' as const : 'pending' as const,
        }
      : {}),
  };
}

export function isServerMigrationEvidence(
  validation: OakDocMigrationValidation | undefined,
): validation is OakDocMigrationValidation & Required<Pick<
  OakDocMigrationValidation,
  'authority' | 'runId' | 'checkerVersion' | 'legacyDefinitionHash' | 'oakDocDefinitionHash'
>> {
  return validation?.authority === 'server';
}

export function readOakDocMigrationMetadata(contentJson: unknown): OakDocMigrationMetadata | null {
  if (!isRecord(contentJson) || !isRecord(contentJson.oakDocMigration)) return null;
  const raw = contentJson.oakDocMigration;
  const linkedAt = parseIsoDate(raw.linkedAt);

  if (
    raw.schemaVersion !== OAKDOC_MIGRATION_SCHEMA_VERSION
    || typeof raw.legacyTemplateId !== 'string'
    || !raw.legacyTemplateId.trim()
    || !Number.isInteger(raw.legacyTemplateVersion)
    || Number(raw.legacyTemplateVersion) < 1
    || !linkedAt
    || (raw.preference !== 'LEGACY' && raw.preference !== 'OAKDOC')
  ) {
    return null;
  }

  const preferenceChangedAt = parseIsoDate(raw.preferenceChangedAt);
  return {
    schemaVersion: OAKDOC_MIGRATION_SCHEMA_VERSION,
    legacyTemplateId: raw.legacyTemplateId.trim(),
    legacyTemplateVersion: Number(raw.legacyTemplateVersion),
    linkedAt,
    preference: raw.preference,
    ...(parseValidation(raw.validation) ? { validation: parseValidation(raw.validation) } : {}),
    ...(preferenceChangedAt ? { preferenceChangedAt } : {}),
    ...(typeof raw.preferenceChangedBy === 'string' && raw.preferenceChangedBy.trim()
      ? { preferenceChangedBy: raw.preferenceChangedBy.trim() }
      : {}),
    ...(typeof raw.preferenceReason === 'string' && raw.preferenceReason.trim()
      ? { preferenceReason: raw.preferenceReason.trim().slice(0, 1000) }
      : {}),
  };
}

export function mergeOakDocMigrationMetadata(
  contentJson: unknown,
  metadata: OakDocMigrationMetadata,
): Record<string, JsonValue> {
  const base = isRecord(contentJson) ? { ...contentJson } : {};
  const validation = metadata.validation
    ? {
        checkedAt: metadata.validation.checkedAt,
        passed: metadata.validation.passed,
        legacyTemplateVersion: metadata.validation.legacyTemplateVersion,
        oakDocTemplateVersion: metadata.validation.oakDocTemplateVersion,
        issueCodes: metadata.validation.issueCodes,
        ...(metadata.validation.summary ? { summary: metadata.validation.summary } : {}),
        ...(isServerMigrationEvidence(metadata.validation)
          ? {
              authority: metadata.validation.authority,
              runId: metadata.validation.runId,
              checkerVersion: metadata.validation.checkerVersion,
              legacyDefinitionHash: metadata.validation.legacyDefinitionHash,
              oakDocDefinitionHash: metadata.validation.oakDocDefinitionHash,
              renderCheck: metadata.validation.renderCheck ?? 'pending',
            }
          : {}),
      }
    : undefined;

  return {
    ...(base as Record<string, JsonValue>),
    oakDocMigration: {
      schemaVersion: OAKDOC_MIGRATION_SCHEMA_VERSION,
      legacyTemplateId: metadata.legacyTemplateId,
      legacyTemplateVersion: metadata.legacyTemplateVersion,
      linkedAt: metadata.linkedAt,
      preference: metadata.preference,
      ...(validation ? { validation } : {}),
      ...(metadata.preferenceChangedAt
        ? { preferenceChangedAt: metadata.preferenceChangedAt }
        : {}),
      ...(metadata.preferenceChangedBy
        ? { preferenceChangedBy: metadata.preferenceChangedBy }
        : {}),
      ...(metadata.preferenceReason
        ? { preferenceReason: metadata.preferenceReason }
        : {}),
    },
  };
}

export function createOakDocMigrationMetadata(input: {
  legacyTemplateId: string;
  legacyTemplateVersion: number;
  linkedAt?: string;
}): OakDocMigrationMetadata {
  const legacyTemplateId = input.legacyTemplateId.trim();
  if (!legacyTemplateId) throw new Error('A legacy template ID is required');
  if (!Number.isInteger(input.legacyTemplateVersion) || input.legacyTemplateVersion < 1) {
    throw new Error('A valid legacy template version is required');
  }

  return {
    schemaVersion: OAKDOC_MIGRATION_SCHEMA_VERSION,
    legacyTemplateId,
    legacyTemplateVersion: input.legacyTemplateVersion,
    linkedAt: parseIsoDate(input.linkedAt) ?? new Date().toISOString(),
    preference: 'LEGACY',
  };
}

export function migrationValidationMatchesCurrentVersions(input: {
  metadata: OakDocMigrationMetadata;
  legacyTemplateVersion: number;
  oakDocTemplateVersion: number;
}): boolean {
  const validation = input.metadata.validation;
  return Boolean(
    validation
    && validation.legacyTemplateVersion === input.legacyTemplateVersion
    && validation.oakDocTemplateVersion === input.oakDocTemplateVersion,
  );
}

/**
 * Server evidence is bound to definition hashes, not record versions, so
 * metadata-only revisions (preference, activity) keep it and any content
 * edit invalidates it, however many toggles follow.
 */
export function migrationEvidenceMatchesDefinitions(
  metadata: OakDocMigrationMetadata,
  hashes: OakDocMigrationDefinitionHashes,
): boolean {
  const validation = metadata.validation;
  return isServerMigrationEvidence(validation)
    && validation.checkerVersion === OAKDOC_MIGRATION_CHECKER_VERSION
    && validation.legacyDefinitionHash === hashes.legacyDefinitionHash
    && validation.oakDocDefinitionHash === hashes.oakDocDefinitionHash;
}

export function getOakDocMigrationReadiness(input: {
  metadata: OakDocMigrationMetadata | null;
  legacyTemplateVersion?: number;
  oakDocTemplateVersion?: number;
  definitionHashes?: OakDocMigrationDefinitionHashes;
}): OakDocMigrationReadiness {
  const metadata = input.metadata;
  if (!metadata) return 'NOT_MIGRATED';

  const validation = metadata.validation;
  if (!validation) return 'OAKDOC_DRAFT';

  if (isServerMigrationEvidence(validation) && input.definitionHashes) {
    if (!migrationEvidenceMatchesDefinitions(metadata, input.definitionHashes)) {
      return 'OAKDOC_DRAFT';
    }
  } else if (
    input.legacyTemplateVersion !== undefined
    && input.oakDocTemplateVersion !== undefined
    && !migrationValidationMatchesCurrentVersions({
      metadata,
      legacyTemplateVersion: input.legacyTemplateVersion,
      oakDocTemplateVersion: input.oakDocTemplateVersion,
    })
  ) {
    return 'OAKDOC_DRAFT';
  }

  if (!validation.passed) return 'PARITY_CHECK_FAILED';
  return metadata.preference === 'OAKDOC' ? 'OAKDOC_PRIMARY' : 'READY_FOR_SWITCHOVER';
}

function templateSummary(template: OakDocMigrationTemplateRecord | undefined) {
  if (!template) return null;
  return {
    id: template.id,
    name: template.name,
    version: template.version,
    ...(template.isActive === undefined ? {} : { isActive: template.isActive }),
  };
}

function isDeleted(template: OakDocMigrationTemplateRecord): boolean {
  return template.deletedAt !== null && template.deletedAt !== undefined;
}

export function buildOakDocMigrationInventory(
  templates: readonly OakDocMigrationTemplateRecord[],
  options: { hashDefinition?: (template: OakDocMigrationTemplateRecord) => string } = {},
): OakDocMigrationInventoryItem[] {
  const activeRecords = templates.filter((template) => !isDeleted(template));
  const byId = new Map(activeRecords.map((template) => [template.id, template]));
  const oakDocs = activeRecords.filter((template) => isOakDocTemplate(template.contentJson));
  const legacyTemplates = activeRecords.filter((template) => !isOakDocTemplate(template.contentJson));
  const linkedLegacyIds = new Set<string>();
  const linkCounts = new Map<string, number>();
  for (const oakDoc of oakDocs) {
    const legacyId = readOakDocMigrationMetadata(oakDoc.contentJson)?.legacyTemplateId;
    if (legacyId) linkCounts.set(legacyId, (linkCounts.get(legacyId) ?? 0) + 1);
  }
  const result: OakDocMigrationInventoryItem[] = [];

  for (const oakDoc of oakDocs) {
    const metadata = readOakDocMigrationMetadata(oakDoc.contentJson);
    if (!metadata) {
      result.push({
        status: 'OAKDOC_ONLY',
        readiness: 'NOT_MIGRATED',
        legacyTemplate: null,
        oakDocTemplate: templateSummary(oakDoc),
        metadata: null,
        warnings: [],
      });
      continue;
    }

    linkedLegacyIds.add(metadata.legacyTemplateId);
    const legacy = byId.get(metadata.legacyTemplateId);
    const warnings: string[] = [];
    if (!legacy) warnings.push('Linked legacy template is missing or deleted.');
    if (legacy && isOakDocTemplate(legacy.contentJson)) {
      warnings.push('Migration metadata points to another OakDoc template instead of legacy A4.');
    }
    if (legacy && metadata.legacyTemplateVersion !== legacy.version) {
      warnings.push(
        `Legacy template changed from linked version ${metadata.legacyTemplateVersion} to ${legacy.version}; parity must be revalidated.`,
      );
    }

    if ((linkCounts.get(metadata.legacyTemplateId) ?? 0) > 1) {
      warnings.push('More than one OakDoc template is linked to this legacy template; keep exactly one.');
    }
    if (metadata.validation && !isServerMigrationEvidence(metadata.validation)) {
      warnings.push('Parity result was self-reported; run the server migration check before switching over.');
    }

    const readiness = getOakDocMigrationReadiness({
      metadata,
      ...(legacy ? { legacyTemplateVersion: legacy.version } : {}),
      oakDocTemplateVersion: oakDoc.version,
      ...(legacy && options.hashDefinition
        ? {
            definitionHashes: {
              legacyDefinitionHash: options.hashDefinition(legacy),
              oakDocDefinitionHash: options.hashDefinition(oakDoc),
            },
          }
        : {}),
    });

    const status: OakDocMigrationInventoryStatus =
      readiness === 'PARITY_CHECK_FAILED'
        ? 'MIGRATION_VALIDATION_FAILED'
        : readiness === 'READY_FOR_SWITCHOVER' || readiness === 'OAKDOC_PRIMARY'
          ? 'MIGRATED_PAIR'
          : 'MIGRATION_PENDING';

    result.push({
      status,
      readiness,
      legacyTemplate: templateSummary(legacy),
      oakDocTemplate: templateSummary(oakDoc),
      metadata,
      warnings,
    });
  }

  for (const legacy of legacyTemplates) {
    if (linkedLegacyIds.has(legacy.id)) continue;
    result.push({
      status: 'A4_ONLY',
      readiness: 'NOT_MIGRATED',
      legacyTemplate: templateSummary(legacy),
      oakDocTemplate: null,
      metadata: null,
      warnings: [],
    });
  }

  return result.sort((left, right) => {
    const leftName = left.legacyTemplate?.name ?? left.oakDocTemplate?.name ?? '';
    const rightName = right.legacyTemplate?.name ?? right.oakDocTemplate?.name ?? '';
    return leftName.localeCompare(rightName, 'en-SG');
  });
}

export function assertOakDocCanBecomePrimary(input: {
  metadata: OakDocMigrationMetadata | null;
  legacyTemplateVersion: number;
  oakDocTemplateVersion: number;
  definitionHashes?: OakDocMigrationDefinitionHashes;
}): void {
  const message = 'OakDoc cannot become primary until the current legacy and OakDoc versions pass server parity validation.';
  const readiness = getOakDocMigrationReadiness(input);
  if (readiness !== 'READY_FOR_SWITCHOVER' && readiness !== 'OAKDOC_PRIMARY') {
    throw new Error(message);
  }
  // Self-reported (legacy v1) passes never promote.
  if (
    !input.metadata
    || !input.definitionHashes
    || !migrationEvidenceMatchesDefinitions(input.metadata, input.definitionHashes)
  ) {
    throw new Error(message);
  }
}
