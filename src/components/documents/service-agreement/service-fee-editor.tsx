'use client';

import { Button } from '@/components/ui/button';
import { SingleDateInput } from '@/components/ui/single-date-input';
import type { ServiceAgreementFeeLineInput } from '@/services/service-agreement';
import { createServiceAgreementClientKey } from './client-key';

interface ServiceFeeEditorProps {
  fees: ServiceAgreementFeeLineInput[];
  entityIds: string[];
  companyNames: Map<string, string>;
  startDate: string;
  onChange: (fees: ServiceAgreementFeeLineInput[]) => void;
}

export function ServiceFeeEditor({
  fees,
  entityIds,
  companyNames,
  startDate,
  onChange,
}: ServiceFeeEditorProps) {
  const update = (
    index: number,
    patch: Partial<ServiceAgreementFeeLineInput>,
  ) => onChange(fees.map((fee, candidate) =>
    candidate === index ? { ...fee, ...patch } : fee));

  const addFee = (companyId: string) => {
    const displayOrder = fees.filter((fee) => fee.companyId === companyId).length;
    onChange([...fees, {
      clientKey: createServiceAgreementClientKey(),
      companyId,
      description: '',
      amount: '0.00',
      currency: 'SGD',
      billingFrequency: 'ANNUALLY',
      customFrequencyLabel: null,
      billingStartDate: null,
      billingStartDateOverridden: false,
      displayOrder,
    }]);
  };

  return (
    <div className="space-y-3">
      {fees.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-xs text-text-secondary">
                <th scope="col" className="border-b border-border-secondary px-2 pb-2 font-medium">Description</th>
                <th scope="col" className="w-48 border-b border-border-secondary px-2 pb-2 font-medium">Company applied</th>
                <th scope="col" className="w-28 border-b border-border-secondary px-2 pb-2 font-medium">Amount</th>
                <th scope="col" className="w-24 border-b border-border-secondary px-2 pb-2 font-medium">Currency</th>
                <th scope="col" className="w-36 border-b border-border-secondary px-2 pb-2 font-medium">Frequency</th>
                <th scope="col" className="w-72 border-b border-border-secondary px-2 pb-2 font-medium">Billing start date</th>
                <th scope="col" className="w-24 border-b border-border-secondary px-2 pb-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {fees.map((fee, index) => {
                const billingStartDateOverridden = fee.billingStartDateOverridden
                  ?? (Boolean(fee.billingStartDate) && fee.billingStartDate !== startDate);
                return (
                <tr key={fee.clientKey} className="align-top text-xs text-text-secondary">
                  <td className="border-b border-border-secondary px-2 py-2">
                    <label className="sr-only" htmlFor={`${fee.clientKey}-description`}>
                      {companyNames.get(fee.companyId) ?? 'Entity'} fee description
                    </label>
                    <input
                      id={`${fee.clientKey}-description`}
                      aria-label={`${companyNames.get(fee.companyId) ?? 'Entity'} fee description`}
                      value={fee.description}
                      onChange={(event) => update(index, { description: event.target.value })}
                      className="h-10 w-full min-w-64 rounded border border-border-primary bg-background-primary px-2 text-sm text-text-primary"
                    />
                  </td>
                  <td className="border-b border-border-secondary px-2 py-2 align-middle">
                    <span className="block truncate text-sm text-text-primary">
                      {companyNames.get(fee.companyId) ?? 'Entity'}
                    </span>
                  </td>
                  <td className="border-b border-border-secondary px-2 py-2">
                    <label className="sr-only" htmlFor={`${fee.clientKey}-amount`}>Amount</label>
                    <input
                      id={`${fee.clientKey}-amount`}
                      aria-label="Amount"
                      inputMode="decimal"
                      value={fee.amount}
                      onChange={(event) => update(index, { amount: event.target.value })}
                      className="h-10 w-full rounded border border-border-primary bg-background-primary px-2 text-sm text-text-primary"
                    />
                  </td>
                  <td className="border-b border-border-secondary px-2 py-2">
                    <label className="sr-only" htmlFor={`${fee.clientKey}-currency`}>Currency</label>
                    <input
                      id={`${fee.clientKey}-currency`}
                      aria-label="Currency"
                      maxLength={3}
                      value={fee.currency}
                      onChange={(event) => update(index, {
                        currency: event.target.value.toUpperCase(),
                      })}
                      className="h-10 w-full rounded border border-border-primary bg-background-primary px-2 text-sm text-text-primary"
                    />
                  </td>
                  <td className="border-b border-border-secondary px-2 py-2">
                    <label className="sr-only" htmlFor={`${fee.clientKey}-frequency`}>Frequency</label>
                    <select
                      id={`${fee.clientKey}-frequency`}
                      aria-label="Frequency"
                      value={fee.billingFrequency}
                      onChange={(event) => update(index, {
                        billingFrequency: event.target
                          .value as ServiceAgreementFeeLineInput['billingFrequency'],
                        customFrequencyLabel: event.target.value === 'CUSTOM'
                          ? fee.customFrequencyLabel
                          : null,
                      })}
                      className="h-10 w-full rounded border border-border-primary bg-background-primary px-2 text-xs text-text-primary"
                    >
                      {['MONTHLY', 'QUARTERLY', 'SEMI_ANNUALLY', 'ANNUALLY', 'ONE_TIME', 'CUSTOM'].map(
                        (frequency) => (
                          <option key={frequency} value={frequency}>
                            {frequency.replaceAll('_', ' ')}
                          </option>
                        ),
                      )}
                    </select>
                    {fee.billingFrequency === 'CUSTOM' ? (
                      <label className="sr-only" htmlFor={`${fee.clientKey}-custom-frequency`}>Custom frequency</label>
                    ) : null}
                    {fee.billingFrequency === 'CUSTOM' ? (
                      <input
                        id={`${fee.clientKey}-custom-frequency`}
                        aria-label="Custom frequency"
                        value={fee.customFrequencyLabel ?? ''}
                        onChange={(event) => update(index, {
                          customFrequencyLabel: event.target.value,
                        })}
                        className="mt-1 h-10 w-full rounded border border-border-primary bg-background-primary px-2 text-sm text-text-primary"
                      />
                    ) : null}
                  </td>
                  <td className="border-b border-border-secondary px-2 py-2">
                    <SingleDateInput
                      value={billingStartDateOverridden
                        ? fee.billingStartDate ?? startDate
                        : startDate}
                      onChange={(next) => update(index, {
                        billingStartDate: next || null,
                        billingStartDateOverridden: Boolean(next),
                      })}
                      ariaLabel="Billing start date"
                      showTodayButton
                      className="w-[17rem] max-w-full"
                      controlClassName={billingStartDateOverridden
                        ? 'bg-oak-row-selected dark:bg-oak-row-selected'
                        : 'bg-background-tertiary dark:bg-background-tertiary'}
                    />
                  </td>
                  <td className="border-b border-border-secondary px-2 py-2 align-middle">
                    <Button
                      variant="danger"
                      size="xs"
                      onClick={() => onChange(
                        fees
                          .filter((_, candidate) => candidate !== index)
                          .map((candidate, candidateIndex, remaining) => ({
                            ...candidate,
                            displayOrder: remaining
                              .slice(0, candidateIndex)
                              .filter((other) => other.companyId === candidate.companyId)
                              .length,
                          })),
                      )}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {entityIds.map((entityId) => (
          <Button
            key={entityId}
            variant="secondary"
            size="xs"
            onClick={() => addFee(entityId)}
          >
            Add fee for {companyNames.get(entityId) ?? 'entity'}
          </Button>
        ))}
      </div>
    </div>
  );
}
