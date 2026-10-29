'use client';

import { useMemo, useState, type ComponentProps, type FormEvent } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import type { DeadlineRuleDraftInput } from '@/lib/validations/deadline-rule';
import type { DeadlineRuleDto, DeadlineRuleVersionDto } from '@/services/deadline-rule';
import { cn } from '@/lib/utils';

type FormNode = Record<string, unknown>;
type DateExpression = DeadlineRuleDraftInput['milestones'][number]['expression'];

const COMPANY_FIELDS = [
  { value: 'entityType', label: 'Company entity type', kind: 'string' },
  { value: 'status', label: 'Company status', kind: 'string' },
  { value: 'primarySsicCode', label: 'Primary SSIC code', kind: 'string' },
  { value: 'isGstRegistered', label: 'GST registered', kind: 'boolean' },
  { value: 'isRegisteredCharity', label: 'Registered charity', kind: 'boolean' },
  { value: 'currentOfficerCount', label: 'Officer count', kind: 'number' },
  { value: 'currentShareholderCount', label: 'Shareholder count', kind: 'number' },
  { value: 'financialYearEnd', label: 'Financial year end', kind: 'date' },
  { value: 'accountsDueDate', label: 'Accounts due date', kind: 'date' },
] as const;

const EXPRESSION_KINDS = [
  { value: 'SOURCE', label: 'Direct source' },
  { value: 'ADD_CALENDAR_DAYS', label: 'Add calendar days' },
  { value: 'ADD_BUSINESS_DAYS', label: 'Add business days' },
  { value: 'ADD_MONTHS', label: 'Add months' },
  { value: 'ADD_MONTHS_MONTH_END', label: 'Add months (month end stays month end)' },
  { value: 'FIXED_DATE_FROM_SOURCE_YEAR', label: 'Fixed date based on another date' },
  { value: 'FIXED_DATE_IN_ASSESSMENT_YEAR', label: 'Fixed date in the Year of Assessment' },
  { value: 'RELATIVE_TO_SOURCE', label: 'Relative to source' },
  { value: 'ADJUST_BUSINESS_DAY', label: 'Adjust business day' },
] as const;

const SOURCE_KINDS = [
  { value: 'COMPANY_FIELD', label: 'Company date' },
  { value: 'CYCLE_START', label: 'Cycle start' },
  { value: 'CYCLE_END', label: 'Cycle end' },
  { value: 'OBLIGATION_PERIOD_END', label: 'Financial period end' },
  { value: 'OBLIGATION_PERIOD_START', label: 'Financial period start' },
  { value: 'SCHEDULE_ENTRY', label: 'Schedule entry' },
  { value: 'CURRENT_SCHEDULE_ENTRY', label: 'Current schedule entry' },
  { value: 'PARAMETER', label: 'Date parameter' },
  { value: 'MILESTONE', label: 'Earlier milestone' },
] as const;

const MILESTONE_TYPES = [
  { value: 'STATUTORY', label: 'Statutory' },
  { value: 'CLIENT', label: 'Client' },
  { value: 'INTERNAL', label: 'Internal' },
] as const;


const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function yearRelationshipLabel(offset: number): string {
  if (offset === 0) return 'the same year as';
  if (offset === 1) return 'the year after';
  if (offset === -1) return 'the year before';
  return offset > 1 ? `${offset} years after` : `${Math.abs(offset)} years before`;
}


const RULE_CONTROL_CLASS = 'input input-sm min-h-11 px-3 py-0 text-sm leading-5 sm:min-h-9';
const RULE_LABEL_CONTROL_CLASS = `${RULE_CONTROL_CLASS} mt-1.5 w-full`;

function RuleFormInput({
  className,
  containerClassName,
  inputSize: _inputSize,
  ...props
}: ComponentProps<typeof FormInput>) {
  return (
    <FormInput
      {...props}
      inputSize="sm"
      containerClassName={cn('gap-1.5', containerClassName)}
      className={cn('min-h-11 px-3 text-sm leading-5 sm:min-h-9', className)}
    />
  );
}

function directSource(field = 'accountsDueDate'): FormNode {
  return { kind: 'COMPANY_FIELD', field };
}

function sourceExpression(field = 'accountsDueDate'): FormNode {
  return { kind: 'SOURCE', source: directSource(field) };
}

function asDateExpression(value: FormNode): DateExpression {
  return value as DateExpression;
}

function emptyMilestone(index: number): DeadlineRuleDraftInput['milestones'][number] {
  return {
    key: `milestone-${index + 1}`,
    name: `Milestone ${index + 1}`,
    description: null,
    type: 'CLIENT',
    generationMode: 'ONCE_PER_CYCLE',
    expression: asDateExpression(sourceExpression()),
    businessDayAdjustment: 'NONE',
    displayOrder: index,
    isActive: true,
  };
}

function emptyDraft(): DeadlineRuleDraftInput {
  return {
    code: '',
    name: '',
    description: null,
    recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
    applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
    parameters: [],
    milestones: [emptyMilestone(0)],
  };
}

