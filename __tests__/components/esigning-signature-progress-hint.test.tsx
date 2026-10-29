import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  EsigningSignatureProgressHint,
  getSignatureProgressHintPlacement,
  SIGNATURE_PROGRESS_HINT_HEIGHT,
  SIGNATURE_PROGRESS_HINT_WIDTH,
} from '@/components/esigning/signing/esigning-signature-progress-hint';

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;

describe('getSignatureProgressHintPlacement', () => {
  it('places the hint to the right of the field, vertically centred', () => {
    const placement = getSignatureProgressHintPlacement(
      { xPercent: 0.1, yPercent: 0.5, widthPercent: 0.3, heightPercent: 0.1 },
      PAGE_WIDTH,
      PAGE_HEIGHT
    );
    expect(placement.side).toBe('right');
    expect(placement.left).toBe(240 + 8);
    expect(placement.top).toBe(440 - SIGNATURE_PROGRESS_HINT_HEIGHT / 2);
  });

  it('falls back to the left when the field sits near the right edge', () => {
    const placement = getSignatureProgressHintPlacement(
      { xPercent: 0.6, yPercent: 0.5, widthPercent: 0.35, heightPercent: 0.1 },
      PAGE_WIDTH,
      PAGE_HEIGHT
    );
    expect(placement.side).toBe('left');
    expect(placement.left).toBe(360 - 8 - SIGNATURE_PROGRESS_HINT_WIDTH);
  });

  it('goes above the field when neither side has room', () => {
    const placement = getSignatureProgressHintPlacement(
      { xPercent: 0.1, yPercent: 0.5, widthPercent: 0.8, heightPercent: 0.1 },
      PAGE_WIDTH,
      PAGE_HEIGHT
    );
    expect(placement.side).toBe('above');
    expect(placement.top).toBe(400 - 8 - SIGNATURE_PROGRESS_HINT_HEIGHT);
  });

  it('only drops below a full-width field at the top of the page', () => {
    const placement = getSignatureProgressHintPlacement(
      { xPercent: 0, yPercent: 0, widthPercent: 1, heightPercent: 0.05 },
      PAGE_WIDTH,
      PAGE_HEIGHT
    );
    expect(placement.side).toBe('below');
    expect(placement.top).toBe(40 + 8);
  });
});

describe('EsigningSignatureProgressHint', () => {
  it('shows the count and continue prompt on separate lines and jumps on click', () => {
    const onContinue = vi.fn();
    render(
      <EsigningSignatureProgressHint
        fieldId="f1"
        field={{ xPercent: 0.1, yPercent: 0.5, widthPercent: 0.3, heightPercent: 0.1 }}
        pageWidth={PAGE_WIDTH}
        pageHeight={PAGE_HEIGHT}
        signedCount={0}
        totalCount={7}
        isComplete={false}
        onContinue={onContinue}
      />
    );
    const hint = screen.getByTestId('signature-progress-banner-f1');
    expect(screen.getByText('0 out of 7 signed')).toBeInTheDocument();
    expect(screen.getByText('Click to continue to')).toBeInTheDocument();
    expect(screen.getByText('next field')).toBeInTheDocument();
    expect(hint).toHaveAttribute('data-side', 'right');
    fireEvent.click(hint);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
