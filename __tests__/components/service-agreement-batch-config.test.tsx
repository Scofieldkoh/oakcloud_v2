import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ServiceAgreementConfig,
  type ServiceAgreementConfigProps,
} from '@/components/documents/generation-batch/service-agreement-config';
import type { EditableBatchItem } from '@/components/documents/generation-batch/batch-workspace-state';

function saItem(): EditableBatchItem {
  return {
    key: 'item-1',
    id: 'item-1',
    templateId: 'template-sa',
    templateName: 'Service Agreement',
    templateKind: 'SERVICE_AGREEMENT',
    templateVersion: 1,
    templateEngine: 'A4',
    status: 'NEEDS_INPUT',
    configuration: {
      version: 1,
      title: 'Service Agreement',
      contactIds: [],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      itemValues: {},
      masterOverrides: {},
      useLetterhead: true,
      serviceAgreement: {
        authorizedContactIds: [],
        authorizedRepresentativeRoles: {},
        signerContactIds: [],
        entityIds: ['company-1'],
        agreementDate: '2026-08-12',
        effectiveDate: null,
        termMonths: 12,
        items: [],
      },
    },
    previewContent: null,
    editedContent: null,
    editedContentJson: null,
    previewFingerprint: null,
    reviewedFingerprint: null,
    validationDiagnostics: null,
    lastError: null,
  };
}

function props(overrides: Partial<ServiceAgreementConfigProps> = {}): ServiceAgreementConfigProps {
  return {
    item: saItem(),
    primaryCompany: { id: 'company-1', name: 'Acme Pte. Ltd.', uen: '202600001A', status: 'LIVE' },
    companies: [{ id: 'company-1', name: 'Acme Pte. Ltd.', uen: '202600001A', status: 'LIVE' }],
    contacts: [],
    masterFields: { fields: [], conflicts: [] },
    effectiveMasterValues: {},
    onPatch: vi.fn(),
    ...overrides,
  };
}

