// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma';
import { authErrorResponse, clientErrorMessage, isInternalError, routeErrorResponse } from '@/lib/api-route-errors';
import { ApiError, ConflictError, ErrorCodes, NotFoundError } from '@/lib/errors';

async function read(response: Response) {
  return { status: response.status, body: await response.json() };
}

describe('routeErrorResponse', () => {
  it('maps auth and permission errors', async () => {
    await expect(read(routeErrorResponse(new Error('Unauthorized')))).resolves.toEqual({
      status: 401, body: { error: 'Unauthorized' },
    });
    await expect(read(routeErrorResponse(new Error('Forbidden')))).resolves.toEqual({
      status: 403, body: { error: 'Forbidden' },
    });
    await expect(read(routeErrorResponse(new Error('Permission denied: company:update')))).resolves.toEqual({
      status: 403, body: { error: 'Forbidden' },
    });
  });

  it('returns listed not-found and conflict messages', async () => {
    const options = { notFound: ['Company not found'], conflict: ['A tag with this name already exists'] };
    await expect(read(routeErrorResponse(new Error('Company not found'), options))).resolves.toEqual({
      status: 404, body: { error: 'Company not found' },
    });
    await expect(read(routeErrorResponse(new Error('A tag with this name already exists'), options))).resolves.toEqual({
      status: 409, body: { error: 'A tag with this name already exists' },
    });
    await expect(read(routeErrorResponse(new Error('Note tab not found'), { notFound: 'any' }))).resolves.toEqual({
      status: 404, body: { error: 'Note tab not found' },
    });
  });

  it('hides unrecognised errors unless the route falls back to 400', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(read(routeErrorResponse(new Error('db down'), { logLabel: 'Load failed:' }))).resolves.toEqual({
      status: 500, body: { error: 'Internal server error' },
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Load failed:'), expect.any(Error));
    await expect(read(routeErrorResponse(new Error('Company not found')))).resolves.toMatchObject({ status: 500 });
    await expect(read(routeErrorResponse('oops', { fallback: 'bad-request' }))).resolves.toMatchObject({ status: 500 });
    await expect(read(routeErrorResponse(new Error('Bad UEN'), { fallback: 'bad-request' }))).resolves.toEqual({
      status: 400, body: { error: 'Bad UEN' },
    });
    log.mockRestore();
  });

  it('keeps the status of application errors', async () => {
    const notFound = await read(routeErrorResponse(new NotFoundError('Deleted template not found')));
    expect(notFound.status).toBe(404);
    expect(notFound.body.error).toBe('Deleted template not found');
    const conflict = await read(routeErrorResponse(new ConflictError('In use'), { fallback: 'bad-request' }));
    expect(conflict.status).toBe(409);
    const internal = await read(routeErrorResponse(new ApiError(ErrorCodes.INTERNAL_ERROR, 'secret detail')));
    expect(internal).toEqual({ status: 500, body: { error: 'Internal server error' } });
  });

  it('never shows database or runtime error messages', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError(
      'Invalid `prisma.company.update()` invocation: column "secret" does not exist',
      { code, clientVersion: 'test' },
    );
    await expect(read(routeErrorResponse(prismaError('P2002'), { fallback: 'bad-request' }))).resolves.toEqual({
      status: 409, body: { error: 'A record with these details already exists' },
    });
    await expect(read(routeErrorResponse(prismaError('P2025'), { fallback: 'bad-request' }))).resolves.toEqual({
      status: 404, body: { error: 'Record not found' },
    });
    await expect(read(routeErrorResponse(prismaError('P2010'), { fallback: 'bad-request', notFound: 'any' }))).resolves.toEqual({
      status: 500, body: { error: 'Internal server error' },
    });
    const validation = new Prisma.PrismaClientValidationError('Invalid value for argument `id`: required', { clientVersion: 'test' });
    await expect(read(routeErrorResponse(validation, { fallback: 'bad-request' }))).resolves.toMatchObject({ status: 500 });
    await expect(read(routeErrorResponse(new TypeError("Cannot read properties of undefined (reading 'id')"), {
      fallback: 'bad-request', serverErrorMessage: 'Failed to load',
    }))).resolves.toEqual({ status: 500, body: { error: 'Failed to load' } });
    const adapterError = Object.assign(new Error('violates check constraint "x"'), { name: 'DriverAdapterError' });
    expect(isInternalError(adapterError)).toBe(true);
    expect(isInternalError(new Error('Company not found'))).toBe(false);
    log.mockRestore();
  });

  it('answers an unreadable JSON body with a 400', async () => {
    await expect(read(routeErrorResponse(new SyntaxError('Unexpected token < in JSON at position 0')))).resolves.toEqual({
      status: 400, body: { error: 'Invalid request body' },
    });
  });

  it('gives routes with their own payloads the auth statuses and safe messages', async () => {
    await expect(read(authErrorResponse(new Error('Permission denied: connector:read'))!)).resolves.toEqual({
      status: 403, body: { error: 'Forbidden' },
    });
    expect(authErrorResponse(new Error('SharePoint is offline'))).toBeNull();
    expect(clientErrorMessage(new Error('Company has active agreements'), 'Could not purge')).toBe('Company has active agreements');
    expect(clientErrorMessage(new TypeError('x is undefined'), 'Could not purge')).toBe('Could not purge');
  });
});
