import { describe, expect, it } from 'vitest';
import { ensureWorkspaceSeedFoundation } from '../../prisma/seed-workspace-foundation';

type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  status: string;
  contactEmail?: string | null;
  settings?: unknown;
  activatedAt?: Date | null;
  deletedAt?: Date | null;
};

function createHarness(initialWorkspaces: WorkspaceRecord[] = []) {
  const workspaces = structuredClone(initialWorkspaces);
  const scheduleFoundations = new Set<string>();
  const roleFoundations = new Set<string>();
  let createCount = 0;

  const transactionClient = {
    workspace: {
      create: async ({ data }: { data: Omit<WorkspaceRecord, 'id'> }) => {
        createCount += 1;
        const workspace = { id: 'workspace-default', ...data };
        workspaces.push(workspace);
        return workspace;
      },
    },
  };

  const db = {
    workspace: {
      findMany: async () => workspaces
        .filter((workspace) => !workspace.deletedAt)
        .map(({ id }) => ({ id })),
    },
    $transaction: async <T>(callback: (tx: typeof transactionClient) => Promise<T>) => (
      callback(transactionClient)
    ),
  };

  const dependencies = {
    createServiceScheduleStarterData: async (_tx: unknown, workspaceId: string) => {
      scheduleFoundations.add(workspaceId);
    },
    createSystemRolesForWorkspace: async (workspaceId: string) => {
      roleFoundations.add(workspaceId);
    },
    now: () => new Date('2026-08-31T00:00:00.000Z'),
  };

  return {
    workspaces,
    scheduleFoundations,
    roleFoundations,
    getCreateCount: () => createCount,
    db,
    dependencies,
  };
}

describe('workspace seed foundation', () => {
  it('bootstraps one active operational workspace when the database is empty', async () => {
    const harness = createHarness();

    const result = await ensureWorkspaceSeedFoundation(
      harness.db as never,
      harness.dependencies as never,
    );

    expect(result).toEqual({
      createdWorkspaceId: 'workspace-default',
      workspaceIds: ['workspace-default'],
    });
    expect(harness.workspaces).toEqual([
      {
        id: 'workspace-default',
        name: 'Oakcloud',
        slug: 'oakcloud',
        status: 'ACTIVE',
        contactEmail: 'admin@oaktreesolutions.com.sg',
        settings: {
          servicesWorkspace: {
            enabled: true,
            deadlineWritesEnabled: true,
          },
        },
        activatedAt: new Date('2026-08-31T00:00:00.000Z'),
      },
    ]);
    expect([...harness.scheduleFoundations]).toEqual(['workspace-default']);
    expect([...harness.roleFoundations]).toEqual(['workspace-default']);
  });

  it('preserves existing workspaces while ensuring every workspace foundation', async () => {
    const existing = [
      {
        id: 'workspace-a',
        name: 'Existing A',
        slug: 'existing-a',
        status: 'ACTIVE',
        settings: { servicesWorkspace: { enabled: false } },
      },
      {
        id: 'workspace-b',
        name: 'Existing B',
        slug: 'existing-b',
        status: 'PENDING_SETUP',
        settings: { custom: true },
      },
    ];
    const harness = createHarness(existing);

    const result = await ensureWorkspaceSeedFoundation(
      harness.db as never,
      harness.dependencies as never,
    );

    expect(result).toEqual({
      createdWorkspaceId: null,
      workspaceIds: ['workspace-a', 'workspace-b'],
    });
    expect(harness.getCreateCount()).toBe(0);
    expect(harness.workspaces).toEqual(existing);
    expect([...harness.scheduleFoundations]).toEqual(['workspace-a', 'workspace-b']);
    expect([...harness.roleFoundations]).toEqual(['workspace-a', 'workspace-b']);
  });
});
