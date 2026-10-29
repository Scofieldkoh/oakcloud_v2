import type { Prisma } from '../src/generated/prisma';
import { createSystemRolesForWorkspace } from '../src/lib/rbac';
import { prisma } from '../src/lib/prisma';
import { createServiceScheduleStarterData } from '../src/services/deadline-rule/starter-drafts';

type WorkspaceFoundationDb = {
  workspace: {
    findMany: (args: {
      where: { deletedAt: null };
      select: { id: true };
      orderBy: { createdAt: 'asc' };
    }) => Promise<Array<{ id: string }>>;
  };
  $transaction: <T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ) => Promise<T>;
};

type WorkspaceFoundationDependencies = {
  createServiceScheduleStarterData: (
    tx: Prisma.TransactionClient,
    workspaceId: string,
  ) => Promise<void>;
  createSystemRolesForWorkspace: (workspaceId: string) => Promise<void>;
  now: () => Date;
};

const defaultDependencies: WorkspaceFoundationDependencies = {
  createServiceScheduleStarterData,
  createSystemRolesForWorkspace,
  now: () => new Date(),
};

export type WorkspaceSeedFoundationResult = {
  createdWorkspaceId: string | null;
  workspaceIds: string[];
};

export async function ensureWorkspaceSeedFoundation(
  db: WorkspaceFoundationDb = prisma as unknown as WorkspaceFoundationDb,
  dependencies: WorkspaceFoundationDependencies = defaultDependencies,
): Promise<WorkspaceSeedFoundationResult> {
  let workspaces = await db.workspace.findMany({
    where: { deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  let createdWorkspaceId: string | null = null;

  if (workspaces.length === 0) {
    const workspace = await db.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
          name: 'Oakcloud',
          slug: 'oakcloud',
          status: 'ACTIVE',
          contactEmail: 'admin@oaktreesolutions.com.sg',
          settings: {
            servicesWorkspace: {
              enabled: true,
              deadlineWritesEnabled: true,
            },
          } as Prisma.InputJsonValue,
          activatedAt: dependencies.now(),
        },
        select: { id: true },
      });
      await dependencies.createServiceScheduleStarterData(tx, created.id);
      return created;
    });
    createdWorkspaceId = workspace.id;
    workspaces = [workspace];
  } else {
    for (const workspace of workspaces) {
      await db.$transaction((tx) => (
        dependencies.createServiceScheduleStarterData(tx, workspace.id)
      ));
    }
  }

  for (const workspace of workspaces) {
    await dependencies.createSystemRolesForWorkspace(workspace.id);
  }

  return {
    createdWorkspaceId,
    workspaceIds: workspaces.map(({ id }) => id),
  };
}
