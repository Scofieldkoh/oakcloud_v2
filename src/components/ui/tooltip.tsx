'use client';

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
  disabled?: boolean;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const tooltipEl = tooltipRef.current;
    const tooltipHeight = tooltipEl?.offsetHeight ?? 32;
    const tooltipWidth = tooltipEl?.offsetWidth ?? 200;

    let targetSide = side;
    if (side === 'top' && rect.top - tooltipHeight - 10 < 8) {
      targetSide = 'bottom';
    } else if (side === 'bottom' && rect.bottom + tooltipHeight + 10 > window.innerHeight - 8) {
      targetSide = 'top';
    }

    const top = targetSide === 'top' ? rect.top - tooltipHeight - 8 : rect.bottom + 8;
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;

    const padding = 12;
    if (left < padding) {
      left = padding;
    } else if (left + tooltipWidth > window.innerWidth - padding) {
      left = window.innerWidth - padding - tooltipWidth;
    }

    setPosition({ top, left });
  }, [side]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  if (disabled || !content) {
    return <>{children}</>;
  }

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && mounted && typeof document !== 'undefined' &&
        createPortal(
          <span
            ref={tooltipRef}
            role="tooltip"
            style={{
              position: 'fixed',
              top: `${position.top}px`,
              left: `${position.left}px`,
            }}
            className={cn(
              'pointer-events-none z-[9999] w-max max-w-[min(24rem,calc(100vw-2rem))] whitespace-normal break-words rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-elevation-2 transition-opacity duration-150 animate-fade-in'
            )}
          >
            {content}
          </span>,
          document.body
        )}
    </span>
  );
}
