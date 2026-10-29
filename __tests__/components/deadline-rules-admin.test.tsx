import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  useDeadlineRules: vi.fn(),
  useDeadlineRule: vi.fn(),
  useCreateDeadlineRule: vi.fn(),
  useUpdateDeadlineRule: vi.fn(),
  usePreviewDeadlineRuleImpact: vi.fn(),
  usePublishDeadlineRule: vi.fn(),
  useArchiveDeadlineRule: vi.fn(),
  useApplyDeadlineRulePreset: vi.fn(),
}));

vi.mock('@/hooks/use-deadline-rules', () => hooks);

import { DeadlineRulesPanel } from '@/components/services/admin/deadline-rules-panel';
import { DeadlineRuleForm } from '@/components/services/admin/deadline-rule-form';
import { deadlineRuleDraftSchema } from '@/lib/validations/deadline-rule';

const rule = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  code: 'ANNUAL_RETURN',
  name: 'Annual Return',
  description: 'Annual return cycle',
  isActive: true,
  archivedAt: null,
  archivedById: null,
  archiveReason: null,
  currentVersionId: '33333333-3333-4333-8333-333333333333',
  currentVersion: {
    id: '33333333-3333-4333-8333-333333333333',
    ruleId: '11111111-1111-4111-8111-111111111111',
    version: 4,
    state: 'PUBLISHED' as const,
    schemaVersion: 1,
    recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
    applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
    configHash: 'a'.repeat(64),
    draftRevision: 3,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    publishedById: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    parameters: [],
    milestones: [{
      id: '44444444-4444-4444-8444-444444444444',
      key: 'annual-return-due',
      name: 'Annual return due',
      description: null,
      type: 'STATUTORY' as const,
      generationMode: 'ONCE_PER_CYCLE' as const,
      expression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
      businessDayAdjustment: 'NONE' as const,
      displayOrder: 0,
      isActive: true,
    }],
  },
  draft: {
    id: '55555555-5555-4555-8555-555555555555',
    ruleId: '11111111-1111-4111-8111-111111111111',
    version: 0,
    state: 'DRAFT' as const,
    schemaVersion: 1,
    recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
    applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
    configHash: 'b'.repeat(64),
    draftRevision: 4,
    publishedAt: null,
    publishedById: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    parameters: [],
    milestones: [{
      id: '66666666-6666-4666-8666-666666666666',
      key: 'annual-return-due',
      name: 'Annual return due',
      description: null,
      type: 'STATUTORY' as const,
      generationMode: 'ONCE_PER_CYCLE' as const,
      expression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
      businessDayAdjustment: 'NONE' as const,
      displayOrder: 0,
      isActive: true,
    }],
  },
  versions: [],
  variantAssociations: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const mutation = () => ({ mutateAsync: vi.fn(), isPending: false, error: null });

