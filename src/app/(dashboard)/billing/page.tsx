import { getAuthSessionPayload } from '@/lib/auth-session';
import { ServicesWorkspace } from '@/components/services/services-workspace';

export default async function BillingPage() {
  const session = await getAuthSessionPayload();
  const canEdit = Boolean(session?.isSuperAdmin || session?.isWorkspaceAdmin || session?.permissions.includes('company:update'));

  return (
    <ServicesWorkspace
      workspaceId={session?.user.tenantId ?? undefined}
      canEdit={canEdit}
      canCreate={canEdit}
    />
  );
}
