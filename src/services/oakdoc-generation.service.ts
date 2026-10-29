import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { ensureA4ServerDomGlobals } from '@/lib/document-editor/a4-server-dom';
import {
  OAKDOC_MIME_TYPE,
  readOakDocTemplateMetadata,
} from '@/lib/document-editor/oakdoc-template';
import {
  OAKDOC_GENERATED_CONTENT,
  mergeGeneratedOakDocMetadata,
  readGeneratedOakDocAssetMetadata,
  type GeneratedOakDocAssetMetadata,
} from '@/lib/document-editor/document-engine';
import {
  OAKDOC_CONDITION_TAG_PREFIX,
  inspectOakDocConditions,
  readOakDocConditionDefinitions,
  resolveOakDocConditions,
} from '@/lib/document-editor/oakdoc-conditions';
import {
  inspectOakDocFields,
  pruneDeletedOakDocFields,
  resolveOakDocFields,
} from '@/lib/document-editor/oakdoc-fields';
import {
  buildOakDocResolutionDates,
  buildOakDocResolutionValues,
  buildSelectedContact,
  type OakDocAgreementContext,
  type OakDocCompanyDetail,
  type OakDocContact,
} from '@/lib/document-editor/oakdoc-context';
import {
  claimGeneratedDocumentRevision,
  readGeneratedDocumentRevision,
} from '@/lib/document-editor/generated-document-revision';
import {
  resolveOakDocRepeaters,
  isOakDocRepeaterOuterTag,
  inspectOakDocRepeaters,
} from '@/lib/document-editor/oakdoc-repeaters';
import {
  OAKDOC_DIVIDEND_PER_SHARE_KEY,
  OAKDOC_REPEATER_ITEM_ID,
  oakDocContactListNameFromSlug,
  oakDocRepeaterDefinitionForTag,
  parseOakDocAmount,
  parseOakDocContactListSlug,
  type OakDocRepeaterGenerationData,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import {
  checkOakDocPersonFields,
  formatOakDocPersonValues,
  type OakDocPersonValues,
} from '@/lib/document-editor/oakdoc-person-values';
import { OAKDOC_SIGNATURE_TAGS } from '@/lib/document-editor/oakdoc-signatures';
import {
  OAKDOC_REPEATER_ITEM_FIELD_TAGS,
  classifyOakDocTag,
  diagnoseOakDocTags,
  isOakDocRepeaterItemFieldTag,
  oakDocFieldContext,
  type OakDocFieldContext,
} from '@/lib/document-editor/oakdoc-field-registry';
import {
  getDocumentContactParties,
  getDocumentPartyOptions,
} from '@/services/document-party.service';
import {
  buildOakDocCustomFieldValues,
  oakDocContactShortlist,
  oakDocCustomContactFields,
  mergeOakDocRepeaterSectionSummaries,
  oakDocRepeaterSectionSummary,
  oakDocCustomFieldTypes,
  parseOakDocCustomFieldTag,
  type OakDocPersonField,
} from '@/lib/document-editor/oakdoc-custom-fields';
import { getServiceAgreementDraftById } from '@/services/service-agreement/draft.service';
import {
  finalizeServiceAgreementPageBreaks,
  renderServiceAgreementOakDoc,
  type ServiceAgreementOakDocParty,
} from '@/services/service-agreement/oakdoc-renderer';
import type { ServiceAgreementDraftDto } from '@/services/service-agreement/types';
import type { OakDocDiagnostic } from '@/types/oakdoc';
import type { PlaceholderValueType } from '@/types/placeholders';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import {
  OAKDOC_ERROR_REASONS,
  type OakDocSaveReceipt,
  type OakDocSnapshotIdentity,
} from '@/types/oakdoc';
import { storage, StorageKeys } from '@/lib/storage';
import { inspectOakDocPackage } from '@/lib/document-editor/oakdoc-package-policy';
import { deriveOakDocTemplateFieldTags } from '@/lib/document-editor/oakdoc-field-manifest';
import type { TenantAwareParams } from '@/lib/types';
import type { TaskLaunchContext } from '@/services/tasks/types';
import { getCompanyById } from '@/services/company.service';
import { applyCompanyFieldValues } from '@/lib/document-editor/oakdoc-company-field-homes';
import { downloadOakDocTemplate } from '@/services/oakdoc-template.service';
import {
  expandPinnedOakDocPartials,
  pinOakDocPartials,
  withResolutionPartialFields,
  readOakDocPartialPins,
} from '@/services/oakdoc-partial.service';
import {
  readOakDocSowSnapshot,
  type OakDocPartialPin,
} from '@/lib/document-editor/oakdoc-partials';
import {
  composeOakDocResolutions,
  SAMPLE_RESOLUTION_COMPOSITION,
  type ResolutionComposition,
} from '@/lib/document-editor/oakdoc-resolutions';

const log = createLogger('oakdoc-generation');

function sha256(buffer: Buffer | Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function safeDocxName(value: string): string {
  const base = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'OakDoc';
  return base.toLowerCase().endsWith('.docx') ? base : `${base}.docx`;
}

export function toOakDocCompanyDetail(value: unknown): OakDocCompanyDetail {
  // Prisma Dates and Decimal values are serialized to stable string forms.
  // OakDoc's resolver deliberately accepts date strings and numeric strings.
  return JSON.parse(JSON.stringify(value)) as OakDocCompanyDetail;
}

function taskMetadata(
  task?: TaskLaunchContext,
): Record<string, unknown> | undefined {
  if (!task) return undefined;
  return {
    taskId: task.taskId,
    taskStageId: task.taskStageId,
    ...(task.returnTo ? { returnTo: task.returnTo } : {}),
  };
}

export interface OakDocGenerationInput {
  templateId: string;
  companyId: string;
  selectedDirectorId?: string;
  selectedShareholderId?: string;
  /** Directors a directors repeater lists; absent means all current directors. */
  selectedDirectorIds?: string[];
  /** Shareholders a shareholders repeater lists; absent means all current shareholders. */
  selectedShareholderIds?: string[];
  /** Officers of any role an officers repeater lists, in order; absent means none. */
  selectedOfficerIds?: string[];
  /** Any workspace contact; one linked to the company prints its role there. */
  selectedContactId?: string;
  /** Contacts listed by a contacts repeater, in this order. */
  contactIds?: string[];
  /** Contacts listed by each named contacts list (`repeat.contacts.<slug>`), by slug, in order. */
  selectedContactListIds?: Record<string, string[]>;
  /** Per-person field values (`item.<key>`): by repeater tag, then person id, then key. */
  personValues?: OakDocPersonValues;
  /**
   * Custom field values by key (without `custom.`). Absent leaves custom
   * fields showing their placeholder, as the editor preview does.
   */
  customData?: Record<string, unknown>;
  agreement?: OakDocAgreementContext;
  /** Structured agreement composed into a SERVICE_AGREEMENT master. */
  serviceAgreementId?: string;
  /** Numbered resolutions composed into a RESOLUTION master. */
  resolution?: ResolutionComposition | null;
  resolutionDate?: Date | string;
  /**
   * Company values missing on record, set for this document only, by
   * company field home id (see `oakdoc-company-field-homes`).
   */
  companyFieldValues?: Record<string, string>;
  generatedBy?: string;
}

const CONTEXT_LABELS: Partial<Record<OakDocFieldContext, string>> = {
  selectedDirector: 'a selected director',
  selectedShareholder: 'a selected shareholder',
  selectedContact: 'a selected contact',
  agreement: 'agreement details',
  resolution: 'a resolution date',
};

/**
 * Structured generation diagnostics: unsupported controls, and fields whose
 * required context was not supplied (distinct from a supplied-but-empty
 * value, which resolves to an empty field).
 */
export function diagnoseOakDocGeneration(input: {
  usedTags: readonly string[];
  provided: ReadonlySet<OakDocFieldContext>;
  /** Custom fields the template defines; checked only when values are supplied. */
  customFieldKeys?: ReadonlySet<string>;
}): OakDocDiagnostic[] {
  const diagnostics = diagnoseOakDocTags(input.usedTags, 'render');
  const undefinedCustom = Array.from(new Set(input.usedTags))
    .filter((tag) => {
      const parsed = parseOakDocCustomFieldTag(tag);
      return Boolean(parsed && input.customFieldKeys && !input.customFieldKeys.has(parsed.key));
    })
    .sort();
  if (undefinedCustom.length > 0) {
    diagnostics.push({
      code: 'OAKDOC_CUSTOM_FIELD_UNDEFINED',
      severity: 'warning',
      stage: 'render',
      message: `Custom field${undefinedCustom.length === 1 ? '' : 's'} ${undefinedCustom.join(', ')} ${undefinedCustom.length === 1 ? 'is' : 'are'} not defined on the template, so ${undefinedCustom.length === 1 ? 'it prints' : 'they print'} blank.`,
      controlTag: undefinedCustom[0],
    });
  }
  const missing = new Map<OakDocFieldContext, string[]>();
  for (const tag of new Set(input.usedTags)) {
    const context = oakDocFieldContext(tag);
    if (!context || !CONTEXT_LABELS[context] || input.provided.has(context)) continue;
    missing.set(context, [...(missing.get(context) ?? []), tag]);
  }
  for (const [context, tags] of missing) {
    diagnostics.push({
      code: 'OAKDOC_CONTEXT_MISSING',
      severity: 'error',
      stage: 'render',
      message: `This template needs ${CONTEXT_LABELS[context]} (${tags.sort().join(', ')}).`,
      controlTag: tags[0],
    });
  }
  return diagnostics;
}

export interface OakDocGenerationResult {
  bytes: Buffer;
  values: Record<string, string>;
  template: {
    id: string;
    name: string;
    version: number;
    sha256: string;
    fileName: string;
  };
  metadata: Omit<
    GeneratedOakDocAssetMetadata,
    'storageKey' | 'fileName' | 'fileSize' | 'sha256' | 'generatedAt'
  >;
  diagnostics: OakDocDiagnostic[];
  /** Canonical hash of the composed Service Agreement, when one was composed. */
  agreementHash?: string;
  /** Partials the numbered resolutions used, at the versions pinned for this render. */
  resolutionPartialPins?: OakDocPartialPin[];
}

/**
 * Resolve one OakDoc master entirely in memory.
 *
 * The immutable template asset is downloaded, copied into Uint8Array transforms,
 * and never written back to the template storage key.
 */
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Some callers pass the acting user's id as `generatedBy`, others their
 * name. Documents print the preparer's name, so an id is looked up here.
 */
async function resolvePreparerName(
  generatedBy: string | undefined,
  tenantId: string,
): Promise<string | undefined> {
  if (!generatedBy || !USER_ID.test(generatedBy)) return generatedBy;
  const user = await prisma.user.findFirst({
    where: { id: generatedBy, tenantId, deletedAt: null },
    select: { firstName: true, lastName: true },
  });
  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim() : '';
  return name || undefined;
}

export async function generateOakDocBytes(
  input: OakDocGenerationInput,
  params: Pick<TenantAwareParams, 'tenantId'>,
): Promise<OakDocGenerationResult> {
  // OakDoc's DOCX transforms use standard DOM XML APIs in both browser and
  // server runtimes. Install the shared JSDOM-backed globals explicitly here
  // so preview/generation never depends on an A4 code path running first.
  ensureA4ServerDomGlobals();

  const template = await prisma.documentTemplate.findFirst({
    where: {
      id: input.templateId,
      tenantId: params.tenantId,
      deletedAt: null,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      version: true,
      contentJson: true,
      compositionType: true,
      placeholders: true,
    },
  });
  if (!template) throw new NotFoundError('OakDoc template not found');

  const templateMetadata = readOakDocTemplateMetadata(template.contentJson);
  if (!templateMetadata) {
    throw new ValidationError('The selected template is not an OakDoc template');
  }

  const { buffer: masterBuffer, metadata: downloadedMetadata } =
    await downloadOakDocTemplate(template.id, params.tenantId);
  return renderOakDocMaster({
    id: template.id,
    name: template.name,
    version: template.version,
    sha256: templateMetadata.sha256,
    fileName: templateMetadata.fileName,
    compositionType: template.compositionType,
    bytes: new Uint8Array(masterBuffer),
    fieldTags: downloadedMetadata.fieldTags,
    partialPins: readOakDocPartialPins(template.contentJson),
    customFieldTypes: oakDocCustomFieldTypes(template.placeholders),
    customContactFields: oakDocCustomContactFields(template.placeholders),
    contactShortlist: contactShortlistIds(template.placeholders),
    contactListShortlists: contactListShortlistIds(template.placeholders),
    personFields: oakDocRepeaterSectionSummary(template.placeholders).personFields ?? {},
  }, input, params);
}

export interface OakDocMasterPreviewInput extends Omit<OakDocGenerationInput, 'templateId'> {
  /** The editor's current, possibly unsaved, master bytes. */
  bytes: Uint8Array;
  fileName: string;
  /** Saved template being edited, for its partial pins and composition. */
  templateId?: string;
  compositionType?: 'STANDARD' | 'SERVICE_AGREEMENT' | 'RESOLUTION';
  /** Same meaning as on save: partials to move to their latest version. */
  refreshPartialPins?: 'all' | string[];
}

/**
 * Preview unsaved master bytes with the production renderer. Partials are
 * pinned exactly as a save would pin them, and nothing is written: the
 * stored template, its asset and its pins stay unchanged.
 */
export async function previewOakDocMaster(
  input: OakDocMasterPreviewInput,
  params: Pick<TenantAwareParams, 'tenantId'>,
): Promise<OakDocGenerationResult> {
  ensureA4ServerDomGlobals();
  inspectOakDocPackage(input.bytes, 'master');
  const saved = input.templateId
    ? await prisma.documentTemplate.findFirst({
        where: { id: input.templateId, tenantId: params.tenantId, deletedAt: null },
        select: { id: true, name: true, version: true, contentJson: true, compositionType: true, placeholders: true },
      })
    : null;
  if (input.templateId && !saved) throw new NotFoundError('OakDoc template not found');
  if (saved && !readOakDocTemplateMetadata(saved.contentJson)) {
    throw new ValidationError('The selected template is not an OakDoc template');
  }
  const partialPins = await pinOakDocPartials({
    bytes: input.bytes,
    tenantId: params.tenantId,
    existingPins: saved ? readOakDocPartialPins(saved.contentJson) : undefined,
    refresh: input.refreshPartialPins,
  });
  const compositionType = input.compositionType ?? saved?.compositionType ?? 'STANDARD';
  return renderOakDocMaster({
    id: saved?.id ?? 'unsaved-template',
    name: saved?.name ?? input.fileName,
    version: saved?.version ?? 0,
    sha256: sha256(input.bytes),
    fileName: input.fileName,
    compositionType,
    bytes: input.bytes,
    fieldTags: deriveOakDocTemplateFieldTags(input.bytes),
    partialPins,
    customFieldTypes: oakDocCustomFieldTypes(saved?.placeholders),
    customContactFields: oakDocCustomContactFields(saved?.placeholders),
    contactShortlist: contactShortlistIds(saved?.placeholders),
    contactListShortlists: contactListShortlistIds(saved?.placeholders),
    personFields: oakDocRepeaterSectionSummary(saved?.placeholders).personFields ?? {},
  }, {
    ...input,
    // The editor has no Configure step, so it previews sample resolutions.
    resolution: input.resolution ?? (compositionType === 'RESOLUTION' ? SAMPLE_RESOLUTION_COMPOSITION : null),
  }, params);
}

interface OakDocMasterSource {
  id: string;
  name: string;
  version: number;
  sha256: string;
  fileName: string;
  compositionType: string;
  bytes: Uint8Array;
  fieldTags: readonly string[];
  partialPins: OakDocPartialPin[];
  /** Custom fields the template defines, by key, with their value type. */
  customFieldTypes: Record<string, PlaceholderValueType>;
  /** Contact custom fields, by key, with the ids of their contact shortlist. */
  customContactFields: Record<string, string[]>;
  /** Ids the contacts repeater may list (template and partial shortlists); null: any contact. */
  contactShortlist: string[] | null;
  /** Ids each named contacts list may list, by slug; a list without a shortlist takes any contact. */
  contactListShortlists: Record<string, string[]>;
  /** Per-person fields of the template's sections (and its inserted partials'), by repeater tag. */
  personFields: Record<string, OakDocPersonField[]>;
}

function contactShortlistIds(placeholders: unknown): string[] | null {
  return oakDocContactShortlist(placeholders)?.map((contact) => contact.id) ?? null;
}

/** Shortlisted contact ids of each named contacts list (template's and partials'), by slug. */
function contactListShortlistIds(placeholders: unknown): Record<string, string[]> {
  const lists: Record<string, string[]> = {};
  for (const [tag, contacts] of Object.entries(oakDocRepeaterSectionSummary(placeholders).shortlists)) {
    const slug = parseOakDocContactListSlug(tag);
    if (slug && contacts.length > 0) lists[slug] = contacts.map((contact) => contact.id);
  }
  return lists;
}

/**
 * Per-person values ready to print, for the sections in the document: the
 * people each section lists are the ones it prints. Missing required values
 * and totals that don't add up stop generation, naming the person.
 */
function resolvePersonValues(input: {
  personFields: Record<string, OakDocPersonField[]>;
  repeaterTags: readonly string[];
  data: OakDocRepeaterGenerationData;
  values?: OakDocPersonValues;
  customData: Record<string, unknown>;
}): Record<string, Record<string, Record<string, string>>> {
  const present = new Set(input.repeaterTags);
  const fields = Object.fromEntries(Object.entries(input.personFields).filter(([tag]) => present.has(tag)));
  const people = Object.fromEntries(Object.keys(fields).map((tag) => {
    const definition = oakDocRepeaterDefinitionForTag(tag);
    const items = definition ? definition.generationDataAdapter(input.data, tag) : [];
    return [tag, items.map((item) => ({
      id: item[OAKDOC_REPEATER_ITEM_ID] ?? '',
      name: item[`${definition!.itemTagNamespace}.name`] || definition!.itemLabel,
    })).filter((person) => person.id)];
  }));
  const checked = checkOakDocPersonFields({
    personFields: fields,
    people,
    values: input.values,
    customData: input.customData,
    sectionName: (tag) => {
      const slug = parseOakDocContactListSlug(tag);
      return slug ? oakDocContactListNameFromSlug(slug) : oakDocRepeaterDefinitionForTag(tag)?.label ?? tag;
    },
  });
  if (checked.issues.length > 0) {
    throw new ValidationError(checked.issues.map((issue) => issue.message).join(' '), {
      personFields: checked.issues,
    });
  }
  return formatOakDocPersonValues(fields, checked.values);
}

/**
 * Render a master with the production pipeline. Stored-template generation
 * and the editor's preview both go through here, so a preview shows exactly
 * what generation would produce from the same bytes and context.
 */
async function renderOakDocMaster(
  master: OakDocMasterSource,
  input: Omit<OakDocGenerationInput, 'templateId'>,
  params: Pick<TenantAwareParams, 'tenantId'>,
): Promise<OakDocGenerationResult> {
  const company = await getCompanyById(input.companyId, params.tenantId);
  if (!company) throw new NotFoundError('Company not found');

  const knownTags = new Set(master.fieldTags);
  let sourceBytes = pruneDeletedOakDocFields(master.bytes, knownTags).bytes;
  let partialPins = master.partialPins;
  const resolutionDiagnostics: OakDocDiagnostic[] = [];
  let resolutionPartialPins: OakDocPartialPin[] | undefined;
  let customFieldTypes = master.customFieldTypes;
  let customContactFields = master.customContactFields;
  let contactShortlist = master.contactShortlist;
  let contactListShortlists = master.contactListShortlists;
  let personFields = master.personFields;
  if (master.compositionType === 'RESOLUTION') {
    if (!input.resolution) {
      resolutionDiagnostics.push({
        code: 'OAKDOC_CONTEXT_MISSING',
        severity: 'error',
        stage: 'render',
        message: 'This resolution template needs the resolutions chosen on Configure.',
      });
    } else {
      // Numbered resolutions go in first: the partials they reference are
      // pinned at their current version and expanded with the master's own.
      const composed = composeOakDocResolutions(sourceBytes, input.resolution);
      resolutionDiagnostics.push(...composed.diagnostics);
      sourceBytes = composed.bytes;
      if (composed.partialIds.length > 0) {
        partialPins = await pinOakDocPartials({
          bytes: sourceBytes,
          tenantId: params.tenantId,
          existingPins: master.partialPins,
        });
        const used = new Set(composed.partialIds);
        resolutionPartialPins = partialPins.filter((pin) => used.has(pin.partialId));
        // The chosen partials' own custom fields, the template's winning on a shared key.
        const partialFields = await withResolutionPartialFields([], composed.partialIds, params.tenantId);
        customFieldTypes = { ...oakDocCustomFieldTypes(partialFields), ...master.customFieldTypes };
        customContactFields = { ...oakDocCustomContactFields(partialFields), ...master.customContactFields };
        const partialShortlist = contactShortlistIds(partialFields);
        if (partialShortlist) contactShortlist = Array.from(new Set([...(contactShortlist ?? []), ...partialShortlist]));
        contactListShortlists = { ...contactListShortlists };
        for (const [slug, ids] of Object.entries(contactListShortlistIds(partialFields))) {
          contactListShortlists[slug] = Array.from(new Set([...(contactListShortlists[slug] ?? []), ...ids]));
        }
        personFields = mergeOakDocRepeaterSectionSummaries(
          { names: {}, shortlists: {}, personFields },
          oakDocRepeaterSectionSummary(partialFields),
        ).personFields ?? {};
      }
    }
  }
  // Insert pinned native partials before anything reads the fields, so the
  // partials' own fields, conditions and repeaters resolve like the master's.
  const partials = await expandPinnedOakDocPartials({
    bytes: sourceBytes,
    pins: partialPins,
    tenantId: params.tenantId,
  });
  const masterBytes = partials.bytes;

  const composition = master.compositionType === 'SERVICE_AGREEMENT'
    ? await loadAgreementComposition(input.serviceAgreementId, params.tenantId)
    : null;
  // Word scope-of-work partials are inserted after composition, so their
  // fields are collected from the item snapshots up front.
  const sowFieldTags = (composition?.agreement.items ?? []).flatMap(
    (item) => readOakDocSowSnapshot(item.partialContentSnapshot)?.fieldTags ?? [],
  );

  const fieldSummary = inspectOakDocFields(masterBytes);
  const conditionSummary = inspectOakDocConditions(masterBytes);
  const resolutionTags = Array.from(new Set([
    ...master.fieldTags,
    ...fieldSummary.tags,
    ...conditionSummary.fieldTags,
    ...sowFieldTags,
  ]));
  const agreementContext = input.agreement ?? (composition
    ? {
        agreementDate: composition.agreement.agreementDate,
        effectiveDate: composition.agreement.effectiveDate,
        termMonths: composition.agreement.termMonths,
      }
    : undefined);

  const selectedContact = input.selectedContactId
    ? await resolveSelectedContact(input.selectedContactId, input.companyId, params.tenantId)
    : composition?.signers[0] ?? composition?.representatives[0];
  // With a shortlist set by the template author, only shortlisted contacts print.
  const shortlist = contactShortlist ? new Set(contactShortlist) : null;
  const contactIds = shortlist
    ? (input.contactIds ?? []).filter((id) => shortlist.has(id))
    : input.contactIds;
  // Each named list prints only its own ticked contacts, on its shortlist when it has one.
  const contactListIds: Record<string, string[]> = {};
  for (const [slug, ids] of Object.entries(input.selectedContactListIds ?? {})) {
    const listShortlist = contactListShortlists[slug] ? new Set(contactListShortlists[slug]) : null;
    contactListIds[slug] = listShortlist ? ids.filter((id) => listShortlist.has(id)) : ids;
  }
  const allContactIds = [...(contactIds ?? []), ...Object.values(contactListIds).flat()];
  const contactParties = allContactIds.length
    ? await getDocumentContactParties({
        contactIds: allContactIds,
        companyId: input.companyId,
        tenantId: params.tenantId,
      })
    : [];
  const contactById = new Map(contactParties.map((contact) => [contact.id, contact]));
  const contacts = Array.from(new Set(contactIds ?? [])).flatMap((id) => contactById.get(id) ?? []);
  const contactLists = Object.fromEntries(Object.entries(contactListIds).map(
    ([slug, ids]) => [slug, Array.from(new Set(ids)).flatMap((id) => contactById.get(id) ?? [])],
  ));
  const companyDetail = applyCompanyFieldValues(
    toOakDocCompanyDetail(company),
    input.companyFieldValues,
  );
  const provided = new Set<OakDocFieldContext>(['company', 'system']);
  if (companyDetail.officers?.some((officer) => officer.id === input.selectedDirectorId)) {
    provided.add('selectedDirector');
  }
  if (companyDetail.shareholders?.some((holder) => holder.id === input.selectedShareholderId)) {
    provided.add('selectedShareholder');
  }
  if (selectedContact) provided.add('selectedContact');
  if (agreementContext) provided.add('agreement');
  if (input.resolutionDate) provided.add('resolution');
  const diagnostics = [
    ...resolutionDiagnostics,
    ...partials.diagnostics,
    ...diagnoseOakDocGeneration({
      usedTags: [...fieldSummary.tags, ...conditionSummary.fieldTags, ...sowFieldTags],
      provided,
      ...(input.customData ? { customFieldKeys: new Set(Object.keys(customFieldTypes)) } : {}),
    }),
  ];

  const preparerName = await resolvePreparerName(input.generatedBy, params.tenantId);
  const resolutionInput = {
    company: companyDetail,
    fieldTags: resolutionTags,
    selectedDirectorId: input.selectedDirectorId,
    selectedShareholderId: input.selectedShareholderId,
    selectedDirectorIds: input.selectedDirectorIds,
    selectedShareholderIds: input.selectedShareholderIds,
    selectedContact,
    agreement: agreementContext,
    resolution: { date: input.resolutionDate },
    generatedBy: preparerName,
  };
  const custom = input.customData
    ? buildOakDocCustomFieldValues({
        tags: resolutionTags,
        data: input.customData,
        types: customFieldTypes,
        contacts: await resolveCustomContacts({
          fields: customContactFields,
          data: input.customData,
          companyId: input.companyId,
          tenantId: params.tenantId,
        }),
      })
    : { values: {}, dates: {} };
  const values = { ...buildOakDocResolutionValues(resolutionInput), ...custom.values };
  const dates = { ...buildOakDocResolutionDates(resolutionInput), ...custom.dates };

  const conditioned = resolveOakDocConditions({
    docxBytes: masterBytes,
    values,
    allowedFields: new Set(resolutionTags),
    // Conditions on a section's own fields resolve for each person it lists.
    deferField: isOakDocRepeaterItemFieldTag,
  });
  if (conditioned.unresolvedFields.length > 0) {
    throw new ValidationError(
      `Conditional fields are unavailable: ${conditioned.unresolvedFields.join(', ')}`,
      { fields: conditioned.unresolvedFields },
    );
  }

  const repeaterData = {
    company: companyDetail,
    contacts,
    contactLists,
    selectedDirectorIds: input.selectedDirectorIds,
    selectedShareholderIds: input.selectedShareholderIds,
    selectedOfficerIds: input.selectedOfficerIds,
    dividendPerShare: parseOakDocAmount(input.customData?.[OAKDOC_DIVIDEND_PER_SHARE_KEY]),
  };
  // Per-person values are checked only with Configure's values, as custom fields are.
  const personValues = input.customData
    ? resolvePersonValues({
        personFields,
        repeaterTags: inspectOakDocRepeaters(conditioned.bytes).tags,
        data: repeaterData,
        values: input.personValues,
        customData: input.customData,
      })
    : undefined;
  const repeatedSections = resolveOakDocRepeaters({
    docxBytes: conditioned.bytes,
    ...repeaterData,
    personValues,
    conditions: readOakDocConditionDefinitions(conditioned.bytes),
    ...(composition
      ? { signers: composition.signers, authorisedRepresentatives: composition.representatives }
      : {}),
  });
  // A condition on a section's field placed outside any section has no person: it is left out.
  const leftover = resolveOakDocConditions({
    docxBytes: repeatedSections.bytes,
    values: {},
    allowedFields: OAKDOC_REPEATER_ITEM_FIELD_TAGS,
  });
  const repeated = { ...repeatedSections, bytes: leftover.bytes };

  let composedBytes = repeated.bytes;
  let agreementHash: string | undefined;
  if (master.compositionType === 'SERVICE_AGREEMENT' && !composition) {
    diagnostics.push({
      code: 'OAKDOC_CONTEXT_MISSING',
      severity: 'error',
      stage: 'render',
      message: 'This Service Agreement template needs its structured agreement (services, fees and entities).',
    });
  }
  if (composition) {
    const rendered = renderServiceAgreementOakDoc({
      masterDocxBytes: repeated.bytes,
      agreement: composition.agreement,
      fieldContext: {
        values,
        signers: composition.signers.map(toAgreementParty),
        authorizedRepresentatives: composition.representatives.map(toAgreementParty),
      },
    });
    const sowPartials = await expandPinnedOakDocPartials({
      bytes: rendered.bytes,
      pins: rendered.sowPartialPins,
      tenantId: params.tenantId,
    });
    diagnostics.push(...sowPartials.diagnostics);
    composedBytes = finalizeServiceAgreementPageBreaks(sowPartials.bytes);
    agreementHash = rendered.agreementMetadata.canonicalHash;
    for (const diagnostic of rendered.diagnostics) {
      if (diagnostic.severity === 'info') continue;
      diagnostics.push({
        code: `OAKDOC_AGREEMENT_${diagnostic.code}`,
        severity: diagnostic.severity,
        stage: 'render',
        message: diagnostic.message,
      });
    }
  }

  const resolved = resolveOakDocFields(composedBytes, values, { dates });
  const bytes = Buffer.from(resolved.bytes);

  return {
    bytes,
    values,
    template: {
      id: master.id,
      name: master.name,
      version: master.version,
      sha256: master.sha256,
      fileName: master.fileName,
    },
    metadata: {
      schemaVersion: 1,
      mimeType: OAKDOC_MIME_TYPE,
      templateId: master.id,
      templateVersion: master.version,
      templateSha256: master.sha256,
      fieldsUpdated: resolved.updated,
      unresolvedTags: resolved.unresolvedTags,
      conditionsResolved: conditioned.resolved,
      conditionsKept: conditioned.kept,
      conditionsRemoved: conditioned.removed,
      repeatersResolved: repeated.repeatersResolved,
      repeaterItemsCreated: repeated.itemsCreated,
    },
    diagnostics,
    ...(agreementHash ? { agreementHash } : {}),
    ...(resolutionPartialPins ? { resolutionPartialPins } : {}),
  };
}

/**
 * The details of the contact chosen for each Contact custom field. Only a
 * contact on the field's shortlist is used; any other value prints blank.
 */
async function resolveCustomContacts(input: {
  fields: Record<string, string[]>;
  data: Readonly<Record<string, unknown>>;
  companyId: string;
  tenantId: string;
}): Promise<Record<string, unknown>> {
  const chosen = Object.entries(input.fields).flatMap(([key, shortlist]) => {
    const id = input.data[key];
    return typeof id === 'string' && shortlist.includes(id) ? [[key, id] as const] : [];
  });
  const parties = await getDocumentContactParties({
    contactIds: chosen.map(([, id]) => id),
    companyId: input.companyId,
    tenantId: input.tenantId,
  });
  const byId = new Map(parties.map((party) => [party.id, party]));
  const contacts: Record<string, unknown> = Object.fromEntries(
    Object.keys(input.fields).map((key) => [key, undefined]),
  );
  for (const [key, id] of chosen) contacts[key] = buildSelectedContact(byId.get(id));
  return contacts;
}

/**
 * The contact a document addresses: the company's own contact when linked,
 * otherwise any contact in the workspace. Unknown ids resolve to nothing, so
 * generation reports the missing contact.
 */
async function resolveSelectedContact(
  contactId: string,
  companyId: string,
  tenantId: string,
): Promise<OakDocContact | undefined> {
  const { contacts } = await getDocumentPartyOptions(companyId, tenantId);
  return contacts.find((contact) => contact.id === contactId)
    ?? (await getDocumentContactParties({ contactIds: [contactId], companyId, tenantId }))[0];
}

interface AgreementComposition {
  agreement: ServiceAgreementDraftDto;
  representatives: OakDocContact[];
  signers: OakDocContact[];
}

async function loadAgreementComposition(
  serviceAgreementId: string | undefined,
  tenantId: string,
): Promise<AgreementComposition | null> {
  if (!serviceAgreementId) return null;
  const agreement = await getServiceAgreementDraftById(serviceAgreementId, tenantId);
  if (!agreement) throw new NotFoundError('Service Agreement not found');
  const representatives: OakDocContact[] = agreement.authorizedRepresentativeSnapshots.map(
    (representative) => ({
      id: representative.id,
      contactId: representative.id,
      name: representative.name,
      detail: representative.role,
      role: representative.role,
      contactType: 'INDIVIDUAL',
      email: representative.email,
      phone: representative.phone,
    }),
  );
  const signerIds = new Set(agreement.signerContactIds);
  return {
    agreement,
    representatives,
    signers: representatives.filter((representative) => signerIds.has(representative.id)),
  };
}

function toAgreementParty(contact: OakDocContact): ServiceAgreementOakDocParty {
  return {
    contactId: contact.contactId ?? contact.id,
    name: contact.name,
    role: contact.role,
    email: contact.email,
    phone: contact.phone,
  };
}

export interface MaterializeOakDocInput extends OakDocGenerationInput {
  generatedDocumentId: string;
  expectedRevision: number;
  expectedBatchItemId?: string;
  title: string;
  contactIds?: string[];
}

/**
 * Persist a resolved OakDoc into the ordinary GeneratedDocument lifecycle.
 *
 * The generated DOCX is uploaded to a generated-document key. Database update
 * uses the same revision claim as A4 documents; an uploaded orphan is deleted
 * when the claim/update fails.
 */
export async function materializeOakDocGeneratedDocument(
  input: MaterializeOakDocInput,
  params: TenantAwareParams,
  taskIntegrationContext?: TaskLaunchContext,
) {
  const existing = await prisma.generatedDocument.findFirst({
    where: {
      id: input.generatedDocumentId,
      tenantId: params.tenantId,
      deletedAt: null,
    },
  });
  if (!existing) throw new NotFoundError('Document draft not found');
  if (existing.status !== 'DRAFT') {
    throw new ValidationError('Only draft documents can be generated');
  }

  if (input.expectedBatchItemId) {
    const item = await prisma.documentGenerationBatchItem.findFirst({
      where: {
        id: input.expectedBatchItemId,
        tenantId: params.tenantId,
        generatedDocumentId: input.generatedDocumentId,
        templateId: input.templateId,
      },
      select: { id: true },
    });
    if (!item) throw new NotFoundError('Batch item not found');
  }

  const generation = await generateOakDocBytes(input, params);
  const assetId = randomUUID();
  const storageKey = StorageKeys.oakDocGeneratedAsset(
    params.tenantId,
    input.generatedDocumentId,
    assetId,
  );
  const fileName = safeDocxName(input.title);
  const generatedAt = new Date().toISOString();
  const digest = sha256(generation.bytes);

  await storage.upload(storageKey, generation.bytes, {
    contentType: OAKDOC_MIME_TYPE,
    metadata: {
      tenantId: params.tenantId,
      generatedDocumentId: input.generatedDocumentId,
      templateId: generation.template.id,
      templateVersion: String(generation.template.version),
      templateSha256: generation.template.sha256,
      sha256: digest,
      generatedBy: params.userId,
    },
  });

  const assetMetadata: GeneratedOakDocAssetMetadata = {
    ...generation.metadata,
    storageKey,
    fileName,
    fileSize: generation.bytes.byteLength,
    sha256: digest,
    generatedAt,
  };
  const selectedParties = {
    ...(input.selectedDirectorId ? { directorId: input.selectedDirectorId } : {}),
    ...(input.selectedShareholderId ? { shareholderId: input.selectedShareholderId } : {}),
    ...(input.contactIds?.length ? { contactIds: input.contactIds } : {}),
  };

  let document;
  try {
    document = await prisma.$transaction(async (tx) => {
      const claim = await claimGeneratedDocumentRevision(tx, {
        id: input.generatedDocumentId,
        tenantId: params.tenantId,
        expectedRevision: input.expectedRevision,
        allowedStatuses: ['DRAFT'],
      });
      const updated = await tx.generatedDocument.update({
        where: { id: input.generatedDocumentId },
        data: {
          template: { connect: { id: generation.template.id } },
          templateVersion: generation.template.version,
          company: { connect: { id: input.companyId } },
          title: input.title,
          content: OAKDOC_GENERATED_CONTENT,
          contentJson: {
            documentEngine: 'OAKDOC',
            schemaVersion: 1,
          } as Prisma.InputJsonValue,
          status: 'DRAFT',
          useLetterhead: false,
          placeholderData: generation.values as Prisma.InputJsonValue,
          metadata: mergeGeneratedOakDocMetadata(
            existing.metadata,
            assetMetadata,
            selectedParties,
            taskMetadata(taskIntegrationContext),
          ) as Prisma.InputJsonValue,
        },
      });
      return { ...updated, revision: claim.revision };
    });
  } catch (error) {
    // Pre-commit failure: the new upload is unreferenced and safe to remove.
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }

  const previousAsset = readGeneratedOakDocAssetMetadata(existing.metadata);
  await afterCommit('delete superseded generated asset', () => deleteSupersededAsset(
    previousAsset?.storageKey,
    storageKey,
    `${params.tenantId}/generated-documents/${input.generatedDocumentId}/oakdoc/`,
  ));
  await afterCommit('audit generated materialization', () => createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    companyId: input.companyId,
    action: 'DOCUMENT_GENERATED',
    entityType: 'GeneratedDocument',
    entityId: document.id,
    entityName: document.title,
    summary: `Generated OakDoc document "${document.title}" from template "${generation.template.name}"`,
    changeSource: 'MANUAL',
    metadata: {
      documentEngine: 'OAKDOC',
      templateId: generation.template.id,
      templateVersion: generation.template.version,
      templateSha256: generation.template.sha256,
      generatedAssetSha256: digest,
      revision: document.revision,
      selectedParties,
    },
  }));

  return document;
}

