// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { PayloadTooLargeError } from '@/lib/errors';
import {
  readLimitedFormData,
  readLimitedJson,
  readLimitedRequestBody,
} from '@/lib/esigning-request-body';

function streamingRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  let index = 0;
  const pulled = vi.fn();
  const cancelled = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled();
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index += 1;
      } else {
        controller.close();
      }
    },
    cancel: cancelled,
  });
  const request = new Request('http://localhost/upload', {
    method: 'POST',
    headers,
    body: stream,
    // @ts-expect-error Node's fetch requires this for a streamed body.
    duplex: 'half',
  });
  return { request, pulled, cancelled };
}

describe('readLimitedRequestBody', () => {
  it('reads a body within the limit', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: 'hello' });
    expect((await readLimitedRequestBody(request, 10)).toString()).toBe('hello');
  });

  it('refuses a declared Content-Length over the limit without reading the body', async () => {
    const { request, cancelled } = streamingRequest([new Uint8Array(10)], { 'content-length': '5000' });
    const getReader = vi.spyOn(request.body as ReadableStream, 'getReader');

    await expect(readLimitedRequestBody(request, 1000)).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(getReader).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalled();
  });

  it('stops reading a chunked body as soon as it crosses the limit', async () => {
    const chunks = Array.from({ length: 50 }, () => new Uint8Array(100));
    const { request, pulled, cancelled } = streamingRequest(chunks);

    const error = await readLimitedRequestBody(request, 450).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect((error as PayloadTooLargeError).statusCode).toBe(413);
    // Five chunks pass 450 bytes; the other 45 are never pulled into memory.
    expect(pulled.mock.calls.length).toBeLessThan(10);
    expect(cancelled).toHaveBeenCalled();
  });

  it('is not fooled by a Content-Length that understates the body', async () => {
    const chunks = Array.from({ length: 20 }, () => new Uint8Array(100));
    const { request } = streamingRequest(chunks, { 'content-length': '10' });

    await expect(readLimitedRequestBody(request, 450)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('uses the supplied message for the 413', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: 'x'.repeat(50) });
    await expect(readLimitedRequestBody(request, 10, { tooLargeMessage: 'Custom text' })).rejects.toThrow('Custom text');
  });

  it('treats a request without a body as empty', async () => {
    expect((await readLimitedRequestBody(new Request('http://localhost/x'), 10)).length).toBe(0);
  });
});

describe('readLimitedJson', () => {
  it('parses JSON within the limit', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    expect(await readLimitedJson(request, 100)).toEqual({ a: 1 });
  });

  it('throws a SyntaxError for malformed JSON, like request.json()', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: '{nope' });
    await expect(readLimitedJson(request, 100)).rejects.toBeInstanceOf(SyntaxError);
  });

  it('rejects JSON over the limit', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ a: 'x'.repeat(200) }) });
    await expect(readLimitedJson(request, 100)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });
});

async function multipartRequest(form: FormData) {
  // Serialise first: a Request built straight from FormData streams it through undici, which logs an
  // unhandled rejection in the test process when the reader cancels midway.
  const serialised = new Response(form);
  const contentType = serialised.headers.get('content-type') as string;
  const bytes = new Uint8Array(await serialised.arrayBuffer());
  return new Request('http://localhost/x', { method: 'POST', headers: { 'content-type': contentType }, body: bytes });
}

describe('readLimitedFormData', () => {
  it('parses a multipart upload within the limit', async () => {
    const form = new FormData();
    form.set('file', new File(['%PDF-1.7 body'], 'a.pdf', { type: 'application/pdf' }));
    const request = await multipartRequest(form);

    const parsed = await readLimitedFormData(request, 10_000);

    const file = parsed.get('file');
    expect(file).toBeInstanceOf(File);
    expect(await (file as File).text()).toBe('%PDF-1.7 body');
  });

  it('rejects an upload over the limit before parsing it', async () => {
    const form = new FormData();
    form.set('file', new File(['x'.repeat(5000)], 'a.pdf'));
    const request = await multipartRequest(form);

    await expect(readLimitedFormData(request, 1000)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('answers 400 for a body that is not multipart', async () => {
    const request = new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=zzz' },
      body: 'this is not multipart',
    });

    await expect(readLimitedFormData(request, 1000)).rejects.toMatchObject({ statusCode: 400 });
  });
});
