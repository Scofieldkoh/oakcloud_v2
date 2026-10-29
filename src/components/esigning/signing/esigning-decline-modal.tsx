'use client';

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

interface EsigningDeclineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDecline: (reason: string) => void;
  isSubmitting: boolean;
}

export function EsigningDeclineModal({
  isOpen,
  onClose,
  onDecline,
  isSubmitting,
}: EsigningDeclineModalProps) {
  const [reason, setReason] = useState('');

  const canSubmit = reason.trim().length >= 3 && !isSubmitting;

  function handleDecline() {
    if (!canSubmit) return;
    onDecline(reason.trim());
  }

  function handleClose() {
    if (isSubmitting) return;
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Decline to Sign" size="md">
      <ModalBody className="space-y-4">
        {/* Warning icon + body text */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 border border-rose-200">
            <AlertCircle className="h-5 w-5 text-rose-500" />
          </div>
          <p className="pt-1 text-sm text-text-secondary">
            Declining will notify the sender and cancel the signing process for all parties. This
            action cannot be undone.
          </p>
        </div>

        {/* Reason textarea */}
        <div>
          <label
            htmlFor="decline-reason"
            className="mb-1.5 block text-xs font-medium text-text-secondary"
          >
            Reason for declining <span className="text-rose-500">*</span>
          </label>
          <textarea
            id="decline-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Please provide a reason for declining..."
            className="min-h-[80px] w-full resize-none rounded-xl border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-rose-400 focus:ring-1 focus:ring-rose-400/30 sm:min-h-[112px]"
          />
          {reason.trim().length > 0 && reason.trim().length < 3 && (
            <p className="mt-1 text-xs text-rose-500">Please enter at least 3 characters.</p>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={handleDecline}
          disabled={!canSubmit}
          isLoading={isSubmitting}
        >
          Decline
        </Button>
      </ModalFooter>
    </Modal>
  );
}
