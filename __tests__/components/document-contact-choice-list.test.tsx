import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DocumentContactChoiceList,
  type DocumentContact,
} from '@/components/documents/document-contact-choice-list';

const contacts: DocumentContact[] = [
  {
    id: 'one',
    fullName: 'Jane Tan',
    email: 'jane@example.com',
    phone: null,
    designation: 'Manager',
  },
  {
    id: 'two',
    fullName: 'Ray Lim',
    email: 'ray@example.com',
    phone: null,
    designation: 'Secretary',
  },
];

describe('DocumentContactChoiceList', () => {
  it('adds and removes contacts through native checkboxes', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DocumentContactChoiceList contacts={contacts} selected={[]} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /Jane Tan/ }));
    expect(onChange).toHaveBeenCalledWith([contacts[0]]);

    rerender(
      <DocumentContactChoiceList contacts={contacts} selected={[contacts[0]]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Jane Tan/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('shows selected count and clears every selection', () => {
    const onChange = vi.fn();
    render(
      <DocumentContactChoiceList contacts={contacts} selected={contacts} onChange={onChange} />,
    );

    expect(screen.getByText('2 selected')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all contacts' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('links contacts to their contact details in a new tab', () => {
    render(
      <DocumentContactChoiceList contacts={contacts} selected={[]} onChange={vi.fn()} />,
    );

    const link = screen.getByRole('link', {
      name: 'Open Jane Tan contact details in a new tab',
    });
    expect(link).toHaveAttribute('href', '/contacts/one');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('keeps the contact tile selectable without selecting when its name link is clicked', () => {
    const onChange = vi.fn();
    render(
      <DocumentContactChoiceList contacts={contacts} selected={[]} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('link', {
      name: 'Open Jane Tan contact details in a new tab',
    }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: /Jane Tan/ }));
    expect(onChange).toHaveBeenCalledWith([contacts[0]]);
  });

  it('retains selected contacts while filtering and forwards search', () => {
    const onSearch = vi.fn();
    render(
      <DocumentContactChoiceList
        contacts={contacts}
        selected={[contacts[0]]}
        onChange={vi.fn()}
        onSearch={onSearch}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search contacts' }), {
      target: { value: 'Ray' },
    });

    expect(onSearch).toHaveBeenCalledWith('Ray');
    expect(screen.getByRole('checkbox', { name: /Jane Tan/ })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /Ray Lim/ })).toBeVisible();
  });
});
