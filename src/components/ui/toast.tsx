'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { statusVariants, type StatusVariant } from './variants';

// Toast types
type ToastVariant = StatusVariant;

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, variant?: ToastVariant, duration?: number) => void;
  removeToast: (id: string) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Toast Provider
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, variant: ToastVariant = 'info', duration: number = 5000) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const toast: Toast = { id, message, variant, duration };

      setToasts((prev) => [...prev, toast]);

      // Auto remove after duration
      if (duration > 0) {
        setTimeout(() => removeToast(id), duration);
      }

      return id;
    },
    [removeToast]
  );

  // Convenience methods
  const success = useCallback(
    (message: string, duration?: number) => addToast(message, 'success', duration),
    [addToast]
  );
  const error = useCallback(
    (message: string, duration?: number) => addToast(message, 'error', duration),
    [addToast]
  );
  const warning = useCallback(
    (message: string, duration?: number) => addToast(message, 'warning', duration),
    [addToast]
  );
  const info = useCallback(
    (message: string, duration?: number) => addToast(message, 'info', duration),
    [addToast]
  );

  return (
    <ToastContext.Provider
      value={{ toasts, addToast, removeToast, success, error, warning, info }}
    >
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

// Hook to use toast
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// Toast container (renders via portal)
function ToastContainer({
  toasts,
  onRemove,
}: {
  toasts: Toast[];
  onRemove: (id: string) => void;
}) {
  if (typeof window === 'undefined' || toasts.length === 0) return null;

  return createPortal(
    <div className="fixed bottom-2 sm:bottom-4 left-2 right-2 sm:left-auto sm:right-4 z-[100] flex flex-col gap-2 sm:max-w-sm sm:w-full pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>,
    document.body
  );
}

// Individual toast item
function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const config = statusVariants[toast.variant];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-elevation-2 animate-slide-in-right',
        'bg-background-elevated',
        config.bgClass,
        config.borderClass
      )}
      role="alert"
    >
      <Icon className={cn('w-5 h-5 flex-shrink-0 mt-0.5', config.colorClass)} />
      <p className="flex-1 text-sm text-text-primary">{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className="p-2 sm:p-1 -m-1 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// Standalone toast function for non-component contexts
let toastHandler: ToastContextValue | null = null;

export function setToastHandler(handler: ToastContextValue) {
  toastHandler = handler;
}

export const toast = {
  success: (message: string, duration?: number) => toastHandler?.success(message, duration),
  error: (message: string, duration?: number) => toastHandler?.error(message, duration),
  warning: (message: string, duration?: number) => toastHandler?.warning(message, duration),
  info: (message: string, duration?: number) => toastHandler?.info(message, duration),
};
