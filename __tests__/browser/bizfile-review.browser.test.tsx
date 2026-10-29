import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { page, userEvent } from 'vitest/browser';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { BizFileReviewWorkspace } from '@/components/companies/bizfile-review/bizfile-review-workspace';
import type { ExtractedBizFileData } from '@/services/bizfile';
import '@/app/globals.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CompanyCreateSharePointField } from '@/components/companies/company-create-sharepoint-field';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/hooks/use-connectors', () => ({ useConnectors: () => ({ data: { connectors: [{ id: 'connector-1', workspaceId: 'workspace-1' }] } }) }));
vi.mock('@/hooks/use-sharepoint-folders', () => ({ useSharePointFilingSettings: () => ({ data: { clientDocumentsRoot: { id: 'root', name: 'Client Documents' } } }) }));
vi.mock('@/components/connectors/sharepoint/sharepoint-folder-picker', () => ({ SharePointFolderPicker: () => null }));

const fixture: ExtractedBizFileData = {
  entityDetails: {
    uen: '202400001A',
    name: 'Example Pte. Ltd.',
    entityType: 'PRIVATE_LIMITED',
    status: 'LIVE',
  },
  registeredAddress: { streetName: 'Oak Street', postalCode: '123456' },
  ssicActivities: {
    primary: { code: '62011', description: 'Software development' },
  },
  paidUpCapital: { amount: 1000, currency: 'SGD' },
  issuedCapital: { amount: 1000, currency: 'SGD' },
  officers: [{ name: 'Alex Tan', role: 'DIRECTOR' }],
  shareholders: [{ name: 'Jamie Lim', type: 'INDIVIDUAL', shareClass: 'ORDINARY', numberOfShares: 1000 }],
  auditor: { name: 'Audit LLP' },
  financialYear: { endDay: 31, endMonth: 12 },
  charges: [{ chargeNumber: 'C1', chargeHolderName: 'Oak Bank' }],
  documentMetadata: { receiptNo: 'ACRA123' },
};

