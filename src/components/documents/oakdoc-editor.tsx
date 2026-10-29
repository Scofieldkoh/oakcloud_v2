'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { DocxEditor, type DocxEditorRef, type EditorCaret } from '@docx-editor.dev/react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Download, FilePlus, FileUp, Loader2, Save, Sparkles } from 'lucide-react';
import { buildBlankOakDocBytes } from '@/lib/document-editor/oakdoc-html-import';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import {
  OAKDOC_EDITOR_FIELD_CATEGORIES as OAKDOC_FIELD_CATEGORIES,
  OAKDOC_FIELD_BY_TAG,
  OAKDOC_FIELD_TAGS,
  OAKDOC_ITEM_CONDITION_FIELD_TAGS,
  OAKDOC_SCALAR_FIELDS,
} from '@/lib/document-editor/oakdoc-field-registry';
import { oakDocRepeaterDefinitionForTag } from '@/lib/document-editor/oakdoc-repeater-definitions';
import {
  inspectOakDocFields,
  pruneDeletedOakDocFields,
  type OakDocFieldDefinition,
  type OakDocFieldSummary,
} from '@/lib/document-editor/oakdoc-fields';
import type { OakDocCompanyDetail } from '@/lib/document-editor/oakdoc-context';
import {
  createOakDocRepeater,
  inspectOakDocRepeaters,
  nameOakDocRepeaterItems,
  OAKDOC_REPEATER_DEFINITIONS,
  removeOakDocRepeater,
  setOakDocRepeaterLettering,
  type OakDocRepeaterDefinition,
  type OakDocRepeaterSummary,
} from '@/lib/document-editor/oakdoc-repeaters';
import {
  createOakDocCondition,
  inspectOakDocConditions,
  removeOakDocCondition,
  type OakDocConditionOperator,
  type OakDocConditionSummary,
} from '@/lib/document-editor/oakdoc-conditions';
import {
  readOakDocTemplateMetadata,
  type OakDocTemplateMetadata,
} from '@/lib/document-editor/oakdoc-template';
import { useOakDocSectionDeleteGuard } from '@/components/documents/oakdoc/use-oakdoc-section-delete-guard';
import { useOakDocFieldBlocks } from '@/components/documents/oakdoc/use-oakdoc-field-blocks';
import { useOakDocViewKeeper } from '@/components/documents/oakdoc/use-oakdoc-view-keeper';
import { OakDocLetteredListButton } from '@/components/documents/oakdoc/oakdoc-lettered-list';
import { keepIfSame, useOakDocSummaryRefresh } from '@/components/documents/oakdoc/use-oakdoc-summary-refresh';
import { oakDocNamedKeysIn } from '@/lib/document-editor/oakdoc-named-sections';
import { OakDocPartialPanel } from '@/components/documents/oakdoc/oakdoc-partial-panel';
import { ResolutionPresetPanel } from '@/components/documents/oakdoc/resolution-preset-panel';
import { useOakDocAiSelection } from '@/components/documents/oakdoc/use-oakdoc-ai-selection';
import { AISidebar, type DocumentCategory } from '@/components/documents/ai-sidebar';
import { fetchPartialText, type TemplatePartialSummary } from '@/hooks/use-template-partials';
import {
  insertOakDocPartialReference,
  inspectOakDocPartialReferences,
  readOakDocPartialPins,
} from '@/lib/document-editor/oakdoc-partials';
import { useUnsavedNavigationGuard } from '@/hooks/use-unsaved-navigation-guard';
import {
  hasOakDocResolutionSlot,
  insertOakDocResolutionSlot,
  clearOakDocResolutionSlotPreview,
  previewOakDocResolutionSlot,
  unlockOakDocResolutionSlotContent,
} from '@/lib/document-editor/oakdoc-resolutions';
import { readResolutionPreset, resolutionSectionText } from '@/lib/resolution-composition';
import {
  oakDocCustomFieldTag,
  oakDocPersonFieldTag,
  readOakDocCustomFields,
  readOakDocPartialCustomFields,
  readOakDocRepeaterSections,
  writeOakDocCustomFields,
  writeOakDocRepeaterSections,
  type OakDocCustomField,
  type OakDocRepeaterSections,
} from '@/lib/document-editor/oakdoc-custom-fields';
import { insertOakDocField } from '@/components/documents/oakdoc/insert-oakdoc-field';
import { OakDocFieldPanel } from '@/components/documents/oakdoc/oakdoc-field-panel';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const TEMPLATE_CATEGORIES = [
  { value: 'RESOLUTION', label: 'Resolution' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'LETTER', label: 'Letter' },
  { value: 'MINUTES', label: 'Minutes' },
  { value: 'NOTICE', label: 'Notice' },
  { value: 'CERTIFICATE', label: 'Certificate' },
  { value: 'OTHER', label: 'Other' },
] as const;

interface CompanyOption {
  id: string;
  name: string;
  uen: string;
}

interface CompanyOptionsResponse {
  options: CompanyOption[];
}

interface OakDocTemplateRecord {
  id: string;
  revision: number;
  version: number;
  name: string;
  description?: string | null;
  category: string;
  compositionType?: string;
  isActive: boolean;
  contentJson?: unknown;
  resolutionPreset?: unknown;
  placeholders?: unknown;
}

/** Service Agreement masters are seeded; the editor switches the other two. */
type TemplateType = 'STANDARD' | 'RESOLUTION' | 'SERVICE_AGREEMENT';

const TEMPLATE_TYPES = [
  { value: 'STANDARD', label: 'Standard document' },
  { value: 'RESOLUTION', label: 'Resolution (numbered resolutions)' },
] as const;

interface LoadedOakDocTemplate {
  template: OakDocTemplateRecord;
  metadata: OakDocTemplateMetadata;
  bytes: Uint8Array;
}

type StatusKind = 'neutral' | 'success' | 'error';

function pruneTemplateFields(bytes: Uint8Array) {
  return pruneDeletedOakDocFields(bytes, OAKDOC_FIELD_TAGS);
}

