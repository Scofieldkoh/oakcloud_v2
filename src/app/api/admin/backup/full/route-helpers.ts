import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { requireAuth } from '@/lib/auth';
import { routeErrorResponse } from '@/lib/api-route-errors';

/** Full backups cover every workspace, so only super admins may touch them. */
export async function requireSuperAdmin() {
  const session = await requireAuth();
  if (!session.isSuperAdmin) throw new Error('Forbidden');
  return session;
}

export function fullBackupErrorResponse(error: unknown, logLabel: string): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }
  return routeErrorResponse(error, { notFound: 'any', fallback: 'bad-request', logLabel });
}
