import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  canAccessCompany: vi.fn(),
  requirePermission: vi.fn(),
  getValues: vi.fn(),
  saveField: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth, canAccessCompany: mocks.canAccessCompany }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/services/company/document-field-values.service', () => ({
  getCompanyDocumentFieldValues: mocks.getValues,
  saveCompanyDocumentField: mocks.saveField,
}));

import { GET, POST } from '@/app/api/companies/[id]/document-fields/route';

const context = { params: Promise.resolve({ id: 'company-1' }) };
const session = { id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false };

function post(body: unknown) {
  return new NextRequest('http://local/api/companies/company-1/document-fields', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('company document fields route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.canAccessCompany.mockResolvedValue(true);
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.getValues.mockResolvedValue({ 'company.uen': '202400001A' });
    mocks.saveField.mockResolvedValue({ fieldId: 'firstFinancialYearEnd', value: '2025-12-31', values: {} });
  });

  it('returns the values the requested tags print for the company', async () => {
    const response = await GET(
      new NextRequest('http://local/api/companies/company-1/document-fields?tags=company.uen,company.name'),
      context,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ values: { 'company.uen': '202400001A' } });
    expect(mocks.getValues).toHaveBeenCalledWith('company-1', 'tenant-1', ['company.uen', 'company.name']);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'document', 'read');
  });

  it('saves with company update permission and the session user', async () => {
    const response = await POST(post({ fieldId: 'firstFinancialYearEnd', value: '2025-12-31' }), context);
    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'company', 'update', 'company-1');
    expect(mocks.saveField).toHaveBeenCalledWith({
      companyId: 'company-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      fieldId: 'firstFinancialYearEnd',
      value: '2025-12-31',
    });
  });

  it('refuses a company the user cannot access', async () => {
    mocks.canAccessCompany.mockResolvedValue(false);
    const response = await POST(post({ fieldId: 'uen', value: 'X' }), context);
    expect(response.status).toBe(403);
    expect(mocks.saveField).not.toHaveBeenCalled();
  });

  it('refuses without company update permission', async () => {
    mocks.requirePermission.mockRejectedValue(new Error('Forbidden'));
    const response = await POST(post({ fieldId: 'uen', value: 'X' }), context);
    expect(response.status).toBe(403);
    expect(mocks.saveField).not.toHaveBeenCalled();
  });

  it('rejects an unknown field', async () => {
    const response = await POST(post({ fieldId: 'name', value: 'X' }), context);
    expect(response.status).toBe(400);
    expect(mocks.saveField).not.toHaveBeenCalled();
  });
});
