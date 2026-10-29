'use client';

import { useEffect, useState } from 'react';
import { PenLine, Trash2 } from 'lucide-react';
import { EsigningSignatureModal } from '@/components/esigning/signing/esigning-signature-modal';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/hooks/use-auth';

export default function SignatureSpecimenPage() {
  const { data: user } = useSession();
  const toast = useToast();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSpecimen() {
      try {
        const response = await fetch('/api/auth/signature-specimen');
        const result = (await response.json().catch(() => ({}))) as {
          dataUrl?: string | null;
          updatedAt?: string | null;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error || 'Failed to load signature specimen');
        if (!cancelled) {
          setDataUrl(result.dataUrl ?? null);
          setUpdatedAt(result.updatedAt ?? null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load signature specimen');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadSpecimen();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveSpecimen(nextDataUrl: string) {
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/signature-specimen', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: nextDataUrl }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        dataUrl?: string;
        updatedAt?: string;
        error?: string;
      };
      if (!response.ok || !result.dataUrl) {
        throw new Error(result.error || 'Failed to save signature specimen');
      }
      setDataUrl(result.dataUrl);
      setUpdatedAt(result.updatedAt ?? new Date().toISOString());
      setIsEditorOpen(false);
      toast.success('Signature specimen saved');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save signature specimen');
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSpecimen() {
    const response = await fetch('/api/auth/signature-specimen', { method: 'DELETE' });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      const message = result.error || 'Failed to remove signature specimen';
      setError(message);
      throw new Error(message);
    }
    setDataUrl(null);
    setUpdatedAt(null);
    setIsDeleteOpen(false);
    toast.success('Signature specimen removed');
  }

  const recipientName = user
    ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email
    : 'Your signature';

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary sm:text-2xl">Signature specimen</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Save a signature you can quickly apply when an e-signing request matches your account email.
        </p>
      </div>

      {error ? <Alert variant="error" className="mb-4">{error}</Alert> : null}

      <section className="rounded-xl border border-border-primary bg-background-secondary p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-oak-primary/10 p-2 text-oak-light">
            <PenLine className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-text-primary">Saved signature</h2>
            <p className="mt-1 text-sm text-text-secondary">
              You will always be asked before this specimen is applied to a signature field.
            </p>
          </div>
        </div>

        <div className="mt-4 flex min-h-36 items-center justify-center rounded-lg border border-dashed border-border-primary bg-background-tertiary p-4">
          {isLoading ? (
            <span className="text-sm text-text-muted">Loading signature...</span>
          ) : dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dataUrl} alt="Saved signature specimen" className="max-h-28 max-w-full object-contain" />
          ) : (
            <span className="text-sm text-text-muted">No signature specimen saved</span>
          )}
        </div>

        {updatedAt ? (
          <p className="mt-2 text-xs text-text-muted">Last updated {new Date(updatedAt).toLocaleString()}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => setIsEditorOpen(true)} disabled={isLoading}>
            {dataUrl ? 'Replace signature' : 'Add signature'}
          </Button>
          {dataUrl ? (
            <Button variant="secondary" onClick={() => setIsDeleteOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Remove
            </Button>
          ) : null}
        </div>
      </section>

      <EsigningSignatureModal
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onAdopt={({ dataUrl: nextDataUrl }) => void saveSpecimen(nextDataUrl)}
        mode="SIGNATURE"
        recipientName={recipientName}
        existingSignature={dataUrl}
        isSubmitting={isSaving}
        titleOverride={dataUrl ? 'Replace Signature Specimen' : 'Add Signature Specimen'}
        confirmLabel="Save Signature"
        legalText="This specimen is stored privately with your user profile and is only offered when your signed-in email matches the e-signing recipient."
        showApplyToAll={false}
        showDownloadSvg={false}
      />

      <ConfirmDialog
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={deleteSpecimen}
        title="Remove signature specimen?"
        description="You will need to draw, type, or upload a signature the next time you sign."
        confirmLabel="Remove"
      />
    </div>
  );
}
