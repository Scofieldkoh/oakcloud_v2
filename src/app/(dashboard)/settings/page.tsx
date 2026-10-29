'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, ImageIcon, Save, UploadCloud } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { useToast } from '@/components/ui/toast';

type WorkspaceSettings = {
  id: string;
  name: string;
  logoUrl: string | null;
};

async function readJsonError(response: Response, fallback: string): Promise<never> {
  try {
    const data = await response.json();
    throw new Error(typeof data.error === 'string' ? data.error : fallback);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(fallback);
  }
}

export default function SettingsPage() {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSettings | null>(null);
  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoPreviewFailed, setLogoPreviewFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspaceSettings() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/workspace/settings');
        if (!response.ok) {
          await readJsonError(response, 'Failed to load workspace settings');
        }
        const data = await response.json();
        const nextWorkspace = data.workspace as WorkspaceSettings;

        if (!cancelled) {
          setWorkspace(nextWorkspace);
          setName(nextWorkspace.name);
          setLogoUrl(nextWorkspace.logoUrl ?? '');
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load workspace settings');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadWorkspaceSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setLogoPreviewFailed(false);
  }, [logoUrl]);

  const trimmedName = name.trim();
  const trimmedLogoUrl = logoUrl.trim();
  const isDirty = useMemo(() => (
    !!workspace &&
    (trimmedName !== workspace.name || trimmedLogoUrl !== (workspace.logoUrl ?? ''))
  ), [trimmedLogoUrl, trimmedName, workspace]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedName || isSaving) return;

    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/workspace/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          logoUrl: trimmedLogoUrl || null,
        }),
      });

      if (!response.ok) {
        await readJsonError(response, 'Failed to save workspace settings');
      }

      const data = await response.json();
      const nextWorkspace = data.workspace as WorkspaceSettings;
      setWorkspace(nextWorkspace);
      setName(nextWorkspace.name);
      setLogoUrl(nextWorkspace.logoUrl ?? '');
      toast.success('Workspace settings saved');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Failed to save workspace settings';
      setError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLogoFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || isUploadingLogo) return;

    const formData = new FormData();
    formData.set('file', file);

    setIsUploadingLogo(true);
    setError(null);
    try {
      const response = await fetch('/api/workspace/settings/logo', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        await readJsonError(response, 'Failed to upload workspace logo');
      }

      const data = await response.json();
      const nextWorkspace = data.workspace as WorkspaceSettings;
      setWorkspace(nextWorkspace);
      setName(nextWorkspace.name);
      setLogoUrl(nextWorkspace.logoUrl ?? '');
      toast.success('Workspace logo uploaded');
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Failed to upload workspace logo';
      setError(message);
      toast.error(message);
    } finally {
      setIsUploadingLogo(false);
    }
  }

  return (
    <div className="min-h-screen bg-background-primary">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:gap-6 sm:p-6">
        <section className="rounded-2xl border border-oak-primary/20 bg-gradient-to-br from-oak-primary/[0.06] to-background-secondary p-4 shadow-sm sm:rounded-3xl sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-oak-primary/10 text-oak-primary">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-text-primary sm:text-2xl">Settings</h1>
              <p className="text-sm text-text-secondary">Manage workspace branding used by forms and generated outputs.</p>
            </div>
          </div>
        </section>

        {error ? (
          <Alert variant="error" title="Settings error">
            {error}
          </Alert>
        ) : null}

        <form onSubmit={handleSubmit} className="rounded-2xl border border-border-primary bg-background-secondary p-4 shadow-sm sm:rounded-3xl sm:p-6">
          {isLoading ? (
            <div className="space-y-4">
              <div className="h-9 w-64 animate-pulse rounded bg-background-tertiary" />
              <div className="h-10 animate-pulse rounded bg-background-tertiary" />
              <div className="h-10 animate-pulse rounded bg-background-tertiary" />
              <div className="h-28 animate-pulse rounded bg-background-tertiary" />
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-text-primary">Workspace Branding</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  The logo URL is used when form settings enable the organization logo.
                </p>
              </div>

              <div className="grid gap-4">
                <FormInput
                  label="Workspace name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your workspace name"
                  inputSize="md"
                  required
                />

                <FormInput
                  label="Logo URL"
                  value={logoUrl}
                  onChange={(event) => setLogoUrl(event.target.value)}
                  placeholder="https://example.com/logo.png"
                  inputSize="md"
                  hint="Upload a logo, or use a public HTTP or HTTPS image URL. Leave blank to remove the logo."
                />

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={handleLogoFileChange}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    leftIcon={<UploadCloud className="h-4 w-4" />}
                    isLoading={isUploadingLogo}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSaving}
                  >
                    Upload logo
                  </Button>
                  <span className="text-xs text-text-muted">PNG, JPG, WebP, or GIF. Max 2MB.</span>
                </div>
              </div>

              <div className="rounded-xl border border-border-primary bg-background-primary p-4">
                <p className="mb-3 text-xs font-medium text-text-secondary">Logo preview</p>
                {trimmedLogoUrl && !logoPreviewFailed ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={trimmedLogoUrl}
                    alt="Workspace logo preview"
                    className="h-24 w-auto max-w-full rounded-sm object-contain"
                    onError={() => setLogoPreviewFailed(true)}
                  />
                ) : (
                  <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border-primary bg-background-tertiary text-text-muted">
                    <div className="flex items-center gap-2 text-sm">
                      <ImageIcon className="h-4 w-4" />
                      {trimmedLogoUrl ? 'Logo URL could not be loaded' : 'No logo configured'}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                {logoUrl ? (
                  <Button type="button" variant="secondary" onClick={() => setLogoUrl('')} disabled={isSaving || isUploadingLogo}>
                    Remove logo
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  leftIcon={<Save className="h-4 w-4" />}
                  disabled={!isDirty || trimmedName.length < 2 || isUploadingLogo}
                  isLoading={isSaving}
                >
                  Save changes
                </Button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
