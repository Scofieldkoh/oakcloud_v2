/**
 * Reducer-backed state for the four-stage batch workspace.
 *
 * The server DTO is kept separate from ephemeral UI state: `savedSnapshot`
 * stores a canonical serialization of user-editable fields so `dirty` is
 * deterministic, and server replacements never overwrite local edits before
 * an explicit save.
 */

import type {
  BatchItemConfiguration,
  BatchItemDiagnostics,
  BatchItemFailure,
  BatchItemStatus,
  BatchStatus,
  DocumentGenerationBatchDto,
  MasterFieldCatalogue,
  ServiceAgreementWorkspaceState,
} from '@/types/document-generation-batch';
import type { ServiceAgreementDraftDto } from '@/services/service-agreement/types';
import type {
  DocumentTemplateSummary,
} from '@/types/document-generation';
import { masterFieldId } from '@/lib/document-generation-master-fields';
import { instantiateResolutionPreset } from '@/lib/resolution-composition';
import { createServiceAgreementClientKey } from '@/components/documents/service-agreement/client-key';
import {
  DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN,
  isAutoDocumentGenerationTitle,
} from '@/lib/document-generation-title';
import {
  isCompanyPerPersonTag,
  perPersonDocumentTitle,
  perPersonSelectionPatch,
  type DocumentPersonChoice,
} from '@/lib/document-generation-per-person';

export type BatchStage = 'documents' | 'shared-setup' | 'configure' | 'review-generate';

export interface EditableBatchItem {
  key: string;
  id?: string;
  templateId: string;
  templateName: string;
  templateKind: 'STANDARD' | 'SERVICE_AGREEMENT' | 'RESOLUTION';
  templateVersion: number;
  templateEngine: DocumentTemplateSummary['engine'];
  status: BatchItemStatus;
  configuration: BatchItemConfiguration;
  previewContent: string | null;
  editedContent: string | null;
  editedContentJson: unknown | null;
  previewFingerprint: string | null;
  reviewedFingerprint: string | null;
  validationDiagnostics: BatchItemDiagnostics | null;
  lastError: BatchItemFailure | null;
  generatedDocumentId?: string;
  generatedDocumentTitle?: string | null;
  serviceAgreement?: ServiceAgreementDraftDto | null;
}

export interface EditableDocumentGenerationBatch {
  id?: string;
  legacyDraftId?: string;
  primaryCompanyId: string | null;
  company?: { id: string; name: string; uen: string } | null;
  activeItemId?: string | null;
  currentStage: number;
  revision?: number;
  status: BatchStatus;
  masterFieldValues: Record<string, string>;
  masterFields: MasterFieldCatalogue;
  taskContext?: unknown;
  createdAt?: string;
  updatedAt?: string;
  items: EditableBatchItem[];
}

export interface BatchWorkspaceCapabilities {
  canEditComposition: boolean;
  canEditSharedSetup: boolean;
  canEditItems: boolean;
}

export interface BatchWorkspaceState {
  batch: EditableDocumentGenerationBatch;
  stage: BatchStage;
  activeItemId: string | null;
  savedSnapshot: string;
  dirty: boolean;
  pending: null | 'save' | 'preview' | 'review' | 'preflight' | 'generate' | 'retry';
  conflict: { currentRevision: number } | null;
  capabilities: BatchWorkspaceCapabilities;
}

