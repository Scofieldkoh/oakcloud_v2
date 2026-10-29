'use client';

import type { ChangeEventHandler, ReactNode } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Link2,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import type { TaskStageDetail } from '@/services/tasks/types';
import { formatTaskStageStatus } from './task-stage-pipeline';

export type StageNotesSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const stageStatusAccent: Record<TaskStageDetail['status'], string> = {
  NOT_STARTED: 'border-l-slate-400',
  IN_PROGRESS: 'border-l-blue-500',
  WAITING: 'border-l-amber-500',
  COMPLETED: 'border-l-emerald-500',
  SKIPPED: 'border-l-slate-400',
  FAILED: 'border-l-red-500',
};

const stageStatusBadge: Record<TaskStageDetail['status'], string> = {
  NOT_STARTED: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  IN_PROGRESS: 'border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300',
  WAITING: 'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  COMPLETED: 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  SKIPPED: 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400',
  FAILED: 'border-red-200 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300',
};

function dateTimeLabel(value: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  const datePart = new Intl.DateTimeFormat('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${datePart}, ${timePart}`;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function linkedOutcome(stage: TaskStageDetail) {
  if (stage.actionType === 'COMPANY_PROFILE') {
    return {
      label: 'Linked company',
      value: stage.outcomeSummary
        ? stage.outcomeSummary.replace(/^Linked company:\s*/i, '')
        : 'No company linked yet.',
    };
  }
  if (stage.actionType === 'DOCUMENT_GENERATION') {
    return {
      label: 'Linked document',
      value: stage.outcomeSummary || 'No document linked yet.',
    };
  }
  if (stage.actionType === 'ESIGNING') {
    return {
      label: 'Linked signing request',
      value: stage.outcomeSummary || 'No signing request linked yet.',
    };
  }
  return {
    label: 'Linked outcome',
    value: stage.outcomeSummary || 'No linked outcome yet.',
  };
}

function stageDescription(stage: TaskStageDetail) {
  if (stage.actionType === 'COMPANY_PROFILE') {
    return 'Link or create Company profile for the task';
  }
  return stage.description || 'Review and complete this pipeline stage.';
}

interface PipelineStageModalFrameProps {
  isOpen: boolean;
  stage?: TaskStageDetail | null;
  onClose: () => void;
  isMutating: boolean;
  children: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
}

export function PipelineStageModalFrame({
  isOpen,
  stage,
  onClose,
  isMutating,
  children,
  aside,
  footer,
}: PipelineStageModalFrameProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={stage?.name ?? 'Stage details'}
      titleBadge={stage ? (
        <span
          data-testid="stage-status-badge"
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
            stageStatusBadge[stage.status],
          )}
        >
          {formatTaskStageStatus(stage.status)}
        </span>
      ) : undefined}
      description={stage ? stageDescription(stage) : undefined}
      size="full"
      className={cn(
        'max-h-[calc(100vh-2rem)] overflow-y-auto border-l-4 [&>div:first-child]:px-6 [&>div:first-child]:py-4',
        stage ? stageStatusAccent[stage.status] : 'border-l-slate-400',
      )}
      closeOnOverlayClick={!isMutating}
      closeOnEscape={!isMutating}
    >
      <ModalBody
        data-testid="pipeline-stage-modal-body"
        className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]"
      >
        <div data-testid="pipeline-stage-modal-main" className="min-w-0 space-y-4">
          {children}
        </div>
        {aside ? (
          <aside
            className="max-h-[50dvh] min-w-0 overflow-y-auto border-t border-border-primary pt-4 lg:max-h-[calc(100dvh-12rem)] lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0"
            aria-label="Task resources"
          >
            {aside}
          </aside>
        ) : null}
      </ModalBody>
      {footer}
    </Modal>
  );
}

