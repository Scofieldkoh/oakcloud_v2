'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, type ComponentProps, type ReactNode } from 'react';

type LinkProps = ComponentProps<typeof Link>;

interface PrefetchLinkProps extends LinkProps {
  children: ReactNode;
  /** Type of entity to prefetch (currently unused - only route prefetch is active) */
  prefetchType?: 'company' | 'contact';
  /** Entity ID to prefetch (currently unused - only route prefetch is active) */
  prefetchId?: string;
}

/**
 * A Link component that prefetches routes on hover for faster navigation.
 *
 * NOTE: Data prefetch (company/contact details) was disabled because fetching
 * full company details (~8 parallel queries) on hover caused performance issues
 * when users quickly moved over multiple rows. The route prefetch alone provides
 * sufficient performance benefit.
 */
export function PrefetchLink({
  children,
  // These props are kept for API compatibility but currently unused
  prefetchType: _prefetchType,
  prefetchId: _prefetchId,
  onMouseEnter,
  href,
  ...props
}: PrefetchLinkProps) {
  const router = useRouter();

  // Extract href string for route prefetching
  const hrefString = typeof href === 'string' ? href : href.pathname || '';

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Prefetch the route only - Next.js handles this efficiently
      router.prefetch(hrefString);

      // Call original onMouseEnter if provided
      onMouseEnter?.(e);
    },
    [router, hrefString, onMouseEnter]
  );

  return (
    <Link href={href} onMouseEnter={handleMouseEnter} {...props}>
      {children}
    </Link>
  );
}

export default PrefetchLink;
