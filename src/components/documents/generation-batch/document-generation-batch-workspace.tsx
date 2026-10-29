'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleDot,
  FilePlus2,
  Loader2,
  Save,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type {
  BatchGenerationResult,
  BatchItemConfiguration,
} from '@/types/document-generation-batch';
import type {
  Company,
  DocumentContact,
  DocumentTemplateSummary,
} from '@/types/document-generation';
import type { CustomPlaceholderDefinition } from '@/types/placeholders';
import type { OakDocRepeaterSectionSummary } from '@/lib/document-editor/oakdoc-custom-fields';
import { useDocumentPartyOptions } from '@/hooks/use-document-party-options';
import { useOptionSearch } from '@/hooks/use-option-search';
import { useCompanySearch, type CompanySearchOption } from '@/hooks/use-company-search';
import { useSession } from '@/hooks/use-auth';
import { useAllTemplatePartials } from '@/hooks/use-template-partials';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import {
  mapCompanyOption,
  mapContactOption,
} from '@/lib/document-generation-option-mappers';
import {
  taskLaunchContextSchema,
  withTaskLaunchContext,
} from '@/lib/task-launch-context';
import { readOakDocTemplateMetadata } from '@/lib/document-editor/oakdoc-template';
import {
  isCompanyPerPersonTag,
  perPersonSelectedIds,
  type DocumentPersonChoice,
} from '@/lib/document-generation-per-person';
import { oakDocRepeaterDefinitionForTag } from '@/lib/document-editor/oakdoc-repeater-definitions';
import { personFieldIssues } from '@/lib/document-generation-person-fields';
import {
  BATCH_STAGES,
  STAGE_LABELS,
  selectCanRequestPreflight,
  type BatchStage,
  type EditableDocumentGenerationBatch,
} from './batch-workspace-state';
import {
  buildCompletenessMap,
  completenessFor,
  hasManualEdits,
  selectGenerationBlockers,
  selectHighestReachableStageIndex,
  selectStageGates,
} from './batch-completeness';
import { useDocumentGenerationBatch } from './use-document-generation-batch';
import { BatchTemplatePicker } from './batch-template-picker';
import { BatchSharedParties } from './batch-shared-parties';
import { templateOfficerRoles, templatePartyNeeds, type TemplatePartyNeeds } from './template-party-needs';
import {
  resolutionItemContactShortlist,
  resolutionItemRepeaterSections,
  resolutionItemFieldTags,
  resolutionItemFields,
} from './resolution-item-fields';
import { BatchSharedSetup } from './batch-shared-setup';
import { BatchDocumentQueue } from './batch-document-queue';
import { BatchItemConfigurator } from './batch-item-configurator';
import { BatchReviewWorkspace } from './batch-review-workspace';
import { BatchGenerationResults } from './batch-generation-results';
import type { ApplyScope } from './apply-to-others-menu';

export interface DocumentGenerationBatchWorkspaceProps {
  initialBatch?: EditableDocumentGenerationBatch | null;
  templates: DocumentTemplateSummary[];
  companies: Company[];
  contacts: DocumentContact[];
  backHref?: string;
}

const CONTACT_ENDPOINT = '/api/contacts/options';

const getContactId = (contact: DocumentContact) => contact.id;

export function companySearchOptionToCompany(option: CompanySearchOption): Company {
  return {
    id: option.id,
    name: option.name,
    uen: option.uen ?? '',
    status: option.status ?? '',
    registeredAddress: option.registeredAddress ?? null,
    incorporationDate: option.incorporationDate ?? null,
  };
}

