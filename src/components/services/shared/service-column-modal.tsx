'use client';

import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';

export interface ServiceColumnOption<Id extends string> {
  id: Id;
  label: string;
  locked?: boolean;
}

export function ServiceColumnModal<Id extends string>({
  isOpen,
  onClose,
  columns,
  visibility,
  onToggle,
  onMove,
  onShowAll,
  onResetWidths,
}: {
  isOpen: boolean;
  onClose: () => void;
  columns: readonly ServiceColumnOption<Id>[];
  visibility: Record<Id, boolean>;
  onToggle: (id: Id) => void;
  onMove: (id: Id, direction: -1 | 1) => void;
  onShowAll: () => void;
  onResetWidths: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Adjust columns" description="Choose which columns appear and arrange their order." size="lg">
      <ModalBody>
        <div className="grid gap-2 sm:grid-cols-2">
          {columns.map((column, index) => (
            <div key={column.id} className="flex min-h-11 items-center gap-1 rounded-lg border border-border-primary px-2 sm:min-h-9">
              <label className="flex min-h-11 min-w-0 flex-1 self-stretch items-center gap-2 text-sm text-text-secondary sm:min-h-9">
                <input
                  type="checkbox"
                  checked={visibility[column.id]}
                  disabled={column.locked}
                  aria-label={`Show ${column.label} column`}
                  onChange={() => onToggle(column.id)}
                />
                <span className="truncate">{column.label}</span>
              </label>
              <button type="button" aria-label={`Move ${column.label} column up`} disabled={index === 0} onClick={() => onMove(column.id, -1)} className="min-h-11 min-w-11 rounded text-text-muted hover:bg-background-tertiary disabled:opacity-40 sm:min-h-8 sm:min-w-8">↑</button>
              <button type="button" aria-label={`Move ${column.label} column down`} disabled={index === columns.length - 1} onClick={() => onMove(column.id, 1)} className="min-h-11 min-w-11 rounded text-text-muted hover:bg-background-tertiary disabled:opacity-40 sm:min-h-8 sm:min-w-8">↓</button>
            </div>
          ))}
        </div>
      </ModalBody>
      <ModalFooter className="justify-between">
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onShowAll}>Show all</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onResetWidths}>Reset widths</Button>
        </div>
        <Button type="button" size="sm" onClick={onClose}>Done</Button>
      </ModalFooter>
    </Modal>
  );
}
