/**
 * Document generation batch contracts.
 *
 * These DTOs cross the API boundary between the server services and the
 * reducer-backed batch workspace. Server-owned fields (tenant ID, user ID,
 * fingerprints, claim IDs, diagnostics) are never accepted from clients.
 */

import type {
  ServiceAgreementDraftDto,
  ServiceAgreementItemInput,
} from '@/services/service-agreement/types';
import type { PlaceholderValueType } from '@/types/placeholders';
import type { DocumentEngine } from '@/lib/document-editor/document-engine';
import type { ResolutionComposition } from '@/lib/resolution-composition';

export type BatchItemStatus =
  | 'NOT_STARTED'
  | 'NEEDS_INPUT'
  | 'PREVIEWED'
  | 'READY'
  | 'GENERATING'
  | 'GENERATED'
  | 'FAILED'
  | 'BLOCKED';

export type BatchStatus = 'DRAFT' | 'PARTIAL' | 'COMPLETED';

/**
 * W3 keeps exact textual representations for text/date/number/currency values
 * while allowing a real boolean to cross the API boundary. This deliberately
 * does not broaden master/shared values, whose existing catalogue remains a
 * string contract. In particular `false`, `0` (the string "0" for exact
 * numeric inputs), empty and missing remain distinguishable.
 */
export type BatchItemFieldValue = string | boolean;

/**
 * Resumable editor value for one Service Agreement item. The server persists
 * this verbatim inside item configuration; when complete it is additionally
 * synchronized into the relational Service Agreement draft.
 */
export interface ServiceAgreementWorkspaceState {
  authorizedContactIds: string[];
  authorizedRepresentativeRoles?: Record<string, string>;
  signerContactIds: string[];
  entityIds: string[];
  agreementDate: string;
  effectiveDate: string | null;
  termMonths: number;
  items: ServiceAgreementItemInput[];
}

/**
 * Resolutions chosen for one RESOLUTION item: Word partials or custom text,
 * numbered in this order when the document is generated.
 */
export type ResolutionWorkspaceState = ResolutionComposition;

export interface BatchDocumentPerson {
  /** The repeater tag that splits documents: `repeat.directors`, `repeat.contacts.<slug>`... */
  tag: string;
  /** Officer, shareholder or contact id, as the section's selection stores it. */
  id: string;
  name: string;
}

export interface BatchItemConfiguration {
  version: 1;
  title: string;
  contactIds: string[];
  selectedDirectorId: string | null;
  /** Explicit director subset for `{{#each directors}}` and the Word directors repeater; absent means all. */
  selectedDirectorIds?: string[];
  selectedShareholderId: string | null;
  /** Explicit shareholder subset for the Word shareholders repeater; absent means all. */
  selectedShareholderIds?: string[];
  /** Officers of any role for the Word officers repeater, in order; absent means none. */
  selectedOfficerIds?: string[];
  /**
   * Contacts ticked for each named contacts list (`repeat.contacts.<slug>`),
   * by slug, in order; the unnamed `repeat.contacts` list uses contactIds.
   */
  selectedContactListIds?: Record<string, string[]>;
  /**
   * Values of the per-person fields (`item.<key>`) of the template's
   * sections: by repeater tag, then person id, then field key.
   */
  personValues?: Record<string, Record<string, Record<string, string>>>;
  selectedContactId: string | null;
  itemValues: Record<string, BatchItemFieldValue>;
  masterOverrides: Record<string, string>;
  useLetterhead: boolean;
  serviceAgreement: ServiceAgreementWorkspaceState | null;
  /** RESOLUTION templates only; absent on items saved before resolutions existed. */
  resolution?: ResolutionWorkspaceState | null;
  /**
   * Templates with a section that makes a separate document for each person:
   * that section's tag and the person this document is for. The section's
   * usual selection (selectedDirectorIds, contactIds...) holds only them.
   */
  documentPerson?: BatchDocumentPerson | null;
  /**
   * Company values missing on record, filled for this document only, by
   * company field home id (see `oakdoc-company-field-homes`).
   */
  companyFieldValues?: Record<string, string>;
}

export interface MasterFieldDefinition {
  id: string;
  key: string;
  type: PlaceholderValueType;
  label: string;
  templateIds: string[];
  requiredTemplateIds: string[];
  defaultsByTemplateId: Record<string, string>;
  /** Dropdown choices, when a template defines the field as a dropdown. */
  options?: string[];
  /** Display labels of choices whose value is an id, e.g. a Contact field's contacts. */
  optionLabels?: Record<string, string>;
}

export interface MasterFieldCatalogue {
  fields: MasterFieldDefinition[];
  conflicts: Array<{ key: string; types: PlaceholderValueType[] }>;
}

export interface BatchItemFieldError {
  field: string;
  message: string;
}

export interface BatchItemDiagnostics {
  itemId: string;
  status: BatchItemStatus;
  errors: string[];
  fieldErrors: BatchItemFieldError[];
}

export interface BatchItemFailure {
  itemId: string;
  code: string;
  message: string;
  occurredAt: string;
}

export interface DocumentGenerationBatchItemDto {
  id: string;
  templateId: string;
  templateName: string;
  templateKind: 'STANDARD' | 'SERVICE_AGREEMENT' | 'RESOLUTION';
  templateVersion: number;
  templateEngine: DocumentEngine;
  displayOrder: number;
  status: BatchItemStatus;
  configuration: BatchItemConfiguration;
  previewContent: string | null;
  editedContent: string | null;
  editedContentJson: unknown | null;
  previewFingerprint: string | null;
  reviewedFingerprint: string | null;
  validationDiagnostics: BatchItemDiagnostics | null;
  lastError: BatchItemFailure | null;
  generatedDocumentId: string;
  generatedDocumentTitle: string | null;
  serviceAgreement: ServiceAgreementDraftDto | null;
}

export interface DocumentGenerationBatchDto {
  id: string;
  primaryCompanyId: string | null;
  company: { id: string; name: string; uen: string } | null;
  activeItemId: string | null;
  currentStage: number;
  revision: number;
  status: BatchStatus;
  masterFieldValues: Record<string, string>;
  masterFields: MasterFieldCatalogue;
  taskContext: unknown | null;
  createdAt: string;
  updatedAt: string;
  items: DocumentGenerationBatchItemDto[];
}

export interface DocumentGenerationBatchListItem {
  id: string;
  primaryCompanyId: string | null;
  companyName: string | null;
  itemCount: number;
  counts: Record<BatchItemStatus, number>;
  status: BatchStatus;
  currentStage: number;
  createdBy: { firstName: string; lastName: string };
  updatedAt: string;
}

export interface BatchGenerationResult {
  batchId: string;
  revision: number;
  batchStatus: BatchStatus;
  successes: Array<{ itemId: string; documentId: string; title: string }>;
  failures: BatchItemFailure[];
}

export interface CreateDocumentGenerationBatchInput {
  items: Array<{ templateId: string }>;
  legacyDraftId?: string;
  taskContext?: unknown;
}

export interface UpdateDocumentGenerationBatchInput {
  expectedRevision: number;
  currentStage?: number;
  primaryCompanyId?: string | null;
  activeItemId?: string | null;
  masterFieldValues?: Record<string, string>;
  items: Array<{
    id?: string;
    templateId: string;
    displayOrder?: number;
    configuration?: BatchItemConfiguration;
    editedContent?: string | null;
    editedContentJson?: unknown | null;
  }>;
  taskContext?: unknown;
}

export interface BatchItemMutationInput {
  expectedRevision: number;
  replaceEditedContent?: boolean;
}

export interface BatchExecutionInput {
  expectedRevision: number;
}