export type DocumentGenerationBatchAction =
  | { type: 'template/add'; template: DocumentTemplateSummary }
  | { type: 'template/remove'; itemId: string }
  | { type: 'template/reorder'; itemId: string; direction: -1 | 1 }
  | { type: 'template/move'; itemId: string; toIndex: number }
  | { type: 'shared/company'; companyId: string | null; companyName: string | null }
  | { type: 'shared/masterValue'; fieldId: string; value: string }
  | { type: 'item/patch'; itemId: string; patch: Partial<BatchItemConfiguration> }
  | { type: 'items/patch-many'; itemIds: string[]; patch: Partial<BatchItemConfiguration> }
  /**
   * One document per person: the documents of this item's template become one
   * per person, in this order, each for its person (see document-generation-per-person).
   */
  | { type: 'items/set-document-people'; itemId: string; tag: string; people: DocumentPersonChoice[] }
  | { type: 'conflict/accept-revision' }
  | { type: 'item/edit-content'; itemId: string; editedContent: string | null; editedContentJson: unknown | null }
  | { type: 'item/activate'; itemId: string }
  | { type: 'stage/navigate'; stage: BatchStage }
  | { type: 'save/start' }
  | { type: 'save/conflict'; currentRevision: number }
  | { type: 'server/track-id'; id: string; revision: number; currentRevision: number }
  | { type: 'server/replace'; batch: EditableDocumentGenerationBatch }
  | { type: 'local/initialize'; batch: EditableDocumentGenerationBatch }
  | { type: 'request/start'; pending: NonNullable<BatchWorkspaceState['pending']> }
  | { type: 'request/end' };

export const BATCH_STAGES: BatchStage[] = [
  'documents',
  'shared-setup',
  'configure',
  'review-generate',
];

export const STAGE_LABELS: Record<BatchStage, string> = {
  documents: 'Documents',
  'shared-setup': 'Shared setup',
  configure: 'Configure',
  'review-generate': 'Review & generate',
};

export function defaultItemConfiguration(
  _template: Pick<DocumentTemplateSummary, 'name'> | string,
): BatchItemConfiguration {
  return {
    version: 1,
    title: DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN,
    contactIds: [],
    selectedDirectorId: null,
    selectedShareholderId: null,
    selectedContactId: null,
    itemValues: {},
    masterOverrides: {},
    useLetterhead: false,
    serviceAgreement: null,
  };
}

export function itemFromTemplate(
  template: DocumentTemplateSummary,
  key: string = template.id,
): EditableBatchItem {
  return {
    key,
    templateId: template.id,
    templateName: template.name,
    templateKind: template.compositionType,
    templateVersion: template.version,
    templateEngine: template.engine,
    status: 'NOT_STARTED',
    configuration: template.compositionType === 'RESOLUTION' && template.resolutionPreset
      ? {
          ...defaultItemConfiguration(template),
          resolution: instantiateResolutionPreset(template.resolutionPreset, createServiceAgreementClientKey),
        }
      : defaultItemConfiguration(template),
    previewContent: null,
    editedContent: null,
    editedContentJson: null,
    previewFingerprint: null,
    reviewedFingerprint: null,
    validationDiagnostics: null,
    lastError: null,
  };
}

export function createInitialBatchWorkspaceState(
  batchOrItems: EditableDocumentGenerationBatch | DocumentTemplateSummary[],
): BatchWorkspaceState {
  const initialBatch: EditableDocumentGenerationBatch = Array.isArray(batchOrItems)
    ? {
        primaryCompanyId: null,
        currentStage: 0,
        status: 'DRAFT',
        masterFieldValues: {},
        masterFields: { fields: [], conflicts: [] },
        items: batchOrItems.slice(0, 20).map((template, index, all) => itemFromTemplate(
          template,
          all.findIndex((other) => other.id === template.id) === index ? template.id : `${template.id}~${index}`,
        )),
      }
    : batchOrItems;
  const batch = applyAutomaticTitleDefaults(initialBatch);
  const capabilities = deriveCapabilities(batch);
  return {
    batch,
    stage: BATCH_STAGES[Math.min(batch.currentStage, BATCH_STAGES.length - 1)],
    activeItemId: batch.activeItemId ?? batch.items[0]?.key ?? null,
    savedSnapshot: canonicalEditableState(batch),
    dirty: false,
    pending: null,
    conflict: null,
    capabilities,
  };
}

