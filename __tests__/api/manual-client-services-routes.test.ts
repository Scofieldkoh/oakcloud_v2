import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ForbiddenError, NotFoundError } from '@/lib/errors';

const session = { id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false };
const authMock = vi.hoisted(() => ({ requireAuth: vi.fn() }));
const rbacMock = vi.hoisted(() => ({ requirePermission: vi.fn(), hasPermission: vi.fn() }));
const serviceMock = vi.hoisted(() => ({
  getManualClientServiceCatalogOptions: vi.fn(),
  createManualClientService: vi.fn(),
}));
vi.mock('@/lib/auth', () => authMock);
vi.mock('@/lib/rbac', () => rbacMock);
vi.mock('@/services/client-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/client-service')>()),
  ...serviceMock,
}));

import { GET as getCatalogOptions } from '@/app/api/companies/[id]/services/catalog-options/route';
import { POST as createService } from '@/app/api/companies/[id]/services/route';
import { ClientServiceWriteConflictError, DuplicateClientServiceError } from '@/services/client-service';

const validCreateBody = {
  serviceVariantId: '11111111-1111-4111-8111-111111111111',
  serviceCadence: 'ANNUALLY',
  startDate: '2026-08-01',
  feeLines: [{ description: 'Annual service fee', amount: '0.00', currency: 'SGD', billingFrequency: 'ANNUALLY' }],
};

