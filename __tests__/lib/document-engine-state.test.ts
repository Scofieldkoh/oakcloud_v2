import { describe, expect, it } from 'vitest';
import {
  InvalidDocumentEngineError,
  getDocumentCapabilities,
  getDocumentTemplateDisplayEngine,
  getDocumentTemplateEngine,
  getDocumentTemplateEngineState,
  isUngeneratedDocumentDraft,
  readGeneratedDocumentEngine,
  readGeneratedDocumentEngineState,
} from '@/lib/document-editor/document-engine';

const validTemplate = {
  oakDoc: {
    schemaVersion: 1,
    storageKey: 'tenant/templates/oakdoc/assets/a.docx',
    fileName: 'a.docx',
    fileSize: 10,
    sha256: 'a'.repeat(64),
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fieldTags: [],
  },
};

describe('document engine discrimination (C01)', () => {
  it('distinguishes legacy, valid native and damaged native templates', () => {
    expect(getDocumentTemplateEngineState(null)).toBe('A4');
    expect(getDocumentTemplateEngineState({ layout: {} })).toBe('A4');
    expect(getDocumentTemplateEngineState(validTemplate)).toBe('OAKDOC');
    expect(getDocumentTemplateEngineState({ oakDoc: { ...validTemplate.oakDoc, sha256: 'bad' } })).toBe('INVALID');
    expect(getDocumentTemplateEngineState({ documentEngine: 'OAKDOC' })).toBe('INVALID');
  });

  it('never falls back to A4 for damaged native metadata', () => {
    const damaged = { oakDoc: { schemaVersion: 99 } };
    expect(() => getDocumentTemplateEngine(damaged)).toThrow(InvalidDocumentEngineError);
    expect(getDocumentTemplateDisplayEngine(damaged)).toBe('OAKDOC');
    expect(readGeneratedDocumentEngineState({ documentEngine: 'OAKDOC' })).toBe('INVALID');
    expect(() => readGeneratedDocumentEngine({ oakDocGenerated: {} })).toThrow(InvalidDocumentEngineError);
    expect(readGeneratedDocumentEngineState({ selectedParties: {} })).toBe('A4');
  });

  it('derives capabilities from engine, status, permission and converter readiness', () => {
    expect(getDocumentCapabilities({ engine: 'OAKDOC', status: 'DRAFT' })).toEqual({
      inlineEdit: true, htmlExport: false, pdfExport: false, docxDownload: true,
    });
    expect(getDocumentCapabilities({ engine: 'OAKDOC', status: 'FINALIZED', pdfConverterReady: true }))
      .toMatchObject({ inlineEdit: false, pdfExport: true });
    expect(getDocumentCapabilities({ engine: 'OAKDOC', status: 'DRAFT', canUpdate: false }).inlineEdit).toBe(false);
    expect(getDocumentCapabilities({ engine: 'INVALID' })).toEqual({
      inlineEdit: false, htmlExport: false, pdfExport: false, docxDownload: false,
    });
    expect(getDocumentCapabilities({ engine: 'A4', status: 'DRAFT' })).toEqual({
      inlineEdit: false, htmlExport: false, pdfExport: false, docxDownload: false,
    });
  });

  it('tells ungenerated drafts apart from old A4 records', () => {
    expect(isUngeneratedDocumentDraft({ batchItem: true })).toBe(true);
    expect(isUngeneratedDocumentDraft({ generationSession: { currentStep: 0 } })).toBe(true);
    expect(isUngeneratedDocumentDraft({ selectedParties: {} })).toBe(false);
    expect(isUngeneratedDocumentDraft(null)).toBe(false);
  });
});
