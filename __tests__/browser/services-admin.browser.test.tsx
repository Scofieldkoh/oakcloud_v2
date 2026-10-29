import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { page, userEvent } from 'vitest/browser';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ServiceCatalogAdminPage } from '@/components/services/admin/services-admin-page';
import { ToastProvider } from '@/components/ui/toast';
import '@/app/globals.css';

const session = {
  user: {
    id: 'user-1',
    email: 'admin@example.com',
    firstName: 'Tenant',
    lastName: 'Admin',
    tenantId: 'workspace-1',
    workspaceId: 'workspace-1',
    internalRole: 'ADMIN',
    isAdmin: true,
    isManager: false,
    isStaff: false,
    isSuperAdmin: false,
    isWorkspaceAdmin: true,
    companyIds: [],
  },
  permissions: [],
  internalRole: 'ADMIN',
  isAdmin: true,
  isManager: false,
  isStaff: false,
  isSuperAdmin: false,
  isWorkspaceAdmin: true,
};

const family = {
  id: 'family-1',
  code: 'ACCOUNTING',
  name: 'Accounting',
  description: 'Accounting services',
  displayColor: '#2F6F5E',
  displayOrder: 0,
  isActive: true,
  variants: [{
    id: 'variant-1',
    familyId: 'family-1',
    code: 'MONTHLY_ACCOUNTING',
    name: 'Monthly Accounting',
    description: null,
    serviceCadence: 'MONTHLY',
    customCadenceLabel: null,
    displayOrder: 0,
    version: 1,
    isActive: true,
    sowPartial: {
      id: 'partial-1',
      name: 'accounting-sow',
      displayName: 'Accounting SOW',
      version: 1,
      placeholders: [],
    },
    feeTemplates: [],
  }],
};

const json = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } },
);

async function waitUntil(check: () => boolean, timeout = 4000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error('Timed out waiting for Services administration UI');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

function visibleInteractiveElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')]
    .filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    });
}

describe('Services administration browser surface', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  beforeEach(() => {
    host = document.createElement('div');
    document.body.replaceChildren(host);
    root = createRoot(host);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/session')) return json(session);
      if (url.includes('/api/services/settings')) return json({ workspaceEnabled: true, deadlineWritesEnabled: true });
      if (url.includes('/api/service-catalog?')) return json({ families: [family], total: 1 });
      if (url.includes('/api/template-partials?')) return json({ partials: [] });
      return json({});
    }));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    host.remove();
    vi.unstubAllGlobals();
  });

  async function mount() {
    await act(async () => {
      root.render(
        <ToastProvider>
          <QueryClientProvider client={queryClient}>
            <ServiceCatalogAdminPage />
          </QueryClientProvider>
        </ToastProvider>,
      );
    });
    await waitUntil(() => Boolean(screen.queryByRole('heading', { name: 'Service catalog' })));
    await waitUntil(() => Boolean(screen.queryByText('Accounting')));
  }

  it('renders the catalog as its own page without section tabs, with family color controls', async () => {
    await page.viewport(1440, 900);
    await mount();

    const main = screen.getByRole('main');
    const heading = screen.getByRole('heading', { name: 'Service catalog' });
    await expect.element(heading).toBeVisible();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Services administration' })).toBeNull();
    await expect.element(screen.getByText('Accounting')).toBeVisible();
    expect(Math.round(heading.getBoundingClientRect().left - main.getBoundingClientRect().left)).toBe(24);

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Add service family' }));
    });
    await waitUntil(() => Boolean(screen.queryByRole('dialog', { name: 'Add service family' })));
    await expect.element(screen.getByRole('dialog', { name: 'Add service family' })).toBeVisible();
    const color = screen.getByLabelText('Display color');
    await expect.element(color).toBeVisible();
    expect(color).toHaveAttribute('type', 'color');
    expect(color).toHaveAccessibleDescription(
      'Used for family badges, filters, table accents, and calendar events.',
    );
    await expect.element(screen.getByText('Family color preview')).toBeVisible();
    await act(async () => {
      await userEvent.fill(screen.getByLabelText('Family name'), 'Payroll');
    });
    await expect.element(screen.getByText('Payroll')).toBeVisible();
  });

  it('keeps the administration surface readable at a mobile viewport', async () => {
    await page.viewport(390, 844);
    await mount();

    const main = screen.getByRole('main');
    const mainRect = main.getBoundingClientRect();
    const contained = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= mainRect.left - 1
        && rect.right <= mainRect.right + 1
        && rect.top >= mainRect.top - 1;
    };
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );

    const catalogHeading = screen.getByRole('heading', { name: 'Service catalog' });
    const addFamily = screen.getByRole('button', { name: 'Add service family' });
    expect(addFamily.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      catalogHeading.getBoundingClientRect().bottom - 1,
    );
    const familyArticle = screen.getByText('Accounting').closest('article');
    if (!familyArticle) throw new Error('Service family article missing');
    expect(contained(familyArticle)).toBe(true);
    expect(contained(addFamily)).toBe(true);

    const controls = visibleInteractiveElements(main);
    expect(controls.map((control) => control.getAttribute('aria-label') || control.textContent?.trim()))
      .toEqual(expect.arrayContaining([
        'Add service family',
        'Search service catalog',
        'Add variant',
        'Edit Accounting',
        'Archive Accounting',
        'Edit wording',
        'Edit Monthly Accounting',
        'Archive Monthly Accounting',
      ]));
    for (const control of controls) {
      const rect = control.getBoundingClientRect();
      expect(rect.width, control.outerHTML).toBeGreaterThanOrEqual(44);
      expect(rect.height, control.outerHTML).toBeGreaterThanOrEqual(44);
      expect(contained(control), control.outerHTML).toBe(true);
    }

    const status = screen.getByLabelText('Active state');
    expect(controls).toContain(status);
  });
});
