import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '../src/generated/prisma';
import { hashPassword } from '../src/lib/encryption';
import { SUPER_ADMIN_EMAIL, MIN_SEED_ADMIN_PASSWORD_LENGTH } from '../prisma/seed-super-admin';
import { flag, option } from './lib/oakdoc-cli-args';

/**
 * Recover a lost administrator password (run on the server, against the real DATABASE_URL):
 *
 *   ADMIN_NEW_PASSWORD='<new password>' npx tsx scripts/reset-admin-password.ts [--email <login>] [--reactivate]
 *
 * Without ADMIN_NEW_PASSWORD a random password is generated and printed once.
 * Only passwordHash is replaced (plus a forced password change at next sign-in and
 * clearing of any pending reset token). The account stays inactive unless
 * --reactivate is given; roles are never touched.
 */
export type ResetAdminPasswordResult = {
  email: string;
  reactivated: boolean;
  generatedPassword: string | null;
};

export async function resetAdminPassword(
  db: Pick<PrismaClient, 'user'>,
  options: { email?: string; reactivate?: boolean; password?: string | undefined } = {},
): Promise<ResetAdminPasswordResult> {
  const email = options.email?.trim() || SUPER_ADMIN_EMAIL;
  const user = await db.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
    select: { id: true, email: true, isActive: true },
  });
  if (!user) throw new Error('No non-deleted user with that email exists; nothing changed');

  if (options.password && options.password.length < MIN_SEED_ADMIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_SEED_ADMIN_PASSWORD_LENGTH} characters`);
  }
  const password = options.password || randomBytes(18).toString('base64url');

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(password),
      mustChangePassword: true,
      passwordChangedAt: new Date(),
      passwordResetToken: null,
      passwordResetExpires: null,
      ...(options.reactivate ? { isActive: true } : {}),
    },
  });

  return {
    email: user.email,
    reactivated: Boolean(options.reactivate) && !user.isActive,
    generatedPassword: options.password ? null : password,
  };
}

async function main(argv: readonly string[]) {
  const { prisma } = await import('../src/lib/prisma');
  try {
    const result = await resetAdminPassword(prisma, {
      email: option(argv, 'email'),
      reactivate: flag(argv, 'reactivate'),
      password: process.env.ADMIN_NEW_PASSWORD,
    });
    console.info(`Password reset for ${result.email}.`);
    if (result.reactivated) console.info('Account was inactive and has been reactivated.');
    if (result.generatedPassword) {
      console.info('Generated password (shown once, store it now):');
      console.info(result.generatedPassword);
    }
    console.info('The user must change the password at next sign-in.');
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
