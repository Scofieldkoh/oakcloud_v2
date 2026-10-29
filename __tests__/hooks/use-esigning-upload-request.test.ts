import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadEsigningDocumentRequest } from '@/hooks/use-esigning';

describe('uploadEsigningDocumentRequest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects with the server upload error instead of continuing after a failed upload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'Word conversion failed' }),
      })
    );

    await expect(
      uploadEsigningDocumentRequest(
        '00000000-0000-4000-8000-000000000001',
        new File(['not a pdf'], 'letter.docx'),
        'workspace-1'
      )
    ).rejects.toThrow('Word conversion failed');
  });
});
