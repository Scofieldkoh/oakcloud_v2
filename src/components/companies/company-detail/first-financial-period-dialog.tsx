'use client';

import { useEffect, useState } from 'react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SingleDateInput } from '@/components/ui/single-date-input';
import { useConfirmFinancialPeriod } from '@/hooks/use-client-services';
import type { FirstFinancialPeriodSuggestion } from '@/services/compliance-monitoring/financial-periods';

/**
 * Record the company's first financial year end. The first period runs from
 * incorporation to that date (it may be longer than 12 months) and its YA is
 * the following year. Saved to the company straight away, independent of the
 * service being added or edited.
 */
export function FirstFinancialPeriodDialog({
  companyId,
  isOpen,
  onClose,
  suggestion,
}: {
  companyId: string;
  isOpen: boolean;
  onClose: () => void;
  suggestion: FirstFinancialPeriodSuggestion | null;
}) {
  const confirm = useConfirmFinancialPeriod(companyId);
  const [firstFye, setFirstFye] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setFirstFye(suggestion?.periodEnd ?? '');
    setError('');
  }, [isOpen, suggestion]);

  const firstYa = /^\d{4}-\d{2}-\d{2}$/.test(firstFye) ? Number(firstFye.slice(0, 4)) + 1 : null;

  const save = async () => {
    setError('');
    if (!firstFye) {
      setError('Enter the first financial year end.');
      return;
    }
    try {
      await confirm.mutateAsync({ firstFinancialYearEnd: firstFye });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the first financial year end.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { if (!confirm.isPending) onClose(); }}
      title="Confirm first financial year end"
      description="The first YA is the year after the first financial year end, so earlier incomplete years drop out. This is saved to the company."
      size="md"
    >
      <ModalBody>
        <div className="space-y-4">
          {error ? <Alert variant="error" compact>{error}</Alert> : null}
          <SingleDateInput
            id="first-period-end"
            label="First financial year end"
            required
            value={firstFye}
            onChange={setFirstFye}
            hint={firstYa ? `First YA: ${firstYa}` : undefined}
            disabled={confirm.isPending}
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={confirm.isPending}>Cancel</Button>
        <Button onClick={() => void save()} isLoading={confirm.isPending}>Confirm</Button>
      </ModalFooter>
    </Modal>
  );
}
