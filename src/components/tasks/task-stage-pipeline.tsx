'use client';

import {
  Building2,
  CheckSquare,
  CircleCheckBig,
  FileText,
  Mail,
  PenLine,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskStageStatus, TaskStageSummary } from '@/services/tasks/types';

const stageIcons: Record<string, LucideIcon> = {
  Building2,
  CheckSquare,
  CircleCheckBig,
  FileText,
  Mail,
  PenLine,
};

const statusPresentation: Record<TaskStageStatus, {
  label: string;
  marker: string;
  className: string;
  connector: string;
}> = {
  NOT_STARTED: {
    label: 'Not started',
    marker: '○',
    className: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    connector: 'bg-slate-200 dark:bg-slate-700',
  },
  IN_PROGRESS: {
    label: 'In progress',
    marker: '▶',
    className: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
    connector: 'bg-blue-200 dark:bg-blue-900',
  },
  WAITING: {
    label: 'Waiting',
    marker: '!',
    className: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
    connector: 'bg-amber-200 dark:bg-amber-900',
  },
  COMPLETED: {
    label: 'Complete',
    marker: '✓',
    className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
    connector: 'bg-emerald-300 dark:bg-emerald-800',
  },
  SKIPPED: {
    label: 'Skipped',
    marker: '↷',
    className: 'bg-slate-100 text-slate-500 border-slate-300 border-dashed dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600',
    connector: 'bg-slate-200 dark:bg-slate-700',
  },
  FAILED: {
    label: 'Failed',
    marker: '×',
    className: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
    connector: 'bg-red-200 dark:bg-red-900',
  },
};

export function formatTaskStageStatus(status: TaskStageStatus) {
  return statusPresentation[status].label;
}

interface TaskStagePipelineProps {
  stages: TaskStageSummary[];
  onSelectStage: (stage: TaskStageSummary) => void;
  className?: string;
}

export function TaskStagePipeline({
  stages,
  onSelectStage,
  className,
}: TaskStagePipelineProps) {
  const orderedStages = [...stages].sort((left, right) => left.position - right.position);

  return (
    <div
      className={cn('flex min-w-max items-center py-0.5', className)}
      data-testid="task-stage-pipeline"
      aria-label="Task stages"
    >
      {orderedStages.map((stage, index) => {
        const presentation = statusPresentation[stage.status];
        const Icon = stageIcons[stage.icon] ?? CircleCheckBig;
        const accessibleLabel = `${stage.name} stage — ${presentation.label}`;

        return (
          <div key={stage.id} className="flex items-center">
            <button
              type="button"
              onClick={() => onSelectStage(stage)}
              className={cn(
                'relative inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary focus-visible:ring-offset-2',
                'md:min-h-8 md:min-w-8',
                presentation.className,
              )}
              aria-label={accessibleLabel}
              title={accessibleLabel}
              data-status={stage.status}
            >
              <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              <span
                data-testid="stage-status-marker"
                className="absolute -bottom-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-current bg-background-secondary px-0.5 text-[9px] font-bold leading-none"
                aria-hidden="true"
              >
                {presentation.marker}
              </span>
            </button>
            {index < orderedStages.length - 1 ? (
              <span
                className={cn('h-px w-4 sm:w-5', presentation.connector)}
                aria-hidden="true"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
