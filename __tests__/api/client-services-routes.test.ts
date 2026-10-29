import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';

const session = { id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false };
const authMock = vi.hoisted(() => ({ requireAuth: vi.fn() }));
const rbacMock = vi.hoisted(() => ({ requirePermission: vi.fn(), hasPermission: vi.fn() }));
const serviceMock = vi.hoisted(() => ({
  listCompanyServices: vi.fn(), getClientService: vi.fn(), updateClientService: vi.fn(), archiveClientService: vi.fn(), deleteClientServicePermanently: vi.fn(),
  requestManualServiceAgreementActivation: vi.fn(), retryServiceAgreementActivation: vi.fn(), getServiceAgreementCompanyIds: vi.fn(),
  createManualClientService: vi.fn(),
}));
vi.mock('@/lib/auth', () => authMock);
vi.mock('@/lib/rbac', () => rbacMock);
vi.mock('@/services/client-service', () => serviceMock);
vi.mock('@/services/service-agreement', () => serviceMock);

import { GET as listServices } from '@/app/api/companies/[id]/services/route';
import { GET as getService, PATCH as updateService, DELETE as archiveService } from '@/app/api/client-services/[id]/route';
import { POST as markEffective } from '@/app/api/service-agreements/[id]/mark-effective/route';
import { POST as retryActivation } from '@/app/api/service-agreements/[id]/retry-activation/route';

