import { fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';
import { Trash2 } from 'lucide-react';
import { TableRow } from '@/components/ui/data-table';
import { MobileCard } from '@/components/ui/responsive-table';

function renderRow(onActivate: () => void, onAction: () => void) {
  return render(
    <table>
      <tbody>
        <TableRow onActivate={onActivate}>
          <td>Annual minutes</td>
          <td>
            <button type="button" aria-label="Delete" onClick={onAction}>
              <Trash2 data-testid="row-icon" />
            </button>
            {createPortal(<div data-testid="portal-menu">Menu padding</div>, document.body)}
          </td>
        </TableRow>
      </tbody>
    </table>,
  );
}

describe('clickable rows and cards', () => {
  it('opens the row from a plain cell click', () => {
    const onActivate = vi.fn();
    renderRow(onActivate, vi.fn());

    fireEvent.click(screen.getByText('Annual minutes'));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('runs the button, not the row, when its icon is clicked', () => {
    const onActivate = vi.fn();
    const onAction = vi.fn();
    renderRow(onActivate, onAction);

    fireEvent.click(screen.getByTestId('row-icon'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('ignores clicks and key presses inside menus or dialogs portalled out of the row', () => {
    const onActivate = vi.fn();
    renderRow(onActivate, vi.fn());

    fireEvent.click(screen.getByTestId('portal-menu'));
    fireEvent.keyDown(screen.getByTestId('portal-menu'), { key: 'Enter' });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('keeps mobile card icon buttons from opening the card', () => {
    const onCardClick = vi.fn();
    const onAction = vi.fn();
    render(
      <MobileCard
        title="Annual minutes"
        onCardClick={onCardClick}
        actions={(
          <button type="button" aria-label="Delete" onClick={onAction}>
            <Trash2 data-testid="card-icon" />
          </button>
        )}
      />,
    );

    fireEvent.click(screen.getByTestId('card-icon'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onCardClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Annual minutes'));
    expect(onCardClick).toHaveBeenCalledTimes(1);
  });
});
