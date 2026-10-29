'use client';

import { FormInput } from '@/components/ui/form-input';
import { Alert } from '@/components/ui/alert';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { useFormOptionPresets } from '@/hooks/use-form-option-presets';
import { isSummaryEligibleFieldType } from '@/lib/form-utils';
import { getConditionDependents } from './builder-analysis';
import { FIELD_TYPE_OPTIONS, WIDTH_OPTIONS, normalizeKey, isRepeatMarkerInputType, isBlockDividerInputType, isFaqField, newClientId } from './builder-utils';
import type { BuilderField, ShortInputType } from './builder-utils';
import type { FormUrlHealthDetail } from '@/hooks/use-form-url-health';

const INFO_INPUT_TYPES: ReadonlyArray<ShortInputType> = ['info_text', 'info_image', 'info_url', 'info_heading_1', 'info_heading_2', 'info_heading_3', 'info_faq'];
const PAGE_BREAK_REPEAT_START: ShortInputType = 'repeat_start';
const PAGE_BREAK_REPEAT_END: ShortInputType = 'repeat_end';
const PAGE_BREAK_BLOCK_DIVIDER: ShortInputType = 'block_divider';
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function createFaqOption(index: number) {
  const label = `Question ${index}`;
  return {
    label,
    value: newClientId(),
    bodyHtml: '<p>Answer the question here.</p>',
  };
}

function normalizeFaqOptions(options: BuilderField['options']): BuilderField['options'] {
  const normalized = options
    .map((option, index) => ({
      label: option.label || `Question ${index + 1}`,
      value: option.value || newClientId(),
      bodyHtml: option.bodyHtml || '<p>Answer the question here.</p>',
    }))
    .filter((option) => option.label.trim().length > 0);

  return normalized.length > 0 ? normalized : [createFaqOption(1)];
}

function normalizeHexColor(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (!HEX_COLOR_PATTERN.test(trimmed)) return undefined;
  if (trimmed.length === 4) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return trimmed;
}

function normalizeInfoPaddingPx(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(80, Math.round(value)));
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.max(0, Math.min(80, parsed));
  }
  return undefined;
}

function getDefaultInfoPadding(inputType: ShortInputType): { top: number; right: number; bottom: number; left: number } {
  if (inputType === 'info_image') return { top: 0, right: 0, bottom: 0, left: 0 };
  return { top: 8, right: 12, bottom: 8, left: 12 };
}

function WidthSelector({ value, onChange }: { value: number; onChange: (v: 25 | 33 | 50 | 66 | 75 | 100) => void }) {
  return (
    <div className="flex rounded-lg border border-border-primary bg-background-primary p-0.5 gap-0.5">
      {WIDTH_OPTIONS.map((width) => (
        <button
          key={width}
          type="button"
          onClick={() => onChange(width)}
          className={cn(
            'flex-1 rounded py-1.5 text-xs font-medium transition-colors',
            value === width
              ? 'bg-oak-primary text-white shadow-sm'
              : 'text-text-secondary hover:bg-background-tertiary hover:text-text-primary'
          )}
        >
          {width}%
        </button>
      ))}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="shrink-0 text-2xs font-semibold uppercase tracking-widest text-text-muted">{title}</span>
      <div className="h-px flex-1 bg-border-primary" />
    </div>
  );
}

