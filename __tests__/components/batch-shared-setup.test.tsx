import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BatchSharedSetup,
  type BatchSharedSetupProps,
} from '@/components/documents/generation-batch/batch-shared-setup';
import type { MasterFieldCatalogue } from '@/types/document-generation-batch';

const catalogue: MasterFieldCatalogue = {
  fields: [
    {
      id: 'client_name::text',
      key: 'client_name',
      type: 'text',
      label: 'Client legal name',
      templateIds: ['template-a', 'template-b'],
      requiredTemplateIds: ['template-a'],
      defaultsByTemplateId: {},
    },
  ],
  conflicts: [{ key: 'engagement_date', types: ['date', 'text'] }],
};

function props(overrides: Partial<BatchSharedSetupProps> = {}): BatchSharedSetupProps {
  return {
    companyOptions: [
      { id: 'company-1', name: 'Acme Pte. Ltd.', uen: '202600001A', status: 'LIVE' },
      { id: 'company-2', name: 'Beta Pte. Ltd.', uen: '202600002B', status: 'LIVE' },
    ],
    selectedCompany: null,
    primaryCompanyId: null,
    companyQuery: '',
    onCompanyQueryChange: vi.fn(),
    masterFields: catalogue,
    masterFieldValues: {},
    onCompanyChange: vi.fn(),
    onMasterValueChange: vi.fn(),
    ...overrides,
  };
}

describe('BatchSharedSetup', () => {
  beforeEach(() => {
    // The combobox popover is portalled and only renders once the trigger has
    // a measurable width, which jsdom does not provide.
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

  it('shows only compatible shared fields used by at least two templates', () => {
    const { unmount } = render(<BatchSharedSetup {...props()} />);
    expect(screen.getByLabelText('Client legal name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Service fee')).not.toBeInTheDocument();
    expect(screen.getByText(/used by 2 documents/i)).toBeInTheDocument();
    expect(screen.getByText(/required by 1 document/i)).toBeInTheDocument();
    unmount();
  });

  it('searches companies on the server instead of filtering one fixed page', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<BatchSharedSetup {...p} />);

    const search = screen.getByPlaceholderText(/search companies by name or uen/i);
    await user.type(search, 'Acme');
    expect(p.onCompanyQueryChange).toHaveBeenCalled();
    await user.click(screen.getByText('Acme Pte. Ltd.'));
    expect(p.onCompanyChange).toHaveBeenCalledWith('company-1', {
      id: 'company-1',
      name: 'Acme Pte. Ltd.',
      status: 'LIVE',
      uen: '202600001A',
    });
  });

  it('shows the selected company details and records master values', async () => {
    const p = props({
      primaryCompanyId: 'company-1',
      selectedCompany: {
        id: 'company-1',
        name: 'Acme Pte. Ltd.',
        uen: '202600001A',
        status: 'LIVE',
        registeredAddress: '1 Raffles Place',
        incorporationDate: '2020-01-15',
      },
    });
    render(<BatchSharedSetup {...p} />);

    expect(screen.getByText('202600001A')).toBeInTheDocument();
    expect(screen.getByText('1 Raffles Place')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Client legal name'), {
      target: { value: 'Acme Holdings' },
    });
    expect(p.onMasterValueChange).toHaveBeenCalledWith(
      'client_name::text',
      'Acme Holdings',
    );
  });

  it('uses the reusable single date selector for date master fields', () => {
    const p = props({
      masterFields: {
        fields: [
          {
            id: 'engagement_date::date',
            key: 'engagement_date',
            type: 'date',
            label: 'Engagement date',
            templateIds: ['template-a', 'template-b'],
            requiredTemplateIds: ['template-a'],
            defaultsByTemplateId: {},
          },
        ],
        conflicts: [],
      },
    });
    const { unmount } = render(<BatchSharedSetup {...p} />);

    const dateInput = screen.getByLabelText('Engagement date');
    expect(dateInput).toBeInTheDocument();
    expect(dateInput).toHaveAttribute('placeholder', 'dd mmm yyyy');
    expect(screen.getByRole('button', { name: 'Open calendar' })).toBeInTheDocument();

    fireEvent.change(dateInput, { target: { value: '2026-09-01' } });
    expect(p.onMasterValueChange).toHaveBeenCalledWith(
      'engagement_date::date',
      '2026-09-01',
    );
    unmount();
  });

  it('explains type conflicts and links overridden documents', async () => {
    const user = userEvent.setup();
    const p = props({
      overriddenCountByField: { 'client_name::text': 2 },
      onSelectOverridden: vi.fn(),
    });
    render(<BatchSharedSetup {...p} />);

    expect(screen.getByText(/incompatible types/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /2 documents override this/i }));
    expect(p.onSelectOverridden).toHaveBeenCalledWith('client_name::text');
  });
});