describe('ServiceAgreementConfig', () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 320,
      height: 36,
      top: 0,
      left: 0,
      bottom: 36,
      right: 320,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    } as unknown as DOMRect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders item-specific agreement sections without a nested stepper', () => {
    const { unmount } = render(<ServiceAgreementConfig {...props()} />);
    expect(screen.getByRole('heading', { name: /services and fees/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /entities and representative/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /agreement details/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^details$/i }).closest('header')).toHaveClass('bg-oak-primary');
    expect(screen.getByRole('heading', { name: /entities and representative/i }).closest('header')).toHaveClass('bg-[#9b6348]');
    expect(screen.getByRole('heading', { name: /services and fees/i }).closest('header')).toHaveClass('bg-[#9b6348]');
    expect(screen.getByRole('heading', { name: /agreement details/i }).closest('header')).toHaveClass('bg-oak-primary');
    expect(screen.queryByRole('heading', { name: /setup/i })).not.toBeInTheDocument();
    unmount();
  });

  it('returns incomplete service agreement headers to green once required values are present', () => {
    const completeItem = saItem();
    completeItem.configuration.serviceAgreement = {
      ...completeItem.configuration.serviceAgreement!,
      authorizedContactIds: ['contact-1'],
      signerContactIds: ['contact-1'],
      items: [{
        clientKey: 'service-1',
        variantId: 'variant-1',
        entityIds: ['company-1'],
        startDate: '2026-08-12',
        endDate: null,
        fieldValues: {},
        displayOrder: 0,
        feeLines: [{
          clientKey: 'fee-1',
          companyId: 'company-1',
          description: 'Annual service',
          amount: '500',
          currency: 'SGD',
          billingFrequency: 'ANNUALLY',
          customFrequencyLabel: null,
          billingStartDate: '2026-08-12',
          displayOrder: 0,
        }],
      }],
    };

    render(<ServiceAgreementConfig {...props({ item: completeItem })} />);

    expect(screen.getByRole('heading', { name: /entities and representative/i }).closest('header'))
      .toHaveClass('bg-oak-primary');
    expect(screen.getByRole('heading', { name: /services and fees/i }).closest('header'))
      .toHaveClass('bg-oak-primary');
  });

  it('updates the resumable workspace state without touching relational rows', async () => {
    const p = props();
    const { unmount } = render(<ServiceAgreementConfig {...p} />);

    fireEvent.change(screen.getByLabelText('Agreement date'), {
      target: { value: '2026-09-01' },
    });
    expect(p.onPatch).toHaveBeenCalledWith(expect.objectContaining({
      serviceAgreement: expect.objectContaining({ agreementDate: '2026-09-01' }),
    }));
    unmount();
  });

  it('moves pegged service dates with the agreement date and preserves overrides', () => {
    const item = saItem();
    item.configuration.serviceAgreement = {
      ...item.configuration.serviceAgreement!,
      items: [
        {
          clientKey: 'pegged-service',
          variantId: 'variant-1',
          entityIds: ['company-1'],
          startDate: '2026-08-12',
          startDateOverridden: false,
          endDate: null,
          fieldValues: {},
          displayOrder: 0,
          feeLines: [],
        },
        {
          clientKey: 'overridden-service',
          variantId: 'variant-2',
          entityIds: ['company-1'],
          startDate: '2026-08-20',
          startDateOverridden: true,
          endDate: null,
          fieldValues: {},
          displayOrder: 1,
          feeLines: [],
        },
      ],
    };
    const p = props({ item });
    render(<ServiceAgreementConfig {...p} />);

    fireEvent.change(screen.getByLabelText('Agreement date'), {
      target: { value: '1 Sep 2026' },
    });

    expect(p.onPatch).toHaveBeenLastCalledWith({
      serviceAgreement: expect.objectContaining({
        agreementDate: '2026-09-01',
        items: [
          expect.objectContaining({ startDate: '2026-09-01', startDateOverridden: false }),
          expect.objectContaining({ startDate: '2026-08-20', startDateOverridden: true }),
        ],
      }),
    });
  });

  it('aligns agreement fields and gives the primary company twice its current field width', () => {
    render(<ServiceAgreementConfig {...props()} />);

    expect(screen.getByLabelText('Agreement date').parentElement).toHaveClass('h-11');
    expect(screen.getByLabelText('Agreement date').closest('.w-\\[17rem\\]')).toHaveClass('max-w-full');
    expect(screen.getByRole('button', { name: 'Set Agreement date to today' })).toBeInTheDocument();
    expect(screen.getByText('Agreement date')).toHaveClass('mb-1.5');
    expect(screen.getByText('Primary company')).toHaveClass('mb-1.5');
    expect(screen.getByRole('combobox', { name: 'Primary company' }).parentElement)
      .toHaveClass('min-h-11');
    expect(screen.getByRole('combobox', { name: 'Primary company' }).closest('.max-w-none'))
      .toHaveClass('w-full');
    expect(screen.getByLabelText('Agreement date').closest('.grid'))
      .toHaveClass('sm:grid-cols-[17rem_minmax(22rem,44rem)]');
  });

  it('shows the primary company separately from additional Appendix 3 entity tiles', () => {
    const { unmount } = render(
      <ServiceAgreementConfig
        {...props({
          companies: [
            { id: 'company-1', name: 'Acme Pte. Ltd.', uen: '202600001A', status: 'LIVE' },
            { id: 'company-2', name: 'Beta Pte. Ltd.', uen: '202600002B', status: 'LIVE' },
          ],
          item: {
            ...saItem(),
            configuration: {
              ...saItem().configuration,
              serviceAgreement: {
                ...saItem().configuration.serviceAgreement!,
                entityIds: ['company-1', 'company-2'],
              },
            },
          },
        })}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Primary company' })).toBeInTheDocument();
    expect(screen.getByText('Appendix 3 - additional entities to add into the agreement')).toBeInTheDocument();
    expect(screen.getByText('Beta Pte. Ltd.')).toBeInTheDocument();
    expect(screen.queryByText('Agreement parties')).not.toBeInTheDocument();
    expect(screen.queryByText('Select the authorised representative and every entity covered by this agreement.')).not.toBeInTheDocument();
    unmount();
  });

  it('selects multiple representatives and automatically makes the sole representative a signer', async () => {
    const user = userEvent.setup();
    const p = props({
      contacts: [
        { id: 'contact-1', fullName: 'Alex Tan', designation: 'Director' },
        { id: 'contact-2', fullName: 'Bea Lim', designation: 'Manager' },
      ],
    });
    const { unmount } = render(
      <ServiceAgreementConfig
        {...p}
      />,
    );

    expect(screen.getByRole('checkbox', { name: /select Alex Tan as an authorised representative/i }).closest('.max-w-xl'))
      .toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /select Alex Tan as an authorised representative/i }));
    expect(p.onPatch).toHaveBeenLastCalledWith(expect.objectContaining({
      serviceAgreement: expect.objectContaining({
        authorizedContactIds: ['contact-1'],
        signerContactIds: ['contact-1'],
      }),
    }));
    unmount();
  });

  it('allows multiple selected representatives and multiple signer checkboxes', async () => {
    const user = userEvent.setup();
    const item = saItem();
    item.configuration.serviceAgreement = {
      ...item.configuration.serviceAgreement!,
      authorizedContactIds: ['contact-1', 'contact-2'],
      signerContactIds: ['contact-1'],
    };
    const p = props({
      item,
      contacts: [
        { id: 'contact-1', fullName: 'Alex Tan', designation: 'Director' },
        { id: 'contact-2', fullName: 'Bea Lim', designation: 'Manager' },
      ],
    });
    render(<ServiceAgreementConfig {...p} />);

    await user.click(screen.getByRole('checkbox', { name: /make Bea Lim a signer/i }));

    expect(p.onPatch).toHaveBeenLastCalledWith(expect.objectContaining({
      serviceAgreement: expect.objectContaining({
        authorizedContactIds: ['contact-1', 'contact-2'],
        signerContactIds: ['contact-1', 'contact-2'],
      }),
    }));
  });

  it('links representatives to their contact details in a new tab', () => {
    render(<ServiceAgreementConfig {...props({
      contacts: [{ id: 'contact-1', fullName: 'Alex Tan', designation: 'Director' }],
    })} />);

    const link = screen.getByRole('link', {
      name: 'Open Alex Tan contact details in a new tab',
    });
    expect(link).toHaveAttribute('href', '/contacts/contact-1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('keeps the representative tile selectable without selecting when its name link is clicked', () => {
    const p = props({
      contacts: [{ id: 'contact-1', fullName: 'Alex Tan', designation: 'Director' }],
    });
    render(<ServiceAgreementConfig {...p} />);

    fireEvent.click(screen.getByRole('link', {
      name: 'Open Alex Tan contact details in a new tab',
    }));
    expect(p.onPatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', {
      name: /select Alex Tan as an authorised representative/i,
    }));
    expect(p.onPatch).toHaveBeenCalledWith(expect.objectContaining({
      serviceAgreement: expect.objectContaining({
        authorizedContactIds: ['contact-1'],
      }),
    }));
  });

  it('keeps rank, movement, appointment, and signer controls on each selected tile', () => {
    const item = saItem();
    item.configuration.serviceAgreement = {
      ...item.configuration.serviceAgreement!,
      authorizedContactIds: ['contact-1', 'contact-2'],
      authorizedRepresentativeRoles: {
        'contact-1': 'Director',
        'contact-2': 'CEO',
      },
      signerContactIds: ['contact-1', 'contact-2'],
    };
    render(<ServiceAgreementConfig {...props({
      item,
      contacts: [
        {
          id: 'contact-1',
          fullName: 'Alex Tan',
          designation: 'Director',
          appointments: ['Director', 'CEO', 'Shareholder'],
        },
        {
          id: 'contact-2',
          fullName: 'Bea Lim',
          designation: 'CEO',
          appointments: ['CEO', 'Shareholder'],
        },
      ],
    })} />);

    const alexTile = screen.getByLabelText('Alex Tan rank 1').closest('[data-representative-tile]');
    expect(alexTile).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Appointment for Alex Tan' })).toHaveValue('Director');
    expect(alexTile).toContainElement(screen.getByRole('button', { name: 'Move Alex Tan down' }));
    expect(alexTile).toContainElement(screen.getByRole('checkbox', { name: /make Alex Tan a signer/i }));
    expect(screen.getByLabelText('Bea Lim rank 2')).toBeInTheDocument();
  });

  it('moves a representative inline and preserves its selected appointment', async () => {
    const user = userEvent.setup();
    const item = saItem();
    item.configuration.serviceAgreement = {
      ...item.configuration.serviceAgreement!,
      authorizedContactIds: ['contact-1', 'contact-2'],
      authorizedRepresentativeRoles: {
        'contact-1': 'Director',
        'contact-2': 'CEO',
      },
      signerContactIds: ['contact-1', 'contact-2'],
    };
    const p = props({
      item,
      contacts: [
        { id: 'contact-1', fullName: 'Alex Tan', appointments: ['Director', 'CEO'] },
        { id: 'contact-2', fullName: 'Bea Lim', appointments: ['CEO'] },
      ],
    });
    render(<ServiceAgreementConfig {...p} />);

    await user.click(screen.getByRole('button', { name: 'Move Bea Lim up' }));

    expect(p.onPatch).toHaveBeenLastCalledWith(expect.objectContaining({
      serviceAgreement: expect.objectContaining({
        authorizedContactIds: ['contact-2', 'contact-1'],
        authorizedRepresentativeRoles: {
          'contact-1': 'Director',
          'contact-2': 'CEO',
        },
        signerContactIds: ['contact-2', 'contact-1'],
      }),
    }));
  });

  it('allows the default appointment to be overridden from the same tile', async () => {
    const user = userEvent.setup();
    const item = saItem();
    item.configuration.serviceAgreement = {
      ...item.configuration.serviceAgreement!,
      authorizedContactIds: ['contact-1'],
      authorizedRepresentativeRoles: { 'contact-1': 'Director' },
      signerContactIds: ['contact-1'],
    };
    const p = props({
      item,
      contacts: [{
        id: 'contact-1',
        fullName: 'Alex Tan',
        appointments: ['Director', 'CEO', 'Shareholder'],
      }],
    });
    render(<ServiceAgreementConfig {...p} />);

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Appointment for Alex Tan' }),
      'CEO',
    );

    expect(p.onPatch).toHaveBeenLastCalledWith(expect.objectContaining({
      serviceAgreement: expect.objectContaining({
        authorizedRepresentativeRoles: { 'contact-1': 'CEO' },
      }),
    }));
  });

  it('keeps a pinned representative visible when the current contact option is unavailable', () => {
    const item = saItem();
    item.configuration.serviceAgreement = {
      ...item.configuration.serviceAgreement!,
      authorizedContactIds: ['contact-1'],
      authorizedRepresentativeRoles: { 'contact-1': 'Director' },
      signerContactIds: ['contact-1'],
    };
    item.serviceAgreement = {
      authorizedRepresentativeSnapshots: [{
        id: 'contact-1',
        name: 'Pinned Representative',
        role: 'Director',
        email: 'pinned@example.com',
        phone: null,
      }],
    } as any;

    render(<ServiceAgreementConfig {...props({ item, contacts: [] })} />);

    expect(screen.getByLabelText('Pinned Representative rank 1')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Appointment for Pinned Representative' }))
      .toHaveValue('Director');
  });

  it('persists an inferred default role for an already-selected representative', async () => {
    const item = saItem();
    item.configuration.serviceAgreement = {
      ...item.configuration.serviceAgreement!,
      authorizedContactIds: ['contact-1', 'contact-2'],
      authorizedRepresentativeRoles: { 'contact-2': 'Authorized Representative' },
      signerContactIds: ['contact-1', 'contact-2'],
    };
    const p = props({
      item,
      contacts: [
        {
          id: 'contact-1',
          fullName: 'Alex Tan',
          designation: 'Director',
          appointments: ['Director', 'Shareholder'],
        },
        {
          id: 'contact-2',
          fullName: 'Bea Lim',
          designation: 'Authorized Representative',
          appointments: ['Authorized Representative'],
        },
      ],
    });

    render(<ServiceAgreementConfig {...p} />);

    await waitFor(() => expect(p.onPatch).toHaveBeenCalledWith(expect.objectContaining({
      serviceAgreement: expect.objectContaining({
        authorizedRepresentativeRoles: {
          'contact-1': 'Director',
          'contact-2': 'Authorized Representative',
        },
      }),
    })));
  });

  it('keeps the sole representative selected as the required signer', () => {
    const item = saItem();
    item.configuration.serviceAgreement = {
      ...item.configuration.serviceAgreement!,
      authorizedContactIds: ['contact-1'],
      signerContactIds: ['contact-1'],
    };
    render(<ServiceAgreementConfig {...props({
      item,
      contacts: [{ id: 'contact-1', fullName: 'Alex Tan', designation: 'Director' }],
    })} />);

    expect(screen.getByRole('checkbox', { name: /make Alex Tan a signer/i }))
      .toBeChecked();
    expect(screen.getByRole('checkbox', { name: /make Alex Tan a signer/i }))
      .toBeDisabled();
  });

  it('shows a yellow warning only when a selected representative has neither email nor phone', () => {
    const item = saItem();
    item.configuration.serviceAgreement = {
      ...item.configuration.serviceAgreement!,
      authorizedContactIds: ['contact-1', 'contact-2'],
      signerContactIds: ['contact-1'],
    };
    render(<ServiceAgreementConfig {...props({
      item,
      contacts: [
        { id: 'contact-1', fullName: 'Alex Tan', email: null, phone: null },
        { id: 'contact-2', fullName: 'Bea Lim', email: 'bea@example.com', phone: null },
      ],
    })} />);

    expect(screen.getByRole('alert')).toHaveTextContent(/Alex Tan has no email address or phone number/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent('Bea Lim');
  });

  it('disables additional entity controls when the agreement is read-only', () => {
    const item = saItem();
    item.configuration.serviceAgreement = {
      ...item.configuration.serviceAgreement!,
      entityIds: ['company-1', 'company-2'],
    };
    render(<ServiceAgreementConfig {...props({
      item,
      disabled: true,
      companies: [
        { id: 'company-1', name: 'Acme Pte. Ltd.', uen: '202600001A', status: 'LIVE' },
        { id: 'company-2', name: 'Beta Pte. Ltd.', uen: '202600002B', status: 'LIVE' },
      ],
    })} />);

    expect(screen.getByRole('combobox', { name: /search companies to add/i }))
      .toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /remove Beta Pte\. Ltd\. from agreement entities/i }))
      .toBeDisabled();
  });

  it('lets the Agreement details primary company field update the shared company callback', async () => {
    const user = userEvent.setup();
    const onPrimaryCompanyChange = vi.fn();
    const p = {
      ...props({
        companies: [
          { id: 'company-1', name: 'Acme Pte. Ltd.', uen: '202600001A', status: 'LIVE' },
          { id: 'company-2', name: 'Beta Pte. Ltd.', uen: '202600002B', status: 'LIVE' },
        ],
      }),
      onPrimaryCompanyChange,
    };
    const { unmount } = render(<ServiceAgreementConfig {...p} />);

    await user.click(screen.getByRole('combobox', { name: 'Primary company' }));
    await user.click(screen.getByRole('option', { name: /Beta Pte\. Ltd\./i }));

    expect(onPrimaryCompanyChange).toHaveBeenCalledWith(
      'company-2',
      expect.objectContaining({ name: 'Beta Pte. Ltd.' }),
    );
    unmount();
  });
});
