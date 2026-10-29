import 'dotenv/config';
import { prisma } from '@/lib/prisma';
import { ensureAllOakDocTemplateMigrations } from '@/services/oakdoc-template-migration.service';

async function main() {
  const workspaces = await prisma.workspace.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  for (const workspace of workspaces) {
    const creator = await prisma.user.findFirst({
      where: {
        tenantId: workspace.id,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (!creator) {
      throw new Error(
        `Workspace ${workspace.name} (${workspace.id}) has no active tenant user to own OakDoc migrations`,
      );
    }

    const results = await ensureAllOakDocTemplateMigrations({
      tenantId: workspace.id,
      userId: creator.id,
    });

    for (const result of results) {
      console.log(
        `[${workspace.name}] ${result.migrationId}@${result.migrationVersion}: `
        + `${result.status} (${result.reason}) -> ${result.templateId}`,
      );
    }
  }
}

main()
  .catch((error) => {
    console.error('OakDoc template migration seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
