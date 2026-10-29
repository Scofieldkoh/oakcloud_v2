import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { page, userEvent } from 'vitest/browser';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { BusinessAssistantWorkspace } from '@/components/business-assistant/workspace';
import { BizFilePlanReview } from '@/components/companies/bizfile-review/bizfile-plan-review';
import type { BizFileChangePlan } from '@/services/bizfile/change-plan';
import '@/app/globals.css';

const timestamp = '2026-09-07T02:00:00.000Z';
const capability = { id: 'workspace.lookup', version: '1.0.0', title: 'Find workspace information', description: 'Find company records you can access.', executionKind: 'READ_ONLY', riskLevel: 'READ_ONLY', confirmationPolicy: 'NONE', reviewPolicy: 'NONE', requiredPermissions: ['company:read'] };
const summary = { id: 'conversation-1', workspaceId: 'workspace-1', ownerId: 'user-1', title: 'Company review', status: 'ACTIVE', createdAt: timestamp, updatedAt: timestamp, capabilities: [capability] };
const run = {
  id: 'run-1', conversationId: summary.id, capabilityId: 'example.update', capabilityVersion: '1.0.0', contractVersion: '1', schemaVersion: '1', status: 'WAITING_CONFIRMATION', resources: [],
  items: [{ id: 'item-1', itemKey: 'Example Company', ordinal: 0, lifecycleState: 'WAITING_CONFIRMATION', executionOutcome: 'NOT_STARTED', reviewOutcome: 'NOT_STARTED', requiredEffectStatus: 'PENDING', createdAt: timestamp, updatedAt: timestamp }],
  proposal: { id: 'proposal-1', revision: 1, status: 'ACTIVE', preparedHash: 'test-only-hash', eligibleItems: ['item-1'], expiresAt: '2099-09-07T03:00:00.000Z', createdAt: timestamp,
    preparedArtifact: { companyName: { before: 'Example Company', after: 'Example Company Limited' } },
    presentation: { sections: [{ id: 'company', title: 'Company name', kind: 'CHANGES', value: { before: 'Example Company', after: 'Example Company Limited' } }] }, effectManifest: [{ description: 'Refresh the company document' }] },
  aggregate: { status: 'WAITING_CONFIRMATION', counts: { total: 1, selected: 0 } }, createdAt: timestamp, updatedAt: timestamp, allowedActions: ['CONFIRM', 'CANCEL'],
};

