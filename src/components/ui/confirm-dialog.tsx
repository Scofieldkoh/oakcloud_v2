'use client';

import { useId, useState, type ReactNode } from 'react';
import { Modal, ModalBody, ModalFooter } from './modal';
import { Button } from './button';
import { FormInput } from './form-input';
import { cn } from '@/lib/utils';
import { dialogVariants, type DialogVariant } from './variants';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void | Promise<void>;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: DialogVariant;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonMinLength?: number;
  isLoading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  requireReason = false,
  reasonLabel = 'Reason',
  reasonPlaceholder = 'Please provide a reason...',
  reasonMinLength = 10,
  isLoading = false,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;

  const config = dialogVariants[variant];
  const Icon = config.icon;
  const isBusy = isLoading || isSubmitting;

  const handleConfirm = async () => {
    if (isBusy) {
      return;
    }

    if (requireReason) {
      if (!reason.trim()) {
        setError('Reason is required');
        return;
      }
      if (reason.trim().length < reasonMinLength) {
        setError(`Reason must be at least ${reasonMinLength} characters`);
        return;
      }
    }

    setError('');
    setIsSubmitting(true);

    try {
      await onConfirm(requireReason ? reason.trim() : undefined);
      setReason('');
    } catch {
      // The owning workflow displays the recoverable error and may allow retry.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isBusy) {
      return;
    }

    setReason('');
    setError('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="sm"
      showCloseButton={false}
      closeOnOverlayClick={!isBusy}
      closeOnEscape={!isBusy}
      ariaLabelledBy={titleId}
      ariaDescribedBy={description ? descriptionId : undefined}
    >
      <ModalBody>
        <div className="flex flex-col items-center text-center">
          <div className={cn('p-3 rounded-full mb-4', config.iconBgClass)}>
            <Icon className={cn('w-6 h-6', config.iconColorClass)} />
          </div>
          <h3 id={titleId} className="text-lg font-semibold text-text-primary mb-2">{title}</h3>
          {description && (
            <div id={descriptionId} className="text-sm text-text-secondary mb-4">{description}</div>
          )}

          {requireReason && (
            <div className="w-full text-left mt-2">
              <FormInput
                label={reasonLabel}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (error) setError('');
                }}
                placeholder={reasonPlaceholder}
                error={error}
                disabled={isBusy}
                inputSize="sm"
              />
            </div>
          )}

          {children && (
            <div className="w-full text-left mt-3">
              {children}
            </div>
          )}
        </div>
      </ModalBody>

      <ModalFooter className="justify-center">
        <Button
          variant="secondary"
          size="sm"
          className="min-h-11 sm:min-h-8"
          onClick={handleClose}
          disabled={isBusy}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={config.buttonVariant}
          size="sm"
          className="min-h-11 sm:min-h-8"
          onClick={handleConfirm}
          isLoading={isBusy}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
