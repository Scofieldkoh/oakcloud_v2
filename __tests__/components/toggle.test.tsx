import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toggle } from '@/components/ui/toggle';

describe('Toggle', () => {
  it('stacks the label above the switch when labelPosition is top', () => {
    render(<Toggle label="Is current" labelPosition="top" checked onChange={vi.fn()} />);

    const toggle = screen.getByRole('switch', { name: 'Is current' });
    expect(toggle.parentElement).toHaveClass('flex-col');
    expect(toggle.parentElement?.firstElementChild).toHaveTextContent('Is current');
  });
});
