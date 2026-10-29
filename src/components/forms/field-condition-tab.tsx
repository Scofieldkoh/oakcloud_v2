'use client';

import { useState } from 'react';
import { ChevronDown, Plus, Trash2, X } from 'lucide-react';
import { FormInput } from '@/components/ui/form-input';
import { describeCondition } from './builder-analysis';
import type { BuilderField, ConditionConfig, ConditionGroupConfig, FieldConditionConfig } from './builder-utils';

const CONDITION_OPERATORS: Array<{ value: ConditionConfig['operator']; label: string }> = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'is_empty', label: 'Is empty' },
  { value: 'not_empty', label: 'Is not empty' },
  { value: 'is_visible', label: 'Is visible' },
  { value: 'is_not_visible', label: 'Is not visible' },
];

function isConditionGroup(condition: FieldConditionConfig | null): condition is ConditionGroupConfig {
  return !!condition && 'rules' in condition;
}

function isConditionRule(condition: FieldConditionConfig | null): condition is ConditionConfig {
  return !!condition && !isConditionGroup(condition);
}

function getGroups(condition: FieldConditionConfig | null): ConditionGroupConfig[] {
  if (!condition) return [];
  if (isConditionRule(condition)) return [{ logic: 'and', rules: [condition] }];
  if (condition.logic === 'or' && condition.rules.some(isConditionGroup)) {
    return condition.rules.map((rule) => (
      isConditionGroup(rule) ? rule : { logic: 'and', rules: [rule] }
    ));
  }
  return [condition];
}

function toCondition(groups: ConditionGroupConfig[]): FieldConditionConfig | null {
  const normalizedGroups = groups
    .map((group) => ({
      logic: group.logic,
      rules: group.rules.filter(isConditionRule),
    }))
    .filter((group) => group.rules.length > 0);

  if (normalizedGroups.length === 0) return null;
  if (normalizedGroups.length === 1) {
    const [group] = normalizedGroups;
    if (group.rules.length === 1) return group.rules[0];
    return group;
  }
  return { logic: 'or', rules: normalizedGroups };
}

function createRule(fieldKey = ''): ConditionConfig {
  return {
    fieldKey,
    operator: 'equals',
    value: '',
  };
}

function getGroupSummary(rules: ConditionConfig[], logic: ConditionGroupConfig['logic']): string {
  const count = rules.length;
  const conditionText = `${count} condition${count === 1 ? '' : 's'}`;
  return `${logic === 'or' ? 'Any' : 'All'} of ${conditionText}`;
}

