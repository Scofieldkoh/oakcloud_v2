'use client';

import { useEffect, useState } from 'react';
import { useNavigationProgress } from '@/hooks/use-navigation-progress';

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
    } else {
      // Complete the bar
      setProgress((current) => (current > 0 ? 100 : current));
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

      {/* Delayed lightweight overlay for slower route transitions. */}
      {showOverlay && isNavigating && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-background-primary/60 backdrop-blur-sm animate-fade-in">
          <div
            className="h-10 w-10 rounded-full border-2 border-border-primary border-t-oak-primary animate-spin"
            role="status"
            aria-label="Loading"
          />
        </div>
      )}
    </>
  );
}
