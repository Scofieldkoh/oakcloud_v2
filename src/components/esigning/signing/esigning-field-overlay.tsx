'use client';

import { useEffect, useState } from 'react';
import { Calendar, Check, CheckCircle2, MousePointerClick, Pen, Type } from 'lucide-react';
import type { EsigningFieldDefinitionDto } from '@/types/esigning';

export type FieldOverlayState = 'unfilled-required' | 'unfilled-optional' | 'active' | 'filled';

interface EsigningFieldOverlayProps {
  field: EsigningFieldDefinitionDto;
  state: FieldOverlayState;
  value?: string | null;
  signatureImageUrl?: string | null;
  recipientColor: string;
  onClick: () => void;
}

const ACTION_LABELS: Record<string, string> = {
  SIGNATURE: 'Sign Here',
  INITIALS: 'Initial Here',
  DATE_SIGNED: 'Date',
  CHECKBOX: 'Check',
  NAME: 'Fill In',
  TEXT: 'Fill In',
  COMPANY: 'Fill In',
  TITLE: 'Fill In',
};

function FieldIcon({ type, size = 12 }: { type: string; size?: number }) {
  const props = { style: { width: size, height: size } };
  if (type === 'SIGNATURE' || type === 'INITIALS') return <Pen {...props} />;
  if (type === 'DATE_SIGNED') return <Calendar {...props} />;
  if (type === 'CHECKBOX') return <Check {...props} />;
  return <Type {...props} />;
}

export function EsigningFieldOverlay({
  field,
  state,
  value,
  signatureImageUrl,
  recipientColor,
  onClick,
}: EsigningFieldOverlayProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const actionLabel = ACTION_LABELS[field.type] ?? 'Fill In';
  const isFilled = state === 'filled';
  const isActive = state === 'active';
  const isUnfilledRequired = state === 'unfilled-required';

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => setReduceMotion(mediaQuery.matches);

    syncPreference();
    mediaQuery.addEventListener('change', syncPreference);
    return () => mediaQuery.removeEventListener('change', syncPreference);
  }, []);

  // Base styles
  let containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    cursor: 'pointer',
    borderRadius: 4,
    overflow: 'hidden',
    userSelect: 'none',
    boxSizing: 'border-box',
  };

  if (isFilled) {
    containerStyle = {
      ...containerStyle,
      border: `1.5px solid ${recipientColor}60`,
      backgroundColor: `${recipientColor}10`,
    };
  } else if (isActive) {
    containerStyle = {
      ...containerStyle,
      border: `2px solid ${recipientColor}`,
      backgroundColor: `${recipientColor}20`,
      boxShadow: `0 0 0 3px ${recipientColor}40`,
    };
  } else if (isUnfilledRequired) {
    containerStyle = {
      ...containerStyle,
      border: `1.5px solid ${recipientColor}`,
      backgroundColor: `${recipientColor}18`,
      animation: reduceMotion ? undefined : 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
    };
  } else {
    // unfilled-optional
    containerStyle = {
      ...containerStyle,
      border: `1.5px dashed ${recipientColor}80`,
      backgroundColor: `${recipientColor}08`,
    };
  }

  function renderContent() {
    if (isFilled) {
      if ((field.type === 'SIGNATURE' || field.type === 'INITIALS') && signatureImageUrl) {
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signatureImageUrl}
            alt="Signature"
            style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }}
          />
        );
      }
      if (field.type === 'CHECKBOX') {
        return (
          <div style={{ color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Check style={{ width: 16, height: 16 }} />
          </div>
        );
      }
      // text / date / name etc.
      return (
        <span
          style={{
            fontSize: 11,
            color: '#111827',
            padding: '0 4px',
            textAlign: 'center',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}
        >
          {value}
        </span>
      );
    }

    // Unfilled states
    if (state === 'unfilled-optional') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, opacity: 0.5 }}>
          <FieldIcon type={field.type} size={10} />
          <span style={{ fontSize: 9, color: recipientColor }}>Optional</span>
        </div>
      );
    }

    // active or unfilled-required
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          color: recipientColor,
        }}
      >
        <FieldIcon type={field.type} size={12} />
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.03em' }}>
          {actionLabel}
        </span>
      </div>
    );
  }

  return (
    <div
      style={containerStyle}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={actionLabel}
    >
      {renderContent()}

      {/* Filled checkmark badge */}
      {isFilled && (
        <div
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            color: '#16a34a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CheckCircle2 style={{ width: 10, height: 10 }} />
        </div>
      )}

      {/* Click hint icon for required fields */}
      {isUnfilledRequired && (
        <div
          style={{
            position: 'absolute',
            bottom: 1,
            right: 2,
            color: recipientColor,
            opacity: 0.6,
          }}
        >
          <MousePointerClick style={{ width: 8, height: 8 }} />
        </div>
      )}
    </div>
  );
}
