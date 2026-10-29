const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export const DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN =
  '{{template_name}}_{{company_name}}_{{date}}';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatDocumentGenerationTitle(
  templateName: string,
  companyName: string,
  date: Date = new Date(),
): string {
  const dateLabel = formatDocumentGenerationDate(date);
  return `${templateName.trim()}_${companyName.trim()}_${dateLabel}`;
}

export function formatDocumentGenerationDate(value: string | Date): string {
  if (typeof value === 'string') {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (dateOnly) {
      const month = Number(dateOnly[2]) - 1;
      const day = Number(dateOnly[3]);
      const year = Number(dateOnly[1]);
      if (month >= 0 && month < SHORT_MONTHS.length && day >= 1 && day <= 31) {
        return `${day} ${SHORT_MONTHS[month]} ${year}`;
      }
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function selectDocumentGenerationTitleDate(input: {
  values: Record<string, string>;
  selectedFieldKey?: string | null;
  serviceAgreementDate?: string | null;
  fallbackDate?: Date;
}): string | Date {
  const agreementDate = input.serviceAgreementDate?.trim();
  if (agreementDate) return agreementDate;

  if (input.selectedFieldKey) {
    const selectedValue = input.values[input.selectedFieldKey]?.trim();
    if (selectedValue) return selectedValue;
    return input.fallbackDate ?? new Date();
  }

  return input.fallbackDate ?? new Date();
}

export function resolveDocumentGenerationTitle(input: {
  title: string;
  templateName: string;
  companyName?: string | null;
  date?: string | Date | null;
}): string {
  const dateLabel = input.date ? formatDocumentGenerationDate(input.date) : '';
  return input.title
    .replaceAll('{{template_name}}', input.templateName.trim())
    .replaceAll('{{company_name}}', input.companyName?.trim() ?? '')
    .replaceAll('{{date}}', dateLabel);
}

export function isAutoDocumentGenerationTitle(
  title: string,
  templateName: string,
): boolean {
  const normalizedTitle = title.trim();
  const normalizedTemplateName = templateName.trim();
  if (
    normalizedTitle === DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN
    || normalizedTitle === normalizedTemplateName
    || normalizedTitle === `Untitled - ${normalizedTemplateName}`
  ) {
    return true;
  }

  const pattern = new RegExp(
    `^${escapeRegExp(normalizedTemplateName)}_.+_\\d{1,2} [A-Z][a-z]{2} \\d{4}$`,
  );
  return pattern.test(normalizedTitle);
}
