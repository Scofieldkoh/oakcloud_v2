'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2, PanelRightClose, PanelRightOpen, Save, Upload } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useToast } from '@/components/ui/toast';
import { WordPartialEditor } from '@/components/documents/oakdoc/word-partial-editor';
import {
  TEMPLATE_PARTIAL_CATEGORY_OPTIONS,
  type TemplatePartialCategoryValue,
} from '@/lib/validations/template-partial';
import { buildBlankOakDocBytes } from '@/lib/document-editor/oakdoc-html-import';
import { OAKDOC_MIME_TYPE } from '@/lib/document-editor/oakdoc-template';
import { readOakDocTemplateMetadata, isOakDocTemplate } from '@/lib/document-editor/oakdoc-template';
import {
  useSaveWordPartial,
  useTemplatePartial,
  useUpdatePartial,
  type TemplatePartialWithRelations,
} from '@/hooks/use-template-partials';

const OAKDOC_TEMPLATE_EDITOR = '/generated-documents/generate?editor=oakdoc';

interface StoredTemplate {
  id: string;
  name: string;
  content: string;
  contentJson: unknown;
}

async function fetchWordReplacementId(id: string): Promise<string | null> {
  const response = await fetch(`/api/document-templates/new-run?templateId=${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  const [replacementId] = Array.isArray(payload.templateIds) ? payload.templateIds : [];
  return typeof replacementId === 'string' && replacementId !== id ? replacementId : null;
}

async function fetchTemplate(id: string): Promise<StoredTemplate> {
  const response = await fetch(`/api/document-templates/${encodeURIComponent(id)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Failed to load the template');
  return payload as StoredTemplate;
}

function PageShell({ backHref, backLabel, title, children }: {
  backHref: string;
  backLabel: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <div>
        <Link
          href={backHref}
          className="mb-3 inline-flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </Link>
        <h1 className="text-xl font-semibold text-text-primary sm:text-2xl">{title}</h1>
      </div>
      {children}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center p-12">
      <Loader2 className="h-8 w-8 animate-spin text-accent-primary" aria-label="Loading" />
    </div>
  );
}

/** Notice shown in place of an A4 template or HTML partial. */
function RetiredA4Source({ notice }: { notice: string }) {
  return <Alert variant="info" compact>{notice}</Alert>;
}

function TemplateSource({ id }: { id: string | null }) {
  const router = useRouter();
  const { data, error, isLoading } = useQuery({
    queryKey: ['document-template-source', id],
    queryFn: () => fetchTemplate(id!),
    enabled: Boolean(id),
  });
  const isOakDoc = data ? isOakDocTemplate(data.contentJson) : false;
  const { data: replacementId } = useQuery({
    queryKey: ['document-template-word-replacement', id],
    queryFn: () => fetchWordReplacementId(id!),
    enabled: Boolean(id && data && !isOakDoc),
  });

  useEffect(() => {
    if (!id) router.replace(OAKDOC_TEMPLATE_EDITOR);
    else if (isOakDoc) router.replace(`${OAKDOC_TEMPLATE_EDITOR}&templateId=${encodeURIComponent(id)}`);
  }, [id, isOakDoc, router]);

  if (!id || isLoading || isOakDoc) return <Loading />;
  if (error || !data) {
    return <Alert variant="error">{error instanceof Error ? error.message : 'Failed to load the template'}</Alert>;
  }
  return (
    <PageShell backHref="/template-partials/documents" backLabel="Back to templates" title={data.name}>
      {replacementId && (
        <Alert variant="success" compact>
          This template has an approved Word version.{' '}
          <Link
            href={`${OAKDOC_TEMPLATE_EDITOR}&templateId=${encodeURIComponent(replacementId)}`}
            className="font-medium underline"
          >
            Open the Word version
          </Link>
        </Alert>
      )}
      <RetiredA4Source
        notice="This template was made with the retired A4 editor, which has been removed, so it can no longer be opened. Create a Word template with the same content to keep using it."
      />
    </PageShell>
  );
}

function PartialCategorySelect({
  value,
  onChange,
}: {
  value: TemplatePartialCategoryValue;
  onChange: (value: TemplatePartialCategoryValue) => void;
}) {
  return (
    <SearchableSelect
      label="Category"
      options={TEMPLATE_PARTIAL_CATEGORY_OPTIONS}
      value={value}
      onChange={(next) => {
        const option = TEMPLATE_PARTIAL_CATEGORY_OPTIONS.find((item) => item.value === next);
        if (option) onChange(option.value);
      }}
      clearable={false}
      size="md"
    />
  );
}

function blankPartialFile(name: string): File {
  const bytes = buildBlankOakDocBytes();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], `${name}.docx`, { type: OAKDOC_MIME_TYPE });
}

