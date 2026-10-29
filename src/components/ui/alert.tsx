'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { statusVariants, type StatusVariant } from './variants';

export interface AlertProps {
  variant?: StatusVariant;
  title?: string;
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
  compact?: boolean;
}

export function Alert({ variant = 'info', title, children, onClose, className, compact }: AlertProps) {
  const config = statusVariants[variant];
  const Icon = config.icon;

  return (
    <div
      role="alert"
      aria-label={title}
      className={cn(
        'flex gap-2.5 rounded-md border',
        compact ? 'p-2.5' : 'p-3',
        config.className,
        className
      )}
    >
      <Icon size={16} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        {title && (
          <p className="text-sm font-medium mb-0.5">
            {title}
          </p>
        )}
        <div className="text-sm opacity-90">
          {children}
        </div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          type="button"
          aria-label="Dismiss alert"
          className="p-1 rounded-sm hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
