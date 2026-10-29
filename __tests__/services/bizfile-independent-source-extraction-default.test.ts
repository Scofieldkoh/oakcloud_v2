import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  factual: vi.fn(),
  coverage: vi.fn(),
}));

vi.mock('@/services/bizfile/extractor', () => ({ extractBizFileWithVision: mocks.factual }));
vi.mock('@/lib/ai', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai')>('@/lib/ai');
  return { ...actual, callAIWithConnector: mocks.coverage };
});

import { extractBizFileForIndependentReview } from '@/services/bizfile/application/source-review-extraction';
import { assessBizFileIndependentSourceReview } from '@/services/bizfile/application/independent-source-review';

async function pdfBytes(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  return document.save();
}

describe('default independent BizFile source extraction plumbing', () => {
  it('uses the connector-aware coverage call and returns server-validated evidence', async () => {
    const sourceBytes = await pdfBytes();
    const sourceHash = createHash('sha256').update(Buffer.from(sourceBytes)).digest('hex');
    mocks.factual.mockResolvedValue({
      data: {
        entityDetails: { uen: '202600001A', name: 'Example Pte Ltd', entityType: 'PRIVATE_LIMITED', status: 'LIVE' },
      },
      providerUsed: 'test',
      modelUsed: 'test-model',
    });
    mocks.coverage.mockResolvedValue({
      content: JSON.stringify({
        schemaVersion: '1',
        sourceHash,
        sections: [{ section: 'entity', status: 'REVIEWED', pageRefs: [1] }],
      }),
      model: 'test-model',
      provider: 'openai',
    });

    const result = await extractBizFileForIndependentReview({
      sourceBytes,
      expectedSourceHash: sourceHash,
      mimeType: 'application/pdf',
      requiredSections: ['entity'],
      extractionOptions: { tenantId: 'tenant', userId: 'user', companyId: 'company', documentId: 'document' },
    });

    expect(mocks.factual).toHaveBeenCalledWith(
      { base64: Buffer.from(sourceBytes).toString('base64'), mimeType: 'application/pdf' },
      { tenantId: 'tenant', userId: 'user', companyId: 'company', documentId: 'document' },
    );
    expect(mocks.coverage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant',
      operation: 'bizfile_independent_source_coverage',
      userPrompt: expect.stringContaining(sourceHash),
    }));
    expect(result.sourceCoverage).toMatchObject({ hashVerified: true, pageCount: 1, complete: true });
    expect(result.sourceCoverageAttestation).toMatchObject({ schemaVersion: '1', sourceHash });

    // Exercise the actual default reviewer path: passing the derived coverage
    // object directly into the strict attestation parser used to reject it.
    const report = await assessBizFileIndependentSourceReview({
      sourceBytes, expectedSourceHash: sourceHash, mimeType: 'application/pdf',
      requiredSections: ['entity'], commitStatus: 'COMMITTED',
      persisted: { company: { id: 'company', name: 'Example Pte Ltd' } },
      selectedChanges: [{ id: 'name', path: 'entityDetails.name', section: 'identity', operation: 'SET', before: 'Old name', after: 'Example Pte Ltd' }],
      extractionOptions: { tenantId: 'tenant', userId: 'user', companyId: 'company', documentId: 'document' },
    });
    expect(report.coverage).toMatchObject({ sourceCoverageAvailable: true, sourceCoverageComplete: true, comparisonScope: 'SELECTED_CHANGES_ONLY' });
    expect(report.findings.some((finding) => finding.code === 'SOURCE_COVERAGE_INVALID')).toBe(false);
    expect(report.verdict).toBe('NEEDS_REVIEW');
  });
});
