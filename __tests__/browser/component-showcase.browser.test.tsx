import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { ComponentShowcase } from '@/components/admin/component-showcase';
import { ToastProvider } from '@/components/ui/toast';
import '@/app/globals.css';

function renderShowcase() {
  return render(
    <ToastProvider>
      <div className="p-4">
        <ComponentShowcase />
      </div>
    </ToastProvider>,
  );
}

describe('UI Components showcase', () => {
  afterEach(() => cleanup());

  it.each([
    ['phone', 390],
    ['desktop', 1440],
  ])('fits a %s screen without sideways scrolling', async (_name, width) => {
    await page.viewport(width, 900);
    renderShowcase();

    await expect.element(screen.getByRole('heading', { name: 'Tables' })).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  });

  it('opens the confirm dialog from the dialogs section', async () => {
    await page.viewport(1440, 900);
    renderShowcase();

    await page.getByRole('button', { name: 'Open confirm dialog' }).click();
    const dialog = page.getByRole('dialog');
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByText('Discard changes?')).toBeVisible();
  });
});
