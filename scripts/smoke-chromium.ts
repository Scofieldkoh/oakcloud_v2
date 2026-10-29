import puppeteer from 'puppeteer-core';
import { findChromePath } from '../src/lib/chrome-executable';

const launchArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

async function main(): Promise<void> {
  const executablePath = await findChromePath();
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: launchArgs,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(
      '<!doctype html><html><body><h1>Oakcloud Chromium smoke test</h1><p>Node 24 compatibility</p></body></html>',
      { waitUntil: 'load' },
    );

    const pdfBuffer = Buffer.from(
      await page.pdf({
        format: 'A4',
        printBackground: true,
      }),
    );

    if (
      pdfBuffer.subarray(0, 4).toString('ascii') !== '%PDF' ||
      pdfBuffer.length < 1_000
    ) {
      throw new Error(`Invalid PDF output (${pdfBuffer.length} bytes)`);
    }

    const rasterPage = await browser.newPage();
    await rasterPage.setViewport({
      width: 1_400,
      height: 1_800,
      deviceScaleFactor: 1,
    });
    await rasterPage.goto(
      `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
      { waitUntil: 'networkidle0', timeout: 15_000 },
    );

    const pngBuffer = Buffer.from(
      await rasterPage.screenshot({ type: 'png', fullPage: true }),
    );

    if (
      pngBuffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      pngBuffer.length < 1_000
    ) {
      throw new Error(`Invalid PNG output (${pngBuffer.length} bytes)`);
    }

    console.info(
      `Chromium smoke test passed: ${executablePath}; PDF=${pdfBuffer.length} bytes; PNG=${pngBuffer.length} bytes`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    'Chromium smoke test failed:',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
