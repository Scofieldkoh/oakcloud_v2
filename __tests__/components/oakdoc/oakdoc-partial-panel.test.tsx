import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const partialsQuery = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/hooks/use-template-partials', () => ({
  useAllTemplatePartials: () => partialsQuery.value,
}));

import { OakDocPartialPanel } from '@/components/documents/oakdoc/oakdoc-partial-panel';

const wordPartial = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'scope',
  displayName: 'Scope of work',
  description: null,
  placeholders: [],
  version: 3,
  documentEngine: 'OAKDOC' as const,
};
const htmlPartial = { ...wordPartial, id: '22222222-2222-4222-8222-222222222222', name: 'legacy', displayName: 'Legacy HTML', documentEngine: 'A4' as const };

beforeEach(() => {
  partialsQuery.value = { data: { partials: [wordPartial, htmlPartial] }, isLoading: false, error: null };
});

describe('OakDocPartialPanel', () => {
  it('offers only Word partials and inserts the chosen one', () => {
    const onInsert = vi.fn();
    render(<OakDocPartialPanel tenantId="tenant-1" referencedIds={[]} disabled={false} onInsert={onInsert} />);

    expect(screen.queryByText('Legacy HTML')).toBeNull();
    fireEvent.click(screen.getByText('Scope of work'));
    expect(onInsert).toHaveBeenCalledWith(wordPartial);
    expect(screen.getByText('scope · v3')).toBeTruthy();
  });

  it('marks used partials and warns about references to missing ones', () => {
    render(
      <OakDocPartialPanel
        tenantId="tenant-1"
        referencedIds={[wordPartial.id, '33333333-3333-4333-8333-333333333333']}
        disabled={false}
        onInsert={vi.fn()}
      />,
    );
    expect(screen.getByTitle('Used in this document')).toBeTruthy();
    expect(screen.getByText(/One partial in this document no longer exists/)).toBeTruthy();
  });

  it('offers to move to the latest version when the template pins an older one', () => {
    const onRefreshLatestChange = vi.fn();
    render(
      <OakDocPartialPanel
        tenantId="tenant-1"
        referencedIds={[wordPartial.id]}
        disabled={false}
        onInsert={vi.fn()}
        pinnedVersions={{ [wordPartial.id]: 2 }}
        refreshLatest={false}
        onRefreshLatestChange={onRefreshLatestChange}
      />,
    );
    expect(screen.getByText('scope · v3 (this template uses v2)')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Use the latest partial versions/));
    expect(onRefreshLatestChange).toHaveBeenCalledWith(true);
  });
});
