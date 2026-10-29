import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const hooksMock = vi.hoisted(() => ({
  useClientServices: vi.fn(), useClientService: vi.fn(), useUpdateClientService: vi.fn(), useArchiveClientService: vi.fn(), useDeleteClientServicePermanently: vi.fn(), useRetryServiceAgreementActivation: vi.fn(),
  useManualClientServiceCatalogOptions: vi.fn(), useCreateManualClientService: vi.fn(),
  useCompanyObligations: vi.fn(() => ({ data: { items: [], notices: [] }, isLoading: false, error: null })),
  useSetCompanyObligationStatus: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useConfirmFinancialPeriod: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useSetEngagementStart: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  isHttpRequestError: vi.fn((error: unknown, status?: number) => Boolean(
    error && typeof error === 'object' && 'status' in error
      && (status === undefined || error.status === status)
  )),
}));
const servicesSettingsMock = vi.hoisted(() => ({ useServicesWorkspaceSettings: vi.fn() }));
vi.mock('@/hooks/use-client-services', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/use-client-services')>(),
  ...hooksMock,
}));
vi.mock('@/hooks/use-services-workspace-settings', () => servicesSettingsMock);

import { CompanyServicesTab } from '@/components/companies/company-detail/company-services-tab';
import { CompanyTabs } from '@/components/companies/company-detail/company-tabs';

