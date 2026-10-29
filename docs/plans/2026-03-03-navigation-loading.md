# Navigation Loading Indicator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a top progress bar and delayed Lottie overlay during Next.js App Router client-side navigations.

**Architecture:** A `useNavigationProgress` hook intercepts anchor clicks and patches `router.push`/`router.replace` to detect navigation start, and watches `usePathname()` to detect navigation end. A `<NavigationProgress>` component renders the progress bar (immediate) and Lottie overlay (300ms delay), placed in the dashboard layout.

**Tech Stack:** Next.js App Router, React hooks, CSS animations, `motion` (already installed), existing `LottieLoader` component.

---

### Task 1: Create `useNavigationProgress` hook

**Files:**
- Create: `src/hooks/use-navigation-progress.ts`

**Step 1: Create the hook**

This hook detects navigation start/end and exposes loading state.

```typescript
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export function useNavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, setIsNavigating] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track current URL to detect actual changes
  const currentUrl = useRef(pathname + (searchParams?.toString() || ''));

  const startNavigation = useCallback(() => {
    setIsNavigating(true);
  }, []);

  const stopNavigation = useCallback(() => {
    setIsNavigating(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Stop navigation when pathname/searchParams change (route completed)
  useEffect(() => {
    const newUrl = pathname + (searchParams?.toString() || '');
    if (newUrl !== currentUrl.current) {
      currentUrl.current = newUrl;
      stopNavigation();
    }
  }, [pathname, searchParams, stopNavigation]);

  // Intercept link clicks
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      // Find closest anchor element
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      // Skip external links, hash links, download links, new-tab links
      if (
        href.startsWith('http') ||
        href.startsWith('#') ||
        anchor.hasAttribute('download') ||
        anchor.target === '_blank' ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey
      ) {
        return;
      }

      // Skip if navigating to the same page
      const currentPath = currentUrl.current;
      if (href === currentPath || href === pathname) return;

      startNavigation();
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [pathname, startNavigation]);

  // Patch router.push and router.replace via history API
  useEffect(() => {
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = function (...args) {
      startNavigation();
      return originalPushState(...args);
    };

    history.replaceState = function (...args) {
      // Only trigger for actual navigation, not for search param updates from state
      if (args[2] && typeof args[2] === 'string') {
        const newPath = new URL(args[2], window.location.origin).pathname;
        if (newPath !== pathname) {
          startNavigation();
        }
      }
      return originalReplaceState(...args);
    };

    return () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, [pathname, startNavigation]);

  // Safety timeout: stop after 10s to prevent stuck state
  useEffect(() => {
    if (isNavigating) {
      timeoutRef.current = setTimeout(() => {
        stopNavigation();
      }, 10000);
    }
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isNavigating, stopNavigation]);

  return { isNavigating };
}
```

**Step 2: Commit**

```bash
git add src/hooks/use-navigation-progress.ts
git commit -m "feat: add useNavigationProgress hook for route change detection"
```

---

### Task 2: Create `<NavigationProgress>` component

**Files:**
- Create: `src/components/ui/navigation-progress.tsx`
- Reference: `src/components/ui/lottie-loader.tsx` (reuse existing)

**Step 1: Create the component**

This renders the progress bar and Lottie overlay.

```tsx
'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigationProgress } from '@/hooks/use-navigation-progress';
import { LottieLoader } from '@/components/ui/lottie-loader';

export function NavigationProgress() {
  const { isNavigating } = useNavigationProgress();
  const [showOverlay, setShowOverlay] = useState(false);
  const [progress, setProgress] = useState(0);

  // Progress bar animation
  useEffect(() => {
    if (isNavigating) {
      setProgress(0);

      // Quick jump to 30%, then slow crawl to 90%
      const t1 = setTimeout(() => setProgress(30), 50);
      const t2 = setTimeout(() => setProgress(60), 300);
      const t3 = setTimeout(() => setProgress(80), 1000);
      const t4 = setTimeout(() => setProgress(90), 2000);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
        clearTimeout(t4);
      };
    } else if (progress > 0) {
      // Complete the bar
      setProgress(100);
      const t = setTimeout(() => setProgress(0), 200);
      return () => clearTimeout(t);
    }
  }, [isNavigating]);

  // Delayed overlay (300ms)
  useEffect(() => {
    if (isNavigating) {
      const t = setTimeout(() => setShowOverlay(true), 300);
      return () => clearTimeout(t);
    } else {
      setShowOverlay(false);
    }
  }, [isNavigating]);

  return (
    <>
      {/* Top progress bar */}
      {progress > 0 && (
        <div className="fixed top-0 left-0 right-0 z-50 h-0.5">
          <div
            className="h-full bg-oak-primary transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Lottie overlay */}
      <AnimatePresence>
        {showOverlay && isNavigating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-background-primary/60 backdrop-blur-sm"
          >
            <LottieLoader size="lg" message="Loading..." />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/ui/navigation-progress.tsx
git commit -m "feat: add NavigationProgress component with progress bar and Lottie overlay"
```

---

### Task 3: Integrate into dashboard layout

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx:1-44`

**Step 1: Add NavigationProgress to the layout**

Add the import at the top and render `<NavigationProgress />` as the first child inside the `<div className="min-h-screen ...">`:

```tsx
'use client';

import { Suspense } from 'react';
import { Sidebar } from '@/components/ui/sidebar';
import { AuthGuard } from '@/components/auth/auth-guard';
import { ErrorBoundary } from '@/components/error-boundary';
import { NavigationProgress } from '@/components/ui/navigation-progress';
import { useUIStore } from '@/stores/ui-store';
import { useIsMobile } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { sidebarCollapsed } = useUIStore();
  const isMobile = useIsMobile();

  return (
    <AuthGuard>
      {/* Skip to main content link for keyboard/screen reader users */}
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
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>
    </AuthGuard>
  );
}
```

Note: `<Suspense>` wraps `NavigationProgress` because the hook uses `useSearchParams()` which requires a Suspense boundary in Next.js App Router.

**Step 2: Commit**

```bash
git add src/app/\(dashboard\)/layout.tsx
git commit -m "feat: integrate NavigationProgress into dashboard layout"
```

---

### Task 4: Manual verification

**Step 1: Test in browser**

1. Open the app at `http://localhost:3000`
2. Navigate between pages using sidebar links
3. Verify:
   - Progress bar appears immediately at the top on click
   - If page takes >300ms, Lottie overlay fades in
   - Both disappear when the page loads
   - No stuck loading state (safety timeout at 10s)
4. Test edge cases:
   - External links (should NOT trigger loading)
   - Cmd/Ctrl+click (should NOT trigger loading)
   - Same-page navigation (should NOT trigger loading)
   - Browser back/forward buttons
   - Fast navigation (overlay should NOT flash)

**Step 2: Final commit if any fixes needed**
