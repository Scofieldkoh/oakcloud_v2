'use client';

import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { BusinessAssistantWorkspace } from '@/components/business-assistant/workspace';

export default function BusinessAssistantPage() {
  const { data: session, isLoading } = useSession();
  const workspaceId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);
  if (isLoading) return <p className="p-6 text-sm text-text-secondary" role="status">Loading your workspace…</p>;
  if (!workspaceId || !session) return <p className="p-6 text-sm text-text-secondary">A workspace is required to use the Business Assistant.</p>;
  return <BusinessAssistantWorkspace key={`${workspaceId}:${session.id}`} workspaceId={workspaceId} firstName={session.firstName} />;
}
