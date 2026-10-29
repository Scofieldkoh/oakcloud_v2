'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormInput } from '@/components/ui/form-input';
import { useToast } from '@/components/ui/toast';
import {
  usePreviewModuleRestore,
  useStartModuleRestore,
  type BackupModuleSummary,
  type ModuleRestorePreview,
} from '@/hooks/use-full-backup';

const CONFIRMATION = 'RESTORE';

interface ModuleRestoreStepProps {
  backupId: string;
  password: string;
  modules: BackupModuleSummary[];
  onStarted: () => void;
}

function count(value: number): string {
  return value.toLocaleString();
}

function records(value: number): string {
  return `${count(value)} record${value === 1 ? '' : 's'}`;
}

/**
 * Pick modules, preview what changes in each (and which links would break),
 * then type RESTORE to replace only those modules.
 */
export function ModuleRestoreStep({ backupId, password, modules, onStarted }: ModuleRestoreStepProps) {
  const { success, error: showError } = useToast();
  const previewRestore = usePreviewModuleRestore();
  const startRestore = useStartModuleRestore();
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<ModuleRestorePreview | null>(null);
  const [restoreMissingFiles, setRestoreMissingFiles] = useState(true);
  const [confirmation, setConfirmation] = useState('');

  const toggle = (key: string, on: boolean) => {
    setSelected((current) => (on ? [...current, key] : current.filter((module) => module !== key)));
    setPreview(null);
    setConfirmation('');
  };

  const runPreview = async (chosen = selected) => {
    try {
      setPreview(await previewRestore.mutateAsync({ backupId, password, modules: chosen }));
    } catch {
      setPreview(null);
    }
  };

  const addSuggested = () => {
    if (!preview) return;
    const chosen = [...new Set([...selected, ...preview.suggestedModules])];
    setSelected(chosen);
    void runPreview(chosen);
  };

  const restore = async () => {
    try {
      await startRestore.mutateAsync({ backupId, password, modules: selected, restoreMissingFiles, confirmation });
      success('Restore started. Progress shows in the backups list.');
      onStarted();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to start the restore');
    }
  };

  const labelOf = (key: string) => modules.find((module) => module.key === key)?.label ?? key;
  const blocked = (preview?.blockers.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Choose what to put back. Only those modules are replaced with the backup&apos;s records; everything else stays as it is now.
      </p>
      <div className="max-h-72 overflow-y-auto space-y-2 rounded-lg border border-border-primary p-3">
        {modules.map((module) => (
          <Checkbox
            key={module.key}
            size="sm"
            checked={selected.includes(module.key)}
            onChange={(event) => toggle(module.key, event.target.checked)}
            label={module.label}
            description={`${module.description}. Backup: ${records(module.backupRows)}, here now: ${count(module.liveRows)}.`}
          />
        ))}
      </div>

      {previewRestore.error instanceof Error && <Alert variant="error" compact>{previewRestore.error.message}</Alert>}

      {!preview ? (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => runPreview()}
            disabled={selected.length === 0}
            isLoading={previewRestore.isPending}
          >
            Preview changes
          </Button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border-primary">
            <table className="w-full text-sm">
              <thead className="bg-background-tertiary text-xs text-text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Module</th>
                  <th className="px-3 py-2 text-right font-medium">Added back</th>
                  <th className="px-3 py-2 text-right font-medium">Replaced</th>
                  <th className="px-3 py-2 text-right font-medium">Removed</th>
                  <th className="px-3 py-2 text-right font-medium">Unchanged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-primary">
                {preview.changes.map((change) => (
                  <tr key={change.module}>
                    <td className="px-3 py-2 text-text-primary">{change.label}</td>
                    <td className="px-3 py-2 text-right">{count(change.added)}</td>
                    <td className="px-3 py-2 text-right">{count(change.replaced)}</td>
                    <td className={`px-3 py-2 text-right ${change.removed > 0 ? 'text-status-error' : ''}`}>{count(change.removed)}</td>
                    <td className="px-3 py-2 text-right text-text-tertiary">{count(change.unchanged)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-text-tertiary">
            Removed means records made after this backup, which the restore deletes.
          </p>

          {blocked && (
            <Alert variant="error" compact>
              <ul className="list-disc pl-4 space-y-1">
                {preview.links.map((link) => (
                  <li key={`${link.fromModule}-${link.toModule}-${link.addModule}`}>
                    {link.message} ({records(link.rows)})
                  </li>
                ))}
                {preview.links.length === 0 && preview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
              {preview.suggestedModules.length > 0 && (
                <div className="mt-2">
                  <Button variant="secondary" size="sm" onClick={addSuggested} isLoading={previewRestore.isPending}>
                    Also restore {preview.suggestedModules.map(labelOf).join(', ')}
                  </Button>
                </div>
              )}
            </Alert>
          )}

          {!blocked && (
            <>
              {preview.missingFiles > 0 && (
                <Checkbox
                  size="sm"
                  checked={restoreMissingFiles}
                  onChange={(event) => setRestoreMissingFiles(event.target.checked)}
                  label={`Put back ${count(preview.missingFiles)} stored file(s) missing from this machine`}
                  description="Files already here are never overwritten."
                />
              )}
              <Alert variant="warning" compact>
                <ul className="list-disc pl-4 space-y-1">
                  {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </Alert>
              <FormInput
                label={`Type ${CONFIRMATION} to confirm`}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
              <div className="flex justify-end">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={restore}
                  disabled={confirmation !== CONFIRMATION}
                  isLoading={startRestore.isPending}
                >
                  Restore {selected.length === 1 ? labelOf(selected[0]) : `${selected.length} modules`}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