const PARTIAL_HEADER_HINT = 'The numbered heading in resolutions, for example APPOINTMENT OF SECRETARY. Leave empty to use the display name.';

function WordPartialForm({
  partial,
  onUploaded,
}: {
  partial: TemplatePartialWithRelations | null;
  onUploaded?: () => void;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const save = useSaveWordPartial();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TemplatePartialCategoryValue>('OTHER');
  const [header, setHeader] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const asset = partial ? readOakDocTemplateMetadata(partial.contentJson) : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (partial && !file) return;
    try {
      const saved = await save.mutateAsync(partial
        ? { id: partial.id, expectedRevision: partial.version, file: file! }
        : {
            name: name.trim(),
            displayName: displayName.trim(),
            description: description.trim(),
            category,
            header: category === 'RESOLUTION' ? header.trim() : undefined,
            file: file ?? blankPartialFile(name.trim()),
          });
      success(partial ? 'New version uploaded' : 'Word partial created');
      setFile(null);
      onUploaded?.();
      if (!partial) router.replace(`/template-partials/editor?type=partial&tab=partials&id=${saved.id}`);
    } catch (caught) {
      toastError(caught instanceof Error ? caught.message : 'Failed to save the Word partial');
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="max-w-xl space-y-4">
      <p className="text-sm text-text-secondary">
        A Word partial is reusable Word wording, inserted into Word templates from the template editor.
        Templates keep the version they were saved with until someone updates them.
      </p>
      {partial ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-primary p-3 text-sm">
          <span className="text-text-secondary">
            Version {partial.version}{asset ? ` · ${asset.fileName}` : ''}
          </span>
          <a
            href={`/api/template-partials/${partial.id}/oakdoc`}
            className="inline-flex items-center gap-1.5 text-oak-primary hover:underline"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download current version
          </a>
        </div>
      ) : (
        <>
          <FormInput
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            hint="Letters, numbers, hyphens and underscores, starting with a letter."
            required
          />
          <FormInput label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          <FormInput label="Description" value={description} onChange={(event) => setDescription(event.target.value)} />
          <PartialCategorySelect value={category} onChange={setCategory} />
          {category === 'RESOLUTION' && (
            <FormInput label="Header" value={header} onChange={(event) => setHeader(event.target.value)} hint={PARTIAL_HEADER_HINT} />
          )}
        </>
      )}
      <FormInput
        label={partial ? 'Replace with a .docx' : 'Word document (.docx, optional)'}
        hint={partial ? undefined : 'Leave empty to start from a blank page and write it here.'}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <Button
        type="submit"
        variant="primary"
        leftIcon={<Upload className="h-4 w-4" />}
        disabled={(partial ? !file : !name.trim()) || save.isPending}
      >
        {partial ? 'Upload new version' : file ? 'Create Word partial' : 'Create blank partial'}
      </Button>
    </form>
  );
}

/** Name, display name, header and description of an existing Word partial. */
function PartialDetailsForm({
  partial,
  documentDirty,
  onSaved,
}: {
  partial: TemplatePartialWithRelations;
  /** Saving details bumps the revision, so unsaved Word edits must be saved first. */
  documentDirty: boolean;
  onSaved: () => void;
}) {
  const { success, error: toastError } = useToast();
  const update = useUpdatePartial();
  const [name, setName] = useState(partial.name);
  const [displayName, setDisplayName] = useState(partial.displayName ?? '');
  const [description, setDescription] = useState(partial.description ?? '');
  const [category, setCategory] = useState<TemplatePartialCategoryValue>(partial.category ?? 'OTHER');
  const [header, setHeader] = useState(partial.header ?? '');

  useEffect(() => {
    setName(partial.name);
    setDisplayName(partial.displayName ?? '');
    setDescription(partial.description ?? '');
    setCategory(partial.category ?? 'OTHER');
    setHeader(partial.header ?? '');
  }, [partial.name, partial.displayName, partial.description, partial.category, partial.header]);

  const trimmed = {
    name: name.trim(),
    displayName: displayName.trim(),
    description: description.trim(),
    header: header.trim(),
  };
  const changed = trimmed.name !== partial.name
    || trimmed.displayName !== (partial.displayName ?? '')
    || trimmed.description !== (partial.description ?? '')
    || trimmed.header !== (partial.header ?? '')
    || category !== (partial.category ?? 'OTHER');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!changed || !trimmed.name || documentDirty) return;
    try {
      await update.mutateAsync({
        id: partial.id,
        expectedRevision: partial.version,
        name: trimmed.name,
        // An empty display name falls back to the name.
        displayName: trimmed.displayName || trimmed.name,
        description: trimmed.description || null,
        header: trimmed.header || null,
        category,
        reason: 'Updated partial details',
      });
      success('Partial details saved');
      onSaved();
    } catch (caught) {
      toastError(caught instanceof Error ? caught.message : 'Failed to save the partial details');
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <FormInput
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        hint="Letters, numbers, hyphens and underscores, starting with a letter. Templates that insert this partial keep working after a rename."
        required
      />
      <FormInput label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      <FormInput label="Description" value={description} onChange={(event) => setDescription(event.target.value)} />
      <PartialCategorySelect value={category} onChange={setCategory} />
      {(category === 'RESOLUTION' || trimmed.header) && (
        <FormInput label="Header" value={header} onChange={(event) => setHeader(event.target.value)} hint={PARTIAL_HEADER_HINT} />
      )}
      {documentDirty && changed && (
        <p className="text-sm text-text-secondary">Save your changes to the document first, then save the details.</p>
      )}
      <Button
        type="submit"
        variant="primary"
        leftIcon={<Save className="h-4 w-4" />}
        disabled={!changed || !trimmed.name || documentDirty || update.isPending}
        isLoading={update.isPending}
      >
        Save details
      </Button>
    </form>
  );
}