export function FieldGeneralTab({
  field,
  allFields = [],
  onChange,
  urlHealth,
}: {
  field: BuilderField;
  allFields?: BuilderField[];
  onChange: (next: BuilderField) => void;
  urlHealth?: FormUrlHealthDetail | null;
}) {
  const presets = useFormOptionPresets();

  const canShowOnSummary = isSummaryEligibleFieldType(field.type);
  const selectedDropdownPreset = presets.data?.find((preset) => preset.id === field.optionPresetId) ?? null;
  const normalizedInfoBackgroundColor = normalizeHexColor(field.validation?.infoBackgroundColor || '');
  const normalizedInfoPaddingTopPx = normalizeInfoPaddingPx(field.validation?.infoPaddingTopPx);
  const normalizedInfoPaddingRightPx = normalizeInfoPaddingPx(field.validation?.infoPaddingRightPx);
  const normalizedInfoPaddingBottomPx = normalizeInfoPaddingPx(field.validation?.infoPaddingBottomPx);
  const normalizedInfoPaddingLeftPx = normalizeInfoPaddingPx(field.validation?.infoPaddingLeftPx);
  const infoBareStyle = field.validation?.infoBareStyle === true;
  const defaultInfoPadding = infoBareStyle ? { top: 0, right: 0, bottom: 0, left: 0 } : getDefaultInfoPadding(
    INFO_INPUT_TYPES.includes(field.inputType) ? field.inputType : 'info_text'
  );

  const showLayoutSection = field.type !== 'PAGE_BREAK' && field.type !== 'PARAGRAPH' && !isFaqField(field);
  const showBehaviorSection = field.type !== 'PAGE_BREAK' && !isFaqField(field);
  const conditionDependents = getConditionDependents(allFields, field.key);

  return (
    <div className="space-y-4">

      {field.inputType === 'info_url' && urlHealth?.warningActivatedAt ? (
        <Alert variant="warning" title="Broken link warning" compact>
          <div className="space-y-1">
            <p>
              Last checked {new Intl.DateTimeFormat('en-SG', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(urlHealth.lastCheckedAt))}
            </p>
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              <span>{urlHealth.lastHttpStatus ? `HTTP ${urlHealth.lastHttpStatus}` : urlHealth.lastErrorCode || 'Check failed'}</span>
              <span>{urlHealth.consecutiveFailures} consecutive failures</span>
            </p>
            {urlHealth.lastErrorMessage ? <p>{urlHealth.lastErrorMessage}</p> : null}
          </div>
        </Alert>
      ) : null}

      {/* ── Field identity ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-secondary">Element type</label>
          <select
            value={field.type}
            onChange={(e) => {
              const nextType = e.target.value as BuilderField['type'];
              const next: BuilderField = { ...field, type: nextType };
              if (nextType === 'PAGE_BREAK') next.layoutWidth = 100;
              if (nextType === 'SHORT_TEXT' && (!next.inputType || INFO_INPUT_TYPES.includes(next.inputType))) {
                next.inputType = 'text';
              }
              if (nextType === 'COMPANY_NAME_CHECK') {
                next.inputType = 'text';
              }
              if (nextType === 'PARAGRAPH' && !INFO_INPUT_TYPES.includes(next.inputType)) {
                next.inputType = 'info_text';
              }
              if (nextType === 'PAGE_BREAK' && !isRepeatMarkerInputType(next.inputType)) {
                next.inputType = 'text';
              }
              if (['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'DROPDOWN'].includes(nextType) && next.options.length === 0) {
                next.options = [
                  { label: 'Option 1', value: 'Option 1' },
                  { label: 'Option 2', value: 'Option 2' },
                ];
              }
              if (!isSummaryEligibleFieldType(nextType)) {
                next.showOnSummary = false;
              }
              onChange(next);
            }}
            className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
          >
            {FIELD_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <FormInput
          label="Label"
          value={field.label}
          onChange={(e) => {
            const nextLabel = e.target.value;
            const keyFromCurrentLabel = normalizeKey(field.label || '');
            const keyFromCurrentKey = normalizeKey(field.key || '');
            const shouldSyncKey = !field.key.trim() || keyFromCurrentKey === keyFromCurrentLabel;
            onChange({
              ...field,
              label: nextLabel,
              key: shouldSyncKey ? normalizeKey(nextLabel) : field.key,
            });
          }}
        />

        <FormInput
          label="Custom key"
          value={field.key}
          onChange={(e) => onChange({ ...field, key: e.target.value })}
          hint={conditionDependents.length > 0
            ? `${conditionDependents.length} field${conditionDependents.length === 1 ? '' : 's'} use this key in conditions: ${conditionDependents.map((item) => item.label || item.key).join(', ')}. Update those conditions if you rename it.`
            : 'Used by conditions, response columns, exports, and saved answers.'}
        />
      </div>

      {/* ── Type-specific content ───────────────────────────────────── */}

      {field.type === 'PAGE_BREAK' && (
        <div className="space-y-3">
          <SectionHeader title="Page break" />
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Mode</label>
            <select
              value={isRepeatMarkerInputType(field.inputType) || isBlockDividerInputType(field.inputType) ? field.inputType : 'text'}
              onChange={(e) => {
                const nextMode = e.target.value as ShortInputType;
                if (nextMode === PAGE_BREAK_REPEAT_START) {
                  onChange({
                    ...field,
                    inputType: PAGE_BREAK_REPEAT_START,
                    label: field.label || 'Dynamic section',
                    subtext: field.subtext || 'Repeat this section for multiple records.',
                    validation: {
                      ...(field.validation || {}),
                      repeatMinItems: field.validation?.repeatMinItems || 1,
                      repeatMaxItems: field.validation?.repeatMaxItems,
                      repeatAddLabel: field.validation?.repeatAddLabel || 'Add row',
                    },
                  });
                  return;
                }
                if (nextMode === PAGE_BREAK_REPEAT_END) {
                  onChange({
                    ...field,
                    inputType: PAGE_BREAK_REPEAT_END,
                    label: field.label || 'Dynamic section end',
                    validation: field.validation || null,
                  });
                  return;
                }
                if (nextMode === PAGE_BREAK_BLOCK_DIVIDER) {
                  onChange({
                    ...field,
                    inputType: PAGE_BREAK_BLOCK_DIVIDER,
                    label: 'Block divider',
                    key: field.key || 'block_divider',
                    isRequired: false,
                    isReadOnly: false,
                    hideLabel: true,
                    showOnSummary: false,
                    validation: field.validation || null,
                  });
                  return;
                }
                onChange({ ...field, inputType: 'text' });
              }}
              className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
            >
              <option value="text">Page break</option>
              <option value={PAGE_BREAK_REPEAT_START}>Dynamic section start</option>
              <option value={PAGE_BREAK_REPEAT_END}>Dynamic section end</option>
              <option value={PAGE_BREAK_BLOCK_DIVIDER}>Block divider</option>
            </select>
          </div>

          {field.inputType === PAGE_BREAK_REPEAT_START && (
            <div className="space-y-3 rounded-lg border border-border-primary bg-background-elevated p-3">
              <FormInput
                label="Section title"
                value={field.label}
                onChange={(e) => onChange({ ...field, label: e.target.value })}
                placeholder="Items"
              />
              <FormInput
                label="Add button label"
                value={field.validation?.repeatAddLabel || ''}
                onChange={(e) => onChange({
                  ...field,
                  validation: {
                    ...(field.validation || {}),
                    repeatAddLabel: e.target.value.trim() || undefined,
                  },
                })}
                placeholder="Add item"
              />
              <div className="grid grid-cols-2 gap-3">
                <FormInput
                  label="Min rows"
                  type="number"
                  value={field.validation?.repeatMinItems?.toString() || '1'}
                  onChange={(e) => onChange({
                    ...field,
                    validation: {
                      ...(field.validation || {}),
                      repeatMinItems: e.target.value ? Number(e.target.value) : 1,
                    },
                  })}
                />
                <FormInput
                  label="Max rows"
                  type="number"
                  value={field.validation?.repeatMaxItems?.toString() || ''}
                  onChange={(e) => onChange({
                    ...field,
                    validation: {
                      ...(field.validation || {}),
                      repeatMaxItems: e.target.value ? Number(e.target.value) : undefined,
                    },
                  })}
                  placeholder="Unlimited"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">Section hint</label>
                <textarea
                  value={field.subtext}
                  onChange={(e) => onChange({ ...field, subtext: e.target.value })}
                  className="w-full min-h-16 rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
                  placeholder="Explain what each row/card should capture."
                />
              </div>
            </div>
          )}

          {field.inputType === PAGE_BREAK_REPEAT_END && (
            <p className="rounded-lg border border-border-primary bg-background-elevated p-3 text-xs text-text-secondary">
              Marks the end of a dynamic section. All fields between start and end become repeatable cards.
            </p>
          )}

          {field.inputType === PAGE_BREAK_BLOCK_DIVIDER && (
            <p className="rounded-lg border border-border-primary bg-background-elevated p-3 text-xs text-text-secondary">
              Starts a new visual block for the elements that follow it. Not shown to respondents and does not collect an answer.
            </p>
          )}
        </div>
      )}

      {field.type === 'SHORT_TEXT' && (
        <div className="space-y-3">
          <SectionHeader title="Input type" />
          <select
            value={field.inputType}
            onChange={(e) => onChange({ ...field, inputType: e.target.value as ShortInputType })}
            className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
          >
            <option value="text">Text</option>
            <option value="phone">Phone</option>
            <option value="email">Email</option>
            <option value="number">Number</option>
            <option value="date">Datepicker</option>
            <option value="time_timezone">Time + timezone</option>
          </select>
        </div>
      )}

      {field.type === 'COMPANY_NAME_CHECK' && (
        <div className="space-y-3">
          <SectionHeader title="Company name check" />
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Check mode</label>
            <select
              value={field.validation?.nameCheckMode === 'advisory' ? 'advisory' : 'strict'}
              onChange={(e) => onChange({
                ...field,
                validation: { ...(field.validation || {}), nameCheckMode: e.target.value === 'advisory' ? 'advisory' : 'strict' },
              })}
              className="w-full rounded-lg border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-primary"
            >
              <option value="strict">Must pass before submitting</option>
              <option value="advisory">Advisory (respondent can continue; our team rechecks)</option>
            </select>
          </div>
          <div className="rounded-lg border border-border-primary bg-background-elevated p-3 text-xs text-text-secondary">
            {field.validation?.nameCheckMode === 'advisory'
              ? 'Respondents can check the name and see possible conflicts, but can still continue. The name is checked again when the form is submitted, and anything unclear is flagged for staff review.'
              : 'Respondents enter a proposed company name and must pass a live availability check before submitting.'}
            {' '}Results are sourced from GoBusiness / ACRA data and are indicative only; final availability
            is determined by ACRA at application time.
          </div>
        </div>
      )}

      {field.type === 'PARAGRAPH' && (
        <div className="space-y-4">
          {/* Content */}
          <div className="space-y-3">
            <SectionHeader title="Content" />
            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">Information type</label>
              <select
                value={INFO_INPUT_TYPES.includes(field.inputType) ? field.inputType : 'info_text'}
                onChange={(e) => {
                  const nextInputType = e.target.value as ShortInputType;
                  if (nextInputType === 'info_faq') {
                    const nextLabel = field.label && field.label !== 'Untitled field' ? field.label : 'Commonly Asked Questions';
                    onChange({
                      ...field,
                      inputType: 'info_faq',
                      label: nextLabel,
                      key: field.key && field.key !== 'untitled_field' ? field.key : normalizeKey(nextLabel),
                      isRequired: false,
                      isReadOnly: false,
                      showOnSummary: false,
                      options: normalizeFaqOptions(field.options),
                      validation: {
                        ...(field.validation || {}),
                        faqDefaultState: field.validation?.faqDefaultState || 'collapsed',
                        faqSearchEnabled: field.validation?.faqSearchEnabled ?? true,
                      },
                    });
                    return;
                  }
                  onChange({ ...field, inputType: nextInputType });
                }}
                className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
              >
                <option value="info_text">Text block</option>
                <option value="info_image">Image</option>
                <option value="info_url">URL / Link</option>
                <option value="info_heading_1">Heading 1</option>
                <option value="info_heading_2">Heading 2</option>
                <option value="info_heading_3">Heading 3</option>
                <option value="info_faq">FAQ</option>
              </select>
            </div>

            {!isFaqField(field) && (
              <>
                {(field.inputType === 'info_text' || !INFO_INPUT_TYPES.includes(field.inputType)) && (
                  <div className="space-y-2">
                    <label className="mb-1.5 block text-xs font-medium text-text-secondary">Text block content</label>
                    <div className="overflow-hidden rounded-lg border border-border-primary">
                      <RichTextEditor
                        value={field.subtext || ''}
                        onChange={(nextHtml) => onChange({ ...field, subtext: nextHtml })}
                        minHeight={140}
                      />
                    </div>
                    <p className="text-2xs text-text-muted">Supports rich text formatting (headings, bold, lists, links).</p>
                  </div>
                )}

                {field.inputType === 'info_image' && (
                  <>
                    <FormInput
                      label="Image URL"
                      value={field.placeholder}
                      onChange={(e) => onChange({ ...field, placeholder: e.target.value })}
                      placeholder="https://example.com/image.png"
                    />
                    <FormInput
                      label="Caption / alt text"
                      value={field.subtext}
                      onChange={(e) => onChange({ ...field, subtext: e.target.value })}
                      placeholder="Optional caption"
                    />
                  </>
                )}

                {field.inputType === 'info_url' && (
                  <>
                    <FormInput
                      label="URL"
                      value={field.placeholder}
                      onChange={(e) => onChange({ ...field, placeholder: e.target.value })}
                      placeholder="https://example.com"
                    />
                    <FormInput
                      label="Link label"
                      value={field.subtext}
                      onChange={(e) => onChange({ ...field, subtext: e.target.value })}
                      placeholder="Open resource"
                    />
                  </>
                )}
              </>
            )}
          </div>

          {/* Display options */}
          {!isFaqField(field) && (
            <div className="space-y-3">
              <SectionHeader title="Display" />
              <div className="space-y-3 rounded-lg border border-border-primary bg-background-elevated p-3">
                <Toggle
                  checked={field.validation?.infoShowInPdf === true}
                  onChange={(checked) => onChange({
                    ...field,
                    validation: {
                      ...(field.validation || {}),
                      infoShowInPdf: checked ? true : undefined,
                    },
                  })}
                  label="Show in print PDF"
                  description="Include this block in the generated response PDF. FAQ blocks print fully expanded."
                  size="sm"
                />
                <div className="border-t border-border-primary pt-3">
                  <Toggle
                    checked={field.validation?.infoInlineCard === true}
                    onChange={(checked) => onChange({
                      ...field,
                      validation: {
                        ...(field.validation || {}),
                        infoInlineCard: checked ? true : undefined,
                      },
                    })}
                    label="Place inside current card"
                    description="Render this block together with nearby form fields instead of as its own full-width card."
                    size="sm"
                  />
                  {field.validation?.infoInlineCard === true && (
                    <div className="mt-3">
                      <label className="mb-1.5 block text-xs font-medium text-text-secondary">Layout width</label>
                      <WidthSelector
                        value={field.layoutWidth}
                        onChange={(v) => onChange({ ...field, layoutWidth: v })}
                      />
                    </div>
                  )}
                </div>
                {(field.inputType === 'info_text' || field.inputType === 'info_url' || !INFO_INPUT_TYPES.includes(field.inputType)) && (
                  <div className="border-t border-border-primary pt-3">
                    <Toggle
                      checked={infoBareStyle}
                      onChange={(checked) => onChange({
                        ...field,
                        validation: {
                          ...(field.validation || {}),
                          infoBareStyle: checked ? true : undefined,
                        },
                      })}
                      label="Plain text style"
                      description="Show this information block without border or background."
                      size="sm"
                    />
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-status-warning/25 bg-status-warning/5 p-3">
                <Toggle
                  checked={field.validation?.infoStopsProgress === true}
                  onChange={(checked) => onChange({
                    ...field,
                    validation: {
                      ...(field.validation || {}),
                      infoStopsProgress: checked ? true : undefined,
                    },
                  })}
                  label="Stop form progression"
                  description="When this block is visible, respondents cannot continue to the next page or submit the form."
                  size="sm"
                />
              </div>
            </div>
          )}

          {/* Styling */}
          {!isFaqField(field) && (
            <div className="space-y-3">
              <SectionHeader title="Styling" />
              <div className="space-y-3 rounded-lg border border-border-primary bg-background-elevated p-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">Background color</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="color"
                      value={normalizedInfoBackgroundColor || '#f8fafc'}
                      onChange={(e) => onChange({
                        ...field,
                        validation: {
                          ...(field.validation || {}),
                          infoBackgroundColor: normalizeHexColor(e.target.value),
                        },
                      })}
                      className="h-8 w-10 cursor-pointer rounded border border-border-primary bg-background-primary p-1"
                      aria-label="Choose information block background color"
                    />
                    <div className="rounded border border-border-primary bg-background-primary px-2 py-1 text-xs font-mono text-text-secondary">
                      {normalizedInfoBackgroundColor || 'Default'}
                    </div>
                    {normalizedInfoBackgroundColor && (
                      <button
                        type="button"
                        className="rounded border border-border-primary px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
                        onClick={() => onChange({
                          ...field,
                          validation: {
                            ...(field.validation || {}),
                            infoBackgroundColor: undefined,
                          },
                        })}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                <div className="border-t border-border-primary pt-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label className="block text-xs font-medium text-text-secondary">Content padding (px)</label>
                    {(normalizedInfoPaddingTopPx !== undefined
                      || normalizedInfoPaddingRightPx !== undefined
                      || normalizedInfoPaddingBottomPx !== undefined
                      || normalizedInfoPaddingLeftPx !== undefined) && (
                      <button
                        type="button"
                        className="rounded border border-border-primary px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
                        onClick={() => onChange({
                          ...field,
                          validation: {
                            ...(field.validation || {}),
                            infoPaddingTopPx: undefined,
                            infoPaddingRightPx: undefined,
                            infoPaddingBottomPx: undefined,
                            infoPaddingLeftPx: undefined,
                          },
                        })}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'infoPaddingTopPx', label: 'Top', value: normalizedInfoPaddingTopPx },
                      { key: 'infoPaddingRightPx', label: 'Right', value: normalizedInfoPaddingRightPx },
                      { key: 'infoPaddingBottomPx', label: 'Bottom', value: normalizedInfoPaddingBottomPx },
                      { key: 'infoPaddingLeftPx', label: 'Left', value: normalizedInfoPaddingLeftPx },
                    ].map((paddingField) => (
                      <div key={paddingField.key}>
                        <label className="mb-1 block text-2xs font-medium uppercase tracking-[0.08em] text-text-muted">
                          {paddingField.label}
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={80}
                          step={1}
                          value={paddingField.value ?? ''}
                          onChange={(e) => onChange({
                            ...field,
                            validation: {
                              ...(field.validation || {}),
                              [paddingField.key]: normalizeInfoPaddingPx(e.target.value),
                            },
                          })}
                          className="w-full rounded border border-border-primary bg-background-primary px-2.5 py-1.5 text-xs text-text-primary"
                          placeholder={String(
                            paddingField.label === 'Top'
                              ? defaultInfoPadding.top
                              : paddingField.label === 'Right'
                                ? defaultInfoPadding.right
                                : paddingField.label === 'Bottom'
                                  ? defaultInfoPadding.bottom
                                  : defaultInfoPadding.left
                          )}
                          aria-label={`Set ${paddingField.label.toLowerCase()} padding in pixels`}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-2xs text-text-muted">Leave empty for default spacing.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {isFaqField(field) && (
        <div className="space-y-4">
          <div className="space-y-3">
            <SectionHeader title="Content" />
            <div className="space-y-2 rounded-lg border border-border-primary bg-background-elevated p-3">
              <label className="block text-xs font-medium text-text-secondary">Main header</label>
              <div className="overflow-hidden rounded-lg border border-border-primary">
                <RichTextEditor
                  value={field.label || ''}
                  onChange={(nextHtml) => onChange({ ...field, label: nextHtml })}
                  minHeight={96}
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">FAQ items</label>
              <div className="space-y-2">
                {field.options.map((option, optionIndex) => (
                  <div key={option.value || `${field.clientId}-faq-${optionIndex}`} className="rounded-lg border border-border-primary bg-background-elevated p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-text-secondary">Item {optionIndex + 1}</span>
                      <button
                        type="button"
                        className="rounded border border-border-primary px-2 py-1 text-xs text-text-secondary hover:text-status-error"
                        onClick={() => onChange({
                          ...field,
                          options: field.options.filter((_, idx) => idx !== optionIndex),
                        })}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-text-secondary">Header</label>
                        <div className="overflow-hidden rounded-lg border border-border-primary">
                          <RichTextEditor
                            value={option.label || ''}
                            onChange={(nextHtml) => {
                              const nextOptions = field.options.map((candidate, idx) => (
                                idx === optionIndex ? { ...candidate, label: nextHtml } : candidate
                              ));
                              onChange({ ...field, options: nextOptions });
                            }}
                            minHeight={96}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-text-secondary">Body</label>
                        <div className="overflow-hidden rounded-lg border border-border-primary">
                          <RichTextEditor
                            value={option.bodyHtml || ''}
                            onChange={(nextHtml) => {
                              const nextOptions = field.options.map((candidate, idx) => (
                                idx === optionIndex ? { ...candidate, bodyHtml: nextHtml } : candidate
                              ));
                              onChange({ ...field, options: nextOptions });
                            }}
                            minHeight={140}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="mt-2 rounded border border-border-primary bg-background-primary px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary"
                onClick={() => onChange({
                  ...field,
                  options: [
                    ...field.options,
                    createFaqOption(field.options.length + 1),
                  ],
                })}
              >
                Add FAQ item
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <SectionHeader title="Behavior" />
            <div className="space-y-3 rounded-lg border border-border-primary bg-background-elevated p-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">Default item state</label>
                <select
                  value={field.validation?.faqDefaultState || 'collapsed'}
                  onChange={(e) => onChange({
                    ...field,
                    validation: {
                      ...(field.validation || {}),
                      faqDefaultState: e.target.value as 'collapsed' | 'expanded' | 'first_expanded',
                    },
                  })}
                  className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
                >
                  <option value="collapsed">All collapsed</option>
                  <option value="expanded">All expanded</option>
                  <option value="first_expanded">First item expanded</option>
                </select>
              </div>
              <div className="border-t border-border-primary pt-3 space-y-3">
                <Toggle
                  checked={field.validation?.faqSearchEnabled !== false}
                  onChange={(checked) => onChange({
                    ...field,
                    validation: {
                      ...(field.validation || {}),
                      faqSearchEnabled: checked ? true : false,
                    },
                  })}
                  label="Show search bar"
                  description="Allow respondents to search FAQ headers and body text."
                  size="sm"
                />
                <Toggle
                  checked={field.validation?.faqMainToggleEnabled === true}
                  onChange={(checked) => onChange({
                    ...field,
                    validation: {
                      ...(field.validation || {}),
                      faqMainToggleEnabled: checked ? true : undefined,
                      faqMainDefaultExpanded: checked ? (field.validation?.faqMainDefaultExpanded ?? false) : undefined,
                    },
                  })}
                  label="Hide FAQ behind main header"
                  description="Show only the main header row until respondents expand it."
                  size="sm"
                />
                {field.validation?.faqMainToggleEnabled === true && (
                  <Toggle
                    checked={field.validation?.faqMainDefaultExpanded === true}
                    onChange={(checked) => onChange({
                      ...field,
                      validation: {
                        ...(field.validation || {}),
                        faqMainToggleEnabled: true,
                        faqMainDefaultExpanded: checked ? true : undefined,
                      },
                    })}
                    label="Main header expanded by default"
                    description="Open the FAQ section when the form first loads."
                    size="sm"
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {(field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE') && (
        <div className="space-y-3">
          <SectionHeader title="Options" />
          <div className="space-y-2">
            {field.options.map((option, optionIndex) => (
              <div key={`${field.clientId}-option-${optionIndex}`} className="rounded-lg border border-border-primary bg-background-elevated p-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <FormInput
                      label={`Option ${optionIndex + 1}`}
                      value={option.label}
                      onChange={(e) => {
                        const nextLabel = e.target.value;
                        const nextOptions = field.options.map((candidate, idx) => (
                          idx === optionIndex
                            ? { ...candidate, label: nextLabel, value: nextLabel }
                            : candidate
                        ));
                        onChange({ ...field, options: nextOptions });
                      }}
                    />
                    <Toggle
                      checked={option.allowTextInput === true}
                      onChange={(checked) => {
                        const nextOptions = field.options.map((candidate, idx) => (
                          idx === optionIndex ? {
                            ...candidate,
                            allowTextInput: checked,
                            textInputLabel: checked ? candidate.textInputLabel : null,
                            textInputPlaceholder: checked ? candidate.textInputPlaceholder : null,
                          } : candidate
                        ));
                        onChange({ ...field, options: nextOptions });
                      }}
                      description="Shows a text field when this option is selected."
                      className="pt-1"
                      size="sm"
                    />
                    <FormInput
                      label="Hover tooltip"
                      value={option.tooltipText || ''}
                      onChange={(e) => {
                        const nextOptions = field.options.map((candidate, idx) => (
                          idx === optionIndex ? { ...candidate, tooltipText: e.target.value } : candidate
                        ));
                        onChange({ ...field, options: nextOptions });
                      }}
                      placeholder="Optional tooltip for this option"
                    />
                    {option.allowTextInput === true && (
                      <div className="mt-2 grid grid-cols-1 gap-2">
                        <FormInput
                          label="Details field label"
                          value={option.textInputLabel || ''}
                          onChange={(e) => {
                            const nextOptions = field.options.map((candidate, idx) => (
                              idx === optionIndex ? { ...candidate, textInputLabel: e.target.value } : candidate
                            ));
                            onChange({ ...field, options: nextOptions });
                          }}
                          placeholder="Please specify"
                        />
                        <FormInput
                          label="Details placeholder"
                          value={option.textInputPlaceholder || ''}
                          onChange={(e) => {
                            const nextOptions = field.options.map((candidate, idx) => (
                              idx === optionIndex ? { ...candidate, textInputPlaceholder: e.target.value } : candidate
                            ));
                            onChange({ ...field, options: nextOptions });
                          }}
                          placeholder="Enter details"
                        />
                      </div>
                    )}
                    {(field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE') && (
                      <div className="mt-2 rounded-lg border border-border-primary bg-background-primary p-2.5">
                        <Toggle
                          checked={option.defaultSelected === true}
                          onChange={(checked) => {
                            const nextOptions = field.options.map((candidate, idx) => (
                              idx === optionIndex
                                ? { ...candidate, defaultSelected: checked || candidate.requiredSelected === true }
                                : (field.type === 'SINGLE_CHOICE' && checked ? { ...candidate, defaultSelected: false } : candidate)
                            ));
                            onChange({ ...field, options: nextOptions });
                          }}
                          label="Selected by default"
                          description="Pre-select this option for new responses."
                          size="sm"
                        />
                        {field.type === 'MULTIPLE_CHOICE' && (
                          <div className="mt-2 border-t border-border-primary pt-2">
                            <Toggle
                              checked={option.requiredSelected === true}
                              onChange={(checked) => {
                                const nextOptions = field.options.map((candidate, idx) => (
                                  idx === optionIndex
                                    ? { ...candidate, requiredSelected: checked, defaultSelected: checked ? true : candidate.defaultSelected }
                                    : candidate
                                ));
                                onChange({ ...field, options: nextOptions });
                              }}
                              label="Required option"
                              description="Keep this option selected for respondents."
                              size="sm"
                            />
                          </div>
                        )}
                      </div>
                    )}
                    {field.type === 'MULTIPLE_CHOICE' && (
                      <div className="mt-3 rounded-lg border border-border-primary bg-background-primary p-2.5">
                        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-xs font-medium text-text-secondary">Nested options</div>
                          <Toggle
                            checked={option.childSelectionMode === 'single'}
                            onChange={(checked) => {
                              const nextOptions = field.options.map((candidate, idx) => {
                                if (idx !== optionIndex) return candidate;
                                const childOptions = candidate.childOptions || [];
                                if (!checked) {
                                  return { ...candidate, childSelectionMode: 'multiple' as const, childOptions };
                                }
                                let defaultAssigned = false;
                                let requiredAssigned = false;
                                return {
                                  ...candidate,
                                  childSelectionMode: 'single' as const,
                                  childOptions: childOptions.map((childCandidate) => {
                                    const keepRequired = childCandidate.requiredSelected === true && !requiredAssigned;
                                    const keepDefault = keepRequired || (childCandidate.defaultSelected === true && !defaultAssigned);
                                    if (keepRequired) requiredAssigned = true;
                                    if (keepDefault) defaultAssigned = true;
                                    return {
                                      ...childCandidate,
                                      requiredSelected: keepRequired,
                                      defaultSelected: keepDefault,
                                    };
                                  }),
                                };
                              });
                              onChange({ ...field, options: nextOptions });
                            }}
                            label="Single choice"
                            description="Allow respondents to pick only one nested option."
                            size="sm"
                          />
                        </div>
                        <div className="space-y-2">
                          {(option.childOptions || []).map((childOption, childIndex) => (
                            <div key={`${field.clientId}-option-${optionIndex}-child-${childIndex}`} className="rounded border border-border-primary bg-background-elevated p-2">
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1 space-y-2">
                                  <FormInput
                                    label={`Nested option ${childIndex + 1}`}
                                    value={childOption.label}
                                    onChange={(e) => {
                                      const nextLabel = e.target.value;
                                      const nextOptions = field.options.map((candidate, idx) => (
                                        idx === optionIndex
                                          ? {
                                            ...candidate,
                                            childOptions: (candidate.childOptions || []).map((childCandidate, childCandidateIndex) => (
                                              childCandidateIndex === childIndex
                                                ? { ...childCandidate, label: nextLabel, value: nextLabel }
                                                : childCandidate
                                            )),
                                          }
                                          : candidate
                                      ));
                                      onChange({ ...field, options: nextOptions });
                                    }}
                                  />
                                  <Toggle
                                    checked={childOption.allowTextInput === true}
                                    onChange={(checked) => {
                                      const nextOptions = field.options.map((candidate, idx) => (
                                        idx === optionIndex
                                          ? {
                                            ...candidate,
                                            childOptions: (candidate.childOptions || []).map((childCandidate, childCandidateIndex) => (
                                              childCandidateIndex === childIndex
                                                ? {
                                                  ...childCandidate,
                                                  allowTextInput: checked,
                                                  textInputLabel: checked ? childCandidate.textInputLabel : null,
                                                  textInputPlaceholder: checked ? childCandidate.textInputPlaceholder : null,
                                                }
                                                : childCandidate
                                            )),
                                          }
                                          : candidate
                                      ));
                                      onChange({ ...field, options: nextOptions });
                                    }}
                                    description="Shows a text field when this nested option is selected."
                                    size="sm"
                                  />
                                  <FormInput
                                    label="Hover tooltip"
                                    value={childOption.tooltipText || ''}
                                    onChange={(e) => {
                                      const nextOptions = field.options.map((candidate, idx) => (
                                        idx === optionIndex
                                          ? {
                                            ...candidate,
                                            childOptions: (candidate.childOptions || []).map((childCandidate, childCandidateIndex) => (
                                              childCandidateIndex === childIndex ? { ...childCandidate, tooltipText: e.target.value } : childCandidate
                                            )),
                                          }
                                          : candidate
                                      ));
                                      onChange({ ...field, options: nextOptions });
                                    }}
                                    placeholder="Optional tooltip for this nested option"
                                  />
                                  {childOption.allowTextInput === true && (
                                    <div className="grid grid-cols-1 gap-2">
                                      <FormInput
                                        label="Details field label"
                                        value={childOption.textInputLabel || ''}
                                        onChange={(e) => {
                                          const nextOptions = field.options.map((candidate, idx) => (
                                            idx === optionIndex
                                              ? {
                                                ...candidate,
                                                childOptions: (candidate.childOptions || []).map((childCandidate, childCandidateIndex) => (
                                                  childCandidateIndex === childIndex ? { ...childCandidate, textInputLabel: e.target.value } : childCandidate
                                                )),
                                              }
                                              : candidate
                                          ));
                                          onChange({ ...field, options: nextOptions });
                                        }}
                                        placeholder="Please specify"
                                      />
                                      <FormInput
                                        label="Details placeholder"
                                        value={childOption.textInputPlaceholder || ''}
                                        onChange={(e) => {
                                          const nextOptions = field.options.map((candidate, idx) => (
                                            idx === optionIndex
                                              ? {
                                                ...candidate,
                                                childOptions: (candidate.childOptions || []).map((childCandidate, childCandidateIndex) => (
                                                  childCandidateIndex === childIndex ? { ...childCandidate, textInputPlaceholder: e.target.value } : childCandidate
                                                )),
                                              }
                                              : candidate
                                          ));
                                          onChange({ ...field, options: nextOptions });
                                        }}
                                        placeholder="Enter details"
                                      />
                                    </div>
                                  )}
                                  <div className="space-y-2 rounded border border-border-primary bg-background-primary p-2">
                                    <Toggle
                                      checked={childOption.defaultSelected === true}
                                      onChange={(checked) => {
                                        const nextOptions = field.options.map((candidate, idx) => (
                                          idx === optionIndex
                                            ? {
                                              ...candidate,
                                              childOptions: (candidate.childOptions || []).map((childCandidate, childCandidateIndex) => (
                                                childCandidateIndex === childIndex
                                                  ? { ...childCandidate, defaultSelected: checked || childCandidate.requiredSelected === true }
                                                  : (candidate.childSelectionMode === 'single' && checked ? { ...childCandidate, defaultSelected: false, requiredSelected: false } : childCandidate)
                                              )),
                                            }
                                            : candidate
                                        ));
                                        onChange({ ...field, options: nextOptions });
                                      }}
                                      label="Selected by default"
                                      size="sm"
                                    />
                                    <Toggle
                                      checked={childOption.requiredSelected === true}
                                      onChange={(checked) => {
                                        const nextOptions = field.options.map((candidate, idx) => (
                                          idx === optionIndex
                                            ? {
                                              ...candidate,
                                              childOptions: (candidate.childOptions || []).map((childCandidate, childCandidateIndex) => (
                                                childCandidateIndex === childIndex
                                                  ? { ...childCandidate, requiredSelected: checked, defaultSelected: checked ? true : childCandidate.defaultSelected }
                                                  : (candidate.childSelectionMode === 'single' && checked ? { ...childCandidate, defaultSelected: false, requiredSelected: false } : childCandidate)
                                              )),
                                            }
                                            : candidate
                                        ));
                                        onChange({ ...field, options: nextOptions });
                                      }}
                                      label="Required option"
                                      size="sm"
                                    />
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="rounded border border-border-primary px-2 py-1 text-xs text-text-secondary hover:text-status-error"
                                  onClick={() => {
                                    const nextOptions = field.options.map((candidate, idx) => (
                                      idx === optionIndex
                                        ? { ...candidate, childOptions: (candidate.childOptions || []).filter((_, childCandidateIndex) => childCandidateIndex !== childIndex) }
                                        : candidate
                                    ));
                                    onChange({ ...field, options: nextOptions });
                                  }}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="mt-2 rounded border border-border-primary bg-background-primary px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary"
                          onClick={() => {
                            const nextChildIndex = (option.childOptions || []).length + 1;
                            const nextOptions = field.options.map((candidate, idx) => (
                              idx === optionIndex
                                ? {
                                  ...candidate,
                                  childOptions: [
                                    ...(candidate.childOptions || []),
                                    { label: `Nested option ${nextChildIndex}`, value: `Nested option ${nextChildIndex}` },
                                  ],
                                }
                                : candidate
                            ));
                            onChange({ ...field, options: nextOptions });
                          }}
                        >
                          Add nested option
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="rounded border border-border-primary px-2 py-1 text-xs text-text-secondary hover:text-status-error"
                    onClick={() => {
                      const nextOptions = field.options.filter((_, idx) => idx !== optionIndex);
                      onChange({ ...field, options: nextOptions });
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 rounded border border-border-primary bg-background-primary px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary"
            onClick={() => {
              const nextIndex = field.options.length + 1;
              onChange({
                ...field,
                options: [
                  ...field.options,
                  { label: `Option ${nextIndex}`, value: `Option ${nextIndex}` },
                ],
              });
            }}
          >
            Add option
          </button>
        </div>
      )}

      {field.type === 'DROPDOWN' && (
        <div className="space-y-3">
          <SectionHeader title="Options" />
          <div className="rounded-lg border border-border-primary bg-background-elevated p-3">
            <label htmlFor="dropdown-preset-list" className="mb-1.5 block text-xs font-medium text-text-secondary">Preset list</label>
            <div className="flex flex-wrap items-end gap-2">
              <select
                id="dropdown-preset-list"
                value={field.optionPresetId ?? 'custom'}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    onChange({ ...field, optionPresetId: null });
                    return;
                  }
                  const preset = presets.data?.find((candidate) => candidate.id === e.target.value);
                  if (!preset) return;
                  onChange({ ...field, optionPresetId: preset.id, options: preset.options });
                }}
                className="min-w-48 flex-1 rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
              >
                <option value="custom">Custom options</option>
                {(presets.data ?? []).map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </select>
            </div>
            {presets.isLoading ? <p className="mt-2 text-xs text-text-tertiary">Loading preset lists…</p> : null}
            {presets.error ? <p className="mt-2 text-xs text-status-error">Unable to load preset lists.</p> : null}
            {selectedDropdownPreset ? (
              <p className="mt-2 text-xs text-text-tertiary">
                Linked to {selectedDropdownPreset.name} · {selectedDropdownPreset.optionCount.toLocaleString()} options
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="dropdown-options" className="mb-1.5 block text-xs font-medium text-text-secondary">Options</label>
            <textarea
              id="dropdown-options"
              value={(selectedDropdownPreset?.options ?? field.options).map((option) => option.label).join('\n')}
              readOnly={Boolean(field.optionPresetId)}
              onChange={(e) => onChange({
                ...field,
                options: e.target.value
                  .split('\n')
                  .map((line) => ({ label: line, value: line })),
              })}
              className={cn(
                'min-h-24 w-full rounded-lg border border-border-primary px-3 py-2 text-sm',
                field.optionPresetId
                  ? 'cursor-default bg-background-tertiary text-text-secondary'
                  : 'bg-background-primary text-text-primary',
              )}
              placeholder="One option per line"
            />
          </div>
          {field.optionPresetId ? (
            <div className="rounded-lg border border-border-primary bg-background-primary p-3 text-xs text-text-secondary">
              Options are managed by the linked preset. Choose Custom options to make an editable copy of the current list.
            </div>
          ) : null}
        </div>
      )}

      {/* ── Layout ─────────────────────────────────────────────────── */}
      {showLayoutSection && (
        <div className="space-y-3">
          <SectionHeader title="Layout" />
          <FormInput
            label="Placeholder"
            value={field.placeholder}
            onChange={(e) => onChange({ ...field, placeholder: e.target.value })}
          />
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Width</label>
            <WidthSelector
              value={field.layoutWidth}
              onChange={(v) => onChange({ ...field, layoutWidth: v })}
            />
          </div>
          {(field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE') && (
            <div className="rounded-lg border border-border-primary bg-background-elevated p-3">
              <Toggle
                checked={field.validation?.choiceInlineRight === true}
                onChange={(checked) => onChange({
                  ...field,
                  validation: {
                    ...(field.validation || {}),
                    choiceInlineRight: checked ? true : undefined,
                  },
                })}
                label="Inline options on right"
                description="Show the question label on the left and options side by side on the right."
                size="sm"
              />
              <div className="mt-3">
                <Toggle
                  checked={field.validation?.choiceLayout === 'chips'}
                  onChange={(checked) => onChange({
                    ...field,
                    validation: {
                      ...(field.validation || {}),
                      choiceLayout: checked ? 'chips' : undefined,
                    },
                  })}
                  label="Show options as buttons"
                  description="Show short option lists as buttons people tap to select."
                  size="sm"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Behavior ───────────────────────────────────────────────── */}
      {showBehaviorSection && (
        <div className="space-y-3">
          <SectionHeader title="Behavior" />
          <div className="space-y-3 rounded-lg border border-border-primary bg-background-elevated p-3">
            <Toggle checked={field.isRequired} onChange={(checked) => onChange({ ...field, isRequired: checked })} label="Required" description="Respondents must fill this field before continuing." size="sm" />
            <div className="border-t border-border-primary pt-3 space-y-3">
              <Toggle checked={field.isReadOnly} onChange={(checked) => onChange({ ...field, isReadOnly: checked })} label="Read only" size="sm" />
              <Toggle checked={field.hideLabel} onChange={(checked) => onChange({ ...field, hideLabel: checked })} label="Hide label" size="sm" />
              <Toggle
                checked={field.validation?.layoutBreakBefore === true}
                onChange={(checked) => onChange({
                  ...field,
                  validation: {
                    ...(field.validation || {}),
                    layoutBreakBefore: checked ? true : undefined,
                  },
                })}
                label="Start on new row"
                description="Prevent this field from merging into the previous row when widths leave space."
                size="sm"
              />
            </div>
            <div className="border-t border-border-primary pt-3">
              <Toggle
                checked={field.showOnSummary}
                onChange={(checked) => onChange({ ...field, showOnSummary: checked })}
                label="Show on summary"
                description={canShowOnSummary
                  ? 'Show this field as a column on the Responses page.'
                  : 'This field type cannot be shown on the responses summary table.'}
                size="sm"
                disabled={!canShowOnSummary}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Help ───────────────────────────────────────────────────── */}
      {showBehaviorSection && (
        <div className="space-y-3">
          <SectionHeader title="Help" />
          <div className="rounded-lg border border-border-primary bg-background-elevated p-3">
            <Toggle
              checked={field.validation?.tooltipEnabled === true}
              onChange={(checked) => onChange({
                ...field,
                validation: {
                  ...(field.validation || {}),
                  tooltipEnabled: checked,
                  tooltipMode: checked ? (field.validation?.tooltipMode || 'hover') : undefined,
                },
              })}
              label="Tooltip"
              description="Show an information icon beside this field label."
              size="sm"
            />
          </div>

          {field.validation?.tooltipEnabled === true && (
            <div className="space-y-3 rounded-lg border border-border-primary bg-background-elevated p-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">Tooltip mode</label>
                <select
                  value={field.validation?.tooltipMode || 'hover'}
                  onChange={(e) => onChange({
                    ...field,
                    validation: {
                      ...(field.validation || {}),
                      tooltipEnabled: true,
                      tooltipMode: e.target.value as 'hover' | 'inline',
                    },
                  })}
                  className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
                >
                  <option value="hover">Hover tooltip</option>
                  <option value="inline">Click to show information block</option>
                </select>
              </div>

              <div className="border-t border-border-primary pt-3">
                {field.validation?.tooltipMode === 'inline' ? (
                  <div className="space-y-2">
                    <label className="mb-1.5 block text-xs font-medium text-text-secondary">Tooltip content</label>
                    <div className="overflow-hidden rounded-lg border border-border-primary">
                      <RichTextEditor
                        value={field.helpText || ''}
                        onChange={(nextHtml) => onChange({ ...field, helpText: nextHtml })}
                        minHeight={120}
                      />
                    </div>
                    <p className="text-2xs text-text-muted">Supports rich text for the block shown after clicking the icon.</p>
                  </div>
                ) : (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-text-secondary">Tooltip content</label>
                    <textarea
                      value={field.helpText}
                      onChange={(e) => onChange({ ...field, helpText: e.target.value })}
                      className="w-full min-h-20 rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
                      placeholder="Guidance shown when users hover the info icon"
                    />
                  </div>
                )}
              </div>

              {field.validation?.tooltipMode === 'inline' && (
                <div className="space-y-3 border-t border-border-primary pt-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-text-secondary">Block background color</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="color"
                        value={normalizeHexColor(field.validation?.tooltipInfoBackgroundColor || '') || '#f8fafc'}
                        onChange={(e) => onChange({
                          ...field,
                          validation: {
                            ...(field.validation || {}),
                            tooltipInfoBackgroundColor: normalizeHexColor(e.target.value),
                          },
                        })}
                        className="h-8 w-10 cursor-pointer rounded border border-border-primary bg-background-primary p-1"
                        aria-label="Choose tooltip information block background color"
                      />
                      <div className="rounded border border-border-primary bg-background-primary px-2 py-1 text-xs font-mono text-text-secondary">
                        {normalizeHexColor(field.validation?.tooltipInfoBackgroundColor || '') || 'Default'}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-text-secondary">Block padding (px)</label>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { key: 'tooltipInfoPaddingTopPx', label: 'Top' },
                        { key: 'tooltipInfoPaddingRightPx', label: 'Right' },
                        { key: 'tooltipInfoPaddingBottomPx', label: 'Bottom' },
                        { key: 'tooltipInfoPaddingLeftPx', label: 'Left' },
                      ] as const).map((paddingField) => (
                        <div key={paddingField.key}>
                          <label className="mb-1 block text-2xs font-medium uppercase tracking-[0.08em] text-text-muted">
                            {paddingField.label}
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={80}
                            step={1}
                            value={normalizeInfoPaddingPx(field.validation?.[paddingField.key]) ?? ''}
                            onChange={(e) => onChange({
                              ...field,
                              validation: {
                                ...(field.validation || {}),
                                [paddingField.key]: normalizeInfoPaddingPx(e.target.value),
                              },
                            })}
                            className="w-full rounded border border-border-primary bg-background-primary px-2.5 py-1.5 text-xs text-text-primary"
                            placeholder="12"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