describe('client services routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireAuth.mockResolvedValue(session);
    rbacMock.hasPermission.mockResolvedValue(true);
    serviceMock.listCompanyServices.mockResolvedValue({ services: [], total: 0 });
    serviceMock.getClientService.mockResolvedValue({ id: 'service-1', companyId: 'company-1' });
    serviceMock.updateClientService.mockResolvedValue({ id: 'service-1' });
    serviceMock.archiveClientService.mockResolvedValue({ id: 'service-1', archived: true });
    serviceMock.deleteClientServicePermanently.mockResolvedValue({ id: 'service-1', deleted: true, deletedCounts: {} });
    serviceMock.getServiceAgreementCompanyIds.mockResolvedValue(['company-1', 'company-2']);
    serviceMock.requestManualServiceAgreementActivation.mockResolvedValue({ agreementId: 'agreement-1', activationStatus: 'PENDING' });
    serviceMock.retryServiceAgreementActivation.mockResolvedValue({ agreementId: 'agreement-1', activationStatus: 'PENDING' });
  });

  it('uses company permissions for operational service access', async () => {
    const response = await listServices(new NextRequest('http://localhost/api/companies/company-1/services'), { params: Promise.resolve({ id: 'company-1' }) });
    expect(response.status).toBe(200);
    expect(rbacMock.requirePermission).toHaveBeenCalledWith(session, 'company', 'read', 'company-1');
  });

  it('returns 403 before listing services when company read permission is denied', async () => {
    rbacMock.requirePermission.mockRejectedValueOnce(new ForbiddenError());
    const response = await listServices(new NextRequest('http://localhost/api/companies/company-1/services'), { params: Promise.resolve({ id: 'company-1' }) });
    expect(response.status).toBe(403);
    expect(serviceMock.listCompanyServices).not.toHaveBeenCalled();
  });

  it('returns canRetry false when any agreement company permission is missing', async () => {
    serviceMock.listCompanyServices.mockResolvedValue({ services: [], total: 0, activations: [{ agreementId: 'agreement-1' }] });
    serviceMock.getServiceAgreementCompanyIds.mockResolvedValue(['company-1', 'company-2']);
    rbacMock.hasPermission.mockImplementation(async (_userId, resource, _action, companyId) => resource === 'document' || companyId === 'company-1');
    const response = await listServices(new NextRequest('http://localhost/api/companies/company-1/services'), { params: Promise.resolve({ id: 'company-1' }) });
    await expect(response.json()).resolves.toMatchObject({ activations: [{ canRetry: false }] });
  });

  it('validates and updates an operational service', async () => {
    const request = new NextRequest('http://localhost/api/client-services/service-1', { method: 'PATCH', body: JSON.stringify({ updatedAt: '2026-07-30T00:00:00.000Z', status: 'PAUSED' }), headers: { 'content-type': 'application/json' } });
    const response = await updateService(request, { params: Promise.resolve({ id: 'service-1' }) });
    expect(response.status).toBe(200);
    expect(serviceMock.updateClientService).toHaveBeenCalledWith('service-1', { expectedUpdatedAt: '2026-07-30T00:00:00.000Z', status: 'PAUSED' }, { tenantId: 'tenant-1', userId: 'user-1' });
  });

  it('returns service detail and maps stale edits to HTTP 409', async () => {
    expect((await getService(new NextRequest('http://localhost/api/client-services/service-1'), { params: Promise.resolve({ id: 'service-1' }) })).status).toBe(200);
    serviceMock.updateClientService.mockRejectedValueOnce(new ConflictError('stale'));
    const response = await updateService(new NextRequest('http://localhost/api/client-services/service-1', { method: 'PATCH', body: JSON.stringify({ updatedAt: '2026-07-30T00:00:00.000Z', status: 'PAUSED' }) }), { params: Promise.resolve({ id: 'service-1' }) });
    expect(response.status).toBe(409);
  });

  it('maps a missing service to HTTP 404', async () => {
    serviceMock.getClientService.mockRejectedValueOnce(new NotFoundError('Service not found'));
    const response = await getService(new NextRequest('http://localhost/api/client-services/missing'), { params: Promise.resolve({ id: 'missing' }) });
    expect(response.status).toBe(404);
    expect(rbacMock.requirePermission).not.toHaveBeenCalled();
  });

  it('returns 403 without updating when company update permission is denied', async () => {
    rbacMock.requirePermission.mockRejectedValueOnce(new ForbiddenError());
    const request = new NextRequest('http://localhost/api/client-services/service-1', { method: 'PATCH', body: JSON.stringify({ updatedAt: '2026-07-30T00:00:00.000Z', status: 'PAUSED' }), headers: { 'content-type': 'application/json' } });
    const response = await updateService(request, { params: Promise.resolve({ id: 'service-1' }) });
    expect(response.status).toBe(403);
    expect(serviceMock.updateClientService).not.toHaveBeenCalled();
  });

  it('rejects a no-op patch without creating a false audit mutation', async () => {
    const response = await updateService(new NextRequest('http://localhost/api/client-services/service-1', { method: 'PATCH', body: JSON.stringify({ updatedAt: '2026-07-30T00:00:00.000Z' }) }), { params: Promise.resolve({ id: 'service-1' }) });
    expect(response.status).toBe(400);
    expect(serviceMock.updateClientService).not.toHaveBeenCalled();
  });

  it('checks the full retry permission set', async () => {
    const response = await retryActivation(new NextRequest('http://localhost/api/service-agreements/agreement-1/retry-activation', { method: 'POST' }), { params: Promise.resolve({ id: 'agreement-1' }) });
    expect(response.status).toBe(200);
    expect(rbacMock.requirePermission).toHaveBeenCalledWith(session, 'document', 'update');
    expect(rbacMock.requirePermission).toHaveBeenCalledWith(session, 'company', 'update', 'company-2');
  });

  it('requires a meaningful archive reason', async () => {
    const request = new NextRequest('http://localhost/api/client-services/service-1', { method: 'DELETE', body: JSON.stringify({ reason: 'short' }), headers: { 'content-type': 'application/json' } });
    expect((await archiveService(request, { params: Promise.resolve({ id: 'service-1' }) })).status).toBe(400);
  });

  it('permanently deletes through an explicit mode with company update permission', async () => {
    const request = new NextRequest('http://localhost/api/client-services/service-1', {
      method: 'DELETE',
      body: JSON.stringify({
        deletionMode: 'PERMANENT',
        expectedUpdatedAt: '2026-07-30T00:00:00.000Z',
        reason: 'Created against the wrong company',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await archiveService(request, { params: Promise.resolve({ id: 'service-1' }) });

    expect(response.status).toBe(200);
    expect(rbacMock.requirePermission).toHaveBeenCalledWith(session, 'company', 'update', 'company-1');
    expect(serviceMock.deleteClientServicePermanently).toHaveBeenCalledWith('service-1', {
      deletionMode: 'PERMANENT',
      expectedUpdatedAt: '2026-07-30T00:00:00.000Z',
      reason: 'Created against the wrong company',
    }, { tenantId: 'tenant-1', userId: 'user-1' });
    expect(serviceMock.archiveClientService).not.toHaveBeenCalled();
  });

  it('requires document update and every company update permission for manual activation', async () => {
    const request = new NextRequest('http://localhost/api/service-agreements/agreement-1/mark-effective', { method: 'POST', body: JSON.stringify({ signedAt: '2026-07-30T00:00:00.000Z', effectiveDate: '2026-07-30', reason: 'Externally signed by the client' }), headers: { 'content-type': 'application/json' } });
    const response = await markEffective(request, { params: Promise.resolve({ id: 'agreement-1' }) });
    expect(response.status).toBe(200);
    expect(rbacMock.requirePermission).toHaveBeenCalledWith(session, 'document', 'update');
    expect(rbacMock.requirePermission).toHaveBeenCalledWith(session, 'company', 'update', 'company-1');
    expect(rbacMock.requirePermission).toHaveBeenCalledWith(session, 'company', 'update', 'company-2');
  });

  it('returns 403 without manual activation when document update permission is denied', async () => {
    rbacMock.requirePermission.mockRejectedValueOnce(new ForbiddenError());
    const request = new NextRequest('http://localhost/api/service-agreements/agreement-1/mark-effective', { method: 'POST', body: JSON.stringify({ signedAt: '2026-07-30T00:00:00.000Z', effectiveDate: '2026-07-30', reason: 'Externally signed by the client' }), headers: { 'content-type': 'application/json' } });
    const response = await markEffective(request, { params: Promise.resolve({ id: 'agreement-1' }) });
    expect(response.status).toBe(403);
    expect(serviceMock.getServiceAgreementCompanyIds).not.toHaveBeenCalled();
    expect(serviceMock.requestManualServiceAgreementActivation).not.toHaveBeenCalled();
  });

  it('returns 403 without retrying when any company update permission is denied', async () => {
    rbacMock.requirePermission
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenError());
    const response = await retryActivation(new NextRequest('http://localhost/api/service-agreements/agreement-1/retry-activation', { method: 'POST' }), { params: Promise.resolve({ id: 'agreement-1' }) });
    expect(response.status).toBe(403);
    expect(serviceMock.retryServiceAgreementActivation).not.toHaveBeenCalled();
  });
});