/** Collapsible panel beside the Word editor; starts collapsed so the document gets the width. */
function DetailsPanel({ open, onToggle, children }: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        aria-label="Show details"
        title="Show details"
        className="flex w-10 flex-shrink-0 flex-col items-center gap-2 rounded-lg border border-border-primary bg-background-secondary py-3 text-text-secondary transition-colors hover:bg-background-tertiary hover:text-text-primary"
      >
        <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs font-medium [writing-mode:vertical-rl]">Details</span>
      </button>
    );
  }
  return (
    <aside
      aria-label="Partial details"
      className="flex w-80 flex-shrink-0 flex-col overflow-hidden rounded-lg border border-border-primary bg-background-secondary"
    >
      <div className="flex items-center justify-between border-b border-border-primary px-4 py-2.5">
        <h2 className="text-sm font-medium text-text-primary">Details</h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded
          aria-label="Hide details"
          title="Hide details"
          className="rounded p-1 text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
        >
          <PanelRightClose className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">{children}</div>
    </aside>
  );
}

function PartialSource({ id }: { id: string | null }) {
  const { data: partial, error, isLoading } = useTemplatePartial(id);
  const [uploadCount, setUploadCount] = useState(0);
  const [documentDirty, setDocumentDirty] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const reloadDocument = () => setUploadCount((value) => value + 1);
  if (!id) {
    return (
      <PageShell backHref="/template-partials/partials" backLabel="Back to partials" title="New Word partial">
        <WordPartialForm partial={null} />
      </PageShell>
    );
  }
  if (isLoading) return <Loading />;
  if (error || !partial) {
    return <Alert variant="error">{error instanceof Error ? error.message : 'Failed to load the partial'}</Alert>;
  }
  const title = partial.displayName || partial.name;
  return (
    <PageShell backHref="/template-partials/partials" backLabel="Back to partials" title={title}>
      {readOakDocTemplateMetadata(partial.contentJson) ? (
        <div className="flex h-[calc(100vh-12rem)] min-h-[28rem] gap-3">
          <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border-primary shadow-sm">
            <WordPartialEditor
              partialId={partial.id}
              loadKey={uploadCount}
              title={title}
              fileName={readOakDocTemplateMetadata(partial.contentJson)?.fileName ?? `${partial.name}.docx`}
              version={partial.version}
              readOnly={false}
              placeholders={partial.placeholders}
              onDirtyChange={setDocumentDirty}
            />
          </div>
          <DetailsPanel open={detailsOpen} onToggle={() => setDetailsOpen((value) => !value)}>
            <PartialDetailsForm partial={partial} documentDirty={documentDirty} onSaved={reloadDocument} />
            <div className="border-t border-border-primary pt-4">
              <WordPartialForm partial={partial} onUploaded={reloadDocument} />
            </div>
          </DetailsPanel>
        </div>
      ) : (
        <RetiredA4Source
          notice="This partial was made with the retired A4 editor, which has been removed, so it can no longer be opened. Existing agreements and templates that use it still work. To change the wording, create a Word partial."
        />
      )}
    </PageShell>
  );
}

/**
 * Template and partial source page. The A4 editor is retired, so A4
 * templates and HTML partials show a notice, Word templates open in
 * the OakDoc editor and Word partials are edited here, created blank or
 * from a .docx, and can be replaced by upload.
 */
export function TemplateSourcePage() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  return searchParams.get('type') === 'partial'
    ? <PartialSource id={id} />
    : <TemplateSource id={id} />;
}
