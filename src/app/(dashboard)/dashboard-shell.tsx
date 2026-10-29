'use client';

import { Suspense } from 'react';
import { Sidebar } from '@/components/ui/sidebar';
import { ErrorBoundary } from '@/components/error-boundary';
import { NavigationProgress } from '@/components/ui/navigation-progress';
import { useUIStore } from '@/stores/ui-store';
import { useIsMobile } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed } = useUIStore();
  const isMobile = useIsMobile();

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-oak-primary focus:text-white focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-oak-light"
      >
        Skip to main content
      </a>
      <div className="min-h-screen bg-background-primary">
        <Suspense>
          <NavigationProgress />
        </Suspense>
        <Sidebar />
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            'min-h-screen transition-all duration-200 focus:outline-none',
            isMobile ? 'pt-12' : sidebarCollapsed ? 'lg:ml-14' : 'lg:ml-56'
          )}
        >
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </>
  );
}
