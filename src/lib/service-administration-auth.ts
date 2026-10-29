import type { SessionUser } from '@/lib/auth';
import { ForbiddenError } from '@/lib/errors';

/**
 * Require Tenant Admin or Super Admin access for service administration.
 */
export function requireServiceAdministrator(session: SessionUser): void {
  if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
    throw new ForbiddenError('Service administration requires Tenant Admin access');
  }
}
