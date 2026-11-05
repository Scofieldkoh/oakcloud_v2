import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { EsigningSignatureModal } from '@/components/esigning/signing/esigning-signature-modal';
import { SignaturePad } from '@/components/forms/signature-pad';
import { ESIGNING_PAYLOAD_LIMITS as LIMITS, estimateDataUrlDecodedBytes } from '@/lib/esigning-payload-limits';
import { fitSignatureDataUrlToLimits, readPngDataUrlSize } from '@/lib/esigning-signature-raster';
import '@/app/globals.css';

/**
 * OAK-009 regression: the drawing pad sizes its canvas as CSS size x devicePixelRatio, so at a high
 * effective ratio (high-density screen or browser zoom) the exported PNG used to have more pixels than
 * the server accepts (a 3336 x 1476 export, 4.9M pixels against a 4,194,304 limit) and both saving and
 * completing the signature failed. These tests drive the real modal and pad in real Chrome.
 */

const originalRatio = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');

afterEach(() => {
  if (originalRatio) Object.defineProperty(window, 'devicePixelRatio', originalRatio);
  else delete (window as unknown as Record<string, unknown>).devicePixelRatio;
  document.body.innerHTML = '';
});

function setRatio(ratio: number) {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: ratio });
}

function draw(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const point = (fx: number, fy: number) => ({
    clientX: rect.left + rect.width * fx,
    clientY: rect.top + rect.height * fy,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    bubbles: true,
    cancelable: true,
  });
  canvas.dispatchEvent(new PointerEvent('pointerdown', { ...point(0.1, 0.5), buttons: 1 }));
  for (let step = 1; step <= 24; step += 1) {
    const fraction = step / 24;
    canvas.dispatchEvent(
      new PointerEvent('pointermove', { ...point(0.1 + 0.8 * fraction, 0.5 + 0.3 * Math.sin(fraction * 9)), buttons: 1 })
    );
  }
  canvas.dispatchEvent(new PointerEvent('pointerup', { ...point(0.9, 0.5), buttons: 0 }));
}

function expectWithinServerLimits(dataUrl: string) {
  const size = readPngDataUrlSize(dataUrl);
  expect(size).not.toBeNull();
  expect(size!.width).toBeLessThanOrEqual(LIMITS.IMAGE_MAX_WIDTH);
  expect(size!.height).toBeLessThanOrEqual(LIMITS.IMAGE_MAX_HEIGHT);
  expect(size!.width * size!.height).toBeLessThanOrEqual(LIMITS.IMAGE_MAX_PIXELS);
  expect(dataUrl.length).toBeLessThanOrEqual(LIMITS.IMAGE_DATA_URL_MAX_LENGTH);
  expect(estimateDataUrlDecodedBytes(dataUrl)).toBeLessThanOrEqual(LIMITS.IMAGE_MAX_BYTES);
}

async function adoptWithModal(ratio: number) {
  setRatio(ratio);
  await page.viewport(640, 600);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onAdopt = vi.fn();
  await act(async () =>
    root.render(
      <EsigningSignatureModal isOpen onClose={() => undefined} onAdopt={onAdopt} mode="SIGNATURE" recipientName="Jane Tan" />
    )
  );
  const canvas = document.querySelector('canvas[aria-label="Signature draw pad"], canvas') as HTMLCanvasElement;
  await act(async () => draw(canvas));
  await act(async () => {
    await page.getByRole('button', { name: 'Adopt and Sign' }).click();
  });
  const dataUrl = onAdopt.mock.calls[0][0].dataUrl as string;
  const canvasSize = { width: canvas.width, height: canvas.height };
  await act(async () => root.unmount());
  return { dataUrl, canvasSize };
}

describe('real signature modal and drawing pad at high devicePixelRatio', () => {
  it.each([1, 2, 3, 4, 6])('exports a PNG within the server limits at devicePixelRatio %s', async (ratio) => {
    const { dataUrl, canvasSize } = await adoptWithModal(ratio);

    expect(canvasSize.width).toBeGreaterThan(0);
    expectWithinServerLimits(dataUrl);
    // The pad is capped at the e-signing ratio, so the raster does not grow with the device ratio.
    const cappedRatio = Math.min(ratio, LIMITS.SIGNATURE_PAD_MAX_PIXEL_RATIO);
    const size = readPngDataUrlSize(dataUrl)!;
    expect(size.width).toBeLessThanOrEqual(Math.ceil(640 * cappedRatio));
  });

  it('keeps the drawing: the export is not blank', async () => {
    const { dataUrl } = await adoptWithModal(6);
    const image = new Image();
    await new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let inked = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) inked += 1;
    expect(inked).toBeGreaterThan(200);
  });
});

describe('fitSignatureDataUrlToLimits backstop', () => {
  it('scales an uncapped pad export at devicePixelRatio 6 down to within the limits, keeping its aspect ratio and ink', async () => {
    setRatio(6);
    await page.viewport(640, 600);
    const host = document.createElement('div');
    host.style.width = '556px';
    document.body.append(host);
    const root = createRoot(host);
    let exported = '';
    await act(async () => root.render(<SignaturePad onChange={(value) => { exported = value; }} />));
    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    await act(async () => draw(canvas));

    // Without a cap the pad really does produce more pixels than the server accepts.
    const raw = readPngDataUrlSize(exported)!;
    expect(raw.width * raw.height).toBeGreaterThan(LIMITS.IMAGE_MAX_PIXELS);

    const fitted = await fitSignatureDataUrlToLimits(exported);
    expectWithinServerLimits(fitted);
    const size = readPngDataUrlSize(fitted)!;
    expect(size.width / size.height).toBeCloseTo(raw.width / raw.height, 1);
    await act(async () => root.unmount());
  });

  it('returns an image that already fits unchanged', async () => {
    setRatio(1);
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 100;
    canvas.getContext('2d')!.fillRect(10, 10, 50, 20);
    const dataUrl = canvas.toDataURL('image/png');

    expect(await fitSignatureDataUrlToLimits(dataUrl)).toBe(dataUrl);
  });
});