export async function downloadGeneratedOakDoc(
  documentId: string,
  tenantId: string,
): Promise<{ buffer: Buffer; metadata: GeneratedOakDocAssetMetadata }> {
  const document = await prisma.generatedDocument.findFirst({
    where: { id: documentId, tenantId, deletedAt: null },
    select: { metadata: true },
  });
  if (!document) throw new NotFoundError('Document not found');

  const metadata = readGeneratedOakDocAssetMetadata(document.metadata);
  if (!metadata) throw new ValidationError('This generated document is not an OakDoc document');
  const requiredPrefix = `${tenantId}/generated-documents/${documentId}/oakdoc/`;
  if (!metadata.storageKey.startsWith(requiredPrefix)) {
    throw new ValidationError('Generated OakDoc storage scope is invalid');
  }

  const buffer = await storage.download(metadata.storageKey);
  if (sha256(buffer) !== metadata.sha256) {
    throw new ValidationError('Generated OakDoc asset integrity check failed');
  }
  return { buffer, metadata };
}


function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function selectedPartiesOf(metadata: unknown): Record<string, unknown> {
  return readRecord(readRecord(metadata).selectedParties);
}

/**
 * Work that runs after the database commit (old-asset cleanup, audit). A
 * failure here must never delete the committed asset or turn a committed save
 * into an error response, so it is logged and swallowed.
 */
