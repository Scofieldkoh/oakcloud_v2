'use client';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export interface DocumentDeleteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
  /** Number of documents being deleted (1 for a single row). */
  count?: number;
}

/**
 * Delete confirmation for generated documents. Deleting sends documents to the
 * Recycle Bin, where an administrator can restore or permanently delete them.
 */
export function DocumentDeleteDialog({
  isOpen,
  onClose,
  onConfirm,
  count = 1,
}: DocumentDeleteDialogProps) {
  const noun = count === 1 ? 'Document' : `${count} Documents`;

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={(reason) => onConfirm(reason ?? '')}
      title={`Delete ${noun}`}
      description={`${count === 1 ? 'The document' : 'The documents'} will be moved to the Recycle Bin, where an administrator can restore or permanently delete ${count === 1 ? 'it' : 'them'}.`}
      confirmLabel={`Delete ${noun}`}
      variant="danger"
      requireReason
      reasonLabel="Reason for deletion"
      reasonPlaceholder={`Please provide a reason for deleting ${count === 1 ? 'this document' : 'these documents'}...`}
      reasonMinLength={10}
    />
  );
}
