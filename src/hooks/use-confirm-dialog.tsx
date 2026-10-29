'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { DialogVariant } from '@/components/ui/variants';

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: DialogVariant;
}

/**
 * Promise-based replacement for `window.confirm` that uses the app's dialog.
 * Render `dialog` once; `await confirm({...})` resolves true on confirm and false on cancel.
 */
export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback((next: ConfirmOptions) => {
    resolveRef.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const dialog = (
    <ConfirmDialog
      isOpen={options !== null}
      onClose={() => settle(false)}
      onConfirm={() => settle(true)}
      title={options?.title ?? ''}
      description={options?.description}
      confirmLabel={options?.confirmLabel}
      cancelLabel={options?.cancelLabel}
      variant={options?.variant ?? 'warning'}
    />
  );

  return { confirm, dialog };
}
