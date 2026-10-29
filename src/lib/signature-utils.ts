const DATA_IMAGE_URI_PATTERN = /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9.+_-]+=[a-z0-9.+_-]+)*;base64,/i;
const SVG_DATA_IMAGE_URI_PATTERN = /^data:image\/svg\+xml(?:;[a-z0-9.+_-]+=[a-z0-9.+_-]+)*;base64,/i;
const EMBEDDED_RASTER_DATA_URI_PATTERN = /data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+/i;

export const SIGNATURE_DATA_URL_MAX_LENGTH = 1_000_000;

export function isSignatureDataUrl(value: unknown): value is string {
  return typeof value === 'string' && DATA_IMAGE_URI_PATTERN.test(value.trim());
}

function decodeBase64(value: string): string | null {
  try {
    if (typeof atob === 'function') {
      return atob(value);
    }
  } catch {
    return null;
  }

  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(value, 'base64').toString('utf8');
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeSignatureDataUrl(value: string): string {
  const trimmed = value.trim();
  if (!SVG_DATA_IMAGE_URI_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const encodedSvg = trimmed.slice(trimmed.indexOf(',') + 1);
  const decodedSvg = decodeBase64(encodedSvg);
  const embeddedRasterDataUrl = decodedSvg?.match(EMBEDDED_RASTER_DATA_URI_PATTERN)?.[0];
  return embeddedRasterDataUrl || trimmed;
}

export function extractSignatureDataUrl(value: unknown): string | null {
  if (isSignatureDataUrl(value)) {
    return normalizeSignatureDataUrl(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractSignatureDataUrl(item);
      if (candidate) return candidate;
    }
    return null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const keys = ['dataUrl', 'pngDataUrl', 'signatureDataUrl', 'signature', 'value', 'vectorDataUrl'];
  for (const key of keys) {
    const candidate = extractSignatureDataUrl(record[key]);
    if (candidate) return candidate;
  }

  return null;
}
