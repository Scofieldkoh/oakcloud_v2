import { BadRequestError, PayloadTooLargeError } from '@/lib/errors';
import { formatByteLimit } from '@/lib/esigning-payload-limits';

interface LimitedBodyOptions {
  /** Message of the 413 response. Defaults to a generic "too large" text naming the limit. */
  tooLargeMessage?: string;
}

function tooLarge(maxBytes: number, options: LimitedBodyOptions): PayloadTooLargeError {
  return new PayloadTooLargeError(
    options.tooLargeMessage ?? `Request body is too large. The limit is ${formatByteLimit(maxBytes)}.`,
    { maxBytes }
  );
}

/**
 * Reads a request body but never more than `maxBytes`. A declared `Content-Length` over the limit is
 * refused before any byte is read; a body without one (chunked) or with a false one is counted while
 * it streams and cancelled as soon as it crosses the limit, so memory use is bounded by the limit.
 */
export async function readLimitedRequestBody(
  request: Request,
  maxBytes: number,
  options: LimitedBodyOptions = {}
): Promise<Buffer> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await request.body?.cancel().catch(() => undefined);
      throw tooLarge(maxBytes, options);
    }
  }

  if (!request.body) {
    return Buffer.alloc(0);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(maxBytes, options);
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks, received);
}

/** `request.json()` with a byte limit. An unparseable body is a `SyntaxError` (400 "Invalid request body"). */
export async function readLimitedJson(
  request: Request,
  maxBytes: number,
  options: LimitedBodyOptions = {}
): Promise<unknown> {
  const body = await readLimitedRequestBody(request, maxBytes, options);
  return JSON.parse(body.toString('utf8'));
}

/** `request.formData()` with a byte limit, enforced before the multipart body is parsed. */
export async function readLimitedFormData(
  request: Request,
  maxBytes: number,
  options: LimitedBodyOptions = {}
): Promise<FormData> {
  const body = await readLimitedRequestBody(request, maxBytes, options);
  const contentType = request.headers.get('content-type');
  if (!contentType) {
    throw new BadRequestError('Expected a multipart upload');
  }

  try {
    return await new Response(new Uint8Array(body), { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw new BadRequestError('The upload could not be read');
  }
}
