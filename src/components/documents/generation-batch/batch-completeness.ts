/**
 * Completeness and gating selectors for the batch workspace.
 *
 * Item status on the DTO is *action*-derived: it only leaves `NOT_STARTED`
 * once a preview or review round-trip has happened. That makes it useless for
 * answering "what still needs my input?", which is the question the queue and
 * the stepper actually have to answer. These selectors derive completeness
 * from the configuration itself so the UI can report pending work before any
 * server round-trip, and so every disabled action can explain itself.
 */

import { resolutionCompositionIssues } from '@/lib/resolution-composition';
import type {
  MasterFieldCatalogue,
  MasterFieldDefinition,
} from '@/types/document-generation-batch';
import type { CustomPlaceholderDefinition } from '@/types/placeholders';
import { normalizePlaceholderKey } from '@/lib/template-analysis';
import {
  canonicalPlaceholderType,
  masterFieldId,
} from '@/lib/document-generation-master-fields';
import {
  createWorkflowFieldInputDescriptors,
  fieldInputDescriptorDefaultValue,
  isWorkflowFieldValuePresent,
} from '@/lib/document-editor/template-field-workflow';
import type { BatchStage, EditableBatchItem } from './batch-workspace-state';

export interface MissingRequirement {
  id: string;
  label: string;
}

export interface ItemCompleteness {
  requiredTotal: number;
  requiredFilled: number;
  missing: MissingRequirement[];
  isComplete: boolean;
}

export type CompletenessMap = Record<string, ItemCompleteness>;

export const EMPTY_COMPLETENESS: ItemCompleteness = {
  requiredTotal: 0,
  requiredFilled: 0,
  missing: [],
  isComplete: true,
};

export function partitionTemplateFields(
  templateFields: CustomPlaceholderDefinition[],
  masterFields: MasterFieldCatalogue,
): { itemOnly: CustomPlaceholderDefinition[]; shared: CustomPlaceholderDefinition[] } {
  const masterIds = new Set(masterFields.fields.map((field) => field.id));
  const itemOnly: CustomPlaceholderDefinition[] = [];
  const shared: CustomPlaceholderDefinition[] = [];
  for (const field of templateFields) {
    const id = masterFieldId(
      normalizePlaceholderKey(field.key),
      canonicalPlaceholderType(field.type),
    );
    if (masterIds.has(id)) shared.push(field);
    else itemOnly.push(field);
  }
  return { itemOnly, shared };
}

function effectiveMasterValue(
  item: EditableBatchItem,
  field: MasterFieldDefinition,
  masterFieldValues: Record<string, string>,
): string {
  const override = item.configuration.masterOverrides[field.id];
  if (override !== undefined) return override;
  return masterFieldValues[field.id] ?? '';
}

export interface SelectItemCompletenessParams {
  item: EditableBatchItem;
  templateFields: CustomPlaceholderDefinition[];
  masterFields: MasterFieldCatalogue;
  masterFieldValues: Record<string, string>;
  /** The template's section that makes one document per person, which then needs its person. */
  perPersonTag?: string | null;
  /** What is missing or wrong in its per-person values (each is one requirement). */
  personFieldIssues?: ReadonlyArray<{ message: string }>;
}

export function selectItemCompleteness({
  item,
  templateFields,
  masterFields,
  masterFieldValues,
  perPersonTag = null,
  personFieldIssues = [],
}: SelectItemCompletenessParams): ItemCompleteness {
  const requirements: Array<{ id: string; label: string; filled: boolean }> = [];

  requirements.push({
    id: 'title',
    label: 'Document title',
    filled: item.configuration.title.trim().length > 0,
  });

  if (perPersonTag) {
    requirements.push({
      id: 'person',
      label: 'Person this document is for',
      filled: item.configuration.documentPerson?.tag === perPersonTag,
    });
  }

  const { itemOnly } = partitionTemplateFields(templateFields, masterFields);
  const descriptors = createWorkflowFieldInputDescriptors(itemOnly, {
    kind: 'template',
    id: item.templateId,
  });
  itemOnly.forEach((field, index) => {
    const descriptor = descriptors[index];
    if (!(descriptor?.required ?? field.required)) return;
    const explicit = Object.prototype.hasOwnProperty.call(item.configuration.itemValues, field.key);
    const value = explicit
      ? item.configuration.itemValues[field.key]
      : descriptor ? fieldInputDescriptorDefaultValue(descriptor) : field.defaultValue;
    requirements.push({
      id: `field:${field.key}`,
      label: field.label,
      filled: isWorkflowFieldValuePresent(value),
    });
  });

  for (const field of masterFields.fields) {
    if (!field.requiredTemplateIds.includes(item.templateId)) continue;
    requirements.push({
      id: `shared:${field.id}`,
      label: `${field.label} (shared)`,
      filled: effectiveMasterValue(item, field, masterFieldValues).trim().length > 0,
    });
  }

  if (item.templateKind === 'SERVICE_AGREEMENT') {
    const agreement = item.configuration.serviceAgreement;
    requirements.push({
      id: 'sa:representative',
      label: 'Authorised representative',
      filled: (agreement?.authorizedContactIds.length ?? 0) > 0,
    });
    requirements.push({
      id: 'sa:signer',
      label: 'At least one signer',
      filled: (agreement?.signerContactIds.length ?? 0) > 0,
    });
    requirements.push({
      id: 'sa:entities',
      label: 'At least one entity',
      filled: (agreement?.entityIds.length ?? 0) > 0,
    });
    requirements.push({
      id: 'sa:services',
      label: 'At least one service',
      filled: (agreement?.items.length ?? 0) > 0,
    });
  }

  personFieldIssues.forEach((issue, index) => {
    requirements.push({ id: `person-field:${index}`, label: issue.message, filled: false });
  });

  if (item.templateKind === 'RESOLUTION') {
    const issues = resolutionCompositionIssues(item.configuration.resolution);
    requirements.push({
      id: 'resolution:sections',
      label: issues[0] ?? 'Resolutions',
      filled: issues.length === 0,
    });
  }

  const missing = requirements
    .filter((requirement) => !requirement.filled)
    .map(({ id, label }) => ({ id, label }));

  return {
    requiredTotal: requirements.length,
    requiredFilled: requirements.length - missing.length,
    missing,
    isComplete: missing.length === 0,
  };
}

