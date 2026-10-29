import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RecipientStatusBadge } from '@/components/esigning/esigning-shared';

describe('recipient status labels', () => {
  it('labels an active manual link without implying an email notification', () => {
    render(<RecipientStatusBadge status="NOTIFIED" accessMode="MANUAL_LINK" />);
    expect(screen.getByText('LINK READY')).toBeInTheDocument();
    expect(screen.queryByText('NOTIFIED')).not.toBeInTheDocument();
  });

  it('keeps the notification label for emailed links', () => {
    render(<RecipientStatusBadge status="NOTIFIED" accessMode="EMAIL_LINK" />);
    expect(screen.getByText('NOTIFIED')).toBeInTheDocument();
  });

  it('keeps the viewed label after a manual link is opened', () => {
    render(<RecipientStatusBadge status="VIEWED" accessMode="MANUAL_LINK" />);
    expect(screen.getByText('VIEWED')).toBeInTheDocument();
  });
});
