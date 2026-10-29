'use client';

import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useArchiveTaskPipeline, useCreateTaskPipeline, useDuplicateTaskPipeline, useTaskPipeline, useTaskPipelines, useUpdateTaskPipeline } from '@/hooks/use-task-pipelines';
import type { TaskPipelineCreatePayload } from '@/services/tasks/types';
import { PipelineBuilder, pipelineToDraft, type TemplateOption } from './pipeline-builder';
import { PipelineList } from './pipeline-list';

function useTemplateOptions() {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  useEffect(() => { let active = true; fetch('/api/document-templates?isActive=true').then((response) => response.ok ? response.json() : []).then((result) => { const items = Array.isArray(result) ? result : result.templates ?? []; if (active) setTemplates(items.map((template: { id: string; name: string }) => ({ id: template.id, name: template.name }))); }).catch(() => undefined); return () => { active = false; }; }, []);
  return templates;
}

export function PipelinesListWorkspace({ onCreate, onEdit }: { onCreate: () => void; onEdit: (id: string) => void }) {
  const { data: pipelines = [], isLoading, error } = useTaskPipelines(); const duplicate = useDuplicateTaskPipeline(); const archive = useArchiveTaskPipeline();
  const [archiveId, setArchiveId] = useState<string | null>(null);
  if (isLoading) return <div className="p-4 sm:p-6"><div className="card flex min-h-32 items-center justify-center p-6 text-sm text-text-secondary" role="status">Loading pipelines…</div></div>;
  if (error) return <div className="p-4 sm:p-6"><Alert variant="error">{error.message}</Alert></div>;
  const selected = pipelines.find((pipeline) => pipeline.id === archiveId);
  return <div className="space-y-6 p-4 sm:p-6">
    {duplicate.error && <Alert variant="error" title="Could not duplicate pipeline" onClose={duplicate.reset}>{duplicate.error.message}</Alert>}
    <PipelineList
      pipelines={pipelines}
      onCreate={onCreate}
      onEdit={(pipeline) => onEdit(pipeline.id)}
      onDuplicate={(pipeline) => duplicate.mutate({ id: pipeline.id })}
      onArchive={(pipeline) => { archive.reset(); setArchiveId(pipeline.id); }}
      duplicatingId={duplicate.isPending ? duplicate.variables?.id ?? null : null}
    />
    <ConfirmDialog
      isOpen={Boolean(selected)}
      onClose={() => setArchiveId(null)}
      onConfirm={async (reason) => {
        if (selected && reason) {
          await archive.mutateAsync({ id: selected.id, reason });
          setArchiveId(null);
        }
      }}
      title="Archive pipeline?"
      description="Archived pipelines cannot be used for new tasks."
      confirmLabel="Archive pipeline"
      requireReason
      reasonMinLength={1}
      isLoading={archive.isPending}
    >
      {archive.error && <Alert variant="error" title="Could not archive pipeline" onClose={archive.reset} compact>{archive.error.message}</Alert>}
    </ConfirmDialog>
  </div>;
}

export function NewPipelineWorkspace({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const create = useCreateTaskPipeline(); const templates = useTemplateOptions();
  return <div className="p-4 sm:p-6">{create.error && <Alert variant="error" title="Could not create pipeline" className="mx-auto mb-6 max-w-5xl" onClose={create.reset}>{create.error.message}</Alert>}<PipelineBuilder initialDraft={{ name: '', description: '', stages: [] }} templates={templates} onCancel={onCancel} isSaving={create.isPending} onSave={async (payload) => { await create.mutateAsync(payload); onSaved(); }} /></div>;
}

export function EditPipelineWorkspace({ pipelineId, onSaved, onCancel }: { pipelineId: string; onSaved: () => void; onCancel: () => void }) {
  const { data: pipeline, isLoading, error } = useTaskPipeline(pipelineId); const update = useUpdateTaskPipeline(); const templates = useTemplateOptions();
  if (isLoading) return <div className="p-4 sm:p-6"><div className="card flex min-h-32 items-center justify-center p-6 text-sm text-text-secondary" role="status">Loading pipeline…</div></div>;
  if (error || !pipeline) return <div className="p-4 sm:p-6"><Alert variant="error">{error?.message ?? 'Pipeline not found'}</Alert></div>;
  return <div className="p-4 sm:p-6">{update.error && <Alert variant="error" title="Could not update pipeline" className="mx-auto mb-6 max-w-5xl" onClose={update.reset}>{update.error.message}</Alert>}<PipelineBuilder key={pipeline.id} initialDraft={pipelineToDraft(pipeline)} templates={templates} onCancel={onCancel} isSaving={update.isPending} onSave={async (payload: TaskPipelineCreatePayload) => { await update.mutateAsync({ id: pipeline.id, payload }); onSaved(); }} /></div>;
}
