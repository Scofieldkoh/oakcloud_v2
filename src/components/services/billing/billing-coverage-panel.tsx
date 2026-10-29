'use client';

import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useBillingCoverage } from '@/hooks/use-billing-coverage';
import type { BillingCoverageSummary } from '@/services/billing';
import { cn } from '@/lib/utils';

interface BillingCoveragePanelProps {
  companyIds?: readonly string[];
  data?: BillingCoverageSummary;
  onConfigure?: (issue: BillingCoverageSummary['issues'][number]) => void;
}

function issueTitle(type: BillingCoverageSummary['issues'][number]['type']): string {
  switch (type) {
    case 'MISSING_DISPOSITION': return 'Missing billing disposition';
    case 'MISSING_FEE_LINES': return 'No active fee lines';
    case 'MISSING_START_DATE': return 'Missing billing start';
    case 'INVALID_CUSTOM_SCHEDULE': return 'Invalid custom schedule';
    case 'MISSING_SCHEDULE_PARAMETER': return 'Missing schedule parameter';
    case 'OCCURRENCE_GAP': return '12-month occurrence gap';
    case 'INVALID_AMOUNT_OR_CURRENCY': return 'Invalid amount or currency';
    default: return 'Billing configuration issue';
  }
}

function pluralizeIssues(count: number): string {
  return `${count} ${count === 1 ? 'issue' : 'issues'}`;
}

export function BillingCoveragePanel({ companyIds, data: providedData, onConfigure }: BillingCoveragePanelProps) {
  const coverage = useBillingCoverage({ companyIds });
  const data = providedData ?? coverage.data;
  const [expanded, setExpanded] = useState(false);

  if (coverage.isLoading && !data) {
    return <div role="status" className="rounded-xl border border-border-primary bg-background-secondary p-4 text-sm text-text-secondary">Loading billing reconciliation…</div>;
  }

  if (coverage.error && !data) {
    return <div role="alert" className="rounded-xl border border-status-warning/40 bg-status-warning/5 p-4 text-sm text-status-warning">Billing reconciliation is temporarily unavailable.</div>;
  }

  const openIssueCount = data?.openIssueCount ?? 0;
  const issues = data?.issues ?? [];
  const errorCount = issues.filter((issue) => issue.severity === 'ERROR').length;
  const warningCount = issues.filter((issue) => issue.severity === 'WARNING').length;
  const severitySummary = [
    errorCount > 0 ? `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}` : '',
    warningCount > 0 ? `${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}` : '',
  ].filter(Boolean).join(' · ');
  if (openIssueCount === 0) {
    const healthyCount = data?.healthyActiveServiceCount ?? 0;
    return (
      <section aria-label="Billing reconciliation" className="rounded-xl border border-status-success/30 bg-status-success/5 px-4 py-3">
        <div className="flex items-center gap-3 text-sm text-status-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{healthyCount} active services have complete billing configuration</span>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Billing reconciliation" className="overflow-hidden rounded-xl border border-status-warning/40 bg-status-warning/5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-12 w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm text-status-warning outline-none transition-colors hover:bg-status-warning/10 focus-visible:ring-2 focus-visible:ring-oak-primary/30 focus-visible:ring-inset"
      >
          <span className="flex min-w-0 items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Billing reconciliation · {pluralizeIssues(openIssueCount)}{severitySummary ? ` · ${severitySummary}` : ''}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs font-medium">
          {data?.affectedServiceCount ? `${data.affectedServiceCount} services need attention` : 'Needs attention'}
          {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </span>
      </button>

      {expanded ? (
        <div className="grid gap-3 border-t border-status-warning/30 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...issues.reduce((groups, issue) => {
            const key = `${issue.company.id}:${issue.service.id}`;
            const existing = groups.get(key);
            if (existing) existing.issues.push(issue);
            else groups.set(key, { label: `${issue.company.displayLabel} · ${issue.service.name}`, issues: [issue] });
            return groups;
          }, new Map<string, { label: string; issues: BillingCoverageSummary['issues'] }>()).values()].map((group) => (
            <section key={group.label} role="group" aria-label={group.label} className="space-y-2 rounded-lg border border-border-primary bg-background-secondary p-3 shadow-sm">
              <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-text-secondary">{group.label}</h3>
              {group.issues.map((issue) => {
                const issueLabel = issueTitle(issue.type);
                return (
                  <article key={issue.id} data-testid="billing-issue-card" className="rounded-lg border border-border-primary bg-background-primary p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold text-text-primary">{issueLabel}</p>
                      <span className={cn('rounded-full px-2 py-1 text-[11px] font-semibold', issue.severity === 'ERROR' ? 'bg-status-error/10 text-status-error' : 'bg-status-warning/10 text-status-warning')}>
                        {issue.severity === 'ERROR' ? 'Error' : 'Warning'}
                      </span>
                    </div>
                    {issue.message && issue.message !== issueLabel ? <p className="mt-2 text-sm text-text-secondary">{issue.message}</p> : null}
                    {onConfigure ? (
                      <button type="button" onClick={() => onConfigure(issue)} className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-oak-primary hover:text-oak-dark sm:min-h-0">
                        Configure <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    ) : (
                      <Link href={`/companies/${issue.company.id}?tab=services`} className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-oak-primary hover:text-oak-dark sm:min-h-0">
                        Configure <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    )}
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export { issueTitle as getBillingCoverageIssueTitle };