describe('BizFileReviewWorkspace responsive workflow', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    router.push.mockClear();
    host = document.createElement('div');
    host.style.height = '100vh';
    host.style.width = '100%';
    document.body.replaceChildren(host);
    root = createRoot(host);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ matches: {} }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(onConfirm = vi.fn()) {
    await act(async () => {
      root.render(
        <BizFileReviewWorkspace
          initialData={fixture}
          sharePointSetup={<QueryClientProvider client={new QueryClient()}><CompanyCreateSharePointField onChange={vi.fn()} /></QueryClientProvider>}
          sourcePanel={<div aria-label="Source document">BizFile source viewer</div>}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
          onReset={vi.fn()}
        />,
      );
    });
    return onConfirm;
  }

  async function click(element: HTMLElement) {
    await act(async () => userEvent.click(element));
  }

  it.each([1440, 390])('keeps the company folder in Entity details at %s pixels', async (width) => {
    await page.viewport(width, 900);
    await mount();
    const folder = screen.getByRole('region', { name: 'Company folder' });
    expect(folder.closest('#review-section-panel')).not.toBeNull();
    expect(screen.queryByText(/A failure here will not roll back/)).toBeNull();
    await click(screen.getByRole('button', { name: 'New folder' }));
    await fill(screen.getByLabelText('Folder name'), 'Example company');
    await click(screen.getByRole('button', { name: 'Use new folder' }));
    await expect.element(screen.getByText('Example company')).toBeVisible();
    if (width > 1000) {
      await click(screen.getByRole('tab', { name: /^Addresses,/ }));
      await expect.element(folder).not.toBeVisible();
      await click(screen.getByRole('tab', { name: /^Entity,/ }));
    } else {
      await act(async () => userEvent.selectOptions(screen.getByRole('combobox', { name: 'Review section' }), 'addresses'));
      await expect.element(folder).not.toBeVisible();
      await act(async () => userEvent.selectOptions(screen.getByRole('combobox', { name: 'Review section' }), 'entity'));
    }
    await expect.element(screen.getByText('Example company')).toBeVisible();
    folder.scrollIntoView();
  });

  async function fill(element: HTMLElement, value: string) {
    await act(async () => userEvent.fill(element, value));
  }

  async function makeDirty() {
    await fill(screen.getByLabelText('Company name'), 'Changed Pte. Ltd.');
  }

  function applicationLink(attributes: Record<string, string> = {}) {
    const anchor = document.createElement('a');
    anchor.href = '/companies';
    anchor.textContent = 'Application link';
    for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value);
    host.append(anchor);
    return anchor;
  }

  it('keeps source and editor together while correcting and confirming on desktop', async () => {
    await page.viewport(1440, 900);
    const onConfirm = await mount();

    await expect.element(screen.getByTestId('desktop-split')).toBeVisible();
    await expect.element(screen.getByLabelText('Source document')).toBeVisible();
    expect(screen.getAllByRole('tab', { hidden: true }).filter((tab) => tab.closest('[aria-label="Review sections"]'))).toHaveLength(10);
    const sourceBox = screen.getByTestId('review-source').getBoundingClientRect();
    const editorBox = screen.getByTestId('review-editor').getBoundingClientRect();
    expect(Math.abs(sourceBox.height - editorBox.height)).toBeLessThanOrEqual(1);
    expect(sourceBox.height).toBeLessThanOrEqual(window.innerHeight);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
    expect(screen.queryByText(/AI-extracted data may be inaccurate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/10 sections/i)).not.toBeInTheDocument();
    await page.screenshot({ path: '__screenshots__/bizfile-review-desktop-1440x900.png' });
    const name = screen.getByLabelText('Company name');
    await fill(name, 'Corrected Pte. Ltd.');

    await click(screen.getByRole('tab', { name: /Officers,/ }));
    await click(screen.getByRole('button', { name: /Next section/ }));
    await expect.element(screen.getByRole('tab', { name: /Shareholders,/ })).toHaveAttribute('aria-selected', 'true');
    await click(screen.getByRole('button', { name: /Previous section/ }));
    await expect.element(screen.getByRole('tab', { name: /Officers,/ })).toHaveAttribute('aria-selected', 'true');
    await click(screen.getByRole('button', { name: 'Add Officers' }));
    expect(screen.getAllByLabelText('Name')).toHaveLength(2);
    await click(screen.getByRole('button', { name: 'Remove Officer 2' }));
    expect(screen.getAllByLabelText('Name')).toHaveLength(1);

    await click(screen.getByRole('tab', { name: /Entity,/ }));
    const returnedName = screen.getByLabelText('Company name');
    await fill(returnedName, '');
    await click(screen.getByRole('button', { name: 'Confirm & Save' }));
    await expect.element(screen.getByText('Company name is required')).toBeVisible();
    await expect.element(returnedName).toHaveFocus();
    await fill(returnedName, '  Corrected Pte. Ltd.  ');
    await click(screen.getByRole('button', { name: 'Confirm & Save' }));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      entityDetails: expect.objectContaining({ name: 'Corrected Pte. Ltd.' }),
      officers: [expect.objectContaining({ name: 'Alex Tan' })],
    }));
  });

  it('switches Document and Review without horizontal overflow on a narrow viewport', async () => {
    await page.viewport(390, 844);
    await mount();

    await expect.element(screen.getByRole('tab', { name: 'Document' })).toBeVisible();
    await click(screen.getByRole('tab', { name: 'Document' }));
    await expect.element(screen.getByLabelText('Source document')).toBeVisible();
    await click(screen.getByRole('tab', { name: 'Review' }));
    await expect.element(screen.getByLabelText('Company name')).toBeVisible();
    const confirmBox = screen.getByRole('button', { name: 'Confirm & Save' }).getBoundingClientRect();
    expect(confirmBox.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
    await page.screenshot({ path: '__screenshots__/bizfile-review-mobile-390x844.png' });
  });

  it('guards ordinary same-origin application links while dirty', async () => {
    await mount();
    await makeDirty();
    const anchor = applicationLink();
    const bubble = vi.fn();
    anchor.addEventListener('click', bubble);

    const blocked = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    await act(async () => { anchor.dispatchEvent(blocked); });
    expect(blocked.defaultPrevented).toBe(true);
    expect(bubble).not.toHaveBeenCalled();

    await click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(router.push).not.toHaveBeenCalled();

    const secondClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    await act(async () => { anchor.dispatchEvent(secondClick); });
    expect(secondClick.defaultPrevented).toBe(true);
    await click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(router.push).toHaveBeenCalledWith('/companies');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it.each([
    ['modified', {}, { ctrlKey: true }],
    ['external', { href: 'https://example.com/elsewhere' }, {}],
    ['download', { download: 'file.pdf' }, {}],
    ['new-tab', { target: '_blank' }, {}],
  ])('does not guard %s links', async (_kind, attributes, init) => {
    await mount();
    await makeDirty();
    const anchor = applicationLink(attributes);
    const bubble = vi.fn((event: Event) => event.preventDefault());
    anchor.addEventListener('click', bubble);
    await act(async () => { anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })); });
    expect(bubble).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
  });

  it('lets clean application links pass without prompting', async () => {
    await mount();
    const anchor = applicationLink();
    const bubble = vi.fn((event: Event) => event.preventDefault());
    anchor.addEventListener('click', bubble);
    await act(async () => { anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
    expect(bubble).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
  });

  it('restores a dirty Back and leaves only after Discard changes', async () => {
    await mount();
    await makeDirty();
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);

    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(forward).toHaveBeenCalledOnce();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    await click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(back).toHaveBeenCalledOnce();
    const laterUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(laterUnload);
    expect(laterUnload.defaultPrevented).toBe(false);
  });
});
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = false;
  });
