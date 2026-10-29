'use client';

import { Archive, Copy, Pencil, Plus, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TaskPipeline } from '@/hooks/use-task-pipelines';

export function PipelineList({ pipelines, onCreate, onEdit, onDuplicate, onArchive, duplicatingId = null }: {
  pipelines: TaskPipeline[];
  onCreate: () => void;
  onEdit: (pipeline: TaskPipeline) => void;
  onDuplicate: (pipeline: TaskPipeline) => void;
  onArchive: (pipeline: TaskPipeline) => void;
  duplicatingId?: string | null;
}) {
  return (
    <section aria-labelledby="pipelines-heading" className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 id="pipelines-heading" className="text-xl font-semibold text-text-primary sm:text-2xl">Pipelines</h1><p className="mt-1 text-sm text-text-secondary">Shared stage definitions for future tasks.</p></div>
        <Button leftIcon={<Plus />} onClick={onCreate} aria-label="Create pipeline">Create pipeline</Button>
      </div>
      {pipelines.length === 0 ? (
        <div className="card p-8 text-center sm:p-12"><Workflow className="mx-auto mb-3 h-10 w-10 text-text-muted" aria-hidden="true" /><h2 className="text-base font-semibold text-text-primary">No pipelines yet</h2><p className="mt-1 text-sm text-text-secondary">Create a reusable set of task stages to get started.</p></div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {pipelines.map((pipeline) => {
            const activeVersion = pipeline.versions[0];
            return <article key={pipeline.id} className="card flex min-w-0 flex-col gap-4 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-oak-primary/10 text-oak-primary"><Workflow className="h-4 w-4" aria-hidden="true" /></span>
                <div className="min-w-0 flex-1"><h2 className="truncate text-base font-semibold text-text-primary">{pipeline.name}</h2><p className="mt-1 line-clamp-2 min-h-10 text-sm text-text-secondary">{pipeline.description || 'No description'}</p></div>
              </div>
              <div className="flex items-center gap-3 text-xs text-text-muted"><span>{activeVersion?.stages.length ?? 0} stages</span><span className="h-3 w-px bg-border-primary" aria-hidden="true" /><span>Version {activeVersion?.version ?? 0}</span></div>
              <div className="flex flex-wrap items-center gap-2 border-t border-border-primary pt-4">
                <Button variant="secondary" size="xs" leftIcon={<Pencil />} onClick={() => onEdit(pipeline)} aria-label={`Edit ${pipeline.name}`}>Edit</Button>
                <Button variant="ghost" size="xs" leftIcon={<Copy />} isLoading={duplicatingId === pipeline.id} onClick={() => onDuplicate(pipeline)} aria-label={`Duplicate ${pipeline.name}`}>Duplicate</Button>
                <Button variant="ghost" size="xs" leftIcon={<Archive />} className="text-status-error hover:text-status-error" onClick={() => onArchive(pipeline)} aria-label={`Archive ${pipeline.name}`}>Archive</Button>
              </div>
            </article>;
          })}
        </div>
      )}
    </section>
  );
}
