'use client';

import { useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ArtifactView, humanize } from '@/components/ui/structured-data-view';
import { useAssistantAction, useAssistantRun } from '@/hooks/use-business-assistant';
import type { BusinessAssistantAction, BusinessAssistantRunDto } from '@/lib/validations/business-assistant';
import { BizFileCorrectionPanel } from './correction-panel';
import { AssistantReadResultDetails, isCompactReadRun } from './read-result-details';

const presentationSchema = z.object({ sections: z.array(z.object({ id: z.string(), title: z.string(), kind: z.string(), value: z.unknown() })) });
const proposalEvidenceSchema = z.object({ presentation: presentationSchema.nullable().optional(), preparedArtifact: z.unknown().optional() });
const changeSelectionSchema = z.object({ itemId: z.string(), selectedChangeIds: z.array(z.string()),
  changes: z.array(z.object({ id: z.string(), path: z.string(), before: z.unknown(), after: z.unknown() })) });

export function AssistantRunCard({ workspaceId, runId }: { workspaceId: string; runId: string }) {
  const query = useAssistantRun(workspaceId, runId);
  if (query.error) return <div role="alert" className="rounded-lg border border-border-primary p-4 text-sm">
    <p>{query.error.message}</p><Button variant="secondary" onClick={() => query.refetch()}>Reload operation</Button>
  </div>;
  if (!query.data) return <p role="status" className="p-4 text-sm text-text-secondary">Loading operation…</p>;
  if (isCompactReadRun(query.data)) return <AssistantReadResultDetails run={query.data} />;
  return <RunDetails key={`${query.data.id}:${query.data.proposal?.revision ?? 0}`} workspaceId={workspaceId} run={query.data} />;
}

