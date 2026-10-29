'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyButtonProps {
  value: string;
  className?: string;
  /** Accessible label describing what is being copied */
  label?: string;
}

export function CopyButton({ value, className = '', label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Failed to copy
    }
  };

  const ariaLabel = copied
    ? `Copied${label ? ` ${label}` : ''}`
    : `Copy${label ? ` ${label}` : ''}`;

  return (
    <button
      onClick={handleCopy}
      className={`p-1 rounded hover:bg-surface-tertiary transition-colors ${className}`}
      aria-label={ariaLabel}
    >
      {copied ? (
        <Check className="w-3 h-3 text-status-success" aria-hidden="true" />
      ) : (
        <Copy className="w-3 h-3 text-text-muted hover:text-text-secondary" aria-hidden="true" />
      )}
      {/* Screen reader announcement for copy state */}
      {copied && (
        <span className="sr-only" role="status" aria-live="polite">
          Copied to clipboard
        </span>
      )}
    </button>
  );
}