export function FieldConditionTab({
  field,
  allFields,
  conditionalCandidates,
  onChange,
}: {
  field: BuilderField;
  allFields: BuilderField[];
  conditionalCandidates: BuilderField[];
  onChange: (next: BuilderField) => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(() => new Set());
  const groups = getGroups(field.condition);
  const firstCandidateKey = conditionalCandidates[0]?.key || '';
  const conditionSummary = describeCondition(field.condition, allFields);

  function updateCondition(nextGroups: ConditionGroupConfig[]) {
    onChange({
      ...field,
      condition: toCondition(nextGroups),
    });
  }

  function updateGroup(groupIndex: number, updater: (group: ConditionGroupConfig) => ConditionGroupConfig) {
    updateCondition(groups.map((group, index) => (index === groupIndex ? updater(group) : group)));
  }

  function updateRule(groupIndex: number, ruleIndex: number, updater: (rule: ConditionConfig) => ConditionConfig) {
    updateGroup(groupIndex, (group) => ({
      ...group,
      rules: group.rules.map((rule, index) => (
        index === ruleIndex && isConditionRule(rule) ? updater(rule) : rule
      )),
    }));
  }

  function addGroup() {
    updateCondition([...groups, { logic: 'and', rules: [createRule(firstCandidateKey)] }]);
  }

  function toggleGroup(groupIndex: number) {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(groupIndex)) {
        next.delete(groupIndex);
      } else {
        next.add(groupIndex);
      }
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {groups.length === 0 ? (
        <button
          type="button"
          onClick={() => updateCondition([{ logic: 'and', rules: [createRule(firstCandidateKey)] }])}
          disabled={!firstCandidateKey}
          className="inline-flex items-center gap-2 rounded-md border border-border-primary bg-background-primary px-3 py-2 text-sm font-medium text-text-primary hover:bg-background-tertiary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add condition group
        </button>
      ) : (
        <>
          <div className="rounded-lg border border-border-primary bg-background-primary p-3">
            <div className="text-2xs font-semibold uppercase tracking-widest text-text-muted">Shown when</div>
            <div className="mt-1 text-sm text-text-primary">{conditionSummary}</div>
          </div>

          {groups.length > 1 && (
            <p className="rounded-lg border border-border-primary bg-background-elevated p-3 text-xs text-text-secondary">
              Field is shown when any condition group matches. Each group can match all or any of its own conditions.
            </p>
          )}

          <div className="space-y-4">
            {groups.map((group, groupIndex) => {
              const rules = group.rules.filter(isConditionRule);
              const isCollapsed = collapsedGroups.has(groupIndex);

              return (
                <div key={groupIndex} className="space-y-3 rounded-lg border border-border-primary bg-background-elevated p-3">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => toggleGroup(groupIndex)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded p-1 text-left hover:bg-background-tertiary"
                      aria-expanded={!isCollapsed}
                      aria-controls={`condition-group-${groupIndex}`}
                    >
                      <ChevronDown className={`h-4 w-4 shrink-0 text-text-secondary transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-text-primary">Group {groupIndex + 1}</span>
                        <span className="block truncate text-2xs text-text-muted">{getGroupSummary(rules, group.logic)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateCondition(groups.filter((_, index) => index !== groupIndex))}
                      className="rounded p-1.5 text-text-secondary hover:bg-background-tertiary hover:text-text-primary"
                      aria-label={`Remove group ${groupIndex + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {!isCollapsed && (
                    <div id={`condition-group-${groupIndex}`} className="space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-text-secondary">Match inside group</label>
                    <div className="inline-flex rounded-md border border-border-primary bg-background-primary p-0.5">
                      {[
                        { value: 'and' as const, label: 'All conditions' },
                        { value: 'or' as const, label: 'Any condition' },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => updateGroup(groupIndex, (current) => ({ ...current, logic: option.value }))}
                          className={`rounded px-3 py-1.5 text-xs font-medium ${
                            group.logic === option.value
                              ? 'bg-oak-primary text-white'
                              : 'text-text-secondary hover:bg-background-tertiary hover:text-text-primary'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                {rules.map((rule, ruleIndex) => (
                  <div key={ruleIndex} className="space-y-3 rounded-lg border border-border-primary bg-background-primary p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-medium text-text-secondary">Condition {ruleIndex + 1}</div>
                      <button
                        type="button"
                        onClick={() => updateGroup(groupIndex, (current) => ({
                          ...current,
                          rules: current.rules.filter((_, index) => index !== ruleIndex),
                        }))}
                        className="rounded p-1.5 text-text-secondary hover:bg-background-tertiary hover:text-text-primary"
                        aria-label={`Remove condition ${ruleIndex + 1} from group ${groupIndex + 1}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div>
                    <label className="mb-1.5 block text-xs font-medium text-text-secondary">Field</label>
                  <select
                    value={rule.fieldKey}
                    onChange={(e) => updateRule(groupIndex, ruleIndex, (current) => ({ ...current, fieldKey: e.target.value }))}
                    className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
                  >
                    <option value="">Select field</option>
                    {conditionalCandidates.map((candidate) => (
                      <option key={candidate.clientId} value={candidate.key}>
                        {candidate.label ? `${candidate.label} [${candidate.key}]` : candidate.key}
                      </option>
                    ))}
                  </select>
                  {rule.fieldKey && (
                    <p className="mt-1 text-2xs text-text-muted font-mono">
                      [{rule.fieldKey}]
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">Operator</label>
                  <select
                    value={rule.operator}
                    onChange={(e) => updateRule(groupIndex, ruleIndex, (current) => ({
                      ...current,
                      operator: e.target.value as ConditionConfig['operator'],
                      value: ['is_empty', 'not_empty', 'is_visible', 'is_not_visible'].includes(e.target.value)
                        ? undefined
                        : current.value,
                    }))}
                    className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
                  >
                    {CONDITION_OPERATORS.map((operator) => (
                      <option key={operator.value} value={operator.value}>{operator.label}</option>
                    ))}
                  </select>
                </div>

                {!['is_empty', 'not_empty', 'is_visible', 'is_not_visible'].includes(rule.operator) && (
                  <FormInput
                    label="Conditional value"
                    value={String(rule.value ?? '')}
                    onChange={(e) => updateRule(groupIndex, ruleIndex, (current) => ({
                      ...current,
                      value: e.target.value,
                    }))}
                  />
                )}
              </div>
                ))}

                <button
                  type="button"
                  onClick={() => updateGroup(groupIndex, (current) => ({
                    ...current,
                    rules: [...rules, createRule(firstCandidateKey)],
                  }))}
                  disabled={!firstCandidateKey}
                  className="inline-flex items-center gap-2 rounded-md border border-border-primary bg-background-primary px-3 py-2 text-sm font-medium text-text-primary hover:bg-background-tertiary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  Add condition
                </button>
                    </div>
                  )}
              </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={addGroup}
            disabled={!firstCandidateKey}
            className="inline-flex items-center gap-2 rounded-md border border-border-primary bg-background-primary px-3 py-2 text-sm font-medium text-text-primary hover:bg-background-tertiary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add condition group
          </button>
        </>
      )}
    </div>
  );
}
