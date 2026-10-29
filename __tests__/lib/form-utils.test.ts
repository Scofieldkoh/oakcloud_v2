import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORM_DRAFT_AUTO_DELETE_DAYS,
  evaluateCondition,
  isProgressStopInfoBlock,
  parseChoiceOptions,
  formatChoiceAnswer,
  parseFormDraftSettings,
  parseFormResponseReviewStatus,
  writeFormDraftSettings,
} from '@/lib/form-utils';
import { applyDefaultTodayAnswers } from '@/services/form-builder.helpers';

describe('form-utils draft settings', () => {
  it('returns defaults when draft settings are absent', () => {
    expect(parseFormDraftSettings(null)).toEqual({
      enabled: false,
      autoDeleteDays: DEFAULT_FORM_DRAFT_AUTO_DELETE_DAYS,
    });
  });

  it('parses persisted draft settings', () => {
    expect(parseFormDraftSettings({
      drafts: {
        enabled: true,
        autoDeleteDays: 30,
      },
    })).toEqual({
      enabled: true,
      autoDeleteDays: 30,
    });
  });

  it('clamps invalid auto-delete values when parsing', () => {
    expect(parseFormDraftSettings({
      drafts: {
        enabled: true,
        autoDeleteDays: 0,
      },
    })).toEqual({
      enabled: true,
      autoDeleteDays: 1,
    });
  });

  it('writes draft settings while preserving existing settings', () => {
    expect(writeFormDraftSettings(
      {
        notifications: {
          completionRecipientEmails: ['ops@example.com'],
        },
      },
      {
        enabled: true,
        autoDeleteDays: 21,
      }
    )).toEqual({
      notifications: {
        completionRecipientEmails: ['ops@example.com'],
      },
      drafts: {
        enabled: true,
        autoDeleteDays: 21,
      },
    });
  });
});

describe('form-utils condition evaluation', () => {
  it('supports legacy single field conditions', () => {
    expect(evaluateCondition(
      { fieldKey: 'status', operator: 'equals', value: 'approved' },
      { status: 'approved' }
    )).toBe(true);
  });

  it('requires every rule for grouped AND conditions', () => {
    const condition = {
      logic: 'and',
      rules: [
        { fieldKey: 'status', operator: 'equals', value: 'approved' },
        { fieldKey: 'notes', operator: 'not_empty' },
      ],
    };

    expect(evaluateCondition(condition, { status: 'approved', notes: 'ready' })).toBe(true);
    expect(evaluateCondition(condition, { status: 'approved', notes: '' })).toBe(false);
  });

  it('allows any matching rule for grouped OR conditions', () => {
    const condition = {
      logic: 'or',
      rules: [
        { fieldKey: 'status', operator: 'equals', value: 'approved' },
        { fieldKey: 'status', operator: 'equals', value: 'pending' },
      ],
    };

    expect(evaluateCondition(condition, { status: 'pending' })).toBe(true);
    expect(evaluateCondition(condition, { status: 'rejected' })).toBe(false);
  });

  it('supports visible and not visible operators from field conditions', () => {
    const fields = [
      {
        key: 'status',
        condition: null,
      },
      {
        key: 'approval_notes',
        condition: { fieldKey: 'status', operator: 'equals', value: 'approved' },
      },
      {
        key: 'rejection_reason',
        condition: { fieldKey: 'approval_notes', operator: 'is_not_visible' },
      },
    ];

    expect(evaluateCondition(
      { fieldKey: 'approval_notes', operator: 'is_visible' },
      { status: 'approved' },
      { fields }
    )).toBe(true);

    expect(evaluateCondition(
      { fieldKey: 'approval_notes', operator: 'is_not_visible' },
      { status: 'pending' },
      { fields }
    )).toBe(true);

    expect(evaluateCondition(
      { fieldKey: 'rejection_reason', operator: 'is_visible' },
      { status: 'pending' },
      { fields }
    )).toBe(true);
  });

  it('fails closed for circular visibility dependencies', () => {
    const fields = [
      {
        key: 'field_a',
        condition: { fieldKey: 'field_b', operator: 'is_visible' },
      },
      {
        key: 'field_b',
        condition: { fieldKey: 'field_a', operator: 'is_visible' },
      },
    ];

    expect(evaluateCondition(
      { fieldKey: 'field_a', operator: 'is_visible' },
      {},
      { fields }
    )).toBe(false);
  });
});

describe('form-utils progress stop info blocks', () => {
  it('detects paragraph information blocks configured to stop progress', () => {
    expect(isProgressStopInfoBlock({
      type: 'PARAGRAPH',
      validation: { infoStopsProgress: true },
    })).toBe(true);
  });

  it('ignores non-paragraph fields and inactive settings', () => {
    expect(isProgressStopInfoBlock({
      type: 'SHORT_TEXT',
      validation: { infoStopsProgress: true },
    })).toBe(false);
    expect(isProgressStopInfoBlock({
      type: 'PARAGRAPH',
      validation: { infoStopsProgress: false },
    })).toBe(false);
  });
});

describe('form-utils response review status', () => {
  it('parses valid response review statuses from metadata', () => {
    expect(parseFormResponseReviewStatus({ responseReviewStatus: 'reviewed' })).toBe('reviewed');
    expect(parseFormResponseReviewStatus({ responseReviewStatus: 'needs_follow_up' })).toBe('needs_follow_up');
  });

  it('defaults invalid or absent response review statuses to new', () => {
    expect(parseFormResponseReviewStatus(null)).toBe('new');
    expect(parseFormResponseReviewStatus({ responseReviewStatus: 'done' })).toBe('new');
  });
});

describe('form choice options', () => {
  it('parses default and required option metadata', () => {
    expect(parseChoiceOptions([
      { label: 'A', value: 'A', defaultSelected: true },
      { label: 'B', value: 'B', requiredSelected: true },
    ])).toMatchObject([
      { label: 'A', value: 'A', defaultSelected: true, requiredSelected: false },
      { label: 'B', value: 'B', defaultSelected: false, requiredSelected: true },
    ]);
  });

  it('applies single-choice defaults and keeps required multi-choice options selected', () => {
    const fields = [
      {
        key: 'single',
        type: 'SINGLE_CHOICE',
        options: [
          { label: 'Yes', value: 'Yes', defaultSelected: true },
          { label: 'No', value: 'No' },
        ],
      },
      {
        key: 'multi',
        type: 'MULTIPLE_CHOICE',
        options: [
          { label: 'Required', value: 'Required', requiredSelected: true },
          { label: 'Optional', value: 'Optional' },
        ],
      },
    ];

    expect(applyDefaultTodayAnswers(fields as never, { multi: ['Optional'] })).toEqual({
      single: 'Yes',
      multi: ['Optional', 'Required'],
    });
  });

  it('parses and formats nested choice answers', () => {
    const [parent] = parseChoiceOptions([
      {
        label: 'Parent',
        value: 'Parent',
        childOptions: [
          { label: 'Child', value: 'Child', requiredSelected: true },
        ],
        childSelectionMode: 'single',
      },
    ]);

    expect(parent.childSelectionMode).toBe('single');
    expect(parent.childOptions).toMatchObject([
      { label: 'Child', value: 'Child', requiredSelected: true },
    ]);
    expect(formatChoiceAnswer([{ value: 'Parent', children: ['Child'] }])).toBe('Parent (Child)');
  });
});
