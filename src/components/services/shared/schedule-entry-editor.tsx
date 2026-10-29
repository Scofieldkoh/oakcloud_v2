'use client';

import { Button } from '@/components/ui/button';
import type { ScheduleEntryInput } from '@/lib/validations/service-schedule';

const EXPRESSION_KINDS = ['DAY_OF_MONTH', 'BUSINESS_DAY_FROM_START', 'BUSINESS_DAY_FROM_END', 'RELATIVE_TO_SOURCE'] as const;
type ExpressionKind = typeof EXPRESSION_KINDS[number];
const RELATIVE_SOURCE_KINDS = ['CYCLE_START', 'CYCLE_END', 'CURRENT_SCHEDULE_ENTRY', 'COMPANY_FIELD', 'PARAMETER', 'SCHEDULE_ENTRY', 'MILESTONE'] as const;
type RelativeSourceKind = typeof RELATIVE_SOURCE_KINDS[number];

function sourceFor(kind: string): Record<string, unknown> {
  switch (kind) {
    case 'CYCLE_END': return { kind: 'CYCLE_END' };
    case 'CURRENT_SCHEDULE_ENTRY': return { kind: 'CURRENT_SCHEDULE_ENTRY' };
    case 'COMPANY_FIELD': return { kind: 'COMPANY_FIELD', field: 'financialYearEnd' };
    case 'PARAMETER': return { kind: 'PARAMETER', key: 'parameter' };
    case 'MILESTONE': return { kind: 'MILESTONE', key: 'milestone' };
    case 'SCHEDULE_ENTRY': return { kind: 'SCHEDULE_ENTRY', key: 'entry' };
    case 'CYCLE_START':
    default: return { kind: 'CYCLE_START' };
  }
}

function expressionFor(kind: ExpressionKind, current?: Record<string, unknown>): ScheduleEntryInput['expression'] {
  if (kind === 'DAY_OF_MONTH') return { kind, day: typeof current?.day === 'number' ? current.day : 1 };
  if (kind === 'BUSINESS_DAY_FROM_START' || kind === 'BUSINESS_DAY_FROM_END') {
    return { kind, ordinal: typeof current?.ordinal === 'number' ? current.ordinal : 1 };
  }
  return {
    kind: 'RELATIVE_TO_SOURCE',
    source: current && typeof current.source === 'object' ? current.source as never : sourceFor('CYCLE_START') as never,
    offset: current?.offset && typeof current.offset === 'object'
      ? current.offset as never
      : typeof current?.offset === 'number' ? current.offset : 0,
    unit: current?.unit === 'BUSINESS_DAY' ? 'BUSINESS_DAY' : 'CALENDAR_DAY',
  } as ScheduleEntryInput['expression'];
}

function isIntegerParameter(value: unknown): value is { kind: 'INTEGER_PARAMETER'; key: string } {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'INTEGER_PARAMETER'
    && typeof (value as Record<string, unknown>).key === 'string';
}

