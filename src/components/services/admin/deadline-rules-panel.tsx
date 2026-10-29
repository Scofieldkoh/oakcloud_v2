'use client';

import { useEffect, useMemo, useState } from 'react';
import { Archive, History, Loader2, MoreHorizontal, Plus, Search } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@/components/ui/dropdown';
import { Modal } from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import {
  useApplyDeadlineRulePreset,
  useArchiveDeadlineRule,
  useCreateDeadlineRule,
  useDeadlineRule,
  useDeadlineRules,
  usePreviewDeadlineRuleImpact,
  usePublishDeadlineRule,
  useUpdateDeadlineRule,
} from '@/hooks/use-deadline-rules';
import type { DeadlineRuleDraftInput } from '@/lib/validations/deadline-rule';
import type { DeadlineRuleArchiveInput, DeadlineRuleImpactInput, DeadlineRulePublishInput } from '@/services/deadline-rule';
import type { DeadlineRuleDto, DeadlineRuleImpact, DeadlineRulePresetCode } from '@/services/deadline-rule';
import { DeadlineRuleForm, describeBusinessDayAdjustment, describeDeadlineExpression, describeRuleRecurrence } from './deadline-rule-form';
import { RuleImpactDialog } from './rule-impact-dialog';

interface DeadlineRulesPanelProps {
  workspaceId?: string;
  canAdminister?: boolean;
  featureEnabled?: boolean;
  active?: boolean;
}

type StatusFilter = 'all' | 'active' | 'inactive';

/** Reviewed statutory presets, grouped by the authority each filing goes to. */
const PRESET_GROUPS: Array<{ authority: 'IRAS' | 'ACRA'; presets: Array<{ code: DeadlineRulePresetCode; label: string }> }> = [
  {
    authority: 'IRAS',
    presets: [
      { code: 'SG_ECI', label: 'Estimated Chargeable Income (ECI)' },
      { code: 'SG_FORM_C', label: 'Corporate income tax return (Form C)' },
    ],
  },
  {
    authority: 'ACRA',
    presets: [
      { code: 'SG_AGM_DUE', label: 'Annual general meeting (AGM)' },
      { code: 'SG_ANNUAL_RETURN', label: 'Annual return (AR)' },
    ],
  },
];

const PRESET_AUTHORITY = Object.fromEntries(
  PRESET_GROUPS.flatMap((group) => group.presets.map((preset) => [preset.code, group.authority])),
) as Record<DeadlineRulePresetCode, 'IRAS' | 'ACRA'>;

function ruleDraftIdentity(rule: DeadlineRuleDto, operation: 'PUBLISH' | 'ARCHIVE'): DeadlineRuleImpactInput {
  const draft = rule.draft ?? rule.currentVersion;
  return {
    operation,
    expectedCurrentVersion: rule.currentVersion?.version ?? null,
    expectedDraftRevision: draft?.draftRevision ?? 1,
    draftConfigHash: draft?.configHash ?? '',
  };
}

function formatDate(value: Date | string | null): string {
  if (!value) return 'Not published';
  return new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium' }).format(new Date(value));
}

function ruleStatus(rule: DeadlineRuleDto): { label: string; className: string } {
  if (!rule.isActive) return { label: 'Archived', className: 'badge badge-neutral' };
  if (rule.draft) return { label: 'Draft', className: 'badge badge-warning' };
  return { label: 'Published', className: 'badge badge-success' };
}

function applicabilitySummary(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'Not configured';
  const node = value as { kind?: string; conditions?: unknown[] };
  const count = Array.isArray(node.conditions) ? node.conditions.length : 0;
  if (count === 0) return 'All eligible companies';
  return (node.kind === 'ANY' ? 'Any' : 'All') + ' of ' + count + ' condition' + (count === 1 ? '' : 's');
}

function primaryDeadlineSummary(rule: DeadlineRuleDto): string {
  const version = rule.draft ?? rule.currentVersion;
  const milestone = version?.milestones.find((item) => item.isActive) ?? version?.milestones[0];
  if (!milestone) return 'No deadline configured';
  return milestone.name + ': ' + describeDeadlineExpression(milestone.expression);
}