function RunDetails({ workspaceId, run }: { workspaceId: string; run: BusinessAssistantRunDto }) {
  const action = useAssistantAction(workspaceId, run.id);
  const proposal = run.proposal;
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [dirtySections, setDirtySections] = useState<Record<string, boolean>>({});
  const hasUnpreparedChanges = Object.values(dirtySections).some(Boolean);
  const ids = useRef(new Map<string, string>());
  const evidence = proposalEvidenceSchema.safeParse(proposal);
  const presentation = evidence.success ? evidence.data.presentation : undefined;
  const artifact = evidence.success ? evidence.data.preparedArtifact : undefined;
  const hasEvidence = !!presentation?.sections.length || artifact != null;
  const expired = proposal ? new Date(proposal.expiresAt).getTime() <= Date.now() : true;
  function submit(body: Omit<Extract<BusinessAssistantAction, {action:'CONFIRM'}>, 'clientRequestId'> |
    Omit<Extract<BusinessAssistantAction, {action:'REVISE'}>, 'clientRequestId'> |
    Omit<Extract<BusinessAssistantAction, {action:'CANCEL'}>, 'clientRequestId'> |
    Omit<Extract<BusinessAssistantAction, {action:'RETRY'}>, 'clientRequestId'>) {
    const key = JSON.stringify(body);
    const clientRequestId = ids.current.get(key) ?? crypto.randomUUID();
    ids.current.set(key, clientRequestId);
    action.mutate({ ...body, clientRequestId } as BusinessAssistantAction);
  }
  return <section aria-label="Business operation" className="overflow-hidden rounded-xl border border-border-primary bg-background-primary">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-primary p-4">
      <div><h3 className="font-semibold text-sm">{humanize(run.capabilityId.split('.').pop() ?? 'Operation')}</h3>
        <p className="mt-1 text-xs text-text-secondary" role="status">{humanize(run.aggregate.status)}</p></div>
      <span className="rounded-full bg-background-tertiary px-2.5 py-1 text-xs">{run.items.length} {run.items.length === 1 ? 'item' : 'items'}</span>
    </header>
    <div className="space-y-4 p-4 text-sm">
      {run.resources.length > 0 && <details><summary className="cursor-pointer text-text-secondary">Source and target records</summary>
        <ul className="mt-2 space-y-1">{run.resources.map((resource, i) => <li key={`${resource.resourceType}:${resource.resourceId}:${i}`} className="break-all text-xs">
          {humanize(resource.role)} · {humanize(resource.resourceType)} · {resource.resourceId}
        </li>)}</ul></details>}
      {proposal && <div className="space-y-3">
        <p className="text-xs text-text-secondary">Revision {proposal.revision} · Approval expires {new Date(proposal.expiresAt).toLocaleString()}</p>
        {presentation?.sections.map((section) => <section key={section.id} className="rounded-lg border border-border-primary p-3">
          <h4 className="mb-3 font-medium">{section.title}</h4>
          {section.kind === 'CHANGES' && changeSelectionSchema.safeParse(section.value).success && run.allowedActions.includes('REVISE')
            ? <ChangeSelection key={`${proposal.id}:${section.id}`} value={changeSelectionSchema.parse(section.value)} disabled={action.isPending || expired}
                onDirtyChange={(dirty) => { setReviewed(false); setDirtySections((current) => ({ ...current, [section.id]: dirty })); }}
                onRevise={(itemId, selectedChangeIds) => submit({ action: 'REVISE', proposalId: proposal.id, revision: proposal.revision, itemId, patch: { selectedChangeIds } })} />
            : <ArtifactView value={section.value} />}
        </section>)}
        {!presentation?.sections.length && artifact !== undefined && <details className="rounded-lg border border-border-primary p-3" open>
          <summary className="cursor-pointer font-medium">Prepared changes</summary><div className="mt-3"><ArtifactView value={artifact} /></div>
        </details>}
        {!hasEvidence && proposal.status === 'ACTIVE' && <p className="text-text-secondary">The proposed changes are not available for review yet. Reload the operation before approving.</p>}
        {proposal.effectManifest != null && <details><summary className="cursor-pointer text-text-secondary">Follow-up work included in this approval</summary>
          <div className="mt-2"><ArtifactView value={proposal.effectManifest} /></div></details>}
      </div>}
      <div className="space-y-2">{run.items.map((item) => {
        const eligible = proposal?.eligibleItems.includes(item.id) ?? false;
        const correctionEligible = item.executionOutcome === 'COMMITTED'
          && ['NEEDS_REVIEW', 'PASSED', 'PASSED_WITH_WARNINGS'].includes(item.lifecycleState);
        return <article key={item.id} className="rounded-lg border border-border-primary p-3">
          <div className="flex items-start gap-3">
            {run.allowedActions.includes('CONFIRM') && <input aria-label={`Select ${item.itemKey}`} type="checkbox"
              checked={selected.includes(item.id)} disabled={!eligible || expired || action.isPending}
              className="mt-1 h-4 w-4 accent-oak-primary"
              onChange={(event) => { setReviewed(false); setSelected((prev) => event.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)); }} />}
            <div className="min-w-0 flex-1"><h4 className="font-medium break-words">{item.itemKey}</h4>
              <dl className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-3">
                <div><dt className="text-text-muted">Execution</dt><dd>{humanize(item.executionOutcome)}</dd></div>
                <div><dt className="text-text-muted">Follow-up work</dt><dd>{humanize(item.requiredEffectStatus)}</dd></div>
                <div><dt className="text-text-muted">Review</dt><dd>{humanize(item.reviewOutcome)}</dd></div>
              </dl>
              {item.dispositionReason && <p className="mt-2 text-xs">{humanize(item.dispositionReason)}</p>}
              {item.executionOutcome === 'OUTCOME_UNKNOWN' && <p className="mt-2 text-xs">The outcome is being reconciled. Do not submit a replacement operation.</p>}
              {item.output != null && <details className="mt-3"><summary className="cursor-pointer text-xs font-medium">Result and evidence</summary>
                <div className="mt-2 text-xs"><ArtifactView value={item.output} /></div></details>}
              {item.receipt != null && <details className="mt-2"><summary className="cursor-pointer text-xs text-text-secondary">Recorded operation</summary>
                <div className="mt-2 text-xs"><ArtifactView value={item.receipt} /></div></details>}
              {item.reviews?.map((review, reviewIndex) => <details key={review.id} className="mt-3 rounded-lg border border-border-primary p-3" open={review.verdict !== 'PASS'}>
                <summary className="cursor-pointer text-xs font-medium">Review {review.attemptNumber} · {humanize(review.verdict)}</summary>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div><dt className="text-text-muted">Approved changes followed</dt><dd>{humanize(review.executionConformance)}</dd></div>
                  <div><dt className="text-text-muted">Original source agreement</dt><dd>{humanize(review.sourceAlignment)}</dd></div>
                </dl>
                <div className="mt-3 space-y-3 text-xs">
                  <section><h5 className="mb-1 font-medium">Findings</h5><ArtifactView value={review.findings} /></section>
                  <section><h5 className="mb-1 font-medium">Review coverage</h5><ArtifactView value={review.coverage} /></section>
                  <details><summary className="cursor-pointer text-text-secondary">Review evidence</summary><div className="mt-2"><ArtifactView value={review.evidence} /></div></details>
                  {reviewIndex === 0 && correctionEligible && run.capabilityId === 'bizfile.import_and_review' ? <BizFileCorrectionPanel
                    workspaceId={workspaceId} runId={run.id} reviewId={review.id} findings={review.findings} /> : null}
                </div>
              </details>)}
            </div>
          </div>
          {run.allowedActions.includes('RETRY') && ['FAILED', 'NEEDS_REVIEW', 'RECOVERING'].includes(item.lifecycleState) && <Button variant="secondary" size="xs" className="mt-3"
            disabled={action.isPending || item.executionOutcome === 'OUTCOME_UNKNOWN'} onClick={() => submit({ action: 'RETRY', itemIds: [item.id],
              ...(item.executionOutcome === 'COMMITTED' ? { stage: item.requiredEffectStatus === 'FAILED' ? 'EFFECTS' : 'REVIEW' } : {}) })}>
            {item.executionOutcome === 'COMMITTED' ? 'Retry follow-up' : 'Retry item'}
          </Button>}
        </article>;
      })}</div>
      {run.allowedActions.includes('CONFIRM') && proposal && <div className="space-y-3 border-t border-border-primary pt-4">
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={!selected.length || !hasEvidence || expired || hasUnpreparedChanges} className="mt-1 h-4 w-4 accent-oak-primary"
          onChange={(event) => setReviewed(event.target.checked)} />I have reviewed the selected items and their follow-up work.</label>
        <Button disabled={!reviewed || !selected.length || !hasEvidence || expired || hasUnpreparedChanges} isLoading={action.isPending}
          onClick={() => submit({ action: 'CONFIRM', proposalId: proposal.id, revision: proposal.revision, itemIds: selected })}>
          Approve {selected.length} selected {selected.length === 1 ? 'item' : 'items'}
        </Button>
        {expired && <p role="status" className="text-xs text-text-secondary">This proposal has expired. Request a fresh proposal to continue.</p>}
      </div>}
      {run.allowedActions.includes('CANCEL') && <Button variant="ghost" disabled={action.isPending} onClick={() => submit({ action: 'CANCEL' })}>Cancel remaining work</Button>}
      {action.error && <p role="alert" className="text-sm text-status-error">{action.error.message}</p>}
    </div>
  </section>;
}

