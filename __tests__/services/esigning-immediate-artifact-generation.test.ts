import { beforeEach, describe, expect, it, vi } from 'vitest';

const pdfMocks = vi.hoisted(() => ({
  generateEsigningEnvelopeArtifactsNow: vi.fn(),
}));

vi.mock('@/services/esigning-pdf.service', () => pdfMocks);
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { processEsigningCompletionArtifacts } from '@/services/esigning-signing.service';

describe('on-demand e-signing artifact generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates signed artifacts immediately for the envelope completed by this request', async () => {
    pdfMocks.generateEsigningEnvelopeArtifactsNow.mockResolvedValue('generated');

    await expect(
      processEsigningCompletionArtifacts({
        envelopeCompleted: true,
        envelopeId: 'envelope-1',
      })
    ).resolves.toBeUndefined();

    expect(pdfMocks.generateEsigningEnvelopeArtifactsNow).toHaveBeenCalledWith({
      envelopeId: 'envelope-1',
    });
  });

  it('does not generate artifacts for a non-final signer', async () => {
    await processEsigningCompletionArtifacts({
      envelopeCompleted: false,
      envelopeId: 'envelope-1',
    });

    expect(pdfMocks.generateEsigningEnvelopeArtifactsNow).not.toHaveBeenCalled();
  });

  it('does not undo the signature when immediate generation records a failure', async () => {
    pdfMocks.generateEsigningEnvelopeArtifactsNow.mockRejectedValue(
      new Error('temporary storage failure')
    );

    await expect(
      processEsigningCompletionArtifacts({
        envelopeCompleted: true,
        envelopeId: 'envelope-1',
      })
    ).resolves.toBeUndefined();
  });
});
