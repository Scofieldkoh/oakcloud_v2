'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import type { ContactMatchResult } from '@/types/contact-identity';

interface ContactMatchDialogProps {
  match: ContactMatchResult;
  open: boolean;
  onUseExisting: () => void | Promise<void>;
  onCreateSeparate: (reason: string) => void | Promise<void>;
  onClose: () => void;
  isLoading?: boolean;
}

export function ContactMatchDialog({
  match,
  open,
  onUseExisting,
  onCreateSeparate,
  onClose,
  isLoading = false,
}: ContactMatchDialogProps) {
  const [reason, setReason] = useState('');
  const reasonRef = useRef<HTMLInputElement>(null);
  const trimmedReason = reason.trim();

  useEffect(() => {
    if (!open) setReason('');
  }, [open]);

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Possible matching contact"
      description="Review the match before creating another contact."
      size="lg"
      closeOnOverlayClick={!isLoading}
      closeOnEscape={!isLoading}
    >
      <ModalBody className="space-y-4">
        <div className="rounded-lg border border-border-primary bg-background-tertiary p-3">
          <p className="text-sm font-medium text-text-primary">Existing contact match</p>
          <p className="mt-1 text-xs text-text-secondary">
            Confidence score: {match.score}. Match reason: {match.reasons.join(', ').toLowerCase().replaceAll('_', ' ')}.
          </p>
        </div>

        {match.blockedByIdentifierConflict && (
          <div className="flex gap-2 rounded-lg border border-status-warning bg-status-warning/10 p-3 text-status-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="text-xs">Identifier conflict detected. This contact cannot be safely reused.</p>
          </div>
        )}

        <FormInput
          ref={reasonRef}
          id="separate-contact-reason"
          label="Reason for creating a separate contact"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={10}
          required
          disabled={isLoading}
          hint="Required; enter at least 10 characters."
        />
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void onCreateSeparate(trimmedReason)}
          disabled={isLoading || trimmedReason.length < 10}
        >
          Create Separate
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void onUseExisting()}
          disabled={isLoading || match.blockedByIdentifierConflict}
        >
          Use Existing
        </Button>
      </ModalFooter>
    </Modal>
  );
}
