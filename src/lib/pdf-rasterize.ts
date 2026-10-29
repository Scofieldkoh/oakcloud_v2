import { findChromePath } from '@/lib/chrome-executable';

export async function renderPdfPageToPng(pdfBuffer: Buffer): Promise<Buffer> {
  const puppeteer = await import('puppeteer-core');
  const executablePath = await findChromePath();
  const browser = await puppeteer.default.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
    await page.goto(`data:application/pdf;base64,${pdfBuffer.toString('base64')}`, {
      waitUntil: 'networkidle0',
      timeout: 15000,
    });
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    return Buffer.from(screenshot);
  } finally {
    await browser.close();
  }
}
