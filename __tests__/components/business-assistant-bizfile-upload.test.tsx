import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assistantTurn: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('@/hooks/use-business-assistant', () => ({
  useAssistantTurn: () => ({
    mutateAsync: mocks.assistantTurn,
    isPending: false,
  }),
}));

vi.mock('@/lib/browser-upload', () => ({
  postFormDataWithFallback: mocks.upload,
}));

vi.mock('@/components/processing', () => ({
  DocumentPageViewer: ({ pdfUrl }: { pdfUrl?: string }) => (
    <div data-testid="pdf-preview">PDF preview {pdfUrl}</div>
  ),
}));

import { BusinessAssistantAttachmentMenu } from '@/components/business-assistant/attachment-menu';
import {
  BIZFILE_MAX_UPLOAD_BYTES,
  BizFileUploadDialog,
  buildBizFileAssistantTurnRequest,
  validateBizFileUpload,
} from '@/components/business-assistant/bizfile-upload-dialog';
import type { ExtractedBizFileData } from '@/services/bizfile/types';

const fixture: ExtractedBizFileData = {
  entityDetails: {
    uen: '202400001A',
    name: 'Example Pte. Ltd.',
    entityType: 'PRIVATE_LIMITED',
    status: 'LIVE',
  },
};

const acceptedTurn = {
  type: 'accepted' as const,
  conversationId: 'conversation-1',
  messageId: 'message-1',
  runId: 'run-1',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function extraction(body: Partial<{ conflict: unknown; extractedData: ExtractedBizFileData }> = {}) {
  return jsonResponse({
    success: true,
    extractedData: body.extractedData ?? fixture,
    conflict: body.conflict ?? null,
    aiMetadata: { modelName: 'Test model' },
  });
}

function pdfFile(name = 'bizfile.pdf') {
  return new File(['%PDF-1.7 test'], name, { type: 'application/pdf' });
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof BizFileUploadDialog>> = {}) {
  const props: React.ComponentProps<typeof BizFileUploadDialog> = {
    isOpen: true,
    workspaceId: 'workspace-1',
    conversationId: 'conversation-existing',
    message: 'Can you upload this BizFile for me?',
    onClose: vi.fn(),
    onAccepted: vi.fn(),
    ...overrides,
  };
  return { ...render(<BizFileUploadDialog {...props} />), props };
}

async function chooseFile(file = pdfFile()) {
  fireEvent.change(screen.getByTestId('bizfile-file-input'), { target: { files: [file] } });
}

async function waitForReview() {
  return screen.findByRole('button', { name: 'Review proposed changes' });
}

describe('Business Assistant BizFile direct upload', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      media: '(min-width: 1024px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:bizfile-preview'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });

    mocks.upload.mockResolvedValue(jsonResponse({
      documentId: 'document-1',
      fileName: 'bizfile.pdf',
      fileSize: 128,
    }, 201));
    mocks.assistantTurn.mockResolvedValue(acceptedTurn);
    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/documents/document-1/extract') return extraction();
      if (url === '/api/documents/document-1' && init?.method === 'DELETE') {
        return jsonResponse({ success: true });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes Upload BizFile and Choose workspace record in the attachment menu', async () => {
    const onUploadBizFile = vi.fn();
    const onChooseRecord = vi.fn();
    render(
      <BusinessAssistantAttachmentMenu
        onUploadBizFile={onUploadBizFile}
        onChooseRecord={onChooseRecord}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(await screen.findByRole('menuitem', { name: 'Upload BizFile' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Choose workspace record' })).toBeVisible();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Upload BizFile' }));
    expect(onUploadBizFile).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Choose workspace record' }));
    expect(onChooseRecord).toHaveBeenCalledOnce();
  });

  it('uploads through the canonical document endpoint and extracts successfully', async () => {
    renderDialog();
    await chooseFile();
    await waitForReview();

    expect(mocks.upload).toHaveBeenCalledWith('/api/documents/upload', expect.any(FormData));
    const formData = mocks.upload.mock.calls[0][1] as FormData;
    expect(formData.get('documentType')).toBe('BIZFILE');
    expect(formData.get('tenantId')).toBe('workspace-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/document-1/extract', expect.objectContaining({ method: 'POST' }));
    // jsdom has no desktop media query, so the review shows the mobile Document tab.
    fireEvent.click(screen.getByRole('tab', { name: 'Document' }));
    expect(screen.getByTestId('pdf-preview')).toHaveTextContent('blob:bizfile-preview');
  });

  it('rejects an unsupported file type before upload', async () => {
    renderDialog();
    await chooseFile(new File(['hello'], 'notes.txt', { type: 'text/plain' }));

    expect(await screen.findByText('Only PDF and image files (PNG, JPG, WebP) are allowed.')).toBeVisible();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('rejects an oversized file before upload', async () => {
    expect(validateBizFileUpload({ name: 'large.pdf', type: 'application/pdf', size: BIZFILE_MAX_UPLOAD_BYTES + 1 }))
      .toBe('BizFile must be 10 MB or smaller.');
    renderDialog();
    const oversized = new File([new Uint8Array(BIZFILE_MAX_UPLOAD_BYTES + 1)], 'large.pdf', { type: 'application/pdf' });
    await chooseFile(oversized);

    expect(await screen.findByText('BizFile must be 10 MB or smaller.')).toBeVisible();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('surfaces extraction failure without creating an assistant turn', async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/documents/document-1/extract') return jsonResponse({ error: 'Vision extraction unavailable' }, 400);
      if (url === '/api/documents/document-1' && init?.method === 'DELETE') return jsonResponse({ success: true });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    renderDialog();
    await chooseFile();

    expect(await screen.findByText('Vision extraction unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry extraction' })).toBeVisible();
    expect(mocks.assistantTurn).not.toHaveBeenCalled();
  });

  it('passes corrected review data deterministically into capabilityInput', async () => {
    renderDialog();
    await chooseFile();
    await waitForReview();
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Corrected Pte. Ltd.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review proposed changes' }));

    await waitFor(() => expect(mocks.assistantTurn).toHaveBeenCalledOnce());
    expect(mocks.assistantTurn.mock.calls[0][0]).toEqual(expect.objectContaining({
      capabilityInput: expect.objectContaining({
        documentId: 'document-1',
        mode: 'CREATE',
        extractedData: expect.objectContaining({
          entityDetails: expect.objectContaining({ name: 'Corrected Pte. Ltd.' }),
        }),
      }),
    }));
  });

  it('requires an explicit update choice when extraction finds an active company', async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/documents/document-1/extract') return extraction({ conflict: {
        type: 'ALREADY_EXISTS', companyId: 'company-1', companyName: 'Example Pte. Ltd.', uen: '202400001A',
      } });
      if (url === '/api/documents/document-1' && init?.method === 'DELETE') return jsonResponse({ success: true });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    renderDialog();
    await chooseFile();

    expect(await screen.findByText('Existing company found')).toBeVisible();
    expect(screen.getByText('Example Pte. Ltd.').parentElement).toHaveTextContent(/Example Pte\. Ltd\..*202400001A/);
    expect(mocks.assistantTurn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review update to existing company' }));
    expect(await waitForReview()).toBeVisible();
  });

  it('blocks a recycle-bin conflict and exposes recovery guidance without restoring', async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/documents/document-1/extract') return extraction({ conflict: {
        type: 'IN_RECYCLE_BIN', companyId: 'company-deleted', companyName: 'Deleted Pte. Ltd.', uen: '202400002B',
      } });
      if (url === '/api/documents/document-1' && init?.method === 'DELETE') return jsonResponse({ success: true });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    renderDialog();
    await chooseFile();

    expect(await screen.findByText('Company is in the recycle bin')).toBeVisible();
    expect(screen.getByText(/Restore it through company administration/i)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open company management' })).toHaveAttribute('href', '/companies');
    expect(mocks.assistantTurn).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('action=restore') || (init as RequestInit | undefined)?.method === 'PUT')).toBe(false);
  });

  it('cleans up an abandoned temporary document on cancellation before submission', async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    await chooseFile();
    await waitForReview();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/documents/document-1', expect.objectContaining({ method: 'DELETE' })));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('creates the assistant turn with bizfile.import_and_review@1.0', async () => {
    renderDialog();
    await chooseFile();
    await waitForReview();
    fireEvent.click(screen.getByRole('button', { name: 'Review proposed changes' }));

    await waitFor(() => expect(mocks.assistantTurn).toHaveBeenCalledOnce());
    expect(mocks.assistantTurn.mock.calls[0][0]).toEqual(expect.objectContaining({
      context: {
        route: '/business-assistant',
        capabilityId: 'bizfile.import_and_review',
        capabilityVersion: '1.0',
      },
    }));
  });

  it('attaches the uploaded document as the source ResourceRef', async () => {
    renderDialog();
    await chooseFile();
    await waitForReview();
    fireEvent.click(screen.getByRole('button', { name: 'Review proposed changes' }));

    await waitFor(() => expect(mocks.assistantTurn).toHaveBeenCalledOnce());
    expect(mocks.assistantTurn.mock.calls[0][0].resources).toContainEqual({
      resourceType: 'document', resourceId: 'document-1', role: 'source',
    });
  });

  it('attaches the active company as target and submits UPDATE mode', async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/documents/document-1/extract') return extraction({ conflict: {
        type: 'ALREADY_EXISTS', companyId: 'company-1', companyName: 'Example Pte. Ltd.', uen: '202400001A',
      } });
      if (url === '/api/documents/document-1' && init?.method === 'DELETE') return jsonResponse({ success: true });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    renderDialog();
    await chooseFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Review update to existing company' }));
    fireEvent.click(await waitForReview());

    await waitFor(() => expect(mocks.assistantTurn).toHaveBeenCalledOnce());
    const request = mocks.assistantTurn.mock.calls[0][0];
    expect(request.resources).toContainEqual({ resourceType: 'company', resourceId: 'company-1', role: 'target' });
    expect(request.capabilityInput).toEqual(expect.objectContaining({ mode: 'UPDATE', targetCompanyId: 'company-1' }));
  });

  it('builds identical capability input and ResourceRefs from identical reviewed state', () => {
    const args = {
      conversationId: 'conversation-1',
      message: '',
      documentId: 'document-1',
      reviewedData: fixture,
      targetCompanyId: 'company-1',
    };
    const first = buildBizFileAssistantTurnRequest(args);
    const second = buildBizFileAssistantTurnRequest(args);

    expect(second).toEqual(first);
    expect(first.capabilityInput).toEqual({
      documentId: 'document-1',
      mode: 'UPDATE',
      targetCompanyId: 'company-1',
      extractedData: fixture,
    });
  });

  it('does not mutate a company merely by uploading and extracting', async () => {
    renderDialog();
    await chooseFile();
    await waitForReview();

    expect(mocks.assistantTurn).not.toHaveBeenCalled();
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(['/api/documents/document-1/extract']);
    expect(urls.some((url) => url.includes('/confirm') || url.includes('/apply-update') || url.startsWith('/api/companies'))).toBe(false);
  });

  it('ends review at Business Assistant proposal creation and never calls legacy final-save routes', async () => {
    renderDialog();
    await chooseFile();
    await waitForReview();
    fireEvent.click(screen.getByRole('button', { name: 'Review proposed changes' }));

    await waitFor(() => expect(mocks.assistantTurn).toHaveBeenCalledOnce());
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes('/confirm') || url.includes('/apply-update'))).toBe(false);
    expect(mocks.assistantTurn.mock.calls[0][0].capabilityInput).toEqual(expect.objectContaining({ mode: 'CREATE' }));
  });

  it('surfaces capability acceptance failure and retains the source for safe retry', async () => {
    mocks.assistantTurn.mockRejectedValueOnce(new Error('Capability input was rejected'));
    renderDialog();
    await chooseFile();
    await waitForReview();
    fireEvent.click(screen.getByRole('button', { name: 'Review proposed changes' }));

    expect(await screen.findByText('Could not create proposal')).toBeVisible();
    expect(screen.getByText(/uploaded source has been kept/i)).toBeVisible();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/documents/document-1' && (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  });

  it('reuses clientRequestId on an identical retry after acceptance uncertainty', async () => {
    mocks.assistantTurn
      .mockRejectedValueOnce(new Error('Network interrupted'))
      .mockResolvedValueOnce(acceptedTurn);
    renderDialog();
    await chooseFile();
    await waitForReview();
    fireEvent.click(screen.getByRole('button', { name: 'Review proposed changes' }));
    await screen.findByText('Could not create proposal');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review proposed changes' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Review proposed changes' }));

    await waitFor(() => expect(mocks.assistantTurn).toHaveBeenCalledTimes(2));
    expect(mocks.assistantTurn.mock.calls[1][0].clientRequestId)
      .toBe(mocks.assistantTurn.mock.calls[0][0].clientRequestId);
  });
});
