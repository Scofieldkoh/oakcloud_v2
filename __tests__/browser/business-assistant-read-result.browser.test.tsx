import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { page, userEvent } from 'vitest/browser';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { AssistantReadResultDetails } from '@/components/business-assistant/read-result-details';
import type { BusinessAssistantRunDto } from '@/lib/validations/business-assistant';
import '@/app/globals.css';

const timestamp = '2026-09-17T00:00:00.000Z';
const run: BusinessAssistantRunDto = {
  id: 'run-read-browser',
  conversationId: 'conversation-1',
  capabilityId: 'company.profile_read',
  capabilityVersion: '1.0',
  contractVersion: '1',
  schemaVersion: '1',
  status: 'COMPLETED',
  resources: [{ resourceType: 'company', resourceId: 'company-with-a-long-resource-identifier-123456789', role: 'target' }],
  items: [{
    id: 'item-read-1',
    itemKey: 'company.profile',
    ordinal: 0,
    lifecycleState: 'SUCCEEDED',
    executionOutcome: 'SUCCEEDED_READ',
    reviewOutcome: 'NOT_REQUIRED',
    requiredEffectStatus: 'NOT_REQUIRED',
    dispositionReason: null,
    operationId: null,
    output: {
      observedAt: timestamp,
      company: {
        name: 'Example Company With A Deliberately Long Name Pte. Ltd.',
        registeredAddress: '123 Example Street, #12-34, Singapore 123456',
      },
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
};

describe('Business Assistant conversational read result', () => {
  beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
  afterAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false; });
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.replaceChildren(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps the collapsed disclosure and expanded evidence usable at narrow width', async () => {
    await page.viewport(390, 844);
    await act(async () => root.render(<AssistantReadResultDetails run={run} />));

    const disclosure = screen.getByRole('button', { name: /Sources and details.*1 read result/i });
    await expect.element(disclosure).toBeVisible();
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    await act(async () => userEvent.click(disclosure));

    await expect.element(screen.getByRole('region', { name: /Sources and details/i })).toBeVisible();
    await expect.element(screen.getByText('Example Company With A Deliberately Long Name Pte. Ltd.')).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await page.screenshot();
  });
});
