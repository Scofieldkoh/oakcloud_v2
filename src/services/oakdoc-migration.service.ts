import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { createLogger } from '@/lib/logger';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import {
  assertOakDocCanBecomePrimary,
  buildOakDocMigrationInventory,
  createOakDocMigrationMetadata,
  getOakDocMigrationReadiness,
  mergeOakDocMigrationMetadata,
  OAKDOC_MIGRATION_CHECKER_VERSION,
  readOakDocMigrationMetadata,
  type OakDocMigrationDefinitionHashes,
  type OakDocMigrationInventoryItem,
  type OakDocMigrationPreference,
  type OakDocMigrationTemplateRecord,
  type OakDocMigrationValidation,
} from '@/lib/document-editor/oakdoc-migration';
import {
  isOakDocTemplate,
  readOakDocTemplateMetadata,
} from '@/lib/document-editor/oakdoc-template';
import { inspectOakDocPackage, OakDocPackageError } from '@/lib/document-editor/oakdoc-package-policy';
import { diagnoseOakDocPackage } from '@/lib/document-editor/oakdoc-package-diagnostics';
import { diagnoseOakDocTags } from '@/lib/document-editor/oakdoc-field-registry';
import { TEMPLATE_AUTHORITY_KEYS, stripKeys } from '@/lib/document-editor/oakdoc-reserved-metadata';
import {
  OAKDOC_STANDARD_TEMPLATE_MIGRATIONS,
  readOakDocSeedMigrationMetadata,
  validateOakDocMigrationMaster,
} from '@/lib/document-editor/oakdoc-standard-template-migrations';
import {
  getDocumentTemplateById,
  updateDocumentTemplate,
  type TenantAwareParams,
} from '@/services/document-template.service';
import { downloadOakDocTemplate } from '@/services/oakdoc-template.service';
import type { DocumentTemplate } from '@/generated/prisma';

const log = createLogger('oakdoc-migration');

const MASTER_EXPECTED_DIAGNOSTICS = new Set(['UNRESOLVED_OAKDOC_CONTROL', 'UNRESOLVED_LEGACY_PLACEHOLDER']);

