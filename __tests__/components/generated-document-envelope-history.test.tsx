import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GeneratedDocumentEnvelopeHistory } from '@/components/documents/generated-document-envelope-history';

describe('GeneratedDocumentEnvelopeHistory', () => {
  it('links every envelope and shows its completion state', () => {
    render(
      <GeneratedDocumentEnvelopeHistory
        envelopes={[
          {
            id: 'completed-envelope',
            title: 'Director resolution signing',
            status: 'COMPLETED',
            completedAt: '2026-08-31T12:00:00.000Z',
          },
          {
            id: 'pending-envelope',
            title: 'Replacement signing',
            status: 'IN_PROGRESS',
            completedAt: null,
          },
        ]}
      />,
    );

    expect(screen.getByRole('link', { name: /Director resolution signing/i }))
      .toHaveAttribute('href', '/esigning/completed-envelope');
    expect(screen.getByText(/Completed .*2026/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Replacement signing/i }))
      .toHaveAttribute('href', '/esigning/pending-envelope');
    expect(screen.getByText('Not completed · In progress')).toBeInTheDocument();
  });

  it('shows a compact empty state when no envelopes are linked', () => {
    render(<GeneratedDocumentEnvelopeHistory envelopes={[]} />);

    expect(screen.getByText('No envelopes linked to this document.')).toBeInTheDocument();
  });
});
