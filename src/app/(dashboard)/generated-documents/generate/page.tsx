'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DocumentGenerationBatchWorkspace,
  type EditableDocumentGenerationBatch,
  type EditableBatchItem,
} from '@/components/documents/generation-batch';
import {
  mapCompanyOption,
  mapContactOption,
  mapGenerationTemplateSummaries,
} from '@/lib/document-generation-option-mappers';
import { readTaskLaunchContext } from '@/lib/task-launch-context';
import { instantiateResolutionPreset } from '@/lib/resolution-composition';
import { createServiceAgreementClientKey } from '@/components/documents/service-agreement/client-key';
import type {
  DocumentGenerationBatchDto,
} from '@/types/document-generation-batch';
import type {
  Company,
  DocumentContact,
  DocumentTemplateSummary,
} from '@/types/document-generation';
import type { GenerationSessionEnvelope } from '@/lib/document-generation-session';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** First page of options; the workspace searches the server from there. */
const OPTION_SEED_LIMIT = 25;

const OakDocEditor = dynamic(
  () => import('@/components/documents/oakdoc-editor').then((module) => module.OakDocEditor),
  { ssr: false, loading: () => <WorkspaceSkeleton /> },
);

function dtoToEditableBatch(dto: DocumentGenerationBatchDto): EditableDocumentGenerationBatch {
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

function sessionToEditableItem(
  envelope: GenerationSessionEnvelope,
  template: DocumentTemplateSummary,
): EditableBatchItem {
  const state = envelope.state;
  return {
    key: template.id,
    templateId: template.id,
    templateName: template.name,
    templateKind: template.compositionType,
    templateVersion: template.version,
    templateEngine: template.engine,
    status: 'NOT_STARTED',
    configuration: {
      version: 1,
      title: state.title || `Untitled - ${template.name}`,
      contactIds: state.contactIds,
      selectedDirectorId: state.selectedDirectorId,
      selectedShareholderId: state.selectedShareholderId,
      selectedContactId: state.selectedContactId,
      itemValues: state.customData ?? {},
      masterOverrides: {},
      useLetterhead: state.useLetterhead,
      serviceAgreement: envelope.agreement
        ? {
            authorizedContactIds: envelope.agreement.authorizedContactIds,
            signerContactIds: envelope.agreement.signerContactIds,
            entityIds: envelope.agreement.entities.map((entity) => entity.companyId),
            agreementDate: envelope.agreement.agreementDate,
            effectiveDate: envelope.agreement.effectiveDate,
            termMonths: envelope.agreement.termMonths,
            items: envelope.agreement.items.map((item) => ({
              id: item.id,
              clientKey: item.id,
              variantId: item.serviceVariantId,
              entityIds: item.entityIds
                .map((entityId) =>
                  envelope.agreement?.entities.find((entity) => entity.id === entityId)?.companyId)
                .filter((id): id is string => Boolean(id)),
              startDate: item.startDate,
              endDate: item.endDate,
              fieldValues: item.fieldValues,
              displayOrder: item.displayOrder,
              feeLines: item.feeLines.map((fee) => ({
                id: fee.id,
                clientKey: fee.id,
                companyId: fee.companyId,
                description: fee.description,
                amount: fee.amount,
                currency: fee.currency,
                billingFrequency: fee.billingFrequency,
                customFrequencyLabel: fee.customFrequencyLabel ?? null,
                billingStartDate: fee.billingStartDate,
                displayOrder: fee.displayOrder,
              })),
            })),
          }
        : null,
    },
    previewContent: state.previewContent,
    editedContent: state.editedContent,
    editedContentJson: state.editedContentJson,
    previewFingerprint: null,
    reviewedFingerprint: null,
    validationDiagnostics: null,
    lastError: null,
  };
}

/**
 * Mirrors the workspace chrome so the first paint does not shift layout once
 * templates resolve.
 */
function WorkspaceSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-[2200px] animate-pulse p-3 sm:p-5"
      role="status"
      aria-label="Loading document generation workspace"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border-secondary pb-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-background-tertiary" />
          <div className="space-y-2">
            <div className="h-4 w-48 rounded bg-background-tertiary" />
            <div className="h-3 w-32 rounded bg-background-tertiary" />
          </div>
        </div>
        <div className="h-9 w-28 rounded-lg bg-background-tertiary" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-14 rounded-lg bg-background-tertiary" />
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-2">
          <div className="h-11 rounded-lg bg-background-tertiary" />
          <div className="grid gap-2 sm:grid-cols-2">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div key={index} className="h-20 rounded-lg bg-background-tertiary" />
            ))}
          </div>
        </div>
        <div className="h-64 rounded-lg bg-background-tertiary" />
      </div>
    </div>
  );
}

