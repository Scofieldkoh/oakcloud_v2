import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '../src/generated/prisma';
import { hashPassword } from '../src/lib/encryption';

export const SUPER_ADMIN_EMAIL = 'admin@oaktreesolutions.com.sg';
export const LEGACY_SUPER_ADMIN_EMAIL = 'admin@oakcloud.local';
export const SEED_ADMIN_PASSWORD_ENV = 'SEED_ADMIN_PASSWORD';
export const MIN_SEED_ADMIN_PASSWORD_LENGTH = 12;

export type SuperAdminSeedResult = {
  user: { id: string; email: string };
  /** True only when this run inserted the administrator row. */
  created: boolean;
  /** Set only when created with a random password; show it once, never log it again. */
  generatedPassword: string | null;
};

/**
 * Ensure a bootstrap administrator exists.
 *
 * An existing administrator (current or legacy email) is returned untouched:
 * the seed never changes its password, active flag, email, or roles, so re-running
 * the seed cannot undo a password rotation or a deactivation. The password for a
 * new administrator comes from SEED_ADMIN_PASSWORD, or is generated randomly.
 */
export async function ensureSuperAdminUser(
  db: Pick<PrismaClient, 'user'>,
  env: Record<string, string | undefined> = process.env,
): Promise<SuperAdminSeedResult> {
  const existing = await db.user.findFirst({
    where: { OR: [{ email: SUPER_ADMIN_EMAIL }, { email: LEGACY_SUPER_ADMIN_EMAIL }] },
    select: { id: true, email: true },
  });
  if (existing) return { user: existing, created: false, generatedPassword: null };

  const configured = env[SEED_ADMIN_PASSWORD_ENV];
  if (configured && configured.length < MIN_SEED_ADMIN_PASSWORD_LENGTH) {
    throw new Error(
      `${SEED_ADMIN_PASSWORD_ENV} must be at least ${MIN_SEED_ADMIN_PASSWORD_LENGTH} characters`,
    );
  }
  const password = configured || randomBytes(18).toString('base64url');

  const user = await db.user.create({
    data: {
      email: SUPER_ADMIN_EMAIL,
      passwordHash: hashPassword(password),
      firstName: 'Super',
      lastName: 'Admin',
      isActive: true,
    },
    select: { id: true, email: true },
  });
  return { user, created: true, generatedPassword: configured ? null : password };
}
