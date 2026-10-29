import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentPartyChoiceList } from '@/components/documents/document-party-choice-list';

const options = [
  {
    id: 'one',
    contactId: 'c1',
    name: 'Alice Tan',
    detail: 'Director',
    email: 'alice@example.com',
    phone: null,
    address: { full: null, letter: null },
  },
  {
    id: 'two',
    contactId: 'c2',
    name: 'Ben Lim',
    detail: 'Director',
    email: 'ben@example.com',
    phone: null,
    address: { full: null, letter: null },
  },
];

describe('DocumentPartyChoiceList', () => {
  it('selects one party through native radio semantics', () => {
    const onChange = vi.fn();
    render(
      <DocumentPartyChoiceList
        id="director"
        label="Director"
        options={options}
        value=""
        onChange={onChange}
        isLoading={false}
        required
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /Alice Tan/ }));
    expect(onChange).toHaveBeenCalledWith('one');
  });

  it('selects multiple parties through checkbox semantics', () => {
    const onChange = vi.fn();
    render(
      <DocumentPartyChoiceList
        id="directors"
        label="Directors"
        options={options}
        values={['one', 'two']}
        onChange={onChange}
        multiple
        isLoading={false}
      />,
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getAllByRole('checkbox').every((checkbox) => (
      (checkbox as HTMLInputElement).checked
    ))).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /Alice Tan/ }));
    expect(onChange).toHaveBeenCalledWith(['two']);
  });

  it('filters rows while retaining the selected party', () => {
    render(
      <DocumentPartyChoiceList
        id="director"
        label="Director"
        options={options}
        value="one"
        onChange={vi.fn()}
        isLoading={false}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search director' }), {
      target: { value: 'Ben' },
    });

    expect(screen.getByRole('radio', { name: /Alice Tan/ })).toBeVisible();
    expect(screen.getByRole('radio', { name: /Ben Lim/ })).toBeVisible();
  });

  it('links linked parties to their contact details in a new tab', () => {
    render(
      <DocumentPartyChoiceList
        id="director"
        label="Director"
        options={options}
        value=""
        onChange={vi.fn()}
        isLoading={false}
      />,
    );

    const link = screen.getByRole('link', {
      name: 'Open Alice Tan contact details in a new tab',
    });
    expect(link).toHaveAttribute('href', '/contacts/c1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('keeps the party tile selectable without selecting when its name link is clicked', () => {
    const onChange = vi.fn();
    render(
      <DocumentPartyChoiceList
        id="director"
        label="Director"
        options={options}
        value=""
        onChange={onChange}
        isLoading={false}
      />,
    );

    fireEvent.click(screen.getByRole('link', {
      name: 'Open Alice Tan contact details in a new tab',
    }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: /Alice Tan/ }));
    expect(onChange).toHaveBeenCalledWith('one');
  });

  it('keeps retry and empty states inside the selection section', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <DocumentPartyChoiceList
        id="director"
        label="Director"
        options={[]}
        value=""
        onChange={vi.fn()}
        isLoading={false}
        error="Failed to load company party options."
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry party options' }));
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(
      <DocumentPartyChoiceList
        id="director"
        label="Director"
        options={[]}
        value=""
        onChange={vi.fn()}
        isLoading={false}
      />,
    );
    expect(screen.getByText('No director options are available for this company.')).toBeVisible();
  });
});
