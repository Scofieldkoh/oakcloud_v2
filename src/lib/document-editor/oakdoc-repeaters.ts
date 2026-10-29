import type {
  OakDocAgreementEntity,
  OakDocCompanyDetail,
  OakDocContact,
} from '@/lib/document-editor/oakdoc-context';
import {
  createOakDocGenericRepeater,
  inspectOakDocGenericRepeaters,
  nameOakDocRepeaterItems,
  removeOakDocGenericRepeater,
  resolveOakDocGenericRepeaters,
  setOakDocGenericRepeaterLettering,
} from '@/lib/document-editor/oakdoc-generic-repeaters';
import {
  OAKDOC_GENERIC_REPEATER_BY_TAG,
  OAKDOC_GENERIC_REPEATER_DEFINITIONS,
  OAKDOC_GENERIC_REPEATER_ITEM_TAGS,
  OAKDOC_GENERIC_REPEATER_TAGS,
  isOakDocRepeaterTag,
  type OakDocGenericRepeaterDefinition,
  type OakDocGenericRepeaterKind,
  type OakDocRepeaterGenerationData,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import type { OakDocConditionDefinition } from '@/lib/document-editor/oakdoc-conditions';

export type OakDocRepeaterKind = OakDocGenericRepeaterKind;
export type OakDocRepeaterDefinition = OakDocGenericRepeaterDefinition;

export interface OakDocRepeaterSummary {
  count: number;
  tags: string[];
  /** Tags of sections lettered (a), (b) when more than one is listed. */
  letteredTags: string[];
}

export const OAKDOC_REPEATER_DEFINITIONS = OAKDOC_GENERIC_REPEATER_DEFINITIONS;
export const OAKDOC_REPEATER_BY_TAG = OAKDOC_GENERIC_REPEATER_BY_TAG;
export const OAKDOC_REPEATER_OUTER_TAGS = OAKDOC_GENERIC_REPEATER_TAGS;
export const OAKDOC_REPEATER_ITEM_TAGS = OAKDOC_GENERIC_REPEATER_ITEM_TAGS;
/** Any repeater tag, including an officers repeater limited to roles. */
export const isOakDocRepeaterOuterTag = isOakDocRepeaterTag;

export const createOakDocRepeater = createOakDocGenericRepeater;
export const removeOakDocRepeater = removeOakDocGenericRepeater;
export const inspectOakDocRepeaters = inspectOakDocGenericRepeaters;
export const setOakDocRepeaterLettering = setOakDocGenericRepeaterLettering;
export { nameOakDocRepeaterItems };

export function resolveOakDocRepeaters(input: {
  docxBytes: Uint8Array;
  company: OakDocCompanyDetail;
  contacts?: readonly OakDocContact[];
  /** Contacts of each named contacts list, by slug. */
  contactLists?: Readonly<Record<string, readonly OakDocContact[]>>;
  signers?: readonly OakDocContact[];
  authorisedRepresentatives?: readonly OakDocContact[];
  agreementEntities?: readonly OakDocAgreementEntity[];
  selectedDirectorIds?: readonly string[];
  selectedShareholderIds?: readonly string[];
  selectedOfficerIds?: readonly string[];
  dividendPerShare?: number | null;
  personValues?: OakDocRepeaterGenerationData['personValues'];
  conditions?: ReadonlyMap<string, OakDocConditionDefinition>;
}): {
  bytes: Uint8Array;
  repeatersResolved: number;
  itemsCreated: number;
  fieldsResolved: number;
} {
  return resolveOakDocGenericRepeaters({
    docxBytes: input.docxBytes,
    data: {
      company: input.company,
      contacts: input.contacts,
      contactLists: input.contactLists,
      signers: input.signers,
      authorisedRepresentatives: input.authorisedRepresentatives,
      agreementEntities: input.agreementEntities,
      selectedDirectorIds: input.selectedDirectorIds,
      selectedShareholderIds: input.selectedShareholderIds,
      selectedOfficerIds: input.selectedOfficerIds,
      dividendPerShare: input.dividendPerShare,
      personValues: input.personValues,
    },
    conditions: input.conditions,
  });
}
