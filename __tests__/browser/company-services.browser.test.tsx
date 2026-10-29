import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyServicesTab } from '@/components/companies/company-detail/company-services-tab';
import '@/app/globals.css';

const service = {
  id: 'service-1', companyId: 'company-1', agreementId: 'agreement-1', agreementItemId: 'item-1', serviceVariantId: 'variant-1', familyName: 'Corporate Services', serviceName: 'Corporate Secretarial Services', status: 'ACTIVE', billingDisposition: 'CONFIGURED', serviceCadence: 'ANNUALLY', customCadenceLabel: null, startDate: '2026-07-30', endDate: null, fieldValues: { filingMonth: 'July' }, createdAt: '2026-07-30T00:00:00Z', updatedAt: '2026-07-30T00:00:00Z', feeLines: [{ id: 'fee-1', description: 'Annual fee', amount: '500.00', currency: 'SGD', billingFrequency: 'ANNUALLY', customFrequencyLabel: null, billingStartDate: '2026-07-30', displayOrder: 0 }], agreement: { title: 'Service Agreement', status: 'EFFECTIVE', activationStatus: 'COMPLETED', generatedDocumentId: 'document-1', href: '/generated-documents/document-1' },
};
const manualService = {
  ...service,
  id: 'service-manual',
  serviceName: 'Advisory Retainer',
  source: 'MANUAL',
  agreementId: null,
  agreementItemId: null,
  agreement: null,
};
const fixture = { services: [manualService, service], total: 2, activations: [{ agreementId: 'agreement-2', title: 'Retry agreement', activationStatus: 'FAILED_RETRYABLE', activationLastError: 'Activation temporarily unavailable.', canRetry: true }] };
const refreshedService = { ...service, serviceName: 'Server-updated service', updatedAt: '2026-08-01T01:00:00.000Z' };
const catalogOptions = {
  variants: [{
    id: 'variant-1',
    name: 'Corporate Secretarial',
    family: { id: 'family-1', name: 'Corporate Services' },
    serviceCadence: 'ANNUALLY',
    customCadenceLabel: null,
    fields: [],
    feeTemplates: [{
      description: 'Annual service fee',
      defaultAmount: '1200.00',
      currency: 'SGD',
      billingFrequency: 'ANNUALLY',
      customFrequencyLabel: null,
      displayOrder: 0,
    }],
  }],
};

async function waitUntil(check: () => boolean, timeout = 4000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error('Timed out waiting for Services UI');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function setControlValue(control: HTMLInputElement | HTMLSelectElement, value: string, eventType = 'input') {
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value);
  control.dispatchEvent(new Event(eventType, { bubbles: true }));
}