function draftFromVersion(rule: DeadlineRuleDto, version: DeadlineRuleVersionDto | null): DeadlineRuleDraftInput {
  if (!version) return emptyDraft();
  return {
    code: rule.code,
    name: rule.name,
    description: rule.description,
    recurrence: version.recurrence as DeadlineRuleDraftInput['recurrence'],
    applicability: version.applicability as DeadlineRuleDraftInput['applicability'],
    parameters: version.parameters.map((parameter) => ({
      key: parameter.key,
      label: parameter.label,
      description: parameter.description,
      type: parameter.type,
      required: parameter.required,
      ...(parameter.type === 'ENUM' && Array.isArray((parameter.validation as FormNode | null)?.options)
        ? { options: ((parameter.validation as FormNode).options as unknown[]).filter((option): option is string => typeof option === 'string') }
        : {}),
    })),
    milestones: version.milestones.map((milestone) => ({
      key: milestone.key,
      name: milestone.name,
      description: milestone.description,
      type: milestone.type,
      generationMode: milestone.generationMode,
      expression: milestone.expression as DeadlineRuleDraftInput['milestones'][number]['expression'],
      businessDayAdjustment: milestone.businessDayAdjustment,
      displayOrder: milestone.displayOrder,
      isActive: milestone.isActive,
    })),
  };
}

function fieldDefinition(field: string) {
  return COMPANY_FIELDS.find((candidate) => candidate.value === field) ?? COMPANY_FIELDS[0];
}

function sourceLabel(source: FormNode): string {
  const kind = typeof source.kind === 'string' ? source.kind : 'COMPANY_FIELD';
  if (kind === 'COMPANY_FIELD') {
    const field = typeof source.field === 'string' ? source.field : 'accountsDueDate';
    if (field === 'financialYearEnd') return 'Financial year end';
    if (field === 'accountsDueDate') return 'Accounts due date';
    if (field === 'incorporationDate') return 'Incorporation date';
    return fieldDefinition(field).label;
  }
  if (kind === 'CYCLE_START') return 'Cycle start';
  if (kind === 'CYCLE_END') return 'Cycle end';
  if (kind === 'OBLIGATION_PERIOD_END') return 'Financial period end';
  if (kind === 'OBLIGATION_PERIOD_START') return 'Financial period start';
  if (kind === 'CURRENT_SCHEDULE_ENTRY') return 'Current schedule entry';
  if (kind === 'SCHEDULE_ENTRY') return typeof source.key === 'string' && source.key ? `Schedule entry "${source.key}"` : 'Schedule entry';
  if (kind === 'PARAMETER') return typeof source.key === 'string' && source.key ? `Variable "${source.key}"` : 'Date variable';
  if (kind === 'MILESTONE') return typeof source.key === 'string' && source.key ? `Milestone "${source.key}"` : 'Earlier milestone';
  return 'Date source';
}

export function describeDeadlineExpression(value: unknown): string {
  const expression = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as FormNode : sourceExpression();
  const kind = typeof expression.kind === 'string' ? expression.kind : 'SOURCE';
  const source = typeof expression.source === 'object' && expression.source !== null && !Array.isArray(expression.source)
    ? expression.source as FormNode
    : directSource();
  const amount = typeof expression.amount === 'number'
    ? expression.amount
    : typeof expression.offset === 'number'
      ? expression.offset
      : 0;
  if (kind === 'SOURCE') return sourceLabel(source);
  if (kind === 'ADD_MONTHS') return `${sourceLabel(source)} ${amount >= 0 ? '+' : '−'} ${Math.abs(amount)} month${Math.abs(amount) === 1 ? '' : 's'}`;
  if (kind === 'ADD_MONTHS_MONTH_END') {
    return `${sourceLabel(source)} ${amount >= 0 ? '+' : '−'} ${Math.abs(amount)} month${Math.abs(amount) === 1 ? '' : 's'} (a month end stays a month end)`;
  }
  if (kind === 'FIXED_DATE_IN_ASSESSMENT_YEAR') {
    const month = typeof expression.month === 'number' ? expression.month : 1;
    const day = typeof expression.day === 'number' ? expression.day : 1;
    return `${day} ${MONTH_NAMES[month - 1] ?? `month ${month}`} of the Year of Assessment`;
  }
  if (kind === 'ADD_CALENDAR_DAYS') return `${sourceLabel(source)} ${amount >= 0 ? '+' : '−'} ${Math.abs(amount)} calendar day${Math.abs(amount) === 1 ? '' : 's'}`;
  if (kind === 'ADD_BUSINESS_DAYS') return `${sourceLabel(source)} ${amount >= 0 ? '+' : '−'} ${Math.abs(amount)} business day${Math.abs(amount) === 1 ? '' : 's'}`;
  if (kind === 'FIXED_DATE_FROM_SOURCE_YEAR') {
    const yearOffset = typeof expression.yearOffset === 'number' ? expression.yearOffset : 0;
    const month = typeof expression.month === 'number' ? expression.month : 1;
    const day = typeof expression.day === 'number' ? expression.day : 1;
    const monthName = MONTH_NAMES[month - 1] ?? `month ${month}`;
    return `${day} ${monthName} in ${yearRelationshipLabel(yearOffset)} ${sourceLabel(source)}`;
  }
  if (kind === 'RELATIVE_TO_SOURCE') {
    const unit = expression.unit === 'BUSINESS_DAY' ? 'business day' : 'calendar day';
    return `${sourceLabel(source)} ${amount >= 0 ? '+' : '−'} ${Math.abs(amount)} ${unit}${Math.abs(amount) === 1 ? '' : 's'}`;
  }
  if (kind === 'ADJUST_BUSINESS_DAY') return `Adjust to the ${expression.adjustment === 'NEXT' ? 'next' : 'previous'} business day`;
  return kind.replaceAll('_', ' ').toLowerCase();
}

