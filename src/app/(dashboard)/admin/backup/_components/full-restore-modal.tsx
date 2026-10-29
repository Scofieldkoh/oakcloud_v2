'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import {
  formatBytes,
  usePreviewFullRestore,
  useStartFullRestore,
  type FullBackupPreview,
  type SystemBackup,
} from '@/hooks/use-full-backup';
import { cn } from '@/lib/utils';
import { ModuleRestoreStep } from './module-restore-step';

const CONFIRMATION = 'RESTORE';

interface FullRestoreModalProps {
  backup: SystemBackup | null;
  onClose: () => void;
}

type RestoreMode = 'everything' | 'modules';

const MODES: Array<{ value: RestoreMode; label: string }> = [
  { value: 'everything', label: 'Everything' },
  { value: 'modules', label: 'Choose modules' },
];

/**
 * Two steps: unlock and check the file (changes nothing), then either type
 * RESTORE to replace everything in this install, or choose modules to put back.
 */
export function FullRestoreModal({ backup, onClose }: FullRestoreModalProps) {
  const { success, error: showError } = useToast();
  const previewRestore = usePreviewFullRestore();
  const startRestore = useStartFullRestore();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [preview, setPreview] = useState<FullBackupPreview | null>(null);
  const [mode, setMode] = useState<RestoreMode>('everything');

  const close = () => {
    setMode('everything');
    setPassword('');
    setConfirmation('');
    setPreview(null);
    previewRestore.reset();
    onClose();
  };

  const check = async () => {
    if (!backup) return;
    try {
      setPreview(await previewRestore.mutateAsync({ backupId: backup.id, password }));
    } catch {
      // Shown inline below.
    }
  };

  const restore = async () => {
    if (!backup) return;
    try {
      await startRestore.mutateAsync({ backupId: backup.id, password, confirmation });
      success('Restore started. When it finishes, sign in with an account from the backup.');
      close();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to start the restore');
    }
  };

  const blocked = (preview?.blockers.length ?? 0) > 0;

  return (
    <Modal isOpen={backup !== null} onClose={close} title="Restore from full backup" size="5xl">
      <ModalBody>
        <div className="space-y-4">
          {!preview ? (
            <>
              <p className="text-sm text-text-secondary">
                Enter the backup password for <span className="font-medium text-text-primary">{backup?.name}</span>.
                Oakcloud unlocks the file and checks it first. Nothing changes yet.
              </p>
              <FormInput
                label="Backup password"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && password) void check();
                }}
                error={previewRestore.error instanceof Error ? previewRestore.error.message : undefined}
              />
            </>
          ) : (
            <>
              <div className="inline-flex gap-1 p-0.5 bg-background-tertiary rounded-lg" role="tablist" aria-label="What to restore">
                {MODES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={mode === option.value}
                    onClick={() => setMode(option.value)}
                    className={cn(
                      'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                      mode === option.value ? 'bg-background-elevated text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {mode === 'modules' && backup ? (
                <ModuleRestoreStep backupId={backup.id} password={password} modules={preview.modules} onStarted={close} />
              ) : (
                <EverythingSummary preview={preview} confirmation={confirmation} onConfirmationChange={setConfirmation} />
              )}
            </>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={close}>Cancel</Button>
        {!preview ? (
          <Button variant="primary" size="sm" onClick={check} disabled={!password} isLoading={previewRestore.isPending}>
            Check backup
          </Button>
        ) : mode === 'modules' ? null : (
          <Button
            variant="danger"
            size="sm"
            onClick={restore}
            disabled={blocked || confirmation !== CONFIRMATION}
            isLoading={startRestore.isPending}
          >
            Replace everything
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}

function EverythingSummary({
  preview,
  confirmation,
  onConfirmationChange,
}: {
  preview: FullBackupPreview;
  confirmation: string;
  onConfirmationChange: (value: string) => void;
}) {
  const blocked = preview.blockers.length > 0;
  return (
    <>
      <div className="text-sm text-text-secondary">
        Made on {format(new Date(preview.createdAt), 'dd MMM yyyy HH:mm')} with{' '}
        {preview.workspaces.map((workspace) => workspace.name).join(', ') || 'no workspaces'}.
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          ['Users', preview.counts.users],
          ['Companies', preview.counts.companies],
          ['Contacts', preview.counts.contacts],
          ['Documents', preview.counts.documents],
          ['Templates and partials', preview.counts.templates],
          ['Connectors', preview.counts.connectors],
        ].map(([label, value]) => (
          <div key={label} className="bg-background-tertiary rounded-md p-2">
            <div className="text-xs text-text-secondary">{label}</div>
            <div className="text-base font-semibold text-text-primary">{Number(value).toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-text-tertiary">
        {preview.totals.rows.toLocaleString()} records and {preview.totals.files.toLocaleString()} files (
        {formatBytes(preview.totals.fileBytes)}) in total.
      </div>
      {preview.blockers.map((blocker) => (
        <Alert key={blocker} variant="error" compact>{blocker}</Alert>
      ))}
      {!blocked && (
        <>
          <Alert variant="warning" title="This replaces everything" compact>
            <ul className="list-disc pl-4 space-y-1">
              {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </Alert>
          <FormInput
            label={`Type ${CONFIRMATION} to confirm`}
            value={confirmation}
            onChange={(event) => onConfirmationChange(event.target.value)}
            autoComplete="off"
          />
        </>
      )}
    </>
  );
}
