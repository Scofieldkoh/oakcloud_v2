import {
  extractSignatureDataUrl,
  SIGNATURE_DATA_URL_MAX_LENGTH,
} from '@/lib/signature-utils';

export const ESIGNING_SIGNATURE_SPECIMEN_PREFERENCE_KEY =
  'esigning.signature-specimen';

const SAFE_SIGNATURE_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,/i;

export function parseSignatureSpecimen(value: unknown): string | null {
  const dataUrl = extractSignatureDataUrl(value);
  if (
    !dataUrl ||
    !SAFE_SIGNATURE_IMAGE_PATTERN.test(dataUrl) ||
    dataUrl.length > SIGNATURE_DATA_URL_MAX_LENGTH
  ) {
    return null;
  }

  return dataUrl;
}
