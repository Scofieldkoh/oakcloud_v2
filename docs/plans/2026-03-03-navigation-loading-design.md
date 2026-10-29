# Navigation Loading Indicator Design

## Problem

Next.js App Router with a client-side dashboard layout doesn't trigger `loading.tsx` during client-side navigations. Users see a frozen page until the new route mounts, with no feedback that navigation is in progress.

## Solution

A `<NavigationProgress>` component that provides two loading indicators:

1. **Top progress bar** — starts immediately on navigation click
2. **Lottie overlay** — appears after 300ms if navigation is still in progress

## Approach: Intercept Navigation

Detect route changes by:

- Intercepting clicks on `<a>` elements (covers Next.js `<Link>`)
- Patching `router.push` and `router.replace`
- Watching `usePathname()` changes to detect navigation completion

No changes to existing navigation code (26+ files with `<Link>` or `router.push`) required.

## Components

### `useNavigationProgress` hook

Location: `src/hooks/use-navigation-progress.ts`

- Intercepts anchor clicks and router methods to detect navigation start
- Watches `usePathname()` to detect navigation end
- Exposes `isNavigating` boolean
- Manages 300ms delay timer for overlay

### `<NavigationProgress>` component

Location: `src/components/ui/navigation-progress.tsx`

**Progress bar:**
- 2px height, fixed at viewport top, `z-50`
- Uses `bg-oak-primary` color
- Animates from 0% → ~90% during loading via CSS transitions
- Completes to 100% on route change, then fades out

**Lottie overlay:**
- Appears after 300ms delay if still navigating
- Semi-transparent backdrop (`bg-background-primary/60`, `backdrop-blur-sm`), `z-40`
- Centered `LottieLoader` component (reuses existing)
- Fade in/out using `motion` (already installed)

### Integration

Add `<NavigationProgress />` inside the dashboard layout, after `<Sidebar />`. No other file changes needed.

## Behavior Flow

1. User clicks a link or triggers `router.push`
2. Progress bar appears immediately, animates 0% → ~90%
3. If >300ms passes, Lottie overlay fades in with backdrop
4. `usePathname()` changes → progress bar completes to 100%, overlay fades out
5. After 200ms exit animation, everything unmounts

## Styling

- Progress bar: 2px, `bg-oak-primary`, 150ms transitions
- Overlay backdrop: `bg-background-primary/60`, `backdrop-blur-sm`
- Consistent with design guidelines: 4px grid, 150ms transitions, minimal/subtle