export function editableBatchFromDto(
  dto: DocumentGenerationBatchDto,
): EditableDocumentGenerationBatch {
  return {
    ...dto,
    company: dto.company,
    items: dto.items.map((item) => ({
      key: item.id,
      id: item.id,
      templateId: item.templateId,
      templateName: item.templateName,
      templateKind: item.templateKind,
      templateVersion: item.templateVersion,
      templateEngine: item.templateEngine,
      status: item.status,
      configuration: item.configuration,
      previewContent: item.previewContent,
      editedContent: item.editedContent,
      editedContentJson: item.editedContentJson,
      previewFingerprint: item.previewFingerprint,
      reviewedFingerprint: item.reviewedFingerprint,
      validationDiagnostics: item.validationDiagnostics,
      lastError: item.lastError,
      generatedDocumentId: item.generatedDocumentId,
      generatedDocumentTitle: item.generatedDocumentTitle,
      serviceAgreement: item.serviceAgreement ?? null,
    })),
  };
}

export function deriveCapabilitiesForCommit(
  batch: EditableDocumentGenerationBatch,
): BatchWorkspaceCapabilities {
  return deriveCapabilities(batch);
}

function deriveCapabilities(
  batch: EditableDocumentGenerationBatch,
): BatchWorkspaceCapabilities {
  const hasGenerated = batch.items.some((item) => item.status === 'GENERATED');
  return {
    canEditComposition: !hasGenerated,
    canEditSharedSetup: !hasGenerated,
    canEditItems: true,
  };
}

function canonicalEditableState(batch: EditableDocumentGenerationBatch): string {
  return JSON.stringify({
    primaryCompanyId: batch.primaryCompanyId,
    currentStage: batch.currentStage,
    masterFieldValues: batch.masterFieldValues,
    items: batch.items.map((item) => ({
      templateId: item.templateId,
      configuration: item.configuration,
      editedContent: item.editedContent,
      editedContentJson: item.editedContentJson,
      status: item.status,
      previewFingerprint: item.previewFingerprint,
      reviewedFingerprint: item.reviewedFingerprint,
    })),
  });
}

function invalidateItem(item: EditableBatchItem): EditableBatchItem {
  if (item.status === 'GENERATED') return item;
  return {
    ...item,
    status: item.status === 'FAILED' || item.status === 'READY'
      ? 'NEEDS_INPUT'
      : item.status === 'GENERATING'
        ? item.status
        : 'NEEDS_INPUT',
    previewFingerprint: null,
    reviewedFingerprint: null,
    validationDiagnostics: null,
  };
}

function invalidateReviewOnly(item: EditableBatchItem): EditableBatchItem {
  if (item.status === 'GENERATED') return item;
  return {
    ...item,
    status: item.status === 'READY'
      ? 'PREVIEWED'
      : item.status === 'FAILED'
        ? 'NEEDS_INPUT'
        : item.status,
    reviewedFingerprint: null,
    validationDiagnostics: null,
  };
}

function replaceBatchItems(
  batch: EditableDocumentGenerationBatch,
  items: EditableBatchItem[],
): EditableDocumentGenerationBatch {
  return {
    ...batch,
    items,
  };
}

function remapCompanyIds(
  ids: string[],
  previousPrimaryCompanyId: string | null,
  nextPrimaryCompanyId: string | null,
  ensureNextPrimary = false,
): string[] {
  const mapped = ids
    .map((id) => id === previousPrimaryCompanyId ? nextPrimaryCompanyId : id)
    .filter((id): id is string => Boolean(id));
  if (ensureNextPrimary && nextPrimaryCompanyId && !mapped.includes(nextPrimaryCompanyId)) {
    mapped.unshift(nextPrimaryCompanyId);
  }
  return [...new Set(mapped)];
}

export function syncServiceAgreementPrimaryCompany(
  workspace: ServiceAgreementWorkspaceState,
  previousPrimaryCompanyId: string | null,
  nextPrimaryCompanyId: string | null,
): ServiceAgreementWorkspaceState {
  return {
    ...workspace,
    entityIds: remapCompanyIds(
      workspace.entityIds,
      previousPrimaryCompanyId,
      nextPrimaryCompanyId,
      true,
    ),
    items: workspace.items.map((item) => ({
      ...item,
      entityIds: remapCompanyIds(
        item.entityIds,
        previousPrimaryCompanyId,
        nextPrimaryCompanyId,
      ),
      feeLines: item.feeLines.map((fee) => ({
        ...fee,
        companyId: fee.companyId === previousPrimaryCompanyId
          ? nextPrimaryCompanyId ?? fee.companyId
          : fee.companyId,
      })),
    })),
  };
}