function labelForKind(kind: string): string {
  return kind.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export interface ScheduleEntryEditorCapabilities {
  allowedRelativeSourceKinds?: readonly RelativeSourceKind[];
  allowParameterizedOffsets?: boolean;
}

function isAllowedSource(source: unknown, allowedSources: readonly RelativeSourceKind[]): source is RelativeSourceKind {
  return typeof source === 'string' && allowedSources.includes(source as RelativeSourceKind);
}

function normalizeExpression(
  expression: ScheduleEntryInput['expression'],
  capabilities?: ScheduleEntryEditorCapabilities,
): ScheduleEntryInput['expression'] {
  if (expression.kind !== 'RELATIVE_TO_SOURCE') return expression;
  const allowedSources = capabilities?.allowedRelativeSourceKinds ?? RELATIVE_SOURCE_KINDS;
  const source = isAllowedSource(expression.source.kind, allowedSources)
    ? expression.source
    : sourceFor(allowedSources[0] ?? 'CYCLE_START') as never;
  const offset = capabilities?.allowParameterizedOffsets === false && isIntegerParameter(expression.offset)
    ? 0
    : expression.offset;
  return { ...expression, source, offset };
}

function updateExpression(entry: ScheduleEntryInput, changes: Record<string, unknown>, capabilities?: ScheduleEntryEditorCapabilities): ScheduleEntryInput {
  return { ...entry, expression: normalizeExpression({ ...entry.expression, ...changes } as ScheduleEntryInput['expression'], capabilities) };
}

export interface ScheduleEntryEditorProps {
  value: ScheduleEntryInput[];
  onChange: (value: ScheduleEntryInput[]) => void;
  disabled?: boolean;
  capabilities?: ScheduleEntryEditorCapabilities;
  hideHeader?: boolean;
  hideAddButton?: boolean;
  addButtonText?: string;
}

export function ScheduleEntryEditor({
  value,
  onChange,
  disabled = false,
  capabilities,
  hideHeader = false,
  hideAddButton = false,
  addButtonText = 'Add custom schedule',
}: ScheduleEntryEditorProps) {
  const addEntry = () => {
    if (value.length >= 31) return;
    const key = `entry-${crypto.randomUUID().slice(0, 8)}`;
    onChange([...value, {
      key,
      label: 'New schedule entry',
      expression: { kind: 'DAY_OF_MONTH', day: 1 },
      businessDayAdjustment: 'NONE',
    }]);
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {!hideHeader && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Schedule entries</span>
          {!hideAddButton && (
            <Button
              size="xs"
              variant="secondary"
              disabled={disabled || value.length >= 31}
              aria-label="Add schedule entry"
              onClick={addEntry}
            >
              {addButtonText}
            </Button>
          )}
        </div>
      )}

      <p role="status" aria-live="polite" className="text-xs text-text-secondary">
        {value.length} of 31 schedule entries configured
      </p>

      {value.length === 0 && !hideHeader && (
        <p className="text-xs text-text-muted italic">No custom schedule entries configured.</p>
      )}

      <div className="space-y-3">
        {value.map((entry, index) => {
          const expression = normalizeExpression(entry.expression, capabilities) as Record<string, unknown>;
          const expressionKind = typeof expression.kind === 'string' && EXPRESSION_KINDS.includes(expression.kind as ExpressionKind)
            ? expression.kind as ExpressionKind
            : 'DAY_OF_MONTH';
          const source = expression.source && typeof expression.source === 'object' ? expression.source as Record<string, unknown> : {};
          const allowedSources = capabilities?.allowedRelativeSourceKinds ?? RELATIVE_SOURCE_KINDS;
          const integerParameterOffset = isIntegerParameter(expression.offset) ? expression.offset : null;
          const parameterizedOffset = integerParameterOffset !== null;
          const allowParameterizedOffsets = capabilities?.allowParameterizedOffsets !== false;
          const prefix = `schedule-${entry.key}`;
          const update = (changes: Partial<ScheduleEntryInput>) => onChange(value.map((item) => item.key === entry.key ? { ...item, ...changes } : item));

          return (
            <div key={entry.key} className="space-y-3 pt-3 first:pt-0 border-t border-border-secondary first:border-0">
              {/* Row 1: Entry label and Remove button */}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label htmlFor={`${prefix}-label`} className="label">Entry label</label>
                  <input
                    id={`${prefix}-label`}
                    className="input input-sm min-h-[44px] w-full"
                    disabled={disabled}
                    value={entry.label}
                    onChange={(event) => update({ label: event.target.value })}
                  />
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-10 px-3 text-status-error hover:bg-status-error/10 border-status-error/30 hover:border-status-error/50 shrink-0"
                  disabled={disabled}
                  aria-label={`Remove ${entry.label}`}
                  onClick={() => onChange(value.filter((item) => item.key !== entry.key))}
                >
                  Remove
                </Button>
              </div>

              {/* Row 2: Day of month / Ordinal / Relative, Expression, and Business-day adjustment */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {expressionKind === 'DAY_OF_MONTH' ? (
                  <div>
                    <label htmlFor={`${prefix}-day`} className="label">Day of month</label>
                    <input
                      id={`${prefix}-day`}
                      className="input input-sm min-h-[38px]"
                      type="number"
                      min={1}
                      max={31}
                      disabled={disabled}
                      value={typeof expression.day === 'number' ? expression.day : ''}
                      onChange={(event) => {
                        const val = event.target.value;
                        update(updateExpression(entry, { day: val === '' ? '' : Number(val) }, capabilities));
                      }}
                    />
                  </div>
                ) : null}

                {expressionKind === 'BUSINESS_DAY_FROM_START' || expressionKind === 'BUSINESS_DAY_FROM_END' ? (
                  <div>
                    <label htmlFor={`${prefix}-ordinal`} className="label">Business-day ordinal</label>
                    <input
                      id={`${prefix}-ordinal`}
                      className="input input-sm min-h-[38px]"
                      type="number"
                      min={1}
                      max={31}
                      disabled={disabled}
                      value={typeof expression.ordinal === 'number' ? expression.ordinal : ''}
                      onChange={(event) => {
                        const val = event.target.value;
                        update(updateExpression(entry, { ordinal: val === '' ? '' : Number(val) }, capabilities));
                      }}
                    />
                  </div>
                ) : null}

                {expressionKind === 'RELATIVE_TO_SOURCE' ? (
                  <>
                    <div>
                      <label htmlFor={`${prefix}-source-kind`} className="label">Relative source</label>
                      <select
                        id={`${prefix}-source-kind`}
                        className="input input-sm min-h-[38px] w-full"
                        disabled={disabled}
                        value={typeof source.kind === 'string' ? source.kind : allowedSources[0] ?? 'CYCLE_START'}
                        onChange={(event) => update(updateExpression(entry, { source: sourceFor(event.target.value) }, capabilities))}
                      >
                        {allowedSources.map((kind) => <option key={kind} value={kind}>{labelForKind(kind)}</option>)}
                      </select>
                    </div>
                    {source.kind === 'COMPANY_FIELD' ? (
                      <div>
                        <label htmlFor={`${prefix}-source-field`} className="label">Company date field</label>
                        <select
                          id={`${prefix}-source-field`}
                          className="input input-sm min-h-[38px] w-full"
                          disabled={disabled}
                          value={typeof source.field === 'string' ? source.field : 'financialYearEnd'}
                          onChange={(event) => update(updateExpression(entry, { source: { ...source, field: event.target.value } }, capabilities))}
                        >
                          <option value="financialYearEnd">Financial year end</option>
                          <option value="accountsDueDate">Accounts due date</option>
                          <option value="incorporationDate">Incorporation date</option>
                        </select>
                      </div>
                    ) : null}
                    {source.kind === 'PARAMETER' || source.kind === 'SCHEDULE_ENTRY' || source.kind === 'MILESTONE' ? (
                      <div>
                        <label htmlFor={`${prefix}-source-key`} className="label">Source key</label>
                        <input
                          id={`${prefix}-source-key`}
                          className="input input-sm min-h-[38px]"
                          disabled={disabled}
                          value={typeof source.key === 'string' ? source.key : ''}
                          onChange={(event) => update(updateExpression(entry, { source: { ...source, key: event.target.value } }, capabilities))}
                        />
                      </div>
                    ) : null}
                    <div>
                      <label htmlFor={`${prefix}-offset-operand`} className="label">Offset operand</label>
                      <select
                        id={`${prefix}-offset-operand`}
                        className="input input-sm min-h-[44px] w-full"
                        disabled={disabled}
                        value={parameterizedOffset ? 'INTEGER_PARAMETER' : 'LITERAL'}
                        onChange={(event) => update(updateExpression(entry, {
                          offset: event.target.value === 'INTEGER_PARAMETER'
                            ? { kind: 'INTEGER_PARAMETER', key: integerParameterOffset?.key ?? 'parameter' }
                            : 0,
                        }, capabilities))}
                      >
                        <option value="LITERAL">Literal</option>
                        {allowParameterizedOffsets ? <option value="INTEGER_PARAMETER">Integer parameter</option> : null}
                      </select>
                    </div>
                    {integerParameterOffset ? (
                      <div>
                        <label htmlFor={`${prefix}-offset-parameter-key`} className="label">Offset parameter key</label>
                        <input
                          id={`${prefix}-offset-parameter-key`}
                          className="input input-sm min-h-[44px]"
                          disabled={disabled}
                          value={integerParameterOffset.key}
                          onChange={(event) => update(updateExpression(entry, {
                            offset: { kind: 'INTEGER_PARAMETER', key: event.target.value },
                          }, capabilities))}
                        />
                      </div>
                    ) : (
                      <div>
                        <label htmlFor={`${prefix}-offset`} className="label">Offset</label>
                        <input
                          id={`${prefix}-offset`}
                          className="input input-sm min-h-[44px]"
                          type="number"
                          min={-3660}
                          max={3660}
                          disabled={disabled}
                          value={typeof expression.offset === 'number' ? expression.offset : ''}
                          onChange={(event) => {
                            const val = event.target.value;
                            update(updateExpression(entry, { offset: val === '' ? '' : Number(val) }, capabilities));
                          }}
                        />
                      </div>
                    )}
                    <div>
                      <label htmlFor={`${prefix}-offset-unit`} className="label">Offset unit</label>
                      <select
                        id={`${prefix}-offset-unit`}
                        className="input input-sm min-h-[44px] w-full"
                        disabled={disabled}
                        value={expression.unit === 'BUSINESS_DAY' ? 'BUSINESS_DAY' : 'CALENDAR_DAY'}
                        onChange={(event) => update(updateExpression(entry, { unit: event.target.value }, capabilities))}
                      >
                        <option value="CALENDAR_DAY">Calendar day</option>
                        <option value="BUSINESS_DAY">Business day</option>
                      </select>
                    </div>
                  </>
                ) : null}

                <div>
                  <label htmlFor={`${prefix}-kind`} className="label">Expression</label>
                  <select
                    id={`${prefix}-kind`}
                    className="input input-sm min-h-[38px] w-full"
                    disabled={disabled}
                    value={expressionKind}
                    onChange={(event) => update({ expression: normalizeExpression(expressionFor(event.target.value as ExpressionKind, expression), capabilities) })}
                  >
                    {EXPRESSION_KINDS.map((kind) => <option key={kind} value={kind}>{labelForKind(kind)}</option>)}
                  </select>
                </div>

                <div>
                  <label htmlFor={`${prefix}-adjustment`} className="label">Business-day adjustment</label>
                  <select
                    id={`${prefix}-adjustment`}
                    className="input input-sm min-h-[38px] w-full"
                    disabled={disabled}
                    value={entry.businessDayAdjustment}
                    onChange={(event) => update({ businessDayAdjustment: event.target.value as ScheduleEntryInput['businessDayAdjustment'] })}
                  >
                    <option value="NONE">No adjustment</option>
                    <option value="PREVIOUS">Previous business day</option>
                    <option value="NEXT">Next business day</option>
                  </select>
                </div>
              </div>

              {(value.length > 1) && (
                <div className="flex gap-2 pt-1 border-t border-border-secondary/60">
                  <Button size="xs" variant="ghost" disabled={disabled || index === 0} aria-label={`Move ${entry.label} up`} onClick={() => move(index, -1)}>Move up</Button>
                  <Button size="xs" variant="ghost" disabled={disabled || index === value.length - 1} aria-label={`Move ${entry.label} down`} onClick={() => move(index, 1)}>Move down</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