function ChangeSelection({ value, disabled, onRevise, onDirtyChange }: { value: z.infer<typeof changeSelectionSchema>; disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onRevise: (itemId: string, selectedIds: string[]) => void }) {
  const [selected, setSelected] = useState(value.selectedChangeIds);
  const changed = [...selected].sort().join('|') !== [...value.selectedChangeIds].sort().join('|');
  return <div className="space-y-3">
    {value.changes.map((change) => <div key={change.id} className="flex gap-3 rounded-lg bg-background-secondary p-3">
      <input type="checkbox" aria-label={`Include ${humanize(change.path)}`} className="mt-1 h-4 w-4 accent-oak-primary" checked={selected.includes(change.id)} disabled={disabled}
        onChange={(event) => {
          const next = event.target.checked ? [...selected, change.id] : selected.filter((id) => id !== change.id);
          setSelected(next); onDirtyChange([...next].sort().join('|') !== [...value.selectedChangeIds].sort().join('|'));
        }} />
      <div className="min-w-0 flex-1"><p className="font-medium">{humanize(change.path)}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2"><div><p className="text-xs text-text-muted">Before</p><ArtifactView value={change.before} /></div>
          <div><p className="text-xs text-text-muted">After</p><ArtifactView value={change.after} /></div></div>
      </div>
    </div>)}
    <Button variant="secondary" disabled={disabled || !changed} onClick={() => onRevise(value.itemId, selected)}>Update proposed selection</Button>
    {changed && <p className="text-xs text-text-secondary">Update the proposal to review and approve this selection.</p>}
  </div>;
}
