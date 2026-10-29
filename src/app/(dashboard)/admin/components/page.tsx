'use client';

import { Alert } from '@/components/ui/alert';
import { ComponentShowcase } from '@/components/admin/component-showcase';
import { useSession } from '@/hooks/use-auth';

export default function ComponentShowcasePage() {
  const { data: session } = useSession();

  if (!session?.isSuperAdmin) {
    return (
      <div className="p-4 sm:p-6">
        <Alert variant="error">You do not have permission to access this page.</Alert>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary sm:text-2xl">UI Components</h1>
        <p className="mt-1 text-sm text-text-secondary">
          The shared components in their common states, rendered from the same code the app uses.
        </p>
      </div>
      <ComponentShowcase />
    </div>
  );
}
