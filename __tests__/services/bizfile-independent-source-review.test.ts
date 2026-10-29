import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BizFileBaselineSnapshot, BizFileChange } from '@/services/bizfile/change-plan';
import { assessBizFileIndependentSourceReview, bizFileIndependentReviewReportSchema, type BizFileIndependentExtractionResult, type BizFileIndependentSourceCoverage } from '@/services/bizfile/application/independent-source-review';
import type { ExtractedBizFileData } from '@/services/bizfile/types';

const sourceBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
const baseData: ExtractedBizFileData = {
  entityDetails: { uen: '202600001A', name: 'Example Pte Ltd', entityType: 'PRIVATE_LIMITED', status: 'LIVE' },
};
const extraction = (data: ExtractedBizFileData, sourceCoverage?: BizFileIndependentSourceCoverage): BizFileIndependentExtractionResult => ({
  data,
  providerUsed: 'test',
  modelUsed: 'test-model',
  ...(sourceCoverage ? { sourceCoverage } : {}),
});
const coverage = (sections: BizFileIndependentSourceCoverage['sections'] = [{ section: 'entity', status: 'REVIEWED', pageRefs: [1] }]): BizFileIndependentSourceCoverage => ({
  schemaVersion: '1',
  sourceHash,
  observedSourceHash: sourceHash,
  hashVerified: true,
  pageCount: 1,
  sections,
  assessedSections: [...new Set(sections.map((section) => section.section))],
  reviewedSections: [...new Set(sections.filter((section) => section.status === 'REVIEWED').map((section) => section.section))],
  missingSections: [],
  unreadableSections: [],
  unsupportedSections: [],
  missingPages: [],
  validationErrors: [],
  complete: true,
});
const change: BizFileChange = {
  id: 'change-name', path: 'entityDetails.name', section: 'identity', operation: 'SET', before: 'Old Name', after: 'Example Pte Ltd',
};
const persisted: BizFileBaselineSnapshot = { company: { id: 'company-1', name: 'Example Pte Ltd' } };
const capitalData: ExtractedBizFileData = {
  ...baseData,
  paidUpCapital: { amount: 10, currency: 'SGD' },
};
const capitalChange: BizFileChange = {
  id: 'change-paid-up-capital',
  path: 'paidUpCapital',
  section: 'capital',
  operation: 'SET',
  before: null,
  after: { amount: 10, currency: 'SGD' },
};
const addressData: ExtractedBizFileData = {
  ...baseData,
  registeredAddress: { block: '1', streetName: 'Example Street', postalCode: '123456' },
};
const addressChange: BizFileChange = {
  id: 'change-registered-address',
  path: 'addresses.registered',
  section: 'addresses',
  operation: 'SET',
  before: null,
  after: { block: '1', streetName: 'Example Street', postalCode: '123456' },
};

