import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { ConflictError, ValidationError } from '@/lib/errors';
import { canonicalJson } from '@/lib/document-generation-fingerprint';
import { getDocumentTemplateEngineState } from '@/lib/document-editor/document-engine';
import { readOakDocTemplateMetadata } from '@/lib/document-editor/oakdoc-template';
import {
  getOakDocMigrationInventory,
  setOakDocMigrationPreference,
} from '@/services/oakdoc-migration.service';
import { deleteDocumentTemplate } from '@/services/document-template.service';
import { deleteTemplatePartial } from '@/services/template-partial.service';
import type { OakDocMigrationInventoryStatus } from '@/lib/document-editor/oakdoc-migration';

/**
 * M2 rollout inventory plus the explicit, manifest-bound template cutover
 * and A4 library removal steps. Reports carry IDs, revisions, hashes and
 * statuses only, never document contents or titles.
 */

export interface OakDocRolloutInventory {
  tenantId: string;
  templates: {
    total: number;
    byStatus: Partial<Record<OakDocMigrationInventoryStatus, number>>;
    items: Array<{
      status: OakDocMigrationInventoryStatus;
      legacyTemplateId: string | null;
      oakDocTemplateId: string | null;
      warnings: string[];
    }>;
  };
  unfinishedBatchItemsOnA4Templates: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function countBy<T extends string>(values: T[]): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/** Read-only inventory for one workspace. Makes no writes. */
export async function buildOakDocRolloutInventory(tenantId: string): Promise<OakDocRolloutInventory> {
  const [templates, unfinishedBatchItems] = await Promise.all([
    getOakDocMigrationInventory(tenantId),
    prisma.documentGenerationBatchItem.findMany({
      where: {
        tenantId,
        batch: { status: { not: 'COMPLETED' } },
      },
      select: { template: { select: { contentJson: true } } },
    }),
  ]);

  return {
    tenantId,
    templates: {
      total: templates.length,
      byStatus: countBy(templates.map((item) => item.status)),
      items: templates.map((item) => ({
        status: item.status,
        legacyTemplateId: item.legacyTemplate?.id ?? null,
        oakDocTemplateId: item.oakDocTemplate?.id ?? null,
        warnings: item.warnings,
      })),
    },
    unfinishedBatchItemsOnA4Templates: unfinishedBatchItems.filter(
      (item) => getDocumentTemplateEngineState(item.template.contentJson) === 'A4',
    ).length,
  };
}

async function requireOperator(tenantId: string, userId: string): Promise<void> {
  const operator = await prisma.user.findFirst({
    where: { id: userId, tenantId, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!operator) throw new ValidationError('The operator is not an active member of this workspace');
}

/**
 * Journal one apply run in the audit log: operator, manifest hash and every
 * item's outcome. Items are idempotent, so resuming after a failure is a new
 * dry run plus apply; the journal shows what each earlier run did.
 */
async function journalRolloutRun(input: {
  tenantId: string;
  userId: string;
  operation: 'TEMPLATE_CUTOVER' | 'TEMPLATE_ROLLBACK' | 'A4_LIBRARY_REMOVAL';
  manifestHash: string;
  results: Array<{ outcome: string }>;
  reason?: string;
}): Promise<void> {
  const outcomes = countBy(input.results.map((item) => item.outcome));
  await createAuditLog({
    tenantId: input.tenantId,
    userId: input.userId,
    action: 'UPDATE',
    entityType: 'OakDocRolloutRun',
    entityId: input.manifestHash,
    summary: `OakDoc rollout ${input.operation.toLowerCase().replace(/_/g, ' ')}: ${input.results.length} item(s)`,
    changeSource: 'SYSTEM',
    ...(input.reason ? { reason: input.reason } : {}),
    metadata: {
      operation: input.operation,
      manifestHash: input.manifestHash,
      outcomes,
      results: input.results,
    },
  });
}

export type OakDocCutoverDirection = 'OAKDOC' | 'LEGACY';

export interface OakDocTemplateCutoverItem {
  oakDocTemplateId: string;
  legacyTemplateId: string;
  expectedRevision: number;
}

export interface OakDocTemplateCutoverPlan {
  direction: OakDocCutoverDirection;
  hash: string;
  items: OakDocTemplateCutoverItem[];
}

/**
 * Pairs a workspace cutover would switch. Moving to Word covers validated
 * pairs still on A4; rollback covers pairs currently on Word. The hash binds
 * the apply step to exactly these templates at these revisions.
 */
export async function buildTemplateCutoverPlan(
  tenantId: string,
  direction: OakDocCutoverDirection,
): Promise<OakDocTemplateCutoverPlan> {
  const inventory = await getOakDocMigrationInventory(tenantId);
  const wanted = direction === 'OAKDOC' ? 'READY_FOR_SWITCHOVER' : 'OAKDOC_PRIMARY';
  const items = inventory
    .filter((item) => item.readiness === wanted && item.oakDocTemplate && item.legacyTemplate)
    .map((item) => ({
      oakDocTemplateId: item.oakDocTemplate!.id,
      legacyTemplateId: item.legacyTemplate!.id,
      expectedRevision: item.oakDocTemplate!.version,
    }))
    .sort((a, b) => a.oakDocTemplateId.localeCompare(b.oakDocTemplateId));
  return {
    direction,
    hash: sha256(canonicalJson({ tenantId, operation: 'template-cutover', direction, items })),
    items,
  };
}

export interface OakDocTemplateCutoverResult {
  direction: OakDocCutoverDirection;
  manifestHash: string;
  results: Array<{
    oakDocTemplateId: string;
    outcome: 'switched' | 'failed';
    revision?: number;
    reason?: string;
  }>;
}

/**
 * Switch every pair in an approved cutover plan to Word, or roll them back
 * to A4, through the audited per-template preference change (which re-checks
 * parity evidence and the expected revision). A changed plan is refused.
 */
export async function applyTemplateCutover(input: {
  tenantId: string;
  userId: string;
  direction: OakDocCutoverDirection;
  manifestHash: string;
  reason: string;
}): Promise<OakDocTemplateCutoverResult> {
  await requireOperator(input.tenantId, input.userId);
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError('A reason is required for a cutover or rollback');

  const plan = await buildTemplateCutoverPlan(input.tenantId, input.direction);
  if (plan.hash !== input.manifestHash) {
    throw new ConflictError('The templates changed since the dry run. Run the dry run again and approve the new plan.', {
      reason: 'OAKDOC_MANIFEST_CHANGED',
      currentManifestHash: plan.hash,
    });
  }

  const results: OakDocTemplateCutoverResult['results'] = [];
  for (const item of plan.items) {
    try {
      const updated = await setOakDocMigrationPreference({
        oakDocTemplateId: item.oakDocTemplateId,
        expectedRevision: item.expectedRevision,
        preference: input.direction,
        reason,
      }, { tenantId: input.tenantId, userId: input.userId });
      results.push({ oakDocTemplateId: item.oakDocTemplateId, outcome: 'switched', revision: updated.version });
    } catch (error) {
      const details = (error as { details?: { reason?: unknown } }).details;
      const reason = typeof details?.reason === 'string'
        ? details.reason
        : (error instanceof Error ? error.message : 'PREFERENCE_CHANGE_FAILED').slice(0, 300);
      results.push({ oakDocTemplateId: item.oakDocTemplateId, outcome: 'failed', reason });
    }
  }
  await journalRolloutRun({
    tenantId: input.tenantId,
    userId: input.userId,
    operation: input.direction === 'OAKDOC' ? 'TEMPLATE_CUTOVER' : 'TEMPLATE_ROLLBACK',
    manifestHash: plan.hash,
    results,
    reason,
  });
  return { direction: input.direction, manifestHash: plan.hash, results };
}

export interface A4LibraryRemovalItem {
  kind: 'template' | 'partial';
  id: string;
  name: string;
  expectedRevision: number;
  /** Informational: records that keep pointing at the item after a soft delete. */
  generatedDocuments?: number;
  serviceVariants?: number;
}

export interface A4LibraryRemovalPlan {
  hash: string;
  items: A4LibraryRemovalItem[];
}

/**
 * Every remaining A4 template and HTML partial in the workspace. Removal is
 * the normal audited soft delete, so generated documents keep their
 * history and the items stay recoverable from the Recycle Bin.
 */
export async function buildA4LibraryRemovalPlan(tenantId: string): Promise<A4LibraryRemovalPlan> {
  const [templates, partials] = await Promise.all([
    prisma.documentTemplate.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        version: true,
        contentJson: true,
        _count: { select: { generatedDocuments: true } },
      },
    }),
    prisma.templatePartial.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, version: true, contentJson: true },
    }),
  ]);
  const a4Partials = partials.filter((partial) => !readOakDocTemplateMetadata(partial.contentJson));
  const variants = a4Partials.length > 0
    ? await prisma.serviceVariant.findMany({
      where: { tenantId, deletedAt: null, sowPartialId: { in: a4Partials.map((partial) => partial.id) } },
      select: { sowPartialId: true },
    })
    : [];

  const items: A4LibraryRemovalItem[] = [
    ...templates
      .filter((template) => getDocumentTemplateEngineState(template.contentJson) === 'A4')
      .map((template) => ({
        kind: 'template' as const,
        id: template.id,
        name: template.name,
        expectedRevision: template.version,
        generatedDocuments: template._count.generatedDocuments,
      })),
    ...a4Partials.map((partial) => ({
      kind: 'partial' as const,
      id: partial.id,
      name: partial.name,
      expectedRevision: partial.version,
      serviceVariants: variants.filter((variant) => variant.sowPartialId === partial.id).length,
    })),
  ].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  const bound = items.map(({ kind, id, expectedRevision }) => ({ kind, id, expectedRevision }));
  return {
    hash: sha256(canonicalJson({ tenantId, operation: 'a4-library-removal', items: bound })),
    items,
  };
}

