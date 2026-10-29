import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { page, userEvent } from 'vitest/browser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { ReasoningEffortSelect } from '@/components/connectors/reasoning-effort-select';
import type { ReasoningEffort } from '@/lib/ai/reasoning-settings';
import '@/app/globals.css';

function Fixture() {
  const [effort, setEffort] = useState<ReasoningEffort>();
  return <div className="max-w-lg space-y-4 p-4">
    <h1>Connector model defaults</h1>
    <ReasoningEffortSelect label="Business Assistant" efforts={['none', 'low', 'medium', 'high', 'xhigh']} value={effort} onChange={setEffort} />
    <ReasoningEffortSelect label="BizFile extraction" efforts={['low', 'high']} onChange={() => undefined} />
    <ReasoningEffortSelect label="Unsupported model" efforts={[]} onChange={() => undefined} />
  </div>;
}

describe('connector reasoning controls', () => {
  const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT;
  beforeAll(() => { environment.IS_REACT_ACT_ENVIRONMENT = true; });
  afterAll(() => { environment.IS_REACT_ACT_ENVIRONMENT = previous; });
  it.each([1280, 390])('shows model-specific choices at %s pixels', async (width) => {
    await page.viewport(width, 800);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Fixture />));
      const assistant = screen.getByRole('combobox', { name: 'Business Assistant reasoning effort' });
      await act(async () => userEvent.selectOptions(assistant, 'xhigh'));
      await expect.element(assistant).toHaveValue('xhigh');
      const extraction = screen.getByRole('combobox', { name: 'BizFile extraction reasoning effort' }) as HTMLSelectElement;
      expect(Array.from(extraction.options).map((option) => option.value)).toEqual(['', 'low', 'high']);
      await expect.element(screen.getByRole('combobox', { name: 'Unsupported model reasoning effort' })).toBeDisabled();
      await act(async () => userEvent.selectOptions(assistant, ''));
      await expect.element(assistant).toHaveValue('');
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
