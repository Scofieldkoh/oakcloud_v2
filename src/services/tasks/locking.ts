import {
  Prisma,
  type TaskStatus,
} from '@/generated/prisma';
import { NotFoundError } from '@/lib/errors';

export interface LockedTaskRow {
  id: string;
  tenantId: string;
  status: TaskStatus;
  title: string;
  companyId: string | null;
}

export interface LockedTaskPipelineRow {
  id: string;
}

export async function lockTaskForUpdate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskId: string,
): Promise<LockedTaskRow> {
  const rows = await tx.$queryRaw<LockedTaskRow[]>(Prisma.sql`
    SELECT
      id,
      tenant_id AS "tenantId",
      status::text AS status,
      title,
      company_id AS "companyId"
    FROM tasks
    WHERE id = ${taskId}
      AND tenant_id = ${tenantId}
      AND deleted_at IS NULL
    FOR UPDATE
  `);
  const task = rows[0];
  if (!task) {
    throw new NotFoundError('Task not found');
  }
  return task;
}

export async function lockTaskPipelineForUpdate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  pipelineId: string,
): Promise<LockedTaskPipelineRow> {
  const rows = await tx.$queryRaw<LockedTaskPipelineRow[]>(Prisma.sql`
    SELECT id
    FROM task_pipelines
    WHERE id = ${pipelineId}
      AND tenant_id = ${tenantId}
      AND deleted_at IS NULL
    FOR UPDATE
  `);
  const pipeline = rows[0];
  if (!pipeline) {
    throw new NotFoundError('Task pipeline not found');
  }
  return pipeline;
}
