import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessAssistantRunDto } from '@/lib/validations/business-assistant';

const hooks = vi.hoisted(() => ({
  useAssistantRun: vi.fn(),
  useAssistantAction: vi.fn(),
  refetch: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock('@/hooks/use-business-assistant', () => ({
  useAssistantRun: hooks.useAssistantRun,
  useAssistantAction: hooks.useAssistantAction,
}));

vi.mock('@/components/business-assistant/correction-panel', () => ({
  BizFileCorrectionPanel: () => <div>Correction panel</div>,
}));

import { AssistantRunCard } from '@/components/business-assistant/run-card';

const timestamp = '2026-09-17T00:00:00.000Z';

function readRun(overrides: Partial<BusinessAssistantRunDto> = {}): BusinessAssistantRunDto {
  return {
    id: 'run-read',
    conversationId: 'conversation-1',
    capabilityId: 'workspace.resource_lookup',
    capabilityVersion: '1.0',
    contractVersion: '1',
    schemaVersion: '1',
    status: 'COMPLETED',
    resources: [{ resourceType: 'company', resourceId: 'company-1', role: 'context' }],
    items: [{
      id: 'item-read-1',
      itemKey: 'workspace.resource_lookup',
      ordinal: 0,
      lifecycleState: 'SUCCEEDED',
      executionOutcome: 'SUCCEEDED_READ',
      reviewOutcome: 'NOT_REQUIRED',
      requiredEffectStatus: 'NOT_REQUIRED',
      dispositionReason: null,
      operationId: null,
      output: {
        query: 'Example Company',
        observedAt: timestamp,
        resources: [{ resourceType: 'company', resourceId: 'company-1', title: 'Example Company', role: 'context', data: { status: 'LIVE' } }],
      },
      receipt: null,
      presentation: null,
      reviews: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    proposal: null,
    aggregate: { status: 'COMPLETED', counts: { total: 1, successful: 1 } },
    cancellationRequestedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
    allowedActions: [],
    ...overrides,
  };
}

function writeRun(overrides: Partial<BusinessAssistantRunDto> = {}): BusinessAssistantRunDto {
  return {
    id: 'run-write',
    conversationId: 'conversation-1',
    capabilityId: 'bizfile.import_and_review',
    capabilityVersion: '1.0',
    contractVersion: '1',
    schemaVersion: '1',
    status: 'WAITING_CONFIRMATION',
    resources: [{ resourceType: 'document', resourceId: 'document-1', role: 'source' }],
    items: [{
      id: 'item-write-1',
      itemKey: 'Example Company',
      ordinal: 0,
      lifecycleState: 'WAITING_CONFIRMATION',
      executionOutcome: 'NOT_STARTED',
      reviewOutcome: 'NOT_STARTED',
      requiredEffectStatus: 'PENDING',
      dispositionReason: null,
      operationId: null,
      output: null,
      receipt: null,
      presentation: null,
      reviews: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    proposal: {
      id: 'proposal-1',
      revision: 1,
      status: 'ACTIVE',
      preparedArtifact: { companyName: { before: 'Example Company', after: 'Example Company Limited' } },
      preparedHash: 'test-only-hash',
      eligibleItems: ['item-write-1'],
      eligibleBindings: [{ itemId: 'item-write-1', itemKey: 'Example Company', preparedHash: 'item-hash' }],
      effectManifest: [{ description: 'Refresh the company document' }],
      presentation: { sections: [{ id: 'company-name', title: 'Company name', kind: 'TEXT', value: 'Example Company Limited' }] },
      expiresAt: '2099-09-17T00:00:00.000Z',
      createdAt: timestamp,
    },
    aggregate: { status: 'WAITING_CONFIRMATION', counts: { total: 1, waiting: 1 } },
    cancellationRequestedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    allowedActions: ['CONFIRM', 'CANCEL'],
    ...overrides,
  };
}

function show(run: BusinessAssistantRunDto) {
  hooks.useAssistantRun.mockReturnValue({ data: run, error: null, refetch: hooks.refetch });
  return render(<AssistantRunCard workspaceId="workspace-1" runId={run.id} />);
}

describe('AssistantRunCard conversational read results', () => {
  beforeEach(() => {
    hooks.useAssistantRun.mockReset();
    hooks.useAssistantAction.mockReset();
    hooks.refetch.mockReset();
    hooks.mutate.mockReset();
    hooks.useAssistantAction.mockReturnValue({ mutate: hooks.mutate, isPending: false, error: null });
  });

  it('renders a successful ordinary read as a compact collapsed disclosure', () => {
    show(readRun());

    const disclosure = screen.getByRole('button', { name: /Sources and details.*1 read result/i });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: /Sources and details/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Business operation')).not.toBeInTheDocument();
  });

  it('does not duplicate the normal Olaf answer while the technical disclosure is collapsed', () => {
    show(readRun({
      capabilityId: 'assistant.answer',
      resources: [],
      items: [{ ...readRun().items[0], itemKey: 'assistant.answer', output: { kind: 'ANSWER', content: 'This belongs in the Olaf conversation message.', observedAt: timestamp } }],
    }));

    expect(screen.getByRole('button', { name: /Sources and details/i })).toBeVisible();
    expect(screen.queryByText('This belongs in the Olaf conversation message.')).not.toBeInTheDocument();
  });

  it('expands the technical result and read metadata on demand', async () => {
    const user = userEvent.setup();
    show(readRun());

    await user.click(screen.getByRole('button', { name: /Sources and details/i }));

    expect(screen.getByRole('region', { name: /Sources and details/i })).toBeVisible();
    expect(screen.getByText('Read-only')).toBeVisible();
    expect(screen.getByText('Completed')).toBeVisible();
    expect(screen.getByText(timestamp)).toBeVisible();
  });

  it('exposes authorized source records inside the expanded disclosure', async () => {
    const user = userEvent.setup();
    show(readRun());

    await user.click(screen.getByRole('button', { name: /Sources and details/i }));

    expect(screen.getByRole('region', { name: /Sources and details/i })).toHaveTextContent('Records used');
    expect(screen.getByText(/Context · Company · company-1/)).toBeVisible();
  });

  it('keeps proposal-based writes on the full operational card', () => {
    show(writeRun());

    expect(screen.getByLabelText('Business operation')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Sources and details/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Revision 1/)).toBeVisible();
    expect(screen.getByText('Follow-up work included in this approval')).toBeVisible();
  });

  it('keeps BizFile approval controls explicit', () => {
    show(writeRun());

    expect(screen.getByLabelText('Select Example Company')).toBeVisible();
    expect(screen.getByLabelText('I have reviewed the selected items and their follow-up work.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve 0 selected items' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel remaining work' })).toBeVisible();
  });

  it('keeps review findings visible on the full card', () => {
    const item = writeRun().items[0];
    show(writeRun({
      status: 'COMPLETED_WITH_EXCEPTIONS',
      aggregate: { status: 'COMPLETED_WITH_EXCEPTIONS', counts: { total: 1, needsReview: 1 } },
      proposal: null,
      completedAt: timestamp,
      allowedActions: ['RETRY'],
      items: [{
        ...item,
        lifecycleState: 'NEEDS_REVIEW',
        executionOutcome: 'COMMITTED',
        reviewOutcome: 'NEEDS_REVIEW',
        requiredEffectStatus: 'COMPLETE',
        operationId: 'operation-1',
        output: { companyId: 'company-1' },
        receipt: { operationId: 'operation-1', status: 'COMMITTED' },
        reviews: [{
          id: 'review-1', attemptNumber: 1, verdict: 'NEEDS_REVIEW', executionConformance: 'FAIL', sourceAlignment: 'DIFFERENCES_PRESENT',
          evidence: { page: 1 }, findings: [{ code: 'SELECTED_FIELD_MISMATCH', explanation: 'Company name differs.' }], coverage: { complete: true },
          schemaVersion: '1', promptVersion: '1', providerVersion: 'test', createdAt: timestamp,
        }],
      }],
    }));

    expect(screen.getByLabelText('Business operation')).toBeVisible();
    expect(screen.getByText('Review 1 · Needs review')).toBeVisible();
    expect(screen.getByText('Company name differs.')).toBeVisible();
  });

  it('keeps outcome-unknown reconciliation prominent', () => {
    const item = readRun().items[0];
    show(readRun({
      status: 'RECOVERING',
      aggregate: { status: 'RECOVERING', counts: { total: 1, recovering: 1 } },
      completedAt: null,
      allowedActions: ['CANCEL', 'RETRY'],
      items: [{ ...item, lifecycleState: 'RECOVERING', executionOutcome: 'OUTCOME_UNKNOWN', reviewOutcome: 'NOT_STARTED', requiredEffectStatus: 'PENDING', dispositionReason: 'RECONCILIATION_REQUIRED' }],
    }));

    expect(screen.getByLabelText('Business operation')).toBeVisible();
    expect(screen.getByText('The outcome is being reconciled. Do not submit a replacement operation.')).toBeVisible();
  });

  it('keeps a failed read on the full operational card', () => {
    const item = readRun().items[0];
    show(readRun({
      status: 'FAILED',
      aggregate: { status: 'FAILED', counts: { total: 1, failed: 1 } },
      completedAt: timestamp,
      allowedActions: ['RETRY'],
      items: [{ ...item, lifecycleState: 'FAILED', executionOutcome: 'NOT_STARTED', dispositionReason: 'STAGE_ATTEMPTS_EXHAUSTED' }],
    }));

    expect(screen.getByLabelText('Business operation')).toBeVisible();
    expect(screen.getByText('Stage attempts exhausted')).toBeVisible();
  });

  it('keeps a recovering read on the full operational card even before its outcome is known', () => {
    const item = readRun().items[0];
    show(readRun({
      status: 'RECOVERING',
      aggregate: { status: 'RECOVERING', counts: { total: 1, recovering: 1 } },
      completedAt: null,
      allowedActions: ['CANCEL', 'RETRY'],
      items: [{ ...item, lifecycleState: 'RECOVERING', executionOutcome: 'NOT_STARTED' }],
    }));

    expect(screen.getByLabelText('Business operation')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Recovering');
  });

  it('presents multiple clean read items as one sensible compact disclosure', async () => {
    const user = userEvent.setup();
    const first = readRun().items[0];
    show(readRun({
      items: [
        { ...first, id: 'item-read-1', itemKey: 'company.identity', output: { observedAt: timestamp, name: 'Example Company' } },
        { ...first, id: 'item-read-2', itemKey: 'company.officers', ordinal: 1, output: { observedAt: timestamp, officers: ['Alex Tan'] } },
      ],
      aggregate: { status: 'COMPLETED', counts: { total: 2, successful: 2 } },
    }));

    const disclosure = screen.getByRole('button', { name: /Sources and details.*2 read results/i });
    await user.click(disclosure);

    expect(screen.getByRole('region', { name: /Sources and details/i })).toBeVisible();
    expect(screen.getByRole('region', { name: /Read result 1/i })).toHaveTextContent('Company identity');
    expect(screen.getByRole('region', { name: /Read result 2/i })).toHaveTextContent('Company officers');
  });

  it('supports keyboard disclosure control with explicit expanded state and region relationship', async () => {
    const user = userEvent.setup();
    show(readRun());
    const disclosure = screen.getByRole('button', { name: /Sources and details/i });

    disclosure.focus();
    expect(disclosure).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    const region = screen.getByRole('region', { name: /Sources and details/i });
    expect(region).toBeVisible();
    expect(disclosure.getAttribute('aria-controls')).toBe(region.id);
  });

  it('fails closed to the full card when a successful read output contains a warning signal', () => {
    const item = readRun().items[0];
    show(readRun({ items: [{ ...item, output: { observedAt: timestamp, warnings: ['Source data is incomplete.'] } }] }));

    expect(screen.getByLabelText('Business operation')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Sources and details/i })).not.toBeInTheDocument();
  });

  it('keeps a completed canonical write and its receipt on the full card', () => {
    const item = writeRun().items[0];
    show(writeRun({
      status: 'COMPLETED',
      aggregate: { status: 'COMPLETED', counts: { total: 1, successful: 1 } },
      proposal: null,
      completedAt: timestamp,
      allowedActions: [],
      items: [{ ...item, lifecycleState: 'SUCCEEDED', executionOutcome: 'COMMITTED', reviewOutcome: 'NOT_REQUIRED', requiredEffectStatus: 'COMPLETE', operationId: 'operation-1', receipt: { operationId: 'operation-1', status: 'COMMITTED' }, output: { companyId: 'company-1' } }],
    }));

    expect(screen.getByLabelText('Business operation')).toBeVisible();
    expect(screen.getByText('Recorded operation')).toBeVisible();
  });

  it('retains the existing accessible loading state', () => {
    hooks.useAssistantRun.mockReturnValue({ data: undefined, error: null, refetch: hooks.refetch });
    render(<AssistantRunCard workspaceId="workspace-1" runId="run-loading" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading operation');
  });

  it('retains the existing error alert and reload action', () => {
    hooks.useAssistantRun.mockReturnValue({ data: undefined, error: new Error('Unable to load this operation.'), refetch: hooks.refetch });
    render(<AssistantRunCard workspaceId="workspace-1" runId="run-error" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load this operation.');
    fireEvent.click(screen.getByRole('button', { name: 'Reload operation' }));
    expect(hooks.refetch).toHaveBeenCalledOnce();
  });
});
