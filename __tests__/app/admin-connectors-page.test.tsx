import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connector } from '@/hooks/use-connectors';

const mocks = vi.hoisted(() => ({
  session: { isSuperAdmin: false, isWorkspaceAdmin: true, tenantId: 'tenant-1' } as Record<string, unknown>,
  connectors: [] as Connector[],
  testConnector: vi.fn(),
  usageParams: [] as unknown[],
  idleMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, variables: undefined }),
}));

vi.mock('@/hooks/use-auth', () => ({ useSession: () => ({ data: mocks.session }) }));
vi.mock('@/components/ui/workspace-selector', () => ({ useActiveWorkspaceId: () => 'tenant-1' }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/connectors/sharepoint/sharepoint-filing-settings', () => ({
  SharePointFilingSettings: () => <div>SharePoint filing settings</div>,
}));
vi.mock('@/hooks/use-connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-connectors')>();
  const idleMutation = mocks.idleMutation;
  return {
    ...actual,
    useConnectors: () => ({ data: { connectors: mocks.connectors, total: mocks.connectors.length }, isLoading: false }),
    useCreateConnector: idleMutation,
    useUpdateConnector: idleMutation,
    useDeleteConnector: idleMutation,
    useTestConnector: () => ({ ...idleMutation(), mutateAsync: mocks.testConnector }),
    useToggleConnector: idleMutation,
    useWorkspaceAccess: () => ({ data: undefined, isLoading: true }),
    useUpdateWorkspaceAccess: idleMutation,
    useConnectorModels: () => ({ data: [], isLoading: false }),
    useToggleConnectorModel: idleMutation,
    useAddConnectorModel: idleMutation,
    useTestConnectorModelPdf: idleMutation,
    useDeleteConnectorModel: idleMutation,
    useConnectorUsage: (params: unknown) => {
      mocks.usageParams.push(params);
      return { data: undefined, isLoading: false };
    },
    useExportUsage: idleMutation,
  };
});

import ConnectorsPage from '@/app/(dashboard)/admin/connectors/page';

function connector(overrides: Partial<Connector>): Connector {
  return {
    id: 'connector-1',
    workspaceId: 'tenant-1',
    name: 'Firm OpenAI',
    type: 'AI_PROVIDER',
    provider: 'OPENAI',
    credentials: {},
    settings: null,
    isEnabled: true,
    isDefault: false,
    callCount: 1234,
    lastUsedAt: null,
    lastTestedAt: null,
    lastTestResult: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function desktopRow(name: string) {
  return screen.getAllByText(name).map((node) => node.closest('tr')).find(Boolean) as HTMLElement;
}

describe('Connectors admin page', () => {
  beforeEach(() => {
    mocks.session = { isSuperAdmin: false, isWorkspaceAdmin: true, tenantId: 'tenant-1' };
    mocks.connectors = [
      connector({}),
      connector({ id: 'connector-2', name: 'Firm SharePoint', type: 'STORAGE', provider: 'SHAREPOINT' }),
      connector({ id: 'connector-3', name: 'System Mistral', provider: 'MISTRAL', workspaceId: null }),
    ];
    mocks.testConnector.mockReset().mockResolvedValue({ success: true, latencyMs: 12 });
    mocks.usageParams = [];
  });

  it('refuses users who are not admins', () => {
    mocks.session = { isSuperAdmin: false, isWorkspaceAdmin: false, tenantId: 'tenant-1' };
    render(<ConnectorsPage />);
    expect(screen.getByText('You do not have permission to access this page.')).toBeInTheDocument();
  });

  it('groups connectors into AI providers and storage/email', () => {
    render(<ConnectorsPage />);
    expect(screen.getByRole('heading', { name: 'AI Providers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Storage/ Email' })).toBeInTheDocument();
    expect(within(desktopRow('Firm OpenAI')).getByText('1,234')).toBeInTheDocument();
    expect(desktopRow('Firm SharePoint')).toBeInTheDocument();
  });

  it('lets a workspace admin edit its own connectors but not system ones', async () => {
    const user = userEvent.setup();
    render(<ConnectorsPage />);

    await user.click(within(desktopRow('Firm OpenAI')).getByRole('button', { name: 'More options' }));
    expect(screen.getByText('Edit')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    const systemRow = desktopRow('System Mistral');
    expect(within(systemRow).getByRole('button', { name: 'Test' })).toBeInTheDocument();
    expect(within(systemRow).queryByRole('button', { name: 'More options' })).not.toBeInTheDocument();
  });

  it('opens the edit modal filled from the connector', async () => {
    const user = userEvent.setup();
    render(<ConnectorsPage />);

    await user.click(within(desktopRow('Firm SharePoint')).getByRole('button', { name: 'More options' }));
    await user.click(screen.getByText('Edit'));

    expect(screen.getByRole('dialog', { name: 'Edit Firm SharePoint' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Firm SharePoint')).toBeInTheDocument();
    expect(screen.getByText('SharePoint filing settings')).toBeInTheDocument();
  });

  it('opens the usage modal for the last 30 days', async () => {
    const user = userEvent.setup();
    render(<ConnectorsPage />);

    await user.click(within(desktopRow('Firm OpenAI')).getByRole('button', { name: 'More options' }));
    await user.click(screen.getByText('View Usage'));

    expect(screen.getByRole('dialog', { name: 'Usage: Firm OpenAI' })).toBeInTheDocument();
    expect(mocks.usageParams.at(-1)).toMatchObject({ connectorId: 'connector-1', page: 1, limit: 20 });
  });

  it('opens Add Connector and tests a connection from the row', async () => {
    const user = userEvent.setup();
    render(<ConnectorsPage />);

    await user.click(within(desktopRow('Firm OpenAI')).getByRole('button', { name: 'Test' }));
    expect(mocks.testConnector).toHaveBeenCalledWith('connector-1');

    await user.click(screen.getByRole('button', { name: 'Add Connector' }));
    expect(screen.getByRole('dialog', { name: 'Add Connector' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Connector' })).toBeInTheDocument();
  });
});