function asUint8Array(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

async function fetchCompanyOptions(): Promise<CompanyOption[]> {
  const response = await fetch('/api/companies/options?limit=50');
  if (!response.ok) throw new Error('Could not load Oakcloud companies.');
  const payload = (await response.json()) as CompanyOptionsResponse;
  return Array.isArray(payload.options) ? payload.options : [];
}

async function fetchCompany(companyId: string): Promise<OakDocCompanyDetail> {
  const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}`);
  if (!response.ok) throw new Error('Could not load the selected company.');
  return response.json() as Promise<OakDocCompanyDetail>;
}

function pinnedVersionsOf(contentJson: unknown): Record<string, number> {
  try {
    return Object.fromEntries(readOakDocPartialPins(contentJson).map((pin) => [pin.partialId, pin.version]));
  } catch {
    return {};
  }
}

async function fetchOakDocTemplate(
  templateId: string,
  tenantId?: string | null,
): Promise<LoadedOakDocTemplate> {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  const metadataResponse = await fetch(
    `/api/document-templates/${encodeURIComponent(templateId)}?${params.toString()}`,
  );
  if (!metadataResponse.ok) {
    const payload = await metadataResponse.json().catch(() => ({}));
    throw new Error(payload.error || 'Could not load OakDoc template.');
  }

  const template = await metadataResponse.json() as OakDocTemplateRecord;
  const metadata = readOakDocTemplateMetadata(template.contentJson);
  if (!metadata) throw new Error('This template is not an OakDoc template.');

  params.set('format', 'docx');
  const fileResponse = await fetch(
    `/api/document-templates/${encodeURIComponent(templateId)}?${params.toString()}`,
    { cache: 'no-store' },
  );
  if (!fileResponse.ok) {
    const payload = await fileResponse.json().catch(() => ({}));
    throw new Error(payload.error || 'Could not load the OakDoc DOCX file.');
  }

  return {
    template,
    metadata,
    bytes: new Uint8Array(await fileResponse.arrayBuffer()),
  };
}

/** A Word partial's current file, for the preset preview; null when it can't be loaded. */
async function fetchPartialDocx(id: string): Promise<Uint8Array | null> {
  const response = await fetch(`/api/template-partials/${encodeURIComponent(id)}/oakdoc`, { cache: 'no-store' });
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
}

/**
 * Show a resolution template's preset resolutions in its slot: numbered
 * headings and each partial as it currently is, fields and repeating
 * sections included. Display only; saving clears it and generation replaces
 * the slot. A partial that can't be loaded shows its wording, or its heading.
 */
async function withPresetResolutionPreview(bytes: Uint8Array, rawPreset: unknown): Promise<Uint8Array> {
  const sections = readResolutionPreset(rawPreset)?.sections ?? [];
  const preview = await Promise.all(sections.map(async (section) => {
    const text = resolutionSectionText(section);
    if (text !== null || section.kind !== 'PARTIAL') return { heading: section.heading, text: text ?? '' };
    const partialBytes = await fetchPartialDocx(section.partialId).catch(() => null);
    if (partialBytes) return { heading: section.heading, text: '', partial: { id: section.partialId, bytes: partialBytes } };
    const loaded = await fetchPartialText(section.partialId).catch(() => null);
    return { heading: section.heading, text: loaded?.text ?? '' };
  }));
  return previewOakDocResolutionSlot(bytes, preview);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

interface OakDocPreviewResponse {
  error?: string;
  docxBase64?: string;
  diagnostics?: Array<{ severity: string; message: string }>;
  unresolvedTags?: string[];
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function downloadDocx(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([toArrayBuffer(bytes)], { type: DOCX_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeDocxName(value: string): string {
  const base = value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'OakDoc';
  return base.toLowerCase().endsWith('.docx') ? base : `${base}.docx`;
}

function statusClasses(kind: StatusKind): string {
  if (kind === 'success') {
    return 'border-status-success/20 bg-status-success/10 text-status-success';
  }
  if (kind === 'error') {
    return 'border-status-error/20 bg-status-error/10 text-status-error';
  }
  return 'border-border-primary bg-background-secondary text-text-secondary';
}

export function OakDocEditor() {
  const editorRef = useRef<DocxEditorRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readyMessageRef = useRef('');
  const loadedTemplateRevisionRef = useRef<number | null>(null);
  /** The preset resolutions shown in the slot, to show again after a save remounts the document. */
  const presetRef = useRef<unknown>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId,
  );

  const [templateId, setTemplateId] = useState<string | null>(
    searchParams.get('templateId'),
  );
  const [templateRevision, setTemplateRevision] = useState<number | null>(null);
  const [templateCategory, setTemplateCategory] = useState('OTHER');
  const [templateType, setTemplateType] = useState<TemplateType>('STANDARD');
  // Composition type of the last save in this session, for the preset panel.
  const [savedCompositionType, setSavedCompositionType] = useState<string | null>(null);
  const [hasResolutionSlot, setHasResolutionSlot] = useState(false);
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateIsActive, setTemplateIsActive] = useState(true);
  const [isDirty, setIsDirtyState] = useState(false);
  // C02: every local change bumps this; a save acknowledges only the revision
  // it serialized, so edits made while saving stay dirty and on screen.
  const localRevisionRef = useRef(0);
  const acknowledgedRevisionRef = useRef(0);
  const setIsDirty = useCallback((next: boolean) => {
    if (next) {
      localRevisionRef.current += 1;
    } else {
      acknowledgedRevisionRef.current = localRevisionRef.current;
    }
    setIsDirtyState(next);
  }, []);

  const companiesQuery = useQuery({
    queryKey: ['oakdoc', 'company-options'],
    queryFn: fetchCompanyOptions,
    staleTime: 5 * 60 * 1000,
  });

  const templateQuery = useQuery({
    queryKey: ['oakdoc', 'template', templateId, activeTenantId],
    queryFn: () => fetchOakDocTemplate(templateId!, activeTenantId),
    enabled: Boolean(templateId && activeTenantId),
    staleTime: 60 * 1000,
  });

  const [documentBytes, setDocumentBytes] = useState<Uint8Array | null>(null);
  const [documentVersion, setDocumentVersion] = useState(0);
  const [fileName, setFileName] = useState('');
  const [title, setTitle] = useState('OakDoc document');
  const [companyId, setCompanyId] = useState('');
  const [selectedDirectorId, setSelectedDirectorId] = useState('');
  const [selectedShareholderId, setSelectedShareholderId] = useState('');
  // Stored placeholders of the loaded template, kept so a save only replaces its custom fields.
  const [storedPlaceholders, setStoredPlaceholders] = useState<unknown>([]);
  const [customFields, setCustomFields] = useState<OakDocCustomField[]>([]);
  // Names of the repeating sections and shortlists of its contacts lists.
  const [repeaterSections, setRepeaterSections] = useState<OakDocRepeaterSections>({ names: {}, shortlists: {} });
  const [fieldSummary, setFieldSummary] = useState<OakDocFieldSummary>({
    count: 0,
    tags: [],
  });
  const [partialReferences, setPartialReferences] = useState<string[]>([]);
  const [refreshPartials, setRefreshPartials] = useState(false);
  const [pinnedPartialVersions, setPinnedPartialVersions] = useState<Record<string, number>>({});
  const [repeaterSummary, setRepeaterSummary] = useState<OakDocRepeaterSummary>({
    count: 0,
    tags: [],
    letteredTags: [],
  });
  const [conditionSummary, setConditionSummary] = useState<OakDocConditionSummary>({
    count: 0,
    fieldTags: [],
    conditions: [],
  });
  const [conditionField, setConditionField] = useState(
    OAKDOC_SCALAR_FIELDS[0]?.tag ?? '',
  );
  const [conditionOperator, setConditionOperator] = useState<OakDocConditionOperator>('truthy');
  const [conditionValue, setConditionValue] = useState('');
  const [status, setStatus] = useState(
    templateId ? 'Loading OakDoc template...' : 'Start blank or import a DOCX to begin.',
  );
  const [statusKind, setStatusKind] = useState<StatusKind>('neutral');
  const [busy, setBusy] = useState(false);

  const companyQuery = useQuery({
    queryKey: ['oakdoc', 'company', companyId],
    queryFn: () => fetchCompany(companyId),
    enabled: Boolean(companyId),
    staleTime: 2 * 60 * 1000,
  });

  const company = companyQuery.data;
  const [aiOpen, setAiOpen] = useState(false);
  // Bumped when a DocxEditor instance is ready, so the AI selection
  // subscription attaches to the live editor.
  const [editorReadyKey, setEditorReadyKey] = useState(0);
  const getLocalRevision = useCallback(() => localRevisionRef.current, []);
  const aiSelection = useOakDocAiSelection({
    editorRef,
    enabled: aiOpen && documentBytes !== null,
    documentKey: editorReadyKey,
    getRevision: getLocalRevision,
  });
  const directors = useMemo(
    () => company?.officers?.filter(
      (officer) => officer.isCurrent !== false && officer.role === 'DIRECTOR',
    ) ?? [],
    [company?.officers],
  );
  const shareholders = useMemo(
    () => company?.shareholders?.filter(
      (shareholder) => shareholder.isCurrent !== false,
    ) ?? [],
    [company?.shareholders],
  );

  useEffect(() => {
    setSelectedDirectorId('');
    setSelectedShareholderId('');
  }, [companyId]);

  const updateFieldSummary = useCallback((current: Uint8Array) => {
    // The preset preview's fields belong to its partials, not the template.
    const bytes = clearOakDocResolutionSlotPreview(current);
    setFieldSummary(keepIfSame(inspectOakDocFields(bytes, OAKDOC_FIELD_TAGS)));
    setRepeaterSummary(keepIfSame(inspectOakDocRepeaters(bytes)));
    setConditionSummary(keepIfSame(inspectOakDocConditions(bytes)));
    setPartialReferences(keepIfSame(inspectOakDocPartialReferences(bytes)));
    setHasResolutionSlot(hasOakDocResolutionSlot(bytes));
  }, []);
  // Deleting a field or section by typing changes no bytes the editor holds.
  const refreshFieldSummary = useOakDocSummaryRefresh(editorRef, updateFieldSummary);

  // The field-block hook owns the caret probe; it is created further down.
  const caretRef = useRef<() => EditorCaret | null>(() => null);
  const getCaret = useCallback(() => caretRef.current(), []);
  const { containerRef: viewRef, keep: keepView, restore: restoreView } = useOakDocViewKeeper(editorRef, getCaret);

  const replaceDocument = useCallback((
    bytes: Uint8Array,
    message: string,
    kind: StatusKind = 'success',
  ) => {
    keepView();
    readyMessageRef.current = message;
    setDocumentBytes(bytes);
    setDocumentVersion((value) => value + 1);
    updateFieldSummary(bytes);
    setStatus(message);
    setStatusKind(kind);
  }, [keepView, updateFieldSummary]);

  useEffect(() => {
    const loaded = templateQuery.data;
    if (!loaded) return;
    const revision = loaded.template.revision ?? loaded.template.version;
    if (loadedTemplateRevisionRef.current === revision) return;

    loadedTemplateRevisionRef.current = revision;
    setTemplateRevision(revision);
    setTitle(loaded.template.name);
    setTemplateDescription(loaded.template.description ?? '');
    setTemplateCategory(loaded.template.category || 'OTHER');
    setTemplateType(
      loaded.template.compositionType === 'RESOLUTION' || loaded.template.compositionType === 'SERVICE_AGREEMENT'
        ? loaded.template.compositionType
        : 'STANDARD',
    );
    setTemplateIsActive(loaded.template.isActive);
    setStoredPlaceholders(loaded.template.placeholders ?? []);
    setCustomFields(readOakDocCustomFields(loaded.template.placeholders));
    setRepeaterSections(readOakDocRepeaterSections(loaded.template.placeholders));
    setFileName(loaded.metadata.fileName);
    setPinnedPartialVersions(pinnedVersionsOf(loaded.template.contentJson));
    setRefreshPartials(false);
    const isResolution = loaded.template.compositionType === 'RESOLUTION';
    const hasPreset = isResolution && (readResolutionPreset(loaded.template.resolutionPreset)?.sections.length ?? 0) > 0;
    presetRef.current = hasPreset ? loaded.template.resolutionPreset : null;
    let bytes = unlockOakDocResolutionSlotContent(nameOakDocRepeaterItems(loaded.bytes));
    // Without a preset the slot shows its plain placeholder, even if an
    // earlier preset's preview was saved into it.
    if (isResolution && !hasPreset) bytes = previewOakDocResolutionSlot(bytes, []);
    const message = `Loaded OakDoc template "${loaded.template.name}" version ${revision}.`;
    replaceDocument(bytes, message);
    setIsDirty(false);
    if (!hasPreset) return;
    // Preset resolutions show in the slot once their wording has loaded.
    void withPresetResolutionPreview(bytes, loaded.template.resolutionPreset).then((previewed) => {
      if (previewed === bytes || loadedTemplateRevisionRef.current !== revision) return;
      if (localRevisionRef.current !== acknowledgedRevisionRef.current) return;
      replaceDocument(previewed, message);
    });
  }, [replaceDocument, templateQuery.data, setIsDirty]);

  const refreshPresetPreview = useCallback(async (preset: unknown) => {
    presetRef.current = preset;
    const handle = editorRef.current;
    if (!handle) return;
    try {
      const buffer = await handle.save();
      if (!buffer) return;
      const current = asUint8Array(buffer);
      const previewed = await withPresetResolutionPreview(current, preset);
      if (previewed !== current) replaceDocument(previewed, 'Preset resolutions shown in the template.');
    } catch {
      // The preview is display only; a failure leaves the document as it is.
    }
  }, [replaceDocument]);

  useEffect(() => {
    if (!templateQuery.error) return;
    setStatus(
      templateQuery.error instanceof Error
        ? templateQuery.error.message
        : 'Could not load OakDoc template.',
    );
    setStatusKind('error');
  }, [templateQuery.error]);

  const navigationGuard = useUnsavedNavigationGuard(isDirty, {
    description: 'You have unsaved OakDoc changes. Leave without saving them?',
  });

  const handleEditorKeyDownCapture = useOakDocSectionDeleteGuard({
    editorRef,
    documentBytes,
    disabled: busy,
    cleanup: pruneTemplateFields,
    onRepaired: (bytes, message) => replaceDocument(bytes, message, 'success'),
    onChanged: () => setIsDirty(true),
    onBusyChange: setBusy,
    onError: (message) => {
      setStatus(message);
      setStatusKind('error');
    },
  });

  const currentDocxBytes = useCallback(async (): Promise<Uint8Array> => {
    const handle = editorRef.current;
    if (!handle) throw new Error('OakDoc is not ready.');
    const buffer = await handle.save();
    if (!buffer) throw new Error('OakDoc did not return a DOCX file.');
    return asUint8Array(buffer);
  }, []);

  const openNewDocument = useCallback((bytes: Uint8Array, name: string) => {
    setFileName(name);
    setTitle(name.replace(/\.docx$/i, ''));
    readyMessageRef.current =
      'DOCX loaded. Highlight text or place the caret, then assign an Oakcloud field.';
    setDocumentBytes(bytes);
    setDocumentVersion((value) => value + 1);
    updateFieldSummary(bytes);
    setStatus(`Opening ${name}...`);
    setStatusKind('neutral');
    setIsDirty(true);
  }, [updateFieldSummary, setIsDirty]);

  const handleImport = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setStatus('Please choose a Microsoft Word .docx file.');
      setStatusKind('error');
      return;
    }

    setBusy(true);
    try {
      openNewDocument(asUint8Array(await file.arrayBuffer()), file.name);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not read the DOCX file.');
      setStatusKind('error');
    } finally {
      setBusy(false);
    }
  }, [openNewDocument]);

  const startBlank = useCallback(() => {
    openNewDocument(buildBlankOakDocBytes(), 'Untitled template.docx');
  }, [openNewDocument]);

  const assignField = useCallback(async (field: OakDocFieldDefinition) => {
    setBusy(true);
    try {
      const inserted = await insertOakDocField(editorRef.current, field);
      if (inserted.bytes) {
        replaceDocument(inserted.bytes, inserted.message);
      } else {
        updateFieldSummary(inserted.afterBytes);
        setStatus(inserted.message);
        setStatusKind('success');
      }
      setIsDirty(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not create the Word field.');
      setStatusKind('error');
    } finally {
      setBusy(false);
    }
  }, [replaceDocument, updateFieldSummary, setIsDirty]);

  const fieldBlocks = useOakDocFieldBlocks({
    editorRef,
    disabled: busy,
    cleanup: pruneTemplateFields,
    onRepaired: (bytes, message) => replaceDocument(bytes, message, 'success'),
    onChanged: () => setIsDirty(true),
    onHint: (message) => {
      setStatus(message);
      setStatusKind('neutral');
    },
    onDropField: (field) => void assignField(field),
  });
  caretRef.current = fieldBlocks.getCaret;
  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    fieldBlocks.onKeyDownCapture(event);
    if (!event.defaultPrevented) handleEditorKeyDownCapture(event);
  };

  const addRepeater = useCallback(async (definition: OakDocRepeaterDefinition) => {
    const handle = editorRef.current;
    const editor = handle?.getEditor();
    if (!handle || !editor) {
      setStatus('OakDoc is not ready.');
      setStatusKind('error');
      return;
    }

    const selection = editor.snapshot().selection;
    if (!selection) {
      setStatus('Place the caret inside the paragraph or table row you want to repeat.');
      setStatusKind('error');
      return;
    }

    if (!('paraId' in selection.from) || !('paraId' in selection.to)) {
      setStatus(
        'OakDoc cannot create a repeating section from this structural selection. '
        + 'Place the caret inside a normal paragraph or table row.',
      );
      setStatusKind('error');
      return;
    }

    setBusy(true);
    try {
      const bytes = await currentDocxBytes();
      const created = createOakDocRepeater({
        docxBytes: bytes,
        fromParaId: selection.from.paraId,
        toParaId: selection.to.paraId,
        definition,
      });
      replaceDocument(
        created.bytes,
        `Created ${definition.label} repeating section around the current ${created.targetKind}. `
        + `Add ${definition.itemLabel.toLowerCase()} fields inside that structure, then save the template.`,
      );
      setIsDirty(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not create repeating section.');
      setStatusKind('error');
    } finally {
      setBusy(false);
    }
  }, [currentDocxBytes, replaceDocument, setIsDirty]);

  const insertPartial = useCallback(async (partial: TemplatePartialSummary) => {
    const editor = editorRef.current?.getEditor();
    const selection = editor?.snapshot().selection;
    if (!selection || !('paraId' in selection.from)) {
      setStatus('Place the caret in the paragraph the partial should follow.');
      setStatusKind('error');
      return;
    }

    setBusy(true);
    try {
      const bytes = await currentDocxBytes();
      const label = partial.displayName || partial.name;
      replaceDocument(
        insertOakDocPartialReference({
          docxBytes: bytes,
          paraId: selection.from.paraId,
          partialId: partial.id,
          label,
        }),
        `Inserted the ${label} partial. Save the template to pin this version.`,
      );
      setIsDirty(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not insert the partial.');
      setStatusKind('error');
    } finally {
      setBusy(false);
    }
  }, [currentDocxBytes, replaceDocument, setIsDirty]);

  const insertResolutionSlot = useCallback(async () => {
    const editor = editorRef.current?.getEditor();
    const selection = editor?.snapshot().selection;
    if (!selection || !('paraId' in selection.from)) {
      setStatus('Place the caret in the paragraph the numbered resolutions should follow.');
      setStatusKind('error');
      return;
    }

    setBusy(true);
    try {
      const bytes = await currentDocxBytes();
      replaceDocument(
        insertOakDocResolutionSlot({ docxBytes: bytes, paraId: selection.from.paraId }),
        'Inserted the numbered resolutions. They follow the formatting of the paragraph they replace.',
      );
      setIsDirty(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not insert the numbered resolutions.');
      setStatusKind('error');
    } finally {
      setBusy(false);
    }
  }, [currentDocxBytes, replaceDocument, setIsDirty]);

  const removeRepeaterAtCaret = useCallback(async () => {
    const handle = editorRef.current;
    const editor = handle?.getEditor();
    if (!handle || !editor) {
      setStatus('OakDoc is not ready.');
      setStatusKind('error');
      return;
    }

    const selection = editor.snapshot().selection;
    if (!selection || !('paraId' in selection.from)) {
      setStatus('Place the caret inside the repeating section you want to remove.');
      setStatusKind('error');
      return;
    }

    setBusy(true);
    try {
      const bytes = await currentDocxBytes();
      const removed = removeOakDocRepeater({
        docxBytes: bytes,
        paraId: selection.from.paraId,
      });
      const definition = OAKDOC_REPEATER_DEFINITIONS.find(
        (candidate) => candidate.tag === removed.tag,
      );
      replaceDocument(
        removed.bytes,
        `Removed ${definition?.label ?? 'OakDoc'} repeating section and kept its template row or paragraph.`,
      );
      setIsDirty(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not remove repeating section.');
      setStatusKind('error');
    } finally {
      setBusy(false);
    }
  }, [currentDocxBytes, replaceDocument, setIsDirty]);

  const setRepeaterLettering = useCallback(async (tag: string, lettered: boolean) => {
    setBusy(true);
    try {
      const bytes = await currentDocxBytes();
      replaceDocument(
        setOakDocRepeaterLettering({ docxBytes: bytes, tag, lettered }),
        lettered
          ? 'Each person in this section is lettered (a), (b) when more than one is listed.'
          : 'This section is no longer lettered.',
      );
      setIsDirty(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not change the lettering.');
      setStatusKind('error');
    } finally {
      setBusy(false);
    }
  }, [currentDocxBytes, replaceDocument, setIsDirty]);

  const addCondition = useCallback(async () => {
    const handle = editorRef.current;
    const editor = handle?.getEditor();
    if (!handle || !editor) {
      setStatus('OakDoc is not ready.');
      setStatusKind('error');
      return;
    }

    if (!conditionField || !OAKDOC_ITEM_CONDITION_FIELD_TAGS.has(conditionField)) {
      setStatus('Choose a field for the condition.');
      setStatusKind('error');
      return;
    }

    const selection = editor.snapshot().selection;
    if (!selection || !('paraId' in selection.from) || !('paraId' in selection.to)) {
      setStatus(
        'Place the caret inside the paragraph or table row you want to make conditional.',
      );
      setStatusKind('error');
      return;
    }

    setBusy(true);
    try {
      const bytes = await currentDocxBytes();
      const created = createOakDocCondition({
        docxBytes: bytes,
        fromParaId: selection.from.paraId,
        toParaId: selection.to.paraId,
        condition: {
          field: conditionField,
          operator: conditionOperator,
          ...(conditionOperator === 'truthy' ? {} : { value: conditionValue }),
        },
        allowedFields: OAKDOC_ITEM_CONDITION_FIELD_TAGS,
      });
      const fieldLabel = OAKDOC_FIELD_BY_TAG.get(conditionField)?.label
        ?? customFields.find((field) => oakDocCustomFieldTag(field.key) === conditionField)?.label
        ?? conditionField;
      const comparison = conditionOperator === 'truthy'
        ? 'has a value'
        : conditionOperator === 'equals'
          ? `equals "${conditionValue}"`
          : `does not equal "${conditionValue}"`;
      replaceDocument(
        created.bytes,
        `Made the current ${created.targetKind} conditional: ${fieldLabel} ${comparison}.`,
      );
      setIsDirty(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not create conditional section.');
      setStatusKind('error');
    } finally {
      setBusy(false);
    }
  }, [
    conditionField,
    conditionOperator,
    conditionValue,
    currentDocxBytes,
    customFields,
    replaceDocument,
    setIsDirty,
  ]);

  const removeConditionAtCaret = useCallback(async () => {
    const handle = editorRef.current;
    const editor = handle?.getEditor();
    if (!handle || !editor) {
      setStatus('OakDoc is not ready.');
      setStatusKind('error');
      return;
    }

    const selection = editor.snapshot().selection;
    if (!selection || !('paraId' in selection.from)) {
      setStatus('Place the caret inside the conditional section you want to remove.');
      setStatusKind('error');
      return;
    }

    setBusy(true);
    try {
      const bytes = await currentDocxBytes();
      const removed = removeOakDocCondition({
        docxBytes: bytes,
        paraId: selection.from.paraId,
      });
      const fieldLabel = OAKDOC_FIELD_BY_TAG.get(removed.condition.field)?.label
        ?? removed.condition.field;
      replaceDocument(
        removed.bytes,
        `Removed the condition based on ${fieldLabel} and kept the document content.`,
      );
      setIsDirty(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not remove conditional section.');
      setStatusKind('error');
    } finally {
      setBusy(false);
    }
  }, [currentDocxBytes, replaceDocument, setIsDirty]);

  const generateResolvedCopy = useCallback(async () => {
    if (!company) {
      setStatus('Select a company before generating a document.');
      setStatusKind('error');
      return;
    }

    setBusy(true);
    try {
      // The server renders with the same pipeline as document generation,
      // so the copy matches what a generated document would contain. The
      // master is sent as it is now and is not saved.
      const bytes = await currentDocxBytes();
      const cleaned = pruneDeletedOakDocFields(bytes, OAKDOC_FIELD_TAGS);
      const formData = new FormData();
      formData.set(
        'file',
        new File([toArrayBuffer(cleaned.bytes)], safeDocxName(fileName || title), { type: DOCX_MIME }),
      );
      formData.set('context', JSON.stringify({
        ...(templateId ? { templateId } : {}),
        ...(refreshPartials ? { refreshPartialPins: 'all' } : {}),
        compositionType: templateType,
        companyId: company.id,
        ...(selectedDirectorId ? { selectedDirectorId } : {}),
        ...(selectedShareholderId ? { selectedShareholderId } : {}),
      }));
      const response = await fetch('/api/document-templates/oakdoc-preview', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json().catch(() => ({})) as OakDocPreviewResponse;
      if (!response.ok || !payload.docxBase64) {
        throw new Error(payload.error || 'Document generation failed.');
      }

      downloadDocx(base64ToBytes(payload.docxBase64), safeDocxName(`${title} - ${company.name}`));
      const problems = (payload.diagnostics ?? []).filter((item) => item.severity === 'error');
      const unresolved = payload.unresolvedTags?.length ?? 0;
      const problemMessage = problems.length > 0
        ? ` ${problems.map((item) => item.message).join(' ')}`
        : '';
      const unresolvedMessage = unresolved > 0
        ? ` ${unresolved} field type${unresolved === 1 ? '' : 's'} still need additional context.`
        : '';
      setStatus(
        `Generated a resolved DOCX from ${company.name} without changing the master template.${problemMessage}${unresolvedMessage}`,
      );
      setStatusKind(problems.length > 0 ? 'error' : unresolved > 0 ? 'neutral' : 'success');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Document generation failed.');
      setStatusKind('error');
    } finally {
      setBusy(false);
    }
  }, [
    company,
    currentDocxBytes,
    fileName,
    refreshPartials,
    selectedDirectorId,
    selectedShareholderId,
    templateId,
    templateType,
    title,
  ]);

  const applyAiText = useCallback((mode: 'insert' | 'replace', content: string) => {
    const result = mode === 'insert' ? aiSelection.insert(content) : aiSelection.replace(content);
    if (result.ok) {
      setIsDirty(true);
      setStatus(mode === 'insert' ? 'Inserted the AI text as plain text.' : 'Replaced the selection with the AI text.');
      setStatusKind('success');
    } else {
      setStatus(result.message);
      setStatusKind('error');
    }
  }, [aiSelection, setIsDirty]);

  const saveTemplate = useCallback(async () => {
    if (!activeTenantId) {
      setStatus('Select a workspace before saving the template.');
      setStatusKind('error');
      return;
    }
    if (!title.trim()) {
      setStatus('Template name is required.');
      setStatusKind('error');
      return;
    }
    if (templateId && templateRevision === null) {
      setStatus('Template revision is still loading.');
      setStatusKind('error');
      return;
    }

    setBusy(true);
    const snapshotRevision = localRevisionRef.current;
    try {
      const bytes = clearOakDocResolutionSlotPreview(await currentDocxBytes());
      const cleaned = pruneDeletedOakDocFields(bytes, OAKDOC_FIELD_TAGS);
      const savedFileName = safeDocxName(fileName || title);
      const formData = new FormData();
      formData.set(
        'file',
        new File([toArrayBuffer(cleaned.bytes)], savedFileName, { type: DOCX_MIME }),
      );
      formData.set('name', title.trim());
      formData.set('description', templateDescription);
      formData.set('category', templateCategory);
      if (templateType !== 'SERVICE_AGREEMENT') formData.set('compositionType', templateType);
      formData.set('isActive', String(templateIsActive));
      formData.set('tenantId', activeTenantId);
      if (templateId && templateRevision !== null) {
        formData.set('expectedRevision', String(templateRevision));
      }
      if (refreshPartials) formData.set('refreshPartialPins', 'all');
      formData.set('placeholders', JSON.stringify(writeOakDocRepeaterSections(
        writeOakDocCustomFields(storedPlaceholders, customFields),
        repeaterSections,
        // A name or shortlist outlives its section (or picker) only until the next save.
        oakDocNamedKeysIn(cleaned.bytes),
      )));

      const response = await fetch(
        templateId
          ? `/api/document-templates/${encodeURIComponent(templateId)}`
          : '/api/document-templates',
        {
          method: templateId ? 'PUT' : 'POST',
          body: formData,
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Could not save OakDoc template.');
      }

      const savedId = String(payload.id);
      setSavedCompositionType(typeof payload.compositionType === 'string' ? payload.compositionType : templateType);
      setPinnedPartialVersions(pinnedVersionsOf(payload.contentJson));
      setRefreshPartials(false);
      setStoredPlaceholders(payload.placeholders ?? []);
      const savedRevision = Number(payload.revision ?? payload.version);
      setTemplateId(savedId);
      setTemplateRevision(savedRevision);
      loadedTemplateRevisionRef.current = savedRevision;
      setFileName(savedFileName);
      const savedMessage = `Saved OakDoc template "${title.trim()}" version ${savedRevision}.`;
      const changedSinceSnapshot = localRevisionRef.current !== snapshotRevision;
      if (cleaned.changed > 0 && !changedSinceSnapshot) {
        // Only remount when the server-bound bytes differ from the editor
        // (deleted fields were pruned) and nothing changed during the save.
        replaceDocument(cleaned.bytes, savedMessage);
        if (presetRef.current) void refreshPresetPreview(presetRef.current);
      } else {
        setStatus(changedSinceSnapshot ? `${savedMessage} Newer edits are not saved yet.` : savedMessage);
        setStatusKind('success');
      }
      acknowledgedRevisionRef.current = snapshotRevision;
      setIsDirtyState(localRevisionRef.current !== acknowledgedRevisionRef.current);

      if (!templateId) {
        router.replace(
          `/generated-documents/generate?editor=oakdoc&templateId=${encodeURIComponent(savedId)}`,
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save OakDoc template.');
      setStatusKind('error');
    } finally {
      setBusy(false);
    }
  }, [
    activeTenantId,
    currentDocxBytes,
    customFields,
    fileName,
    refreshPartials,
    refreshPresetPreview,
    repeaterSections,
    replaceDocument,
    router,
    storedPlaceholders,
    templateCategory,
    templateDescription,
    templateId,
    templateIsActive,
    templateRevision,
    templateType,
    title,
  ]);

  const exportDocx = useCallback(async () => {
    setBusy(true);
    try {
      const bytes = clearOakDocResolutionSlotPreview(await currentDocxBytes());
      const cleaned = pruneDeletedOakDocFields(bytes, OAKDOC_FIELD_TAGS);
      const blob = new Blob([toArrayBuffer(cleaned.bytes)], { type: DOCX_MIME });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(fileName || 'oakdoc.docx').replace(/\.docx$/i, '')}-oakdoc.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('Exported DOCX with native Oakcloud Word fields.');
      setStatusKind('success');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'DOCX export failed.');
      setStatusKind('error');
    } finally {
      setBusy(false);
    }
  }, [currentDocxBytes, fileName]);

  const hasDocument = documentBytes !== null;
  const companyOptions = companiesQuery.data ?? [];
  const partialCustomFields = readOakDocPartialCustomFields(storedPlaceholders);
  const conditionCustomFields = [...customFields, ...partialCustomFields];
  // A condition inside a repeating section can test each person's own details
  // (is the contact a company?) and per-person fields.
  const sectionConditionFields = Array.from(new Map(repeaterSummary.tags.flatMap((tag) => [
    ...(oakDocRepeaterDefinitionForTag(tag)?.fields ?? []).map((field) => ({ tag: field.tag, label: field.label })),
    ...(repeaterSections.personFields?.[tag] ?? []).map((field) => ({
      tag: oakDocPersonFieldTag(field.key),
      label: `${field.label} (per person)`,
    })),
  ]).map((field) => [field.tag, field])).values());
  const fieldLabel = (tag: string): string => OAKDOC_FIELD_BY_TAG.get(tag)?.label
    ?? conditionCustomFields.find((field) => oakDocCustomFieldTag(field.key) === tag)?.label
    ?? sectionConditionFields.find((field) => field.tag === tag)?.label
    ?? tag;

  return (
    <div className="h-[calc(100vh-1rem)] min-h-[720px] overflow-hidden bg-background-primary p-2">
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border-primary bg-background-secondary">
        <header className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border-primary bg-background-primary px-3 py-2">
          <div className="mr-auto min-w-0">
            <div className="text-sm font-semibold text-text-primary">OakDoc</div>
            <div className="text-[11px] text-text-muted">
              DOCX-native Oakcloud document editor
            </div>
          </div>

          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ArrowLeft className="h-4 w-4" />}
            disabled={busy}
            onClick={() => navigationGuard.requestNavigation('/template-partials/documents')}
          >
            Templates
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImport(file);
              event.currentTarget.value = '';
            }}
          />

          <Button
            variant="secondary"
            size="sm"
            leftIcon={<FileUp className="h-4 w-4" />}
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            Import Word
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Sparkles className="h-4 w-4" />}
            disabled={!hasDocument}
            aria-pressed={aiOpen}
            onClick={() => setAiOpen((open) => !open)}
          >
            AI assistant
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={
              !hasDocument
              || !company
              || busy
              || (
                fieldSummary.count === 0
                && repeaterSummary.count === 0
                && conditionSummary.count === 0
              )
            }
            onClick={() => void generateResolvedCopy()}
          >
            Generate copy
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Download className="h-4 w-4" />}
            disabled={!hasDocument || busy}
            onClick={() => void exportDocx()}
          >
            Export master
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Save className="h-4 w-4" />}
            disabled={!hasDocument || busy || !activeTenantId || !title.trim()}
            onClick={() => void saveTemplate()}
          >
            {templateId ? 'Save Template' : 'Save as Template'}
          </Button>
        </header>

        <main className="grid min-h-0 min-w-0 grid-cols-[320px_minmax(0,1fr)_auto] overflow-hidden">
          <aside className="min-h-0 overflow-y-auto border-r border-border-primary bg-background-primary p-3">
            {/* Pinned so the result of an insert or save shows wherever the panel is scrolled. */}
            <div
              role="status"
              aria-live="polite"
              className="sticky -top-3 z-10 -mx-3 -mt-3 mb-3 bg-background-primary px-3 pb-2 pt-3"
            >
              <div className={`rounded-lg border p-2.5 text-xs leading-relaxed ${statusClasses(statusKind)}`}>
                {busy ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {status}
                  </span>
                ) : status}
              </div>
            </div>
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Template
                  </h2>
                  <p className="mt-1 text-xs text-text-secondary">
                    Save the DOCX as the reusable Oakcloud master template.
                  </p>
                </div>
                <span className="text-[10px] text-text-muted">
                  {templateId
                    ? `v${templateRevision ?? '...'}${isDirty ? ' · Unsaved' : ''}`
                    : isDirty ? 'New · Unsaved' : 'New'}
                </span>
              </div>
              <input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setIsDirty(true);
                }}
                placeholder="Template name"
                className="h-9 w-full rounded-lg border border-border-primary bg-background-primary px-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/20"
              />
              <select
                value={templateCategory}
                onChange={(event) => {
                  setTemplateCategory(event.target.value);
                  setIsDirty(true);
                }}
                className="h-9 w-full rounded-lg border border-border-primary bg-background-primary px-2.5 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/20"
              >
                {TEMPLATE_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
              {templateType === 'SERVICE_AGREEMENT' ? (
                <p className="text-xs text-text-secondary">Type: Service Agreement</p>
              ) : (
                <select
                  value={templateType}
                  aria-label="Template type"
                  onChange={(event) => {
                    setTemplateType(event.target.value as TemplateType);
                    if (event.target.value === 'RESOLUTION') setTemplateCategory('RESOLUTION');
                    setIsDirty(true);
                  }}
                  className="h-9 w-full rounded-lg border border-border-primary bg-background-primary px-2.5 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/20"
                >
                  {TEMPLATE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              )}
              <textarea
                value={templateDescription}
                rows={2}
                onChange={(event) => {
                  setTemplateDescription(event.target.value);
                  setIsDirty(true);
                }}
                placeholder="Description (optional)"
                className="w-full rounded-lg border border-border-primary bg-background-primary px-2.5 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/20"
              />
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={templateIsActive}
                  onChange={(event) => {
                    setTemplateIsActive(event.target.checked);
                    setIsDirty(true);
                  }}
                />
                Active template
              </label>
            </section>

            <div className="my-4 border-t border-border-secondary" />

            <section className="space-y-2">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Company context
                </h2>
                <p className="mt-1 text-xs text-text-secondary">
                  Select the company used when resolving OakDoc fields.
                </p>
              </div>

              <select
                className="h-9 w-full rounded-lg border border-border-primary bg-background-primary px-2.5 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/20"
                value={companyId}
                disabled={companiesQuery.isLoading}
                onChange={(event) => setCompanyId(event.target.value)}
              >
                <option value="">
                  {companiesQuery.isLoading ? 'Loading companies...' : 'Select company...'}
                </option>
                {companyOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}{option.uen ? ` · ${option.uen}` : ''}
                  </option>
                ))}
              </select>

              {companyId && companyQuery.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading company context...
                </div>
              ) : null}

              {directors.length > 0 ? (
                <select
                  className="h-9 w-full rounded-lg border border-border-primary bg-background-primary px-2.5 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/20"
                  value={selectedDirectorId}
                  onChange={(event) => setSelectedDirectorId(event.target.value)}
                >
                  <option value="">Selected director (optional)...</option>
                  {directors.map((director) => (
                    <option key={director.id} value={director.id}>
                      {director.name}
                    </option>
                  ))}
                </select>
              ) : null}

              {shareholders.length > 0 ? (
                <select
                  className="h-9 w-full rounded-lg border border-border-primary bg-background-primary px-2.5 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/20"
                  value={selectedShareholderId}
                  onChange={(event) => setSelectedShareholderId(event.target.value)}
                >
                  <option value="">Selected shareholder (optional)...</option>
                  {shareholders.map((shareholder) => (
                    <option key={shareholder.id} value={shareholder.id}>
                      {shareholder.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </section>

            <div className="my-4 border-t border-border-secondary" />

            {templateType === 'RESOLUTION' ? (
              <>
                <section className="space-y-2">
                  <div>
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                      Numbered resolutions
                    </h2>
                    <p className="mt-1 text-xs text-text-secondary">
                      {hasResolutionSlot
                        ? 'In place. The partials and custom text chosen when generating print here, numbered 1, 2, 3 in that order, in the formatting of this paragraph.'
                        : 'Put the caret in the paragraph the resolutions should follow, then insert them. A resolution template cannot be saved without them.'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!hasDocument || busy || hasResolutionSlot}
                    onClick={() => void insertResolutionSlot()}
                  >
                    Insert numbered resolutions
                  </Button>
                </section>

                <section className="mt-4 space-y-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Preset resolutions
                  </h2>
                  <ResolutionPresetPanel
                    templateId={templateId}
                    savedAsResolution={(savedCompositionType ?? templateQuery.data?.template.compositionType) === 'RESOLUTION'}
                    initialPreset={templateQuery.data?.template.resolutionPreset}
                    disabled={busy}
                    onSaved={(preset) => void refreshPresetPreview(preset)}
                  />
                </section>

                <div className="my-4 border-t border-border-secondary" />
              </>
            ) : null}

            <OakDocFieldPanel
              presentTags={fieldSummary.tags}
              fieldCount={fieldSummary.count}
              onInsert={(field) => void assignField(field)}
              disabled={!hasDocument || busy}
              customFields={customFields}
              partialCustomFields={partialCustomFields}
              onCustomFieldsChange={(next) => {
                setCustomFields(next);
                setIsDirty(true);
              }}
              repeaterTags={repeaterSummary.tags}
              repeaterCount={repeaterSummary.count}
              letteredRepeaterTags={repeaterSummary.letteredTags}
              onAddRepeater={(definition) => void addRepeater(definition)}
              onRemoveRepeaterAtCaret={() => void removeRepeaterAtCaret()}
              onRepeaterLetteringChange={(tag, lettered) => void setRepeaterLettering(tag, lettered)}
              sections={repeaterSections}
              onSectionsChange={(next) => {
                setRepeaterSections(next);
                setIsDirty(true);
              }}
              allowPerPersonDocuments={templateType !== 'SERVICE_AGREEMENT'}
            />

            <div className="my-4 border-t border-border-secondary" />

            <OakDocPartialPanel
              tenantId={activeTenantId ?? undefined}
              referencedIds={partialReferences}
              disabled={!hasDocument || busy}
              onInsert={(partial) => void insertPartial(partial)}
              pinnedVersions={pinnedPartialVersions}
              refreshLatest={refreshPartials}
              onRefreshLatestChange={setRefreshPartials}
            />

            <div className="my-4 border-t border-border-secondary" />

            <section className="space-y-3">
              <div>
                <div className="flex items-end justify-between gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Conditional sections
                  </h2>
                  <span className="text-[11px] text-text-muted">
                    {conditionSummary.count} in document
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-secondary">
                  Choose a rule, place the caret in a paragraph or table row, then apply the condition.
                </p>
              </div>

              <select
                value={conditionField}
                onChange={(event) => setConditionField(event.target.value)}
                className="h-9 w-full rounded-lg border border-border-primary bg-background-primary px-2.5 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/20"
              >
                {OAKDOC_FIELD_CATEGORIES.map((category) => (
                  <optgroup key={category.key} label={category.label}>
                    {category.fields.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {sectionConditionFields.length > 0 ? (
                  <optgroup label="Each person in a repeating section">
                    {sectionConditionFields.map((field) => (
                      <option key={field.tag} value={field.tag}>
                        {field.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {conditionCustomFields.length > 0 ? (
                  <optgroup label="Custom fields">
                    {conditionCustomFields.map((field) => (
                      <option key={field.key} value={oakDocCustomFieldTag(field.key)}>
                        {field.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>

              <select
                value={conditionOperator}
                onChange={(event) => {
                  setConditionOperator(event.target.value as OakDocConditionOperator);
                  if (event.target.value === 'truthy') setConditionValue('');
                }}
                className="h-9 w-full rounded-lg border border-border-primary bg-background-primary px-2.5 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/20"
              >
                <option value="truthy">Has a value / is true</option>
                <option value="equals">Equals</option>
                <option value="notEquals">Does not equal</option>
              </select>

              {conditionOperator !== 'truthy' ? (
                <input
                  value={conditionValue}
                  onChange={(event) => setConditionValue(event.target.value)}
                  placeholder="Comparison value"
                  className="h-9 w-full rounded-lg border border-border-primary bg-background-primary px-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/20"
                />
              ) : null}

              <button
                type="button"
                disabled={!hasDocument || busy || !conditionField}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => void addCondition()}
                className="w-full rounded-md border border-oak-primary/30 bg-oak-primary/5 px-2.5 py-2 text-xs font-medium text-oak-primary transition-colors hover:bg-oak-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Apply condition at caret
              </button>

              {conditionSummary.count > 0 ? (
                <>
                  <button
                    type="button"
                    disabled={!hasDocument || busy}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => void removeConditionAtCaret()}
                    className="w-full rounded-md border border-border-primary px-2.5 py-2 text-xs text-text-secondary transition-colors hover:border-status-error/40 hover:bg-status-error/5 hover:text-status-error disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Remove condition at caret
                  </button>

                  <div className="space-y-1.5">
                    {conditionSummary.conditions.map((condition) => {
                      const conditionLabel = fieldLabel(condition.field);
                      const rule = condition.operator === 'truthy'
                        ? 'has a value'
                        : condition.operator === 'equals'
                          ? `equals "${condition.value ?? ''}"`
                          : `does not equal "${condition.value ?? ''}"`;
                      return (
                        <div
                          key={condition.id}
                          className="rounded-lg border border-border-primary bg-background-primary px-2.5 py-2"
                        >
                          <div className="truncate text-xs font-medium text-text-primary">
                            {conditionLabel}
                          </div>
                          <div className="mt-0.5 truncate text-[10px] text-text-muted">
                            {rule}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </section>

          </aside>

          <section
            ref={(element) => { viewRef.current = element; }}
            className="relative min-h-0 min-w-0 overflow-hidden bg-[#eef0f2]"
            onKeyDownCapture={handleEditorKeyDown}
            onPointerUpCapture={fieldBlocks.onPointerUpCapture}
            onDragOver={fieldBlocks.onDragOver}
            onDrop={fieldBlocks.onDrop}
          >
            {documentBytes ? (
              <DocxEditor
                key={documentVersion}
                ref={editorRef}
                document={documentBytes}
                title={title}
                onTitleChange={(value) => {
                  setTitle(value);
                  setIsDirty(true);
                }}
                mode="edit"
                zoomMode="auto"
                locale="en-SG"
                colorMode="light"
                menu={{ reportIssue: false }}
                onOpen={() => fileInputRef.current?.click()}
                onSave={() => void saveTemplate()}
                onReady={() => {
                  setEditorReadyKey((value) => value + 1);
                  restoreView();
                  const message = readyMessageRef.current || 'DOCX ready.';
                  readyMessageRef.current = '';
                  setStatus(message);
                  setStatusKind('success');
                }}
                onChange={() => {
                  if (!readyMessageRef.current) {
                    setIsDirty(true);
                    setStatus('Document changed.');
                    setStatusKind('neutral');
                    refreshFieldSummary();
                  }
                }}
                className="h-full min-h-0"
              >
                {fieldBlocks.probe}
                <OakDocLetteredListButton />
              </DocxEditor>
            ) : (
              <div className="absolute inset-6 grid place-items-center">
                <div className="max-w-lg rounded-xl border border-dashed border-border-primary bg-background-primary p-8 text-center shadow-sm">
                  <div className="text-sm font-semibold text-text-primary">
                    Start a Word template
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    Start from a blank page or import an existing Microsoft Word document. OakDoc
                    keeps DOCX as the native format and uses Word content controls for Oakcloud fields.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={<FilePlus className="h-4 w-4" />}
                      onClick={startBlank}
                      disabled={busy}
                    >
                      Start blank
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<FileUp className="h-4 w-4" />}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy}
                    >
                      Import Word .docx
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </section>
          <AISidebar
            isOpen={aiOpen && hasDocument}
            onClose={() => setAiOpen(false)}
            context={{
              mode: 'template_editor',
              templateCategory: templateCategory as DocumentCategory,
              templateName: title,
              tenantId: activeTenantId ?? undefined,
              selectedText: aiSelection.selectedText,
            }}
            onInsert={(content) => applyAiText('insert', content)}
            onReplace={(content) => applyAiText('replace', content)}
          />
        </main>
      </div>
      {navigationGuard.dialog}
    </div>
  );
}
