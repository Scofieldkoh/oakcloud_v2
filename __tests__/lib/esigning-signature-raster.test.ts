// @vitest-environment node
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ESIGNING_PAYLOAD_LIMITS as LIMITS } from '@/lib/esigning-payload-limits';
import { sanitizeSignatureImage } from '@/lib/esigning-signature-image';
import { fitSignatureImageSize, readPngDataUrlSize } from '@/lib/esigning-signature-raster';

async function solid(width: number, height: number) {
  const png = await sharp({ create: { width, height, channels: 4, background: '#223' } }).png().toBuffer();
  return { png, dataUrl: `data:image/png;base64,${png.toString('base64')}` };
}

describe('readPngDataUrlSize', () => {
  it('reads the size from the header of a real PNG', async () => {
    expect(readPngDataUrlSize((await solid(321, 77)).dataUrl)).toEqual({ width: 321, height: 77 });
  });

  it('returns null for anything that is not a PNG data URL', () => {
    expect(readPngDataUrlSize('data:image/jpeg;base64,AAAA')).toBeNull();
    expect(readPngDataUrlSize('data:image/png;base64,AAAA')).toBeNull();
    expect(readPngDataUrlSize('nonsense')).toBeNull();
  });
});

describe('fitSignatureImageSize', () => {
  it('leaves a size that already fits alone', () => {
    expect(fitSignatureImageSize(640, 180)).toEqual({ width: 640, height: 180 });
    expect(fitSignatureImageSize(4096, 1024)).toEqual({ width: 4096, height: 1024 });
  });

  it.each([
    ['the 3336 x 1476 export of the real pad at devicePixelRatio 6', 3336, 1476],
    ['too wide', 6000, 400],
    ['too tall', 900, 3000],
    ['over the area only', 4096, 1500],
    ['far over every limit', 20000, 9000],
  ])('scales %s to a size the server accepts, keeping the aspect ratio', async (_name, width, height) => {
    const fitted = fitSignatureImageSize(width, height);

    expect(fitted.width).toBeLessThanOrEqual(LIMITS.IMAGE_MAX_WIDTH);
    expect(fitted.height).toBeLessThanOrEqual(LIMITS.IMAGE_MAX_HEIGHT);
    expect(fitted.width * fitted.height).toBeLessThanOrEqual(LIMITS.IMAGE_MAX_PIXELS);
    expect(fitted.width / fitted.height).toBeCloseTo(width / height, 1);

    // The real server decoder takes an image of exactly that size.
    const { dataUrl } = await solid(fitted.width, fitted.height);
    await expect(sanitizeSignatureImage(dataUrl)).resolves.toMatchObject(fitted);
  });

  it('is the case the server refused before: 3336 x 1476 is over the area limit', async () => {
    const { dataUrl } = await solid(3336, 1476);
    await expect(sanitizeSignatureImage(dataUrl)).rejects.toThrow(/too many pixels.*4,194,304 pixels in total/);
  });
});