describe('company Services browser workflow', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let requests: Array<{ url: string; method: string; body?: unknown }>;
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  beforeAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = true; });
  afterAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; });
  beforeEach(() => {
    host = document.createElement('div');
    document.body.replaceChildren(host);
    root = createRoot(host);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    requests = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, method, body });
      if (method === 'GET' && url.includes('/api/client-services/service-1')) return json(refreshedService);
      if (method === 'GET' && url.includes('/services/catalog-options')) return json(catalogOptions);
      if (method === 'GET' && url.includes('/services/company-obligations')) {
        return json({ items: [], notices: [], firstPeriodUnconfirmed: false, firstPeriodSuggestion: null, statusEditable: false, engagementStartYearOfAssessment: null, firstYearOfAssessment: null });
      }
      if (method === 'GET') return json(fixture);
      if (method === 'PATCH') {
        if ((body as { expectedUpdatedAt?: string } | undefined)?.expectedUpdatedAt === service.updatedAt) {
          return json({ error: 'This service was updated by someone else.' }, 409);
        }
        if ((body as { expectedUpdatedAt?: string } | undefined)?.expectedUpdatedAt === refreshedService.updatedAt) {
          return json({ ...refreshedService, ...body, updatedAt: '2026-08-01T02:00:00.000Z' });
        }
        return json({ error: 'Unexpected concurrency token' }, 500);
      }
      if (method === 'DELETE') return json({ id: service.id, archived: true });
      if (method === 'POST' && url.includes('/services')) return json({ ...manualService, feeLines: [] }, 201);
      if (method === 'POST') return json({ agreementId: 'agreement-2', activationStatus: 'PENDING' });
      return json({ error: 'Unexpected request' }, 500);
    }));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    vi.unstubAllGlobals();
    host.remove();
  });

  it('edits all fee fields, recovers from conflict, confirms archive, and retries through HTTP hooks', async () => {
    await act(async () => root.render(<QueryClientProvider client={queryClient}><CompanyServicesTab companyId="company-1" canEdit /></QueryClientProvider>));
    await waitUntil(() => host.textContent?.includes('Corporate Secretarial Services') ?? false);
    const agreementCard = [...host.querySelectorAll<HTMLElement>('article')].find((article) => article.textContent?.includes('Corporate Secretarial Services'));
    const edit = agreementCard?.querySelector<HTMLButtonElement>('button[aria-label="Edit service"]');
    if (!edit) throw new Error('Edit service button missing');
    await act(async () => edit.click());

    const currency = document.querySelector<HTMLInputElement>('input[aria-label="Fee 1 currency"]');
    const billingDate = document.querySelector<HTMLInputElement>('input[aria-label="Fee 1 billing start date"]');
    const frequency = document.querySelector<HTMLSelectElement>('select[aria-label="Fee 1 frequency"]');
    if (!currency || !billingDate || !frequency) throw new Error('Fee controls missing');
    await act(async () => {
      setControlValue(currency, 'USD');
      setControlValue(billingDate, '2026-08-01', 'change');
      setControlValue(frequency, 'CUSTOM', 'change');
    });
    const custom = document.querySelector<HTMLInputElement>('input[aria-label="Fee 1 custom interval months"]');
    if (!custom) throw new Error('Custom interval control missing');
    await act(async () => setControlValue(custom, '18'));

    const save = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Save changes'));
    if (!save) throw new Error('Save button missing');
    await act(async () => save.click());
    await waitUntil(() => document.body.textContent?.includes('updated by someone else') ?? false);
    expect(document.body.textContent).toContain('Edit service');
    const reload = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Reload latest service'));
    if (!reload) throw new Error('Reload latest service button missing');
    await act(async () => reload.click());
    await waitUntil(() => document.querySelector<HTMLInputElement>('#client-service-name')?.value === refreshedService.serviceName);
    await act(async () => save.click());
    await waitUntil(() => !document.body.textContent?.includes('Edit service'));
    const patches = requests.filter((request) => request.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(patches[0]?.body).toMatchObject({ expectedUpdatedAt: service.updatedAt });
    expect(patches[1]?.body).toMatchObject({ expectedUpdatedAt: refreshedService.updatedAt });

    const refreshedCard = [...host.querySelectorAll<HTMLElement>('article')].find((article) => article.textContent?.includes('Corporate Secretarial Services'));
    const editAgain = refreshedCard?.querySelector<HTMLButtonElement>('button[aria-label="Edit service"]');
    if (!editAgain) throw new Error('Edit service button missing after save');
    await act(async () => editAgain.click());
    const archive = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Archive service');
    if (!archive) throw new Error('Archive button missing');
    await act(async () => archive.click());
    const archiveDialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1);
    const cancel = [...(archiveDialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((button) => button.textContent === 'Cancel');
    if (!cancel) throw new Error('Archive cancel button missing');
    await act(async () => cancel.click());
    expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
    await act(async () => archive.click());
    const reason = document.querySelector<HTMLInputElement>('input[placeholder="Explain why this service is being archived"]');
    if (!reason) throw new Error('Archive reason missing');
    await act(async () => setControlValue(reason, 'Client ended the engagement'));
    const confirmDialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1);
    const confirmArchive = [...(confirmDialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((button) => button.textContent === 'Archive service');
    if (!confirmArchive) throw new Error('Archive confirmation missing');
    await act(async () => confirmArchive.click());
    await waitUntil(() => requests.some((request) => request.method === 'DELETE'));
    expect(requests.find((request) => request.method === 'DELETE')?.body).toEqual({ reason: 'Client ended the engagement' });

    const retry = host.querySelector<HTMLButtonElement>('button[aria-label="Retry activation"]');
    if (!retry) throw new Error('Retry button missing');
    await act(async () => retry.click());
    await waitUntil(() => requests.some((request) => request.method === 'POST'));
    expect(requests.find((request) => request.method === 'POST')?.url).toContain('/retry-activation');
  });

  it('adds a manual service, preserves list state, and opens the created DTO directly', async () => {
    await act(async () => root.render(<QueryClientProvider client={queryClient}><CompanyServicesTab companyId="company-1" canEdit /></QueryClientProvider>));
    await waitUntil(() => host.textContent?.includes('Advisory Retainer') ?? false);
    expect(host.textContent).toContain('Added manually');
    expect(host.querySelector('a[href="/generated-documents/document-1"]')).not.toBeNull();
    expect([...host.querySelectorAll('button')].some((button) => button.textContent === 'Manual')).toBe(false);

    const add = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Add service');
    if (!add) throw new Error('Add service button missing');
    await act(async () => add.click());
    const trigger = document.querySelector<HTMLInputElement>('input[placeholder="Select service"]');
    if (!trigger) throw new Error('Catalog trigger missing');
    await act(async () => { trigger.focus(); trigger.click(); });
    await waitUntil(() => Boolean(document.querySelector('[data-searchable-select-popover]')));
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((entry) => entry.textContent?.includes('Corporate Secretarial'));
    if (!option) throw new Error('Catalog option missing');
    await act(async () => option.click());
    const startDate = document.querySelector<HTMLInputElement>('#client-service-start-date');
    if (!startDate) throw new Error('Start date control missing');
    await act(async () => setControlValue(startDate, '2026-08-01', 'change'));

    const create = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.textContent === 'Add service').at(-1);
    if (!create) throw new Error('Create button missing');
    await act(async () => create.click());
    await waitUntil(() => document.body.textContent?.includes('View service') ?? false);
    const view = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'View service');
    if (!view) throw new Error('View service button missing');
    await act(async () => view.click());
    await waitUntil(() => document.body.textContent?.includes('Edit service') ?? false);
    const serviceName = document.querySelector<HTMLInputElement>('#client-service-name');
    expect(serviceName?.value).toBe('Advisory Retainer');
    expect(requests.some((request) => request.method === 'POST' && request.url.includes('/services'))).toBe(true);
  });
});
