/**
 * Seed the Singapore Company Incorporation form into a workspace.
 *
 *   npx tsx scripts/seed-incorporation-form.ts --email <login>
 *
 * Creates a DRAFT form, or updates the unpublished one already seeded. A published
 * copy is never changed; a new draft is created beside it instead.
 */
import { pathToFileURL } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { seedCompanyIncorporationForm } from '../src/services/form-template.service';

async function operator(): Promise<{ tenantId: string; userId: string }> {
  const index = process.argv.indexOf('--email');
  const email = index >= 0 ? process.argv[index + 1]?.trim().toLowerCase() : '';
  const user = email
    ? await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null, isActive: true },
        select: { id: true, tenantId: true },
      })
    : null;
  if (!user?.tenantId) throw new Error('--email must name an active user in a workspace');
  return { tenantId: user.tenantId, userId: user.id };
}

async function main() {
  const result = await seedCompanyIncorporationForm(await operator());
  console.info(`${result.action === 'created' ? 'Created' : 'Updated'} draft form "${result.form.title}" (${result.form.id}). Open Forms to review and publish it.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Seed failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
