// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createOakDocPartial = vi.fn();
const updateOakDocPartial = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({ id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false })),
}));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn(async () => undefined) }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/services/oakdoc-partial.service', () => ({
  createOakDocPartial: (...args: unknown[]) => createOakDocPartial(...args),
  updateOakDocPartial: (...args: unknown[]) => updateOakDocPartial(...args),
  downloadOakDocPartial: vi.fn(),
}));

const { POST } = await import('@/app/api/template-partials/oakdoc/route');
const { PUT } = await import('@/app/api/template-partials/[id]/oakdoc/route');

function form(fields: Record<string, string | Blob>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Blob) data.append(key, value, 'scope.docx');
    else data.append(key, value);
  }
  return data;
}

const file = new Blob([new Uint8Array([80, 75, 3, 4])]);

beforeEach(() => {
  createOakDocPartial.mockReset();
  updateOakDocPartial.mockReset();
});

describe('Word partial routes', () => {
  it('creates a Word partial from an upload', async () => {
    createOakDocPartial.mockResolvedValue({ id: 'p-1', version: 1 });
    const response = await POST(new NextRequest('http://localhost/api/template-partials/oakdoc', {
      method: 'POST',
      body: form({ file, name: 'scope', displayName: 'Scope of work' }),
    }));
    expect(response.status).toBe(201);
    expect(createOakDocPartial).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'scope', displayName: 'Scope of work', fileName: 'scope.docx' }),
      { tenantId: 'tenant-1', userId: 'user-1' },
    );
  });

  it('requires the expected revision to save new bytes', async () => {
    const request = (fields: Record<string, string | Blob>) => PUT(
      new NextRequest('http://localhost/api/template-partials/p-1/oakdoc', { method: 'PUT', body: form(fields) }),
      { params: Promise.resolve({ id: 'p-1' }) },
    );
    expect((await request({ file })).status).toBe(428);
    expect(updateOakDocPartial).not.toHaveBeenCalled();

    updateOakDocPartial.mockResolvedValue({ id: 'p-1', version: 3 });
    const response = await request({ file, expectedRevision: '2' });
    expect(response.status).toBe(200);
    expect(updateOakDocPartial).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-1', expectedRevision: 2, refreshPins: undefined }),
      { tenantId: 'tenant-1', userId: 'user-1' },
    );
  });
});
