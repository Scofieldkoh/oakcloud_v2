/** Excel and CSV export of form responses. */

import ExcelJS from 'exceljs';
import { FormFieldType, Prisma, type FormUpload } from '@/generated/prisma';
import { parseObject, toAnswerRecord } from '@/lib/form-utils';
import { prisma } from '@/lib/prisma';
import { getAppBaseUrl } from '@/lib/email';
import {
  RESPONSE_ATTACHMENTS_COLUMN_ID,
  formatResponseCellValue,
  normalizeFormResponseTags,
  getFormResponseTags,
  hasAllTags,
  hasAnyTag,
  getSubmissionColumnFilterText,
} from './shared';
import { type FormResponsesExportInput, type FormResponsesExcelExportResult } from './types';

function sanitizeExportFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'form';
}

function uniqueExportColumnNames(labels: string[]): string[] {
  const seen = new Map<string, number>();

  return labels.map((label) => {
    const baseLabel = label.trim() || 'Field';
    const count = seen.get(baseLabel) || 0;
    seen.set(baseLabel, count + 1);
    return count === 0 ? baseLabel : `${baseLabel} (${count + 1})`;
  });
}

function normalizeExportIds(ids?: string[]): string[] {
  return [...new Set((ids || []).filter((id) => typeof id === 'string' && id.trim().length > 0))];
}

function normalizeExportTags(tags?: string[]): string[] {
  return normalizeFormResponseTags(tags || []);
}

function buildExportDateWhere(
  fromDate?: Date,
  toDate?: Date
): Prisma.DateTimeFilter | undefined {
  const range: Prisma.DateTimeFilter = {};

  if (fromDate && !Number.isNaN(fromDate.getTime())) {
    range.gte = fromDate;
  }

  if (toDate && !Number.isNaN(toDate.getTime())) {
    range.lte = toDate;
  }

  return Object.keys(range).length > 0 ? range : undefined;
}

function safeExportCellValue(fieldType: FormFieldType | string, value: unknown): string {
  if (value === null || value === undefined) return '';
  const formatted = formatResponseCellValue(fieldType, value);
  return formatted === '-' ? '' : formatted;
}

function buildAttachmentText(uploads: Array<Pick<FormUpload, 'fileName'>>): string {
  return uploads.map((upload) => upload.fileName).filter(Boolean).join('\n');
}

function buildAttachmentLinks(input: {
  formId: string;
  rowId: string;
  uploads: Array<Pick<FormUpload, 'id'>>;
  type: 'submission' | 'draft';
}): string {
  const baseUrl = getAppBaseUrl().replace(/\/$/, '');
  return input.uploads.map((upload) => {
    const path = input.type === 'submission'
      ? `/api/forms/${encodeURIComponent(input.formId)}/responses/${encodeURIComponent(input.rowId)}/uploads/${encodeURIComponent(upload.id)}`
      : `/api/forms/${encodeURIComponent(input.formId)}/drafts/${encodeURIComponent(input.rowId)}/uploads/${encodeURIComponent(upload.id)}`;
    return `${baseUrl}${path}`;
  }).join('\n');
}

function applyWorksheetStyle(worksheet: ExcelJS.Worksheet): void {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columnCount },
  };

  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF294D44' },
  };
  header.alignment = { vertical: 'middle', wrapText: true };

  worksheet.columns.forEach((column) => {
    let maxLength = 12;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const value = cell.value;
      const text = value instanceof Date
        ? 'yyyy-mm-dd hh:mm'
        : typeof value === 'object' && value && 'text' in value
          ? String((value as { text?: unknown }).text ?? '')
          : String(value ?? '');
      maxLength = Math.max(maxLength, ...text.split('\n').map((part) => part.length));
      cell.alignment = { vertical: 'top', wrapText: true };
    });
    column.width = Math.min(60, Math.max(maxLength + 2, Number(column.width) || 12));
  });
}

function populateWorksheet(
  worksheet: ExcelJS.Worksheet,
  columns: ExcelJS.TableColumnProperties[],
  rows: unknown[][]
): void {
  worksheet.columns = columns.map((column) => ({
    header: column.name,
    key: String(column.name),
  }));

  worksheet.addRows(rows);
}

