import { renderPdfPageToPng as defaultRenderPdfPageToPng } from '@/lib/pdf-rasterize';

interface PrepareVisionInputOptions {
  renderPdfPageToPng?: (pdfBuffer: Buffer) => Promise<Buffer>;
}

export async function prepareImageUrlVisionInput(
  documentBuffer: Buffer,
  mimeType: string,
  options: PrepareVisionInputOptions = {}
): Promise<{ base64: string; mimeType: string }> {
  if (mimeType !== 'application/pdf') {
    return {
      base64: documentBuffer.toString('base64'),
      mimeType,
    };
  }

  const renderPdfPageToPng = options.renderPdfPageToPng ?? defaultRenderPdfPageToPng;
  const pngBuffer = await renderPdfPageToPng(documentBuffer);

  return {
    base64: pngBuffer.toString('base64'),
    mimeType: 'image/png',
  };
}
