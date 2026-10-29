import { act } from '@testing-library/react';

export function installDeterministicA4Measurement(
  { pixelsPerCharacter = 2, blockHeight = 24 } = {},
): () => void {
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollHeight',
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      if (!(this instanceof HTMLElement) || this.style.position !== 'fixed') {
        return 0;
      }
      const blocks = Math.max(
        1,
        this.querySelectorAll('p,li,tr,h1,h2,h3,blockquote').length,
      );
      return (
        blocks * blockHeight + (this.textContent?.length ?? 0) * pixelsPerCharacter
      );
    },
  });
  return () => {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', original);
    } else {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  };
}

export async function flushA4Reflow(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

/**
 * Flushes one deterministic reflow generation at a time until the editor
 * surface reports `aria-busy="false"`. Throws a diagnostic error after a
 * bounded number of generations instead of waiting forever.
 */
export async function waitForA4EditorIdle(
  surface: HTMLElement,
  maxReflows = 12,
): Promise<void> {
  for (let generation = 0; generation < maxReflows; generation += 1) {
    await act(async () => {
      await flushA4Reflow();
    });
    if (surface.getAttribute('aria-busy') === 'false') return;
  }
  if (surface.getAttribute('aria-busy') !== 'false') {
    throw new Error(
      `A4 editor did not reach idle after ${maxReflows} reflow generations ` +
        `(aria-busy="${surface.getAttribute('aria-busy')}").`,
    );
  }
}
