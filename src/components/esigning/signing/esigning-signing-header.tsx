'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileSignature, Info, LogOut, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EsigningSigningHeaderProps {
  envelopeTitle: string;
  senderName: string;
  tenantName: string;
  completedCount: number;
  requiredCount: number;
  canFinish: boolean;
  onPrimaryAction: () => void;
  onDecline: () => void;
  onFinishLater: () => void;
  onDownloadOriginal: () => void;
  recipientName: string;
  recipientEmail: string | null;
  envelopeId: string;
  isFinishing: boolean;
}

export function EsigningSigningHeader({
  envelopeTitle,
  completedCount,
  requiredCount,
  canFinish,
  onPrimaryAction,
  onDecline,
  onFinishLater,
  onDownloadOriginal,
  recipientName,
  recipientEmail,
  envelopeId,
  isFinishing,
}: EsigningSigningHeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showSessionInfo, setShowSessionInfo] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  const progressPct = requiredCount > 0 ? (completedCount / requiredCount) * 100 : 0;

  return (
    <header className="sticky top-0 z-50 bg-background-secondary border-b border-border-primary px-3 py-2 sm:px-4 sm:py-3">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-2 sm:gap-4">
        {/* Left: badge + title */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border-primary bg-background-tertiary px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
              <span className="font-semibold tracking-[0.12em] text-oak-primary">Oaktree</span>
              <span className="hidden items-center gap-1.5 sm:inline-flex">
                <FileSignature className="h-3 w-3" />
                Secure E-Sign
              </span>
            </div>
            <h1 className="truncate text-sm font-semibold text-text-primary sm:text-base">
              {envelopeTitle}
            </h1>
          </div>
        </div>

        {/* Center: progress */}
        <div className="hidden w-48 shrink-0 flex-col items-center gap-1 md:flex">
          <span className="text-xs text-text-secondary">
            {completedCount} of {requiredCount} required fields
          </span>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-tertiary">
            <div
              className="h-full rounded-full bg-oak-primary transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Other Options dropdown */}
          <div className="relative" ref={menuRef}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              rightIcon={<ChevronDown className="h-3.5 w-3.5" />}
            >
              <span className="sm:hidden">Options</span>
              <span className="hidden sm:inline">Other Options</span>
            </Button>

            {isMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-2xl border border-border-primary bg-background-secondary shadow-lg">
                <button
                  type="button"
                  onClick={() => { onFinishLater(); setIsMenuOpen(false); }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-text-primary hover:bg-background-tertiary"
                >
                  <LogOut className="h-4 w-4 text-text-muted" />
                  Finish Later
                </button>
                <button
                  type="button"
                  onClick={() => { onDecline(); setIsMenuOpen(false); }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-rose-600 hover:bg-rose-50"
                >
                  <X className="h-4 w-4" />
                  Decline to Sign
                </button>
                <button
                  type="button"
                  onClick={() => { onDownloadOriginal(); setIsMenuOpen(false); }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-text-primary hover:bg-background-tertiary"
                >
                  <Download className="h-4 w-4 text-text-muted" />
                  Download Original
                </button>
                <button
                  type="button"
                  onClick={() => setShowSessionInfo((prev) => !prev)}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-text-primary hover:bg-background-tertiary"
                >
                  <Info className="h-4 w-4 text-text-muted" />
                  Session Information
                </button>
                {showSessionInfo && (
                  <div className="border-t border-border-primary bg-background-tertiary px-4 py-3 text-xs text-text-secondary">
                    <div className="space-y-1">
                      <div>
                        <span className="font-medium text-text-primary">Name:</span> {recipientName}
                      </div>
                      <div className="break-all">
                        <span className="font-medium text-text-primary">Email:</span> {recipientEmail || 'Not provided'}
                      </div>
                      <div className="break-all">
                        <span className="font-medium text-text-primary">Envelope ID:</span>{' '}
                        {envelopeId}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* CTA */}
          <Button
            onClick={onPrimaryAction}
            disabled={requiredCount === 0 || isFinishing}
            isLoading={isFinishing}
            size="sm"
          >
            {canFinish ? 'Finish' : 'Next Field'}
          </Button>
        </div>
      </div>

      {/* Mobile progress bar */}
      <div className="mt-2 flex items-center gap-2 md:hidden">
        <span className="text-xs text-text-secondary">
          {completedCount}/{requiredCount} fields
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background-tertiary">
          <div
            className="h-full rounded-full bg-oak-primary transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    </header>
  );
}
