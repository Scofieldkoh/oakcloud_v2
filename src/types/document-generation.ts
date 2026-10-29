/**
 * Shared document-generation option types.
 *
 * These types were previously owned by the monolithic generation wizard and
 * are now the single source of truth for templates, companies, contacts,
 * partials, and party options used by the batch workspace and Service
 * Agreement editors.
 */

import type { DocumentParty } from '@/lib/document-party';
import type { ResolutionComposition } from '@/lib/resolution-composition';
import type { DocumentEngine } from '@/lib/document-editor/document-engine';
import type { OakDocRepeaterSectionSummary } from '@/lib/document-editor/oakdoc-custom-fields';
import type { CustomPlaceholderDefinition } from '@/types/placeholders';
import type {
  ServiceAgreementItemInput,
} from '@/services/service-agreement/types';

export interface Company {
  id: string;
  name: string;
  uen: string;
  status: string;
  registeredAddress?: string | null;
  incorporationDate?: string | null;
}

export interface DocumentContact {
  id: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  designation?: string | null;
  /** Authority-ranked appointments currently held by this contact. */
  appointments?: string[];
}

export interface TemplatePartial {
  id: string;
  name: string;
  displayName?: string | null;
  description?: string | null;
  content: string;
  placeholders?: unknown;
}

export type DocumentTemplateCompositionType = 'STANDARD' | 'SERVICE_AGREEMENT' | 'RESOLUTION';

export interface DocumentTemplateSummary {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  compositionType: DocumentTemplateCompositionType;
  version: number;
  isActive: boolean;
  engine: DocumentEngine;
  content: string;
  contentJson?: unknown;
  placeholders: CustomPlaceholderDefinition[];
  /**
   * Word templates: the contacts its contacts repeater may list (its own and
   * its partials' shortlists together); null or absent means any contact.
   */
  contactShortlist?: Array<{ id: string; name: string }> | null;
  /**
   * Word templates: names given to its repeating sections and the shortlists
   * of its contacts lists, by repeater tag (its own and its partials').
   */
  repeaterSections?: OakDocRepeaterSectionSummary | null;
  /** RESOLUTION templates: resolutions pre-filled on Configure. */
  resolutionPreset?: ResolutionComposition | null;
  createdAt: string;
  updatedAt: string;
}

export type DocumentPartyOption = DocumentParty;

export type { ServiceAgreementItemInput };
