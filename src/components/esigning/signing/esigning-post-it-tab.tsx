'use client';

import { Calendar, Check, CheckCircle2, ChevronDown, ChevronUp, Pen, Type } from 'lucide-react';

interface EsigningPostItTabProps {
  label: string;
  isComplete: boolean;
  currentIndex: number;
  totalCount: number;
  onClick: () => void;
  onNext: () => void;
  onPrev: () => void;
}

function TabIcon({ label }: { label: string }) {
  if (label === 'Sign') return <Pen className="h-4 w-4" />;
  if (label === 'Initial') return <Pen className="h-4 w-4" />;
  if (label === 'Check') return <Check className="h-4 w-4" />;
  if (label === 'Date') return <Calendar className="h-4 w-4" />;
  if (label === 'Finish') return <CheckCircle2 className="h-4 w-4" />;
  return <Type className="h-4 w-4" />;
}

export function EsigningPostItTab({
  label,
  isComplete,
  currentIndex,
  totalCount,
  onClick,
  onNext,
  onPrev,
}: EsigningPostItTabProps) {
  const bgColor = isComplete ? '#16a34a' : '#294d44';

  return (
    <div
      data-testid="signing-post-it"
      style={{
        position: 'absolute',
        right: -56,
        width: 56,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
      }}
    >
      {/* Prev button */}
      {!isComplete && totalCount > 1 && (
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous field"
          style={{
            backgroundColor: bgColor,
            color: 'white',
            borderRadius: '0 6px 0 0',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.2)',
            cursor: 'pointer',
            minWidth: 56,
            minHeight: 44,
          }}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Main tab */}
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        style={{
          backgroundColor: bgColor,
          color: 'white',
          borderRadius: isComplete ? '0 8px 8px 0' : '0',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          boxShadow: '2px 2px 8px rgba(0,0,0,0.25)',
          minWidth: 56,
          minHeight: 64,
          transition: 'filter 0.15s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.filter = 'brightness(1.15)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.filter = '';
        }}
      >
        <TabIcon label={isComplete ? 'Finish' : label} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          {isComplete ? 'Finish' : label}
        </span>
        {!isComplete && totalCount > 0 && (
          <span style={{ fontSize: 10, opacity: 0.75 }}>
            {currentIndex + 1}/{totalCount}
          </span>
        )}
      </button>

      {/* Next button */}
      {!isComplete && totalCount > 1 && (
        <button
          type="button"
          onClick={onNext}
          aria-label="Next field"
          style={{
            backgroundColor: bgColor,
            color: 'white',
            borderRadius: '0 0 6px 0',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderTop: '1px solid rgba(255,255,255,0.2)',
            cursor: 'pointer',
            minWidth: 56,
            minHeight: 44,
          }}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
