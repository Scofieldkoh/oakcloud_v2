import { describe, expect, it } from 'vitest';
import type { FormField } from '@/generated/prisma';
import { buildSubmissionPdfHtml } from '@/services/form-pdf.service';

function urlField(infoBareStyle: boolean): FormField {
  return {
    id: 'field-1', formId: 'form-1', tenantId: 'tenant-1', optionPresetId: null,
    type: 'PARAGRAPH', label: 'Resource', key: 'resource_link',
    placeholder: 'https://example.com/resource', subtext: 'Open resource', helpText: null,
    inputType: 'info_url', options: null,
    validation: { infoShowInPdf: true, infoBareStyle }, condition: null,
    isRequired: false, hideLabel: false, isReadOnly: false, layoutWidth: 100, position: 0,
    createdAt: new Date('2026-08-01T00:00:00Z'), updatedAt: new Date('2026-08-01T00:00:00Z'),
  };
}

function renderUrlField(infoBareStyle: boolean) {
  const html = buildSubmissionPdfHtml({
    formTitle: 'Resources', submittedAt: new Date('2026-08-01T00:00:00Z'),
    respondentName: null, respondentEmail: null, status: 'COMPLETED',
    fields: [urlField(infoBareStyle)], answers: {}, uploads: [],
  }).contentHtml;
  return html.slice(html.indexOf('<div class="fields-grid">'));
}

describe('form PDF URL style', () => {
  it('omits the info box only for plain URL blocks', () => {
    const plain = renderUrlField(true);
    expect(plain).toContain('class="info-link"');
    expect(plain).not.toContain('class="info-box"');

    const boxed = renderUrlField(false);
    expect(boxed).toContain('class="info-link"');
    expect(boxed).toContain('class="info-box"');
  });
});
