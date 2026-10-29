'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { format } from 'date-fns';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useSetBackupPassword, type BackupSettings } from '@/hooks/use-full-backup';

const MIN_LENGTH = 12;

export function BackupPasswordCard({ settings }: { settings: BackupSettings | undefined }) {
  const { success, error: showError } = useToast();
  const setPassword = useSetBackupPassword();
  const [open, setOpen] = useState(false);
  const [password, setPasswordValue] = useState('');
  const [confirm, setConfirm] = useState('');

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSave = password.length >= MIN_LENGTH && confirm === password;

  const close = () => {
    setOpen(false);
    setPasswordValue('');
    setConfirm('');
  };

  const save = async () => {
    try {
      await setPassword.mutateAsync(password);
      success('Backup password saved');
      close();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to save the backup password');
    }
  };

  return (
    <div className="bg-background-secondary rounded-lg border border-border-primary p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <KeyRound className="w-5 h-5 text-text-secondary mt-0.5" />
          <div>
            <div className="text-sm font-medium text-text-primary">Backup password</div>
            <div className="text-xs text-text-secondary mt-0.5">
              {settings?.hasPassword
                ? `Set${settings.passwordUpdatedAt ? ` on ${format(new Date(settings.passwordUpdatedAt), 'dd MMM yyyy')}` : ''}. Every full backup file is locked with it.`
                : 'Not set. Full backups need a password before they can run.'}
            </div>
          </div>
        </div>
        <Button variant="secondary" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => setOpen(true)}>
          {settings?.hasPassword ? 'Change password' : 'Set password'}
        </Button>
      </div>

      <Modal isOpen={open} onClose={close} title={settings?.hasPassword ? 'Change backup password' : 'Set backup password'} size="md">
        <ModalBody>
          <div className="space-y-4">
            <Alert variant="warning" compact>
              Keep this password in your password manager. You need it to restore a backup, including on a new
              machine. Oakcloud cannot recover it.
            </Alert>
            {settings?.hasPassword && (
              <p className="text-sm text-text-secondary">
                New backups will use the new password. Backups already made keep the password they were made with.
              </p>
            )}
            <FormInput
              label="Password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPasswordValue(event.target.value)}
              error={tooShort ? `Use at least ${MIN_LENGTH} characters` : undefined}
              hint={`At least ${MIN_LENGTH} characters. A few unrelated words work well.`}
            />
            <FormInput
              label="Type it again"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              error={mismatch ? 'The passwords do not match' : undefined}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={close}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={save} disabled={!canSave} isLoading={setPassword.isPending}>
            Save password
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
