'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PenTool } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

export interface SendForEsigningButtonProps {
  generatedDocumentIds: string[];
  /** True when some documents are drafts; they are finalized after a confirmation. */
  includesDrafts: boolean;
  label?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  disabled?: boolean;
  title?: string;
}

/**
 * Create a draft e-signing envelope from generated documents, with their
 * signers added, and open it to place the signature fields and send.
 */
export function SendForEsigningButton({
  generatedDocumentIds,
  includesDrafts,
  label = 'Send for e-signing',
  variant = 'secondary',
  size = 'sm',
  disabled = false,
  title,
}: SendForEsigningButtonProps) {
  const router = useRouter();
  const { success, error: showError } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const count = generatedDocumentIds.length;

  const send = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/esigning/envelopes/from-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generatedDocumentIds, finalizeDrafts: includesDrafts }),
      });
      const payload = await response.json().catch(() => ({})) as {
        id?: string;
        error?: string;
        signersAdded?: number;
        signersWithoutEmail?: number;
      };
      if (!response.ok || !payload.id) throw new Error(payload.error || 'Could not start e-signing');
      const signers = payload.signersAdded ?? 0;
      const noEmail = payload.signersWithoutEmail ?? 0;
      success(signers > 0
        ? `Envelope created with ${signers} signer${signers === 1 ? '' : 's'}${noEmail > 0 ? `, ${noEmail} without an email (manual link)` : ''}. Place the signature fields, then send.`
        : 'Envelope created. Add the signers and signature fields, then send.');
      setConfirmOpen(false);
      router.push(`/esigning/${payload.id}`);
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : 'Could not start e-signing');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        leftIcon={<PenTool className="h-4 w-4" />}
        onClick={() => (includesDrafts ? setConfirmOpen(true) : void send())}
        disabled={disabled || busy || count === 0}
        isLoading={busy && !confirmOpen}
        title={title}
      >
        {label}
      </Button>
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => !busy && setConfirmOpen(false)}
        onConfirm={send}
        title="Finalize and send for e-signing"
        description={`${count === 1 ? 'This document is' : 'These documents are'} finalized first, which locks ${count === 1 ? 'it' : 'them'} for editing (Unlock reverses it). A draft envelope then opens with the signers added, ready for the signature fields.`}
        confirmLabel="Finalize and continue"
        isLoading={busy}
      />
    </>
  );
}
