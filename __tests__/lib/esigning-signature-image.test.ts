// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/lib/errors';
import { ESIGNING_PAYLOAD_LIMITS as LIMITS } from '@/lib/esigning-payload-limits';
import { assertSignatureImagesValid, sanitizeSignatureImage } from '@/lib/esigning-signature-image';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function toDataUrl(bytes: Buffer, mime = 'image/png') {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function solidPng(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 20, g: 30, b: 120, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

async function noisePng(width: number, height: number) {
  return sharp(randomBytes(width * height * 4), { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

function chunk(type: string, data: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([header, data, crc]);
}

/** A PNG with a real, parseable IHDR but whatever dimensions the test asks for and no pixel data. */
function pngHeaderOnly(width: number, height: number) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))]);
}

async function expectRejected(dataUrl: string, message: RegExp) {
  const error = await sanitizeSignatureImage(dataUrl).then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(ValidationError);
  expect((error as ValidationError).statusCode).toBe(400);
  expect((error as ValidationError).message).toMatch(message);
}

describe('sanitizeSignatureImage', () => {
  it('accepts a valid PNG and returns a PNG of the same size', async () => {
    const result = await sanitizeSignatureImage(toDataUrl(await solidPng(640, 180)));

    expect(result.width).toBe(640);
    expect(result.height).toBe(180);
    expect(result.png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const metadata = await sharp(result.png).metadata();
    expect(metadata).toMatchObject({ format: 'png', width: 640, height: 180 });
  });

  it('accepts the largest canvas the signing pad can produce', async () => {
    // A 3x device pixel ratio pad of 1000 x 300 CSS pixels.
    const result = await sanitizeSignatureImage(toDataUrl(await solidPng(3000, 900)));
    expect(result.width).toBe(3000);
    expect(result.height).toBe(900);
  });

  it('writes the image again: extra chunks and trailing bytes do not survive', async () => {
    const original = await solidPng(64, 32);
    const iend = original.subarray(original.length - 12);
    const withoutIend = original.subarray(0, original.length - 12);
    const tampered = Buffer.concat([
      withoutIend,
      chunk('tEXt', Buffer.from('Comment\0hidden payload that must not be stored')),
      iend,
      Buffer.from('TRAILING-GARBAGE'),
    ]);
    expect(tampered.includes('hidden payload')).toBe(true);

    const { png } = await sanitizeSignatureImage(toDataUrl(tampered));

    expect(png.includes('hidden payload')).toBe(false);
    expect(png.includes('TRAILING-GARBAGE')).toBe(false);
    expect(png.subarray(png.length - 12).toString('hex')).toBe(iend.toString('hex'));
    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 64, height: 32 });
  });

  it('rejects JPEG bytes labelled as a PNG', async () => {
    const jpeg = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#fff' } })
      .jpeg()
      .toBuffer();
    await expectRejected(toDataUrl(jpeg, 'image/png'), /not a valid PNG/);
  });

  it('rejects arbitrary bytes labelled as a PNG', async () => {
    await expectRejected(toDataUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), /not a valid PNG/);
    await expectRejected(toDataUrl(randomBytes(500)), /not a valid PNG/);
  });

  it('rejects a data URL that is not a base64 PNG', async () => {
    const png = await solidPng(8, 8);
    await expectRejected(toDataUrl(png, 'image/jpeg'), /must be a PNG/);
    await expectRejected(toDataUrl(png, 'image/svg+xml'), /must be a PNG/);
    await expectRejected('not a data url', /must be a PNG/);
    await expectRejected(`data:image/png;base64,${png.toString('base64')}!!`, /must be a PNG/);
  });

  it('rejects a truncated PNG', async () => {
    const png = await noisePng(60, 40);
    await expectRejected(toDataUrl(png.subarray(0, Math.floor(png.length / 2))), /not a valid PNG/);
  });

  it('rejects a PNG whose pixel data is corrupt', async () => {
    const png = await noisePng(60, 40);
    const corrupt = Buffer.from(png);
    const idat = corrupt.indexOf('IDAT');
    for (let offset = idat + 20; offset < idat + 60; offset += 1) corrupt[offset] ^= 0xff;
    await expectRejected(toDataUrl(corrupt), /not a valid PNG/);
  });

  it('rejects an image over the decoded-size limit', async () => {
    const png = await noisePng(700, 400); // incompressible, about 1.1 MB
    expect(png.length).toBeGreaterThan(LIMITS.IMAGE_MAX_BYTES);
    await expectRejected(toDataUrl(png), /too large/);
  });

  it('rejects a data URL over the length limit without decoding it', async () => {
    await expectRejected(`data:image/png;base64,${'A'.repeat(LIMITS.IMAGE_DATA_URL_MAX_LENGTH)}`, /too large/);
  });

  it.each([
    ['wider than the limit', LIMITS.IMAGE_MAX_WIDTH + 1, 10],
    ['taller than the limit', 10, LIMITS.IMAGE_MAX_HEIGHT + 1],
    ['over the pixel limit', 4000, 1100],
    ['a decompression bomb header', 60_000, 60_000],
    ['zero width', 0, 10],
  ])('rejects dimensions %s from the header alone', async (_name, width, height) => {
    await expectRejected(toDataUrl(pngHeaderOnly(width, height)), /pixels|not a valid PNG/);
  });

  it('rejects an image whose declared size does not match its pixel data', async () => {
    const png = Buffer.from(await solidPng(64, 32));
    png.writeUInt32BE(32, 16); // lie about the width; the IHDR CRC is now wrong too
    await expectRejected(toDataUrl(png), /not a valid PNG/);
  });
});

describe('assertSignatureImagesValid', () => {
  it('passes values without images and values with valid images', async () => {
    const dataUrl = toDataUrl(await solidPng(100, 40));
    await expect(
      assertSignatureImagesValid([{ signatureDataUrl: null }, {}, { signatureDataUrl: dataUrl }, { signatureDataUrl: dataUrl }])
    ).resolves.toBeUndefined();
  });

  it('rejects the whole request when one image is invalid', async () => {
    const good = toDataUrl(await solidPng(100, 40));
    const bad = toDataUrl(randomBytes(200));
    await expect(assertSignatureImagesValid([{ signatureDataUrl: good }, { signatureDataUrl: bad }])).rejects.toThrow(
      /not a valid PNG/
    );
  });

  it('rejects images that are each within the limit but over the request total', async () => {
    // About 0.9 MiB decoded each; the total check runs before any image is decoded.
    const nearLimit = `data:image/png;base64,${'A'.repeat(1_200_000)}`;
    const values = [nearLimit, nearLimit, nearLimit, nearLimit].map((signatureDataUrl) => ({ signatureDataUrl }));
    await expect(assertSignatureImagesValid(values)).rejects.toThrow(/too large together/);
  });
});
