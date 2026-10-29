'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ArtifactView, humanize } from '@/components/ui/structured-data-view';
import type { BusinessAssistantRunDto } from '@/lib/validations/business-assistant';

const ATTENTION_KEYS = new Set([
  'warning',
  'warnings',
  'error',
  'errors',
  'blocker',
  'blockers',
  'failed',
  'failure',
  'failures',
  'outcomeunknown',
  'needsattention',
  'needsreview',
  'partial',
  'partialsuccess',
  'partiallycomplete',
  'incomplete',
  'recovery',
  'recovering',
]);

function normalizedKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function humanizeIdentifier(value: string): string {
  return humanize(value.replace(/[.:/]+/g, '_'));
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null || value === false || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

/**
 * Read outputs are module-owned. Fail closed when a structured output exposes
 * an attention-shaped field so a future capability cannot accidentally hide
 * a warning behind the compact success treatment.
 */
function hasAttentionSignal(value: unknown, depth = 0): boolean {
  if (depth > 8 || value == null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => hasAttentionSignal(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => {
    if (ATTENTION_KEYS.has(normalizedKey(key)) && hasMeaningfulValue(item)) return true;
    return hasAttentionSignal(item, depth + 1);
  });
}

/**
 * A compact result is intentionally narrower than "anything that looks like a
 * read". Every authoritative run/item dimension must prove an ordinary,
 * completed read with no write receipt, approval, review, recovery or visible
 * attention signal. Unknown/future states therefore keep the full run card.
 */
export function isCompactReadRun(run: BusinessAssistantRunDto): boolean {
  if (run.status !== 'COMPLETED' || run.aggregate.status !== 'COMPLETED' || !run.completedAt) return false;
  if (run.proposal != null || run.allowedActions.length > 0 || run.cancellationRequestedAt) return false;
  if (run.items.length === 0) return false;

  return run.items.every((item) => (
    item.lifecycleState === 'SUCCEEDED'
    && item.executionOutcome === 'SUCCEEDED_READ'
    && item.reviewOutcome === 'NOT_REQUIRED'
    && item.requiredEffectStatus === 'NOT_REQUIRED'
    && !item.dispositionReason
    && !item.operationId
    && item.receipt == null
    && (item.reviews?.length ?? 0) === 0
    && !hasAttentionSignal(item.output)
  ));
}

export function AssistantReadResultDetails({ run }: { run: BusinessAssistantRunDto }) {
  const [expanded, setExpanded] = useState(false);
  const generatedId = useId();
  const regionId = `assistant-read-details-${generatedId}`;
  const buttonId = `assistant-read-details-button-${generatedId}`;
  const capabilityLabel = humanizeIdentifier(run.capabilityId.split('.').pop() ?? run.capabilityId);
  const resultLabel = run.items.length === 1 ? '1 read result' : `${run.items.length} read results`;

  return <section aria-label={`${capabilityLabel} read details`} className="rounded-lg border border-border-primary bg-background-secondary/30">
    <button
      id={buttonId}
      type="button"
      aria-expanded={expanded}
      aria-controls={regionId}
      onClick={() => setExpanded((current) => !current)}
      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-background-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30 focus-visible:ring-offset-1"
    >
      <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      <span className="font-medium text-text-primary">Sources and details</span>
      <span className="ml-auto text-text-muted">{resultLabel}</span>
    </button>

    {expanded && <div id={regionId} role="region" aria-labelledby={buttonId} className="space-y-4 border-t border-border-primary p-3 text-xs">
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div><dt className="text-text-muted">Capability</dt><dd>{capabilityLabel} · v{run.capabilityVersion}</dd></div>
        <div><dt className="text-text-muted">Type</dt><dd>Read-only</dd></div>
        <div><dt className="text-text-muted">Status</dt><dd>Completed</dd></div>
      </dl>

      {run.resources.length > 0 && <section aria-label="Records used by this read">
        <h4 className="mb-2 font-medium text-text-primary">Records used</h4>
        <ul className="space-y-1">
          {run.resources.map((resource, index) => <li key={`${resource.resourceType}:${resource.resourceId}:${resource.role}:${index}`} className="break-all text-text-secondary">
            {humanizeIdentifier(resource.role)} · {humanizeIdentifier(resource.resourceType)} · {resource.resourceId}
          </li>)}
        </ul>
      </section>}

      <div className="space-y-3">
        {run.items.map((item, index) => <section key={item.id} aria-label={`Read result ${index + 1}`} className={run.items.length > 1 ? 'rounded-lg border border-border-primary p-3' : undefined}>
          {run.items.length > 1 && <h4 className="mb-2 break-words font-medium text-text-primary">{humanizeIdentifier(item.itemKey)}</h4>}
          <ArtifactView value={item.output} />
        </section>)}
      </div>
    </div>}
  </section>;
}
