import {
  formatChoiceAnswer,
  formatTimeTimezoneAnswer,
  isEmptyValue,
} from '@/lib/form-utils';

type ResponseFieldLike = {
  type: string;
  inputType?: string | null;
};

export function isResponseAnswerField(field: ResponseFieldLike): boolean {
  return !['PAGE_BREAK', 'PARAGRAPH', 'HTML', 'HIDDEN'].includes(field.type);
}

export function formatResponseFieldValue(field: ResponseFieldLike, value: unknown): string | null {
  if (isEmptyValue(value)) return null;

  if (field.type === 'SHORT_TEXT' && field.inputType === 'time_timezone') {
    return formatTimeTimezoneAnswer(value);
  }

  if (field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE') {
    return formatChoiceAnswer(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          return String(item);
        }
        return '';
      })
      .filter(Boolean)
      .join('; ');
    return text || null;
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}