describe('Business Assistant workspace', () => {
  beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
  afterAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false; });
  let root: Root;
  let host: HTMLDivElement;
  let client: QueryClient;
  let requests: Array<{ path: string; body: Record<string, unknown> }>;
  let failTurn: boolean;
  let detail: Record<string, unknown>;

  beforeEach(() => {
    requests = []; failTurn = false;
    detail = { ...summary, messages: [], runs: [] };
    host = document.createElement('div'); document.body.replaceChildren(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, window.location.origin);
      const path = url.pathname;
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)); requests.push({ path, body });
        if (path.endsWith('/turns')) {
          if (failTurn) return Response.json({ error: 'Connection interrupted. Retry the same request.' }, { status: 503 });
          detail = { ...summary, messages: [{ id: 'message-1', sequence: 1, role: 'ASSISTANT', type: 'ANSWER', status: 'PROCESSED', content: '<img src=x onerror=alert(1)> [Open](javascript:alert(1))', createdAt: timestamp }], runs: [] };
          return Response.json({ type: 'accepted', conversationId: summary.id, messageId: 'message-1' });
        }
        return Response.json({ success: true });
      }
      if (path.endsWith('/conversations')) return Response.json({ conversations: [summary], capabilities: [capability], enabled: true, mutationsEnabled: true });
      if (path.endsWith(`/conversations/${summary.id}`)) return Response.json({ conversation: detail });
      if (path.endsWith('/runs/run-1')) return Response.json({ run });
      if (path.endsWith('/resources')) return Response.json({ resources: [{ resourceType: 'company', resourceId: 'company-1', title: 'Example Company', role: 'context' }] });
      if (path.endsWith('/memories')) return Response.json({ memories: [] });
      if (path.endsWith('/learning-changes')) return Response.json({ changes: [] });
      return Response.json({ error: 'Unexpected test request' }, { status: 404 });
    }));
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  async function mount() {
    await act(async () => root.render(<QueryClientProvider client={client}><BusinessAssistantWorkspace workspaceId="workspace-1" firstName="Alex" /></QueryClientProvider>));
    await act(async () => { await expect.poll(() => client.isFetching()).toBe(0); });
  }
  async function click(element: HTMLElement) {
    await act(async () => userEvent.click(element));
    await act(async () => { await expect.poll(() => client.isFetching()).toBe(0); });
  }
  async function fill(element: HTMLElement, value: string) { await act(async () => userEvent.fill(element, value)); }

  it('discovers general capabilities, attaches records, and renders untrusted content as text', async () => {
    await page.viewport(1440, 900); await mount();
    await expect.element(screen.getByRole('heading', { name: 'Business Assistant' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: /Find workspace information/ })).toBeVisible();
    await click(screen.getByRole('button', { name: 'Attach' }));
    await expect.element(screen.getByRole('menuitem', { name: 'Upload BizFile' })).toBeVisible();
    await click(screen.getByRole('menuitem', { name: 'Choose workspace record' }));
    await expect.element(screen.getByRole('button', { name: /Example Company/ })).toBeVisible();
    await click(screen.getByRole('button', { name: /Example Company/ }));
    await click(screen.getByRole('button', { name: 'Close' }));
    await fill(screen.getByLabelText('Message Olaf'), 'Find this company');
    await click(screen.getByRole('button', { name: 'Send' }));
    await expect.element(screen.getByText('<img src=x onerror=alert(1)> [Open](javascript:alert(1))')).toBeVisible();
    expect(requests[0].body.resources).toEqual([{ resourceType: 'company', resourceId: 'company-1', role: 'context' }]);
    expect(host.querySelector('img')).toBeNull(); expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await page.screenshot();
  });

  it('opens the direct BizFile upload experience inside Olaf', async () => {
    await page.viewport(1440, 900); await mount();
    await click(screen.getByRole('button', { name: 'Attach' }));
    await click(screen.getByRole('menuitem', { name: 'Upload BizFile' }));
    await expect.element(screen.getByRole('heading', { name: 'Upload BizFile to Olaf' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Choose BizFile' })).toBeVisible();
    await expect.element(screen.getByText('PDF, PNG, JPG, or WebP. Maximum file size 10 MB.')).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await page.screenshot();
  });

  it('keeps one request identity when retrying an uncertain submission', async () => {
    await mount(); await expect.element(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await fill(screen.getByLabelText('Message Olaf'), 'Find this company'); failTurn = true;
    await click(screen.getByRole('button', { name: 'Send' }));
    await expect.element(screen.getByText('Connection interrupted. Retry the same request.')).toBeVisible();
    failTurn = false; await click(screen.getByRole('button', { name: 'Send' }));
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[0].body.clientRequestId).toBe(requests[1].body.clientRequestId);
  });

  it('requires readable evidence, an explicit subset, and review before approving the exact revision', async () => {
    detail = { ...summary, messages: [], runs: [{ id: run.id, capabilityId: run.capabilityId, capabilityVersion: run.capabilityVersion, status: run.status, updatedAt: timestamp }] };
    await page.viewport(1440, 900); await mount();
    await click(screen.getByRole('button', { name: 'Company review' }));
    await expect.element(screen.getByRole('button', { name: 'Approve 0 selected items' })).toBeDisabled();
    await expect.element(screen.getByText('Example Company Limited')).toBeVisible();
    await click(screen.getByLabelText('Select Example Company'));
    await expect.element(screen.getByRole('button', { name: 'Approve 1 selected item' })).toBeDisabled();
    await click(screen.getByLabelText('I have reviewed the selected items and their follow-up work.'));
    await click(screen.getByRole('button', { name: 'Approve 1 selected item' }));
    expect(requests[0]).toMatchObject({ path: '/api/business-assistant/runs/run-1/actions', body: { action: 'CONFIRM', proposalId: 'proposal-1', revision: 1, itemIds: ['item-1'] } });
  });

  it('keeps mobile navigation and the composer usable without horizontal overflow', async () => {
    await page.viewport(390, 844); await mount();
    await expect.element(screen.getByRole('button', { name: 'History' })).toBeVisible();
    await click(screen.getByRole('button', { name: 'History' }));
    await expect.element(screen.getByRole('button', { name: 'Company review' })).toBeVisible();
    await click(screen.getByRole('button', { name: 'New chat' }));
    await fill(screen.getByLabelText('Message Olaf'), 'Help me plan my work');
    await expect.element(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await page.screenshot();
  });

  it('requires a fresh prepared BizFile plan after changing the selected fields', async () => {
    const plan: BizFileChangePlan = {
      schemaVersion: 1, mode: 'UPDATE', tenantId: 'workspace-1', documentId: 'document-1', targetCompanyId: 'company-1',
      aggregateRevision: 'aggregate', expectedAggregateRevision: 1, baseline: { company: { name: 'Example Company' } },
      reviewedData: { entityDetails: { uen: '202600001A', name: 'Example Company Limited', entityType: 'PRIVATE_COMPANY_LIMITED_BY_SHARES', status: 'LIVE' } },
      changes: [{ id: 'name-change', path: 'name', section: 'identity', operation: 'SET', before: 'Example Company', after: 'Example Company Limited' }],
      selectedChangeIds: ['name-change'], contactDecisions: {}, canonicalHash: 'exact-plan',
    };
    const approve = vi.fn(); const revise = vi.fn();
    await page.viewport(1440, 900);
    await act(async () => root.render(<BizFilePlanReview plan={plan} busy={false} onClose={() => {}} onApprove={approve} onRevise={revise} />));
    await expect.element(screen.getByRole('button', { name: 'Confirm & Save 1 Change' })).toBeDisabled();
    await click(screen.getByLabelText('I have reviewed these changes and contact decisions.'));
    await expect.element(screen.getByRole('button', { name: 'Confirm & Save 1 Change' })).toBeEnabled();
    await click(screen.getByRole('checkbox', { name: /Name Set/i }));
    expect(screen.queryByRole('button', { name: /Confirm & Save/ })).toBeNull();
    await click(screen.getByRole('button', { name: 'Update proposal' }));
    expect(revise).toHaveBeenCalledWith([]); expect(approve).not.toHaveBeenCalled();
    await page.screenshot();
  });
});
