'use client';

import { useMemo } from 'react';
import { Lock } from 'lucide-react';
import type { Company, DocumentContact, DocumentPartyOption } from '@/types/document-generation';
import type { CustomPlaceholderDefinition } from '@/types/placeholders';
import type {
  BatchItemConfiguration,
  MasterFieldCatalogue,
} from '@/types/document-generation-batch';
import type { EditableBatchItem } from './batch-workspace-state';
import { StandardDocumentConfig } from './standard-document-config';
import { ServiceAgreementConfig } from './service-agreement-config';
import { ResolutionSectionsConfig } from './resolution-sections-config';
import { MissingCompanyFields } from './missing-company-fields';
import { partitionTemplateFields, type ItemCompleteness } from './batch-completeness';
import type { ApplyScope } from './apply-to-others-menu';
import type { OakDocRepeaterSectionSummary } from '@/lib/document-editor/oakdoc-custom-fields';
import type { DocumentPersonChoice } from '@/lib/document-generation-per-person';

export interface BatchItemConfiguratorProps {
  item: EditableBatchItem;
  primaryCompany: Company | null;
  companies: Company[];
  contacts: DocumentContact[];
  contactsById?: Map<string, DocumentContact>;
  companyContacts: DocumentContact[];
  directors: DocumentPartyOption[];
  shareholders: DocumentPartyOption[];
  officers?: DocumentPartyOption[];
  partyLoading?: boolean;
  partyError?: string | null;
  onPartyRetry?: () => void;
  onContactSearch?: (query: string) => void;
  contactsLoading?: boolean;
  companySearchQuery?: string;
  onCompanySearch?: (query: string) => void;
  companySearchLoading?: boolean;
  onPrimaryCompanyChange?: (companyId: string | null, company: Company | null) => void;
  masterFields: MasterFieldCatalogue;
  effectiveMasterValues: Record<string, string>;
  templateFields?: CustomPlaceholderDefinition[];
  templateContent?: string;
  /** Tags in a Word (OakDoc) template, which decide its party pickers. */
  templateFieldTags?: readonly string[];
  /** Contacts the template's contacts repeater may list; null means any contact. */
  contactShortlist?: ReadonlyArray<{ id: string; name: string }> | null;
  /** Names of the template's repeating sections and its named contacts lists. */
  repeaterSections?: OakDocRepeaterSectionSummary | null;
  /** The template's section that makes a separate document for each person, if any. */
  perPersonTag?: string | null;
  /** Everyone with a document of this template in the batch, in order. */
  documentPeople?: DocumentPersonChoice[];
  onDocumentPeopleChange?: (people: DocumentPersonChoice[]) => void;
  onPatch: (patch: Partial<BatchItemConfiguration>) => void;
  disabled?: boolean;
  completeness?: ItemCompleteness;
  otherItemCount?: number;
  otherIncompleteCount?: number;
  onApplyToOthers?: (scope: ApplyScope, patch: Partial<BatchItemConfiguration>) => void;
}

export function BatchItemConfigurator(props: BatchItemConfiguratorProps) {
  const {
    item,
    masterFields,
    effectiveMasterValues,
    onPatch,
    disabled,
    templateFields = [],
    companyContacts,
  } = props;

  const itemOnlyFields = useMemo(
    () => partitionTemplateFields(templateFields, masterFields).itemOnly,
    [templateFields, masterFields],
  );

  if (item.status === 'GENERATED') {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-border-primary bg-background-secondary p-4">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-text-primary">Generated and locked</p>
          <p className="mt-0.5 text-sm text-text-secondary">
            This document has been generated, so its configuration is read-only
            inside the batch. Open the generated document to make further edits.
          </p>
        </div>
      </div>
    );
  }

  const missingCompanyFields = (
    <MissingCompanyFields
      company={props.primaryCompany}
      templateFieldTags={props.templateFieldTags}
      documentValues={item.configuration.companyFieldValues}
      onPatch={onPatch}
      disabled={disabled}
    />
  );

  return item.templateKind === 'SERVICE_AGREEMENT'
    ? (
      <div className="space-y-3">
        {missingCompanyFields}
        <ServiceAgreementConfig
          item={item}
          primaryCompany={props.primaryCompany}
          companies={props.companies}
          contacts={companyContacts}
          companySearchQuery={props.companySearchQuery}
          onCompanySearch={props.onCompanySearch}
          companySearchLoading={props.companySearchLoading}
          onPrimaryCompanyChange={props.onPrimaryCompanyChange}
          masterFields={masterFields}
          effectiveMasterValues={effectiveMasterValues}
          repeaterSections={props.repeaterSections}
          onPatch={onPatch}
          disabled={disabled}
        />
      </div>
    )
    : (
      <div className="space-y-3">
        {missingCompanyFields}
        <StandardDocumentConfig
          item={item}
          templateFields={itemOnlyFields}
          templateContent={props.templateContent}
          templateFieldTags={props.templateFieldTags}
          contactShortlist={props.contactShortlist}
          repeaterSections={props.repeaterSections}
          perPersonTag={props.perPersonTag}
          documentPeople={props.documentPeople}
          onDocumentPeopleChange={props.onDocumentPeopleChange}
          masterFields={masterFields}
          effectiveMasterValues={effectiveMasterValues}
          directors={props.directors}
          shareholders={props.shareholders}
          officers={props.officers}
          contacts={props.contacts}
          contactsById={props.contactsById}
          companyContacts={companyContacts}
          partyLoading={props.partyLoading}
          partyError={props.partyError}
          onPartyRetry={props.onPartyRetry}
          onContactSearch={props.onContactSearch}
          contactsLoading={props.contactsLoading}
          onPatch={onPatch}
          disabled={disabled}
          completeness={props.completeness}
          otherItemCount={props.otherItemCount}
          otherIncompleteCount={props.otherIncompleteCount}
          onApplyToOthers={props.onApplyToOthers}
        />
        {item.templateKind === 'RESOLUTION' ? (
          <ResolutionSectionsConfig
            templateId={item.templateId}
            templateName={item.templateName}
            value={item.configuration.resolution}
            onChange={(resolution) => onPatch({ resolution })}
            disabled={disabled}
          />
        ) : null}
      </div>
    );
}
