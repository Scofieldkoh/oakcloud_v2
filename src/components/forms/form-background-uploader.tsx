'use client';

import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export function FormBackgroundUploader({
  formId,
  value,
  opacity,
  onUrlChange,
  onOpacityChange,
}: {
  formId: string;
  value: string | null;
  opacity: number;
  onUrlChange: (url: string | null) => void;
  onOpacityChange: (opacity: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function handleFile(file: File) {
    setErrorText(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setErrorText('Only image files (PNG, JPG, WebP, GIF) are allowed');
      return;
    }

    if (file.size > MAX_SIZE_BYTES) {
      setErrorText('Background image must be 5MB or smaller');
      return;
    }

    setIsUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`/api/forms/${formId}/background`, {
        method: 'POST',
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload background image');
      }
      onUrlChange(data.backgroundImageUrl as string);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Failed to upload background image');
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-24 w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border',
            value
              ? 'border-border-primary bg-background-secondary'
              : 'border-dashed border-border-primary/60 bg-background-secondary'
          )}
        >
          {value ? (
            <div
              aria-hidden="true"
              className="h-full w-full bg-cover bg-center bg-no-repeat"
              style={{ backgroundImage: `url("${value}")` }}
            />
          ) : (
            <UploadCloud className="h-6 w-6 text-text-muted" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            aria-label="Upload background image"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <button
            type="button"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center justify-center rounded-lg border border-border-primary bg-background-elevated px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-background-tertiary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploading ? 'Uploading...' : value ? 'Replace image' : 'Upload image'}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onUrlChange(null)}
              className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm text-status-error transition-colors hover:bg-status-error/5"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {value && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Background opacity</span>
          <input
            type="range"
            min={0}
            max={100}
            value={opacity}
            onChange={(event) => onOpacityChange(Number(event.target.value))}
            className="w-full"
            aria-label="Background opacity"
          />
          <span className="mt-0.5 block text-2xs text-text-muted">{opacity}%</span>
        </label>
      )}

      {errorText && <p className="text-xs text-status-error">{errorText}</p>}
      {!value && !errorText && (
        <p className="text-2xs text-text-muted">
          Shown behind the form. The default gradient stays visible. PNG, JPG, WebP or GIF up to 5MB.
        </p>
      )}
    </div>
  );
}
