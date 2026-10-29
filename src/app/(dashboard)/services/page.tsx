import { getAuthSessionPayload } from '@/lib/auth-session';
import { redirect } from 'next/navigation';
import { ServicesWorkspace } from '@/components/services/services-workspace';

type ServicesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ServicesPage({ searchParams }: ServicesPageProps) {
  const resolvedSearchParams = await searchParams;
  const legacyTab = Array.isArray(resolvedSearchParams.tab) ? resolvedSearchParams.tab[0] : resolvedSearchParams.tab;
  if (legacyTab === 'deadlines' || legacyTab === 'billing') {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(resolvedSearchParams)) {
      if (key === 'tab' || value === undefined) continue;
      for (const entry of Array.isArray(value) ? value : [value]) params.append(key, entry);
    }
    const query = params.toString();
    redirect(`/${legacyTab}${query ? `?${query}` : ''}`);
  }

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
