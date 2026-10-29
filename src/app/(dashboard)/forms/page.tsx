'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCopy,
  Copy,
  Eye,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  ListChecks,
  Search,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Alert } from '@/components/ui/alert';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import { Tooltip } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dropdown, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import {
  useCreateForm,
  useDeleteForm,
  useDuplicateForm,
  useHardDeleteForm,
  useForms,
  useFormsWithWarnings,
  useRecentFormSubmissions,
} from '@/hooks/use-forms';
import type { FormStatus } from '@/generated/prisma';
import { cn } from '@/lib/utils';
import { PresetListManager } from '@/components/forms/preset-list-manager';
import { useFormUrlWarningSummaries } from '@/hooks/use-form-url-health';

const PAGE_SIZE = 20;

type TabKey = 'all' | 'draft' | 'published' | 'archived';

const TAB_LABELS: Record<TabKey, string> = {
  all: 'All',
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

const TAB_STATUSES: Record<TabKey, FormStatus | undefined> = {
  all: undefined,
  draft: 'DRAFT',
  published: 'PUBLISHED',
  archived: 'ARCHIVED',
};

const STATUS_BADGE: Record<string, string> = {
  PUBLISHED: 'bg-green-500/10 text-green-700 dark:text-green-400',
  DRAFT: 'bg-status-warning/10 text-status-warning',
  ARCHIVED: 'bg-background-tertiary text-text-muted',
};

function formatRelativeTime(value: string | Date): string {
  const now = Date.now();
  const then = new Date(value).getTime();
  const diff = Math.max(0, now - then);

  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function FormsPage() {
  const router = useRouter();
  const { success, error: showError } = useToast();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('published');
  const [page, setPage] = useState(1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isPresetsOpen, setIsPresetsOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [hardDeleteTargetId, setHardDeleteTargetId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');

  const status = TAB_STATUSES[activeTab];

  const { data, isLoading, error } = useForms(
    {
      query: query || undefined,
      status,
      page,
      limit: PAGE_SIZE,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    },
    { restoreSession: true },
  );
  const { data: allCountData } = useForms({
    query: query || undefined,
    page: 1,
    limit: 1,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });
  const { data: draftCountData } = useForms({
    query: query || undefined,
    status: 'DRAFT',
    page: 1,
    limit: 1,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });
  const { data: publishedCountData } = useForms({
    query: query || undefined,
    status: 'PUBLISHED',
    page: 1,
    limit: 1,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });
  const { data: archivedCountData } = useForms({
    query: query || undefined,
    status: 'ARCHIVED',
    page: 1,
    limit: 1,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });
  const tabCounts: Record<TabKey, number | undefined> = {
    all: activeTab === 'all' ? data?.total : allCountData?.total,
    draft: activeTab === 'draft' ? data?.total : draftCountData?.total,
    published: activeTab === 'published' ? data?.total : publishedCountData?.total,
    archived: activeTab === 'archived' ? data?.total : archivedCountData?.total,
  };
  const {
    data: recentSubmissions,
    isLoading: isRecentLoading,
    error: recentError,
  } = useRecentFormSubmissions(8);
  const {
    data: warningForms,
    isLoading: isWarningLoading,
    error: warningError,
  } = useFormsWithWarnings(8);
  const { data: urlWarningSummaries } = useFormUrlWarningSummaries();
  const urlWarningsByForm = useMemo(
    () => new Map((urlWarningSummaries ?? []).map((summary) => [summary.formId, summary])),
    [urlWarningSummaries],
  );

  const createForm = useCreateForm();
  const duplicateForm = useDuplicateForm();
  const deleteForm = useDeleteForm();
  const hardDeleteForm = useHardDeleteForm();

  const tags = useMemo(
    () => tagsText.split(',').map((tag) => tag.trim()).filter(Boolean),
    [tagsText]
  );

  const hasNoForms = !isLoading && (data?.forms.length ?? 0) === 0 && !query && activeTab === 'all';

  async function handleCreate() {
    try {
      if (!title.trim()) {
        showError('Title is required');
        return;
      }

      const created = await createForm.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        tags,
        status: 'DRAFT',
      });

      success('Form created');
      setIsCreateOpen(false);
      setTitle('');
      setDescription('');
      setTagsText('');
      router.push(`/forms/${created.id}/builder`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to create form');
    }
  }

  async function handleCopyPublicLink(slug: string) {
    try {
      const origin = window.location.origin;
      await navigator.clipboard.writeText(`${origin}/forms/f/${slug}`);
      success('Public link copied');
    } catch {
      showError('Failed to copy link');
    }
  }

  async function handleCopyEmbedCode(slug: string) {
    try {
      const origin = window.location.origin;
      const code = `<iframe src="${origin}/forms/f/${slug}?embed=1" width="100%" height="900" frameborder="0"></iframe>`;
      await navigator.clipboard.writeText(code);
      success('Embed code copied');
    } catch {
      showError('Failed to copy embed code');
    }
  }

  async function handleDuplicate(formId: string) {
    try {
      const duplicated = await duplicateForm.mutateAsync({ id: formId });
      success('Form duplicated');
      router.push(`/forms/${duplicated.id}/builder`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to duplicate form');
    }
  }

  async function handleDelete(formId: string) {
    try {
      await deleteForm.mutateAsync({ id: formId, reason: 'Removed from forms list' });
      success('Form archived');
      setDeleteTargetId(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to archive form');
    }
  }

  async function handleHardDelete(formId: string) {
    try {
      await hardDeleteForm.mutateAsync({ id: formId });
      success('Form permanently deleted');
      setHardDeleteTargetId(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to permanently delete form');
    }
  }

  return (
    <div className="min-h-screen bg-background-primary">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:gap-6 sm:p-6">

        {/* Header */}
        <section className="rounded-2xl border border-oak-primary/20 bg-gradient-to-br from-oak-primary/[0.06] to-background-secondary p-4 shadow-sm sm:rounded-3xl sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-border-primary bg-background-tertiary px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-text-muted">
                <FileText className="h-3.5 w-3.5" />
                Forms
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-text-primary sm:text-3xl">Forms</h1>
                <p className="mt-1 max-w-2xl text-sm text-text-secondary">
                  Build multi-step forms, collect responses, and publish public links.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                leftIcon={<ListChecks className="h-4 w-4" />}
                onClick={() => setIsPresetsOpen(true)}
                disabled={!activeTenantId}
              >
                Preset lists
              </Button>
              <Button
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => setIsCreateOpen(true)}
                disabled={!activeTenantId}
              >
                New Form
              </Button>
            </div>
          </div>
        </section>

        {!activeTenantId && (
          <Alert variant="warning" title="Workspace required">
            Workspace context is required to access forms.
          </Alert>
        )}

        {/* Tabs + search */}
        <section className="overflow-hidden rounded-2xl border border-border-primary bg-background-secondary shadow-sm sm:rounded-3xl">
          <div className="flex gap-0 overflow-x-auto border-b border-border-primary px-2 sm:px-4">
            {(Object.keys(TAB_LABELS) as TabKey[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setActiveTab(tab);
                  setPage(1);
                }}
                className={cn(
                  'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-3 text-sm font-medium transition-colors sm:px-4',
                  activeTab === tab
                    ? 'text-oak-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-oak-primary'
                    : 'text-text-secondary hover:text-text-primary'
                )}
              >
                {TAB_LABELS[tab]}
                {tabCounts[tab] != null && (
                  <span className="rounded-full bg-oak-primary/10 px-1.5 py-0.5 text-xs font-semibold text-oak-primary">
                    {tabCounts[tab]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="p-4">
            <FormInput
              placeholder="Search form title..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              leftIcon={<Search className="h-4 w-4" />}
            />
          </div>
        </section>

        {error && (
          <Alert variant="error" title="Unable to load forms">
            {error instanceof Error ? error.message : 'Failed to load forms'}
          </Alert>
        )}

        {/* Form list */}
        <section className="grid gap-4">
          {isLoading &&
            Array.from({ length: 4 }).map((_, idx) => (
              <div
                key={idx}
                className="h-28 animate-pulse rounded-2xl border border-border-primary bg-background-secondary sm:rounded-3xl"
              />
            ))}

          {/* Empty state / Create hero */}
          {hasNoForms ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border-primary bg-background-secondary p-10 text-center sm:rounded-3xl">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-oak-primary/10 text-oak-primary">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <p className="text-base font-semibold text-text-primary">No forms yet</p>
                <p className="mt-1 text-sm text-text-secondary">
                  Create your first form to start collecting submissions.
                </p>
              </div>
              <Button
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => setIsCreateOpen(true)}
                disabled={!activeTenantId}
              >
                New Form
              </Button>
            </div>
          ) : null}

          {/* Filtered empty state */}
          {!isLoading && !hasNoForms && (data?.forms.length ?? 0) === 0 && (
            <div className="rounded-2xl border border-dashed border-border-primary bg-background-secondary p-6 text-center sm:rounded-3xl sm:p-10">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-oak-primary/10 text-oak-primary">
                <FileText className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-text-primary">No matching forms</h2>
              <p className="mt-2 text-sm text-text-secondary">
                Try a different search or tab to find the form you need.
              </p>
            </div>
          )}

          {!isLoading &&
            data?.forms.map((form) => {
              const isPublished = form.status === 'PUBLISHED';
              const urlWarning = urlWarningsByForm.get(form.id);
              return (
                <article
                  key={form.id}
                  className="overflow-visible rounded-2xl border border-border-primary bg-background-secondary p-4 shadow-sm transition-colors hover:border-oak-primary/40 sm:rounded-3xl sm:p-5"
                >
                  <div className="flex items-start justify-between gap-3 sm:gap-4">
                    <Link href={`/forms/${form.id}/responses`} className="min-w-0 flex-1">
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 rounded-2xl bg-oak-primary/10 p-3 text-oak-primary">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          {/* Status + stat pills */}
                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                            <span
                              className={cn(
                                'rounded-full px-2.5 py-0.5 text-xs font-medium',
                                STATUS_BADGE[form.status] ?? STATUS_BADGE.ARCHIVED
                              )}
                            >
                              {form.status.charAt(0) + form.status.slice(1).toLowerCase()}
                            </span>
                            <span className="inline-flex items-center rounded-full border border-border-primary px-2.5 py-0.5 text-xs text-text-secondary">
                              {form.fieldCount} field{form.fieldCount === 1 ? '' : 's'}
                            </span>
                            <span className="inline-flex items-center rounded-full border border-border-primary px-2.5 py-0.5 text-xs text-text-secondary">
                              {form.responseCount} response{form.responseCount === 1 ? '' : 's'}
                            </span>
                            <span className="inline-flex items-center rounded-full border border-border-primary px-2.5 py-0.5 text-xs text-text-secondary">
                              {form.conversionRate}% conversion
                            </span>
                            {urlWarning ? (
                              <span
                                aria-label={`${urlWarning.warningCount} broken link${urlWarning.warningCount === 1 ? '' : 's'}`}
                                className="inline-flex items-center gap-1 rounded-full bg-status-warning/10 px-2.5 py-0.5 text-xs font-medium text-status-warning"
                              >
                                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                                {urlWarning.warningCount}
                              </span>
                            ) : null}
                          </div>

                          {/* Title */}
                          <h2 className="mt-2 truncate text-base font-semibold text-text-primary sm:text-lg">
                            {form.title}
                          </h2>

                          {/* Timestamp */}
                          {'updatedAt' in form && form.updatedAt ? (
                            <p className="mt-0.5 text-xs text-text-muted">
                              Updated {formatRelativeTime(form.updatedAt)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </Link>

                    {/* Actions */}
                    <div className="flex shrink-0 items-center gap-1">
                      <Tooltip content="View responses">
                        <Link
                          href={`/forms/${form.id}/responses`}
                          className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-background-tertiary hover:text-text-primary"
                          aria-label="View responses"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Tooltip>

                      <Tooltip content="Edit form">
                        <Link
                          href={`/forms/${form.id}/builder`}
                          className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-background-tertiary hover:text-text-primary"
                          aria-label="Edit form"
                        >
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Tooltip>

                      <Dropdown>
                        <DropdownTrigger asChild aria-label={`More actions for ${form.title}`}>
                          <button className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-background-tertiary hover:text-text-primary">
                            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </DropdownTrigger>
                        <DropdownMenu>
                          <DropdownItem
                            icon={<Copy className="h-4 w-4" />}
                            onClick={() => handleDuplicate(form.id)}
                          >
                            Duplicate form
                          </DropdownItem>
                          <DropdownItem
                            icon={<ClipboardCopy className="h-4 w-4" />}
                            onClick={() => isPublished && handleCopyPublicLink(form.slug)}
                            disabled={!isPublished}
                          >
                            Copy public link
                          </DropdownItem>
                          <DropdownItem
                            icon={<FileText className="h-4 w-4" />}
                            onClick={() => isPublished && handleCopyEmbedCode(form.slug)}
                            disabled={!isPublished}
                          >
                            Copy embed code
                          </DropdownItem>
                          <DropdownSeparator />
                          {form.status === 'ARCHIVED' ? (
                            <DropdownItem
                              destructive
                              icon={<Trash2 className="h-4 w-4" />}
                              onClick={() => setHardDeleteTargetId(form.id)}
                            >
                              Delete permanently
                            </DropdownItem>
                          ) : (
                            <DropdownItem
                              destructive
                              icon={<Trash2 className="h-4 w-4" />}
                              onClick={() => setDeleteTargetId(form.id)}
                            >
                              Archive form
                            </DropdownItem>
                          )}
                        </DropdownMenu>
                      </Dropdown>
                    </div>
                  </div>
                </article>
              );
            })}
        </section>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <section className="rounded-2xl border border-border-primary bg-background-secondary p-3 shadow-sm sm:rounded-3xl sm:p-4">
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              limit={data.limit}
              onPageChange={setPage}
              showPageSize={false}
            />
          </section>
        )}

        {/* Forms with warnings */}
        <section className="overflow-hidden rounded-2xl border border-border-primary bg-background-secondary shadow-sm sm:rounded-3xl">
          <div className="border-b border-border-primary px-4 py-4 sm:px-6">
            <h2 className="text-base font-semibold text-text-primary">Forms with warnings</h2>
            <p className="mt-0.5 text-xs text-text-secondary">Flagged submissions that need review.</p>
          </div>

          {isWarningLoading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div key={idx} className="h-12 animate-pulse rounded-lg bg-background-tertiary" />
              ))}
            </div>
          )}

          {!isWarningLoading && warningError && (
            <div className="p-4">
              <Alert variant="error">
                {warningError instanceof Error ? warningError.message : 'Failed to load forms with warnings'}
              </Alert>
            </div>
          )}

          {!isWarningLoading && !warningError && (warningForms?.length || 0) === 0 && (
            <div className="px-4 py-8 text-center text-sm text-text-secondary">
              No forms with active warnings.
            </div>
          )}

          {!isWarningLoading && !warningError && (warningForms?.length || 0) > 0 && (
            <div className="divide-y divide-border-primary">
              {warningForms?.map((form) => (
                <button
                  key={form.formId}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-background-primary sm:px-6"
                  onClick={() => router.push(`/forms/${form.formId}/responses/${form.latestSubmissionId}`)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />
                      <span className="truncate text-sm font-medium text-text-primary">{form.formTitle}</span>
                      <span className="shrink-0 rounded-full bg-status-warning/10 px-2 py-0.5 text-2xs font-medium text-status-warning">
                        {form.warningCount} warning{form.warningCount > 1 ? 's' : ''}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-text-secondary">
                      Latest flagged {formatRelativeTime(form.latestSubmittedAt)}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-oak-primary">Review →</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Most recently completed */}
        <section className="overflow-hidden rounded-2xl border border-border-primary bg-background-secondary shadow-sm sm:rounded-3xl">
          <div className="border-b border-border-primary px-4 py-4 sm:px-6">
            <h2 className="text-base font-semibold text-text-primary">Most recently completed</h2>
            <p className="mt-0.5 text-xs text-text-secondary">Latest form submissions across all forms.</p>
          </div>

          {isRecentLoading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div key={idx} className="h-12 animate-pulse rounded-lg bg-background-tertiary" />
              ))}
            </div>
          )}

          {!isRecentLoading && recentError && (
            <div className="p-4">
              <Alert variant="error">
                {recentError instanceof Error ? recentError.message : 'Failed to load recent submissions'}
              </Alert>
            </div>
          )}

          {!isRecentLoading && !recentError && (recentSubmissions?.length || 0) === 0 && (
            <div className="px-4 py-8 text-center text-sm text-text-secondary">
              No recent submissions yet.
            </div>
          )}

          {!isRecentLoading && !recentError && (recentSubmissions?.length || 0) > 0 && (
            <div className="divide-y divide-border-primary">
              {recentSubmissions?.map((submission) => (
                <button
                  key={submission.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-background-primary sm:px-6"
                  onClick={() => router.push(`/forms/${submission.formId}/responses/${submission.id}`)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text-primary">{submission.formTitle}</div>
                    <div className="mt-0.5 truncate text-xs text-text-secondary">
                      {submission.respondentName || submission.respondentEmail || 'Anonymous respondent'}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
                    <CalendarClock className="h-3.5 w-3.5" />
                    {formatRelativeTime(submission.submittedAt)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Create form modal */}
      <PresetListManager isOpen={isPresetsOpen} onClose={() => setIsPresetsOpen(false)} />

      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create form"
        description="Start with a blank draft and build fields in the editor."
        size="md"
      >
        <ModalBody className="space-y-4">
          <FormInput
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Client Intake Form"
            required
          />

          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional form description"
              className="min-h-24 w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-oak-primary"
            />
          </div>

          <FormInput
            label="Tags"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="intake, registration"
            hint="Comma-separated"
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleCreate} isLoading={createForm.isPending}>
            Create
          </Button>
        </ModalFooter>
      </Modal>

      {/* Archive confirm */}
      <ConfirmDialog
        isOpen={Boolean(deleteTargetId)}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={async () => {
          if (!deleteTargetId) return;
          await handleDelete(deleteTargetId);
        }}
        title="Archive form?"
        description="This form will no longer be accessible to respondents."
        confirmLabel="Archive"
        isLoading={deleteForm.isPending}
      />

      <ConfirmDialog
        isOpen={Boolean(hardDeleteTargetId)}
        onClose={() => setHardDeleteTargetId(null)}
        onConfirm={async () => {
          if (!hardDeleteTargetId) return;
          await handleHardDelete(hardDeleteTargetId);
        }}
        title="Delete archived form permanently?"
        description="This permanently deletes the form, responses, drafts, fields, and uploaded files. This cannot be undone."
        confirmLabel="Delete permanently"
        isLoading={hardDeleteForm.isPending}
      />
    </div>
  );
}