describe('DeadlineRulesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.useDeadlineRules.mockReturnValue({
      data: { rules: [rule], total: 1, page: 1, limit: 20 },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    hooks.useDeadlineRule.mockReturnValue({ data: rule, isLoading: false, error: null, refetch: vi.fn().mockResolvedValue({ data: rule }) });
    hooks.useCreateDeadlineRule.mockReturnValue(mutation());
    hooks.useUpdateDeadlineRule.mockReturnValue(mutation());
    hooks.usePreviewDeadlineRuleImpact.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        ruleId: rule.id,
        operation: 'PUBLISH',
        currentPublishedVersion: 4,
        draftRevision: 4,
        draftConfigHash: 'b'.repeat(64),
        previewFingerprint: 'c'.repeat(64),
        counts: {
          created: 0,
          recalculated: 2,
          cancelled: 0,
          preserved: 4,
          inapplicable: 0,
          missingInput: 0,
          conflicts: 0,
          warnings: 0,
        },
        samples: [],
        sourceState: {
          currentVersionId: rule.currentVersionId,
          draftId: rule.draft!.id,
          draftState: 'DRAFT',
          isActive: true,
          archivedAt: null,
        },
      }),
      isPending: false,
      error: null,
    });
    hooks.usePublishDeadlineRule.mockReturnValue(mutation());
    hooks.useArchiveDeadlineRule.mockReturnValue(mutation());
    hooks.useApplyDeadlineRulePreset.mockReturnValue(mutation());
  });

  it('renders a searchable rule list and current published version history', () => {
    render(<DeadlineRulesPanel workspaceId="22222222-2222-4222-8222-222222222222" />);

    expect(screen.getByRole('heading', { name: 'Deadline rules' })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Search deadline rules' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Annual ReturnDraft/ })).toBeVisible();
    expect(screen.getByText('No published versions yet.')).toBeVisible();
    expect(screen.getByText('Revision history')).toBeVisible();
  });

  it('adds a reviewed IRAS rule as a draft from the header action', async () => {
    const applyPreset = { ...mutation(), mutateAsync: vi.fn().mockResolvedValue({ ...rule, code: 'SG_ECI', name: 'Estimated Chargeable Income (ECI)' }) };
    hooks.useApplyDeadlineRulePreset.mockReturnValue(applyPreset);
    render(<DeadlineRulesPanel workspaceId="22222222-2222-4222-8222-222222222222" />);

    fireEvent.click(screen.getByRole('button', { name: 'Add IRAS rule' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Estimated Chargeable Income (ECI)' }));

    await waitFor(() => expect(applyPreset.mutateAsync).toHaveBeenCalledWith({ code: 'SG_ECI' }));
  });

  it('adds a reviewed ACRA rule as a draft from its own header action', async () => {
    const applyPreset = { ...mutation(), mutateAsync: vi.fn().mockResolvedValue({ ...rule, code: 'SG_AGM_DUE', name: 'Annual general meeting (AGM)' }) };
    hooks.useApplyDeadlineRulePreset.mockReturnValue(applyPreset);
    render(<DeadlineRulesPanel workspaceId="22222222-2222-4222-8222-222222222222" />);

    fireEvent.click(screen.getByRole('button', { name: 'Add ACRA rule' }));
    expect(screen.getByRole('menuitem', { name: 'Annual return (AR)' })).toBeVisible();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Annual general meeting (AGM)' }));

    await waitFor(() => expect(applyPreset.mutateAsync).toHaveBeenCalledWith({ code: 'SG_AGM_DUE' }));
  });

  it('requires a current impact preview before publishing', async () => {
    render(<DeadlineRulesPanel workspaceId="22222222-2222-4222-8222-222222222222" />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Annual Return' }));
    const publish = screen.getByRole('button', { name: 'Publish changes' });
    expect(publish).toBeDisabled();

    const previewButton = screen.getByRole('button', { name: 'Preview impact' });
    fireEvent.click(previewButton);
    const mutationResult = hooks.usePreviewDeadlineRuleImpact.mock.results[0]?.value;
    await waitFor(() => expect(mutationResult?.mutateAsync).toHaveBeenCalled());
    expect(screen.getByText('Date changes')).toBeVisible();
    expect(publish).toBeEnabled();
  });

  it('invalidates the preview gate when a draft field changes', async () => {
    render(<DeadlineRulesPanel workspaceId="22222222-2222-4222-8222-222222222222" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Annual Return' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview impact' }));
    const publish = screen.getByRole('button', { name: 'Publish changes' });
    await waitFor(() => expect(screen.getByText('Date changes')).toBeVisible());
    expect(publish).toBeEnabled();

    fireEvent.change(screen.getByLabelText('Rule name'), {
      target: { value: 'Annual Return revised' },
    });
    await waitFor(() => expect(publish).toBeDisabled());
  });

  it('completes publish from the impact dialog confirmation', async () => {
    const previewMutation = {
      mutateAsync: vi.fn().mockImplementation(({ input }: { input: { operation: string } }) => Promise.resolve({
        ruleId: rule.id,
        operation: input.operation,
        currentPublishedVersion: 4,
        draftRevision: 4,
        draftConfigHash: 'b'.repeat(64),
        previewFingerprint: 'c'.repeat(64),
        counts: { created: 0, recalculated: 2, cancelled: 0, preserved: 4, inapplicable: 0, missingInput: 0, conflicts: 0, warnings: 0 },
        samples: [],
        sourceState: { currentVersionId: rule.currentVersionId, draftId: rule.draft!.id, draftState: 'DRAFT', isActive: true, archivedAt: null },
      })),
      isPending: false,
      error: null,
    };
    const publishMutation = mutation();
    hooks.usePreviewDeadlineRuleImpact.mockReturnValue(previewMutation);
    hooks.usePublishDeadlineRule.mockReturnValue(publishMutation);

    render(<DeadlineRulesPanel workspaceId="22222222-2222-4222-8222-222222222222" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview impact' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publish impact preview' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish changes' }));

    await waitFor(() => expect(publishMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: rule.id,
      input: expect.objectContaining({ operation: 'PUBLISH', previewFingerprint: 'c'.repeat(64) }),
    })));
  });

  it('completes archive from impact confirmation through the reason dialog', async () => {
    const previewMutation = {
      mutateAsync: vi.fn().mockImplementation(({ input }: { input: { operation: string } }) => Promise.resolve({
        ruleId: rule.id,
        operation: input.operation,
        currentPublishedVersion: 4,
        draftRevision: 4,
        draftConfigHash: 'b'.repeat(64),
        previewFingerprint: 'd'.repeat(64),
        counts: { created: 0, recalculated: 0, cancelled: 1, preserved: 3, inapplicable: 0, missingInput: 0, conflicts: 0, warnings: 0 },
        samples: [],
        sourceState: { currentVersionId: rule.currentVersionId, draftId: rule.draft!.id, draftState: 'DRAFT', isActive: true, archivedAt: null },
      })),
      isPending: false,
      error: null,
    };
    const archiveMutation = mutation();
    hooks.usePreviewDeadlineRuleImpact.mockReturnValue(previewMutation);
    hooks.useArchiveDeadlineRule.mockReturnValue(archiveMutation);

    render(<DeadlineRulesPanel workspaceId="22222222-2222-4222-8222-222222222222" />);
    fireEvent.click(screen.getByRole('button', { name: 'More rule actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive rule' }));
    const impactDialog = await screen.findByRole('dialog', { name: 'Archive impact preview' });
    fireEvent.click(within(impactDialog).getByRole('button', { name: 'Continue to archive' }));
    const reasonDialog = await screen.findByRole('dialog', { name: 'Archive deadline rule' });
    fireEvent.change(within(reasonDialog).getByLabelText('Archive reason'), { target: { value: 'Retired after policy migration' } });
    fireEvent.click(within(reasonDialog).getByRole('button', { name: 'Archive rule' }));

    await waitFor(() => expect(archiveMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: rule.id,
      input: expect.objectContaining({ operation: 'ARCHIVE', previewFingerprint: 'd'.repeat(64), reason: 'Retired after policy migration' }),
    })));
  });

  it('requires save before preview and publishes the saved draft identity', async () => {
    const savedRule = {
      ...rule,
      name: 'Annual Return revised',
      draft: { ...rule.draft!, draftRevision: 9, configHash: 'e'.repeat(64) },
    };
    const publishedVersion = {
      ...rule.currentVersion!,
      id: '77777777-7777-4777-8777-777777777777',
      version: 5,
      configHash: 'h'.repeat(64),
      draftRevision: 10,
    };
    const publishedRule = {
      ...savedRule,
      currentVersionId: publishedVersion.id,
      currentVersion: publishedVersion,
      draft: { ...savedRule.draft!, draftRevision: 10, configHash: 'g'.repeat(64) },
      versions: [publishedVersion],
    };
    const updateMutation = { ...mutation(), mutateAsync: vi.fn().mockResolvedValue(savedRule) };
    const previewMutation = {
      mutateAsync: vi.fn().mockImplementation(({ input }: { input: { operation: string; draftConfigHash: string; expectedCurrentVersion: number | null; expectedDraftRevision: number } }) => Promise.resolve({
        ruleId: rule.id,
        operation: input.operation,
        currentPublishedVersion: input.expectedCurrentVersion,
        draftRevision: input.expectedDraftRevision,
        draftConfigHash: input.draftConfigHash,
        previewFingerprint: 'f'.repeat(64),
        counts: { created: 0, recalculated: 1, cancelled: 0, preserved: 1, inapplicable: 0, missingInput: 0, conflicts: 0, warnings: 0 },
        samples: [],
        sourceState: { currentVersionId: rule.currentVersionId, draftId: rule.draft!.id, draftState: 'DRAFT', isActive: true, archivedAt: null },
      })),
      isPending: false,
      error: null,
    };
    const publishMutation = mutation();
    publishMutation.mutateAsync.mockResolvedValue(publishedRule);
    hooks.useUpdateDeadlineRule.mockReturnValue(updateMutation);
    hooks.usePreviewDeadlineRuleImpact.mockReturnValue(previewMutation);
    hooks.usePublishDeadlineRule.mockReturnValue(publishMutation);

    render(<DeadlineRulesPanel workspaceId="22222222-2222-4222-8222-222222222222" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Annual Return' }));
    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'Annual Return revised' } });
    expect(screen.getByRole('button', { name: 'Preview impact' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(updateMutation.mutateAsync).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Preview impact' }));
    await waitFor(() => expect(previewMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: rule.id,
      input: expect.objectContaining({ expectedDraftRevision: 9, draftConfigHash: 'e'.repeat(64) }),
    })));
    const dialog = await screen.findByRole('dialog', { name: 'Publish impact preview' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish changes' }));
    await waitFor(() => expect(publishMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: rule.id,
      input: expect.objectContaining({ expectedDraftRevision: 9, draftConfigHash: 'e'.repeat(64), previewFingerprint: 'f'.repeat(64) }),
    })));
    await waitFor(() => expect(screen.getByText(/^Published v5 · /)).toBeVisible());
    expect(screen.getByText('Published version 5')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Preview impact' }));
    await waitFor(() => expect(previewMutation.mutateAsync).toHaveBeenCalledTimes(2));
    expect(previewMutation.mutateAsync.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      id: rule.id,
      input: expect.objectContaining({ expectedCurrentVersion: 5, expectedDraftRevision: 10, draftConfigHash: 'g'.repeat(64) }),
    }));
  });

  it('refreshes authoritative archive state for a subsequent preview', async () => {
    const archivedRule = {
      ...rule,
      isActive: false,
      archivedAt: new Date('2026-02-01T00:00:00.000Z'),
      archivedById: 'user-2',
      archiveReason: 'Retired after policy migration',
      draft: { ...rule.draft!, draftRevision: 5, configHash: 'd'.repeat(64) },
    };
    const previewMutation = {
      mutateAsync: vi.fn().mockImplementation(({ input }: { input: { operation: string; draftConfigHash: string; expectedDraftRevision: number } }) => Promise.resolve({
        ruleId: rule.id,
        operation: input.operation,
        currentPublishedVersion: 4,
        draftRevision: input.expectedDraftRevision,
        draftConfigHash: input.draftConfigHash,
        previewFingerprint: 'd'.repeat(64),
        counts: { created: 0, recalculated: 0, cancelled: 1, preserved: 3, inapplicable: 0, missingInput: 0, conflicts: 0, warnings: 0 },
        samples: [],
        sourceState: { currentVersionId: rule.currentVersionId, draftId: rule.draft!.id, draftState: 'DRAFT', isActive: true, archivedAt: null },
      })),
      isPending: false,
      error: null,
    };
    const archiveMutation = mutation();
    archiveMutation.mutateAsync.mockResolvedValue(archivedRule);
    hooks.usePreviewDeadlineRuleImpact.mockReturnValue(previewMutation);
    hooks.useArchiveDeadlineRule.mockReturnValue(archiveMutation);

    render(<DeadlineRulesPanel workspaceId="22222222-2222-4222-8222-222222222222" />);
    fireEvent.click(screen.getByRole('button', { name: 'More rule actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive rule' }));
    const impactDialog = await screen.findByRole('dialog', { name: 'Archive impact preview' });
    fireEvent.click(within(impactDialog).getByRole('button', { name: 'Continue to archive' }));
    const reasonDialog = await screen.findByRole('dialog', { name: 'Archive deadline rule' });
    fireEvent.change(within(reasonDialog).getByLabelText('Archive reason'), { target: { value: 'Retired after policy migration' } });
    fireEvent.click(within(reasonDialog).getByRole('button', { name: 'Archive rule' }));

    await waitFor(() => expect(archiveMutation.mutateAsync).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('Archived')[0]).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'More rule actions' }));
    // An archived rule cannot be archived again; the next preview uses the refreshed draft.
    expect(screen.getByRole('menuitem', { name: 'Archive rule' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview impact' }));
    await waitFor(() => expect(previewMutation.mutateAsync).toHaveBeenCalledTimes(2));
    expect(previewMutation.mutateAsync.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      id: rule.id,
      input: expect.objectContaining({ expectedDraftRevision: 5, draftConfigHash: 'd'.repeat(64) }),
    }));
  });

  it('keeps nested applicability groups schema-valid through operator transitions', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<DeadlineRuleForm initialValue={rule} onCancel={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    const fields = screen.getAllByLabelText('Company field');
    fireEvent.change(fields[0], { target: { value: 'status' } });
    fireEvent.change(screen.getAllByLabelText('Operator')[0], { target: { value: 'FIELD_PRESENT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add condition group' }));
    const groups = screen.getAllByLabelText('Group');
    fireEvent.change(groups[1], { target: { value: 'ANY' } });
    const addConditions = screen.getAllByRole('button', { name: 'Add condition' });
    fireEvent.click(addConditions[0]);
    const nestedFields = screen.getAllByLabelText('Company field');
    fireEvent.change(nestedFields[1], { target: { value: 'accountsDueDate' } });
    fireEvent.change(screen.getAllByLabelText('Operator')[1], { target: { value: 'FIELD_COMPARE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(deadlineRuleDraftSchema.safeParse(onSubmit.mock.calls[0][0]).success).toBe(true);
  });
});
