import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useServiceCatalog: vi.fn(),
  useCreateServiceFamily: vi.fn(),
  useUpdateServiceFamily: vi.fn(),
  useArchiveServiceFamily: vi.fn(),
  useCreateServiceVariant: vi.fn(),
  useUpdateServiceVariant: vi.fn(),
  useArchiveServiceVariant: vi.fn(),
  useAllTemplatePartials: vi.fn(),
  useDeadlineRules: vi.fn(),
}));

vi.mock('@/hooks/use-service-catalog', () => hookMocks);
vi.mock('@/hooks/use-template-partials', () => ({
  useAllTemplatePartials: hookMocks.useAllTemplatePartials,
}));
vi.mock('@/hooks/use-deadline-rules', () => ({
  useDeadlineRules: hookMocks.useDeadlineRules,
}));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { ServiceCatalogPanel } from '@/components/services/admin/catalog/service-catalog-panel';
import { ServiceFamilyForm } from '@/components/services/admin/catalog/service-family-form';
import { ServiceVariantForm } from '@/components/services/admin/catalog/service-variant-form';
import { serviceVariantRuleAssociationsSchema } from '@/lib/validations/deadline-rule';

const family = {
  id: 'family-1',
  code: 'ACCOUNTING',
  name: 'Accounting',
  description: null,
  displayColor: '#2F6F5E',
  displayOrder: 0,
  isActive: true,
  variants: [{
    id: 'variant-1',
    familyId: 'family-1',
    code: 'MONTHLY_ACCOUNTING',
    name: 'Monthly Accounting',
    description: null,
    serviceCadence: 'MONTHLY' as const,
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

function mutation() {
  return { mutateAsync: vi.fn(), isPending: false };
}

describe('ServiceCatalogPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookMocks.useServiceCatalog.mockReturnValue({
      data: { families: [family], total: 1 },
      isLoading: false,
      error: null,
    });
    hookMocks.useAllTemplatePartials.mockReturnValue({
      data: {
        partials: [
          {
            id: 'partial-1',
            name: 'accounting-sow',
            displayName: 'Accounting SOW',
          },
        ],
      },
      isLoading: false,
    });
    hookMocks.useDeadlineRules.mockReturnValue({
      data: { rules: [], total: 0, page: 1, limit: 100 },
      isLoading: false,
      error: null,
    });
    hookMocks.useCreateServiceFamily.mockReturnValue(mutation());
    hookMocks.useUpdateServiceFamily.mockReturnValue(mutation());
    hookMocks.useArchiveServiceFamily.mockReturnValue(mutation());
    hookMocks.useCreateServiceVariant.mockReturnValue(mutation());
    hookMocks.useUpdateServiceVariant.mockReturnValue(mutation());
    hookMocks.useArchiveServiceVariant.mockReturnValue(mutation());
  });

  it('shows catalog actions and opens the variant form', () => {
    render(
      <ServiceCatalogPanel
        workspaceId="tenant-1"
        canCreate
        canUpdate
        canDelete
      />,
    );

    expect(screen.getByRole('heading', { name: 'Service catalog' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add service family' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }));
    expect(screen.getByLabelText('SOW partial')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add fee row' })).toBeVisible();
  });

  it('wires tenant rule options and typed defaults into multi-association variant payloads', async () => {
    hookMocks.useDeadlineRules.mockReturnValue({
      data: {
        rules: [{
          id: 'rule-1',
          code: 'ANNUAL_RETURN',
          name: 'Annual return',
          draft: {
            parameters: [{ key: 'filingClass', label: 'Filing class', type: 'ENUM', required: false, validation: { options: ['STANDARD', 'PREMIUM'] }, defaultValue: 'STANDARD' }],
          },
          currentVersion: null,
        }, {
          id: 'rule-2',
          code: 'VAT_RETURN',
          name: 'VAT return',
          draft: { parameters: [] },
          currentVersion: null,
        }],
        total: 2,
        page: 1,
        limit: 100,
      },
      isLoading: false,
      error: null,
    });
    const createVariant = mutation();
    hookMocks.useCreateServiceVariant.mockReturnValue(createVariant);
    render(
      <ServiceCatalogPanel
        workspaceId="tenant-1"
        canCreate
        canUpdate
        canDelete
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }));
    expect(hookMocks.useDeadlineRules).toHaveBeenLastCalledWith(
      'tenant-1',
      expect.objectContaining({ isActive: true, limit: 100 }),
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add deadline rule' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Deadline rule 1' }), { target: { value: 'rule-1' } });
    expect(screen.getByText('Filing class')).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Parameter value filingClass' }), { target: { value: 'PREMIUM' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add schedule entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add deadline rule' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Deadline rule 2' }), { target: { value: 'rule-2' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add schedule entry' })[1]);
    fireEvent.change(screen.getByLabelText('Variant code'), { target: { value: 'ANNUAL_VARIANT' } });
    fireEvent.change(screen.getByLabelText('Variant name'), { target: { value: 'Annual variant' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create variant' }));

    await waitFor(() => expect(createVariant.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      deadlineRules: [
        expect.objectContaining({ ruleId: 'rule-1', displayOrder: 0, parameterDefaults: { filingClass: 'PREMIUM' }, scheduleDefaults: expect.arrayContaining([expect.objectContaining({ expression: expect.objectContaining({ kind: 'DAY_OF_MONTH' }) })]) }),
        expect.objectContaining({ ruleId: 'rule-2', displayOrder: 1, scheduleDefaults: expect.arrayContaining([expect.objectContaining({ expression: expect.objectContaining({ kind: 'DAY_OF_MONTH' }) })]) }),
      ],
    })));
  });

  it('rebuilds an existing association for the newly selected rule', async () => {
    const ruleAId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const ruleBId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ServiceVariantForm
        familyId="family-1"
        partials={[{ id: 'partial-1', name: 'accounting-sow', displayName: 'Accounting SOW' }]}
        initialValue={{
          ...family.variants[0],
          deadlineRules: [{
            id: 'assoc-1',
            ruleId: ruleAId,
            serviceVariantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            enabledByDefault: true,
            parameterDefaults: { filingClass: 'PREMIUM' },
            scheduleDefaults: [{ key: 'old-entry', label: 'Old entry', expression: { kind: 'DAY_OF_MONTH', day: 15 }, businessDayAdjustment: 'NONE' }],
            displayOrder: 0,
            archivedAt: null,
          }],
        }}
        availableDeadlineRules={[
          {
            id: ruleAId,
            code: 'RULE_A',
            name: 'Rule A',
            parameters: [{ key: 'filingClass', label: 'Filing class', type: 'ENUM', required: true, validation: { options: ['STANDARD', 'PREMIUM'] }, defaultValue: 'STANDARD' }],
          },
          {
            id: ruleBId,
            code: 'RULE_B',
            name: 'Rule B',
            parameters: [{ key: 'monthsAfterFye', label: 'Months after FYE', type: 'INTEGER', required: true, validation: null, defaultValue: 2 }],
          },
        ]}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Deadline rule 1' }), { target: { value: ruleBId } });
    expect(screen.getByText('Months after FYE')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save variant' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0]?.[0] as { deadlineRules: Array<Record<string, unknown>> };
    expect(payload.deadlineRules).toEqual([
      expect.objectContaining({
        ruleId: ruleBId,
        parameterDefaults: { monthsAfterFye: 2 },
        scheduleDefaults: [],
        displayOrder: 0,
      }),
    ]);
    expect(payload.deadlineRules[0]).not.toHaveProperty('parameterDefaults.filingClass');
    expect(serviceVariantRuleAssociationsSchema.safeParse(payload.deadlineRules).success).toBe(true);
  });

  it('hides mutation actions for read-only users', () => {
    render(
      <ServiceCatalogPanel
        workspaceId="tenant-1"
        canCreate={false}
        canUpdate={false}
        canDelete={false}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Add service family' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add variant' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit Accounting/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit wording' })).not.toBeInTheDocument();
  });

  it('requests later pages and resets pagination when filters change', () => {
    hookMocks.useServiceCatalog.mockReturnValue({
      data: { families: [family], total: 41 },
      isLoading: false,
      error: null,
    });
    render(
      <ServiceCatalogPanel
        workspaceId="tenant-1"
        canCreate
        canUpdate
        canDelete
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
    expect(hookMocks.useServiceCatalog).toHaveBeenLastCalledWith(
      'tenant-1',
       expect.objectContaining({ page: 2, limit: 20 }),
       true,
    );

    fireEvent.change(screen.getByLabelText('Active state'), {
      target: { value: 'inactive' },
    });
    expect(hookMocks.useServiceCatalog).toHaveBeenLastCalledWith(
      'tenant-1',
       expect.objectContaining({ page: 1, isActive: false }),
       true,
    );
  });

  it('renders loading and error states from the catalog query', () => {
    hookMocks.useServiceCatalog.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    const { rerender } = render(
      <ServiceCatalogPanel
        workspaceId="tenant-1"
        canCreate
        canUpdate
        canDelete
      />,
    );
    expect(screen.getByText('Loading service catalog…')).toBeVisible();

    hookMocks.useServiceCatalog.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Catalog unavailable'),
    });
    rerender(
      <ServiceCatalogPanel
        workspaceId="tenant-1"
        canCreate
        canUpdate
        canDelete
      />,
    );
    expect(screen.getByText('Catalog unavailable')).toBeVisible();
  });

  it('returns to the last valid page when archiving shrinks the result set', async () => {
    hookMocks.useServiceCatalog.mockImplementation(
      (_workspaceId: string, filters: { page: number }) => ({
        data: filters.page === 3
          ? { families: [], total: 40 }
          : { families: [family], total: filters.page === 1 ? 41 : 40 },
        isLoading: false,
        error: null,
      }),
    );
    render(
      <ServiceCatalogPanel
        workspaceId="tenant-1"
        canCreate
        canUpdate
        canDelete
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go to page 3' }));

    await waitFor(() => {
      expect(hookMocks.useServiceCatalog).toHaveBeenLastCalledWith(
        'tenant-1',
         expect.objectContaining({ page: 2, limit: 20 }),
         true,
      );
    });
    expect(screen.getByText('Accounting')).toBeVisible();
    expect(screen.queryByText('No service offerings found')).not.toBeInTheDocument();
  });
});

