'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { CompanySelect } from '@/components/ui/company-select';
import { toCompanySearchOption } from '@/hooks/use-company-search';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import type { TaskPipeline } from '@/hooks/use-task-pipelines';
import type {
  TaskCreatePayload,
  TaskListItem,
  TaskUpdatePayload,
} from '@/services/tasks/types';

interface OwnerOption {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface TaskFormModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  pipelines: TaskPipeline[];
  owners: OwnerOption[];
  initialTask?: TaskListItem | null;
  onClose: () => void;
  onSubmit: (payload: TaskCreatePayload | TaskUpdatePayload) => void | Promise<void>;
  isSubmitting?: boolean;
  error?: Error | null;
}

function dateInputValue(value: string | null | undefined) {
  return value?.slice(0, 10) ?? '';
}

export function TaskFormModal({
  isOpen,
  mode,
  pipelines,
  owners,
  initialTask,
  onClose,
  onSubmit,
  isSubmitting = false,
  error,
}: TaskFormModalProps) {
  const [title, setTitle] = useState('');
  const [pipelineVersionId, setPipelineVersionId] = useState('');
  const [description, setDescription] = useState('');
  const [companyId, setCompanyId] = useState('');
  const initialCompany = useMemo(
    () => (initialTask?.company ? [toCompanySearchOption(initialTask.company)] : undefined),
    [initialTask?.company],
  );
  const [ownerId, setOwnerId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [errors, setErrors] = useState<{ title?: string; pipeline?: string }>({});

  const publishedPipelines = useMemo(() => pipelines.flatMap((pipeline) => {
    const published = pipeline.versions
      .filter((version) => Boolean(version.publishedAt))
      .sort((left, right) => right.version - left.version)[0];
    return published ? [{ pipeline, version: published }] : [];
  }), [pipelines]);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(initialTask?.title ?? '');
    setPipelineVersionId(initialTask?.pipelineVersion.id ?? '');
    setDescription(initialTask?.description ?? '');
    setCompanyId(initialTask?.company?.id ?? '');
    setOwnerId(initialTask?.owner?.id ?? '');
    setDueDate(dateInputValue(initialTask?.dueDate));
    setErrors({});
  }, [initialTask, isOpen]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = {
      ...(!title.trim() ? { title: 'Title is required' } : {}),
      ...(mode === 'create' && !pipelineVersionId ? { pipeline: 'Pipeline is required' } : {}),
    };
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    if (mode === 'create') {
      const payload: TaskCreatePayload = {
        title: title.trim(),
        pipelineVersionId,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(companyId ? { companyId } : {}),
        ...(ownerId ? { ownerId } : {}),
        ...(dueDate ? { dueDate } : {}),
      };
      void onSubmit(payload);
      return;
    }

    void onSubmit({
      title: title.trim(),
      description: description.trim() || null,
      companyId: companyId || null,
      ownerId: ownerId || null,
      dueDate: dueDate || null,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'create' ? 'Create task' : 'Edit task'}
      description={mode === 'create' ? 'Start from a published pipeline. Other details are optional.' : 'Update task metadata without changing its pipeline.'}
      size="lg"
      closeOnOverlayClick={!isSubmitting}
      closeOnEscape={!isSubmitting}
    >
      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4">
          {error ? <Alert variant="error" compact>{error.message}</Alert> : null}
          <FormInput
            label="Title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (errors.title) setErrors((current) => ({ ...current, title: undefined }));
            }}
            error={errors.title}
            aria-required="true"
            maxLength={300}
          />
          {mode === 'create' ? (
            <div>
              <label htmlFor="task-pipeline" className="mb-2 block text-xs font-medium text-text-secondary">Pipeline</label>
              <select
                id="task-pipeline"
                aria-label="Pipeline"
                value={pipelineVersionId}
                onChange={(event) => {
                  setPipelineVersionId(event.target.value);
                  if (errors.pipeline) setErrors((current) => ({ ...current, pipeline: undefined }));
                }}
                className="input input-sm w-full"
                aria-required="true"
              >
                <option value="">Select a pipeline</option>
                {publishedPipelines.map(({ pipeline, version }) => (
                  <option key={version.id} value={version.id}>{pipeline.name}</option>
                ))}
              </select>
              {errors.pipeline ? <p className="mt-2 text-xs text-red-400">{errors.pipeline}</p> : null}
            </div>
          ) : null}
          <div>
            <label htmlFor="task-description" className="mb-2 block text-xs font-medium text-text-secondary">Description <span className="font-normal text-text-muted">(optional)</span></label>
            <textarea
              id="task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={5000}
              rows={3}
              className="input w-full resize-y px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <CompanySelect
                label="Company (optional)"
                labelClassName="mb-2 text-xs font-medium text-text-secondary"
                value={companyId}
                onChange={(nextCompanyId) => setCompanyId(nextCompanyId)}
                placeholder="Not linked"
                pinned={initialCompany}
                enabled={isOpen}
              />
            </div>
            <div>
              <label htmlFor="task-owner" className="mb-2 block text-xs font-medium text-text-secondary">Owner <span className="font-normal text-text-muted">(optional)</span></label>
              <select id="task-owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="input input-sm w-full">
                <option value="">Unassigned</option>
                {owners.map((owner) => <option key={owner.id} value={owner.id}>{`${owner.firstName} ${owner.lastName}`.trim() || owner.email}</option>)}
              </select>
            </div>
          </div>
          <FormInput label="Due date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} hint="Optional" />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" isLoading={isSubmitting}>{mode === 'create' ? 'Create task' : 'Save changes'}</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