export function buildCompletenessMap(params: {
  items: EditableBatchItem[];
  masterFields: MasterFieldCatalogue;
  masterFieldValues: Record<string, string>;
  templateFieldsByTemplateId: Record<string, CustomPlaceholderDefinition[]>;
  /** Per-document fields where they differ from the template's (resolution partials). */
  itemFieldsByKey?: Record<string, CustomPlaceholderDefinition[]>;
  /** Each template's section that makes one document per person, if any. */
  perPersonTagByTemplateId?: Record<string, string | null | undefined>;
  /** Per-person value problems of each document, by item key. */
  personFieldIssuesByKey?: Record<string, ReadonlyArray<{ message: string }>>;
}): CompletenessMap {
  const map: CompletenessMap = {};
  for (const item of params.items) {
    map[item.key] = selectItemCompleteness({
      item,
      templateFields: params.itemFieldsByKey?.[item.key]
        ?? params.templateFieldsByTemplateId[item.templateId]
        ?? [],
      masterFields: params.masterFields,
      masterFieldValues: params.masterFieldValues,
      perPersonTag: params.perPersonTagByTemplateId?.[item.templateId] ?? null,
      personFieldIssues: params.personFieldIssuesByKey?.[item.key],
    });
  }
  return map;
}

export function completenessFor(
  map: CompletenessMap,
  itemKey: string | null | undefined,
): ItemCompleteness {
  if (!itemKey) return EMPTY_COMPLETENESS;
  return map[itemKey] ?? EMPTY_COMPLETENESS;
}

export interface StageGate {
  satisfied: boolean;
  reason: string | null;
}

export type StageGates = Record<BatchStage, StageGate>;

export function selectStageGates(params: {
  items: EditableBatchItem[];
  primaryCompanyId: string | null;
  completeness: CompletenessMap;
  canGenerate: boolean;
}): StageGates {
  const { items, primaryCompanyId, completeness, canGenerate } = params;
  const incomplete = items.filter(
    (item) => !completenessFor(completeness, item.key).isComplete,
  );

  return {
    documents: {
      satisfied: items.length > 0,
      reason: items.length > 0 ? null : 'Select at least one document first.',
    },
    'shared-setup': {
      satisfied: items.length > 0 && Boolean(primaryCompanyId),
      reason: items.length === 0
        ? 'Select at least one document first.'
        : primaryCompanyId
          ? null
          : 'Choose the primary company for this batch.',
    },
    configure: {
      satisfied: items.length > 0 && incomplete.length === 0,
      reason: items.length === 0
        ? 'Select at least one document first.'
        : incomplete.length === 0
          ? null
          : `${incomplete.length} document${incomplete.length === 1 ? '' : 's'} still ${incomplete.length === 1 ? 'needs' : 'need'} required values.`,
    },
    'review-generate': {
      satisfied: canGenerate,
      reason: canGenerate ? null : 'Every document must be previewed and approved.',
    },
  };
}

export function selectHighestReachableStageIndex(
  gates: StageGates,
  stages: BatchStage[],
): number {
  let reachable = 0;
  for (let index = 0; index < stages.length - 1; index += 1) {
    if (!gates[stages[index]].satisfied) break;
    reachable = index + 1;
  }
  return reachable;
}

export interface GenerationBlocker {
  itemKey: string;
  title: string;
  reason: string;
}

export function selectGenerationBlockers(
  items: EditableBatchItem[],
  completeness: CompletenessMap,
): GenerationBlocker[] {
  const blockers: GenerationBlocker[] = [];
  for (const item of items) {
    if (item.status === 'GENERATED' || item.status === 'READY') continue;
    const title = item.configuration.title || item.templateName;
    const itemCompleteness = completenessFor(completeness, item.key);
    const diagnostics = item.validationDiagnostics;
    const diagnosticCount = diagnostics
      ? diagnostics.errors.length + diagnostics.fieldErrors.length
      : 0;

    let reason: string;
    if (!itemCompleteness.isComplete) {
      const count = itemCompleteness.missing.length;
      reason = `${count} required value${count === 1 ? '' : 's'} missing`;
    } else if (diagnosticCount > 0) {
      reason = `${diagnosticCount} validation error${diagnosticCount === 1 ? '' : 's'}`;
    } else if (item.status === 'FAILED') {
      reason = 'Last attempt failed';
    } else if (!item.previewContent) {
      reason = 'Preview not rendered yet';
    } else if (!item.previewFingerprint) {
      reason = 'Preview is out of date';
    } else if (!item.reviewedFingerprint) {
      reason = 'Not approved yet';
    } else {
      reason = 'Not ready';
    }
    blockers.push({ itemKey: item.key, title, reason });
  }
  return blockers;
}

export function isPreviewStale(item: EditableBatchItem): boolean {
  return Boolean(item.previewContent && !item.previewFingerprint);
}

export function hasManualEdits(item: EditableBatchItem): boolean {
  return Boolean(
    (item.editedContent && item.editedContent !== item.previewContent)
    || (item.templateEngine === 'OAKDOC' && item.editedContentJson),
  );
}
