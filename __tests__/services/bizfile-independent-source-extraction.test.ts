import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_INDEPENDENT_REVIEW_BYTES,
  extractBizFileForIndependentReview,
  validateBizFileIndependentSourceCoverage,
  type BizFileIndependentSectionStatus,
} from '@/services/bizfile/application/source-review-extraction';
import type { BizFileReviewSectionId } from '@/lib/validations/bizfile-review';
import type { ExtractedBizFileData } from '@/services/bizfile/types';

const factualData: ExtractedBizFileData = {
  entityDetails: {
    uen: '202600001A',
    name: 'Example Pte Ltd',
    entityType: 'PRIVATE_LIMITED',
    status: 'LIVE',
  },
};

function hash(sourceBytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(sourceBytes)).digest('hex');
}

async function pdfBytes(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) document.addPage([612, 792]);
  return document.save();
}

function section(sectionId: BizFileReviewSectionId, status: BizFileIndependentSectionStatus, pageRefs: number[]) {
  return { section: sectionId, status, pageRefs };
}

function attestation(sourceHash: string, sections: ReturnType<typeof section>[]) {
  return { schemaVersion: '1' as const, sourceHash, sections };
}

describe('independent BizFile source coverage contract', () => {
  it('rejects an invented page reference against the parsed page count', async () => {
    const sourceBytes = await pdfBytes(1);
    const result = await validateBizFileIndependentSourceCoverage({
      sourceBytes,
      expectedSourceHash: hash(sourceBytes),
      mimeType: 'application/pdf',
      requiredSections: ['entity'],
      reportedCoverage: attestation(hash(sourceBytes), [section('entity', 'REVIEWED', [2])]),
    });

    expect(result.coverage).toMatchObject({ pageCount: 1, missingPages: [1], complete: false });
    expect(result.coverage.validationErrors).toContain('SOURCE_PAGE_REFERENCE_INVALID:entity:2');
  });

  it('keeps partial coverage incomplete when a parsed page is unreferenced', async () => {
    const sourceBytes = await pdfBytes(2);
    const result = await validateBizFileIndependentSourceCoverage({
      sourceBytes,
      expectedSourceHash: hash(sourceBytes),
      mimeType: 'application/pdf',
      requiredSections: ['entity'],
      reportedCoverage: attestation(hash(sourceBytes), [section('entity', 'REVIEWED', [1])]),
    });

    expect(result.coverage).toMatchObject({ pageCount: 2, missingPages: [2], complete: false });
  });

  it('keeps truncated source bytes incomplete without accepting model page claims', async () => {
    const sourceBytes = Buffer.from('%PDF-1.7 truncated');
    const result = await validateBizFileIndependentSourceCoverage({
      sourceBytes,
      expectedSourceHash: hash(sourceBytes),
      mimeType: 'application/pdf',
      requiredSections: ['entity'],
      reportedCoverage: attestation(hash(sourceBytes), [section('entity', 'REVIEWED', [1])]),
    });

    expect(result.coverage).toMatchObject({ pageCount: null, complete: false });
    expect(result.coverage.validationErrors).toContain('SOURCE_PAGE_COUNT_UNAVAILABLE');
  });

  it('keeps an explicitly empty required-section set incomplete', async () => {
    const sourceBytes = await pdfBytes(1);
    const result = await validateBizFileIndependentSourceCoverage({
      sourceBytes,
      expectedSourceHash: hash(sourceBytes),
      mimeType: 'application/pdf',
      requiredSections: [],
      reportedCoverage: attestation(hash(sourceBytes), []),
    });

    expect(result.coverage).toMatchObject({ missingSections: [], missingPages: [1], complete: false });
  });

  it('fails source coverage when the expected source hash is wrong', async () => {
    const sourceBytes = await pdfBytes(1);
    const result = await validateBizFileIndependentSourceCoverage({
      sourceBytes,
      expectedSourceHash: 'f'.repeat(64),
      mimeType: 'application/pdf',
      requiredSections: ['entity'],
      reportedCoverage: attestation(hash(sourceBytes), [section('entity', 'REVIEWED', [1])]),
    });

    expect(result.coverage).toMatchObject({ hashVerified: false, complete: false });
    expect(result.coverage.validationErrors).toContain('SOURCE_HASH_MISMATCH');
  });

  it('keeps unreadable sections incomplete even with valid page references', async () => {
    const sourceBytes = await pdfBytes(1);
    const result = await validateBizFileIndependentSourceCoverage({
      sourceBytes,
      expectedSourceHash: hash(sourceBytes),
      mimeType: 'application/pdf',
      requiredSections: ['entity'],
      reportedCoverage: attestation(hash(sourceBytes), [section('entity', 'UNREADABLE', [1])]),
    });

    expect(result.coverage).toMatchObject({ unreadableSections: ['entity'], complete: false });
  });

  it('derives complete coverage only from valid full page and section evidence', async () => {
    const sourceBytes = await pdfBytes(2);
    const sourceHash = hash(sourceBytes);
    const result = await validateBizFileIndependentSourceCoverage({
      sourceBytes,
      expectedSourceHash: sourceHash,
      mimeType: 'application/pdf',
      requiredSections: ['entity', 'addresses'],
      reportedCoverage: attestation(sourceHash, [
        section('entity', 'REVIEWED', [1, 2]),
        section('addresses', 'REVIEWED', [1, 2]),
      ]),
    });

    expect(result.contractValid).toBe(true);
    expect(result.coverage).toMatchObject({ pageCount: 2, missingPages: [], complete: true });
  });

  it('rejects malformed images before factual or coverage provider dispatch', async () => {
    const sourceBytes = Buffer.from('not-an-image');
    const factualExtractor = vi.fn();
    const coverageCaller = vi.fn();

    await expect(extractBizFileForIndependentReview({
      sourceBytes,
      expectedSourceHash: hash(sourceBytes),
      mimeType: 'image/png',
      requiredSections: ['entity'],
      factualExtractor,
      coverageCaller,
    })).rejects.toThrow('SOURCE_PAGE_COUNT_UNAVAILABLE');
    expect(factualExtractor).not.toHaveBeenCalled();
    expect(coverageCaller).not.toHaveBeenCalled();
  });

  it('rejects multipage images before provider dispatch', async () => {
    const sourceBytes = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), {
      raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
    }).tiff().toBuffer();
    const factualExtractor = vi.fn();
    const coverageCaller = vi.fn();

    await expect(extractBizFileForIndependentReview({
      sourceBytes,
      expectedSourceHash: hash(sourceBytes),
      mimeType: 'image/tiff',
      requiredSections: ['entity'],
      factualExtractor,
      coverageCaller,
    })).rejects.toThrow('SOURCE_MULTIPAGE_IMAGE_UNSUPPORTED');
    expect(factualExtractor).not.toHaveBeenCalled();
    expect(coverageCaller).not.toHaveBeenCalled();
  });

  it('rejects oversized source bytes before provider dispatch', async () => {
    const sourceBytes = new Uint8Array(MAX_INDEPENDENT_REVIEW_BYTES + 1);
    const factualExtractor = vi.fn();
    const coverageCaller = vi.fn();

    await expect(extractBizFileForIndependentReview({
      sourceBytes,
      expectedSourceHash: hash(sourceBytes),
      mimeType: 'image/png',
      requiredSections: ['entity'],
      factualExtractor,
      coverageCaller,
    })).rejects.toThrow('SOURCE_SIZE_LIMIT_EXCEEDED');
    expect(factualExtractor).not.toHaveBeenCalled();
    expect(coverageCaller).not.toHaveBeenCalled();
  });

  it('uses connector-aware coverage dispatch with factual data kept separate', async () => {
    const sourceBytes = await pdfBytes(1);
    const sourceHash = hash(sourceBytes);
    const factualExtractor = vi.fn().mockResolvedValue({ data: factualData, modelUsed: 'test-model', providerUsed: 'test' });
    const coverageCaller = vi.fn().mockResolvedValue({
      content: JSON.stringify(attestation(sourceHash, [section('entity', 'REVIEWED', [1])])),
      model: 'test-model',
      provider: 'test',
    });

    const result = await extractBizFileForIndependentReview({
      sourceBytes,
      expectedSourceHash: sourceHash,
      mimeType: 'application/pdf',
      requiredSections: ['entity'],
      extractionOptions: { tenantId: 'tenant', userId: 'user', companyId: 'company', documentId: 'document' },
      factualExtractor,
      coverageCaller,
    });

    expect(result.sourceCoverage.complete).toBe(true);
    expect(coverageCaller).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant',
      operation: 'bizfile_independent_source_coverage',
      images: [{ base64: Buffer.from(sourceBytes).toString('base64'), mimeType: 'application/pdf' }],
      userPrompt: expect.stringContaining(sourceHash),
    }));
    expect(coverageCaller.mock.calls[0][0].userPrompt).not.toContain('Example Pte Ltd');
  });

  it.each([1, 2])('stops provider dispatch when fresh access is denied before call %i', async (deniedCall) => {
    const sourceBytes = await pdfBytes(1);
    let checks = 0;
    const beforeProviderDispatch = vi.fn(async () => {
      if (++checks === deniedCall) throw new Error('PROVIDER_ACCESS_REVOKED');
    });
    const factualExtractor = vi.fn().mockResolvedValue({ data: factualData, modelUsed: 'test-model', providerUsed: 'test' });
    const coverageCaller = vi.fn();
    await expect(extractBizFileForIndependentReview({
      sourceBytes, expectedSourceHash: hash(sourceBytes), mimeType: 'application/pdf',
      beforeProviderDispatch, factualExtractor, coverageCaller,
    })).rejects.toThrow('PROVIDER_ACCESS_REVOKED');
    expect(factualExtractor).toHaveBeenCalledTimes(deniedCall - 1);
    expect(beforeProviderDispatch).toHaveBeenCalledTimes(deniedCall);
    expect(coverageCaller).not.toHaveBeenCalled();
  });
});
