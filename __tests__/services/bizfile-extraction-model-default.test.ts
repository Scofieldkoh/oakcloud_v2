import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), ai: vi.fn(), ocr: vi.fn() }));
vi.mock('@/lib/ai', async () => ({
  ...await vi.importActual<typeof import('@/lib/ai')>('@/lib/ai'),
  getBestAvailableModelForWorkspace: mocks.resolve,
  callAIWithConnector: mocks.ai,
}));
vi.mock('@/lib/ocr/mistral', async () => ({
  ...await vi.importActual<typeof import('@/lib/ocr/mistral')>('@/lib/ocr/mistral'),
  extractStructuredWithMistralOCR: mocks.ocr,
}));
import { extractBizFileWithVision } from '@/services/bizfile/extractor';

describe('BizFile extraction model precedence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.ai.mockRejectedValue(new Error('AI dispatch reached'));
    mocks.ocr.mockRejectedValue(new Error('OCR dispatch reached'));
  });

  it.each([undefined, 'explicit-model'])('uses the configured default unless overridden by %s', async (modelId) => {
    mocks.resolve.mockResolvedValue('configured-model');
    await expect(extractBizFileWithVision({ base64: 'cGRm', mimeType: 'application/pdf' }, { tenantId: 'tenant-1', modelId }))
      .rejects.toThrow('AI dispatch reached');
    expect(mocks.ai).toHaveBeenCalledWith(expect.objectContaining({ model: modelId ?? 'configured-model' }));
    expect(mocks.ocr).not.toHaveBeenCalled();
    if (modelId) expect(mocks.resolve).not.toHaveBeenCalled();
    else expect(mocks.resolve).toHaveBeenCalledWith('tenant-1', 'bizfileExtraction', { configuredOnly: true });
  });

  it('preserves automatic OCR when no extraction default is configured', async () => {
    mocks.resolve.mockResolvedValue(null);
    await expect(extractBizFileWithVision({ base64: 'cGRm', mimeType: 'application/pdf' }, { tenantId: 'tenant-1' }))
      .rejects.toThrow('OCR dispatch reached');
    expect(mocks.ocr).toHaveBeenCalled();
    expect(mocks.ai).not.toHaveBeenCalled();
  });
});
