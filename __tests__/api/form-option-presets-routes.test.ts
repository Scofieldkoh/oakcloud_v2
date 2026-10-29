import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { ConflictError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  resolveWorkspaceId: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  replace: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/lib/api-helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-helpers')>('@/lib/api-helpers');
  return { ...actual, resolveWorkspaceId: mocks.resolveWorkspaceId };
});
vi.mock('@/services/form-option-preset.service', () => ({
  listFormOptionPresets: mocks.list,
  createFormOptionPreset: mocks.create,
  replaceFormOptionPreset: mocks.replace,
  deleteFormOptionPreset: mocks.remove,
}));

function jsonRequest(url: string, method: string, body: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe('/api/forms/presets routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false });
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.resolveWorkspaceId.mockReturnValue('tenant-1');
    mocks.list.mockResolvedValue([{ id: 'preset-1', name: 'Countries' }]);
    mocks.create.mockResolvedValue({ id: 'preset-2', name: 'Industries', optionCount: 1 });
    mocks.replace.mockResolvedValue({ id: 'ssic-id', name: 'SSIC 2025', optionCount: 1 });
    mocks.remove.mockResolvedValue({ id: 'custom-id', name: 'Custom' });
  });

  it('lists presets in the resolved tenant', async () => {
    const { GET } = await import('@/app/api/forms/presets/route');
    const response = await GET(new Request('http://localhost/api/forms/presets?tenantId=tenant-1') as NextRequest);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: 'preset-1', name: 'Countries' }]);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.any(Object), 'document', 'read');
    expect(mocks.list).toHaveBeenCalledWith('tenant-1', 'user-1');
  });

  it('previews CSV with structured counts without persisting', async () => {
    const { POST } = await import('@/app/api/forms/presets/route');
    const response = await POST(jsonRequest('http://localhost/api/forms/presets', 'POST', {
      tenantId: 'tenant-1',
      preview: true,
      csv: 'value,label\nA,Agriculture\nB,Banking',
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      detectedColumns: ['value', 'label'],
      totalRows: 2,
      validRows: 2,
      rejectedRows: 0,
      errors: [],
      sample: [
        { value: 'A', label: 'Agriculture' },
        { value: 'B', label: 'Banking' },
      ],
    }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates a custom preset from valid CSV', async () => {
    const { POST } = await import('@/app/api/forms/presets/route');
    const response = await POST(jsonRequest('http://localhost/api/forms/presets', 'POST', {
      tenantId: 'tenant-1', name: 'Industries', csv: 'value,label\nA,Agriculture',
    }));

    expect(response.status).toBe(201);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.any(Object), 'document', 'update');
    expect(mocks.create).toHaveBeenCalledWith({
      tenantId: 'tenant-1', userId: 'user-1', name: 'Industries',
      options: [{ value: 'A', label: 'Agriculture' }],
    });
  });

  it('returns structured row errors and does not persist an invalid import', async () => {
    const { POST } = await import('@/app/api/forms/presets/route');
    const response = await POST(jsonRequest('http://localhost/api/forms/presets', 'POST', {
      tenantId: 'tenant-1', name: 'Industries', csv: 'value,label\nA,Agriculture\nA,Again',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual(expect.objectContaining({
      totalRows: 2, validRows: 1, rejectedRows: 1,
      errors: [expect.objectContaining({ row: 3, column: 'value', code: 'duplicate_value' })],
    }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('atomically replaces a preset from valid CSV in the resolved tenant', async () => {
    const { PATCH } = await import('@/app/api/forms/presets/[id]/route');
    const response = await PATCH(
      jsonRequest('http://localhost/api/forms/presets/ssic-id', 'PATCH', {
        tenantId: 'tenant-1', csv: 'value,label\n01111,Updated',
      }),
      { params: Promise.resolve({ id: 'ssic-id' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.replace).toHaveBeenCalledWith('ssic-id', {
      tenantId: 'tenant-1', userId: 'user-1',
      options: [{ value: '01111', label: 'Updated' }],
    });
  });

  it('maps protected deletion conflicts to HTTP 409', async () => {
    mocks.remove.mockRejectedValue(new ConflictError('Built-in presets cannot be deleted'));
    const { DELETE } = await import('@/app/api/forms/presets/[id]/route');
    const response = await DELETE(
      new Request('http://localhost/api/forms/presets/countries-id?tenantId=tenant-1') as NextRequest,
      { params: Promise.resolve({ id: 'countries-id' }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.remove).toHaveBeenCalledWith('countries-id', {
      tenantId: 'tenant-1', userId: 'user-1',
    });
  });
});
