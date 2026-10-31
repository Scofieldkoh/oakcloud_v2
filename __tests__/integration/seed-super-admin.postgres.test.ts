// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('seed super admin PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

type PrismaClient = Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

class Rollback extends Error {}

const BOOTSTRAP_PASSWORD = 'bootstrap-password-for-test-1';

/** Run the body in a transaction that is always rolled back, with no admin row present. */
async function inRolledBackTransaction(
  prisma: PrismaClient,
  body: (tx: Tx) => Promise<void>,
) {
  await expect(
    prisma.$transaction(
      async (tx) => {
        const { SUPER_ADMIN_EMAIL, LEGACY_SUPER_ADMIN_EMAIL } = await import(
          '../../prisma/seed-super-admin'
        );
        const existing = await tx.user.findMany({
          where: { email: { in: [SUPER_ADMIN_EMAIL, LEGACY_SUPER_ADMIN_EMAIL] } },
          select: { id: true },
        });
        for (const [index, { id }] of existing.entries()) {
          await tx.user.update({ where: { id }, data: { email: `moved-${index}-${id}@seed-test.invalid` } });
        }
        await body(tx);
        throw new Rollback();
      },
      { timeout: 60_000, maxWait: 60_000 },
    ),
  ).rejects.toBeInstanceOf(Rollback);
}

async function fingerprint(tx: Tx, id: string) {
  const row = await tx.user.findUniqueOrThrow({ where: { id } });
  return createHash('sha256').update(JSON.stringify(row)).digest('hex');
}

describePostgres('seed super admin (PostgreSQL)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = (await import('@/lib/prisma')).getPrisma();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('creates the admin from SEED_ADMIN_PASSWORD and a second run leaves the row byte-identical', async () => {
    const { ensureSuperAdminUser } = await import('../../prisma/seed-super-admin');
    const { verifyPassword, hashPassword } = await import('@/lib/encryption');

    await inRolledBackTransaction(prisma, async (tx) => {
      const first = await ensureSuperAdminUser(tx, { SEED_ADMIN_PASSWORD: BOOTSTRAP_PASSWORD });
      expect(first.created).toBe(true);
      expect(first.generatedPassword).toBeNull();
      const created = await tx.user.findUniqueOrThrow({ where: { id: first.user.id } });
      expect((await verifyPassword(BOOTSTRAP_PASSWORD, created.passwordHash)).isValid).toBe(true);

      // Simulate a password rotation and a deactivation by an operator.
      await tx.user.update({
        where: { id: first.user.id },
        data: { passwordHash: hashPassword('rotated-password-for-test-2'), isActive: false },
      });
      const before = await fingerprint(tx, first.user.id);

      const second = await ensureSuperAdminUser(tx, { SEED_ADMIN_PASSWORD: BOOTSTRAP_PASSWORD });
      expect(second.created).toBe(false);
      expect(second.generatedPassword).toBeNull();
      expect(second.user.id).toBe(first.user.id);
      expect(await fingerprint(tx, first.user.id)).toBe(before);

      const after = await tx.user.findUniqueOrThrow({ where: { id: first.user.id } });
      expect(after.isActive).toBe(false);
      expect((await verifyPassword('rotated-password-for-test-2', after.passwordHash)).isValid).toBe(true);
    });
  }, 60_000);

  it('generates a random password once when SEED_ADMIN_PASSWORD is unset and never again', async () => {
    const { ensureSuperAdminUser } = await import('../../prisma/seed-super-admin');
    const { verifyPassword } = await import('@/lib/encryption');

    await inRolledBackTransaction(prisma, async (tx) => {
      const first = await ensureSuperAdminUser(tx, {});
      expect(first.created).toBe(true);
      expect(first.generatedPassword).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      const row = await tx.user.findUniqueOrThrow({ where: { id: first.user.id } });
      expect((await verifyPassword(first.generatedPassword!, row.passwordHash)).isValid).toBe(true);

      const second = await ensureSuperAdminUser(tx, {});
      expect(second.created).toBe(false);
      expect(second.generatedPassword).toBeNull();
    });
  }, 60_000);

  it('rejects a too-short SEED_ADMIN_PASSWORD without creating the admin', async () => {
    const { ensureSuperAdminUser, SUPER_ADMIN_EMAIL } = await import('../../prisma/seed-super-admin');

    await inRolledBackTransaction(prisma, async (tx) => {
      await expect(ensureSuperAdminUser(tx, { SEED_ADMIN_PASSWORD: 'short' })).rejects.toThrow(/at least/);
      expect(await tx.user.count({ where: { email: SUPER_ADMIN_EMAIL } })).toBe(0);
    });
  }, 60_000);

  it('reset script replaces only the password and reactivates only on request', async () => {
    const { ensureSuperAdminUser } = await import('../../prisma/seed-super-admin');
    const { resetAdminPassword } = await import('../../scripts/reset-admin-password');
    const { verifyPassword } = await import('@/lib/encryption');

    await inRolledBackTransaction(prisma, async (tx) => {
      const { user } = await ensureSuperAdminUser(tx, { SEED_ADMIN_PASSWORD: BOOTSTRAP_PASSWORD });
      await tx.user.update({ where: { id: user.id }, data: { isActive: false } });

      const kept = await resetAdminPassword(tx, { password: 'recovered-password-for-test-3' });
      expect(kept).toMatchObject({ reactivated: false, generatedPassword: null });
      let row = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.isActive).toBe(false);
      expect(row.mustChangePassword).toBe(true);
      expect((await verifyPassword('recovered-password-for-test-3', row.passwordHash)).isValid).toBe(true);

      const reactivated = await resetAdminPassword(tx, { reactivate: true });
      expect(reactivated.reactivated).toBe(true);
      expect(reactivated.generatedPassword).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      row = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.isActive).toBe(true);

      await expect(resetAdminPassword(tx, { email: 'nobody@seed-test.invalid' })).rejects.toThrow(/nothing changed/);
    });
  }, 60_000);
});