type DefinitionRecord = Pick<OakDocMigrationTemplateRecord, 'content' | 'placeholders' | 'contentJson'>;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(record[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Hash of what a template renders from: body, placeholder definitions and
 * content JSON (for OakDoc this includes the asset hash and field manifest).
 * Migration authority keys are excluded, so recording evidence or changing
 * preference never changes the definition identity.
 */
export function hashTemplateDefinition(template: DefinitionRecord): string {
  return createHash('sha256').update(stableStringify({
    content: template.content ?? '',
    placeholders: template.placeholders ?? [],
    contentJson: stripKeys(template.contentJson ?? null, TEMPLATE_AUTHORITY_KEYS),
  })).digest('hex');
}

function definitionHashes(legacy: DefinitionRecord, oakDoc: DefinitionRecord): OakDocMigrationDefinitionHashes {
  return {
    legacyDefinitionHash: hashTemplateDefinition(legacy),
    oakDocDefinitionHash: hashTemplateDefinition(oakDoc),
  };
}

function cleanReason(value: string): string {
  const reason = value.trim();
  if (!reason) throw new ValidationError('A reason is required for migration control changes');
  return reason.slice(0, 1000);
}

async function requireTemplate(id: string, tenantId: string): Promise<DocumentTemplate> {
  const template = await getDocumentTemplateById(id, tenantId);
  if (!template) throw new NotFoundError('Template not found');
  return template;
}

async function requireMigrationPair(
  oakDocTemplateId: string,
  tenantId: string,
): Promise<{
  oakDoc: DocumentTemplate;
  legacy: DocumentTemplate;
  metadata: NonNullable<ReturnType<typeof readOakDocMigrationMetadata>>;
}> {
  const oakDoc = await requireTemplate(oakDocTemplateId, tenantId);
  if (!isOakDocTemplate(oakDoc.contentJson)) {
    throw new ValidationError('Migration controls can only be applied to an OakDoc template');
  }
  const metadata = readOakDocMigrationMetadata(oakDoc.contentJson);
  if (!metadata) throw new ValidationError('OakDoc template is not linked to a legacy template');

  // A missing (deleted or foreign-tenant) source is a blocker, never an
  // omitted check.
  const legacy = await getDocumentTemplateById(metadata.legacyTemplateId, tenantId);
  if (!legacy) {
    throw new ConflictError('The linked legacy template no longer exists in this workspace');
  }
  if (isOakDocTemplate(legacy.contentJson)) {
    throw new ValidationError('Migration metadata does not reference a legacy A4 template');
  }
  return { oakDoc, legacy, metadata };
}

/** OakDoc templates (other than `exceptId`) that link to the same legacy source. */
async function findOtherLinkedOakDocIds(
  legacyTemplateId: string,
  tenantId: string,
  exceptId: string,
): Promise<string[]> {
  const candidates = await prisma.documentTemplate.findMany({
    where: {
      tenantId,
      deletedAt: null,
      id: { not: exceptId },
      contentJson: { path: ['oakDocMigration', 'legacyTemplateId'], equals: legacyTemplateId },
    },
    select: { id: true, contentJson: true },
  });
  return candidates
    .filter((candidate) => (
      isOakDocTemplate(candidate.contentJson)
      && readOakDocMigrationMetadata(candidate.contentJson)?.legacyTemplateId === legacyTemplateId
    ))
    .map((candidate) => candidate.id);
}

export async function getOakDocMigrationInventory(
  tenantId: string,
): Promise<OakDocMigrationInventoryItem[]> {
  const templates = await prisma.documentTemplate.findMany({
    where: { tenantId, deletedAt: null },
    select: {
      id: true,
      name: true,
      version: true,
      content: true,
      placeholders: true,
      contentJson: true,
      isActive: true,
      deletedAt: true,
    },
    orderBy: { name: 'asc' },
  });
  return buildOakDocMigrationInventory(templates, { hashDefinition: hashTemplateDefinition });
}

export async function linkOakDocMigration(input: {
  oakDocTemplateId: string;
  legacyTemplateId: string;
  expectedRevision: number;
  reason: string;
}, params: TenantAwareParams): Promise<DocumentTemplate> {
  if (input.oakDocTemplateId === input.legacyTemplateId) {
    throw new ValidationError('OakDoc and legacy templates must be different templates');
  }

  const [oakDoc, legacy] = await Promise.all([
    requireTemplate(input.oakDocTemplateId, params.tenantId),
    requireTemplate(input.legacyTemplateId, params.tenantId),
  ]);
  if (!isOakDocTemplate(oakDoc.contentJson)) {
    throw new ValidationError('The target template is not an OakDoc template');
  }
  if (isOakDocTemplate(legacy.contentJson)) {
    throw new ValidationError('The migration source must be a legacy A4 template');
  }

  const existing = readOakDocMigrationMetadata(oakDoc.contentJson);
  if (existing && existing.legacyTemplateId !== legacy.id) {
    throw new ConflictError('OakDoc template is already linked to a different legacy template');
  }
  const others = await findOtherLinkedOakDocIds(legacy.id, params.tenantId, oakDoc.id);
  if (others.length > 0) {
    throw new ConflictError('Another OakDoc template is already linked to this legacy template', {
      linkedOakDocTemplateIds: others,
    });
  }
  if (
    existing
    && existing.legacyTemplateId === legacy.id
    && existing.legacyTemplateVersion === legacy.version
  ) {
    return oakDoc;
  }

  const metadata = createOakDocMigrationMetadata({
    legacyTemplateId: legacy.id,
    legacyTemplateVersion: legacy.version,
  });

  return updateDocumentTemplate({
    id: oakDoc.id,
    expectedRevision: input.expectedRevision,
    contentJson: mergeOakDocMigrationMetadata(oakDoc.contentJson, metadata),
  }, params, cleanReason(input.reason), { writer: 'oakdoc-service' });
}

/**
 * Server-side static checks over the exact current definitions. Returns
 * sorted, deduplicated issue codes; an empty list means the pair passed.
 */
async function checkMigrationPair(input: {
  oakDoc: DocumentTemplate;
  legacy: DocumentTemplate;
  tenantId: string;
}): Promise<string[]> {
  const { oakDoc, legacy, tenantId } = input;
  const issues = new Set<string>();

  if (!legacy.isActive) issues.add('SOURCE_INACTIVE');
  if (!oakDoc.isActive) issues.add('TARGET_INACTIVE');
  if (!legacy.content?.trim()) issues.add('SOURCE_EMPTY');

  const duplicates = await findOtherLinkedOakDocIds(legacy.id, tenantId, oakDoc.id);
  if (duplicates.length > 0) issues.add('DUPLICATE_MAPPING');

  const asset = readOakDocTemplateMetadata(oakDoc.contentJson);
  let bytes: Uint8Array | null = null;
  try {
    bytes = new Uint8Array((await downloadOakDocTemplate(oakDoc.id, tenantId)).buffer);
  } catch {
    issues.add('TARGET_ASSET_INTEGRITY');
  }

  if (bytes && asset) {
    try {
      inspectOakDocPackage(bytes, 'master');
    } catch (error) {
      issues.add(error instanceof OakDocPackageError ? `PACKAGE_${error.check.toUpperCase()}` : 'PACKAGE_REJECTED');
    }

    // Content controls are the master's fields by design; only structural
    // damage counts here.
    const diagnostics = diagnoseOakDocPackage(bytes);
    for (const issue of diagnostics.issues) {
      if (issue.severity === 'error' && !MASTER_EXPECTED_DIAGNOSTICS.has(issue.code)) issues.add(issue.code);
    }
    if (diagnostics.unresolvedLegacyPlaceholders.length > 0) issues.add('LEGACY_PLACEHOLDERS_REMAIN');

    const presentTags = new Set(Object.keys(diagnostics.controlCounts));
    if (diagnoseOakDocTags([...presentTags], 'template').length > 0) issues.add('UNSUPPORTED_FIELD');
    if (asset.fieldTags.some((tag) => !presentTags.has(tag))) issues.add('FIELD_MANIFEST_MISMATCH');

    // A source with fields cannot be certified by a target without any.
    const legacyHasFields = /\{\{[^{}]+\}\}/.test(legacy.content ?? '')
      || (Array.isArray(legacy.placeholders) && legacy.placeholders.length > 0);
    if (legacyHasFields && asset.fieldTags.length === 0) issues.add('FIELD_COVERAGE_EMPTY');

    const seed = readOakDocSeedMigrationMetadata(oakDoc.contentJson);
    const definition = seed
      ? OAKDOC_STANDARD_TEMPLATE_MIGRATIONS.find((candidate) => candidate.migrationId === seed.migrationId)
      : undefined;
    if (definition && !validateOakDocMigrationMaster(definition, bytes).valid) {
      issues.add('STANDARD_DEFINITION_MISMATCH');
    }
  }

  return Array.from(issues).sort();
}

/**
 * Run the migration checker for a linked pair and record immutable evidence
 * bound to both definition hashes. Callers can request a run; they can never
 * submit a result.
 */
export async function runOakDocMigrationValidation(input: {
  oakDocTemplateId: string;
  expectedRevision: number;
}, params: TenantAwareParams): Promise<{ template: DocumentTemplate; validation: OakDocMigrationValidation }> {
  const { oakDoc, legacy, metadata } = await requireMigrationPair(
    input.oakDocTemplateId,
    params.tenantId,
  );
  if (oakDoc.version !== input.expectedRevision) {
    throw new ConflictError('The OakDoc template changed. Reload it and run the check again.', {
      expectedRevision: input.expectedRevision,
      currentRevision: oakDoc.version,
    });
  }

  const hashes = definitionHashes(legacy, oakDoc);
  const issueCodes = await checkMigrationPair({ oakDoc, legacy, tenantId: params.tenantId });

  // The target is protected by revision CAS below; the source is re-read so
  // an edit during the run cannot be certified.
  const legacyAfter = await getDocumentTemplateById(legacy.id, params.tenantId);
  if (!legacyAfter || hashTemplateDefinition(legacyAfter) !== hashes.legacyDefinitionHash) {
    throw new ConflictError('The legacy template changed during the check. Run it again.');
  }

  const runId = randomUUID();
  const validation: OakDocMigrationValidation = {
    checkedAt: new Date().toISOString(),
    passed: issueCodes.length === 0,
    legacyTemplateVersion: legacy.version,
    // updateDocumentTemplate increments the version in the same write.
    oakDocTemplateVersion: oakDoc.version + 1,
    issueCodes,
    authority: 'server',
    runId,
    checkerVersion: OAKDOC_MIGRATION_CHECKER_VERSION,
    ...hashes,
    renderCheck: 'pending',
  };

  const updated = await updateDocumentTemplate({
    id: oakDoc.id,
    expectedRevision: input.expectedRevision,
    contentJson: mergeOakDocMigrationMetadata(oakDoc.contentJson, {
      ...metadata,
      legacyTemplateVersion: legacy.version,
      validation,
      preference: validation.passed ? metadata.preference : 'LEGACY',
    }),
  }, params, 'Ran OakDoc migration parity check', { writer: 'oakdoc-service' });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'UPDATE',
    entityType: 'OakDocMigrationValidation',
    entityId: updated.id,
    entityName: updated.name,
    summary: `Server parity check ${validation.passed ? 'passed' : 'failed'} for "${updated.name}"`,
    changeSource: 'MANUAL',
    metadata: {
      runId,
      checkerVersion: OAKDOC_MIGRATION_CHECKER_VERSION,
      oakDocTemplateId: updated.id,
      legacyTemplateId: legacy.id,
      ...hashes,
      passed: validation.passed,
      issueCodes,
    },
  }).catch((error: unknown) => {
    log.warn('Failed to audit OakDoc migration check', {
      templateId: updated.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return { template: updated, validation };
}

export async function setOakDocMigrationPreference(input: {
  oakDocTemplateId: string;
  expectedRevision: number;
  preference: OakDocMigrationPreference;
  reason: string;
}, params: TenantAwareParams): Promise<DocumentTemplate> {
  const { oakDoc, legacy, metadata } = await requireMigrationPair(
    input.oakDocTemplateId,
    params.tenantId,
  );
  const reason = cleanReason(input.reason);

  if (input.preference === 'OAKDOC') {
    assertOakDocCanBecomePrimary({
      metadata,
      legacyTemplateVersion: legacy.version,
      oakDocTemplateVersion: oakDoc.version,
      definitionHashes: definitionHashes(legacy, oakDoc),
    });
    if (!legacy.isActive || !oakDoc.isActive) {
      throw new ConflictError('Both templates must be active before OakDoc can become primary');
    }
    const others = await findOtherLinkedOakDocIds(legacy.id, params.tenantId, oakDoc.id);
    if (others.length > 0) {
      throw new ConflictError('Another OakDoc template is linked to the same legacy template', {
        linkedOakDocTemplateIds: others,
      });
    }
  }

  // Evidence is carried unchanged. Server evidence stays valid only while
  // both definition hashes match; version-bound self-reported results
  // become stale on this revision and cannot be revived by toggling.
  const nextMetadata = {
    ...metadata,
    preference: input.preference,
    preferenceChangedAt: new Date().toISOString(),
    preferenceChangedBy: params.userId,
    preferenceReason: reason,
  };

  const updated = await updateDocumentTemplate({
    id: oakDoc.id,
    expectedRevision: input.expectedRevision,
    contentJson: mergeOakDocMigrationMetadata(oakDoc.contentJson, nextMetadata),
  }, params, reason, { writer: 'oakdoc-service' });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'UPDATE',
    entityType: 'OakDocMigrationPreference',
    entityId: updated.id,
    entityName: updated.name,
    summary: input.preference === 'OAKDOC'
      ? `Marked OakDoc template "${updated.name}" as preferred after parity validation`
      : `Restored legacy A4 preference for "${updated.name}"`,
    changeSource: 'MANUAL',
    reason,
    metadata: {
      oakDocTemplateId: updated.id,
      legacyTemplateId: legacy.id,
      preference: input.preference,
      reversible: true,
      legacyRetained: true,
    },
  });

  return updated;
}

function pickPreferredOakDoc(
  legacy: DocumentTemplate,
  oakDocs: DocumentTemplate[],
): DocumentTemplate | null {
  const linked = oakDocs.filter((oakDoc) => (
    readOakDocMigrationMetadata(oakDoc.contentJson)?.legacyTemplateId === legacy.id
  ));
  if (linked.length > 1) {
    log.warn('Ambiguous OakDoc migration mapping; using legacy template', {
      legacyTemplateId: legacy.id,
      oakDocTemplateIds: linked.map((oakDoc) => oakDoc.id),
    });
    return null;
  }

  const [oakDoc] = linked;
  if (!oakDoc || !oakDoc.isActive) return null;
  const readiness = getOakDocMigrationReadiness({
    metadata: readOakDocMigrationMetadata(oakDoc.contentJson),
    legacyTemplateVersion: legacy.version,
    oakDocTemplateVersion: oakDoc.version,
    definitionHashes: definitionHashes(legacy, oakDoc),
  });
  return readiness === 'OAKDOC_PRIMARY' ? oakDoc : null;
}

/**
 * A removed A4 template can no longer drift from its Word copy, so the one
 * active Word template linked to it replaces it without a parity check.
 */
function pickRemovedLegacyReplacement(
  legacy: DocumentTemplate,
  oakDocs: DocumentTemplate[],
): DocumentTemplate | null {
  const linked = oakDocs.filter((oakDoc) => (
    oakDoc.isActive
    && readOakDocMigrationMetadata(oakDoc.contentJson)?.legacyTemplateId === legacy.id
  ));
  return linked.length === 1 ? linked[0] : null;
}

function findOakDocTemplates(tenantId: string): Promise<DocumentTemplate[]> {
  return prisma.documentTemplate.findMany({
    where: {
      tenantId,
      deletedAt: null,
      contentJson: {
        path: ['oakDoc', 'schemaVersion'],
        equals: 1,
      },
    },
  });
}

/**
 * Resolve a legacy template to its validated preferred OakDoc pair. This does
 * not mutate either template and never disables the legacy source. An
 * ambiguous mapping fails closed to the legacy template.
 */
export async function resolvePreferredMigratedTemplate(
  legacyTemplateId: string,
  tenantId: string,
): Promise<DocumentTemplate> {
  const legacy = await requireTemplate(legacyTemplateId, tenantId);
  if (isOakDocTemplate(legacy.contentJson)) {
    throw new ValidationError('Preferred migration resolution expects a legacy A4 template ID');
  }
  return pickPreferredOakDoc(legacy, await findOakDocTemplates(tenantId)) ?? legacy;
}

/**
 * Template IDs for a new generation run. A4 templates whose Word replacement
 * is validated and set as preferred resolve to that replacement; everything
 * else, including unknown IDs, is returned unchanged for the caller's own
 * checks. Stored references (pipeline configs, existing batches) are never
 * rewritten.
 */
export async function resolveTemplateIdsForNewRun(
  templateIds: string[],
  tenantId: string,
): Promise<string[]> {
  if (templateIds.length === 0) return templateIds;
  const templates = await prisma.documentTemplate.findMany({
    where: { id: { in: templateIds }, tenantId },
  });
  const legacy = templates.filter((template) => !isOakDocTemplate(template.contentJson));
  if (legacy.length === 0) return templateIds;

  const oakDocs = await findOakDocTemplates(tenantId);
  const replacements = new Map<string, string>();
  for (const template of legacy) {
    const oakDoc = template.deletedAt
      ? pickRemovedLegacyReplacement(template, oakDocs)
      : pickPreferredOakDoc(template, oakDocs);
    if (oakDoc) replacements.set(template.id, oakDoc.id);
  }
  return templateIds.map((id) => replacements.get(id) ?? id);
}
