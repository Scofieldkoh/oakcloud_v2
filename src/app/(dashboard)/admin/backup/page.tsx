'use client';

import { useSession } from '@/hooks/use-auth';
import { Alert } from '@/components/ui/alert';
import { FullBackupsPanel } from './_components/full-backups-panel';

export default function BackupPage() {
  const { data: session } = useSession();

  // Only SUPER_ADMIN can access this page
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
        <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">Backup & Restore</h1>
        <p className="text-sm text-text-secondary mt-1">Back up everything, move Oakcloud to another machine, and restore</p>
      </div>
      <FullBackupsPanel />
    </div>
  );
}
