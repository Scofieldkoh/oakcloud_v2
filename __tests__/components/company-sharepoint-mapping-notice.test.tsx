import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanySharePointMappingNotice } from '@/components/companies/company-sharepoint-mapping-notice';

const state = vi.hoisted(() => ({
  canUpdateCompany: true,
  connectors: [{ id: 'connector-1', workspaceId: 'workspace-1' }] as Array<{ id: string; workspaceId: string | null }>,
  mapping: null as null | { connectorId: string; folderName: string; folderWebUrl: string },
  settings: { enabled: true, clientDocumentsRoot: { driveId: 'drive-1', itemId: 'root-1', name: 'Client Documents', webUrl: 'https://sp/root' } } as Record<string, unknown>,
  mutateAsync: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: { updateCompany: state.canUpdateCompany } }),
}));

vi.mock('@/hooks/use-connectors', () => ({
  useConnectors: () => ({ isSuccess: true, data: { connectors: state.connectors } }),
}));

vi.mock('@/hooks/use-sharepoint-folders', () => ({
  useCompanySharePointFolder: () => ({ isLoading: false, isError: false, data: state.mapping }),
  useSharePointFilingSettings: () => ({ isLoading: false, isSuccess: true, data: state.settings }),
  useSetCompanySharePointFolder: () => ({ mutateAsync: state.mutateAsync, isPending: false }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: state.success, error: state.error }),
}));

vi.mock('@/components/connectors/sharepoint/sharepoint-folder-picker', () => ({
  SharePointFolderPicker: ({ isOpen, onConfirm, initialSearch }: { isOpen: boolean; initialSearch: string; onConfirm: (folder: { driveId: string; itemId: string; name: string; webUrl: string }) => void }) => (
    isOpen ? (
      <div data-testid="folder-picker" data-search={initialSearch}>
        <button type="button" onClick={() => onConfirm({ driveId: 'drive-1', itemId: 'folder-1', name: 'Acme Pte Ltd', webUrl: 'https://sp/acme' })}>Pick</button>
      </div>
    ) : null
  ),
}));

describe('CompanySharePointMappingNotice', () => {
  beforeEach(() => {
    state.canUpdateCompany = true;
    state.connectors = [{ id: 'connector-1', workspaceId: 'workspace-1' }];
    state.mapping = null;
    state.settings = { enabled: true, clientDocumentsRoot: { driveId: 'drive-1', itemId: 'root-1', name: 'Client Documents', webUrl: 'https://sp/root' } };
    state.mutateAsync.mockReset().mockResolvedValue({});
    state.success.mockReset();
    state.error.mockReset();
  });

  it('warns when the company has no mapping and maps a folder from the picker', async () => {
    render(<CompanySharePointMappingNotice companyId="company-1" companyName="Acme Pte. Ltd." />);

    expect(screen.getByRole('status')).toHaveTextContent('No SharePoint folder is mapped for this company.');
    expect(screen.getByRole('status')).toHaveTextContent('unassigned folder');

    await userEvent.click(screen.getByRole('button', { name: 'Map folder' }));
    expect(screen.getByTestId('folder-picker')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pick' }));

    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledWith({
      companyId: 'company-1',
      connectorId: 'connector-1',
      folder: { driveId: 'drive-1', itemId: 'folder-1', name: 'Acme Pte Ltd', webUrl: 'https://sp/acme' },
    }));
    expect(state.success).toHaveBeenCalledWith('SharePoint folder mapped to Acme Pte Ltd');
    expect(screen.queryByTestId('folder-picker')).not.toBeInTheDocument();
  });

  it('shows the mapped folder instead of a warning', () => {
    state.mapping = { connectorId: 'connector-1', folderName: 'Acme Pte Ltd', folderWebUrl: 'https://sp/acme' };
    render(<CompanySharePointMappingNotice companyId="company-1" companyName="Acme" />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Acme Pte Ltd/ })).toHaveAttribute('href', 'https://sp/acme');
  });

  it('renders nothing when the workspace has no SharePoint connector', () => {
    state.connectors = [];
    const { container } = render(<CompanySharePointMappingNotice companyId="company-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains who can map when the user cannot edit the company', () => {
    state.canUpdateCompany = false;
    render(<CompanySharePointMappingNotice companyId="company-1" />);

    expect(screen.queryByRole('button', { name: 'Map folder' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Ask someone who can edit this company to map it.');
  });

  it('asks for the Client Documents root when it is not set', () => {
    state.settings = { enabled: false, clientDocumentsRoot: null };
    render(<CompanySharePointMappingNotice companyId="company-1" />);

    expect(screen.queryByRole('button', { name: 'Map folder' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Set the Client Documents root');
  });

  it('shows the save error and keeps the picker open', async () => {
    state.mutateAsync.mockRejectedValue(new Error('Company folder must be an immediate child of Client Documents'));
    render(<CompanySharePointMappingNotice companyId="company-1" companyName="Acme" />);

    await userEvent.click(screen.getByRole('button', { name: 'Map folder' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pick' }));

    await waitFor(() => expect(state.error).toHaveBeenCalledWith('Company folder must be an immediate child of Client Documents'));
    expect(screen.getByTestId('folder-picker')).toBeInTheDocument();
  });
});
