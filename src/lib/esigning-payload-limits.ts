/**
 * Size limits for the public (unauthenticated) e-signing routes. One place so the schema, the
 * request readers, the image decoder and the verify page all state the same numbers.
 */

const KIB = 1024;
const MIB = 1024 * KIB;

/** `params.code` of the zod issue raised when a signature image is over a size limit. */
export const ESIGNING_IMAGE_LIMIT_ISSUE_CODE = 'ESIGNING_IMAGE_LIMIT';

export const ESIGNING_PAYLOAD_LIMITS = {
  /** JSON body of `sign/session/fields` and `sign/session/complete` (500 values plus signature images). */
  SIGNING_VALUES_BODY_BYTES: 5 * MIB,
  /** JSON body of the other public sign routes (consent, decline, access-code verify): tiny objects. */
  SMALL_BODY_BYTES: 16 * KIB,
  /** A signature or initials data URL, measured on the string, before anything is decoded. */
  IMAGE_DATA_URL_MAX_LENGTH: 1_400_000,
  /** Decoded PNG bytes of one signature or initials image. */
  IMAGE_MAX_BYTES: 1 * MIB,
  /** Decoded PNG bytes of all images in one request. */
  IMAGES_TOTAL_MAX_BYTES: 3 * MIB,
  IMAGE_MAX_WIDTH: 4096,
  IMAGE_MAX_HEIGHT: 2048,
  /** Largest pixel count the decoder will accept (guards against decompression bombs). */
  IMAGE_MAX_PIXELS: 4096 * 1024,
  /** Multipart upload of `verify/[certificateId]/check`: one 25 MiB document plus its certificate. */
  VERIFY_UPLOAD_BYTES: 30 * MIB,
} as const;

export function formatByteLimit(bytes: number): string {
  return bytes >= MIB ? `${bytes / MIB} MiB` : `${bytes / KIB} KiB`;
}

/** Decoded size of a base64 data URL, computed from its length without decoding it. */
export function estimateDataUrlDecodedBytes(dataUrl: string): number {
  const payloadStart = dataUrl.indexOf(',') + 1;
  const payloadLength = dataUrl.length - payloadStart;
  const padding = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payloadLength * 3) / 4) - padding);
}
