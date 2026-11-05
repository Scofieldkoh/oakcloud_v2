import sharp from 'sharp';
import { ValidationError } from '@/lib/errors';
import {
  ESIGNING_PAYLOAD_LIMITS as LIMITS,
  estimateDataUrlDecodedBytes,
  formatByteLimit,
} from '@/lib/esigning-payload-limits';

const PNG_DATA_URL_PATTERN = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 8-byte signature, 4-byte length, "IHDR", then width and height as big-endian uint32. */
const PNG_HEADER_BYTES = 24;

export interface SanitizedSignatureImage {
  /** The image decoded and written again as a plain PNG: no metadata, no extra chunks, no trailing bytes. */
  png: Buffer;
  width: number;
  height: number;
}

function invalid(message: string): ValidationError {
  return new ValidationError(message);
}

/**
 * Decodes a signature or initials data URL and returns it re-encoded as a PNG.
 *
 * Everything is checked before the pixels are decoded: the data URL form and length, the decoded
 * size, the PNG signature and the dimensions in the IHDR chunk. The decoder is then given a pixel
 * limit and strict error handling, so a corrupt, truncated, mislabeled or oversized image is rejected
 * here instead of being stored and failing PDF generation after everyone has signed. Only the
 * re-encoded bytes should be stored.
 */
export async function sanitizeSignatureImage(dataUrl: string): Promise<SanitizedSignatureImage> {
  if (dataUrl.length > LIMITS.IMAGE_DATA_URL_MAX_LENGTH) {
    throw invalid(`The signature image is too large. The limit is ${formatByteLimit(LIMITS.IMAGE_MAX_BYTES)}.`);
  }

  const match = PNG_DATA_URL_PATTERN.exec(dataUrl);
  if (!match) {
    throw invalid('The signature image must be a PNG.');
  }

  if (estimateDataUrlDecodedBytes(dataUrl) > LIMITS.IMAGE_MAX_BYTES) {
    throw invalid(`The signature image is too large. The limit is ${formatByteLimit(LIMITS.IMAGE_MAX_BYTES)}.`);
  }

  const input = Buffer.from(match[1], 'base64');
  if (
    input.length < PNG_HEADER_BYTES ||
    !input.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    input.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw invalid('The signature image is not a valid PNG.');
  }

  const declaredWidth = input.readUInt32BE(16);
  const declaredHeight = input.readUInt32BE(20);
  if (
    declaredWidth < 1 ||
    declaredHeight < 1 ||
    declaredWidth > LIMITS.IMAGE_MAX_WIDTH ||
    declaredHeight > LIMITS.IMAGE_MAX_HEIGHT ||
    declaredWidth * declaredHeight > LIMITS.IMAGE_MAX_PIXELS
  ) {
    throw invalid(
      `The signature image has too many pixels. It can be at most ${LIMITS.IMAGE_MAX_WIDTH} x ${LIMITS.IMAGE_MAX_HEIGHT} and ${LIMITS.IMAGE_MAX_PIXELS.toLocaleString('en-US')} pixels in total.`
    );
  }

  try {
    const { data, info } = await sharp(input, {
      limitInputPixels: LIMITS.IMAGE_MAX_PIXELS,
      failOn: 'warning',
      pages: 1,
    })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });

    if (info.format !== 'png' || info.width !== declaredWidth || info.height !== declaredHeight) {
      throw invalid('The signature image is not a valid PNG.');
    }
    if (data.length > LIMITS.IMAGE_MAX_BYTES) {
      throw invalid(`The signature image is too large. The limit is ${formatByteLimit(LIMITS.IMAGE_MAX_BYTES)}.`);
    }

    return { png: data, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw invalid('The signature image is not a valid PNG.');
  }
}

/**
 * Rejects the whole request before anything is stored when any image in it is invalid, or when the
 * images together are over the request total. Called ahead of the signing transaction so a bad image
 * cannot leave a half-saved or half-finalized signing record.
 */
export async function assertSignatureImagesValid(
  values: ReadonlyArray<{ signatureDataUrl?: string | null }>
): Promise<void> {
  const dataUrls = values.flatMap((entry) => (entry.signatureDataUrl ? [entry.signatureDataUrl] : []));
  const estimatedTotal = dataUrls.reduce((sum, dataUrl) => sum + estimateDataUrlDecodedBytes(dataUrl), 0);
  if (estimatedTotal > LIMITS.IMAGES_TOTAL_MAX_BYTES) {
    throw invalid(
      `The signature images are too large together. The limit is ${formatByteLimit(LIMITS.IMAGES_TOTAL_MAX_BYTES)} per save.`
    );
  }

  for (const dataUrl of dataUrls) {
    await sanitizeSignatureImage(dataUrl);
  }
}
