// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

const { diagnoseOakDocGeneration } = await import('@/services/oakdoc-generation.service');
const { oakDocBatchContext } = await import('@/services/document-generation-batch/preview.service');

describe('OakDoc generation context (L2)', () => {
  it('blocks fields whose party or agreement context was not supplied', () => {
    const diagnostics = diagnoseOakDocGeneration({
      usedTags: ['company.name', 'selectedDirector.name', 'selectedContact.email', 'agreement.termMonths'],
      provided: new Set(['company', 'system', 'agreement']),
    });

    expect(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.controlTag])).toEqual([
      ['OAKDOC_CONTEXT_MISSING', 'selectedDirector.name'],
      ['OAKDOC_CONTEXT_MISSING', 'selectedContact.email'],
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  });

  it('treats supplied context as resolvable even when its values are empty', () => {
    expect(diagnoseOakDocGeneration({
      usedTags: ['selectedContact.phone', 'director.name', 'repeat.directors'],
      provided: new Set(['company', 'system', 'selectedContact']),
    })).toEqual([]);
  });

  it('reports unsupported controls with their tag', () => {
    expect(diagnoseOakDocGeneration({
      usedTags: ['mystery.fee'],
      provided: new Set(['company', 'system']),
    })).toEqual([expect.objectContaining({
      code: 'OAKDOC_UNSUPPORTED_FIELD',
      controlTag: 'mystery.fee',
    })]);
  });

  it('accepts custom fields and warns, without blocking, about ones the template does not define', () => {
    expect(diagnoseOakDocGeneration({
      usedTags: ['custom.fee'],
      provided: new Set(['company', 'system']),
    })).toEqual([]);
    expect(diagnoseOakDocGeneration({
      usedTags: ['custom.fee', 'custom.meeting_date'],
      provided: new Set(['company', 'system']),
      customFieldKeys: new Set(['fee']),
    })).toEqual([expect.objectContaining({
      code: 'OAKDOC_CUSTOM_FIELD_UNDEFINED',
      severity: 'warning',
      controlTag: 'custom.meeting_date',
    })]);
  });

  it('passes the batch item contact, agreement and resolution date', () => {
    const configuration = {
      version: 1,
      title: 'Doc',
      contactIds: [],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: 'contact-1',
      itemValues: {},
      masterOverrides: {},
      useLetterhead: false,
      serviceAgreement: { agreementDate: '2026-09-01', effectiveDate: null, termMonths: 12 },
    } as never;

    expect(oakDocBatchContext(configuration, { resolution_date: '2026-09-02' })).toEqual({
      selectedContactId: 'contact-1',
      contactIds: [],
      customData: { resolution_date: '2026-09-02' },
      agreement: { agreementDate: '2026-09-01', effectiveDate: null, termMonths: 12 },
      resolutionDate: '2026-09-02',
    });
    expect(oakDocBatchContext({ ...(configuration as object), selectedContactId: null, serviceAgreement: null } as never, {}))
      .toEqual({
        selectedContactId: undefined,
        contactIds: [],
        customData: {},
        agreement: undefined,
        resolutionDate: undefined,
      });
  });

  it('passes the contacts ticked for each named contacts list', () => {
    const configuration = {
      version: 1,
      title: 'Doc',
      contactIds: ['contact-1'],
      selectedContactListIds: { 'corp-sec': ['contact-2'] },
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      itemValues: {},
      masterOverrides: {},
      useLetterhead: false,
      serviceAgreement: null,
    } as never;
    expect(oakDocBatchContext(configuration, {})).toMatchObject({
      contactIds: ['contact-1'],
      selectedContactListIds: { 'corp-sec': ['contact-2'] },
    });
  });
});