export function PipelineStageLinkedOutcome({ stage }: { stage: TaskStageDetail }) {
  const outcome = linkedOutcome(stage);
  return (
    <section
      data-testid="stage-linked-outcome-card"
      className="rounded-lg border border-oak-primary/20 bg-oak-primary/5 p-3 text-sm"
    >
      <div data-testid="stage-secondary-primary" className="flex items-start gap-2">
        <Link2 className="mt-0.5 h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <div>
          <span className="block text-xs font-medium text-emerald-700 dark:text-emerald-300">
            {outcome.label}
          </span>
          <span className="mt-0.5 block text-sm font-medium text-text-primary">
            {outcome.value}
          </span>
        </div>
      </div>
    </section>
  );
}

export function PipelineStageMetadata({
  stage,
  taskDueDate,
}: {
  stage: TaskStageDetail;
  taskDueDate?: string | null;
}) {
  const assignee = stage.assignee
    ? `${stage.assignee.firstName} ${stage.assignee.lastName}`.trim() || stage.assignee.email
    : 'Unassigned';

  return (
    <section
      data-testid="stage-secondary-details"
      className="rounded-lg border border-border-primary bg-background-primary p-3 text-sm"
    >
      <div
        data-testid="stage-secondary-timeline"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <MetadataItem icon={<UserRound />} label="Assignee" value={assignee} />
        <MetadataItem icon={<CalendarDays />} label="Due Date" value={dateLabel(taskDueDate)} />
        <MetadataItem icon={<Clock3 />} label="Started" value={dateTimeLabel(stage.startedAt)} />
        <MetadataItem icon={<CheckCircle2 />} label="Completed" value={dateTimeLabel(stage.completedAt)} />
      </div>
    </section>
  );
}

function MetadataItem({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-4 w-4 items-center text-text-secondary [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">
        {icon}
      </span>
      <div>
        <span className="block text-xs font-medium text-text-secondary">{label}</span>
        <span className="text-text-primary">{value}</span>
      </div>
    </div>
  );
}

export function PipelineStageNotes({
  value,
  onChange,
  saveStatus,
}: {
  value: string;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  saveStatus: StageNotesSaveStatus;
}) {
  return (
    <section>
      <label htmlFor="task-stage-notes" className="mb-2 block text-sm font-semibold text-text-primary">
        Notes
      </label>
      <textarea
        id="task-stage-notes"
        aria-label="Notes"
        value={value}
        onChange={onChange}
        rows={4}
        maxLength={5000}
        className="input w-full resize-y px-3 py-2 text-sm"
      />
      <p
        className={cn(
          'mt-1 min-h-4 text-right text-xs',
          saveStatus === 'error' ? 'text-red-600 dark:text-red-400' : 'text-text-secondary',
        )}
        role="status"
        aria-live="polite"
      >
        {{
          idle: '',
          saving: 'Saving…',
          saved: 'Saved',
          error: 'Couldn’t save',
        }[saveStatus]}
      </p>
    </section>
  );
}

interface PipelineStageModalFooterProps {
  isRequired: boolean;
  isMutating: boolean;
  hasPreviousStage: boolean;
  hasNextStage: boolean;
  onNavigateStage?: (direction: 'previous' | 'next') => void;
  primaryAction: ReactNode;
}

export function PipelineStageModalFooter({
  isRequired,
  isMutating,
  hasPreviousStage,
  hasNextStage,
  onNavigateStage,
  primaryAction,
}: PipelineStageModalFooterProps) {
  return (
    <ModalFooter data-testid="pipeline-stage-modal-footer" className="px-6 py-4">
      <span className="mr-auto flex items-center gap-1.5 text-xs text-text-muted">
        {isRequired ? <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        {isRequired ? 'Required stage' : 'Optional stage'}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onNavigateStage?.('previous')}
          disabled={!hasPreviousStage || isMutating}
          leftIcon={<ChevronLeft />}
          className="text-text-secondary hover:text-text-primary disabled:text-text-muted"
        >
          Previous stage
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onNavigateStage?.('next')}
          disabled={!hasNextStage || isMutating}
          rightIcon={<ChevronRight />}
          className="text-text-secondary hover:text-text-primary disabled:text-text-muted"
        >
          Next stage
        </Button>
      </div>
      {primaryAction}
    </ModalFooter>
  );
}