describe('ServiceVariantForm', () => {
  it('reorders fee rows and submits their normalized display order', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ServiceVariantForm
        familyId="family-1"
        partials={[
          {
            id: 'partial-1',
            name: 'accounting-sow',
            displayName: 'Accounting SOW',
          },
        ]}
        initialValue={{
          ...family.variants[0],
          feeTemplates: [
            {
              id: 'fee-1',
              description: 'First fee',
              defaultAmount: '100',
              currency: 'SGD',
              billingFrequency: 'MONTHLY',
              customFrequencyLabel: null,
              billingTiming: 'PREPAID',
              postpaidTrigger: null,
              displayOrder: 0,
            },
            {
              id: 'fee-2',
              description: 'Second fee',
              defaultAmount: '200',
              currency: 'SGD',
              billingFrequency: 'MONTHLY',
              customFrequencyLabel: null,
              billingTiming: 'PREPAID',
              postpaidTrigger: null,
              displayOrder: 1,
            },
          ],
        }}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move fee row 2 up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save variant' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        feeTemplates: [
          expect.objectContaining({
            description: 'Second fee',
            displayOrder: 0,
          }),
          expect.objectContaining({
            description: 'First fee',
            displayOrder: 1,
          }),
        ],
      }),
    );
  });
});

describe('ServiceFamilyForm', () => {
  it('submits an accessible normalized display color with family text beside the swatch', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ServiceFamilyForm
        initialValue={family}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText('Display color')).toHaveValue('#2f6f5e');
    expect(
      screen.getByText('Used for family badges, filters, table accents, and calendar events.'),
    ).toBeVisible();
    expect(screen.getByText('Accounting')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Display color'), {
      target: { value: '#3f6da8' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save family' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ displayColor: '#3F6DA8' }),
      );
    });
  });
});
