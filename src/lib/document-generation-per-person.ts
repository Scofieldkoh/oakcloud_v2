/**
 * One document per person.
 *
 * A Word template can make one of its repeating sections (directors,
 * shareholders, officers or a contacts list) split the document: each person
 * picked for that section gets a separate document in the batch, and the
 * section prints only that person (Form 45 for each director, Form 45B for
 * each corporate secretary). Each document is an ordinary batch item whose
 * usual selection for the section holds just its person, so preview and
 * generation need nothing else; `documentPerson` records whom it is for.
 */

import {
  oakDocRepeaterDefinitionForTag,
  parseOakDocContactListSlug,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import type { BatchItemConfiguration } from '@/types/document-generation-batch';

export interface DocumentPersonChoice {
  id: string;
  name: string;
}

/** The section's selection holding only this person; none clears it. */
export function perPersonSelectionPatch(
  tag: string,
  personId: string | null,
  configuration: Pick<BatchItemConfiguration, 'selectedContactListIds'>,
): Partial<BatchItemConfiguration> {
  const ids = personId ? [personId] : [];
  switch (oakDocRepeaterDefinitionForTag(tag)?.kind) {
    case 'directors':
      return { selectedDirectorIds: ids };
    case 'shareholders':
      return { selectedShareholderIds: ids };
    case 'officers':
      return { selectedOfficerIds: ids };
    case 'contacts': {
      const slug = parseOakDocContactListSlug(tag);
      return slug
        ? { selectedContactListIds: { ...(configuration.selectedContactListIds ?? {}), [slug]: ids } }
        : { contactIds: ids };
    }
    default:
      return {};
  }
}

/** The ids the section's selection holds now; undefined until it is first chosen. */
export function perPersonSelectedIds(
  tag: string,
  configuration: BatchItemConfiguration,
): string[] | undefined {
  switch (oakDocRepeaterDefinitionForTag(tag)?.kind) {
    case 'directors':
      return configuration.selectedDirectorIds;
    case 'shareholders':
      return configuration.selectedShareholderIds;
    case 'officers':
      return configuration.selectedOfficerIds;
    case 'contacts': {
      const slug = parseOakDocContactListSlug(tag);
      return slug ? configuration.selectedContactListIds?.[slug] : configuration.contactIds;
    }
    default:
      return undefined;
  }
}

/** People of a company record; a change of company drops them, unlike contacts. */
export function isCompanyPerPersonTag(tag: string): boolean {
  const kind = oakDocRepeaterDefinitionForTag(tag)?.kind;
  return kind === 'directors' || kind === 'shareholders' || kind === 'officers';
}

/** "F45 - Tan Wei Jie": the template, then whom the document is for. */
export function perPersonDocumentTitle(templateName: string, personName: string): string {
  return `${templateName.trim()} - ${personName.trim()}`;
}
