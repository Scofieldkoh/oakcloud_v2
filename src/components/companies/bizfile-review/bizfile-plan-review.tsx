'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ArtifactView, humanize } from '@/components/ui/structured-data-view';
import type { BizFileChange, BizFileChangePlan } from '@/services/bizfile/change-plan';

export interface BizFilePlanReviewProps {
  plan: BizFileChangePlan;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onRevise: (selectedChangeIds: string[]) => void;
  onApprove: () => void;
}

/** Shared exact-plan review for the existing company upload/update flow. A local
 * selection never changes the approved payload: it must be prepared again. */
export function BizFilePlanReview({ plan, busy, error, onClose, onRevise, onApprove }: BizFilePlanReviewProps) {
  const [selected, setSelected] = useState(plan.selectedChangeIds);
  const [acknowledged, setAcknowledged] = useState(false);
  const dirty = [...selected].sort().join('|') !== [...plan.selectedChangeIds].sort().join('|');
  const groups = useMemo(() => {
    const grouped = new Map<string, BizFileChange[]>();
    for (const change of plan.changes) grouped.set(change.section, [...(grouped.get(change.section) ?? []), change]);
    return [...grouped];
  }, [plan.changes]);
  return <Modal isOpen onClose={onClose} title={plan.mode === 'CREATE' ? 'Review company creation' : 'Review company changes'} size="5xl"
    showCloseButton={!busy} closeOnEscape={!busy} closeOnOverlayClick={false}>
    <div className="space-y-4 p-4 text-sm sm:p-6">
      <p className="text-text-secondary">Your manually reviewed information is ready to save. Check the changes below, then confirm to save them. Unselected changes will not be applied.</p>
      <p className="font-medium">{plan.reviewedData.entityDetails.name} · {plan.reviewedData.entityDetails.uen}</p>
      {plan.changes.length === 0 && <p className="rounded-lg bg-background-secondary p-3">The company data is unchanged. Approval will record the reviewed document.</p>}
      <div className="max-h-[55dvh] space-y-4 overflow-y-auto pr-1">
        {groups.map(([section, changes]) => <section key={section} aria-label={humanize(section)} className="rounded-lg border border-border-primary">
          <h3 className="border-b border-border-primary bg-background-secondary px-3 py-2 font-medium">{humanize(section)}</h3>
          <div className="divide-y divide-border-primary">{changes.map((change) => <div key={change.id} className="p-3">
            <label className="flex items-start gap-2 font-medium"><input type="checkbox" checked={selected.includes(change.id)} disabled={busy}
              className="mt-1 h-4 w-4 accent-oak-primary" onChange={(event) => {
                setAcknowledged(false); setSelected((ids) => event.target.checked ? [...ids, change.id] : ids.filter((id) => id !== change.id));
              }} />{humanize(change.path)} <span className="ml-auto text-xs font-normal text-text-secondary">{humanize(change.operation)}</span></label>
            <div className="mt-3 grid gap-3 pl-6 md:grid-cols-2"><div className="min-w-0 rounded-lg bg-background-secondary p-3"><p className="mb-2 text-xs text-text-muted">Before</p><ArtifactView value={change.before} /></div>
              <div className="min-w-0 rounded-lg bg-oak-primary/5 p-3"><p className="mb-2 text-xs text-text-muted">After</p><ArtifactView value={change.after} /></div></div>
          </div>)}</div>
        </section>)}
      </div>
      {Object.keys(plan.contactDecisions).length > 0 && <details><summary className="cursor-pointer font-medium">Contact decisions included</summary><div className="mt-3"><ArtifactView value={plan.contactDecisions} /></div></details>}
      {error && <p role="alert" className="text-status-error">{error}</p>}
      <div className="space-y-3 border-t border-border-primary pt-4">
        {dirty ? <div className="flex flex-wrap items-center gap-3"><Button onClick={() => onRevise(selected)} isLoading={busy}>Update proposal</Button>
          <p className="text-xs text-text-secondary">Your selection must be checked before approval.</p></div>
          : <><label className="flex items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4 accent-oak-primary" checked={acknowledged} disabled={busy}
            onChange={(event) => setAcknowledged(event.target.checked)} />I have reviewed these changes and contact decisions.</label>
            <Button onClick={onApprove} isLoading={busy} disabled={!acknowledged}>{plan.mode === 'CREATE' ? 'Confirm & Save Company' : plan.selectedChangeIds.length === 0 ? 'Confirm & Save Document' : `Confirm & Save ${plan.selectedChangeIds.length} ${plan.selectedChangeIds.length === 1 ? 'Change' : 'Changes'}`}</Button></>}
        <Button variant="ghost" onClick={onClose} disabled={busy}>Back to review</Button>
      </div>
    </div>
  </Modal>;
}
