'use client';

/** The "Adjust columns" dialog for the Document Processing list. */

import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Checkbox } from '@/components/ui/checkbox';
import { COLUMN_IDS, COLUMN_LABELS, type ColumnId } from '@/components/processing/list/processing-list-config';

interface ProcessingColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
  isColumnVisible: (columnId: ColumnId) => boolean;
  toggleColumnVisibility: (columnId: ColumnId) => void;
  showAllColumns: () => void;
  resetColumns: () => void;
}

export function ProcessingColumnModal({
  isOpen,
  onClose,
  isColumnVisible,
  toggleColumnVisibility,
  showAllColumns,
  resetColumns,
}: ProcessingColumnModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Adjust columns"
      description="Choose which columns to show, and reset widths if needed."
      size="lg"
    >
      <ModalBody>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {COLUMN_IDS.map((columnId) => (
            <Checkbox
              key={columnId}
              checked={isColumnVisible(columnId)}
              disabled={columnId === 'open'}
              label={COLUMN_LABELS[columnId]}
              description={columnId === 'open' ? 'Always shown' : undefined}
              onChange={() => toggleColumnVisibility(columnId)}
            />
          ))}
        </div>
        <p className="mt-3 text-xs text-text-muted">Saved per user.</p>
      </ModalBody>
      <ModalFooter className="justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={showAllColumns} className="btn-secondary btn-sm">
            Show all
          </button>
          <button type="button" onClick={resetColumns} className="btn-secondary btn-sm" title="Reset column widths">
            Reset widths
          </button>
        </div>
        <button type="button" onClick={onClose} className="btn-primary btn-sm">
          Done
        </button>
      </ModalFooter>
    </Modal>
  );
}
