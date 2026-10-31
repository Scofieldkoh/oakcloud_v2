import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EsigningVerifyPage } from '@/components/esigning/esigning-verify-page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ certificateId: 'OAK-ES-20261030-ABCDEF' }),
}));

vi.mock('next/link', () => {
  const LinkMock = ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement('a', { href, ...props }, children);
  LinkMock.displayName = 'LinkMock';
  return { __esModule: true, default: LinkMock, Link: LinkMock };
});

const HASH = 'a'.repeat(64);

function verification(overrides: Record<string, unknown> = {}) {
  return {
    certificateId: 'OAK-ES-20261030-ABCDEF',
    envelopeId: 'env-1',
    title: 'Services Agreement',
    status: 'COMPLETED',
    completedAt: '2026-10-30T03:05:00.000Z',
    tenantName: 'Oaktree',
    companyName: null,
    documents: [{ id: 'doc-1', fileName: 'agreement.pdf', hash: HASH, hasSignedCopy: true }],
    emailedCopiesVerifiable: true,
    recipients: [],
    events: [],
    ...overrides,
  };
}

function mockFetch(options: { verification: unknown; check?: unknown }) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/check')) {
      return { ok: true, json: async () => options.check } as Response;
    }
    return { ok: true, json: async () => options.verification } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function uploadPdf() {
  const user = userEvent.setup();
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(['%PDF-upload'], 'upload.pdf', { type: 'application/pdf' }));
}

describe('EsigningVerifyPage', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('labels the hash as BLAKE3, explains the check without claiming tamper-evidence', async () => {
    mockFetch({ verification: verification() });
    const { container } = render(createElement(EsigningVerifyPage));

    await screen.findByText('agreement.pdf');

    expect(screen.getByText('BLAKE3')).toBeTruthy();
    expect(container.textContent).not.toContain('SHA-256');
    expect(container.textContent?.toLowerCase()).not.toContain('tamper');
    expect(container.textContent).toContain('signed document with its certificate as emailed or filed');
    expect(container.textContent).not.toContain('completed before issued copies were fingerprinted');
  });

  it('says that copies emailed before issued copies were fingerprinted cannot be verified', async () => {
    mockFetch({ verification: verification({ emailedCopiesVerifiable: false }) });
    const { container } = render(createElement(EsigningVerifyPage));

    await screen.findByText('agreement.pdf');

    expect(container.textContent).toContain('completed before issued copies were fingerprinted');
    expect(container.textContent).toContain('cannot be verified here');
  });

  it('reports a match with the kind of file and that it is the current issue', async () => {
    const fetchMock = mockFetch({
      verification: verification(),
      check: {
        matched: true,
        fileHash: HASH,
        document: verification().documents[0],
        artifact: { kind: 'DOCUMENT_WITH_CERTIFICATE', version: 2, issuedAt: '2026-10-30T03:05:00.000Z', isCurrent: true, source: 'ISSUED_ARTIFACT' },
      },
    });
    const { container } = render(createElement(EsigningVerifyPage));
    await screen.findByText('agreement.pdf');

    await uploadPdf();

    await waitFor(() => expect(container.textContent).toContain('Hash matched'));
    expect(container.textContent).toContain('signed document with its certificate of agreement.pdf');
    expect(container.textContent).not.toContain('earlier issue');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/check'), expect.objectContaining({ method: 'POST' }));
  });

  it('says when a match is an earlier issue rather than the version offered now', async () => {
    mockFetch({
      verification: verification(),
      check: {
        matched: true,
        fileHash: HASH,
        document: verification().documents[0],
        artifact: { kind: 'SIGNED_DOCUMENT', version: 1, issuedAt: '2026-10-01T00:00:00.000Z', isCurrent: false, source: 'ISSUED_ARTIFACT' },
      },
    });
    const { container } = render(createElement(EsigningVerifyPage));
    await screen.findByText('agreement.pdf');

    await uploadPdf();

    await waitFor(() => expect(container.textContent).toContain('Hash matched'));
    expect(container.textContent).toContain('earlier issue (version 1)');
  });

  it('labels a file matched through the SharePoint filing record', async () => {
    mockFetch({
      verification: verification(),
      check: {
        matched: true,
        fileHash: HASH,
        document: verification().documents[0],
        artifact: { kind: 'DOCUMENT_WITH_CERTIFICATE', version: null, issuedAt: '2026-10-01T00:00:00.000Z', isCurrent: false, source: 'SHAREPOINT_FILING_RECORD' },
      },
    });
    const { container } = render(createElement(EsigningVerifyPage));
    await screen.findByText('agreement.pdf');

    await uploadPdf();

    await waitFor(() => expect(container.textContent).toContain('as filed to SharePoint'));
    expect(container.textContent).toContain('before issued copies were fingerprinted');
  });

  it('reports a mismatch for a file that was not issued', async () => {
    mockFetch({
      verification: verification(),
      check: { matched: false, fileHash: HASH, document: null, artifact: null },
    });
    const { container } = render(createElement(EsigningVerifyPage));
    await screen.findByText('agreement.pdf');

    await uploadPdf();

    await waitFor(() => expect(container.textContent).toContain('Hash mismatch'));
    expect(container.textContent).toContain('does not match any file recorded as issued');
  });
});
