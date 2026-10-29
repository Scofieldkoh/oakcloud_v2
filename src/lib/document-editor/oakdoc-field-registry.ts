import { TEMPLATE_FIELD_CATEGORIES } from '@/components/documents/template-editor/template-field-catalog';
import type { OakDocFieldDefinition } from '@/lib/document-editor/oakdoc-fields';
import {
  OAKDOC_AGREEMENT_FIELD_DEFINITIONS,
  OAKDOC_RESOLUTION_FIELD_DEFINITIONS,
  OAKDOC_SECTION_COUNT_FIELD_DEFINITIONS,
  OAKDOC_SELECTED_CONTACT_FIELD_DEFINITIONS,
} from '@/lib/document-editor/oakdoc-context';
import {
  OAKDOC_GENERIC_REPEATER_DEFINITIONS,
  OAKDOC_GENERIC_REPEATER_ITEM_TAGS,
  isOakDocRepeaterTag,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import { OAKDOC_SIGNATURE_TAGS } from '@/lib/document-editor/oakdoc-signatures';
import { OAKDOC_CONDITION_TAG_PREFIX } from '@/lib/document-editor/oakdoc-conditions';
import { isOakDocCustomFieldTag, isOakDocPersonFieldTag } from '@/lib/document-editor/oakdoc-custom-fields';
import type { OakDocDiagnostic } from '@/types/oakdoc';

/**
 * S1 canonical OakDoc field registry.
 *
 * The single source of truth for which content-control tags OakDoc supports.
 * Authoring panels, template persistence, generation and migration checks
 * all consume this module instead of keeping local allowlists.
 */

/**
 * The context a scalar field needs at generation time. `company` fields
 * resolve from the selected company alone; the others need an explicit
 * party or agreement/resolution input.
 */
export type OakDocFieldContext =
  | 'company'
  | 'selectedDirector'
  | 'selectedShareholder'
  | 'selectedContact'
  | 'agreement'
  | 'resolution'
  | 'custom'
  | 'system';

export interface OakDocRegisteredField extends OakDocFieldDefinition {
  context: OakDocFieldContext;
}

const CATALOG_CONTEXT: Readonly<Record<string, OakDocFieldContext>> = {
  company: 'company',
  'selected-director': 'selectedDirector',
  'selected-shareholder': 'selectedShareholder',
  system: 'system',
};

/** Catalog categories shared with the legacy field picker. */
export const OAKDOC_CATALOG_FIELD_CATEGORIES = TEMPLATE_FIELD_CATEGORIES
  .filter((category) => category.key in CATALOG_CONTEXT)
  .map((category) => ({
    ...category,
    fields: category.fields.filter(
      (field) => !field.builder && !field.key.includes('{{'),
    ),
  }))
  .filter((category) => category.fields.length > 0);

function withContext(
  fields: readonly OakDocFieldDefinition[],
  context: OakDocFieldContext,
): OakDocRegisteredField[] {
  return fields.map(({ tag, label, category }) => ({ tag, label, category, context }));
}

/** Field picker categories in the template editor: the catalog plus the contact fields. */
export const OAKDOC_EDITOR_FIELD_CATEGORIES = [
  ...OAKDOC_CATALOG_FIELD_CATEGORIES.filter((category) => category.key !== 'system'),
  {
    key: 'selected-contact',
    label: 'Contact',
    fields: OAKDOC_SELECTED_CONTACT_FIELD_DEFINITIONS.map((field) => ({
      key: field.tag,
      label: field.label,
      example: field.example,
      category: 'Contact',
    })),
  },
  {
    key: 'section-counts',
    label: 'Repeating Section Counts',
    fields: OAKDOC_SECTION_COUNT_FIELD_DEFINITIONS.map((field) => ({
      key: field.tag,
      label: field.label,
      example: field.example,
      category: field.category,
    })),
  },
  ...OAKDOC_CATALOG_FIELD_CATEGORIES.filter((category) => category.key === 'system'),
];

/** Every scalar (non-repeating) field OakDoc can resolve. */
export const OAKDOC_SCALAR_FIELDS: readonly OakDocRegisteredField[] = [
  ...OAKDOC_CATALOG_FIELD_CATEGORIES.flatMap((category) => category.fields.map((field) => ({
    tag: field.key,
    label: field.label,
    category: category.label,
    context: CATALOG_CONTEXT[category.key],
  }))),
  ...withContext(OAKDOC_SELECTED_CONTACT_FIELD_DEFINITIONS, 'selectedContact'),
  ...withContext(OAKDOC_AGREEMENT_FIELD_DEFINITIONS, 'agreement'),
  ...withContext(OAKDOC_RESOLUTION_FIELD_DEFINITIONS, 'resolution'),
  // Always resolvable: with nobody ticked, every current director or shareholder is listed.
  ...withContext(OAKDOC_SECTION_COUNT_FIELD_DEFINITIONS, 'company'),
];

/** Fields that live inside a repeater item. */
export const OAKDOC_REPEATER_ITEM_FIELDS: readonly OakDocFieldDefinition[] =
  OAKDOC_GENERIC_REPEATER_DEFINITIONS.flatMap((definition) => definition.fields);

export const OAKDOC_FIELD_BY_TAG: ReadonlyMap<string, OakDocFieldDefinition> = new Map(
  [...OAKDOC_SCALAR_FIELDS, ...OAKDOC_REPEATER_ITEM_FIELDS].map((field) => [field.tag, field]),
);

const SCALAR_TAGS: ReadonlySet<string> = new Set(OAKDOC_SCALAR_FIELDS.map((field) => field.tag));

/**
 * A field that prints a calendar date, so it can take its own date format:
 * a custom date field, or a scalar field such as Incorporation Date or
 * Resolution Date. The financial year end (day and month only) and fields
 * inside repeating sections are not.
 */
export function isOakDocDateField(field: OakDocFieldDefinition): boolean {
  if (field.valueType === 'date') return true;
  if (!SCALAR_TAGS.has(field.tag)) return false;
  return /date$/i.test(field.tag) || field.tag === 'company.firstFinancialYearEnd';
}

/**
 * A fixed tag set that also accepts every `custom.<key>` field, since
 * custom fields are defined per template rather than registered here.
 */
class OakDocFieldTagSet extends Set<string> {
  override has(tag: string): boolean {
    return super.has(tag) || isOakDocCustomFieldTag(tag);
  }
}

/** A field of a repeating section's item: a person's detail or a per-person field (`item.<key>`). */
export function isOakDocRepeaterItemFieldTag(tag: string): boolean {
  return OAKDOC_GENERIC_REPEATER_ITEM_TAGS.has(tag) || isOakDocPersonFieldTag(tag);
}

/** Every repeating-section item field, per-person fields included (a set answering `has` only). */
export const OAKDOC_REPEATER_ITEM_FIELD_TAGS: ReadonlySet<string> = new (class extends Set<string> {
  override has(tag: string): boolean {
    return isOakDocRepeaterItemFieldTag(tag);
  }
})();

/** Tags a native field control may carry (scalar, custom, repeater item or per-person). */
export const OAKDOC_FIELD_TAGS: ReadonlySet<string> = new (class extends OakDocFieldTagSet {
  override has(tag: string): boolean {
    return super.has(tag) || isOakDocPersonFieldTag(tag);
  }
})([
  ...OAKDOC_SCALAR_FIELDS.map((field) => field.tag),
  ...OAKDOC_GENERIC_REPEATER_ITEM_TAGS,
]);

/** Scalar and custom fields a condition may test. */
export const OAKDOC_CONDITION_FIELD_TAGS: ReadonlySet<string> = new OakDocFieldTagSet(
  OAKDOC_SCALAR_FIELDS.map((field) => field.tag),
);

/**
 * Fields a condition inside a repeating section may also test: each item's
 * own details (whether the contact is a company) and per-person fields,
 * resolved separately for every person listed.
 */
export const OAKDOC_ITEM_CONDITION_FIELD_TAGS: ReadonlySet<string> = new (class extends OakDocFieldTagSet {
  override has(tag: string): boolean {
    return super.has(tag) || isOakDocRepeaterItemFieldTag(tag);
  }
})(OAKDOC_SCALAR_FIELDS.map((field) => field.tag));

/** Structural Service Agreement slots replaced by the agreement renderer. */
export const OAKDOC_AGREEMENT_SLOT_TAGS = {
  serviceSections: 'agreement.serviceSections',
  feeTable: 'agreement.feeTable',
  entityAppendix: 'agreement.entityAppendix',
} as const;

/** Legacy `@`-prefixed spellings still accepted for the same slots. */
export const OAKDOC_AGREEMENT_SLOT_ALIASES: ReadonlySet<string> = new Set(
  Object.values(OAKDOC_AGREEMENT_SLOT_TAGS).flatMap((tag) => [tag, `@${tag}`]),
);

/**
 * Prototype controls a master may place inside the fee and entity slots.
 * The agreement renderer clones them per company, service and entity and
 * fills them, so the template owns the layout and typography of those
 * generated blocks. They never survive generation.
 */
export const OAKDOC_AGREEMENT_PROTOTYPE_TAGS = {
  feeCompany: 'agreement.feeTable.company',
  feeCompanyName: 'agreement.feeTable.companyName',
  feeSowRow: 'agreement.feeTable.sowRow',
  feeSowName: 'agreement.feeTable.sowName',
  feeSowAmount: 'agreement.feeTable.sowAmount',
  feeChargeRow: 'agreement.feeTable.chargeRow',
  feeChargeDescription: 'agreement.feeTable.chargeDescription',
  feeChargeAmount: 'agreement.feeTable.chargeAmount',
  entityName: 'agreement.entityAppendix.name',
  entityUen: 'agreement.entityAppendix.uen',
} as const;

const OAKDOC_AGREEMENT_PROTOTYPE_PREFIXES = [
  `${OAKDOC_AGREEMENT_SLOT_TAGS.feeTable}.`,
  `${OAKDOC_AGREEMENT_SLOT_TAGS.entityAppendix}.`,
] as const;

export function isOakDocAgreementPrototypeTag(tag: string): boolean {
  return OAKDOC_AGREEMENT_PROTOTYPE_PREFIXES.some((prefix) => tag.startsWith(prefix));
}

/** Per-service controls the agreement renderer creates and owns. */
export const OAKDOC_AGREEMENT_SERVICE_ITEM_TAG_PREFIX = 'agreement.service.item:';

/** Block control a RESOLUTION template replaces with its numbered resolutions. */
export const OAKDOC_RESOLUTION_ITEMS_TAG = 'resolution.items';

/** Block control replaced by a native reusable partial (C06). */
export const OAKDOC_PARTIAL_TAG_PREFIX = 'oakdoc.partial:';

export type OakDocTagKind =
  | 'field'
  | 'partial'
  | 'agreement-slot'
  | 'resolution-slot'
  | 'repeater-item'
  | 'repeater'
  | 'condition'
  | 'signature'
  | 'unknown';

export function classifyOakDocTag(tag: string): OakDocTagKind {
  if (isOakDocRepeaterTag(tag)) return 'repeater';
  if (isOakDocRepeaterItemFieldTag(tag)) return 'repeater-item';
  if (OAKDOC_SIGNATURE_TAGS.has(tag)) return 'signature';
  if (tag.startsWith(OAKDOC_CONDITION_TAG_PREFIX)) return 'condition';
  if (tag.startsWith(OAKDOC_PARTIAL_TAG_PREFIX)) return 'partial';
  if (tag === OAKDOC_RESOLUTION_ITEMS_TAG) return 'resolution-slot';
  if (
    OAKDOC_AGREEMENT_SLOT_ALIASES.has(tag)
    || tag.startsWith(OAKDOC_AGREEMENT_SERVICE_ITEM_TAG_PREFIX)
    || isOakDocAgreementPrototypeTag(tag)
  ) {
    return 'agreement-slot';
  }
  if (OAKDOC_CONDITION_FIELD_TAGS.has(tag)) return 'field';
  return 'unknown';
}

export function oakDocFieldContext(tag: string): OakDocFieldContext | null {
  if (isOakDocCustomFieldTag(tag)) return 'custom';
  return OAKDOC_SCALAR_FIELDS.find((field) => field.tag === tag)?.context ?? null;
}

/**
 * Report tags in a document that OakDoc cannot resolve. Word's own content
 * controls without a tag are ignored; any other unknown tag would survive
 * generation unresolved, so it is reported as a blocking diagnostic.
 */
export function diagnoseOakDocTags(
  tags: readonly string[],
  stage: OakDocDiagnostic['stage'],
): OakDocDiagnostic[] {
  return Array.from(new Set(tags))
    .filter((tag) => tag && classifyOakDocTag(tag) === 'unknown')
    .sort()
    .map((tag) => ({
      code: 'OAKDOC_UNSUPPORTED_FIELD',
      severity: 'error' as const,
      stage,
      message: `The field "${tag}" is not a supported OakDoc field.`,
      controlTag: tag,
    }));
}