export function describeRuleRecurrence(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'Not configured';
  const recurrence = value as FormNode;
  const kind = typeof recurrence.kind === 'string' ? recurrence.kind : '';
  const interval = typeof recurrence.interval === 'number' ? recurrence.interval : 1;
  if (kind === 'ONE_TIME') return 'One time';
  if (kind === 'MONTHLY') return interval === 1 ? 'Monthly' : `Every ${interval} months`;
  if (kind === 'QUARTERLY') return interval === 1 ? 'Quarterly' : `Every ${interval} quarters`;
  if (kind === 'SEMI_ANNUALLY') return interval === 1 ? 'Semi-annually' : `Every ${interval} half-years`;
  if (kind === 'ANNUALLY') return interval === 1 ? 'Annually' : `Every ${interval} years`;
  if (kind === 'CUSTOM') {
    const unit = typeof recurrence.unit === 'string' ? recurrence.unit.toLowerCase().replaceAll('_', ' ') : 'period';
    return `Every ${interval} ${unit}${interval === 1 ? '' : 's'}`;
  }
  return kind ? kind.replaceAll('_', ' ').toLowerCase() : 'Not configured';
}

export function describeBusinessDayAdjustment(value: string): string {
  if (value === 'NEXT') return 'Move to next business day';
  if (value === 'PREVIOUS') return 'Move to previous business day';
  return 'No business-day adjustment';
}

function initialPredicate(): FormNode {
  return { kind: 'FIELD_PRESENT', field: 'entityType' };
}

function initialGroup(kind: 'ALL' | 'ANY' = 'ALL'): FormNode {
  return { kind, conditions: [] };
}

function isGroup(node: FormNode): boolean {
  return node.kind === 'ALL' || node.kind === 'ANY';
}

function conditionsOf(node: FormNode): FormNode[] {
  return Array.isArray(node.conditions)
    ? node.conditions.filter((condition): condition is FormNode => typeof condition === 'object' && condition !== null && !Array.isArray(condition))
    : [];
}

function valueForField(field: string): unknown {
  const definition = fieldDefinition(field);
  if (definition.kind === 'boolean') return true;
  if (definition.kind === 'number') return 0;
  if (definition.kind === 'date') return '2026-01-01';
  return '';
}

function defaultPredicateForField(field: string): FormNode {
  const definition = fieldDefinition(field);
  return {
    kind: definition.kind === 'boolean' ? 'FIELD_TRUE' : 'FIELD_EQUALS',
    field,
    ...(definition.kind === 'boolean' ? {} : { value: valueForField(field) }),
  };
}

function predicateForOperator(field: string, operator: string, current: FormNode): FormNode {
  const definition = fieldDefinition(field);
  if (['FIELD_TRUE', 'FIELD_FALSE', 'FIELD_PRESENT', 'FIELD_MISSING'].includes(operator)) {
    return { kind: operator, field };
  }
  if (operator === 'FIELD_COMPARE') {
    return {
      kind: operator,
      field,
      operator: ['GT', 'GTE', 'LT', 'LTE'].includes(String(current.operator)) ? current.operator : 'GTE',
      value: definition.kind === 'number' && typeof current.value === 'number'
        ? current.value
        : definition.kind === 'date' && typeof current.value === 'string'
          ? current.value
          : valueForField(field),
    };
  }
  if (operator === 'FIELD_IN' || operator === 'FIELD_NOT_IN') {
    const values = Array.isArray(current.values)
      ? current.values
      : [current.value ?? valueForField(field)];
    return { kind: operator, field, values };
  }
  return {
    kind: operator,
    field,
    value: current.value ?? valueForField(field),
  };
}

function predicateOperators(field: string) {
  const definition = fieldDefinition(field);
  if (definition.kind === 'boolean') return [
    ['FIELD_TRUE', 'is true'],
    ['FIELD_FALSE', 'is false'],
    ['FIELD_PRESENT', 'is present'],
    ['FIELD_MISSING', 'is missing'],
  ] as const;
  if (definition.kind === 'number' || definition.kind === 'date') return [
    ['FIELD_EQUALS', 'equals'],
    ['FIELD_NOT_EQUALS', 'does not equal'],
    ['FIELD_COMPARE', 'compare'],
    ['FIELD_PRESENT', 'is present'],
    ['FIELD_MISSING', 'is missing'],
  ] as const;
  return [
    ['FIELD_EQUALS', 'equals'],
    ['FIELD_NOT_EQUALS', 'does not equal'],
    ['FIELD_IN', 'is in'],
    ['FIELD_NOT_IN', 'is not in'],
    ['FIELD_PRESENT', 'is present'],
    ['FIELD_MISSING', 'is missing'],
  ] as const;
}

function updateNodeAtPath(root: FormNode, path: number[], update: (node: FormNode) => FormNode): FormNode {
  if (path.length === 0) return update(root);
  const [head, ...tail] = path;
  const conditions = conditionsOf(root);
  return {
    ...root,
    conditions: conditions.map((condition, index) => index === head ? updateNodeAtPath(condition, tail, update) : condition),
  };
}

