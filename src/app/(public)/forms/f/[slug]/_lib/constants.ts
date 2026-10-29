/** Patterns, style classes and field-type sets used by the public form page. */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const NAME_HINT_PATTERN = /(full[\s_-]?name|first[\s_-]?name|last[\s_-]?name|name)/i;
export const EMAIL_HINT_PATTERN = /email/i;
export const DATA_URI_PATTERN = /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9.+_-]+=[a-z0-9.+_-]+)*;base64,/i;
export const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const CHOICE_RADIO_INPUT_CLASS = 'h-4 w-4 border-[#D8E3DF] bg-[#F4F7F6] accent-[#294D44]';
export const CHOICE_CHECKBOX_INPUT_CLASS = 'h-4 w-4 rounded border-[#D8E3DF] bg-[#F4F7F6] accent-[#294D44]';
export const ERROR_FIELD_CLASS = 'border-status-error/70 bg-status-error/5 focus:border-status-error focus:ring-status-error/20';
export const ERROR_CHOICE_CLASS = 'border-status-error/70 bg-status-error/5 ring-1 ring-status-error/20';
export const DEFAULT_TIMEZONE = 'Asia/Singapore';
export const NON_VALIDATABLE_FIELD_TYPES = new Set(['PARAGRAPH', 'HTML', 'HIDDEN']);

export const CARD_ELIGIBLE_TYPES = new Set([
  'SHORT_TEXT',
  'LONG_TEXT',
  'DROPDOWN',
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'FILE_UPLOAD',
  'SIGNATURE',
  'COMPANY_NAME_CHECK',
]);