describe('independent BizFile source review', () => {
  it('verifies original bytes and compares selected persisted fields using an injected extractor', async () => {
    const extractor = vi.fn().mockResolvedValue(extraction(baseData));
    const report = await assessBizFileIndependentSourceReview({
      sourceBytes,
      expectedSourceHash: sourceHash,
      mimeType: 'image/png',
      selectedChanges: [change],
      persisted,
      commitStatus: 'COMMITTED',
      requiredSections: ['entity'],
      extractor: async (...args) => ({ ...await extractor(...args), sourceCoverage: coverage() }),
      now: new Date('2026-09-08T00:00:00.000Z'),
    });

    expect(report).toMatchObject({
      verdict: 'NEEDS_REVIEW',
      executionConformance: 'PASS',
      sourceAlignment: 'NO_UNEXPLAINED_DIFFERENCE',
      source: { hashVerified: true, extractionStatus: 'COMPLETE' },
      coverage: { complete: true, comparedChangeCount: 1 },
      selectedChanges: [{ changeId: 'change-name', matches: true }],
    });
    expect(extractor).toHaveBeenCalledWith({ base64: sourceBytes.toString('base64'), mimeType: 'image/png' }, undefined);
    expect(bizFileIndependentReviewReportSchema.safeParse({ ...report, unexpected: true }).success).toBe(false);
  });

  it('fails closed on a source hash mismatch without invoking extraction', async () => {
    const extractor = vi.fn();
    const report = await assessBizFileIndependentSourceReview({
      sourceBytes,
      expectedSourceHash: 'f'.repeat(64),
      mimeType: 'image/png',
      selectedChanges: [change],
      persisted,
      commitStatus: 'COMMITTED',
      requiredSections: ['entity'],
      extractor,
    });

    expect(report).toMatchObject({ verdict: 'REVIEW_FAILED', sourceAlignment: 'INCOMPLETE', source: { hashVerified: false, extractionStatus: 'FAILED' } });
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SOURCE_HASH_MISMATCH' })]));
    expect(extractor).not.toHaveBeenCalled();
  });

  it('keeps metadata-only or missing independent extraction in NEEDS_REVIEW', async () => {
    const report = await assessBizFileIndependentSourceReview({
      sourceBytes,
      expectedSourceHash: sourceHash,
      mimeType: 'image/png',
      selectedChanges: [change],
      persisted,
      commitStatus: 'COMMITTED',
      requiredSections: ['entity', 'addresses'],
      extractor: async () => extraction(baseData, coverage([{ section: 'entity', status: 'REVIEWED', pageRefs: [1] }])),
    });

    expect(report.verdict).toBe('NEEDS_REVIEW');
    expect(report.coverage).toMatchObject({ complete: false, missingSections: ['addresses'] });
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SOURCE_SECTION_MISSING' })]));
  });

  it('does not accept an empty extractor coverage attestation', async () => {
    const report = await assessBizFileIndependentSourceReview({
      sourceBytes,
      expectedSourceHash: sourceHash,
      mimeType: 'image/png',
      selectedChanges: [change],
      persisted,
      commitStatus: 'COMMITTED',
      requiredSections: ['entity'],
      extractor: async () => extraction(baseData, coverage([])),
    });

    expect(report).toMatchObject({
      verdict: 'NEEDS_REVIEW',
      executionConformance: 'UNVERIFIABLE',
      coverage: { sourceCoverageAvailable: true, sourceCoverageComplete: false, missingSections: ['entity'] },
    });
  });

  it('reports selected persisted mismatch as a factual review finding', async () => {
    const report = await assessBizFileIndependentSourceReview({
      sourceBytes,
      expectedSourceHash: sourceHash,
      mimeType: 'image/png',
      selectedChanges: [change],
      persisted: { company: { id: 'company-1', name: 'Unexpected Name Pte Ltd' } },
      commitStatus: 'COMMITTED',
      requiredSections: ['entity'],
      extractor: async () => extraction(baseData, coverage()),
    });

    expect(report).toMatchObject({ verdict: 'NEEDS_REVIEW', executionConformance: 'FAIL', sourceAlignment: 'DIFFERENCES_PRESENT' });
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SELECTED_FIELD_MISMATCH', path: 'entityDetails.name', changeId: 'change-name' })]));
  });

  it('fails closed when a selected persisted field is absent', async () => {
    const report = await assessBizFileIndependentSourceReview({
      sourceBytes,
      expectedSourceHash: sourceHash,
      mimeType: 'image/png',
      selectedChanges: [change],
      persisted: { company: { id: 'company-1' } },
      commitStatus: 'COMMITTED',
      requiredSections: ['entity'],
      extractor: async () => extraction(baseData),
    });

    expect(report).toMatchObject({
      verdict: 'NEEDS_REVIEW',
      executionConformance: 'FAIL',
      coverage: { missingPersistedFieldCount: 1, complete: false },
      selectedChanges: [{ approvedMatches: false, matches: false }],
    });
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PERSISTED_FIELD_MISSING' })]));
  });

  it('keeps source alignment separate from approved execution conformance', async () => {
    const approvedChange: BizFileChange = { ...change, after: 'Approved Name Pte Ltd' };
    const report = await assessBizFileIndependentSourceReview({
      sourceBytes,
      expectedSourceHash: sourceHash,
      mimeType: 'image/png',
      selectedChanges: [approvedChange],
      persisted: { company: { id: 'company-1', name: 'Approved Name Pte Ltd' } },
      commitStatus: 'COMMITTED',
      requiredSections: ['entity'],
      extractor: async () => extraction(baseData, coverage()),
    });

    expect(report).toMatchObject({
      verdict: 'NEEDS_REVIEW',
      executionConformance: 'PASS',
      sourceAlignment: 'DIFFERENCES_PRESENT',
      selectedChanges: [{ approvedMatches: true, matches: false }],
    });
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SELECTED_FIELD_MISMATCH' })]));
    expect(report.findings).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'APPROVED_FIELD_MISMATCH' })]));
  });

  it('uses canonical projections for Decimal-like capital values', async () => {
    const report = await assessBizFileIndependentSourceReview({
      sourceBytes,
      expectedSourceHash: sourceHash,
      mimeType: 'image/png',
      selectedChanges: [capitalChange],
      persisted: {
        company: {
          id: 'company-1',
          paidUpCapitalAmount: { toJSON: () => '10.00' },
          paidUpCapitalCurrency: 'SGD',
        },
      },
      commitStatus: 'COMMITTED',
      requiredSections: ['entity', 'capital'],
      extractor: async () => extraction(capitalData, coverage([
        { section: 'entity', status: 'REVIEWED', pageRefs: [1] },
        { section: 'capital', status: 'REVIEWED', pageRefs: [1] },
      ])),
    });

    expect(report).toMatchObject({
      verdict: 'NEEDS_REVIEW',
      executionConformance: 'PASS',
      coverage: { complete: true },
      selectedChanges: [{ approvedMatches: true, matches: true }],
    });
  });

  it('uses the same canonical address projection for source and persisted values', async () => {
    const report = await assessBizFileIndependentSourceReview({
      sourceBytes,
      expectedSourceHash: sourceHash,
      mimeType: 'image/png',
      selectedChanges: [addressChange],
      persisted: {
        company: { id: 'company-1' },
        addresses: [{ addressType: 'REGISTERED_OFFICE', block: '1', streetName: 'Example Street', postalCode: '123456' }],
      },
      commitStatus: 'COMMITTED',
      requiredSections: ['entity', 'addresses'],
      extractor: async () => extraction(addressData, coverage([
        { section: 'entity', status: 'REVIEWED', pageRefs: [1] },
        { section: 'addresses', status: 'REVIEWED', pageRefs: [1] },
      ])),
    });

    expect(report).toMatchObject({
      verdict: 'NEEDS_REVIEW',
      executionConformance: 'PASS',
      selectedChanges: [{ approvedMatches: true, matches: true }],
    });
  });

  it('does not treat an empty selected set as complete review coverage', async () => {
    const report = await assessBizFileIndependentSourceReview({
      sourceBytes,
      expectedSourceHash: sourceHash,
      mimeType: 'image/png',
      selectedChanges: [],
      persisted,
      commitStatus: 'COMMITTED',
      requiredSections: ['entity'],
      extractor: async () => extraction(baseData),
    });

    expect(report).toMatchObject({ verdict: 'NEEDS_REVIEW', executionConformance: 'UNVERIFIABLE', coverage: { complete: false, selectedChangeCount: 0 } });
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'NO_SELECTED_CHANGES', severity: 'ERROR' })]));
  });

  it('keeps an unavailable prepared hash incomplete and does not call a provider', async () => {
    const extractor = vi.fn();
    const report = await assessBizFileIndependentSourceReview({
      sourceBytes,
      mimeType: 'image/png',
      selectedChanges: [change],
      persisted,
      commitStatus: 'COMMITTED',
      extractor,
    });

    expect(report).toMatchObject({ verdict: 'NEEDS_REVIEW', sourceAlignment: 'INCOMPLETE', source: { extractionStatus: 'MISSING', hashVerified: false } });
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SOURCE_HASH_UNAVAILABLE' })]));
    expect(extractor).not.toHaveBeenCalled();
  });
});