export interface A4LibraryRemovalResult {
  manifestHash: string;
  results: Array<{ kind: 'template' | 'partial'; id: string; outcome: 'removed' | 'failed'; reason?: string }>;
}

/**
 * Soft-delete every item in an approved removal plan. Templates go first so
 * A4 partials are no longer in use by them; a partial still linked to a
 * service variant is refused by the partial service and reported as failed.
 */
export async function applyA4LibraryRemoval(input: {
  tenantId: string;
  userId: string;
  manifestHash: string;
  reason: string;
}): Promise<A4LibraryRemovalResult> {
  await requireOperator(input.tenantId, input.userId);
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError('A reason is required to remove the A4 library');

  const plan = await buildA4LibraryRemovalPlan(input.tenantId);
  if (plan.hash !== input.manifestHash) {
    throw new ConflictError('The A4 templates or partials changed since the dry run. Run the dry run again and approve the new plan.', {
      reason: 'OAKDOC_MANIFEST_CHANGED',
      currentManifestHash: plan.hash,
    });
  }

  const params = { tenantId: input.tenantId, userId: input.userId };
  const results: A4LibraryRemovalResult['results'] = [];
  for (const kind of ['template', 'partial'] as const) {
    for (const item of plan.items.filter((entry) => entry.kind === kind)) {
      try {
        if (kind === 'template') {
          await deleteDocumentTemplate(item.id, params, reason, item.expectedRevision);
        } else {
          await deleteTemplatePartial(item.id, params, reason, item.expectedRevision);
        }
        results.push({ kind, id: item.id, outcome: 'removed' });
      } catch (error) {
        results.push({
          kind,
          id: item.id,
          outcome: 'failed',
          reason: (error instanceof Error ? error.message : 'REMOVAL_FAILED').slice(0, 300),
        });
      }
    }
  }
  await journalRolloutRun({
    tenantId: input.tenantId,
    userId: input.userId,
    operation: 'A4_LIBRARY_REMOVAL',
    manifestHash: plan.hash,
    results,
    reason,
  });
  return { manifestHash: plan.hash, results };
}