async function afterCommit(label: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    log.warn(`OakDoc post-commit step failed: ${label}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function deleteSupersededAsset(
  previousKey: string | undefined,
  nextKey: string,
  requiredPrefix: string,
): Promise<void> {
  if (!previousKey || previousKey === nextKey || !previousKey.startsWith(requiredPrefix)) return;
  await storage.delete(previousKey);
}

export interface SaveGeneratedOakDocInput {
  documentId: string;
  expectedRevision: number;
  bytes: Uint8Array;
  /** Client operation identity; a retried operation returns the same receipt. */
  operationId?: string;
  snapshot?: OakDocSnapshotIdentity;
}

export async function saveGeneratedOakDocDocument(
  input: SaveGeneratedOakDocInput,
  params: TenantAwareParams,
): Promise<OakDocSaveReceipt & { updatedAt: string }> {
  inspectOakDocPackage(input.bytes, 'draft');
  const operationId = input.operationId ?? randomUUID();

  const existing = await prisma.generatedDocument.findFirst({
    where: {
      id: input.documentId,
      tenantId: params.tenantId,
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      status: true,
      companyId: true,
      metadata: true,
      updatedAt: true,
    },
  });
  if (!existing) throw new NotFoundError('Document not found');

  const currentAsset = readGeneratedOakDocAssetMetadata(existing.metadata);
  if (!currentAsset) {
    throw new ValidationError('This generated document is not an OakDoc document');
  }
  const digest = sha256(input.bytes);

  // Ambiguous-response retry: the same operation already committed these bytes.
  if (input.operationId && currentAsset.lastOperationId === input.operationId) {
    if (currentAsset.sha256 !== digest) {
      throw new ConflictError('This save operation was already used for different content', {
        reason: OAKDOC_ERROR_REASONS.STALE_REVISION,
      });
    }
    const revision = await readGeneratedDocumentRevision(prisma, existing.id, params.tenantId);
    return {
      ...input.snapshot,
      operationId,
      revision,
      assetSha256: digest,
      updatedAt: existing.updatedAt.toISOString(),
    };
  }

  if (existing.status !== 'DRAFT') {
    throw new ValidationError('Unlock the document before editing its DOCX');
  }

  const requiredPrefix = `${params.tenantId}/generated-documents/${input.documentId}/oakdoc/`;
  if (!currentAsset.storageKey.startsWith(requiredPrefix)) {
    throw new ValidationError('Generated OakDoc storage scope is invalid');
  }

  const savedAt = new Date().toISOString();
  const storageKey = StorageKeys.oakDocGeneratedAsset(
    params.tenantId,
    input.documentId,
    randomUUID(),
  );

  await storage.upload(storageKey, Buffer.from(input.bytes), {
    contentType: OAKDOC_MIME_TYPE,
    metadata: {
      tenantId: params.tenantId,
      generatedDocumentId: input.documentId,
      templateId: currentAsset.templateId,
      templateVersion: String(currentAsset.templateVersion),
      templateSha256: currentAsset.templateSha256,
      sha256: digest,
      generatedBy: params.userId,
      edited: 'true',
    },
  });

  const nextAsset: GeneratedOakDocAssetMetadata = {
    ...currentAsset,
    storageKey,
    fileSize: input.bytes.byteLength,
    sha256: digest,
    generatedAt: savedAt,
    lastOperationId: operationId,
  };

  let result: { revision: number; updatedAt: Date };
  try {
    result = await prisma.$transaction(async (tx) => {
      const claim = await claimGeneratedDocumentRevision(tx, {
        id: input.documentId,
        tenantId: params.tenantId,
        expectedRevision: input.expectedRevision,
        allowedStatuses: ['DRAFT'],
      });
      // A batch preview under review must be saved through the batch route,
      // which also checks batch revision and preview freshness.
      const batchItem = await tx.documentGenerationBatchItem.findFirst({
        where: { generatedDocumentId: input.documentId, tenantId: params.tenantId },
        select: { status: true },
      });
      if (batchItem && batchItem.status !== 'GENERATED') {
        throw new ConflictError('Save this draft from its generation batch review', {
          reason: OAKDOC_ERROR_REASONS.STALE_REVISION,
          batchReview: true,
        });
      }
      const updated = await tx.generatedDocument.update({
        where: { id: input.documentId },
        data: {
          content: OAKDOC_GENERATED_CONTENT,
          contentJson: {
            documentEngine: 'OAKDOC',
            schemaVersion: 1,
          } as Prisma.InputJsonValue,
          metadata: mergeGeneratedOakDocMetadata(
            existing.metadata,
            nextAsset,
            selectedPartiesOf(existing.metadata),
          ) as Prisma.InputJsonValue,
        },
        select: { updatedAt: true },
      });
      return {
        revision: claim.revision,
        updatedAt: updated.updatedAt,
      };
    });
  } catch (error) {
    // Pre-commit failure: the new upload is unreferenced and safe to remove.
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }

  await afterCommit('delete superseded generated asset', () => (
    deleteSupersededAsset(currentAsset.storageKey, storageKey, requiredPrefix)
  ));
  await afterCommit('audit generated save', () => createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    companyId: existing.companyId ?? undefined,
    action: 'UPDATE',
    entityType: 'GeneratedDocument',
    entityId: existing.id,
    entityName: existing.title,
    summary: `Saved edited OakDoc document "${existing.title}"`,
    changeSource: 'MANUAL',
    metadata: {
      documentEngine: 'OAKDOC',
      generatedAssetSha256: digest,
      revision: result.revision,
      operationId,
    },
  }));

  return {
    ...input.snapshot,
    operationId,
    revision: result.revision,
    assetSha256: digest,
    updatedAt: result.updatedAt.toISOString(),
  };
}

export interface OakDocFinalizationCheck {
  ready: boolean;
  unresolvedFields: string[];
  unresolvedConditions: number;
  unresolvedRepeaters: number;
}

/**
 * Validate the actual reviewed bytes (not template output or old top-level
 * arrays) before a native document is finalized or used for activation.
 */
export async function checkGeneratedOakDocFinalization(
  documentId: string,
  tenantId: string,
): Promise<OakDocFinalizationCheck> {
  ensureA4ServerDomGlobals();
  const document = await prisma.generatedDocument.findFirst({
    where: { id: documentId, tenantId, deletedAt: null },
    select: { placeholderData: true },
  });
  if (!document) throw new NotFoundError('Document not found');
  const { buffer } = await downloadGeneratedOakDoc(documentId, tenantId);
  const bytes = new Uint8Array(buffer);
  inspectOakDocPackage(bytes, 'draft');

  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(readRecord(document.placeholderData))) {
    if (typeof value === 'string') values[key] = value;
  }
  const unresolvedFields = resolveOakDocFields(bytes, values).unresolvedTags
    .filter((tag) => !OAKDOC_SIGNATURE_TAGS.has(tag))
    .filter((tag) => !isOakDocRepeaterOuterTag(tag))
    .filter((tag) => !tag.startsWith(OAKDOC_CONDITION_TAG_PREFIX))
    // The agreement renderer keeps its per-service wrappers; they hold content, not values.
    .filter((tag) => classifyOakDocTag(tag) !== 'agreement-slot');
  const unresolvedConditions = inspectOakDocConditions(bytes).count;
  const unresolvedRepeaters = inspectOakDocRepeaters(bytes).count;

  return {
    ready: unresolvedFields.length === 0 && unresolvedConditions === 0 && unresolvedRepeaters === 0,
    unresolvedFields,
    unresolvedConditions,
    unresolvedRepeaters,
  };
}

export async function assertGeneratedOakDocReadyForFinalization(
  documentId: string,
  tenantId: string,
): Promise<void> {
  const check = await checkGeneratedOakDocFinalization(documentId, tenantId);
  if (check.ready) return;
  // Batch results show only the message, so it names what is left to fill in.
  const remaining = [
    ...check.unresolvedFields,
    ...(check.unresolvedConditions > 0 ? [`${check.unresolvedConditions} condition(s)`] : []),
    ...(check.unresolvedRepeaters > 0 ? [`${check.unresolvedRepeaters} repeating section(s)`] : []),
  ];
  throw new ValidationError(
    `Resolve the remaining OakDoc fields, conditions and repeaters before finalizing: ${remaining.join(', ')}`,
    {
      reason: OAKDOC_ERROR_REASONS.UNRESOLVED_CONTROLS,
      fields: check.unresolvedFields,
      conditions: check.unresolvedConditions,
      repeaters: check.unresolvedRepeaters,
    },
  );
}

/** Metadata that belongs to the source record's lifecycle and is not cloned. */
const CLONE_RESET_METADATA_KEYS = [
  'oakDocReviewDraft',
  'oakDocPdfRendition',
  'oakDocValidation',
  'oakDocMigration',
  'taskIntegrationContext',
  'missingPlaceholders',
  'missingPartials',
  'circularPartials',
  'syntaxErrors',
  'unknownPlaceholders',
];

/**
 * Clone a native generated document into a new DRAFT that owns its own copy
 * of the verified DOCX bytes. Finalization, review, rendition, validation and
 * task authority are not inherited; source provenance is recorded instead.
 */
export async function cloneOakDocGeneratedDocument(
  input: { sourceId: string; title: string },
  params: TenantAwareParams,
) {
  const source = await prisma.generatedDocument.findFirst({
    where: { id: input.sourceId, tenantId: params.tenantId, deletedAt: null },
  });
  if (!source) throw new NotFoundError('Document not found');
  const { buffer, metadata: sourceAsset } = await downloadGeneratedOakDoc(source.id, params.tenantId);
  const sourceRevision = await readGeneratedDocumentRevision(prisma, source.id, params.tenantId);

  const id = randomUUID();
  const storageKey = StorageKeys.oakDocGeneratedAsset(params.tenantId, id, randomUUID());
  const clonedAt = new Date().toISOString();
  await storage.upload(storageKey, buffer, {
    contentType: OAKDOC_MIME_TYPE,
    metadata: {
      tenantId: params.tenantId,
      generatedDocumentId: id,
      templateId: sourceAsset.templateId,
      templateVersion: String(sourceAsset.templateVersion),
      templateSha256: sourceAsset.templateSha256,
      sha256: sourceAsset.sha256,
      generatedBy: params.userId,
      clonedFrom: source.id,
    },
  });

  const baseMetadata = { ...readRecord(source.metadata) };
  for (const key of CLONE_RESET_METADATA_KEYS) delete baseMetadata[key];
  const { lastOperationId: _lastOperationId, ...assetWithoutOperation } = sourceAsset;
  const metadata = {
    ...mergeGeneratedOakDocMetadata(
      baseMetadata,
      {
        ...assetWithoutOperation,
        storageKey,
        fileName: safeDocxName(input.title),
        generatedAt: clonedAt,
      },
      selectedPartiesOf(source.metadata),
    ),
    oakDocCloneSource: {
      documentId: source.id,
      revision: sourceRevision,
      sha256: sourceAsset.sha256,
      clonedAt,
    },
  };

  let created;
  try {
    created = await prisma.generatedDocument.create({
      data: {
        id,
        tenantId: params.tenantId,
        templateId: source.templateId,
        templateVersion: source.templateVersion,
        sharePointRelativeFolderPathSnapshot: source.sharePointRelativeFolderPathSnapshot,
        companyId: source.companyId,
        title: input.title,
        content: OAKDOC_GENERATED_CONTENT,
        contentJson: { documentEngine: 'OAKDOC', schemaVersion: 1 } as Prisma.InputJsonValue,
        status: 'DRAFT',
        useLetterhead: source.useLetterhead,
        placeholderData: source.placeholderData ?? undefined,
        metadata: metadata as Prisma.InputJsonValue,
        createdById: params.userId,
      },
    });
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }

  await afterCommit('audit generated clone', () => createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    companyId: created.companyId ?? undefined,
    action: 'DOCUMENT_CLONED',
    entityType: 'GeneratedDocument',
    entityId: created.id,
    entityName: created.title,
    summary: `Cloned OakDoc document "${source.title}" as "${created.title}"`,
    changeSource: 'MANUAL',
    metadata: {
      documentEngine: 'OAKDOC',
      sourceDocumentId: source.id,
      sourceRevision,
      sourceSha256: sourceAsset.sha256,
    },
  }));
  return created;
}