function ApplicabilityNodeEditor({
  node,
  path,
  onChange,
  onRemove,
  disabled,
}: {
  node: FormNode;
  path: number[];
  onChange: (path: number[], node: FormNode) => void;
  onRemove?: () => void;
  disabled: boolean;
}) {
  if (isGroup(node)) {
    const conditions = conditionsOf(node);
    const isRoot = path.length === 0;
    return (
      <div className={isRoot ? 'space-y-3' : 'space-y-3 border-l-2 border-border-secondary pl-3'}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-text-secondary">{isRoot ? 'Apply when' : 'Nested group'}</span>
          <select
            id={`app-group-${path.join('-') || 'root'}`}
            aria-label="Group"
            className={cn(RULE_CONTROL_CLASS, "w-auto")}
            value={String(node.kind)}
            disabled={disabled}
            onChange={(event) => onChange(path, { ...node, kind: event.target.value })}
          >
            <option value="ALL">All conditions are true</option>
            <option value="ANY">Any condition is true</option>
          </select>
          {onRemove ? (
            <Button type="button" size="xs" variant="ghost" onClick={onRemove} disabled={disabled}>
              Remove group
            </Button>
          ) : null}
        </div>

        {conditions.length === 0 ? (
          <div className="rounded-md border border-dashed border-border-primary px-3 py-3">
            <p className="text-sm font-medium text-text-primary">Applies to all eligible companies</p>
            <p className="mt-1 text-xs text-text-muted">Add a condition only when this rule should apply to a narrower group.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {conditions.map((condition, index) => (
              <ApplicabilityNodeEditor
                key={`${path.join('-')}-${index}`}
                node={condition}
                path={[...path, index]}
                onChange={onChange}
                onRemove={() => onChange(path, { ...node, conditions: conditions.filter((_, itemIndex) => itemIndex !== index) })}
                disabled={disabled}
              />
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="xs"
            variant="secondary"

            disabled={disabled}
            onClick={() => onChange(path, { ...node, conditions: [...conditions, initialPredicate()] })}
          >
            Add condition
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"

            disabled={disabled}
            onClick={() => onChange(path, { ...node, conditions: [...conditions, initialGroup('ALL')] })}
          >
            Add condition group
          </Button>
        </div>
      </div>
    );
  }

  const field = typeof node.field === 'string' ? node.field : 'entityType';
  const operators = predicateOperators(field);
  const definition = fieldDefinition(field);
  const value = node.value;
  const hasValue = !['FIELD_PRESENT', 'FIELD_MISSING', 'FIELD_TRUE', 'FIELD_FALSE'].includes(String(node.kind));

  return (
    <div className="rounded-md border border-border-secondary bg-background-primary p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)_auto]">
        <label className="text-xs font-medium text-text-secondary">
          Company field
          <select
            className={RULE_LABEL_CONTROL_CLASS}
            value={field}
            disabled={disabled}
            onChange={(event) => onChange(path, defaultPredicateForField(event.target.value))}
          >
            {COMPANY_FIELDS.map((candidate) => <option key={candidate.value} value={candidate.value}>{candidate.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-text-secondary">
          Operator
          <select
            className={RULE_LABEL_CONTROL_CLASS}
            value={String(node.kind ?? operators[0][0])}
            disabled={disabled}
            onChange={(event) => onChange(path, predicateForOperator(field, event.target.value, node))}
          >
            {operators.map(([operator, label]) => <option key={operator} value={operator}>{label}</option>)}
          </select>
        </label>
        {hasValue ? (
          <label className="text-xs font-medium text-text-secondary">
            Value
            <input
              className={RULE_LABEL_CONTROL_CLASS}
              type={definition.kind === 'number' ? 'number' : definition.kind === 'date' ? 'date' : 'text'}
              value={Array.isArray(node.values) ? node.values.join(', ') : String(value ?? '')}
              disabled={disabled}
              onChange={(event) => {
                const raw = event.target.value;
                const nextValue = ['FIELD_IN', 'FIELD_NOT_IN'].includes(String(node.kind))
                  ? raw.split(',').map((item) => item.trim()).filter(Boolean).map((item) => definition.kind === 'number' ? Number(item) : item)
                  : definition.kind === 'number' ? Number(raw) : raw;
                onChange(path, {
                  ...node,
                  ...(Array.isArray(nextValue) ? { values: nextValue, value: undefined } : { value: nextValue }),
                });
              }}
            />
            {['FIELD_IN', 'FIELD_NOT_IN'].includes(String(node.kind)) ? (
              <span className="mt-1 block text-[11px] text-text-muted">Separate multiple values with commas.</span>
            ) : null}
          </label>
        ) : <span />}
        <div className="flex items-end justify-end">
          <Button type="button" size="xs" variant="ghost" onClick={onRemove} disabled={disabled}>
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}

function SourceEditor({
  source,
  onChange,
  disabled,
  prefix,
}: {
  source: FormNode;
  onChange: (source: FormNode) => void;
  disabled: boolean;
  prefix: string;
}) {
  const sourceKind = typeof source.kind === 'string' ? source.kind : 'COMPANY_FIELD';
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="text-xs font-medium text-text-secondary">
        Starting date
        <select
          id={`${prefix}-source`}
          className={RULE_LABEL_CONTROL_CLASS}
          value={sourceKind}
          disabled={disabled}
          onChange={(event) => {
            const kind = event.target.value;
            onChange(kind === 'COMPANY_FIELD' ? directSource() : { kind, ...(kind === 'PARAMETER' || kind === 'MILESTONE' || kind === 'SCHEDULE_ENTRY' ? { key: '' } : {}) });
          }}
        >
          {SOURCE_KINDS.map((candidate) => <option key={candidate.value} value={candidate.value}>{candidate.label}</option>)}
        </select>
      </label>
      {sourceKind === 'COMPANY_FIELD' ? (
        <label className="text-xs font-medium text-text-secondary">
          Company date
          <select
            className={RULE_LABEL_CONTROL_CLASS}
            value={typeof source.field === 'string' ? source.field : 'accountsDueDate'}
            disabled={disabled}
            onChange={(event) => onChange({ kind: 'COMPANY_FIELD', field: event.target.value })}
          >
            <option value="financialYearEnd">Financial year end</option>
            <option value="accountsDueDate">Accounts due date</option>
            <option value="incorporationDate">Incorporation date</option>
          </select>
        </label>
      ) : ['PARAMETER', 'MILESTONE', 'SCHEDULE_ENTRY'].includes(sourceKind) ? (
        <RuleFormInput
          label="Source key"
          value={typeof source.key === 'string' ? source.key : ''}
          disabled={disabled}
          onChange={(event) => onChange({ ...source, key: event.target.value })}

        />
      ) : null}
    </div>
  );
}

function ExpressionEditor({
  value,
  onChange,
  disabled,
  prefix,
}: {
  value: unknown;
  onChange: (value: FormNode) => void;
  disabled: boolean;
  prefix: string;
}) {
  const expression = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as FormNode : sourceExpression();
  const kind = typeof expression.kind === 'string' ? expression.kind : 'SOURCE';
  const source = typeof expression.source === 'object' && expression.source !== null && !Array.isArray(expression.source)
    ? expression.source as FormNode
    : directSource();
  const amount = typeof expression.amount === 'number' ? expression.amount : typeof expression.offset === 'number' ? expression.offset : 0;
  const nextExpression = (nextKind: string): FormNode => {
    if (nextKind === 'SOURCE') return sourceExpression();
    if (nextKind === 'ADJUST_BUSINESS_DAY') return { kind: nextKind, adjustment: 'PREVIOUS' };
    if (nextKind === 'RELATIVE_TO_SOURCE') return { kind: nextKind, source: directSource(), offset: 0, unit: 'CALENDAR_DAY' };
    if (nextKind === 'FIXED_DATE_FROM_SOURCE_YEAR') return { kind: nextKind, source: directSource('financialYearEnd'), yearOffset: 0, month: 1, day: 1 };
    if (nextKind === 'FIXED_DATE_IN_ASSESSMENT_YEAR') return { kind: nextKind, month: 11, day: 30 };
    if (nextKind === 'ADD_MONTHS_MONTH_END') return { kind: nextKind, source: { kind: 'OBLIGATION_PERIOD_END' }, amount: 3 };
    return { kind: nextKind, source: directSource(), amount: 0 };
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-background-tertiary px-3 py-2.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Calculation preview</p>
        <p className="mt-1 text-sm font-medium text-text-primary">Due date = {describeDeadlineExpression(expression)}</p>
      </div>
      <label className="text-xs font-medium text-text-secondary">
        Calculation
        <select
          id={`${prefix}-operation`}
          className={RULE_LABEL_CONTROL_CLASS}
          value={kind}
          disabled={disabled}
          onChange={(event) => onChange(nextExpression(event.target.value))}
        >
          {EXPRESSION_KINDS.map((candidate) => <option key={candidate.value} value={candidate.value}>{candidate.label}</option>)}
        </select>
      </label>
      {kind === 'SOURCE' ? <SourceEditor source={source} onChange={(next) => onChange({ kind: 'SOURCE', source: next })} disabled={disabled} prefix={prefix} /> : null}
      {['ADD_CALENDAR_DAYS', 'ADD_BUSINESS_DAYS', 'ADD_MONTHS', 'ADD_MONTHS_MONTH_END'].includes(kind) ? (
        <div className="space-y-3">
          <SourceEditor source={source} onChange={(next) => onChange({ ...expression, source: next })} disabled={disabled} prefix={prefix} />
          <RuleFormInput
            label={kind === 'ADD_MONTHS' || kind === 'ADD_MONTHS_MONTH_END' ? 'Months to add' : kind === 'ADD_BUSINESS_DAYS' ? 'Business days to add' : 'Calendar days to add'}
            type="number"
            value={String(amount)}
            disabled={disabled}
            onChange={(event) => onChange({ ...expression, amount: Number(event.target.value) })}

          />
        </div>
      ) : null}
      {kind === 'FIXED_DATE_FROM_SOURCE_YEAR' ? (
        <div className="space-y-3">
          <SourceEditor source={source} onChange={(next) => onChange({ ...expression, source: next })} disabled={disabled} prefix={prefix} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-text-secondary">
              Year
              <select
                className={RULE_LABEL_CONTROL_CLASS}
                value={String(typeof expression.yearOffset === 'number' ? expression.yearOffset : 0)}
                disabled={disabled}
                onChange={(event) => onChange({ ...expression, yearOffset: Number(event.target.value) })}
              >
                {[-2, -1, 0, 1, 2, 3, 4, 5]
                  .concat(typeof expression.yearOffset === 'number' && ![-2, -1, 0, 1, 2, 3, 4, 5].includes(expression.yearOffset) ? [expression.yearOffset] : [])
                  .sort((left, right) => left - right)
                  .map((offset) => (
                    <option key={offset} value={offset}>
                      {offset === 0 ? 'Same year' : offset === 1 ? 'Following year' : offset === -1 ? 'Previous year' : offset > 1 ? `${offset} years later` : `${Math.abs(offset)} years earlier`}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs font-medium text-text-secondary">
              Month
              <select
                className={RULE_LABEL_CONTROL_CLASS}
                value={String(typeof expression.month === 'number' ? expression.month : 1)}
                disabled={disabled}
                onChange={(event) => onChange({ ...expression, month: Number(event.target.value) })}
              >
                {MONTH_NAMES.map((monthName, index) => <option key={monthName} value={index + 1}>{monthName}</option>)}
              </select>
            </label>
            <RuleFormInput
              label="Day"
              type="number"
              min={1}
              max={31}
              value={String(typeof expression.day === 'number' ? expression.day : 1)}
              disabled={disabled}
              onChange={(event) => onChange({ ...expression, day: Number(event.target.value) })}
            />
          </div>
        </div>
      ) : null}
      {kind === 'FIXED_DATE_IN_ASSESSMENT_YEAR' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-text-secondary">
            Month
            <select
              className={RULE_LABEL_CONTROL_CLASS}
              value={String(typeof expression.month === 'number' ? expression.month : 11)}
              disabled={disabled}
              onChange={(event) => onChange({ ...expression, month: Number(event.target.value) })}
            >
              {MONTH_NAMES.map((monthName, index) => <option key={monthName} value={index + 1}>{monthName}</option>)}
            </select>
          </label>
          <RuleFormInput
            label="Day"
            type="number"
            min={1}
            max={31}
            value={String(typeof expression.day === 'number' ? expression.day : 30)}
            disabled={disabled}
            onChange={(event) => onChange({ ...expression, day: Number(event.target.value) })}
          />
        </div>
      ) : null}
      {kind === 'RELATIVE_TO_SOURCE' ? (
        <div className="space-y-3">
          <SourceEditor source={source} onChange={(next) => onChange({ ...expression, source: next })} disabled={disabled} prefix={prefix} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <RuleFormInput label="Offset" type="number" value={String(amount)} disabled={disabled} onChange={(event) => onChange({ ...expression, offset: Number(event.target.value) })} />
            <label className="text-xs font-medium text-text-secondary">
              Offset unit
              <select className={RULE_LABEL_CONTROL_CLASS} value={expression.unit === 'BUSINESS_DAY' ? 'BUSINESS_DAY' : 'CALENDAR_DAY'} disabled={disabled} onChange={(event) => onChange({ ...expression, unit: event.target.value })}>
                <option value="CALENDAR_DAY">Calendar days</option>
                <option value="BUSINESS_DAY">Business days</option>
              </select>
            </label>
          </div>
        </div>
      ) : null}
      {kind === 'ADJUST_BUSINESS_DAY' ? (
        <label className="text-xs font-medium text-text-secondary">
          Adjustment
          <select className={RULE_LABEL_CONTROL_CLASS} value={expression.adjustment === 'NEXT' ? 'NEXT' : 'PREVIOUS'} disabled={disabled} onChange={(event) => onChange({ ...expression, adjustment: event.target.value })}>
            <option value="PREVIOUS">Previous business day</option>
            <option value="NEXT">Next business day</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}

export interface DeadlineRuleFormProps {
  initialValue?: DeadlineRuleDto;
  onCancel: () => void;
  onSubmit: (input: DeadlineRuleDraftInput) => Promise<void>;
  onDirtyChange?: () => void;
  isSubmitting?: boolean;
  disabled?: boolean;
}

export function DeadlineRuleForm({
  initialValue,
  onCancel,
  onSubmit,
  onDirtyChange,
  isSubmitting = false,
  disabled = false,
}: DeadlineRuleFormProps) {
  const [draft, setDraft] = useState<DeadlineRuleDraftInput>(() => initialValue
    ? draftFromVersion(initialValue, initialValue.draft ?? initialValue.currentVersion)
    : emptyDraft());
  const [validationError, setValidationError] = useState<string | null>(null);
  const [applicability, setApplicability] = useState<FormNode>(() => draft.applicability as unknown as FormNode);
  const [expandedMilestones, setExpandedMilestones] = useState<Set<number>>(() => new Set([0]));
  const parameters = draft.parameters;
  const milestones = draft.milestones;
  const hasDraft = Boolean(initialValue?.draft);
  const title = initialValue ? (hasDraft ? 'Edit deadline rule' : 'Create draft from published rule') : 'Create deadline rule';

  const updateDraft = (update: (current: DeadlineRuleDraftInput) => DeadlineRuleDraftInput) => {
    setDraft((current) => update(current));
    onDirtyChange?.();
  };

  const updateApplicability = (path: number[], node: FormNode) => {
    setApplicability((current) => updateNodeAtPath(current, path, () => node));
    updateDraft((current) => ({ ...current, applicability: updateNodeAtPath(current.applicability as unknown as FormNode, path, () => node) as unknown as DeadlineRuleDraftInput['applicability'] }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const candidate = { ...draft, applicability: applicability as unknown as DeadlineRuleDraftInput['applicability'], expectedDraftRevision: initialValue?.draft?.draftRevision };
    const parsed = await import('@/lib/validations/deadline-rule').then(({ deadlineRuleDraftSchema }) => deadlineRuleDraftSchema.safeParse(candidate));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setValidationError(issue ? `${issue.message}${issue.path.length > 0 ? ` (${issue.path.join('.')})` : ''}` : 'Review the highlighted rule fields.');
      return;
    }
    setValidationError(null);
    await onSubmit(parsed.data);
  };

  const recurrenceKind = draft.recurrence.kind;
  const rootApplicability = useMemo(() => isGroup(applicability) ? applicability : initialGroup(), [applicability]);

  const toggleMilestone = (index: number) => {
    setExpandedMilestones((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const addMilestone = () => {
    const nextIndex = milestones.length;
    setExpandedMilestones((current) => new Set([...current, nextIndex]));
    updateDraft((current) => ({ ...current, milestones: [...current.milestones, emptyMilestone(current.milestones.length)] }));
  };

  return (
    <form onSubmit={handleSubmit} aria-label={title}>
      <div className="w-full max-w-[1040px] px-4 sm:px-5">
        {validationError ? (
          <div role="alert" className="mt-4 rounded-lg border border-status-error/40 bg-status-error/10 p-3 text-sm text-status-error">
            {validationError}
          </div>
        ) : null}

        <section className="space-y-3 py-4" aria-labelledby="rule-details-heading">
          <div>
            <h3 id="rule-details-heading" className="text-base font-semibold text-text-primary">Rule details</h3>
            <p className="mt-1 text-xs text-text-muted">Name the rule and define how often its cycle repeats.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <RuleFormInput label="Rule name" value={draft.name} disabled={disabled} required onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))} />
            <RuleFormInput label="Rule code" value={draft.code} disabled={disabled || Boolean(initialValue)} required onChange={(event) => updateDraft((current) => ({ ...current, code: event.target.value }))} />
          </div>
          <p className="text-[11px] text-text-muted">{initialValue ? 'Rule code is fixed after creation.' : 'Use a stable technical code, for example SG_ECI.'}</p>
          <RuleFormInput
            label="Description"
            value={draft.description ?? ''}
            disabled={disabled}
            onChange={(event) => updateDraft((current) => ({ ...current, description: event.target.value || null }))}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-text-secondary">
              Recurrence
              <select className={RULE_LABEL_CONTROL_CLASS} value={recurrenceKind} disabled={disabled} onChange={(event) => updateDraft((current) => ({ ...current, recurrence: event.target.value === 'ONE_TIME' ? { schemaVersion: 1, kind: 'ONE_TIME' } : event.target.value === 'CUSTOM' ? { schemaVersion: 1, kind: 'CUSTOM', interval: 1, unit: 'MONTH' } : { schemaVersion: 1, kind: event.target.value as 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY', interval: 1 } }))}>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="SEMI_ANNUALLY">Semi-annually</option>
                <option value="ANNUALLY">Annually</option>
                <option value="ONE_TIME">One time</option>
                <option value="CUSTOM">Custom interval</option>
              </select>
            </label>
            {recurrenceKind !== 'ONE_TIME' ? (
              <RuleFormInput label="Repeat every" type="number" min={1} max={120} value={String('interval' in draft.recurrence ? draft.recurrence.interval ?? 1 : 1)} disabled={disabled} onChange={(event) => updateDraft((current) => ({ ...current, recurrence: { ...current.recurrence, interval: Number(event.target.value) } as DeadlineRuleDraftInput['recurrence'] }))} />
            ) : (
              <div className="self-end rounded-md bg-background-tertiary px-3 py-2 text-xs text-text-muted">One-time rules create one cycle when activated.</div>
            )}
          </div>
        </section>

        <section className="space-y-3 border-t border-border-secondary py-4" aria-labelledby="applicability-heading">
          <div>
            <h3 id="applicability-heading" className="text-base font-semibold text-text-primary">Who this applies to</h3>
            <p className="mt-1 text-xs text-text-muted">Limit the rule using company attributes. Leave this empty to apply it to all eligible companies.</p>
          </div>
          <ApplicabilityNodeEditor node={rootApplicability} path={[]} onChange={updateApplicability} disabled={disabled} />
        </section>

        <section className="space-y-3 border-t border-border-secondary py-4" aria-labelledby="parameters-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="parameters-heading" className="text-base font-semibold text-text-primary">Rule variables</h3>
              <p className="mt-1 text-xs text-text-muted">Reusable values referenced by deadline calculations or service assignments.</p>
            </div>
            <Button type="button" size="xs" variant="secondary" leftIcon={<Plus className="h-3.5 w-3.5" />} disabled={disabled} onClick={() => updateDraft((current) => ({ ...current, parameters: [...current.parameters, { key: `parameter${current.parameters.length + 1}`, label: 'New variable', description: null, type: 'STRING', required: false }] }))}>
              Add variable
            </Button>
          </div>

          {parameters.length === 0 ? (
            <p className="rounded-md border border-dashed border-border-primary px-3 py-3 text-xs text-text-muted">No rule variables are configured.</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border-primary">
              {parameters.map((parameter, index) => (
                <div key={`${parameter.key}-${index}`} className="grid grid-cols-1 gap-3 border-b border-border-secondary bg-background-primary p-3 last:border-b-0 sm:grid-cols-[1fr_1fr_150px_auto]">
                  <RuleFormInput label="Display name" value={parameter.label} disabled={disabled} onChange={(event) => updateDraft((current) => ({ ...current, parameters: current.parameters.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) }))} />
                  <RuleFormInput label="Variable key" value={parameter.key} disabled={disabled} onChange={(event) => updateDraft((current) => ({ ...current, parameters: current.parameters.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item) }))} />
                  <label className="text-xs font-medium text-text-secondary">
                    Type
                    <select className={RULE_LABEL_CONTROL_CLASS} value={parameter.type} disabled={disabled} onChange={(event) => updateDraft((current) => ({ ...current, parameters: current.parameters.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as typeof item.type, ...(event.target.value === 'ENUM' ? { options: item.options ?? ['Option 1'] } : { options: undefined }) } : item) }))}>
                      <option value="STRING">String</option>
                      <option value="INTEGER">Integer</option>
                      <option value="DECIMAL">Decimal</option>
                      <option value="BOOLEAN">Boolean</option>
                      <option value="DATE">Date</option>
                      <option value="ENUM">Enum</option>
                    </select>
                  </label>
                  <div className="flex items-end gap-2">
                    <label className="flex min-h-[44px] items-center gap-2 text-xs text-text-secondary">
                      <input type="checkbox" checked={parameter.required} disabled={disabled} onChange={(event) => updateDraft((current) => ({ ...current, parameters: current.parameters.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item) }))} />
                      Required
                    </label>
                    <Button type="button" size="xs" variant="ghost" aria-label={`Remove variable ${parameter.label}`} onClick={() => updateDraft((current) => ({ ...current, parameters: current.parameters.filter((_, itemIndex) => itemIndex !== index) }))} disabled={disabled}>
                      <Trash2 className="h-4 w-4 text-status-error" />
                    </Button>
                  </div>
                  {parameter.type === 'ENUM' ? (
                    <RuleFormInput label="Allowed options (comma separated)" value={(parameter.options ?? []).join(', ')} disabled={disabled} onChange={(event) => updateDraft((current) => ({ ...current, parameters: current.parameters.map((item, itemIndex) => itemIndex === index ? { ...item, options: event.target.value.split(',').map((option) => option.trim()).filter(Boolean) } : item) }))} containerClassName="sm:col-span-3" />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3 border-t border-border-secondary py-4" aria-labelledby="milestones-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="milestones-heading" className="text-base font-semibold text-text-primary">Deadline calculation</h3>
              <p className="mt-1 text-xs text-text-muted">Define each deadline in business language, then use advanced options only when necessary.</p>
            </div>
            <Button type="button" size="xs" variant="secondary" leftIcon={<Plus className="h-3.5 w-3.5" />} disabled={disabled} onClick={addMilestone}>
              Add deadline
            </Button>
          </div>

          <div className="overflow-hidden rounded-md border border-border-primary">
            {milestones.map((milestone, index) => {
              const expanded = expandedMilestones.has(index);
              return (
                <div key={`${milestone.key}-${index}`} className="border-b border-border-secondary bg-background-primary last:border-b-0">
                  <button
                    type="button"
                    className="flex min-h-[64px] w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-background-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oak-primary/30"
                    onClick={() => toggleMilestone(index)}
                    aria-expanded={expanded}
                  >
                    {expanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-text-primary">{milestone.name}</span>
                        <span className="badge badge-neutral">{MILESTONE_TYPES.find((type) => type.value === milestone.type)?.label ?? milestone.type}</span>
                        {!milestone.isActive ? <span className="badge badge-neutral">Inactive</span> : null}
                      </span>
                      <span className="mt-1 block text-xs text-text-secondary">Due date = {describeDeadlineExpression(milestone.expression)}</span>
                      <span className="mt-0.5 block text-[11px] text-text-muted">{describeBusinessDayAdjustment(milestone.businessDayAdjustment)}</span>
                    </span>
                    <span className="text-xs font-medium text-oak-primary">{expanded ? 'Close' : 'Edit'}</span>
                  </button>

                  {expanded ? (
                    <div className="space-y-3 border-t border-border-secondary bg-background-secondary px-3 py-3 sm:px-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <RuleFormInput label="Deadline name" value={milestone.name} disabled={disabled} onChange={(event) => updateDraft((current) => ({ ...current, milestones: current.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) }))} />
                        <label className="text-xs font-medium text-text-secondary">
                          Deadline type
                          <select className={RULE_LABEL_CONTROL_CLASS} value={milestone.type} disabled={disabled} onChange={(event) => updateDraft((current) => ({ ...current, milestones: current.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as typeof item.type } : item) }))}>
                            {MILESTONE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                          </select>
                        </label>
                      </div>

                      <ExpressionEditor value={milestone.expression} onChange={(expression) => updateDraft((current) => ({ ...current, milestones: current.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, expression: asDateExpression(expression) } : item) }))} disabled={disabled} prefix={`milestone-${index}`} />

                      <label className="block text-xs font-medium text-text-secondary">
                        If the due date is not a business day
                        <select className={RULE_LABEL_CONTROL_CLASS} value={milestone.businessDayAdjustment} disabled={disabled} onChange={(event) => updateDraft((current) => ({ ...current, milestones: current.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, businessDayAdjustment: event.target.value as typeof item.businessDayAdjustment } : item) }))}>
                          <option value="NONE">Keep the calculated date</option>
                          <option value="PREVIOUS">Move to previous business day</option>
                          <option value="NEXT">Move to next business day</option>
                        </select>
                      </label>

                      <details className="rounded-md border border-border-secondary bg-background-primary">
                        <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-text-secondary">Advanced options</summary>
                        <div className="grid grid-cols-1 gap-3 border-t border-border-secondary p-3 sm:grid-cols-2">
                          <RuleFormInput label="Technical key" value={milestone.key} disabled={disabled} onChange={(event) => updateDraft((current) => ({ ...current, milestones: current.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item) }))} />
                          <label className="text-xs font-medium text-text-secondary">
                            Generation
                            <select className={RULE_LABEL_CONTROL_CLASS} value={milestone.generationMode} disabled={disabled} onChange={(event) => updateDraft((current) => ({ ...current, milestones: current.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, generationMode: event.target.value as typeof item.generationMode, expression: event.target.value === 'ONCE_PER_SCHEDULE_ENTRY' ? asDateExpression({ kind: 'SOURCE', source: { kind: 'CURRENT_SCHEDULE_ENTRY' } }) : item.expression } : item) }))}>
                              <option value="ONCE_PER_CYCLE">Once per cycle</option>
                              <option value="ONCE_PER_SCHEDULE_ENTRY">Once per schedule entry</option>
                            </select>
                          </label>
                          <label className="flex min-h-[44px] items-center gap-2 text-xs text-text-secondary">
                            <input type="checkbox" checked={milestone.isActive} disabled={disabled} onChange={(event) => updateDraft((current) => ({ ...current, milestones: current.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, isActive: event.target.checked } : item) }))} />
                            Deadline is active
                          </label>
                          {milestones.length > 1 ? (
                            <div className="flex items-center justify-end">
                              <Button type="button" size="xs" variant="ghost" className="min-h-[44px] text-status-error" disabled={disabled} onClick={() => updateDraft((current) => ({ ...current, milestones: current.milestones.filter((_, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({ ...item, displayOrder: itemIndex })) }))}>
                                Remove deadline
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </details>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-border-primary bg-background-secondary/95 px-4 py-3 backdrop-blur sm:px-5">
        <div className="flex w-full max-w-[1040px] flex-wrap items-center justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" isLoading={isSubmitting} disabled={disabled}>{initialValue ? 'Save draft' : 'Create rule'}</Button>
        </div>
      </div>
    </form>
  );
}
