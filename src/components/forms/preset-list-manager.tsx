'use client';

import { useState, type ChangeEvent } from 'react';
import { Download, LockKeyhole, Pencil, Plus, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import {
  useCreateFormOptionPreset,
  useDeleteFormOptionPreset,
  useFormOptionPresets,
  usePreviewFormOptionPresetCsv,
  useUpdateFormOptionPreset,
  type FormOptionPresetListItem,
  type PresetCsvPreview,
} from '@/hooks/use-form-option-presets';

type Props = { isOpen: boolean; onClose: () => void };
type ImportTarget = FormOptionPresetListItem | null;

const PRESET_CSV_TEMPLATE = '\uFEFFvalue,label\r\nSG,Singapore\r\nMY,Malaysia\r\n';
const PRESET_CSV_TEMPLATE_FILENAME = 'preset-list-template.csv';

function downloadPresetCsvTemplate(): void {
  const blob = new Blob([PRESET_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = PRESET_CSV_TEMPLATE_FILENAME;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium' }).format(new Date(value));
}

export function PresetListManager({ isOpen, onClose }: Props) {
  const { success, error: showError } = useToast();
  const presets = useFormOptionPresets();
  const previewCsv = usePreviewFormOptionPresetCsv();
  const createPreset = useCreateFormOptionPreset();
  const updatePreset = useUpdateFormOptionPreset();
  const deletePreset = useDeleteFormOptionPreset();
  const [importTarget, setImportTarget] = useState<ImportTarget>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [name, setName] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<PresetCsvPreview | null>(null);
  const [fileError, setFileError] = useState('');
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FormOptionPresetListItem | null>(null);

  const resetImport = () => {
    setIsImporting(false);
    setImportTarget(null);
    setName('');
    setCsv('');
    setPreview(null);
    setFileError('');
  };

  const handleClose = () => {
    resetImport();
    onClose();
  };

  const startImport = (target: ImportTarget) => {
    setImportTarget(target);
    setName(target?.name ?? '');
    setCsv('');
    setPreview(null);
    setFileError('');
    setIsImporting(true);
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileError('');
    setPreview(null);
    try {
      const contents = await file.text();
      setCsv(contents);
      setPreview(await previewCsv.mutateAsync(contents));
    } catch (err) {
      setCsv('');
      setFileError(err instanceof Error ? err.message : 'Unable to read or validate CSV');
    }
  };

  const saveCreate = async () => {
    try {
      await createPreset.mutateAsync({ name: name.trim(), csv });
      success('Preset list created');
      resetImport();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to create preset list');
    }
  };

  const saveReplacement = async () => {
    if (!importTarget) return;
    try {
      await updatePreset.mutateAsync({
        id: importTarget.id,
        csv,
        ...(!importTarget.isProtected && name.trim() !== importTarget.name ? { name: name.trim() } : {}),
      });
      success('Preset list replaced');
      setReplaceConfirmOpen(false);
      resetImport();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to replace preset list');
      throw err;
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deletePreset.mutateAsync(deleteTarget.id);
      success('Preset list deleted');
      setDeleteTarget(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete preset list');
      throw err;
    }
  };

  const importIsValid = Boolean(
    csv && preview && preview.errors.length === 0 && preview.validRows > 0 && name.trim(),
  );

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title="Preset lists"
        description="Manage reusable dropdown choices without embedding large lists in forms."
        size="2xl"
        closeOnOverlayClick={!createPreset.isPending && !updatePreset.isPending}
      >
        {isImporting ? (
          <>
            <ModalBody className="max-h-[65vh] space-y-4 overflow-y-auto">
              <div>
                <h3 className="text-base font-semibold text-text-primary">
                  {importTarget ? `Update ${importTarget.name}` : 'Create preset list'}
                </h3>
                <p className="mt-1 text-xs text-text-secondary">
                  Upload UTF-8 CSV. Maximum 5 MB and 5,000 rows.
                </p>
              </div>
              <div className="flex flex-col gap-3 rounded-lg border border-border-primary bg-background-primary p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1 text-xs text-text-secondary">
                  <p>Label is required and is the text shown in the dropdown.</p>
                  <p>Value is optional and is the unique stored or submitted value.</p>
                  <p>If omitted, the label is used as the value.</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  leftIcon={<Download />}
                  className="shrink-0"
                  onClick={downloadPresetCsvTemplate}
                >
                  Download CSV template
                </Button>
              </div>
              <FormInput
                id="preset-name"
                label="Preset name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={Boolean(importTarget?.isProtected)}
                required
              />
              <div className="space-y-2">
                <label htmlFor="preset-csv" className="block text-xs font-medium text-text-secondary">CSV file</label>
                <input
                  id="preset-csv"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFile}
                  className="block w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-oak-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-oak-primary"
                />
              </div>
              {fileError ? <Alert variant="error">{fileError}</Alert> : null}
              {preview ? (
                <div className="space-y-3 rounded-xl border border-border-primary bg-background-primary p-3">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-status-success/10 px-2 py-1 font-medium text-status-success">
                      {preview.validRows} valid rows
                    </span>
                    <span className="rounded-full bg-background-tertiary px-2 py-1 text-text-secondary">
                      {preview.rejectedRows} rejected
                    </span>
                    <span className="rounded-full bg-background-tertiary px-2 py-1 text-text-secondary">
                      Columns: {preview.detectedColumns.join(', ') || 'none'}
                    </span>
                  </div>
                  {preview.errors.length > 0 ? (
                    <Alert variant="error" title="Fix CSV errors before saving">
                      <ul className="space-y-1">
                        {preview.errors.slice(0, 20).map((csvError, index) => (
                          <li key={`${csvError.row}-${csvError.column ?? ''}-${index}`}>
                            Row {csvError.row}{csvError.column ? ` · ${csvError.column}` : ''}: {csvError.message}
                          </li>
                        ))}
                      </ul>
                    </Alert>
                  ) : null}
                  {preview.sample.length > 0 ? (
                    <div className="overflow-hidden rounded-lg border border-border-primary">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-background-tertiary text-text-secondary">
                          <tr><th className="px-3 py-2 font-medium">Value</th><th className="px-3 py-2 font-medium">Label</th></tr>
                        </thead>
                        <tbody className="divide-y divide-border-primary text-text-primary">
                          {preview.sample.map((option) => (
                            <tr key={option.value}><td className="px-3 py-2 font-mono">{option.value}</td><td className="px-3 py-2">{option.label}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={resetImport}>Back</Button>
              <Button
                onClick={() => importTarget ? setReplaceConfirmOpen(true) : void saveCreate()}
                disabled={!importIsValid}
                isLoading={createPreset.isPending || updatePreset.isPending}
              >
                {importTarget ? 'Save replacement' : 'Create list'}
              </Button>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalBody className="max-h-[65vh] overflow-y-auto p-0">
              {presets.isLoading ? <div className="p-6 text-center text-sm text-text-secondary">Loading preset lists…</div> : null}
              {presets.error ? <div className="p-4"><Alert variant="error">{presets.error.message}</Alert></div> : null}
              {!presets.isLoading && !presets.error ? (
                <div className="divide-y divide-border-primary">
                  {(presets.data ?? []).map((preset) => {
                    const usageCount = preset._count.fields;
                    const cannotDelete = preset.isProtected || usageCount > 0;
                    return (
                      <div key={preset.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium text-text-primary">{preset.name}</p>
                            {preset.isProtected ? <LockKeyhole className="h-3.5 w-3.5 text-text-muted" aria-label="Protected" /> : null}
                            <span className="rounded-full bg-background-tertiary px-2 py-0.5 text-2xs text-text-secondary">
                              {preset.builtInKey ? 'Built-in' : 'Custom'}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-text-secondary">
                            {preset.optionCount.toLocaleString()} options · Updated {formatUpdatedAt(preset.updatedAt)}
                          </p>
                          {usageCount > 0 ? <p className="mt-1 text-xs text-text-muted">Used by {usageCount} fields</p> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {preset.allowCsvReplace ? (
                            <Button
                              variant="secondary"
                              size="xs"
                              leftIcon={<Pencil />}
                              onClick={() => startImport(preset)}
                              aria-label={`Update ${preset.name} CSV`}
                            >
                              Update CSV
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="xs"
                            iconOnly
                            leftIcon={<Trash2 />}
                            aria-label={`Delete ${preset.name}`}
                            title={preset.isProtected ? 'Built-in presets cannot be deleted' : usageCount > 0 ? `Used by ${usageCount} fields` : 'Delete preset'}
                            disabled={cannotDelete}
                            onClick={() => setDeleteTarget(preset)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={handleClose}>Close</Button>
              <Button leftIcon={<Plus />} onClick={() => startImport(null)}>Create preset list</Button>
            </ModalFooter>
          </>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={replaceConfirmOpen}
        onClose={() => setReplaceConfirmOpen(false)}
        onConfirm={saveReplacement}
        title="Replace preset list?"
        description="All linked dropdown fields will immediately use the new choices. Existing submission values will not change."
        confirmLabel="Replace list"
        variant="warning"
        isLoading={updatePreset.isPending}
      />
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete preset list?"
        description={deleteTarget ? `Delete “${deleteTarget.name}”? This cannot be undone.` : undefined}
        confirmLabel="Delete list"
        variant="danger"
        isLoading={deletePreset.isPending}
      />
    </>
  );
}