function formatClockTime(value: number | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DocumentGenerationBatchWorkspace({
  initialBatch = null,
  templates,
  companies,
  contacts,
  backHref = '/generated-documents',
}: DocumentGenerationBatchWorkspaceProps) {
  const { success, error: toastError } = useToast();
  const {
    state,
    dispatch,
    saveDraft,
    continueTo,
    previewItem,
    reviewItem,
    saveOakDocDraft,
    preflight,
    generate,
    retry,
    reload,
    overwriteConflict,
    navigateAway,
    requestNavigation,
    dialog,
  } = useDocumentGenerationBatch({ initialBatch });

  const [results, setResults] = useState<BatchGenerationResult | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [previewProgress, setPreviewProgress] = useState<
    { done: number; total: number } | null
  >(null);
  const [showPreflight, setShowPreflight] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [oakDocReviewDirty, setOakDocReviewDirty] = useState(false);
  const [pendingStage, setPendingStage] = useState<BatchStage | null>(null);

  const partyOptions = useDocumentPartyOptions(state.batch.primaryCompanyId);
  const activeItem = state.batch.items.find(
    (item) => item.key === state.activeItemId,
  ) ?? state.batch.items[0] ?? null;

  /* --------------------------------------------------------------------- */
  /* Server-backed option search                                            */
  /* --------------------------------------------------------------------- */

  const pinnedCompanies = useMemo<Company[]>(() => {
    const selectedId = state.batch.primaryCompanyId;
    const seededCompany = companies.find((company) => company.id === selectedId);
    if (seededCompany) return [seededCompany];
    const dtoCompany = state.batch.company;
    if (!dtoCompany) return [];
    return [{
      id: dtoCompany.id,
      name: dtoCompany.name,
      uen: dtoCompany.uen,
      status: '',
      registeredAddress: null,
      incorporationDate: null,
    }];
  }, [companies, state.batch.company, state.batch.primaryCompanyId]);

  const companySearch = useCompanySearch({
    minChars: 0,
    limit: 50,
    paginated: true,
    pinned: pinnedCompanies.map((company) => ({
      id: company.id,
      name: company.name,
      label: company.name,
      description: company.uen || '',
      uen: company.uen,
      status: company.status,
      registeredAddress: company.registeredAddress,
      incorporationDate: company.incorporationDate,
    })),
  });

  const companyOptions = useMemo<Company[]>(
    () => companySearch.options.map(companySearchOptionToCompany),
    [companySearch.options],
  );

  const knownCompaniesById = useMemo<Map<string, Company>>(() => {
    const byId = new Map<string, Company>();
    for (const option of companySearch.known.values()) {
      byId.set(option.id, companySearchOptionToCompany(option));
    }
    return byId;
  }, [companySearch.known]);

  const contactSearch = useOptionSearch<DocumentContact>({
    endpoint: CONTACT_ENDPOINT,
    mapOption: mapContactOption,
    getId: getContactId,
    seed: contacts,
  });

  // A company linked from a task, draft, or deep link is not guaranteed to be
  // on the first result page, so resolve it directly when the search cache
  // cannot answer.
  const [resolvedCompany, setResolvedCompany] = useState<Company | null>(null);
  useEffect(() => {
    const id = state.batch.primaryCompanyId;
    if (!id || knownCompaniesById.has(id)) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/companies/${encodeURIComponent(id)}?full=true`);
        if (!response.ok) return;
        const payload = await response.json() as Record<string, unknown>;
        if (!cancelled) setResolvedCompany(mapCompanyOption(payload));
      } catch {
        // A missing name is cosmetic; the selection itself is still valid.
      }
    })();
    return () => { cancelled = true; };
  }, [state.batch.primaryCompanyId, knownCompaniesById]);

  const selectedCompany = useMemo<Company | null>(() => {
    const id = state.batch.primaryCompanyId;
    if (!id) return null;
    return knownCompaniesById.get(id)
      ?? (resolvedCompany?.id === id ? resolvedCompany : null);
  }, [state.batch.primaryCompanyId, knownCompaniesById, resolvedCompany]);

  /** Companies referenced by Service Agreement entity pickers. */
  const knownCompanies = useMemo(() => {
    const byId = new Map(knownCompaniesById);
    if (selectedCompany) byId.set(selectedCompany.id, selectedCompany);
    return [...byId.values()];
  }, [knownCompaniesById, selectedCompany]);

  const partyContacts = useMemo<DocumentContact[]>(
    () => partyOptions.contacts.map((party) => ({
      id: party.id,
      fullName: party.name,
      email: party.email,
      phone: party.phone,
      designation: party.detail,
      appointments: party.appointments,
    })),
    [partyOptions.contacts],
  );

  const contactsById = useMemo(() => {
    const byId = new Map(contactSearch.known);
    for (const contact of partyContacts) byId.set(contact.id, contact);
    return byId;
  }, [contactSearch.known, partyContacts]);

  const contactOptions = useMemo(() => {
    const byId = new Map<string, DocumentContact>();
    for (const contact of partyContacts) byId.set(contact.id, contact);
    for (const contact of contactSearch.options) {
      if (!byId.has(contact.id)) byId.set(contact.id, contact);
    }
    return [...byId.values()];
  }, [contactSearch.options, partyContacts]);

  /* --------------------------------------------------------------------- */
  /* Derived completeness and gating                                        */
  /* --------------------------------------------------------------------- */

  const templateFieldsByTemplateId = useMemo(() => {
    const map: Record<string, CustomPlaceholderDefinition[]> = {};
    for (const template of templates) map[template.id] = template.placeholders;
    return map;
  }, [templates]);

  // Resolution documents also ask for the custom fields of their chosen partials.
  const { data: session } = useSession();
  const partialTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId) ?? undefined;
  const hasResolutionItems = state.batch.items.some((item) => item.templateKind === 'RESOLUTION');
  const partialsQuery = useAllTemplatePartials(partialTenantId, hasResolutionItems && Boolean(partialTenantId));
  const itemFieldsByKey = useMemo(() => {
    const partials = partialsQuery.data?.partials ?? [];
    const map: Record<string, CustomPlaceholderDefinition[]> = {};
    for (const item of state.batch.items) {
      if (item.templateKind !== 'RESOLUTION') continue;
      map[item.key] = resolutionItemFields(
        templateFieldsByTemplateId[item.templateId] ?? [],
        item.configuration.resolution,
        partials,
      );
    }
    return map;
  }, [partialsQuery.data, state.batch.items, templateFieldsByTemplateId]);

  // Word field tags per document, with those of its chosen resolution partials.
  const fieldTagsByItemKey = useMemo(() => {
    const byTemplateId = new Map(templates.map((template) => [template.id, template]));
    const partials = partialsQuery.data?.partials ?? [];
    const tags: Record<string, readonly string[] | undefined> = {};
    for (const item of state.batch.items) {
      const templateTags = readOakDocTemplateMetadata(byTemplateId.get(item.templateId)?.contentJson)?.fieldTags;
      tags[item.key] = item.templateKind === 'RESOLUTION'
        ? resolutionItemFieldTags(templateTags, item.configuration.resolution, partials)
        : templateTags;
    }
    return tags;
  }, [partialsQuery.data, templates, state.batch.items]);
  // Section names and named contacts lists per document, with those of its
  // chosen resolution partials.
  const repeaterSectionsByItemKey = useMemo(() => {
    const byTemplateId = new Map(templates.map((template) => [template.id, template]));
    const partials = partialsQuery.data?.partials ?? [];
    const sections: Record<string, OakDocRepeaterSectionSummary | null> = {};
    for (const item of state.batch.items) {
      const templateSections = byTemplateId.get(item.templateId)?.repeaterSections ?? null;
      sections[item.key] = item.templateKind === 'RESOLUTION'
        ? resolutionItemRepeaterSections(templateSections, item.configuration.resolution, partials)
        : templateSections;
    }
    return sections;
  }, [partialsQuery.data, templates, state.batch.items]);

  // What is still missing or wrong in each document's per-person values.
  const personFieldIssuesByKey = useMemo(() => {
    const contactName = (id: string) => contactsById.get(id)?.fullName ?? 'Contact';
    const issues: Record<string, ReturnType<typeof personFieldIssues>> = {};
    for (const item of state.batch.items) {
      const { configuration } = item;
      issues[item.key] = personFieldIssues({
        sections: repeaterSectionsByItemKey[item.key],
        fieldTags: fieldTagsByItemKey[item.key],
        configuration,
        customValue: (key) => {
          const own = configuration.itemValues[key];
          if (typeof own === 'string' && own.trim()) return own;
          const shared = state.batch.masterFields.fields.find((field) => field.key === key);
          if (!shared) return '';
          return configuration.masterOverrides[shared.id] ?? state.batch.masterFieldValues[shared.id] ?? '';
        },
        directors: partyOptions.directors,
        shareholders: partyOptions.shareholders,
        officers: partyOptions.officers,
        contactName,
      });
    }
    return issues;
  }, [
    contactsById,
    fieldTagsByItemKey,
    partyOptions.directors,
    partyOptions.officers,
    partyOptions.shareholders,
    repeaterSectionsByItemKey,
    state.batch.items,
    state.batch.masterFields.fields,
    state.batch.masterFieldValues,
  ]);

  const masterFieldValues = state.batch.masterFieldValues;

  // Templates with a section that makes a separate document for each person.
  const perPersonTagByTemplateId = useMemo(() => {
    const tags: Record<string, string | null> = {};
    for (const template of templates) tags[template.id] = template.repeaterSections?.perPersonTag ?? null;
    return tags;
  }, [templates]);

  const completeness = useMemo(
    () => buildCompletenessMap({
      items: state.batch.items,
      masterFields: state.batch.masterFields,
      masterFieldValues,
      templateFieldsByTemplateId,
      itemFieldsByKey,
      perPersonTagByTemplateId,
      personFieldIssuesByKey,
    }),
    [
      personFieldIssuesByKey,
      state.batch.items,
      state.batch.masterFields,
      masterFieldValues,
      templateFieldsByTemplateId,
      itemFieldsByKey,
      perPersonTagByTemplateId,
    ],
  );

  const canGenerate = selectCanRequestPreflight(state);
  const gates = useMemo(
    () => selectStageGates({
      items: state.batch.items,
      primaryCompanyId: state.batch.primaryCompanyId,
      completeness,
      canGenerate,
    }),
    [state.batch.items, state.batch.primaryCompanyId, completeness, canGenerate],
  );
  const blockers = useMemo(
    () => selectGenerationBlockers(state.batch.items, completeness),
    [state.batch.items, completeness],
  );

  const stageIndex = BATCH_STAGES.indexOf(state.stage);
  const reachableIndex = selectHighestReachableStageIndex(gates, BATCH_STAGES);
  const isReviewStage = state.stage === 'review-generate';

  const activeTemplate = useMemo(
    () => templates.find((template) => template.id === activeItem?.templateId) ?? null,
    [templates, activeItem?.templateId],
  );
  const activeOakDocFieldTags = activeItem ? fieldTagsByItemKey[activeItem.key] : undefined;
  const officerRolesByItemKey = useMemo(() => {
    const roles: Record<string, string[] | null> = {};
    for (const item of state.batch.items) roles[item.key] = templateOfficerRoles(fieldTagsByItemKey[item.key]);
    return roles;
  }, [fieldTagsByItemKey, state.batch.items]);
  // Contacts a document's contacts repeater may list, when its template or
  // chosen partials set a shortlist.
  const activeContactShortlist = useMemo(() => {
    if (!activeItem) return null;
    const shortlist = activeTemplate?.contactShortlist ?? null;
    return activeItem.templateKind === 'RESOLUTION'
      ? resolutionItemContactShortlist(shortlist, activeItem.configuration.resolution, partialsQuery.data?.partials ?? [])
      : shortlist;
  }, [activeItem, activeTemplate, partialsQuery.data]);
  // Shared parties leave out a section that splits documents per person:
  // each of those documents is for its own person.
  const sharedPartyFieldTagsByItemKey = useMemo(() => {
    const tags: Record<string, readonly string[] | undefined> = {};
    for (const item of state.batch.items) {
      const perPersonTag = perPersonTagByTemplateId[item.templateId];
      const itemTags = fieldTagsByItemKey[item.key];
      tags[item.key] = perPersonTag ? itemTags?.filter((tag) => tag !== perPersonTag) : itemTags;
    }
    return tags;
  }, [fieldTagsByItemKey, perPersonTagByTemplateId, state.batch.items]);

  const partyNeedsByItemKey = useMemo(() => {
    const byTemplateId = new Map(templates.map((template) => [template.id, template]));
    const needs: Record<string, TemplatePartyNeeds> = {};
    for (const item of state.batch.items) {
      if (item.templateKind === 'SERVICE_AGREEMENT') continue;
      needs[item.key] = templatePartyNeeds(
        byTemplateId.get(item.templateId)?.content,
        sharedPartyFieldTagsByItemKey[item.key],
      );
    }
    return needs;
  }, [sharedPartyFieldTagsByItemKey, templates, state.batch.items]);

  const activePerPersonTag = activeItem ? perPersonTagByTemplateId[activeItem.templateId] ?? null : null;
  // Everyone with a document of the active template, in batch order.
  const activeDocumentPeople = useMemo<DocumentPersonChoice[]>(() => {
    if (!activeItem || !activePerPersonTag) return [];
    return state.batch.items.flatMap((item) => {
      const person = item.configuration.documentPerson;
      return item.templateId === activeItem.templateId && person?.tag === activePerPersonTag
        ? [{ id: person.id, name: person.name }]
        : [];
    });
  }, [activeItem, activePerPersonTag, state.batch.items]);

  // Directors and shareholders start ticked, as in a repeating section: a
  // per-person template not yet chosen for gets a document for each of them.
  useEffect(() => {
    if (state.stage !== 'configure' || partyOptions.isLoading || !state.capabilities.canEditComposition) return;
    const started = new Set<string>();
    for (const item of state.batch.items) {
      const tag = perPersonTagByTemplateId[item.templateId];
      if (!tag || started.has(item.templateId) || !isCompanyPerPersonTag(tag)) continue;
      const kind = oakDocRepeaterDefinitionForTag(tag)?.kind;
      if (kind !== 'directors' && kind !== 'shareholders') continue;
      const group = state.batch.items.filter((entry) => entry.templateId === item.templateId);
      if (group.some((entry) => entry.configuration.documentPerson || perPersonSelectedIds(tag, entry.configuration) !== undefined)) continue;
      const parties = kind === 'directors' ? partyOptions.directors : partyOptions.shareholders;
      if (parties.length === 0) continue;
      started.add(item.templateId);
      dispatch({
        type: 'items/set-document-people',
        itemId: item.key,
        tag,
        people: parties.map((party) => ({ id: party.id, name: party.name })),
      });
    }
  }, [
    dispatch,
    partyOptions.directors,
    partyOptions.isLoading,
    partyOptions.shareholders,
    perPersonTagByTemplateId,
    state.batch.items,
    state.capabilities.canEditComposition,
    state.stage,
  ]);

  const overriddenCountByField = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of state.batch.items) {
      for (const fieldId of Object.keys(item.configuration.masterOverrides)) {
        counts[fieldId] = (counts[fieldId] ?? 0) + 1;
      }
    }
    return counts;
  }, [state.batch.items]);

  const effectiveValues = useMemo(() => {
    if (!activeItem) return {};
    const values: Record<string, string> = {};
    for (const field of state.batch.masterFields.fields) {
      const override = activeItem.configuration.masterOverrides[field.id];
      values[field.key] = override !== undefined
        ? override
        : masterFieldValues[field.id] ?? '';
    }
    return values;
  }, [activeItem, state.batch.masterFields.fields, masterFieldValues]);

  const completedCount = state.batch.items.filter(
    (item) => completenessFor(completeness, item.key).isComplete,
  ).length;
  const readyCount = state.batch.items.filter(
    (item) => item.status === 'READY' || item.status === 'GENERATED',
  ).length;

  const otherEditableItems = state.batch.items.filter(
    (item) => item.key !== activeItem?.key && item.status !== 'GENERATED',
  );
  const otherIncompleteCount = otherEditableItems.filter(
    (item) => !completenessFor(completeness, item.key).isComplete,
  ).length;

  /* --------------------------------------------------------------------- */
  /* Auto preview with visible progress                                     */
  /* --------------------------------------------------------------------- */

  const autoPreviewedKeys = useRef<Set<string>>(new Set());
  const autoPreviewBusy = useRef(false);
  useEffect(() => {
    if (state.stage !== 'review-generate') {
      autoPreviewedKeys.current.clear();
      setPreviewProgress(null);
      return;
    }
    if (autoPreviewBusy.current) return;
    const queue = state.batch.items.filter(
      (item) =>
        item.status !== 'GENERATED'
        && (!item.previewContent || (!item.previewFingerprint && !hasManualEdits(item)))
        && !autoPreviewedKeys.current.has(item.key),
    );
    if (queue.length === 0) return;
    autoPreviewBusy.current = true;
    setPreviewProgress({ done: 0, total: queue.length });
    void (async () => {
      let done = 0;
      for (const item of queue) {
        autoPreviewedKeys.current.add(item.key);
        try {
          await previewItem(item.key);
        } catch (caught) {
          toastError(caught instanceof Error ? caught.message : 'Preview failed');
        }
        done += 1;
        setPreviewProgress({ done, total: queue.length });
      }
      autoPreviewBusy.current = false;
      setPreviewProgress(null);
    })();
  }, [state.stage, state.batch.items, previewItem, toastError]);

  /* --------------------------------------------------------------------- */
  /* Commands                                                               */
  /* --------------------------------------------------------------------- */

  const handleSave = useCallback(async () => {
    try {
      await saveDraft();
      setLastSavedAt(Date.now());
    } catch (caught) {
      toastError(caught instanceof Error ? caught.message : 'Save failed');
    }
  }, [saveDraft, toastError]);

  const navigate = (stage: BatchStage, discardConfirmed = false) => {
    if (oakDocReviewDirty && stage !== state.stage && !discardConfirmed) {
      setPendingStage(stage);
      return;
    }
    if (stage !== state.stage) setOakDocReviewDirty(false);
    setResults(null);
    dispatch({ type: 'stage/navigate', stage });
  };

  const handleContinue = async () => {
    const nextStage = BATCH_STAGES[Math.min(BATCH_STAGES.length - 1, stageIndex + 1)];
    try {
      await continueTo(nextStage);
      setLastSavedAt(Date.now());
    } catch (caught) {
      toastError(caught instanceof Error ? caught.message : 'Save failed');
    }
  };

  const handleGenerate = async () => {
    if (oakDocReviewDirty) {
      toastError('Save the Word draft before generating.');
      return;
    }
    setShowPreflight(false);
    try {
      await preflight();
      const result = await generate();
      setResults(result);
      success(result.batchStatus === 'COMPLETED'
        ? 'All documents generated'
        : 'Generation finished with some failures');
      if (result.batchStatus === 'COMPLETED' && taskCompletionHref) {
        navigateAway(taskCompletionHref);
      }
    } catch (caught) {
      toastError(caught instanceof Error ? caught.message : 'Generation failed');
    }
  };

  const handleRetry = async (itemId: string) => {
    try {
      const updated = await retry(itemId);
      success('Document generated after retry');
      if (updated.status === 'COMPLETED' && taskCompletionHref) {
        navigateAway(taskCompletionHref);
      }
    } catch (caught) {
      toastError(caught instanceof Error ? caught.message : 'Retry failed');
    }
  };

  const handleRetryAll = async () => {
    const failed = state.batch.items.filter((item) => item.status === 'FAILED');
    let recovered = 0;
    for (const item of failed) {
      try {
        const updated = await retry(item.key);
        recovered += 1;
        if (updated.status === 'COMPLETED' && taskCompletionHref) {
          navigateAway(taskCompletionHref);
          return;
        }
      } catch (caught) {
        toastError(caught instanceof Error ? caught.message : 'Retry failed');
      }
    }
    if (recovered > 0) {
      success(`${recovered} document${recovered === 1 ? '' : 's'} generated after retry`);
    }
  };

  const handleDownloadAll = async () => {
    const documentIds = state.batch.items.flatMap((item) => (
      item.status === 'GENERATED' && item.generatedDocumentId
        ? [item.generatedDocumentId]
        : []
    ));
    if (documentIds.length === 0) return;

    setIsDownloadingAll(true);
    try {
      const response = await fetch('/api/generated-documents/bulk-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to download documents');
      }

      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `documents-${new Date().toISOString().split('T')[0]}.zip`;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
      success(`Downloaded ${documentIds.length} document${documentIds.length === 1 ? '' : 's'}`);
    } catch (caught) {
      console.error('Bulk download error:', caught);
      toastError(caught instanceof Error ? caught.message : 'Failed to download documents');
    } finally {
      setIsDownloadingAll(false);
    }
  };

  const handleApplyToOthers = (
    scope: ApplyScope,
    patch: Partial<BatchItemConfiguration>,
  ) => {
    const targets = otherEditableItems
      .filter((item) =>
        scope === 'all' || !completenessFor(completeness, item.key).isComplete)
      .map((item) => item.key);
    if (targets.length === 0) return;
    dispatch({ type: 'items/patch-many', itemIds: targets, patch });
    success(`Applied to ${targets.length} document${targets.length === 1 ? '' : 's'}`);
  };

  const selectNextIncomplete = () => {
    const next = state.batch.items.find(
      (item) => !completenessFor(completeness, item.key).isComplete,
    );
    if (next) dispatch({ type: 'item/activate', itemId: next.key });
  };

  const showResults = Boolean(results) && (
    state.batch.status === 'PARTIAL'
    || state.batch.status === 'COMPLETED'
    || state.batch.items.some((item) =>
      item.status === 'GENERATED' || item.status === 'FAILED')
  );

  const taskCompletionHref = useMemo(() => {
    const parsed = taskLaunchContextSchema.safeParse(state.batch.taskContext);
    if (!parsed.success) return null;
    const returnTo = parsed.data.returnTo ?? '/tasks';
    return withTaskLaunchContext(returnTo, { ...parsed.data, returnTo });
  }, [state.batch.taskContext]);

  const stageHints: Record<BatchStage, string> = {
    documents: state.batch.items.length > 0
      ? `${state.batch.items.length} selected`
      : 'Select documents',
    'shared-setup': selectedCompany
      ? selectedCompany.name
      : 'Select a company',
    configure: state.batch.items.length > 0
      ? `${completedCount} of ${state.batch.items.length} complete`
      : 'Configure documents',
    'review-generate': canGenerate
      ? 'Ready to generate'
      : `${readyCount} of ${state.batch.items.length} approved`,
  };

  const currentGate = gates[state.stage];
  const continueBlockedReason = state.stage === 'review-generate'
    ? gates['review-generate'].reason
    : currentGate.reason;
  const savedLabel = formatClockTime(lastSavedAt);

  return (
    <div
      data-testid="document-generation-batch-workspace"
      className={cn(
        'mx-auto flex w-full max-w-[2200px] flex-col p-3 sm:p-5',
        isReviewStage && 'h-[calc(100dvh-3rem)] overflow-hidden lg:h-dvh',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-secondary pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-oak-primary/10 text-oak-primary">
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-text-primary">
              {state.batch.items.length === 0
                ? 'Create documents'
                : `${state.batch.items.length} document${state.batch.items.length === 1 ? '' : 's'}`}
              {selectedCompany ? ` · ${selectedCompany.name}` : ''}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium',
                  state.pending
                    ? 'bg-oak-primary/10 text-oak-primary'
                    : state.dirty
                      ? 'bg-status-warning/10 text-status-warning'
                      : 'bg-status-success/10 text-status-success',
                )}
                aria-live="polite"
              >
                {state.pending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    Saving…
                  </>
                ) : state.dirty ? (
                  <>
                    <CircleDot className="h-3 w-3" aria-hidden="true" />
                    Unsaved changes
                  </>
                ) : (
                  <>
                    <Check className="h-3 w-3" aria-hidden="true" />
                    {savedLabel ? `Saved ${savedLabel}` : 'All changes saved'}
                  </>
                )}
              </span>
              {state.batch.items.length > 0 && (
                <span>{readyCount}/{state.batch.items.length} ready</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleSave()}
            disabled={state.pending !== null || state.batch.items.length === 0}
            leftIcon={<Save className="h-4 w-4" aria-hidden="true" />}
          >
            Save Draft
          </Button>
          <Link
            href={backHref}
            onClick={(event) => {
              event.preventDefault();
              requestNavigation(backHref);
            }}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
            aria-label="Exit document generation"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Exit
          </Link>
        </div>
      </header>

      {state.conflict && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-status-warning/40 bg-status-warning/5 p-3"
        >
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-status-warning"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-status-warning">
                This batch changed elsewhere
              </p>
              <p className="text-sm text-text-secondary">
                Someone saved revision {state.conflict.currentRevision} while you were
                editing. Reload to take their version, or keep yours and overwrite it.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void reload().then(
                () => success('Reloaded the latest version'),
                (caught: unknown) => toastError(
                  caught instanceof Error ? caught.message : 'Reload failed',
                ),
              )}
              disabled={state.pending !== null}
            >
              Reload theirs
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void overwriteConflict().then(
                () => {
                  setLastSavedAt(Date.now());
                  success('Your version was saved');
                },
                (caught: unknown) => toastError(
                  caught instanceof Error ? caught.message : 'Save failed',
                ),
              )}
              disabled={state.pending !== null}
            >
              Keep mine
            </Button>
          </div>
        </div>
      )}

      <nav aria-label="Generation stages" className="mt-4">
        <ol aria-label="Generation stages" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BATCH_STAGES.map((stage, index) => {
            const active = stage === state.stage;
            const gate = gates[stage];
            const lockedBackwards = !state.capabilities.canEditComposition
              && index < stageIndex;
            const unreachable = index > reachableIndex;
            const disabled = lockedBackwards || (unreachable && !active);
            const blockingReason = lockedBackwards
              ? 'Generated documents cannot be recomposed.'
              : unreachable
                ? gates[BATCH_STAGES[Math.max(0, index - 1)]].reason
                  ?? 'Finish the earlier stages first.'
                : null;
            return (
              <li key={stage}>
                <button
                  type="button"
                  onClick={() => navigate(stage)}
                  disabled={disabled}
                  aria-current={active ? 'step' : undefined}
                  title={blockingReason ?? undefined}
                  className={cn(
                    'flex min-h-14 w-full items-center gap-2 rounded-lg border px-3 text-left transition-colors',
                    active
                      ? 'border-oak-primary bg-oak-primary/5 text-oak-primary'
                      : 'border-border-primary bg-background-primary text-text-secondary hover:bg-background-tertiary',
                    disabled && 'cursor-not-allowed opacity-50 hover:bg-background-primary',
                  )}
                >
                  {gate.satisfied ? (
                    <CheckCircle2
                      className="h-4 w-4 shrink-0 text-status-success"
                      aria-hidden="true"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-secondary text-xs"
                    >
                      {index + 1}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span
                      data-stage-label={stage}
                      className="block truncate text-sm font-medium"
                    >
                      {STAGE_LABELS[stage]}
                    </span>
                    <span className="block truncate text-xs text-text-muted">
                      {disabled ? blockingReason ?? stageHints[stage] : stageHints[stage]}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <main className={cn('mt-4 flex-1', isReviewStage && 'flex min-h-0 flex-col')}>
        {state.stage === 'documents' && (
          <BatchTemplatePicker
            templates={templates}
            selected={state.batch.items}
            onAdd={(template) => dispatch({ type: 'template/add', template })}
            onRemove={(itemId) => dispatch({ type: 'template/remove', itemId })}
            onReorder={(itemId, direction) => dispatch({
              type: 'template/reorder',
              itemId,
              direction,
            })}
            onMove={(itemId, toIndex) => dispatch({
              type: 'template/move',
              itemId,
              toIndex,
            })}
            disabled={!state.capabilities.canEditComposition}
          />
        )}

        {state.stage === 'shared-setup' && (
          <BatchSharedSetup
            companyOptions={companyOptions}
            selectedCompany={selectedCompany}
            primaryCompanyId={state.batch.primaryCompanyId}
            companyQuery={companySearch.searchQuery}
            onCompanyQueryChange={companySearch.setSearchQuery}
            companyLoading={companySearch.isLoading}
            companyError={companySearch.error}
            masterFields={state.batch.masterFields}
            masterFieldValues={masterFieldValues}
            onCompanyChange={(companyId, company) => dispatch({
              type: 'shared/company',
              companyId,
              companyName: company?.name ?? null,
            })}
            onMasterValueChange={(fieldId, value) => dispatch({
              type: 'shared/masterValue',
              fieldId,
              value,
            })}
            disabled={!state.capabilities.canEditSharedSetup}
            sharedParties={(
              <BatchSharedParties
                items={state.batch.items}
                needsByItemKey={partyNeedsByItemKey}
                officerRolesByItemKey={officerRolesByItemKey}
                fieldTagsByItemKey={sharedPartyFieldTagsByItemKey}
                repeaterSectionsByItemKey={repeaterSectionsByItemKey}
                directors={partyOptions.directors}
                shareholders={partyOptions.shareholders}
                officers={partyOptions.officers}
                contacts={partyOptions.contacts}
                isLoading={partyOptions.isLoading}
                error={partyOptions.error}
                onRetry={partyOptions.reload}
                onApply={(itemIds, patch) => dispatch({ type: 'items/patch-many', itemIds, patch })}
                disabled={!state.capabilities.canEditItems}
              />
            )}
            overriddenCountByField={overriddenCountByField}
            onSelectOverridden={(fieldId) => {
              const first = state.batch.items.find((item) =>
                Object.prototype.hasOwnProperty.call(
                  item.configuration.masterOverrides,
                  fieldId,
                ));
              if (first) {
                navigate('configure');
                dispatch({ type: 'item/activate', itemId: first.key });
              }
            }}
          />
        )}

        {state.stage === 'configure' && (
          <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-4 lg:self-start">
              <BatchDocumentQueue
                items={state.batch.items}
                activeItemId={activeItem?.key ?? null}
                onSelect={(itemId) => dispatch({ type: 'item/activate', itemId })}
                completeness={completeness}
                mode="configure"
                onNextIncomplete={selectNextIncomplete}
              />
            </div>
            <div className="min-w-0">
              {activeItem ? (
                <>
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="truncate text-base font-semibold text-text-primary">
                      {activeItem.configuration.title || activeItem.templateName}
                    </h2>
                    <p className="text-xs text-text-muted">
                      {activeItem.templateName}
                      {' · '}
                      {completenessFor(completeness, activeItem.key).requiredFilled}
                      /
                      {completenessFor(completeness, activeItem.key).requiredTotal}
                      {' required complete'}
                    </p>
                  </div>
                  <BatchItemConfigurator
                    item={activeItem}
                    primaryCompany={selectedCompany}
                    companies={knownCompanies}
                    contacts={contactOptions}
                    contactsById={contactsById}
                    companyContacts={partyContacts}
                    directors={partyOptions.directors}
                    shareholders={partyOptions.shareholders}
                    officers={partyOptions.officers}
                    partyLoading={partyOptions.isLoading}
                    partyError={partyOptions.error}
                    onPartyRetry={partyOptions.reload}
                    onContactSearch={contactSearch.setQuery}
                    contactsLoading={contactSearch.isLoading}
                    companySearchQuery={companySearch.searchQuery}
                    onCompanySearch={companySearch.setSearchQuery}
                    companySearchLoading={companySearch.isLoading}
                    masterFields={state.batch.masterFields}
                    effectiveMasterValues={effectiveValues}
                    templateFields={itemFieldsByKey[activeItem.key] ?? activeTemplate?.placeholders ?? []}
                    templateContent={activeTemplate?.content}
                    templateFieldTags={activeOakDocFieldTags}
                    contactShortlist={activeContactShortlist}
                    repeaterSections={repeaterSectionsByItemKey[activeItem.key] ?? null}
                    perPersonTag={activePerPersonTag}
                    documentPeople={activeDocumentPeople}
                    onDocumentPeopleChange={(people) => {
                      if (activePerPersonTag) {
                        dispatch({ type: 'items/set-document-people', itemId: activeItem.key, tag: activePerPersonTag, people });
                      }
                    }}
                    onPatch={(patch) => dispatch({
                      type: 'item/patch',
                      itemId: activeItem.key,
                      patch,
                    })}
                    onPrimaryCompanyChange={(companyId, company) => dispatch({
                      type: 'shared/company',
                      companyId,
                      companyName: company?.name ?? null,
                    })}
                    disabled={!state.capabilities.canEditItems}
                    completeness={completenessFor(completeness, activeItem.key)}
                    otherItemCount={otherEditableItems.length}
                    otherIncompleteCount={otherIncompleteCount}
                    onApplyToOthers={handleApplyToOthers}
                  />
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-border-primary p-8 text-center text-sm text-text-muted">
                  Add a document in the first stage to configure it here.
                </div>
              )}
            </div>
          </div>
        )}

        {state.stage === 'review-generate' && (
          showResults ? (
            <BatchGenerationResults
              items={state.batch.items}
              onRetry={handleRetry}
              onRetryAll={() => void handleRetryAll()}
              onDownloadAll={() => void handleDownloadAll()}
              onBackToBatch={() => setResults(null)}
              pending={state.pending !== null}
              downloadAllPending={isDownloadingAll}
            />
          ) : (
            <BatchReviewWorkspace
              items={state.batch.items}
              activeItemId={activeItem?.key ?? null}
              onSelect={(itemId) => dispatch({ type: 'item/activate', itemId })}
              onPreview={async (itemId, replaceEditedContent) => {
                try {
                  await previewItem(itemId, replaceEditedContent);
                } catch (caught) {
                  toastError(caught instanceof Error ? caught.message : 'Preview failed');
                }
              }}
              onReview={async (itemId) => {
                try {
                  await reviewItem(itemId);
                } catch (caught) {
                  toastError(caught instanceof Error ? caught.message : 'Review failed');
                }
              }}
              onSaveOakDoc={async (itemId, bytes) => {
                try {
                  await saveOakDocDraft(itemId, bytes);
                  setLastSavedAt(Date.now());
                  success('Word draft saved');
                } catch (caught) {
                  toastError(caught instanceof Error ? caught.message : 'Could not save Word draft');
                  throw caught;
                }
              }}
              onOakDocDirtyChange={setOakDocReviewDirty}
              pending={state.pending !== null}
              completeness={completeness}
              blockers={blockers}
              previewProgress={previewProgress}
            />
          )
        )}
      </main>

      <footer className="sticky bottom-0 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border-secondary bg-background-primary/95 py-3 backdrop-blur">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate(BATCH_STAGES[Math.max(0, stageIndex - 1)])}
          disabled={stageIndex === 0 || state.pending !== null}
          leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
        >
          Back
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {continueBlockedReason && !showResults && (
            <p className="max-w-md text-right text-xs text-text-muted">
              {continueBlockedReason}
            </p>
          )}
          {state.stage === 'review-generate' ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowPreflight(true)}
              disabled={!canGenerate || oakDocReviewDirty || state.pending !== null || showResults}
            >
              Generate All
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleContinue()}
              disabled={Boolean(currentGate.reason) || state.pending !== null}
            >
              Continue
            </Button>
          )}
        </div>
      </footer>

      <ConfirmDialog
        isOpen={showPreflight}
        onClose={() => setShowPreflight(false)}
        onConfirm={() => void handleGenerate()}
        title={`Generate ${state.batch.items.length} document${state.batch.items.length === 1 ? '' : 's'}?`}
        description="Generated documents are added to Generated documents and this batch becomes read-only for the items that succeed."
        confirmLabel="Generate all"
        variant="info"
        isLoading={state.pending !== null}
      >
        <dl className="space-y-1 rounded-lg border border-border-primary bg-background-secondary p-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-text-secondary">Company</dt>
            <dd className="truncate font-medium text-text-primary">
              {selectedCompany?.name ?? '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-secondary">Documents</dt>
            <dd className="font-medium text-text-primary">{state.batch.items.length}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-secondary">Approved</dt>
            <dd className="font-medium text-text-primary">
              {readyCount} of {state.batch.items.length}
            </dd>
          </div>
        </dl>
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={pendingStage !== null}
        onClose={() => setPendingStage(null)}
        onConfirm={() => {
          if (pendingStage) navigate(pendingStage, true);
          setPendingStage(null);
        }}
        title="Discard unsaved edits?"
        description="This Word draft has unsaved edits. Leave this review stage and discard them?"
        confirmLabel="Discard edits"
        variant="warning"
      />

      {dialog}
    </div>
  );
}