function applyAutomaticTitleDefaults(
  batch: EditableDocumentGenerationBatch,
): EditableDocumentGenerationBatch {
  let changed = false;
  const items = batch.items.map((item) => {
    if (
      item.status === 'GENERATED'
      || !isAutoDocumentGenerationTitle(item.configuration.title, item.templateName)
    ) {
      return item;
    }
    const title = DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN;
    if (title === item.configuration.title) return item;
    changed = true;
    return {
      ...item,
      configuration: { ...item.configuration, title },
    };
  });
  return changed ? replaceBatchItems(batch, items) : batch;
}

const MAX_BATCH_ITEMS = 20;

/**
 * A change to a document's choices. A per-person document keeps its person:
 * a choice copied from another document cannot widen its section.
 */
function patchConfiguration(
  configuration: BatchItemConfiguration,
  patch: Partial<BatchItemConfiguration>,
): BatchItemConfiguration {
  const next = { ...configuration, ...patch };
  const person = next.documentPerson;
  return person ? { ...next, ...perPersonSelectionPatch(person.tag, person.id, next) } : next;
}

function newItemKey(templateId: string): string {
  return `${templateId}~${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

/** A new, unsaved document of the same template with the same choices. */
function copyBatchItem(item: EditableBatchItem): EditableBatchItem {
  return {
    key: newItemKey(item.templateId),
    templateId: item.templateId,
    templateName: item.templateName,
    templateKind: item.templateKind,
    templateVersion: item.templateVersion,
    templateEngine: item.templateEngine,
    status: 'NOT_STARTED',
    configuration: JSON.parse(JSON.stringify(item.configuration)) as BatchItemConfiguration,
    previewContent: null,
    editedContent: null,
    editedContentJson: null,
    previewFingerprint: null,
    reviewedFingerprint: null,
    validationDiagnostics: null,
    lastError: null,
  };
}

/** A per-person document's title follows its person unless the user typed their own. */
function perPersonTitle(item: EditableBatchItem, person: DocumentPersonChoice | null): string {
  const current = item.configuration.title;
  const previous = item.configuration.documentPerson;
  const followsPerson = isAutoDocumentGenerationTitle(current, item.templateName)
    || (previous ? current === perPersonDocumentTitle(item.templateName, previous.name) : false);
  if (!followsPerson) return current;
  return person ? perPersonDocumentTitle(item.templateName, person.name) : DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN;
}

/** The document for this person (none: for nobody yet), invalidated only when it changes. */
function assignDocumentPerson(
  item: EditableBatchItem,
  tag: string,
  person: DocumentPersonChoice | null,
): EditableBatchItem {
  const configuration: BatchItemConfiguration = {
    ...item.configuration,
    ...perPersonSelectionPatch(tag, person?.id ?? null, item.configuration),
    documentPerson: person ? { tag, id: person.id, name: person.name } : null,
    title: perPersonTitle(item, person),
  };
  if (JSON.stringify(configuration) === JSON.stringify(item.configuration)) return item;
  return invalidateItem({ ...item, configuration });
}

/**
 * Make the documents of the item's template one per person, in order. A
 * document already for a person stays theirs; the rest are reused for new
 * people before copies of the item are added, and left over ones removed.
 * With nobody picked one document stays, for nobody yet. Generated documents
 * are left alone, and the batch keeps to its document limit.
 */
function setDocumentPeople(
  items: EditableBatchItem[],
  itemKey: string,
  tag: string,
  people: readonly DocumentPersonChoice[],
): EditableBatchItem[] {
  const anchor = items.find((item) => item.key === itemKey);
  if (!anchor || anchor.status === 'GENERATED') return items;
  const inGroup = (item: EditableBatchItem) => item.templateId === anchor.templateId && item.status !== 'GENERATED';
  const room = MAX_BATCH_ITEMS - items.filter((item) => !inGroup(item)).length;
  const seen = new Set<string>();
  const wanted = people.filter((person) => !seen.has(person.id) && seen.add(person.id)).slice(0, Math.max(room, 1));
  const group = items.filter(inGroup);
  const personOf = (item: EditableBatchItem) => (
    item.configuration.documentPerson?.tag === tag ? item.configuration.documentPerson.id : null
  );
  const kept = new Map<string, EditableBatchItem>();
  for (const item of group) {
    const id = personOf(item);
    if (id && !kept.has(id) && wanted.some((person) => person.id === id)) kept.set(id, item);
  }
  const keptItems = new Set(kept.values());
  // The item being configured is reused first, so it stays on screen.
  const spare = group.filter((item) => !keptItems.has(item)).sort((a, b) => Number(b === anchor) - Number(a === anchor));
  const next = wanted.map((person) => {
    const existing = kept.get(person.id);
    if (existing) return assignDocumentPerson(existing, tag, person);
    return assignDocumentPerson(spare.shift() ?? copyBatchItem(anchor), tag, person);
  });
  if (next.length === 0) next.push(assignDocumentPerson(spare[0] ?? anchor, tag, null));

  const result: EditableBatchItem[] = [];
  let placed = false;
  for (const item of items) {
    if (!inGroup(item)) {
      result.push(item);
    } else if (!placed) {
      result.push(...next);
      placed = true;
    }
  }
  return result;
}

/**
 * A new company has other directors, shareholders and officers: each
 * template's per-person documents for those go back to one document for
 * nobody yet. Contacts are not the company's and stay.
 */
function resetCompanyDocumentPeople(items: EditableBatchItem[]): EditableBatchItem[] {
  const reset = new Set<string>();
  const result: EditableBatchItem[] = [];
  for (const item of items) {
    const person = item.configuration.documentPerson;
    if (!person || item.status === 'GENERATED' || !isCompanyPerPersonTag(person.tag)) {
      result.push(item);
      continue;
    }
    if (reset.has(item.templateId)) continue;
    reset.add(item.templateId);
    result.push(assignDocumentPerson(item, person.tag, null));
  }
  return result;
}

function itemConsumesMasterField(
  item: EditableBatchItem,
  fieldId: string,
): boolean {
  return item.status !== 'GENERATED'
    && Object.prototype.hasOwnProperty.call(item.configuration.masterOverrides, fieldId) === false;
}

function reduceBatchState(
  state: BatchWorkspaceState,
  action: DocumentGenerationBatchAction,
): BatchWorkspaceState {
  switch (action.type) {
    case 'template/add': {
      if (!state.capabilities.canEditComposition) return state;
      if (state.batch.items.length >= MAX_BATCH_ITEMS) return state;
      // Repeat copies of a template need their own local key until saved.
      const keyTaken = state.batch.items.some((item) => item.key === action.template.id);
      const key = keyTaken ? newItemKey(action.template.id) : action.template.id;
      const items = [...state.batch.items, itemFromTemplate(action.template, key)];
      const batch = replaceBatchItems(state.batch, items);
      return {
        ...state,
        batch,
        activeItemId: state.activeItemId ?? items[0].key,
        capabilities: deriveCapabilities(batch),
      };
    }
    case 'template/remove': {
      if (!state.capabilities.canEditComposition) return state;
      const items = state.batch.items.filter((item) => item.key !== action.itemId);
      if (items.length === state.batch.items.length) return state;
      const batch = replaceBatchItems(state.batch, items);
      const activeItemId = state.activeItemId === action.itemId
        ? items[0]?.key ?? null
        : state.activeItemId;
      return {
        ...state,
        batch,
        activeItemId,
        capabilities: deriveCapabilities(batch),
      };
    }
    case 'template/reorder': {
      if (!state.capabilities.canEditComposition) return state;
      const index = state.batch.items.findIndex((item) => item.key === action.itemId);
      const target = index + action.direction;
      if (index < 0 || target < 0 || target >= state.batch.items.length) return state;
      const items = [...state.batch.items];
      const [moved] = items.splice(index, 1);
      items.splice(target, 0, moved);
      const batch = replaceBatchItems(state.batch, items);
      return {
        ...state,
        batch,
        capabilities: deriveCapabilities(batch),
      };
    }
    case 'template/move': {
      if (!state.capabilities.canEditComposition) return state;
      const index = state.batch.items.findIndex((item) => item.key === action.itemId);
      if (index < 0) return state;
      const target = Math.max(0, Math.min(action.toIndex, state.batch.items.length - 1));
      if (target === index) return state;
      const items = [...state.batch.items];
      const [moved] = items.splice(index, 1);
      items.splice(target, 0, moved);
      const batch = replaceBatchItems(state.batch, items);
      return {
        ...state,
        batch,
        capabilities: deriveCapabilities(batch),
      };
    }
    case 'shared/company': {
      if (!state.capabilities.canEditSharedSetup) return state;
      const previousPrimaryCompanyId = state.batch.primaryCompanyId;
      const nextBatch = { ...state.batch, primaryCompanyId: action.companyId };
      const items = nextBatch.items.map((item) => {
        if (item.status === 'GENERATED') return item;
        const title = isAutoDocumentGenerationTitle(
          item.configuration.title,
          item.templateName,
        )
          ? DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN
          : item.configuration.title;
        return invalidateItem({
          ...item,
          configuration: { ...item.configuration, title },
        });
      });
      const synchronizedItems = items.map((item) => {
        if (
          item.status === 'GENERATED'
          || item.templateKind !== 'SERVICE_AGREEMENT'
          || !item.configuration.serviceAgreement
        ) {
          return item;
        }
        return {
          ...item,
          configuration: {
            ...item.configuration,
            serviceAgreement: syncServiceAgreementPrimaryCompany(
              item.configuration.serviceAgreement,
              previousPrimaryCompanyId,
              action.companyId,
            ),
          },
        };
      });
      const peopleItems = action.companyId === previousPrimaryCompanyId
        ? synchronizedItems
        : resetCompanyDocumentPeople(synchronizedItems);
      const batch = replaceBatchItems(nextBatch, peopleItems);
      return {
        ...state,
        batch,
        activeItemId: peopleItems.some((item) => item.key === state.activeItemId)
          ? state.activeItemId
          : peopleItems[0]?.key ?? null,
        capabilities: deriveCapabilities(batch),
      };
    }
    case 'shared/masterValue': {
      if (!state.capabilities.canEditSharedSetup) return state;
      const masterFieldValues = {
        ...state.batch.masterFieldValues,
        [action.fieldId]: action.value,
      };
      const batch = { ...state.batch, masterFieldValues };
      const items = batch.items.map((item) =>
        itemConsumesMasterField(item, action.fieldId) ? invalidateItem(item) : item,
      );
      return {
        ...state,
        batch: replaceBatchItems({ ...batch, items }, items),
        capabilities: deriveCapabilities(batch),
      };
    }
    case 'item/patch': {
      const items = state.batch.items.map((item) => {
        if (item.key !== action.itemId || item.status === 'GENERATED') return item;
        return invalidateItem({
          ...item,
          configuration: patchConfiguration(item.configuration, action.patch),
        });
      });
      const batch = replaceBatchItems(state.batch, items);
      return {
        ...state,
        batch,
        capabilities: deriveCapabilities(batch),
      };
    }
    case 'items/patch-many': {
      const targets = new Set(action.itemIds);
      if (targets.size === 0) return state;
      const items = state.batch.items.map((item) => {
        if (!targets.has(item.key) || item.status === 'GENERATED') return item;
        return invalidateItem({
          ...item,
          configuration: patchConfiguration(item.configuration, action.patch),
        });
      });
      const batch = replaceBatchItems(state.batch, items);
      return {
        ...state,
        batch,
        capabilities: deriveCapabilities(batch),
      };
    }
    case 'items/set-document-people': {
      if (!state.capabilities.canEditComposition) return state;
      const items = setDocumentPeople(state.batch.items, action.itemId, action.tag, action.people);
      if (items === state.batch.items) return state;
      const batch = replaceBatchItems(state.batch, items);
      const activeItemId = items.some((item) => item.key === state.activeItemId)
        ? state.activeItemId
        : items.find((item) => item.templateId === state.batch.items.find((entry) => entry.key === action.itemId)?.templateId)?.key
          ?? items[0]?.key
          ?? null;
      return {
        ...state,
        batch,
        activeItemId,
        capabilities: deriveCapabilities(batch),
      };
    }
    case 'conflict/accept-revision': {
      if (!state.conflict) return state;
      return {
        ...state,
        batch: { ...state.batch, revision: state.conflict.currentRevision },
        conflict: null,
      };
    }
    case 'item/edit-content': {
      const items = state.batch.items.map((item) => {
        if (item.key !== action.itemId || item.status === 'GENERATED') return item;
        return invalidateReviewOnly({
          ...item,
          editedContent: action.editedContent,
          editedContentJson: action.editedContentJson,
        });
      });
      const batch = replaceBatchItems(state.batch, items);
      return {
        ...state,
        batch,
        capabilities: deriveCapabilities(batch),
      };
    }
    case 'item/activate':
      return { ...state, activeItemId: action.itemId };
    case 'stage/navigate':
      return { ...state, stage: action.stage };
    case 'save/start':
      return { ...state, pending: 'save', conflict: null };
    case 'save/conflict':
      return { ...state, pending: null, conflict: { currentRevision: action.currentRevision } };
    case 'server/track-id':
      return {
        ...state,
        batch: { ...state.batch, id: action.id, revision: action.revision },
        pending: null,
        conflict: { currentRevision: action.currentRevision },
        dirty: true,
      };
    case 'server/replace': {
      const nextBatch = {
        ...action.batch,
        items: action.batch.items.map((item) => ({
          ...item,
          key: item.id ?? item.key,
        })),
      };
      return {
        batch: nextBatch,
        stage: BATCH_STAGES[Math.min(nextBatch.currentStage, BATCH_STAGES.length - 1)],
        activeItemId: nextBatch.activeItemId ?? nextBatch.items[0]?.key ?? null,
        savedSnapshot: canonicalEditableState(nextBatch),
        dirty: false,
        pending: null,
        conflict: null,
        capabilities: deriveCapabilities(nextBatch),
      };
    }
    case 'local/initialize':
      return createInitialBatchWorkspaceState(action.batch);
    case 'request/start':
      return { ...state, pending: action.pending };
    case 'request/end':
      return { ...state, pending: null };
    default:
      return state;
  }
}

export function documentGenerationBatchReducer(
  state: BatchWorkspaceState,
  action: DocumentGenerationBatchAction,
): BatchWorkspaceState {
  const next = reduceBatchState(state, action);
  if (next.dirty) return next;
  const currentSnapshot = canonicalEditableState(next.batch);
  if (next.savedSnapshot === currentSnapshot) {
    return next;
  }
  return {
    ...next,
    dirty: next.pending === 'save' ? false : true,
  };
}

export function selectCanEnterConfigure(state: BatchWorkspaceState): boolean {
  return state.batch.items.length > 0 && Boolean(state.batch.primaryCompanyId);
}

export function selectCanRequestPreflight(state: BatchWorkspaceState): boolean {
  return state.batch.items.length > 0
    && state.batch.items.every(
      (item) => item.status === 'GENERATED' || item.status === 'READY',
    );
}

export function selectReadyCount(state: BatchWorkspaceState): {
  ready: number;
  total: number;
} {
  return {
    ready: state.batch.items.filter(
      (item) => item.status === 'READY' || item.status === 'GENERATED',
    ).length,
    total: state.batch.items.length,
  };
}

export function selectAffectedItemKeys(
  state: BatchWorkspaceState,
  fieldId: string,
): string[] {
  return state.batch.items
    .filter((item) => itemConsumesMasterField(item, fieldId))
    .map((item) => item.key);
}

export function masterFieldIdFor(key: string, type: string): string {
  return masterFieldId(key, type as never);
}
