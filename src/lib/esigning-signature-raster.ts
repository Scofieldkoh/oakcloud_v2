import { ESIGNING_PAYLOAD_LIMITS as LIMITS, estimateDataUrlDecodedBytes } from '@/lib/esigning-payload-limits';

/**
 * Client-side guard for signature and initials images, so that whatever the pad, a saved specimen or an
 * older draft hands over fits the server limits (`ESIGNING_PAYLOAD_LIMITS`) instead of being refused at
 * the end of the signing flow.
 *
 * The drawing pad sizes its canvas as CSS size x devicePixelRatio, so on a high-density screen or at
 * high browser zoom the exported PNG can have more pixels than the server accepts even though it is
 * small in bytes. Images that already fit are returned untouched; larger ones are scaled down, keeping
 * their aspect ratio.
 */

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
/** Signature (8) + length and type (8) + width and height (8) = the first 24 bytes, 32 base64 characters. */
const PNG_HEADER_BASE64_CHARACTERS = 32;
/** Never shrink by more than this many rounds when only the byte size is too large. */
const MAX_SHRINK_ROUNDS = 4;

export function readPngDataUrlSize(dataUrl: string): { width: number; height: number } | null {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    return null;
  }

  try {
    const header = atob(dataUrl.slice(PNG_DATA_URL_PREFIX.length, PNG_DATA_URL_PREFIX.length + PNG_HEADER_BASE64_CHARACTERS));
    if (header.length < 24) {
      return null;
    }
    const readUint32 = (offset: number) =>
      ((header.charCodeAt(offset) << 24) |
        (header.charCodeAt(offset + 1) << 16) |
        (header.charCodeAt(offset + 2) << 8) |
        header.charCodeAt(offset + 3)) >>>
      0;
    return { width: readUint32(16), height: readUint32(20) };
  } catch {
    return null;
  }
}

/** Largest size, keeping the aspect ratio, that is within every pixel limit; or the same size if it already is. */
export function fitSignatureImageSize(width: number, height: number, shrinkFactor = 1): { width: number; height: number } {
  const scale = Math.min(
    1,
    shrinkFactor,
    LIMITS.IMAGE_MAX_WIDTH / width,
    LIMITS.IMAGE_MAX_HEIGHT / height,
    Math.sqrt(LIMITS.IMAGE_MAX_PIXELS / (width * height))
  );
  if (scale >= 1) {
    return { width, height };
  }
  // Floor, so rounding can never push an edge or the area back over a limit.
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

function withinLimits(dataUrl: string, size: { width: number; height: number }): boolean {
  return (
    dataUrl.length <= LIMITS.IMAGE_DATA_URL_MAX_LENGTH &&
    estimateDataUrlDecodedBytes(dataUrl) <= LIMITS.IMAGE_MAX_BYTES &&
    size.width <= LIMITS.IMAGE_MAX_WIDTH &&
    size.height <= LIMITS.IMAGE_MAX_HEIGHT &&
    size.width * size.height <= LIMITS.IMAGE_MAX_PIXELS
  );
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to read signature image'));
    image.src = dataUrl;
  });
}

/**
 * Returns the data URL itself when it is a PNG within the limits (or not something this can read, which
 * the server then rejects with its own message); otherwise a scaled-down PNG that is.
 */
export async function fitSignatureDataUrlToLimits(dataUrl: string): Promise<string> {
  const size = readPngDataUrlSize(dataUrl);
  if (!size || size.width < 1 || size.height < 1 || withinLimits(dataUrl, size)) {
    return dataUrl;
  }

  try {
    const image = await loadImage(dataUrl);
    let current = dataUrl;
    let target = fitSignatureImageSize(image.naturalWidth, image.naturalHeight);
    let shrinkFactor = 1;

    for (let round = 0; round <= MAX_SHRINK_ROUNDS; round += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = target.width;
      canvas.height = target.height;
      const context = canvas.getContext('2d');
      if (!context) {
        return dataUrl;
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, target.width, target.height);
      current = canvas.toDataURL('image/png');

      if (withinLimits(current, target)) {
        return current;
      }
      shrinkFactor *= 0.75;
      target = fitSignatureImageSize(image.naturalWidth, image.naturalHeight, shrinkFactor);
    }

    return current;
  } catch {
    return dataUrl;
  }
}

/** Applies `fitSignatureDataUrlToLimits` to every signature image in a list of field values. */
export async function fitSignatureValuesToLimits<T extends { signatureDataUrl?: string | null }>(values: T[]): Promise<T[]> {
  return Promise.all(
    values.map(async (entry) =>
      entry.signatureDataUrl
        ? { ...entry, signatureDataUrl: await fitSignatureDataUrlToLimits(entry.signatureDataUrl) }
        : entry
    )
  );
}