describe('manual client service catalog options route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireAuth.mockResolvedValue(session);
    rbacMock.requirePermission.mockResolvedValue(undefined);
    serviceMock.getManualClientServiceCatalogOptions.mockResolvedValue({ variants: [] });
  });

  it('serves minimal options to a company update-only user without document permissions', async () => {
    const response = await getCatalogOptions(
      new NextRequest('http://localhost/api/companies/company-1/services/catalog-options'),
      { params: Promise.resolve({ id: 'company-1' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ variants: [] });
    expect(rbacMock.requirePermission).toHaveBeenCalledWith(session, 'company', 'update', 'company-1');
    expect(rbacMock.hasPermission).not.toHaveBeenCalled();
    expect(serviceMock.getManualClientServiceCatalogOptions).toHaveBeenCalledWith('company-1', { tenantId: 'tenant-1', userId: 'user-1' });
  });

  it('returns a non-revealing 404 for unavailable or cross-workspace companies', async () => {
    serviceMock.getManualClientServiceCatalogOptions.mockRejectedValueOnce(new NotFoundError('Company not found'));

    const response = await getCatalogOptions(
      new NextRequest('http://localhost/api/companies/missing/services/catalog-options'),
      { params: Promise.resolve({ id: 'missing' }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('requires company update permission before projecting options', async () => {
    rbacMock.requirePermission.mockRejectedValueOnce(new ForbiddenError());

    const response = await getCatalogOptions(
      new NextRequest('http://localhost/api/companies/company-1/services/catalog-options'),
      { params: Promise.resolve({ id: 'company-1' }) },
    );

    expect(response.status).toBe(403);
    expect(serviceMock.getManualClientServiceCatalogOptions).not.toHaveBeenCalled();
  });

  it('creates a manual service with company update permission and no document permission call', async () => {
    serviceMock.createManualClientService.mockResolvedValue({ id: 'service-1', source: 'MANUAL' });
    const request = new NextRequest('http://localhost/api/companies/company-1/services', {
      method: 'POST',
      body: JSON.stringify(validCreateBody),
      headers: { 'content-type': 'application/json' },
    });

    const response = await createService(request, { params: Promise.resolve({ id: 'company-1' }) });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: 'service-1', source: 'MANUAL' });
    expect(rbacMock.requirePermission).toHaveBeenCalledWith(session, 'company', 'update', 'company-1');
    expect(rbacMock.hasPermission).not.toHaveBeenCalled();
    expect(serviceMock.createManualClientService).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ serviceVariantId: validCreateBody.serviceVariantId, status: 'ACTIVE', confirmDuplicate: false }),
      { tenantId: 'tenant-1', userId: 'user-1' },
    );
  });

  it('returns field-addressable validation failures as 400 without calling the service', async () => {
    const request = new NextRequest('http://localhost/api/companies/company-1/services', {
      method: 'POST',
      body: JSON.stringify({ ...validCreateBody, feeLines: [{ ...validCreateBody.feeLines[0], amount: '-1.00' }] }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await createService(request, { params: Promise.resolve({ id: 'company-1' }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'The service could not be created.',
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { 'feeLines.0.amount': 'Enter a non-negative amount with at most two decimals.' } },
    });
    expect(serviceMock.createManualClientService).not.toHaveBeenCalled();
  });

  it('returns the validation contract for malformed JSON', async () => {
    const request = new NextRequest('http://localhost/api/companies/company-1/services', {
      method: 'POST',
      body: '{',
      headers: { 'content-type': 'application/json' },
    });

    const response = await createService(request, { params: Promise.resolve({ id: 'company-1' }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'The service could not be created.',
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { body: 'Enter a valid JSON object.' } },
    });
    expect(serviceMock.createManualClientService).not.toHaveBeenCalled();
  });

  it('returns the duplicate summary as a top-level 409', async () => {
    serviceMock.createManualClientService.mockRejectedValueOnce(new DuplicateClientServiceError({
      total: 1,
      items: [{ id: 'service-1', serviceName: 'Corporate Secretarial', startDate: '2026-08-01', status: 'ACTIVE', source: 'MANUAL' }],
    }));
    const request = new NextRequest('http://localhost/api/companies/company-1/services', {
      method: 'POST',
      body: JSON.stringify(validCreateBody),
      headers: { 'content-type': 'application/json' },
    });

    const response = await createService(request, { params: Promise.resolve({ id: 'company-1' }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'A matching client service already exists.',
      code: 'DUPLICATE_CLIENT_SERVICE',
      duplicates: { total: 1, items: [{ id: 'service-1', serviceName: 'Corporate Secretarial', startDate: '2026-08-01', status: 'ACTIVE', source: 'MANUAL' }] },
    });
  });

  it('returns a retriable write-conflict 409 after exhausted serialization retries', async () => {
    serviceMock.createManualClientService.mockRejectedValueOnce(new ClientServiceWriteConflictError());
    const request = new NextRequest('http://localhost/api/companies/company-1/services', {
      method: 'POST',
      body: JSON.stringify(validCreateBody),
      headers: { 'content-type': 'application/json' },
    });

    const response = await createService(request, { params: Promise.resolve({ id: 'company-1' }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Service creation conflicted with another write. Try again.',
      code: 'CLIENT_SERVICE_WRITE_CONFLICT',
      details: { retriable: true },
    });
  });

  it('maps unavailable catalog variants to the non-revealing not-found response', async () => {
    serviceMock.createManualClientService.mockRejectedValueOnce(new NotFoundError('Service variant not found'));
    const request = new NextRequest('http://localhost/api/companies/company-1/services', {
      method: 'POST',
      body: JSON.stringify(validCreateBody),
      headers: { 'content-type': 'application/json' },
    });

    const response = await createService(request, { params: Promise.resolve({ id: 'company-1' }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 403 before mutation when company update permission is denied', async () => {
    rbacMock.requirePermission.mockRejectedValueOnce(new ForbiddenError());
    const request = new NextRequest('http://localhost/api/companies/company-1/services', {
      method: 'POST',
      body: JSON.stringify(validCreateBody),
      headers: { 'content-type': 'application/json' },
    });

    const response = await createService(request, { params: Promise.resolve({ id: 'company-1' }) });

    expect(response.status).toBe(403);
    expect(serviceMock.createManualClientService).not.toHaveBeenCalled();
  });
});
