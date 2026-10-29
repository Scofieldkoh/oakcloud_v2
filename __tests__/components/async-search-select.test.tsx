import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { AsyncSearchSelect, type AsyncSearchSelectOption } from '@/components/ui/async-search-select';

const options: AsyncSearchSelectOption[] = [
  { id: 'company-1', label: 'Acme Holdings', description: '202600001A' },
  { id: 'company-2', label: 'Beta Services', description: '202600002B' },
];

function mockScrollIntoView() {
  const original = HTMLElement.prototype.scrollIntoView;
  const spy = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: spy,
  });
  return () => {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        writable: true,
        value: original,
      });
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  };
}

describe('AsyncSearchSelect', () => {
  it('exposes labelled combobox and listbox semantics with accessible paging and clear controls', async () => {
    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 54,
      left: 20,
      right: 340,
      width: 320,
      height: 44,
      x: 20,
      y: 10,
      toJSON: () => ({}),
    });
    const restoreScrollIntoView = mockScrollIntoView();
    const onChange = vi.fn();
    const onSearchChange = vi.fn();

    try {
      function Harness() {
        const [value, setValue] = useState('');
        return (
          <AsyncSearchSelect
            label="Company"
            value={value}
            options={options}
            isLoading={false}
            searchQuery=""
            onSearchChange={onSearchChange}
            onChange={(id, item) => {
              onChange(id, item);
              setValue(id);
            }}
            pagination={{
              page: 1,
              hasPreviousPage: true,
              hasNextPage: true,
              onPreviousPage: vi.fn(),
              onNextPage: vi.fn(),
            }}
          />
        );
      }

      render(
        <Harness />,
      );

      const input = screen.getByRole('combobox', { name: 'Company' });
      expect(screen.getByText('Company')).toHaveAttribute('for', input.id);
      expect(input).toHaveAttribute('aria-expanded', 'false');
      expect(input).toHaveAttribute('aria-haspopup', 'listbox');
      expect(input).toHaveAttribute('aria-controls');
      expect(input.parentElement).toHaveClass('min-h-11');

      fireEvent.focus(input);
      const listbox = await waitFor(() => screen.getByRole('listbox'));
      expect(listbox.id).toBe(input.getAttribute('aria-controls'));
      expect(input).toHaveAttribute('aria-expanded', 'true');

      const option = within(listbox).getByRole('option', { name: /Acme Holdings/ });
      expect(option).toHaveAttribute('aria-selected', 'false');
      expect(input).toHaveAttribute('aria-activedescendant', option.id);
      expect(within(listbox).getAllByRole('option')).toHaveLength(2);
      expect(screen.getByRole('button', { name: 'Previous' })).toHaveClass('min-h-11');
      expect(screen.getByRole('button', { name: 'Next' })).toHaveClass('min-h-11');

      act(() => input.focus());
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith('company-1', options[0]);
      const selectedCombobox = await waitFor(() => screen.getByRole('combobox', { name: 'Company' }));
      expect(selectedCombobox).toHaveAttribute('id', input.id);
      expect(selectedCombobox).toHaveAttribute('aria-expanded', 'false');
      expect(selectedCombobox).toHaveTextContent('Acme Holdings');
      expect(document.activeElement).toBe(selectedCombobox);
      expect(selectedCombobox).not.toHaveAttribute('aria-valuetext');
      const clear = screen.getByRole('button', { name: 'Clear Company' });
      expect(clear).toHaveClass('min-h-11', 'min-w-11');
      expect(selectedCombobox).not.toContainElement(clear);
      expect(selectedCombobox.parentElement).toContainElement(clear);
      fireEvent.click(clear);
      expect(onChange).toHaveBeenLastCalledWith('', null);
      expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Company' }));
    } finally {
      restoreScrollIntoView();
      getBoundingClientRect.mockRestore();
    }
  });

  it.each(['Backspace', 'Delete'] as const)('clears with %s and supports keyboard reselection', async (clearKey) => {
    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 54,
      left: 20,
      right: 340,
      width: 320,
      height: 44,
      x: 20,
      y: 10,
      toJSON: () => ({}),
    });
    const restoreScrollIntoView = mockScrollIntoView();
    const onChange = vi.fn();
    const onSearchChange = vi.fn();

    try {
      function Harness() {
        const [value, setValue] = useState('');
        return (
          <AsyncSearchSelect
            label="Company"
            value={value}
            options={options}
            isLoading={false}
            searchQuery=""
            onSearchChange={onSearchChange}
            onChange={(id, item) => {
              onChange(id, item);
              setValue(id);
            }}
          />
        );
      }

      render(<Harness />);
      const input = screen.getByRole('combobox', { name: 'Company' });
      act(() => input.focus());
      fireEvent.focus(input);
      await waitFor(() => screen.getByRole('listbox'));
      fireEvent.keyDown(input, { key: 'Enter' });

      const selectedCombobox = await waitFor(() => screen.getByRole('combobox', { name: 'Company' }));
      expect(document.activeElement).toBe(selectedCombobox);
      fireEvent.keyDown(selectedCombobox, { key: clearKey });

      const clearedInput = await waitFor(() => screen.getByRole('combobox', { name: 'Company' }));
      expect(document.activeElement).toBe(clearedInput);
      expect(onChange).toHaveBeenLastCalledWith('', null);

      act(() => clearedInput.focus());
      fireEvent.keyDown(clearedInput, { key: 'ArrowDown' });
      const reselectionListbox = await waitFor(() => screen.getByRole('listbox'));
      fireEvent.keyDown(clearedInput, { key: 'ArrowDown' });
      fireEvent.keyDown(clearedInput, { key: 'Enter' });

      const reselectedCombobox = await waitFor(() => screen.getByRole('combobox', { name: 'Company' }));
      expect(reselectedCombobox).toHaveTextContent('Beta Services');
      expect(document.activeElement).toBe(reselectedCombobox);
      expect(onChange).toHaveBeenLastCalledWith('company-2', options[1]);
      expect(reselectionListbox).not.toBeInTheDocument();
    } finally {
      restoreScrollIntoView();
      getBoundingClientRect.mockRestore();
    }
  });

  it('makes a selected disabled value non-tabbable and unavailable to keyboard changes', async () => {
    const onChange = vi.fn();

    render(
      <AsyncSearchSelect
        label="Company"
        value="company-1"
        options={options}
        isLoading={false}
        searchQuery=""
        onSearchChange={vi.fn()}
        onChange={onChange}
        disabled
      />,
    );

    const selectedCombobox = await waitFor(() => screen.getByRole('combobox', { name: 'Company' }));
    expect(selectedCombobox).toHaveAttribute('aria-disabled', 'true');
    expect(selectedCombobox).toHaveAttribute('tabindex', '-1');
    expect(screen.queryByRole('button', { name: 'Clear Company' })).not.toBeInTheDocument();

    act(() => selectedCombobox.focus());
    fireEvent.keyDown(selectedCombobox, { key: 'Backspace' });
    fireEvent.keyDown(selectedCombobox, { key: 'Delete' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves with Home and End and shows a failed search with Try again', () => {
    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 10, bottom: 54, left: 20, right: 340, width: 320, height: 44, x: 20, y: 10, toJSON: () => ({}),
    });
    const restoreScrollIntoView = mockScrollIntoView();
    const onRetry = vi.fn();

    try {
      const { rerender } = render(
        <AsyncSearchSelect label="Company" value="" options={options} isLoading={false} searchQuery="" onSearchChange={vi.fn()} onChange={vi.fn()} />,
      );
      const input = screen.getByRole('combobox', { name: 'Company' });
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'End' });
      expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /Beta Services/ }).id);
      fireEvent.keyDown(input, { key: 'Home' });
      expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /Acme Holdings/ }).id);

      rerender(
        <AsyncSearchSelect label="Company" value="" options={[]} isLoading={false} searchQuery="acme" onSearchChange={vi.fn()} onChange={vi.fn()} error="Couldn't load companies." onRetry={onRetry} />,
      );
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load companies.");
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    } finally {
      getBoundingClientRect.mockRestore();
      restoreScrollIntoView();
    }
  });

  it('opens above the control when there is no room below', () => {
    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight - 60, bottom: window.innerHeight - 16, left: 20, right: 340, width: 320, height: 44, x: 20, y: window.innerHeight - 60, toJSON: () => ({}),
    });
    const restoreScrollIntoView = mockScrollIntoView();

    try {
      render(<AsyncSearchSelect label="Company" value="" options={options} isLoading={false} searchQuery="" onSearchChange={vi.fn()} onChange={vi.fn()} />);
      fireEvent.focus(screen.getByRole('combobox', { name: 'Company' }));
      const popover = screen.getByRole('listbox').parentElement!;
      expect(popover.style.bottom).not.toBe('');
      expect(popover.style.top).toBe('');
    } finally {
      getBoundingClientRect.mockRestore();
      restoreScrollIntoView();
    }
  });
});