export function DeadlineRulesPanel({
  workspaceId,
  canAdminister = true,
  featureEnabled = true,
  active = true,
}: DeadlineRulesPanelProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<DeadlineRuleImpact | null>(null);
  const [archivePreview, setArchivePreview] = useState<DeadlineRuleImpact | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveImpactOpen, setArchiveImpactOpen] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [selectedOverride, setSelectedOverride] = useState<DeadlineRuleDto | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filters = useMemo(() => ({
    query: query || undefined,
    isActive: status === 'all' ? undefined : status === 'active',
    includeArchived: status === 'inactive',
    page,
    limit: 20,
  }), [page, query, status]);
  const panelEnabled = Boolean(active && featureEnabled && canAdminister && workspaceId);
  const list = useDeadlineRules(workspaceId, filters, panelEnabled);
  const firstId = list.data?.rules[0]?.id;
  const activeId = selectedId ?? firstId;
  const detail = useDeadlineRule(workspaceId, activeId, panelEnabled);
  const selected = selectedOverride?.id === activeId
    ? selectedOverride
    : detail.data ?? list.data?.rules.find((rule) => rule.id === activeId) ?? null;
  const create = useCreateDeadlineRule(workspaceId);
  const update = useUpdateDeadlineRule(workspaceId);
  const previewMutation = usePreviewDeadlineRuleImpact(workspaceId);
  const publish = usePublishDeadlineRule(workspaceId);
  const archive = useArchiveDeadlineRule(workspaceId);
  const applyPreset = useApplyDeadlineRulePreset(workspaceId);

  const syncAuthoritativeRule = async (result: DeadlineRuleDto | undefined) => {
    if (result) {
      setSelectedOverride(result);
      return;
    }
    try {
      await detail.refetch();
    } catch {
      // The mutation succeeded; the query error state will expose a failed
      // refetch without retaining the pre-mutation override.
    } finally {
      setSelectedOverride(null);
    }
  };

  useEffect(() => {
    if (!activeId && firstId) setSelectedId(firstId);
    if (selectedId && list.data && !list.data.rules.some((rule) => rule.id === selectedId)) setSelectedId(firstId);
  }, [activeId, firstId, list.data, selectedId]);

  useEffect(() => {
    setPreview(null);
    setArchivePreview(null);
    setArchiveImpactOpen(false);
    setSelectedOverride((current) => current?.id === activeId ? current : null);
    setDraftDirty(false);
  }, [activeId]);

  const handlePreview = async (operation: 'PUBLISH' | 'ARCHIVE') => {
    if (!selected || draftDirty) return;
    setActionError(null);
    try {
      const impact = await previewMutation.mutateAsync({ id: selected.id, input: ruleDraftIdentity(selected, operation) });
      if (operation === 'ARCHIVE') {
        setArchivePreview(impact);
        setPreview(null);
        setArchiveImpactOpen(true);
      } else {
        setPreview(impact);
        setArchivePreview(null);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to preview impact.');
    }
  };

  const handleDraftSubmit = async (input: DeadlineRuleDraftInput) => {
    setActionError(null);
    try {
      if (creating) {
        const created = await create.mutateAsync(input);
        setCreating(false);
        setSelectedId(created.id);
        setSelectedOverride(created);
      } else if (selected) {
        const updated = await update.mutateAsync({ id: selected.id, input });
        if (updated) setSelectedOverride(updated);
        setEditing(false);
      }
      setDraftDirty(false);
      setPreview(null);
      setArchivePreview(null);
      setArchiveImpactOpen(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to save the deadline rule.');
      throw error;
    }
  };

  const handleApplyPreset = async (code: DeadlineRulePresetCode) => {
    setActionError(null);
    try {
      const staged = await applyPreset.mutateAsync({ code });
      setCreating(false);
      setEditing(false);
      setDraftDirty(false);
      setPreview(null);
      setArchivePreview(null);
      setSelectedId(staged.id);
      setSelectedOverride(staged);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to apply the ' + PRESET_AUTHORITY[code] + ' rule.');
    }
  };

  const handlePublish = async () => {
    if (!selected || !preview || draftDirty) return;
    const identity = ruleDraftIdentity(selected, 'PUBLISH');
    const input: DeadlineRulePublishInput = { ...identity, operation: 'PUBLISH', previewFingerprint: preview.previewFingerprint };
    setActionError(null);
    try {
      const published = await publish.mutateAsync({ id: selected.id, input });
      await syncAuthoritativeRule(published);
      setPreview(null);
      setEditing(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to publish the deadline rule. The preview may be stale.');
      setPreview(null);
    }
  };

  const handleArchive = async () => {
    if (!selected || !archivePreview || archiveReason.trim().length < 10) return;
    const identity = ruleDraftIdentity(selected, 'ARCHIVE');
    const input: DeadlineRuleArchiveInput = { ...identity, operation: 'ARCHIVE', previewFingerprint: archivePreview.previewFingerprint, reason: archiveReason.trim() };
    setActionError(null);
    try {
      const archived = await archive.mutateAsync({ id: selected.id, input });
      await syncAuthoritativeRule(archived);
      setArchiveDialogOpen(false);
      setArchiveReason('');
      setArchivePreview(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to archive the deadline rule. The preview may be stale.');
      setArchivePreview(null);
    }
  };

  const confirmArchiveImpact = () => {
    if (!archivePreview) return;
    setArchiveImpactOpen(false);
    setArchiveDialogOpen(true);
  };

  const clearArchiveFlow = () => {
    if (archive.isPending) return;
    setArchiveDialogOpen(false);
    setArchiveImpactOpen(false);
    setArchiveReason('');
    setArchivePreview(null);
  };

  if (!featureEnabled) {
    return <section aria-labelledby="deadline-rules-heading" className="card p-4"><h2 id="deadline-rules-heading" className="text-lg font-semibold text-text-primary">Deadline rules</h2><p className="mt-1 text-sm text-text-secondary">Deadline rule administration is not enabled for this workspace.</p></section>;
  }

  if (!canAdminister) {
    return <section aria-labelledby="deadline-rules-heading" className="card p-4"><h2 id="deadline-rules-heading" className="text-lg font-semibold text-text-primary">Deadline rules</h2><p className="mt-1 text-sm text-text-secondary">Tenant Admin access is required to manage deadline rules.</p></section>;
  }

  if (!workspaceId) {
    return <section aria-labelledby="deadline-rules-heading" className="card p-4"><h2 id="deadline-rules-heading" className="text-lg font-semibold text-text-primary">Deadline rules</h2><p className="mt-1 text-sm text-text-secondary">Select a workspace to administer deadline rules.</p></section>;
  }

  if (creating) {
    return (
      <section aria-labelledby="deadline-rules-heading">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="deadline-rules-heading" className="text-lg font-semibold text-text-primary">Deadline rules</h2>
            <p className="mt-1 text-sm text-text-secondary">Create a versioned rule set for any service family.</p>
          </div>
        </div>
        <div className="rounded-lg border border-border-primary bg-background-secondary">
          <DeadlineRuleForm
            onCancel={() => { setCreating(false); setDraftDirty(false); }}
            onSubmit={handleDraftSubmit}
            onDirtyChange={() => { setDraftDirty(true); setPreview(null); setArchivePreview(null); }}
            isSubmitting={create.isPending}
          />
        </div>
      </section>
    );
  }

  const selectedStatus = selected ? ruleStatus(selected) : null;
  const selectedVersion = selected?.draft ?? selected?.currentVersion ?? null;
  const selectedMilestones = selectedVersion?.milestones ?? [];

  return (
    <section aria-labelledby="deadline-rules-heading">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="deadline-rules-heading" className="text-lg font-semibold text-text-primary">Deadline rules</h2>
          <p className="mt-1 text-sm text-text-secondary">Define who each rule applies to, how deadlines are calculated, and preview the future impact before publishing.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_GROUPS.map((group) => (
            <Dropdown key={group.authority}>
              <DropdownTrigger className="min-h-11 sm:min-h-8">
                {applyPreset.isPending && applyPreset.variables && PRESET_AUTHORITY[applyPreset.variables.code] === group.authority
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : null}
                Add {group.authority} rule
              </DropdownTrigger>
              <DropdownMenu align="right">
                {group.presets.map((preset) => (
                  <DropdownItem key={preset.code} disabled={applyPreset.isPending} onClick={() => void handleApplyPreset(preset.code)}>{preset.label}</DropdownItem>
                ))}
              </DropdownMenu>
            </Dropdown>
          ))}
          <Button type="button" size="sm" className="min-h-11 sm:min-h-8" leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setCreating(true); setDraftDirty(false); setPreview(null); }}>
            Add deadline rule
          </Button>
        </div>
      </div>

      {actionError ? <Alert variant="error" title="Action failed" onClose={() => setActionError(null)}>{actionError}</Alert> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-lg border border-border-primary bg-background-secondary" aria-label="Deadline rule list">
          <div className="grid gap-3 border-b border-border-primary p-3">
            <FormInput aria-label="Search deadline rules" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search rule name or code" leftIcon={<Search className="h-4 w-4" />} className="input input-sm min-h-11 sm:min-h-8" />
            <label className="text-xs font-medium text-text-secondary">
              Status
              <select aria-label="Deadline rule status" className="input input-sm mt-1.5 min-h-11 w-full sm:min-h-8" value={status} onChange={(event) => { setStatus(event.target.value as StatusFilter); setPage(1); }}>
                <option value="all">All rules</option>
                <option value="active">Active</option>
                <option value="inactive">Archived</option>
              </select>
            </label>
          </div>

          {list.isLoading ? (
            <div role="status" className="flex items-center gap-2 p-4 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading deadline rules…</div>
          ) : list.error ? (
            <div className="space-y-2 p-4 text-sm">
              <p className="font-medium text-status-error">Unable to load deadline rules.</p>
              <p className="text-text-muted">{list.error instanceof Error ? list.error.message : 'Try again shortly.'}</p>
              <Button type="button" variant="secondary" className="min-h-11 sm:min-h-8" onClick={() => void list.refetch()}>Retry</Button>
            </div>
          ) : list.data?.rules.length ? (
            <div className="divide-y divide-border-secondary">
              {list.data.rules.map((rule) => {
                const statusMeta = ruleStatus(rule);
                const version = rule.draft ?? rule.currentVersion;
                return (
                  <button
                    key={rule.id}
                    type="button"
                    className={'relative flex min-h-[68px] w-full flex-col items-start gap-1 px-3 py-3 text-left transition-colors hover:bg-background-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oak-primary/30 ' + (rule.id === activeId ? 'bg-background-tertiary pl-4 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-oak-primary' : '')}
                    aria-pressed={rule.id === activeId}
                    onClick={() => {
                      setSelectedId(rule.id);
                      setSelectedOverride(null);
                      setEditing(false);
                      setDraftDirty(false);
                      setPreview(null);
                      setArchivePreview(null);
                      setArchiveImpactOpen(false);
                    }}
                  >
                    <span className="flex w-full items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium text-text-primary">{rule.name}</span>
                      <span className={statusMeta.className + ' shrink-0'}>{statusMeta.label}</span>
                    </span>
                    <span className="text-xs text-text-muted">{rule.code} · {describeRuleRecurrence(version?.recurrence)}</span>
                    <span className="line-clamp-1 text-[11px] text-text-muted">{primaryDeadlineSummary(rule)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-5 text-center">
              <p className="text-sm font-medium text-text-primary">No deadline rules found</p>
              <p className="mt-1 text-xs text-text-muted">Create a rule or adjust the filters.</p>
            </div>
          )}

          {!list.isLoading && !list.error ? (
            <div className="border-t border-border-primary p-2">
              <Pagination page={list.data?.page ?? page} totalPages={Math.max(1, Math.ceil((list.data?.total ?? 0) / (list.data?.limit ?? 20)))} total={list.data?.total ?? 0} limit={list.data?.limit ?? 20} onPageChange={setPage} showPageSize={false} showJumpToPage={false} largeTouchTargets />
            </div>
          ) : null}
        </aside>

        <div className="min-w-0 overflow-hidden rounded-lg border border-border-primary bg-background-secondary">
          {detail.isLoading && activeId ? (
            <div role="status" className="flex items-center gap-2 p-4 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading rule detail…</div>
          ) : detail.error ? (
            <div className="space-y-2 p-4">
              <p className="font-medium text-status-error">Unable to load rule detail.</p>
              <Button type="button" variant="secondary" className="min-h-11 sm:min-h-8" onClick={() => void detail.refetch()}>Retry</Button>
            </div>
          ) : selected ? (
            <>
              <div className="border-b border-border-primary px-4 py-4 sm:px-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-text-primary">{selected.name}</h3>
                      {selectedStatus ? <span className={selectedStatus.className}>{selectedStatus.label}</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-text-muted">{selected.code} · {describeRuleRecurrence(selectedVersion?.recurrence)}</p>
                    <p className="mt-2 max-w-3xl text-sm text-text-secondary">{selected.description || primaryDeadlineSummary(selected)}</p>
                    <p className="mt-2 text-xs text-text-muted">
                      {selected.currentVersion ? 'Published v' + selected.currentVersion.version + ' · ' + formatDate(selected.currentVersion.publishedAt) : 'Not yet published'}
                      {selected.draft ? ' · Draft revision ' + selected.draft.draftRevision : ''}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {!editing ? <Button type="button" variant="secondary" size="xs" className="min-h-11 sm:min-h-8" aria-label={'Edit ' + selected.name} onClick={() => { setEditing(true); setDraftDirty(false); setPreview(null); setArchivePreview(null); }}>Edit</Button> : null}
                    <Button type="button" variant="ghost" size="xs" className="min-h-11 sm:min-h-8" onClick={() => void handlePreview('PUBLISH')} disabled={previewMutation.isPending || draftDirty}>Preview impact</Button>
                    <Dropdown>
                      <DropdownTrigger aria-label="More rule actions" className="min-h-11 sm:min-h-8"><MoreHorizontal className="h-4 w-4" /></DropdownTrigger>
                      <DropdownMenu align="right">
                        <DropdownItem icon={<History className="h-4 w-4" />} onClick={() => document.getElementById('deadline-rule-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>View revision history</DropdownItem>
                        <DropdownItem destructive icon={<Archive className="h-4 w-4" />} disabled={!selected.isActive || draftDirty} onClick={() => { if (archivePreview) setArchiveImpactOpen(true); else void handlePreview('ARCHIVE'); }}>Archive rule</DropdownItem>
                      </DropdownMenu>
                    </Dropdown>
                  </div>
                </div>

                {selected.draft && selected.currentVersion ? (
                  <div className="mt-4 rounded-md border border-status-warning/30 bg-status-warning/5 px-3 py-2.5 text-xs text-text-secondary">
                    You are working with a draft. Published v{selected.currentVersion.version} continues to drive live deadlines until this draft is published.
                  </div>
                ) : null}
              </div>

              {editing ? (
                <>
                  <DeadlineRuleForm initialValue={selected} onCancel={() => { setEditing(false); setDraftDirty(false); }} onSubmit={handleDraftSubmit} onDirtyChange={() => { setDraftDirty(true); setPreview(null); setArchivePreview(null); setArchiveImpactOpen(false); }} isSubmitting={update.isPending} />
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-primary px-4 py-3 sm:px-5">
                    <p className="text-xs text-text-muted">{draftDirty ? 'Save the draft before previewing its impact.' : preview ? 'Impact preview is current.' : 'Preview impact before publishing.'}</p>
                    <Button type="button" className="min-h-11 sm:min-h-8" onClick={handlePublish} disabled={draftDirty || !preview || preview.operation !== 'PUBLISH' || publish.isPending} isLoading={publish.isPending}>Publish changes</Button>
                  </div>
                </>
              ) : (
                <div className="w-full max-w-[1040px] px-4 sm:px-5">
                  <section className="grid grid-cols-1 gap-x-8 gap-y-5 py-5 sm:grid-cols-2" aria-label="Rule summary">
                    <div><p className="text-xs font-medium text-text-muted">Recurrence</p><p className="mt-1 text-sm text-text-primary">{describeRuleRecurrence(selectedVersion?.recurrence)}</p></div>
                    <div><p className="text-xs font-medium text-text-muted">Applies to</p><p className="mt-1 text-sm text-text-primary">{applicabilitySummary(selectedVersion?.applicability)}</p></div>
                    <div><p className="text-xs font-medium text-text-muted">Rule variables</p><p className="mt-1 text-sm text-text-primary">{selectedVersion?.parameters.length ?? 0} configured</p></div>
                    <div><p className="text-xs font-medium text-text-muted">Deadlines</p><p className="mt-1 text-sm text-text-primary">{selectedMilestones.length} configured</p></div>
                  </section>

                  <section className="border-t border-border-secondary py-5" aria-labelledby="configured-deadlines-heading">
                    <div className="mb-3"><h4 id="configured-deadlines-heading" className="text-base font-semibold text-text-primary">Configured deadlines</h4><p className="mt-1 text-xs text-text-muted">Human-readable calculations for this rule version.</p></div>
                    {selectedMilestones.length === 0 ? <p className="text-sm text-text-muted">No deadlines configured.</p> : (
                      <div className="overflow-hidden rounded-md border border-border-primary">
                        {selectedMilestones.map((milestone) => (
                          <div key={milestone.id} className="flex flex-col gap-1 border-b border-border-secondary px-3 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-text-primary">{milestone.name}</p><span className="badge badge-neutral">{milestone.type.toLowerCase()}</span></div>
                              <p className="mt-1 text-xs text-text-secondary">Due date = {describeDeadlineExpression(milestone.expression)}</p>
                            </div>
                            <p className="shrink-0 text-xs text-text-muted">{describeBusinessDayAdjustment(milestone.businessDayAdjustment)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section id="deadline-rule-history" className="border-t border-border-secondary py-5" aria-labelledby="rule-history-heading">
                    <div className="mb-3 flex items-center gap-2"><History className="h-4 w-4 text-text-muted" /><h4 id="rule-history-heading" className="text-base font-semibold text-text-primary">Revision history</h4></div>
                    {selected.versions.filter((version) => version.state === 'PUBLISHED').length === 0 ? <p className="text-sm text-text-muted">No published versions yet.</p> : (
                      <ol className="divide-y divide-border-secondary rounded-md border border-border-primary">
                        {selected.versions.filter((version) => version.state === 'PUBLISHED').map((version) => <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"><span className="text-text-primary">Published version {version.version}</span><span className="text-xs text-text-muted">{formatDate(version.publishedAt)}</span></li>)}
                      </ol>
                    )}
                  </section>

                  <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border-secondary py-4">
                    <Button type="button" className="min-h-11 sm:min-h-8" onClick={handlePublish} disabled={draftDirty || !preview || preview.operation !== 'PUBLISH' || publish.isPending} isLoading={publish.isPending}>Publish changes</Button>
                  </div>
                </div>
              )}
            </>
          ) : <div className="p-8 text-center text-sm text-text-muted">Select a deadline rule to inspect its configuration.</div>}
        </div>
      </div>

      <RuleImpactDialog impact={preview} onClose={() => setPreview(null)} onConfirm={() => void handlePublish()} confirmLabel="Publish changes" isConfirming={publish.isPending} />
      <RuleImpactDialog impact={archiveImpactOpen ? archivePreview : null} onClose={clearArchiveFlow} onConfirm={confirmArchiveImpact} confirmLabel="Continue to archive" />
      <Modal isOpen={archiveDialogOpen} onClose={clearArchiveFlow} title="Archive deadline rule" description="Archiving preserves history and cancels only eligible future open occurrences.">
        <div className="space-y-4 p-4">
          <FormInput label="Archive reason" value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} hint="At least 10 characters are required for the audit trail." disabled={archive.isPending} className="input input-sm min-h-11 sm:min-h-8" />
          <p className="text-xs text-text-muted">Current archive impact fingerprint: {archivePreview?.previewFingerprint.slice(0, 12)}…</p>
          <div className="flex justify-end gap-3"><Button type="button" variant="secondary" className="min-h-11 sm:min-h-8" onClick={clearArchiveFlow} disabled={archive.isPending}>Cancel</Button><Button type="button" variant="danger" className="min-h-11 sm:min-h-8" onClick={() => void handleArchive()} disabled={archiveReason.trim().length < 10 || !archivePreview} isLoading={archive.isPending}>Archive rule</Button></div>
        </div>
      </Modal>
    </section>
  );
}
