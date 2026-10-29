'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to console (could be sent to error reporting service)
    console.error('Dashboard error:', error);
  }, [error]);

  return (
    <div className="min-h-[calc(100vh-3rem)] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-status-error/10 mb-6">
          <AlertTriangle className="w-8 h-8 text-status-error" />
        </div>

        <h2 className="text-xl font-semibold text-text-primary mb-2">
          Something went wrong
        </h2>

        <p className="text-text-secondary mb-6">
          An error occurred while loading this page. Please try again or return to the dashboard.
        </p>

        {process.env.NODE_ENV === 'development' && (
          <div className="mb-6 p-4 bg-background-elevated rounded-lg text-left overflow-auto max-h-32">
            <p className="text-xs font-mono text-status-error break-all">
              {error.message}
            </p>
            {error.digest && (
              <p className="text-xs font-mono text-text-muted mt-2">
                Digest: {error.digest}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={reset}
            leftIcon={<RefreshCw className="w-4 h-4" />}
          >
            Try Again
          </Button>
          <Link href="/companies">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Home className="w-4 h-4" />}
            >
              Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
