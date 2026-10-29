import { redirect } from 'next/navigation';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { DashboardShell } from './dashboard-shell';
import { getAuthSessionPayload } from '@/lib/auth-session';
import { Providers } from '@/app/providers';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionPayload = await getAuthSessionPayload();

  if (!sessionPayload) {
    redirect('/login');
  }

  const queryClient = new QueryClient();
  queryClient.setQueryData(['session-with-permissions'], sessionPayload);
  queryClient.setQueryData(['permissions', undefined], {
    permissions: sessionPayload.permissions,
    isSuperAdmin: sessionPayload.isSuperAdmin,
    isWorkspaceAdmin: sessionPayload.isWorkspaceAdmin,
  });

  return (
    <Providers>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <DashboardShell>{children}</DashboardShell>
      </HydrationBoundary>
    </Providers>
  );
}
