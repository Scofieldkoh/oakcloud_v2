'use client';

import { useMemo } from 'react';
import { Alert } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import {
  useAllTemplatePartials,
  type TemplatePartialSummary,
} from '@/hooks/use-template-partials';

interface OakDocPartialPanelProps {
  tenantId?: string;
  /** Partial IDs the open document references, in document order. */
  referencedIds: string[];
  disabled: boolean;
  onInsert: (partial: TemplatePartialSummary) => void;
  /** Versions the saved template pins, by partial ID. */
  pinnedVersions?: Readonly<Record<string, number>>;
  /** Whether the next save moves every partial to its latest version. */
  refreshLatest?: boolean;
  onRefreshLatestChange?: (value: boolean) => void;
}

/**
 * Word partials that can be inserted into an OakDoc template, with the ones
 * the template already uses marked and missing references called out.
 */
export function OakDocPartialPanel({
  tenantId,
  referencedIds,
  disabled,
  onInsert,
  pinnedVersions = {},
  refreshLatest = false,
  onRefreshLatestChange,
}: OakDocPartialPanelProps) {
  const { data, isLoading, error } = useAllTemplatePartials(tenantId, Boolean(tenantId));
  const wordPartials = useMemo(
    () => (data?.partials ?? []).filter((partial) => partial.documentEngine === 'OAKDOC'),
    [data],
  );
  const known = useMemo(() => new Set(wordPartials.map((partial) => partial.id)), [wordPartials]);
  const missing = data ? referencedIds.filter((id) => !known.has(id)) : [];
  const outdated = wordPartials.filter((partial) => (
    referencedIds.includes(partial.id)
    && pinnedVersions[partial.id] !== undefined
    && pinnedVersions[partial.id] < partial.version
  ));

  return (
    <section className="space-y-3">
      <div>
        <div className="flex items-end justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Partials
          </h2>
          <span className="text-[11px] text-text-muted">
            {referencedIds.length} in document
          </span>
        </div>
        <p className="mt-1 text-xs text-text-secondary">
          Put the caret in a paragraph to insert a reusable Word partial after it. The template keeps the partial version it was saved with.
        </p>
      </div>

      {isLoading ? (
        <p className="text-xs text-text-muted">Loading partials…</p>
      ) : error ? (
        <p className="text-xs text-status-error">Could not load partials.</p>
      ) : wordPartials.length === 0 ? (
        <p className="text-xs text-text-muted">No Word partials in this workspace yet.</p>
      ) : (
        <div className="space-y-1">
          {wordPartials.map((partial) => {
            const used = referencedIds.includes(partial.id);
            return (
              <button
                key={partial.id}
                type="button"
                disabled={disabled}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onInsert(partial)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-oak-primary/5 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-text-primary">
                    {partial.displayName || partial.name}
                  </span>
                  <span className="block truncate text-[10px] text-text-muted">
                    {partial.name} · v{partial.version}
                    {pinnedVersions[partial.id] !== undefined && pinnedVersions[partial.id] < partial.version
                      ? ` (this template uses v${pinnedVersions[partial.id]})`
                      : ''}
                  </span>
                </span>
                {used ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-oak-primary" title="Used in this document" />
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {outdated.length > 0 && onRefreshLatestChange ? (
        <Checkbox
          size="sm"
          checked={refreshLatest}
          disabled={disabled}
          onChange={(event) => onRefreshLatestChange(event.target.checked)}
          label="Use the latest partial versions when I save"
          description={`${outdated.length === 1 ? 'One partial has' : `${outdated.length} partials have`} a newer version. Documents already generated don't change.`}
        />
      ) : null}

      {missing.length > 0 ? (
        <Alert variant="warning" compact>
          {missing.length === 1
            ? 'One partial in this document no longer exists.'
            : `${missing.length} partials in this document no longer exist.`}
          {' '}Saving will fail until the reference is removed.
        </Alert>
      ) : null}
    </section>
  );
}
