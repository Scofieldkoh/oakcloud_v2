import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BatchSection } from '@/components/documents/generation-batch/batch-section';

describe('BatchSection', () => {
  it('uses a muted dark orange header for incomplete sections and green for complete sections', () => {
    render(
      <>
        <BatchSection title="Needs input" status={{ complete: false, label: 'Required' }}>
          <p>Incomplete content</p>
        </BatchSection>
        <BatchSection title="Ready" status={{ complete: true, label: 'Complete' }}>
          <p>Complete content</p>
        </BatchSection>
      </>,
    );

    expect(screen.getByRole('heading', { name: 'Needs input' }).closest('header'))
      .toHaveClass('bg-[#9b6348]');
    expect(screen.getByRole('heading', { name: 'Ready' }).closest('header'))
      .toHaveClass('bg-oak-primary');
  });
});
