'use client';

export const SIGNATURE_PROGRESS_HINT_WIDTH = 140;
export const SIGNATURE_PROGRESS_HINT_HEIGHT = 58;
const HINT_GAP = 8;

export type SignatureProgressHintSide = 'right' | 'left' | 'above' | 'below';

export interface SignatureProgressHintPlacement {
  side: SignatureProgressHintSide;
  left: number;
  top: number;
}

interface FieldRect {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Places the hint beside the signature field so it never covers the text under it
 * (signer name, title). Prefers the right, then the left, then above, and only
 * drops below the field when nothing else fits.
 */
export function getSignatureProgressHintPlacement(
  field: FieldRect,
  pageWidth: number,
  pageHeight: number,
  hintWidth = SIGNATURE_PROGRESS_HINT_WIDTH,
  hintHeight = SIGNATURE_PROGRESS_HINT_HEIGHT
): SignatureProgressHintPlacement {
  const fieldLeft = field.xPercent * pageWidth;
  const fieldTop = field.yPercent * pageHeight;
  const fieldRight = fieldLeft + field.widthPercent * pageWidth;
  const fieldBottom = fieldTop + field.heightPercent * pageHeight;
  const centredTop = clamp(
    (fieldTop + fieldBottom) / 2 - hintHeight / 2,
    0,
    pageHeight - hintHeight
  );

  if (fieldRight + HINT_GAP + hintWidth <= pageWidth) {
    return { side: 'right', left: fieldRight + HINT_GAP, top: centredTop };
  }
  if (fieldLeft - HINT_GAP - hintWidth >= 0) {
    return { side: 'left', left: fieldLeft - HINT_GAP - hintWidth, top: centredTop };
  }

  const alignedLeft = clamp(fieldLeft, 0, pageWidth - hintWidth);
  if (fieldTop - HINT_GAP - hintHeight >= 0) {
    return { side: 'above', left: alignedLeft, top: fieldTop - HINT_GAP - hintHeight };
  }
  return {
    side: 'below',
    left: alignedLeft,
    top: clamp(fieldBottom + HINT_GAP, 0, pageHeight - hintHeight),
  };
}

interface EsigningSignatureProgressHintProps {
  fieldId: string;
  field: FieldRect;
  pageWidth: number;
  pageHeight: number;
  signedCount: number;
  totalCount: number;
  isComplete: boolean;
  onContinue: () => void;
}

export function EsigningSignatureProgressHint({
  fieldId,
  field,
  pageWidth,
  pageHeight,
  signedCount,
  totalCount,
  isComplete,
  onContinue,
}: EsigningSignatureProgressHintProps) {
  const { side, left, top } = getSignatureProgressHintPlacement(field, pageWidth, pageHeight);
  const lines = isComplete
    ? ['All required fields', 'are complete.']
    : ['Click to continue to', 'next field'];

  return (
    <button
      data-testid={`signature-progress-banner-${fieldId}`}
      data-side={side}
      type="button"
      disabled={isComplete}
      onClick={onContinue}
      className="text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oak-primary"
      style={{
        position: 'absolute',
        left,
        top,
        width: SIGNATURE_PROGRESS_HINT_WIDTH,
        minHeight: SIGNATURE_PROGRESS_HINT_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '6px 10px',
        border: '1px solid rgba(41, 77, 68, 0.22)',
        borderRadius: 10,
        background: 'rgba(247, 251, 249, 0.96)',
        color: '#294d44',
        boxShadow: '0 4px 12px rgba(15, 23, 42, 0.12)',
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.25,
        pointerEvents: 'auto',
        cursor: isComplete ? 'default' : 'pointer',
      }}
    >
      <span>
        {signedCount} out of {totalCount} signed
      </span>
      {lines.map((line) => (
        <span key={line} style={{ fontWeight: 500 }}>
          {line}
        </span>
      ))}
    </button>
  );
}
