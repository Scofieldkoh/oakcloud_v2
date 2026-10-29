'use client';

import { FormInput } from '@/components/ui/form-input';
import { Toggle } from '@/components/ui/toggle';
import { DEFAULT_PHONE_COUNTRY_CODE, PHONE_COUNTRY_CODE_OPTIONS } from '@/lib/constants/phone-country-codes';
import { TIMEZONE_OPTIONS } from '@/lib/constants/timezones';
import type { BuilderField } from './builder-utils';

const DEFAULT_TIMEZONE = 'Asia/Singapore';

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="shrink-0 text-2xs font-semibold uppercase tracking-widest text-text-muted">{title}</span>
      <div className="h-px flex-1 bg-border-primary" />
    </div>
  );
}

export function FieldValidationTab({
  field,
  allFields,
  onChange,
}: {
  field: BuilderField;
  allFields: BuilderField[];
  onChange: (next: BuilderField) => void;
}) {
  const phoneDefaultCountryCode = typeof field.validation?.phoneDefaultCountryCode === 'string'
    ? field.validation.phoneDefaultCountryCode
    : DEFAULT_PHONE_COUNTRY_CODE;
  const timezoneDefault = typeof field.validation?.timezoneDefault === 'string'
    ? field.validation.timezoneDefault
    : DEFAULT_TIMEZONE;
  const dateFieldCandidates = allFields.filter(
    (candidate) => candidate.clientId !== field.clientId && candidate.type === 'SHORT_TEXT' && candidate.inputType === 'date'
  );
  const dropdownDefaultOptions = field.type === 'DROPDOWN'
    ? field.options.map((option) => option.label.trim()).filter(Boolean)
    : [];
  const supportsDefaultValue = (
    field.type === 'DROPDOWN' ||
    field.type === 'LONG_TEXT' ||
    (
      field.type === 'SHORT_TEXT' &&
      !['time_timezone', 'info_text', 'info_image', 'info_url', 'info_heading_1', 'info_heading_2', 'info_heading_3', 'repeat_start', 'repeat_end', 'block_divider'].includes(field.inputType)
    )
  );

  const isTextLike = (field.type === 'SHORT_TEXT' && field.inputType !== 'date' && field.inputType !== 'number' && field.inputType !== 'time_timezone') || field.type === 'LONG_TEXT' || field.type === 'COMPANY_NAME_CHECK';
  const isNumber = field.type === 'SHORT_TEXT' && field.inputType === 'number';
  const isDate = field.type === 'SHORT_TEXT' && field.inputType === 'date';
  const isPhone = field.type === 'SHORT_TEXT' && field.inputType === 'phone';
  const isTimezone = field.type === 'SHORT_TEXT' && field.inputType === 'time_timezone';
  const isFile = field.type === 'FILE_UPLOAD';

  const hasAnyContent = supportsDefaultValue || isTextLike || isNumber || isDate || isPhone || isTimezone || isFile;

  if (!hasAnyContent) {
    return (
      <div className="rounded-lg border border-border-primary bg-background-elevated p-4 text-center text-xs text-text-muted">
        No validation options for this field type.
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Default value ───────────────────────────────────────────── */}
      {supportsDefaultValue && (
        <div className="space-y-3">
          <SectionHeader title="Default" />
          <div className="rounded-lg border border-border-primary bg-background-elevated p-3">
            {field.type === 'DROPDOWN' ? (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">Default value</label>
                <select
                  value={field.validation?.defaultValue || ''}
                  onChange={(e) => onChange({
                    ...field,
                    validation: {
                      ...(field.validation || {}),
                      defaultValue: e.target.value || undefined,
                    },
                  })}
                  className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
                >
                  <option value="">No default</option>
                  {dropdownDefaultOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            ) : (
              <FormInput
                label="Default value"
                type={field.type === 'SHORT_TEXT' && field.inputType === 'date' ? 'date' : field.type === 'SHORT_TEXT' && field.inputType === 'number' ? 'number' : 'text'}
                value={field.validation?.defaultValue || ''}
                onChange={(e) => {
                  const nextDefaultValue = e.target.value;
                  onChange({
                    ...field,
                    validation: {
                      ...(field.validation || {}),
                      defaultValue: nextDefaultValue.length > 0 ? nextDefaultValue : undefined,
                      defaultToday: nextDefaultValue.length > 0 && field.inputType === 'date'
                        ? undefined
                        : field.validation?.defaultToday,
                      alwaysDefaultToday: nextDefaultValue.length > 0 && field.inputType === 'date'
                        ? undefined
                        : field.validation?.alwaysDefaultToday,
                    },
                  });
                }}
                placeholder={field.type === 'SHORT_TEXT' && field.inputType === 'date' ? 'YYYY-MM-DD' : undefined}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Text constraints ────────────────────────────────────────── */}
      {isTextLike && (
        <div className="space-y-3">
          <SectionHeader title="Length" />
          <div className="grid grid-cols-2 gap-3">
            <FormInput
              label="Min length"
              type="number"
              value={field.validation?.minLength?.toString() || ''}
              onChange={(e) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  minLength: e.target.value ? Number(e.target.value) : undefined,
                },
              })}
            />
            <FormInput
              label="Max length"
              type="number"
              value={field.validation?.maxLength?.toString() || ''}
              onChange={(e) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  maxLength: e.target.value ? Number(e.target.value) : undefined,
                },
              })}
            />
          </div>

          <SectionHeader title="Pattern" />
          <div className="grid grid-cols-2 gap-3">
            <FormInput
              label="Begins with"
              value={field.validation?.startsWith || ''}
              onChange={(e) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  startsWith: e.target.value.trim() || undefined,
                },
              })}
            />
            <FormInput
              label="Ends with"
              value={field.validation?.endsWith || ''}
              onChange={(e) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  endsWith: e.target.value.trim() || undefined,
                },
              })}
            />
            <FormInput
              label="Contains"
              value={field.validation?.containsText || ''}
              onChange={(e) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  containsText: e.target.value || undefined,
                },
              })}
            />
            <FormInput
              label="Does not contain"
              value={field.validation?.notContainsText || ''}
              onChange={(e) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  notContainsText: e.target.value || undefined,
                },
              })}
            />
          </div>
        </div>
      )}

      {/* ── Numeric ─────────────────────────────────────────────────── */}
      {isNumber && (
        <div className="space-y-3">
          <SectionHeader title="Numeric range" />
          <div className="grid grid-cols-2 gap-3">
            <FormInput
              label="Min"
              type="number"
              value={field.validation?.min?.toString() || ''}
              onChange={(e) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  min: e.target.value ? Number(e.target.value) : undefined,
                },
              })}
            />
            <FormInput
              label="Max"
              type="number"
              value={field.validation?.max?.toString() || ''}
              onChange={(e) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  max: e.target.value ? Number(e.target.value) : undefined,
                },
              })}
            />
            <FormInput
              label="Equal to"
              type="number"
              value={field.validation?.equal?.toString() || ''}
              onChange={(e) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  equal: e.target.value ? Number(e.target.value) : undefined,
                },
              })}
            />
          </div>

          <SectionHeader title="Formula constraints" />
          <div className="space-y-3">
            <FormInput
              label="Min formula"
              value={field.validation?.minFormula || ''}
              onChange={(e) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  minFormula: e.target.value.trim() || undefined,
                },
              })}
              placeholder=">= [amount1] + [amount2]"
            />
            <FormInput
              label="Max formula"
              value={field.validation?.maxFormula || ''}
              onChange={(e) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  maxFormula: e.target.value.trim() || undefined,
                },
              })}
              placeholder="<= [budget] * 1.1"
            />
            <FormInput
              label="Equal formula"
              value={field.validation?.equalFormula || ''}
              onChange={(e) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  equalFormula: e.target.value.trim() || undefined,
                },
              })}
              placeholder="= [amount1] + [amount2]"
            />
            <p className="text-2xs text-text-muted">Use field keys in square brackets, e.g. <span className="font-mono">&gt;= [amount1] + [amount2]</span>.</p>
          </div>
        </div>
      )}

      {/* ── Date ────────────────────────────────────────────────────── */}
      {isDate && (
        <div className="space-y-3">
          <SectionHeader title="Date range" />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <FormInput
                label="Min date"
                value={field.validation?.minDate || ''}
                onChange={(e) => onChange({
                  ...field,
                  validation: {
                    ...(field.validation || {}),
                    minDate: e.target.value.trim() || undefined,
                  },
                })}
                placeholder="YYYY-MM-DD or today"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded border border-border-primary bg-background-primary px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary"
                  onClick={() => onChange({
                    ...field,
                    validation: { ...(field.validation || {}), minDate: 'today' },
                  })}
                >
                  Use today
                </button>
                <button
                  type="button"
                  className="rounded border border-border-primary bg-background-primary px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary"
                  onClick={() => onChange({
                    ...field,
                    validation: { ...(field.validation || {}), minDate: undefined },
                  })}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <FormInput
                label="Max date"
                value={field.validation?.maxDate || ''}
                onChange={(e) => onChange({
                  ...field,
                  validation: {
                    ...(field.validation || {}),
                    maxDate: e.target.value.trim() || undefined,
                  },
                })}
                placeholder="YYYY-MM-DD or today"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded border border-border-primary bg-background-primary px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary"
                  onClick={() => onChange({
                    ...field,
                    validation: { ...(field.validation || {}), maxDate: 'today' },
                  })}
                >
                  Use today
                </button>
                <button
                  type="button"
                  className="rounded border border-border-primary bg-background-primary px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary"
                  onClick={() => onChange({
                    ...field,
                    validation: { ...(field.validation || {}), maxDate: undefined },
                  })}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
          <p className="text-2xs text-text-muted">Use a fixed date like <span className="font-mono">2026-03-08</span> or the variable <span className="font-mono">today</span>.</p>

          {dateFieldCandidates.length > 0 && (
            <>
              <SectionHeader title="Relative date" />
              <div className="space-y-3 rounded-lg border border-border-primary bg-background-elevated p-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">Relative min date</label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                    <select
                      value={field.validation?.minDateFieldKey || ''}
                      onChange={(e) => onChange({
                        ...field,
                        validation: {
                          ...(field.validation || {}),
                          minDateFieldKey: e.target.value || undefined,
                          minDateOffsetDays: e.target.value ? (field.validation?.minDateOffsetDays || 0) : undefined,
                        },
                      })}
                      className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
                    >
                      <option value="">No relative min</option>
                      {dateFieldCandidates.map((candidate) => (
                        <option key={candidate.clientId} value={candidate.key}>
                          {candidate.label || candidate.key}
                        </option>
                      ))}
                    </select>
                    <FormInput
                      label="Offset days"
                      type="number"
                      disabled={!field.validation?.minDateFieldKey}
                      value={field.validation?.minDateOffsetDays?.toString() || '0'}
                      onChange={(e) => onChange({
                        ...field,
                        validation: {
                          ...(field.validation || {}),
                          minDateOffsetDays: e.target.value ? Number(e.target.value) : 0,
                        },
                      })}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">Relative max date</label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                    <select
                      value={field.validation?.maxDateFieldKey || ''}
                      onChange={(e) => onChange({
                        ...field,
                        validation: {
                          ...(field.validation || {}),
                          maxDateFieldKey: e.target.value || undefined,
                          maxDateOffsetDays: e.target.value ? (field.validation?.maxDateOffsetDays || 0) : undefined,
                        },
                      })}
                      className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
                    >
                      <option value="">No relative max</option>
                      {dateFieldCandidates.map((candidate) => (
                        <option key={candidate.clientId} value={candidate.key}>
                          {candidate.label || candidate.key}
                        </option>
                      ))}
                    </select>
                    <FormInput
                      label="Offset days"
                      type="number"
                      disabled={!field.validation?.maxDateFieldKey}
                      value={field.validation?.maxDateOffsetDays?.toString() || '0'}
                      onChange={(e) => onChange({
                        ...field,
                        validation: {
                          ...(field.validation || {}),
                          maxDateOffsetDays: e.target.value ? Number(e.target.value) : 0,
                        },
                      })}
                    />
                  </div>
                </div>
                <p className="text-2xs text-text-muted">Offsets are relative to the selected date field. Use -15 for 15 days earlier, 15 for 15 days later.</p>
              </div>
            </>
          )}

          <SectionHeader title="Auto-fill" />
          <div className="space-y-2 rounded-lg border border-border-primary bg-background-elevated p-3">
            <Toggle
              checked={field.validation?.defaultToday === true}
              onChange={(checked) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  defaultToday: checked ? true : undefined,
                  defaultValue: checked ? undefined : field.validation?.defaultValue,
                },
              })}
              label="Default to today's date"
              description="Pre-fill this date field with today's date for new responses."
              size="sm"
            />
            <div className="border-t border-border-primary pt-2">
              <Toggle
                checked={field.validation?.alwaysDefaultToday === true}
                onChange={(checked) => onChange({
                  ...field,
                  validation: {
                    ...(field.validation || {}),
                    alwaysDefaultToday: checked ? true : undefined,
                    defaultValue: checked ? undefined : field.validation?.defaultValue,
                  },
                })}
                label="Always default to today's date"
                description="Refresh this date field to today's date whenever the form or a saved draft is loaded."
                size="sm"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Phone ───────────────────────────────────────────────────── */}
      {isPhone && (
        <div className="space-y-3">
          <SectionHeader title="Phone" />
          <div className="space-y-3 rounded-lg border border-border-primary bg-background-elevated p-3">
            <Toggle
              checked={field.validation?.splitPhoneCountryCode === true}
              onChange={(checked) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  splitPhoneCountryCode: checked ? true : undefined,
                  phoneDefaultCountryCode: checked
                    ? (field.validation?.phoneDefaultCountryCode || DEFAULT_PHONE_COUNTRY_CODE)
                    : field.validation?.phoneDefaultCountryCode,
                },
              })}
              label="Split country code"
              description="Show a separate country code selector before the phone number input."
              size="sm"
            />
            {field.validation?.splitPhoneCountryCode === true && (
              <div className="border-t border-border-primary pt-3">
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">Default country code</label>
                <select
                  value={phoneDefaultCountryCode}
                  onChange={(e) => onChange({
                    ...field,
                    validation: {
                      ...(field.validation || {}),
                      splitPhoneCountryCode: true,
                      phoneDefaultCountryCode: e.target.value || DEFAULT_PHONE_COUNTRY_CODE,
                    },
                  })}
                  className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
                >
                  {PHONE_COUNTRY_CODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Timezone ────────────────────────────────────────────────── */}
      {isTimezone && (
        <div className="space-y-3">
          <SectionHeader title="Timezone" />
          <div className="rounded-lg border border-border-primary bg-background-elevated p-3">
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Default timezone</label>
            <select
              value={timezoneDefault}
              onChange={(e) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  timezoneDefault: e.target.value || DEFAULT_TIMEZONE,
                },
              })}
              className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
            >
              {TIMEZONE_OPTIONS.map((timezone) => (
                <option key={timezone.value} value={timezone.value}>{timezone.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* ── File upload ─────────────────────────────────────────────── */}
      {isFile && (
        <div className="space-y-3">
          <SectionHeader title="File upload" />
          <div className="space-y-3 rounded-lg border border-border-primary bg-background-elevated p-3">
            <FormInput
              label="Max file size (MB)"
              type="number"
              value={field.validation?.maxFileSizeMb?.toString() || '50'}
              onChange={(e) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  maxFileSizeMb: e.target.value ? Number(e.target.value) : 50,
                },
              })}
            />
            <div className="border-t border-border-primary pt-3">
              <Toggle
                checked={field.validation?.allowMultipleFiles === true}
                onChange={(checked) => onChange({
                  ...field,
                  validation: {
                    ...(field.validation || {}),
                    allowMultipleFiles: checked ? true : undefined,
                  },
                })}
                label="Allow multiple files"
                description="Users can upload more than one file for this field and remove files before submitting."
                size="sm"
              />
            </div>
          </div>
          <FormInput
            label="Attachment filename template"
            value={field.validation?.uploadFileNameTemplate || ''}
            onChange={(e) => {
              const nextTemplate = e.target.value;
              onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  uploadFileNameTemplate: nextTemplate.length > 0 ? nextTemplate : undefined,
                },
              });
            }}
            placeholder="Attachment - [full_name] - [datetime_stamp]"
            hint="Use [field_key], [upload_id], [original_filename], [original_basename], [original_extension], [file_index], plus [datetime_stamp], [date_stamp], [time_stamp], [submission_id], [form_title], [form_slug], and any [field_key]. [datetime_stamp] uses the workspace timezone (for example: 6 Mar 26 - 9.51PM)."
          />
        </div>
      )}

    </div>
  );
}