const service = {
  id: 'service-1', companyId: 'company-1', agreementId: 'agreement-1', agreementItemId: 'item-1', serviceVariantId: 'variant-1',
  source: 'AGREEMENT', familyName: 'Corporate Services', serviceName: 'Corporate Secretarial Services', status: 'ACTIVE', serviceCadence: 'ANNUALLY', customCadenceLabel: null,
  startDate: '2026-07-30', endDate: null, billingDisposition: 'CONFIGURED', billingNotRequiredReason: null, fieldValues: {}, createdAt: '2026-07-30T00:00:00Z', updatedAt: '2026-07-30T00:00:00Z',
  feeLines: [{ id: 'fee-1', description: 'Annual fee', amount: '500.00', currency: 'SGD', billingFrequency: 'ANNUALLY', customFrequencyLabel: null, billingStartDate: '2026-07-30', displayOrder: 0 }],
  agreement: { title: 'Service Agreement', status: 'EFFECTIVE', activationStatus: 'COMPLETED', generatedDocumentId: 'document-1', href: '/generated-documents/document-1' },
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

async function selectVariantInCreator(name: string) {
  fireEvent.focus(screen.getByPlaceholderText('Select service'));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

describe('CompanyServicesTab', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 40,
      top: 10,
      left: 10,
      bottom: 50,
      right: 210,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    });
    hooksMock.useClientServices.mockReturnValue({ data: { services: [service], total: 1 }, isLoading: false, error: null });
    hooksMock.useClientService.mockReturnValue({ refetch: vi.fn(), isFetching: false });
    hooksMock.useUpdateClientService.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    hooksMock.useArchiveClientService.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    hooksMock.useDeleteClientServicePermanently.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    hooksMock.useRetryServiceAgreementActivation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    hooksMock.useManualClientServiceCatalogOptions.mockReturnValue({ data: catalogOptions, isLoading: false, error: null });
    hooksMock.useCreateManualClientService.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    servicesSettingsMock.useServicesWorkspaceSettings.mockReturnValue({ data: { workspaceEnabled: true, deadlineWritesEnabled: true }, isLoading: false, error: null });
  });

  it('shows compact service identity, fee, and signed agreement source', async () => {
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    expect(await screen.findByText('Corporate Secretarial Services')).toBeVisible();
    expect(screen.getByText('S$500.00 annually')).toBeVisible();
    expect(screen.getByRole('link', { name: /service agreement/i })).toHaveAttribute('href', '/generated-documents/document-1');
    fireEvent.click(screen.getByRole('button', { name: 'Edit service' }));
    expect(screen.queryByLabelText(/service clause/i)).not.toBeInTheDocument();
    expect(screen.getByText(/do not change the signed agreement/i)).toBeVisible();
  });

  it('labels manual services as metadata and keeps the agreement link only for agreement services', () => {
    hooksMock.useClientServices.mockReturnValue({ data: { services: [manualService, service], total: 2, activations: [] }, isLoading: false, error: null });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    expect(screen.getByText('Added manually')).toBeVisible();
    expect(screen.getByText('Added manually').tagName).toBe('SPAN');
    expect(screen.getByText('Advisory Retainer')).toBeVisible();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /service agreement/i })).toHaveAttribute('href', '/generated-documents/document-1');
  });

  it('uses source-aware edit and archive copy for manual services', () => {
    hooksMock.useClientServices.mockReturnValue({ data: { services: [manualService], total: 1, activations: [] }, isLoading: false, error: null });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit service' }));
    expect(screen.getByText(/This service was added manually\. Operational changes are recorded in the audit history\./i)).toBeVisible();
    expect(screen.getByText(/Archiving removes this manually added service from the active company view\./i)).toBeVisible();
  });

  it('hides add actions from read-only users', () => {
    render(<CompanyServicesTab companyId="company-1" canEdit={false} />);
    expect(screen.queryByRole('button', { name: 'Add service' })).not.toBeInTheDocument();
  });

  it('hides historical trigger actions while the workspace is disabled or observe-only', () => {
    servicesSettingsMock.useServicesWorkspaceSettings.mockReturnValue({ data: { workspaceEnabled: false, deadlineWritesEnabled: true }, isLoading: false, error: null });
    const { unmount } = render(<CompanyServicesTab companyId="company-1" canEdit />);
    expect(screen.queryByRole('button', { name: /Trigger historical cycle/i })).not.toBeInTheDocument();
    unmount();

    servicesSettingsMock.useServicesWorkspaceSettings.mockReturnValue({ data: { workspaceEnabled: true, deadlineWritesEnabled: false }, isLoading: false, error: null });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    expect(screen.queryByRole('button', { name: /Trigger historical cycle/i })).not.toBeInTheDocument();
  });

  it('shows one add action beside the controls for editors', () => {
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    expect(screen.getAllByRole('button', { name: 'Add service' })).toHaveLength(1);
  });

  it('adds a second action to the true empty state only', () => {
    hooksMock.useClientServices.mockReturnValue({ data: { services: [], total: 0, activations: [] }, isLoading: false, error: null });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    expect(screen.getAllByRole('button', { name: 'Add service' })).toHaveLength(2);
  });

  it('describes both manual and agreement service origins in the true empty state', () => {
    hooksMock.useClientServices.mockReturnValue({ data: { services: [], total: 0, activations: [] }, isLoading: false, error: null });
    render(<CompanyServicesTab companyId="company-1" canEdit />);

    expect(screen.getByText(
      'Services appear here when they are added manually or activated from a Service Agreement.',
    )).toBeVisible();
  });

  it('does not duplicate the action in a filtered empty state', () => {
    hooksMock.useClientServices.mockReturnValue({ data: { services: [], total: 0, activations: [] }, isLoading: false, error: null });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    fireEvent.change(screen.getByLabelText('Search services'), { target: { value: 'zzz' } });
    expect(screen.getAllByRole('button', { name: 'Add service' })).toHaveLength(1);
    expect(screen.getByText(/No matching services/i)).toBeVisible();
  });

  it('does not add a source filter', () => {
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    expect(screen.queryByRole('button', { name: 'Manual' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agreement' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeVisible();
  });

  it('closes the creator, keeps list state, and shows View service after creation', async () => {
    hooksMock.useCreateManualClientService.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(manualService), isPending: false });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    await selectVariantInCreator('Corporate Secretarial');
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-01' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add service' })).getByRole('button', { name: 'Add service' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'View service' })).toBeVisible());
    expect(screen.queryByRole('dialog', { name: 'Add service' })).not.toBeInTheDocument();
    expect(screen.getByText(/Advisory Retainer was added/i)).toBeVisible();
    expect(hooksMock.useClientServices).toHaveBeenLastCalledWith('company-1', expect.objectContaining({ query: undefined, status: undefined, page: 1, limit: 20 }));
  });

  it('opens the created DTO directly and clears only filters that exclude it', async () => {
    hooksMock.useClientServices.mockReturnValue({ data: { services: [service], total: 55, activations: [] }, isLoading: false, error: null });
    hooksMock.useCreateManualClientService.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(manualService), isPending: false });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    await selectVariantInCreator('Corporate Secretarial');
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-01' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add service' })).getByRole('button', { name: 'Add service' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'View service' })).toBeVisible());

    fireEvent.change(screen.getByLabelText('Search services'), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ended' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.click(screen.getByRole('button', { name: 'View service' }));

    expect(screen.getByRole('dialog', { name: 'Edit service' })).toBeVisible();
    expect(screen.getByLabelText('Service name')).toHaveValue('Advisory Retainer');
    await waitFor(() => expect(hooksMock.useClientServices).toHaveBeenLastCalledWith('company-1', expect.objectContaining({ query: undefined, status: undefined, page: 1, limit: 20 })));
  });

  it('keeps non-excluding filters and pagination when viewing a created service', async () => {
    hooksMock.useClientServices.mockReturnValue({ data: { services: [service], total: 55, activations: [] }, isLoading: false, error: null });
    hooksMock.useCreateManualClientService.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(manualService), isPending: false });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    await selectVariantInCreator('Corporate Secretarial');
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-01' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add service' })).getByRole('button', { name: 'Add service' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'View service' })).toBeVisible());

    fireEvent.change(screen.getByLabelText('Search services'), { target: { value: 'Advisory' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.click(screen.getByRole('button', { name: 'View service' }));

    expect(screen.getByRole('dialog', { name: 'Edit service' })).toBeVisible();
    await waitFor(() => expect(hooksMock.useClientServices).toHaveBeenLastCalledWith('company-1', expect.objectContaining({ query: 'Advisory', status: undefined, page: 2, limit: 20 })));
  });

  it('does not expose edit controls in read-only mode', () => {
    render(<CompanyServicesTab companyId="company-1" canEdit={false} />);
    expect(screen.queryByRole('button', { name: 'Edit service' })).not.toBeInTheDocument();
  });

  it('shows failed activation recovery to authorized editors', () => {
    hooksMock.useClientServices.mockReturnValue({ data: { services: [service], total: 1, activations: [{ agreementId: 'agreement-2', title: 'External Service Agreement', activationStatus: 'FAILED_PERMANENT', activationLastError: 'Company dependency unavailable', canRetry: true }] }, isLoading: false, error: null });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    expect(screen.getByRole('alert')).toHaveTextContent('Company dependency unavailable');
    expect(screen.getByRole('button', { name: 'Retry activation' })).toBeVisible();
  });

  it('hides retry when the complete activation capability is unavailable', () => {
    hooksMock.useClientServices.mockReturnValue({ data: { services: [service], total: 1, activations: [{ agreementId: 'agreement-2', title: 'External Service Agreement', activationStatus: 'FAILED_PERMANENT', activationLastError: 'Activation failed', canRetry: false }] }, isLoading: false, error: null });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    expect(screen.queryByRole('button', { name: 'Retry activation' })).not.toBeInTheDocument();
  });

  it('shows additional fees and exposes pagination beyond the first page', () => {
    hooksMock.useClientServices.mockReturnValue({ data: { services: [{ ...service, feeLines: [...service.feeLines, { ...service.feeLines[0], id: 'fee-2', amount: '9007199254740993.00' }] }], total: 55, activations: [] }, isLoading: false, error: null });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    expect(screen.getByText(/1 additional fee/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(hooksMock.useClientServices).toHaveBeenLastCalledWith('company-1', expect.objectContaining({ page: 2 }));
  });

  it('keeps editor data visible after a failed save and supports all fee fields', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('Save rejected'));
    hooksMock.useUpdateClientService.mockReturnValue({ mutateAsync, isPending: false });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit service' }));
    expect(screen.getByLabelText('Fee 1 currency')).toBeVisible();
    expect(screen.getByLabelText('Fee 1 billing start date')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Fee 1 frequency'), { target: { value: 'CUSTOM' } });
    expect(screen.getByLabelText('Fee 1 custom interval months')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Fee 1 custom interval months'), { target: { value: '18' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Save rejected'));
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('locks the editor before preview and ignores a double-click save', async () => {
    let resolvePreview: ((response: Response) => void) | undefined;
    const preview = new Promise<Response>((resolve) => { resolvePreview = resolve; });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(preview);
    const mutateAsync = vi.fn().mockResolvedValue(service);
    hooksMock.useUpdateClientService.mockReturnValue({ mutateAsync, isPending: false });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit service' }));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PAUSED' } });
    const save = screen.getByRole('button', { name: 'Save changes' });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    expect(screen.getByLabelText('Status')).toBeDisabled();

    resolvePreview?.(new Response(JSON.stringify({ previewFingerprint: 'f'.repeat(64) }), { status: 200 }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
  });

  it('submits the immutable snapshot captured before preview', async () => {
    let resolvePreview: ((response: Response) => void) | undefined;
    const preview = new Promise<Response>((resolve) => { resolvePreview = resolve; });
    vi.spyOn(globalThis, 'fetch').mockReturnValue(preview);
    const mutateAsync = vi.fn().mockResolvedValue(service);
    hooksMock.useUpdateClientService.mockReturnValue({ mutateAsync, isPending: false });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit service' }));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PAUSED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ENDED' } });

    resolvePreview?.(new Response(JSON.stringify({ previewFingerprint: 'f'.repeat(64) }), { status: 200 }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0]?.[0].data).toEqual(expect.objectContaining({ status: 'PAUSED', impactFingerprint: 'f'.repeat(64) }));
  });

  it('requires an explicit reload before retrying a stale edit with the current version', async () => {
    const refreshed = {
      ...service,
      serviceName: 'Server-updated service',
      updatedAt: '2026-08-01T01:00:00.000Z',
    };
    const conflict = Object.assign(new Error('This service was updated by someone else.'), { status: 409 });
    const mutateAsync = vi.fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(refreshed);
    const refetch = vi.fn().mockResolvedValue({ data: refreshed });
    hooksMock.useClientService.mockReturnValue({ refetch, isFetching: false });
    hooksMock.useUpdateClientService.mockReturnValue({ mutateAsync, isPending: false });

    render(<CompanyServicesTab companyId="company-1" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit service' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const reload = await screen.findByRole('button', { name: 'Reload latest service' });
    expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.click(reload);
    await waitFor(() => expect(screen.getByLabelText('Service name')).toHaveValue('Server-updated service'));

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ expectedUpdatedAt: refreshed.updatedAt }),
    }));
  });

  it('associates a required-field validation error with the invalid control', async () => {
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit service' }));
    const serviceName = screen.getByLabelText('Service name');
    fireEvent.change(serviceName, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(serviceName).toHaveAttribute('aria-invalid', 'true'));
    const errorId = serviceName.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)).toHaveTextContent('Service name is required.');
  });

  it('keeps focus while a service-field key changes', () => {
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit service' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const name = screen.getByLabelText('Field 1 name');
    name.focus();
    fireEvent.change(name, { target: { value: 'filingMonth' } });
    expect(document.activeElement).toBe(name);
  });

  it('keeps archive confirmation recoverable after a mutation failure', async () => {
    hooksMock.useArchiveClientService.mockReturnValue({ mutateAsync: vi.fn().mockRejectedValue(new Error('Archive rejected')), isPending: false });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit service' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive service' }));
    fireEvent.change(screen.getByLabelText('Archive reason'), { target: { value: 'Client ended the engagement' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive service' }).at(-1)!);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Archive rejected'));
    expect(screen.getByText('Archive service?')).toBeVisible();
  });

  it('places permanent deletion above archive and confirms the related-record cascade', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ id: service.id, deleted: true, deletedCounts: {} });
    hooksMock.useDeleteClientServicePermanently.mockReturnValue({ mutateAsync, isPending: false });
    render(<CompanyServicesTab companyId="company-1" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit service' }));

    const deleteButton = screen.getByRole('button', { name: 'Delete service permanently' });
    const archiveButton = screen.getByRole('button', { name: 'Archive service' });
    expect(deleteButton.compareDocumentPosition(archiveButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(deleteButton);
    const dialog = screen.getByRole('dialog', { name: 'Permanently delete service?' });
    expect(dialog).toHaveTextContent('deadlines, billing records, fee lines, and rule configuration');
    expect(dialog).toHaveTextContent('cannot be undone');
    fireEvent.change(within(dialog).getByLabelText('Deletion reason'), { target: { value: 'Created against the wrong company' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      id: service.id,
      companyId: service.companyId,
      expectedUpdatedAt: service.updatedAt,
      reason: 'Created against the wrong company',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit service' })).not.toBeInTheDocument());
  });

  it('renders company tabs as horizontally scrollable mobile touch targets', () => {
    const onTabChange = vi.fn();
    render(<CompanyTabs activeTab="services" onTabChange={onTabChange} />);

    const tablist = screen.getByRole('tablist', { name: 'Company sections' });
    expect(tablist).toHaveClass('overflow-x-auto', 'overflow-y-hidden');
    const servicesTab = screen.getByRole('tab', { name: 'Services' });
    expect(servicesTab).toHaveAttribute('aria-selected', 'true');
    expect(servicesTab).toHaveClass('min-h-11', 'shrink-0', 'sm:min-h-0');
  });
});
