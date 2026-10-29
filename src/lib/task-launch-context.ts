import { z } from 'zod';
import type { TaskLaunchContext } from '@/services/tasks/types';

function normalizeSafeReturnTo(value: string) {
  if (!value.startsWith('/') || value.startsWith('//')) {
    return null;
  }
  try {
    const parsed = new URL(value, 'http://oakcloud.internal');
    if (
      parsed.origin !== 'http://oakcloud.internal'
      || parsed.username
      || parsed.password
      || parsed.hash
    ) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export const taskLaunchContextSchema = z.object({
  taskId: z.string().uuid(),
  taskStageId: z.string().uuid(),
  returnTo: z.string().trim().min(1).max(2_000).transform((value, context) => {
    const normalized = normalizeSafeReturnTo(value);
    if (!normalized) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'returnTo must be a safe app-relative path',
      });
      return z.NEVER;
    }
    return normalized;
  }).optional(),
}).strict();

export function parseTaskLaunchContext(value: unknown): TaskLaunchContext | undefined {
  return value === undefined || value === null
    ? undefined
    : taskLaunchContextSchema.parse(value);
}

interface SearchParamsReader {
  get(name: string): string | null;
}

export function readTaskLaunchContext(
  searchParams: SearchParamsReader,
): TaskLaunchContext | undefined {
  const result = taskLaunchContextSchema.safeParse({
    taskId: searchParams.get('taskId') ?? undefined,
    taskStageId: searchParams.get('taskStageId') ?? undefined,
    returnTo: searchParams.get('returnTo') ?? undefined,
  });
  return result.success ? result.data : undefined;
}

export function withTaskLaunchContext(
  href: string,
  context?: TaskLaunchContext,
) {
  if (!context) return href;
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  params.set('taskId', context.taskId);
  params.set('taskStageId', context.taskStageId);
  if (context.returnTo) params.set('returnTo', context.returnTo);
  return `${path}?${params.toString()}`;
}
