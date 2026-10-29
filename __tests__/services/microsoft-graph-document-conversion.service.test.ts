import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveConnector: vi.fn(),
  incrementConnectorUsage: vi.fn(),
}));

vi.mock('@/services/connector.service', () => ({
  resolveConnector: mocks.resolveConnector,
  incrementConnectorUsage: mocks.incrementConnectorUsage,
}));

import { convertOfficeDocumentToPdfWithMicrosoftGraph } from '@/services/microsoft-graph-document-conversion.service';
import {
  convertOfficeDocumentToPdfWithMicrosoftGraphDetailed,
  hasMicrosoftGraphDocumentConversionConnector,
} from '@/services/microsoft-graph-document-conversion.service';

function response(body: unknown, init: ResponseInit = {}): Response {
  if (body instanceof Uint8Array) {
    const arrayBuffer = new ArrayBuffer(body.byteLength);
    new Uint8Array(arrayBuffer).set(body);
    return new Response(arrayBuffer, init);
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

describe('microsoft-graph-document-conversion.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads a Word document to SharePoint, downloads it as PDF, and deletes the temporary file', async () => {
    mocks.resolveConnector.mockResolvedValueOnce({
      source: 'workspace',
      connector: {
        id: 'connector-sharepoint',
        provider: 'SHAREPOINT',
        credentials: {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          tenantId: 'tenant-ms',
          siteId: 'site-id',
          driveId: 'drive-id',
        },
        settings: {
          rootFolder: 'OakcloudTemp',
        },
      },
    });

    const pdfBuffer = Buffer.from('%PDF-1.7\nfrom graph');
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();

      if (target.includes('/oauth2/v2.0/token')) {
        return response({ access_token: 'graph-token', expires_in: 3600 });
      }

      if (target.includes('/root:/OakcloudTemp/') && init?.method === 'PUT') {
        expect(init.headers).toMatchObject({
          Authorization: 'Bearer graph-token',
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        return response({ id: 'uploaded-item-id', name: 'uploaded.docx' });
      }

      if (target.endsWith('/items/uploaded-item-id/content?format=pdf')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer graph-token' });
        return response(new Uint8Array(pdfBuffer), {
          headers: { 'Content-Type': 'application/pdf' },
        });
      }

      if (target.endsWith('/items/uploaded-item-id') && init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch: ${target}`);
    });

    const result = await convertOfficeDocumentToPdfWithMicrosoftGraph({
      tenantId: 'workspace-id',
      fileName: 'Agreement.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('docx bytes'),
      fetchImpl,
    });

    expect(result).toEqual(pdfBuffer);
    expect(mocks.resolveConnector).toHaveBeenCalledWith('workspace-id', 'STORAGE', 'SHAREPOINT');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/sites/site-id/drives/drive-id/items/uploaded-item-id',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(mocks.incrementConnectorUsage).toHaveBeenCalledWith('connector-sharepoint');
  });

  it('falls back to a OneDrive connector when it has a drive target', async () => {
    mocks.resolveConnector
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        source: 'system',
        connector: {
          id: 'connector-onedrive',
          provider: 'ONEDRIVE',
          credentials: {
            clientId: 'client-id',
            clientSecret: 'client-secret',
            tenantId: 'tenant-ms',
            driveId: 'drive-id',
          },
          settings: null,
        },
      });

    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();

      if (target.includes('/oauth2/v2.0/token')) {
        return response({ access_token: 'graph-token', expires_in: 3600 });
      }
      if (target.includes('/drives/drive-id/root:/') && init?.method === 'PUT') {
        return response({ id: 'onedrive-item-id' });
      }
      if (target.endsWith('/drives/drive-id/items/onedrive-item-id/content?format=pdf')) {
        return response(new Uint8Array(Buffer.from('%PDF-1.7\nonedrive')));
      }
      if (target.endsWith('/drives/drive-id/items/onedrive-item-id') && init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch: ${target}`);
    });

    const result = await convertOfficeDocumentToPdfWithMicrosoftGraph({
      tenantId: 'workspace-id',
      fileName: 'Agreement.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('docx bytes'),
      fetchImpl,
    });

    expect(result.toString('utf8')).toContain('%PDF');
    expect(mocks.resolveConnector).toHaveBeenNthCalledWith(1, 'workspace-id', 'STORAGE', 'SHAREPOINT');
    expect(mocks.resolveConnector).toHaveBeenNthCalledWith(2, 'workspace-id', 'STORAGE', 'ONEDRIVE');
    expect(mocks.incrementConnectorUsage).toHaveBeenCalledWith('connector-onedrive');
  });

  it('throws a clear error when no Microsoft Graph storage connector is available', async () => {
    mocks.resolveConnector.mockResolvedValue(null);

    await expect(
      convertOfficeDocumentToPdfWithMicrosoftGraph({
        tenantId: 'workspace-id',
        fileName: 'Agreement.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from('docx bytes'),
      })
    ).rejects.toThrow('Configure a SharePoint or OneDrive connector before uploading Word documents');
  });

  it('reports conversion unavailable when no Microsoft storage connector resolves', async () => {
    mocks.resolveConnector.mockResolvedValue(null);

    await expect(hasMicrosoftGraphDocumentConversionConnector('workspace-id')).resolves.toBe(false);
  });

  it('reports conversion available for a SharePoint connector with a site target', async () => {
    mocks.resolveConnector.mockResolvedValueOnce({
      connector: {
        provider: 'SHAREPOINT',
        credentials: {
          siteId: 'site-id',
          tenantId: 'tenant-ms',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        },
        settings: null,
      },
    });

    await expect(hasMicrosoftGraphDocumentConversionConnector('workspace-id')).resolves.toBe(true);
  });

  it('reports conversion unavailable for a OneDrive connector without a drive or user target', async () => {
    mocks.resolveConnector
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        connector: {
          provider: 'ONEDRIVE',
          credentials: {
            tenantId: 'tenant-ms',
            clientId: 'client-id',
            clientSecret: 'client-secret',
          },
          settings: null,
        },
      });

    await expect(hasMicrosoftGraphDocumentConversionConnector('workspace-id')).resolves.toBe(false);
  });

  describe('bounded conversion and cleanup (O1)', () => {
    const sharePoint = {
      source: 'workspace',
      connector: {
        id: 'connector-sharepoint',
        provider: 'SHAREPOINT',
        credentials: { clientId: 'c', clientSecret: 's', tenantId: 't', siteId: 'site-id', driveId: 'drive-id' },
        settings: {},
      },
    };

    function graph(handlers: { pdf: () => Response; remove?: () => Response }) {
      return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = url.toString();
        if (target.includes('/oauth2/v2.0/token')) return response({ access_token: 'graph-token' });
        if (init?.method === 'PUT') return response({ id: 'item-1' });
        if (target.endsWith('/content?format=pdf')) return handlers.pdf();
        if (init?.method === 'DELETE') return handlers.remove ? handlers.remove() : new Response(null, { status: 204 });
        throw new Error(`Unexpected fetch: ${target}`);
      });
    }

    it('returns the PDF and reports cleanup failure instead of discarding a good conversion', async () => {
      mocks.resolveConnector.mockResolvedValue(sharePoint);
      const fetchImpl = graph({
        pdf: () => response(new Uint8Array(Buffer.from('%PDF-1.7 ok'))),
        remove: () => response({ error: { message: 'locked' } }, { status: 423 }),
      });

      const result = await convertOfficeDocumentToPdfWithMicrosoftGraphDetailed({
        tenantId: 'workspace-id', fileName: 'a.docx', buffer: Buffer.from('docx'), fetchImpl,
      });

      expect(result).toMatchObject({ connectorId: 'connector-sharepoint', provider: 'SHAREPOINT', cleanupFailed: true });
      expect(result.buffer.toString()).toBe('%PDF-1.7 ok');
    });

    it('keeps the primary conversion error when cleanup also fails', async () => {
      mocks.resolveConnector.mockResolvedValue(sharePoint);
      const fetchImpl = graph({
        pdf: () => response({ error: { message: 'Access denied' } }, { status: 403 }),
        remove: () => response({ error: { message: 'locked' } }, { status: 423 }),
      });

      await expect(convertOfficeDocumentToPdfWithMicrosoftGraphDetailed({
        tenantId: 'workspace-id', fileName: 'a.docx', buffer: Buffer.from('docx'), fetchImpl,
      })).rejects.toMatchObject({ message: 'Access denied', statusCode: 503, status: 403 });
    });

    it('retries throttled conversion requests before succeeding', async () => {
      vi.useFakeTimers();
      try {
        mocks.resolveConnector.mockResolvedValue(sharePoint);
        let calls = 0;
        const fetchImpl = graph({
          pdf: () => {
            calls += 1;
            return calls === 1
              ? new Response(null, { status: 429, headers: { 'Retry-After': '1' } })
              : response(new Uint8Array(Buffer.from('%PDF-1.7 retried')));
          },
        });
        const pending = convertOfficeDocumentToPdfWithMicrosoftGraphDetailed({
          tenantId: 'workspace-id', fileName: 'a.docx', buffer: Buffer.from('docx'), fetchImpl,
        });
        await vi.advanceTimersByTimeAsync(1_000);
        const result = await pending;
        expect(calls).toBe(2);
        expect(result.buffer.toString()).toBe('%PDF-1.7 retried');
      } finally {
        vi.useRealTimers();
      }
    });

    it('selects a usable OneDrive connector when SharePoint lacks a site, matching the capability probe', async () => {
      mocks.resolveConnector
        .mockResolvedValueOnce({ ...sharePoint, connector: { ...sharePoint.connector, credentials: { clientId: 'c', clientSecret: 's', tenantId: 't' } } })
        .mockResolvedValueOnce({
          source: 'workspace',
          connector: {
            id: 'connector-onedrive', provider: 'ONEDRIVE',
            credentials: { clientId: 'c', clientSecret: 's', tenantId: 't', driveId: 'drive-2' }, settings: {},
          },
        });
      const fetchImpl = graph({ pdf: () => response(new Uint8Array(Buffer.from('%PDF-1.7 od'))) });

      const result = await convertOfficeDocumentToPdfWithMicrosoftGraphDetailed({
        tenantId: 'workspace-id', fileName: 'a.docx', buffer: Buffer.from('docx'), fetchImpl,
      });
      expect(result.connectorId).toBe('connector-onedrive');
    });
  });
});