function GenerateDocumentContent() {
  const searchParams = useSearchParams();
  const requestedBatchId = searchParams.get('batch');
  const requestedDraftId = searchParams.get('draft');
  const requestedTemplateIdsKey = searchParams.getAll('templateId').join(',');
  const requestedCompanyId = searchParams.get('companyId');
  const taskContext = useMemo(
    () => readTaskLaunchContext(searchParams),
    [searchParams],
  );
  const backHref = taskContext?.returnTo ?? '/generated-documents';
  const [templates, setTemplates] = useState<DocumentTemplateSummary[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<DocumentContact[]>([]);
  const [initialBatch, setInitialBatch] = useState<EditableDocumentGenerationBatch | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJson = useCallback(async (url: string): Promise<Record<string, unknown>> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Request failed: ${url}`);
    return response.json();
  }, []);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const requestedTemplateIds = requestedTemplateIdsKey ? requestedTemplateIdsKey.split(',') : [];
        const requestedTemplateId = requestedTemplateIds[0] ?? null;
        for (const id of [requestedBatchId, requestedDraftId, ...requestedTemplateIds, requestedCompanyId]) {
          if (id && !UUID_PATTERN.test(id)) {
            throw new Error('The linked identifier is invalid.');
          }
        }
        if (requestedTemplateIds.length > 20 || new Set(requestedTemplateIds).size !== requestedTemplateIds.length) {
          throw new Error('The linked document template selection is invalid.');
        }
        const templatesParams = new URLSearchParams({ isActive: 'true', limit: '100' });
        const optionParams = new URLSearchParams({ limit: String(OPTION_SEED_LIMIT) });
        const [templatesData, companiesData, contactsData] = await Promise.all([
          fetchJson(`/api/document-templates?${templatesParams}`),
          fetchJson(`/api/companies/options?${optionParams}`),
          fetchJson(`/api/contacts/options?${optionParams}`),
        ]);
        const rawTemplates = Array.isArray(templatesData.templates)
          ? templatesData.templates as Array<Record<string, unknown>>
          : [];
        const rawCompanies = Array.isArray(companiesData.options)
          ? companiesData.options as Array<Record<string, unknown>>
          : [];
        const rawContacts = Array.isArray(contactsData.options)
          ? contactsData.options as Array<Record<string, unknown>>
          : [];
        const templateList = mapGenerationTemplateSummaries(rawTemplates);
        setTemplates(templateList);
        setCompanies(rawCompanies.map(mapCompanyOption));
        setContacts(rawContacts.map(mapContactOption));

        if (requestedBatchId) {
          const dto = await fetchJson(
            `/api/document-generation-batches/${encodeURIComponent(requestedBatchId)}`,
          );
          setInitialBatch(dtoToEditableBatch(dto as unknown as DocumentGenerationBatchDto));
        } else if (requestedDraftId) {
          const envelope = await fetchJson(
            `/api/generated-documents/generation-sessions/${encodeURIComponent(requestedDraftId)}`,
          ) as unknown as GenerationSessionEnvelope;
          const template = templateList.find(
            (candidate) => candidate.id === envelope.state.templateId,
          );
          if (!template) throw new Error('The saved draft template is unavailable.');
          setInitialBatch({
            legacyDraftId: requestedDraftId,
            primaryCompanyId: envelope.state.companyId,
            company: null,
            activeItemId: template.id,
            currentStage: Math.min(envelope.state.currentStep, 3),
            status: 'DRAFT',
            masterFieldValues: {},
            masterFields: { fields: [], conflicts: [] },
            taskContext,
            items: [sessionToEditableItem(envelope, template)],
          });
        } else if (requestedTemplateId) {
          // Old links can name A4 templates; use their approved Word versions.
          const linksA4 = requestedTemplateIds.some(
            (templateId) => templateList.find((candidate) => candidate.id === templateId)?.engine === 'A4',
          );
          const runTemplateIds = linksA4
            ? await fetchJson(`/api/document-templates/new-run?${new URLSearchParams(
                requestedTemplateIds.map((templateId) => ['templateId', templateId]),
              )}`).then((data) => (
                Array.isArray(data.templateIds) ? data.templateIds.map(String) : requestedTemplateIds
              ))
            : requestedTemplateIds;
          const selectedTemplates = runTemplateIds.map(
            (templateId) => templateList.find((candidate) => candidate.id === templateId),
          );
          if (selectedTemplates.some((template) => !template)) {
            throw new Error('One or more linked templates are unavailable.');
          }
          if (selectedTemplates.some((template) => template?.engine === 'A4')) {
            throw new Error(
              'This link uses a template made with the retired A4 editor, and it has no approved Word version yet. Choose a Word template instead.',
            );
          }
          const templatesForBatch = selectedTemplates.filter(
            (template): template is DocumentTemplateSummary => Boolean(template),
          );
          setInitialBatch({
            primaryCompanyId: requestedCompanyId,
            company: null,
            activeItemId: templatesForBatch[0].id,
            currentStage: 0,
            status: 'DRAFT',
            masterFieldValues: {},
            masterFields: { fields: [], conflicts: [] },
            taskContext,
            items: templatesForBatch.map((template) => ({
              key: template.id,
              templateId: template.id,
              templateName: template.name,
              templateKind: template.compositionType,
              templateVersion: template.version,
              templateEngine: template.engine,
              status: 'NOT_STARTED',
              configuration: {
                version: 1,
                title: `Untitled - ${template.name}`,
                contactIds: [],
                selectedDirectorId: null,
                selectedShareholderId: null,
                selectedContactId: null,
                itemValues: {},
                masterOverrides: {},
                useLetterhead: false,
                serviceAgreement: null,
                ...(template.compositionType === 'RESOLUTION' && template.resolutionPreset
                  ? { resolution: instantiateResolutionPreset(template.resolutionPreset, createServiceAgreementClientKey) }
                  : {}),
              },
              previewContent: null,
              editedContent: null,
              editedContentJson: null,
              previewFingerprint: null,
              reviewedFingerprint: null,
              validationDiagnostics: null,
              lastError: null,
            })),
          });
        } else {
          setInitialBatch(null);
        }
      } catch (caught) {
        console.error('Generate page load error:', caught);
        setError(caught instanceof Error ? caught.message : 'Failed to load data');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [fetchJson, requestedBatchId, requestedDraftId, requestedTemplateIdsKey, requestedCompanyId, taskContext]);

  if (isLoading) return <WorkspaceSkeleton />;

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-6" role="alert">
        <div className="flex items-start gap-3 rounded-lg border border-status-error/30 bg-status-error/5 p-4">
          <AlertCircle className="h-5 w-5 shrink-0 text-status-error" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-medium text-status-error">Failed to load data</p>
            <p className="mt-1 text-sm text-text-secondary">{error}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <DocumentGenerationBatchWorkspace
      initialBatch={initialBatch}
      templates={templates}
      companies={companies}
      contacts={contacts}
      backHref={backHref}
    />
  );
}

function GenerateDocumentRouter() {
  const searchParams = useSearchParams();

  if (searchParams.get('editor') === 'oakdoc') {
    return <OakDocEditor />;
  }

  return <GenerateDocumentContent />;
}

export default function GenerateDocumentPage() {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <GenerateDocumentRouter />
    </Suspense>
  );
}
