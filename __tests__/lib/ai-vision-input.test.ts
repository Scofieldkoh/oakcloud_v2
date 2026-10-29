import { describe, expect, it, vi } from 'vitest';
import { prepareImageUrlVisionInput } from '@/lib/ai/vision-input';

describe('prepareImageUrlVisionInput', () => {
  it('rasterizes PDFs to PNG image input', async () => {
    const renderPdfPageToPng = vi.fn().mockResolvedValue(Buffer.from('png-bytes'));

    const result = await prepareImageUrlVisionInput(Buffer.from('%PDF-1.7'), 'application/pdf', {
      renderPdfPageToPng,
    });

    expect(renderPdfPageToPng).toHaveBeenCalledWith(Buffer.from('%PDF-1.7'));
    expect(result).toEqual({
      base64: Buffer.from('png-bytes').toString('base64'),
      mimeType: 'image/png',
    });
  });

  it('passes through existing image inputs', async () => {
    const renderPdfPageToPng = vi.fn();
    const image = Buffer.from('image-bytes');

    const result = await prepareImageUrlVisionInput(image, 'image/jpeg', {
      renderPdfPageToPng,
    });

    expect(renderPdfPageToPng).not.toHaveBeenCalled();
    expect(result).toEqual({
      base64: image.toString('base64'),
      mimeType: 'image/jpeg',
    });
  });
});
