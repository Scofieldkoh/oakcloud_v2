'use client';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import type { DeadlineRuleImpact } from '@/services/deadline-rule';

const GROUPS = [
  ['created', 'New deadlines'],
  ['recalculated', 'Date changes'],
  ['cancelled', 'Cancelled'],
  ['preserved', 'Unchanged'],
  ['inapplicable', 'Not applicable'],
  ['missingInput', 'Missing input'],
  ['conflicts', 'Conflicts'],
  ['warnings', 'Warnings'],
] as const;

export interface RuleImpactDialogProps {
  impact: DeadlineRuleImpact | null;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  isConfirming?: boolean;
}

export function RuleImpactDialog({
  impact,
  onClose,
  onConfirm,
  confirmLabel = 'Close preview',
  isConfirming = false,
}: RuleImpactDialogProps) {
  if (!impact) return null;

  const hasWarnings = impact.counts.warnings > 0 || impact.counts.missingInput > 0 || impact.counts.conflicts > 0;
  const changed = impact.counts.created + impact.counts.recalculated + impact.counts.cancelled;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={impact.operation === 'ARCHIVE' ? 'Archive impact preview' : 'Publish impact preview'}
      description={impact.operation === 'ARCHIVE'
        ? 'Review which future deadlines would be cancelled before continuing.'
        : 'Review the future deadline changes this draft would make before publishing.'}
      size="4xl"
    >
      <ModalBody>
        <div className="space-y-5">
          {hasWarnings ? (
            <Alert variant="warning" title="Review warnings">
              Missing inputs or conflicts need attention before this rule is applied. Warning rows remain visible in the audit trail.
            </Alert>
          ) : null}

          <div className="rounded-lg border border-border-primary bg-background-primary p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Impact summary</p>
            <p className="mt-1 text-lg font-semibold text-text-primary">
              {changed === 0 ? 'No future deadline changes detected' : changed + ' future deadline' + (changed === 1 ? '' : 's') + ' would change'}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {impact.counts.preserved} unchanged · {impact.counts.inapplicable} not applicable · {impact.samples.length} sample rows shown
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Impact count groups">
            {GROUPS.map(([key, label]) => (
              <div key={key} className="border-l-2 border-border-primary pl-3">
                <p className="text-xs text-text-muted">{label}</p>
                <p className="mt-1 text-lg font-semibold text-text-primary">{impact.counts[key]}</p>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-border-primary">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-primary bg-background-primary p-3">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">Affected samples</h3>
                <p className="mt-0.5 text-xs text-text-muted">Showing up to 100 examples; summary counts above cover the complete scope.</p>
              </div>
              <span className="text-xs text-text-muted">{impact.samples.length} shown</span>
            </div>
            {impact.samples.length === 0 ? (
              <p className="p-4 text-sm text-text-muted">No affected deadline samples.</p>
            ) : (
              <div className="max-h-72 overflow-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Change</th>
                      <th scope="col">Client service</th>
                      <th scope="col">Current date</th>
                      <th scope="col">Proposed date</th>
                      <th scope="col">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impact.samples.map((sample, index) => (
                      <tr key={sample.clientServiceId + '-' + (sample.deadlineOccurrenceId ?? 'new') + '-' + index}>
                        <td>{sample.action}</td>
                        <td className="font-mono text-xs">{sample.clientServiceId}</td>
                        <td>{sample.oldDate ?? '—'}</td>
                        <td>{sample.newDate ?? '—'}</td>
                        <td>{sample.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="secondary" className="min-h-[44px]" onClick={onClose} disabled={isConfirming}>Close</Button>
        {onConfirm ? <Button type="button" className="min-h-[44px]" onClick={onConfirm} isLoading={isConfirming}>{confirmLabel}</Button> : null}
      </ModalFooter>
    </Modal>
  );
}
