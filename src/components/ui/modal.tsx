'use client';

import { useEffect, useCallback, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  titleBadge?: React.ReactNode;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'wide' | 'full';
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  placement?: 'center' | 'bottom';
  className?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
}

// Mobile-first sizing: smaller screens use more width, larger screens use fixed max-width
const sizeClasses = {
  sm: 'max-w-[calc(100vw-2rem)] sm:max-w-sm',      // Mobile: full width - padding, SM+: 384px
  md: 'max-w-[calc(100vw-2rem)] sm:max-w-md',      // Mobile: full width - padding, SM+: 448px
  lg: 'max-w-[calc(100vw-2rem)] sm:max-w-lg',      // Mobile: full width - padding, SM+: 512px
  xl: 'max-w-[calc(100vw-2rem)] sm:max-w-xl',      // Mobile: full width - padding, SM+: 576px
  '2xl': 'max-w-[calc(100vw-2rem)] sm:max-w-2xl',  // Mobile: full width - padding, SM+: 672px
  '4xl': 'max-w-[calc(100vw-2rem)] md:max-w-4xl',  // Mobile: full width - padding, MD+: 896px
  '5xl': 'max-w-[calc(100vw-2rem)] md:max-w-5xl',  // Mobile: full width - padding, MD+: 1024px
  '6xl': 'max-w-[calc(100vw-2rem)] lg:max-w-6xl',  // Mobile: full width - padding, LG+: 1152px
  '7xl': 'max-w-[calc(100vw-2rem)] xl:max-w-7xl',  // Mobile: full width - padding, XL+: 1280px
  wide: 'max-w-[calc(100vw-2rem)] xl:max-w-[1550px]', // Mobile: full width - padding, XL+: 1550px (1.5x of 6xl)
  full: 'max-w-[calc(100vw-2rem)] sm:max-w-[90vw]', // Always responsive
};

const openModalStack: string[] = [];
const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({
  isOpen,
  onClose,
  title,
  titleBadge,
  description,
  children,
  size = 'md',
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  placement = 'center',
  className,
  ariaLabelledBy,
  ariaDescribedBy,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const modalId = useId();
  const titleId = `${modalId}-title`;
  const descriptionId = `${modalId}-description`;

  // Handle escape key - use stable callback
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        if (openModalStack.at(-1) !== modalId) return;
        e.stopPropagation(); // Prevent other handlers from also responding to Escape
        e.stopImmediatePropagation();
        onCloseRef.current();
      }
    },
    [closeOnEscape, modalId]
  );

  const handleTab = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || openModalStack.at(-1) !== modalId) return;
    const content = contentRef.current;
    if (!content) return;
    const focusable = [...content.querySelectorAll<HTMLElement>(focusableSelector)];
    if (focusable.length === 0) {
      e.preventDefault();
      content.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (e.shiftKey && (
      document.activeElement === content ||
      document.activeElement === first ||
      !content.contains(document.activeElement)
    )) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !content.contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  }, [modalId]);

  // Handle overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current && closeOnOverlayClick) {
        onCloseRef.current();
      }
    },
    [closeOnOverlayClick]
  );

  // Add/remove event listeners and body scroll lock
  useEffect(() => {
    if (isOpen) {
      const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const priorOverflow = document.body.style.overflow;
      openModalStack.push(modalId);
      document.addEventListener('keydown', handleEscape);
      document.addEventListener('keydown', handleTab);
      document.body.style.overflow = 'hidden';
      contentRef.current?.focus();

      return () => {
        document.removeEventListener('keydown', handleEscape);
        document.removeEventListener('keydown', handleTab);
        const stackIndex = openModalStack.lastIndexOf(modalId);
        if (stackIndex >= 0) openModalStack.splice(stackIndex, 1);
        document.body.style.overflow = openModalStack.length > 0 ? 'hidden' : priorOverflow;
        if (previouslyFocused?.isConnected) previouslyFocused.focus();
      };
    }
  }, [handleEscape, handleTab, isOpen, modalId]);

  if (!isOpen) return null;

  const modalContent = (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className={cn(
        'fixed inset-0 z-50 flex justify-center bg-black/60 backdrop-blur-sm animate-fade-in',
        placement === 'bottom' ? 'items-end' : 'items-center p-4'
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy ?? (title ? titleId : undefined)}
      aria-describedby={ariaDescribedBy ?? (description ? descriptionId : undefined)}
    >
      <div
        ref={contentRef}
        tabIndex={-1}
        className={cn(
          'w-full bg-background-secondary border border-border-primary rounded-2xl shadow-elevation-3 outline-none',
          'transform transition-all duration-150',
          placement === 'center' && 'max-h-[calc(100vh-2rem)] overflow-y-auto',
          placement === 'bottom' &&
            'max-h-[80vh] overflow-y-auto rounded-b-none border-b-0',
          sizeClasses[size],
          className
        )}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="sticky top-0 z-20 flex items-start justify-between border-b border-border-primary bg-background-secondary p-4">
            <div>
              {(title || titleBadge) && (
                <div className="flex flex-wrap items-center gap-2">
                  {title && (
                    <h2 id={titleId} className="text-lg font-semibold text-text-primary">
                      {title}
                    </h2>
                  )}
                  {titleBadge}
                </div>
              )}
              {description && (
                <p id={descriptionId} className="text-sm text-text-secondary mt-1">
                  {description}
                </p>
              )}
            </div>
            {showCloseButton && (
              <button
                onClick={onClose}
                className="flex min-h-12 min-w-12 items-center justify-center rounded text-text-muted transition-colors hover:bg-background-elevated hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30 focus-visible:ring-offset-2"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className={cn(!title && !showCloseButton && 'pt-4')}>{children}</div>
      </div>
    </div>
  );

  // Use portal to render modal at document body level
  if (typeof window === 'undefined') return null;
  return createPortal(modalContent, document.body);
}

// Modal subcomponents for flexible composition
export function ModalBody({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props}>{children}</div>;
}

export function ModalFooter({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 border-t border-border-primary bg-background-secondary p-4', className)}
      {...props}
    >
      {children}
    </div>
  );
}