export async function exportFormResponsesExcel(
  formId: string,
  tenantId: string,
  input: FormResponsesExportInput = {}
): Promise<FormResponsesExcelExportResult> {
  const form = await prisma.form.findFirst({
    where: { id: formId, tenantId, deletedAt: null },
    include: { fields: { orderBy: { position: 'asc' } } },
  });

  if (!form) throw new Error('Form not found');

  const displayFields = form.fields.filter(
    (f) => !['PAGE_BREAK', 'PARAGRAPH', 'HTML'].includes(f.type)
  );
  const fieldKeys = displayFields.map((f) => f.key);
  const fieldLabels = uniqueExportColumnNames([
    'ID',
    'Status',
    'Submitted / Saved At',
    'Respondent Name',
    'Respondent Email',
    'Tags',
    'Attachment Count',
    'Attachment Filenames',
    'Attachment Links',
    ...displayFields.map((f) => f.label || f.key),
  ]).slice(9);
  const fieldTypeByKey = new Map(displayFields.map((field) => [field.key, field.type]));
  const selectedSubmissionIds = normalizeExportIds(input.submissionIds);
  const selectedDraftIds = normalizeExportIds(input.draftIds);
  const includeTags = normalizeExportTags(input.includeTags);
  const excludeTags = normalizeExportTags(input.excludeTags);
  const dateWhere = buildExportDateWhere(input.fromDate, input.toDate);
  const normalizedStatus = input.status || undefined;
  const includeDrafts = normalizedStatus === 'DRAFT'
    || normalizedStatus === 'ALL_WITH_DRAFTS'
    || selectedDraftIds.length > 0;
  const includeSubmissions = normalizedStatus !== 'DRAFT' || selectedSubmissionIds.length > 0;
  const submissionStatuses = normalizedStatus && normalizedStatus !== 'DRAFT' && normalizedStatus !== 'ALL_WITH_DRAFTS'
    ? [normalizedStatus]
    : undefined;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Oakcloud';
  workbook.created = new Date();

  const baseColumns: ExcelJS.TableColumnProperties[] = [
    { name: 'ID' },
    { name: 'Status' },
    { name: 'Submitted / Saved At' },
    { name: 'Respondent Name' },
    { name: 'Respondent Email' },
    { name: 'Tags' },
    { name: 'Attachment Count' },
    { name: 'Attachment Filenames' },
    { name: 'Attachment Links' },
    ...fieldLabels.map((label) => ({ name: label })),
  ];

  let submissionCount = 0;
  let draftCount = 0;

  if (includeSubmissions) {
    const submissionWhere: Prisma.FormSubmissionWhereInput = {
      formId,
      tenantId,
      deletedAt: null,
      ...(dateWhere ? { submittedAt: dateWhere } : {}),
      ...(submissionStatuses ? { status: { in: submissionStatuses } } : {}),
      ...(selectedSubmissionIds.length > 0 ? { id: { in: selectedSubmissionIds } } : {}),
    };

    const submissions = await prisma.formSubmission.findMany({
      where: submissionWhere,
      include: {
        uploads: { orderBy: { createdAt: 'asc' } },
        _count: { select: { uploads: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });

    const normalizedSubmissionFilters = Object.entries(input.submissionFilters || {})
      .map(([columnId, value]) => [columnId, value.trim().toLowerCase()] as const)
      .filter(([, value]) => value.length > 0);

    const columnFilteredSubmissions = normalizedSubmissionFilters.length === 0
      ? submissions
      : submissions.filter((submission) => normalizedSubmissionFilters.every(([columnId, value]) => {
        if (columnId === RESPONSE_ATTACHMENTS_COLUMN_ID) {
          return `${submission._count.uploads} file${submission._count.uploads === 1 ? '' : 's'}`.toLowerCase().includes(value);
        }
        return getSubmissionColumnFilterText(submission, fieldTypeByKey, columnId).includes(value);
      }));
    const filteredSubmissions = columnFilteredSubmissions.filter((submission) => {
      const tags = getFormResponseTags(submission.metadata);
      return hasAllTags(tags, includeTags) && !hasAnyTag(tags, excludeTags);
    });

    submissionCount = filteredSubmissions.length;

    const worksheet = workbook.addWorksheet('Responses');
    populateWorksheet(
      worksheet,
      baseColumns,
      filteredSubmissions.map((submission) => {
        const answers = toAnswerRecord(submission.answers);
        return [
          submission.id,
          submission.status,
          submission.submittedAt,
          submission.respondentName || '',
          submission.respondentEmail || '',
          getFormResponseTags(submission.metadata).join(', '),
          submission.uploads.length,
          buildAttachmentText(submission.uploads),
          buildAttachmentLinks({ formId, rowId: submission.id, uploads: submission.uploads, type: 'submission' }),
          ...fieldKeys.map((key) => safeExportCellValue(fieldTypeByKey.get(key) || 'SHORT_TEXT', answers[key])),
        ];
      })
    );
    worksheet.getColumn(3).numFmt = 'yyyy-mm-dd hh:mm';
    applyWorksheetStyle(worksheet);
  }

  if (includeDrafts) {
    const draftColumns: ExcelJS.TableColumnProperties[] = [
      ...baseColumns,
      { name: 'Locale' },
    ];
    const draftWhere: Prisma.FormDraftWhereInput = {
      formId,
      tenantId,
      ...(dateWhere ? { lastSavedAt: dateWhere } : {}),
      ...(selectedDraftIds.length > 0 ? { id: { in: selectedDraftIds } } : {}),
    };

    const drafts = await prisma.formDraft.findMany({
      where: draftWhere,
      include: {
        uploads: { orderBy: { createdAt: 'asc' } },
        _count: { select: { uploads: true } },
      },
      orderBy: { lastSavedAt: 'desc' },
    });

    draftCount = drafts.length;

    const worksheet = workbook.addWorksheet('Drafts');
    populateWorksheet(
      worksheet,
      draftColumns,
      drafts.map((draft) => {
        const answers = toAnswerRecord(draft.answers);
        const metadata = parseObject(draft.metadata);
        return [
          draft.id,
          'DRAFT',
          draft.lastSavedAt,
          '',
          '',
          '',
          draft.uploads.length,
          buildAttachmentText(draft.uploads),
          buildAttachmentLinks({ formId, rowId: draft.id, uploads: draft.uploads, type: 'draft' }),
          ...fieldKeys.map((key) => safeExportCellValue(fieldTypeByKey.get(key) || 'SHORT_TEXT', answers[key])),
          metadata?.locale || '',
        ];
      })
    );
    worksheet.getColumn(3).numFmt = 'yyyy-mm-dd hh:mm';
    applyWorksheetStyle(worksheet);
  }

  const metadataSheet = workbook.addWorksheet('Export Metadata');
  metadataSheet.columns = [
    { header: 'Property', key: 'property', width: 28 },
    { header: 'Value', key: 'value', width: 70 },
  ];
  metadataSheet.addRows([
    { property: 'Form title', value: form.title },
    { property: 'Form slug', value: form.slug },
    { property: 'Exported at', value: new Date() },
    { property: 'Status filter', value: normalizedStatus || 'All submitted responses' },
    { property: 'From date', value: input.fromDate || '' },
    { property: 'To date', value: input.toDate || '' },
    { property: 'Selected submission IDs', value: selectedSubmissionIds.join(', ') || 'None' },
    { property: 'Selected draft IDs', value: selectedDraftIds.join(', ') || 'None' },
    { property: 'Submission column filters', value: JSON.stringify(input.submissionFilters || {}) },
    { property: 'Include tags', value: includeTags.join(', ') || 'None' },
    { property: 'Exclude tags', value: excludeTags.join(', ') || 'None' },
    { property: 'Response rows exported', value: submissionCount },
    { property: 'Draft rows exported', value: draftCount },
  ]);
  metadataSheet.getColumn(2).numFmt = 'yyyy-mm-dd hh:mm';
  applyWorksheetStyle(metadataSheet);

  if (workbook.worksheets.length === 1) {
    const worksheet = workbook.addWorksheet('Responses');
    worksheet.addRow(['No rows matched the selected export filters.']);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const timestamp = new Date().toISOString().slice(0, 10);
  const fileName = `${sanitizeExportFileName(form.title)}-responses-${timestamp}.xlsx`;

  return { buffer: Buffer.from(buffer), fileName };
}

export async function exportFormResponsesCsv(
  formId: string,
  tenantId: string
): Promise<{ csv: string; fileName: string }> {
  const form = await prisma.form.findFirst({
    where: { id: formId, tenantId, deletedAt: null },
    include: { fields: { orderBy: { position: 'asc' } } },
  });

  if (!form) throw new Error('Form not found');

  const submissions = await prisma.formSubmission.findMany({
    where: { formId, tenantId, deletedAt: null },
    orderBy: { submittedAt: 'desc' },
  });

  const displayFields = form.fields.filter(
    (f) => !['PAGE_BREAK', 'PARAGRAPH', 'HTML'].includes(f.type)
  );
  const fieldKeys = displayFields.map((f) => f.key);
  const fieldLabels = uniqueExportColumnNames(displayFields.map((f) => f.label || f.key));

  const header = ['submission_id', 'submitted_at', 'respondent_name', 'respondent_email', ...fieldLabels];
  const rows = submissions.map((sub) => {
    const submissionAnswers = toAnswerRecord(sub.answers);
    return [
      sub.id,
      new Date(sub.submittedAt).toISOString(),
      sub.respondentName || '',
      sub.respondentEmail || '',
      ...fieldKeys.map((key) => safeExportCellValue(
        displayFields.find((field) => field.key === key)?.type || 'SHORT_TEXT',
        submissionAnswers[key]
      )),
    ];
  });

  const csv = [header, ...rows]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const fileName = `${sanitizeExportFileName(form.title)}-responses.csv`;

  return { csv, fileName };
}
