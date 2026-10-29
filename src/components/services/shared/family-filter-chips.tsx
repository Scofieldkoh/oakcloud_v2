'use client';

import type { CSSProperties } from 'react';
import { useState } from 'react';
import { Layers3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { quickFilterClass } from './service-filter-toolbar';
import { cn } from '@/lib/utils';

export interface ServiceFamilyFilter {
  id: string;
  name: string;
  displayColor: string;
}

interface FamilyFilterChipsProps {
  families: ServiceFamilyFilter[];
  selectedIds: readonly string[];
  onToggle: (familyId: string) => void;
  className?: string;
}

/**
 * Family filters deliberately expose both the configured color and the family
 * name. The color is an accent only; it is never the sole way to identify a
 * filter.
 */
export function FamilyFilterChips({
  families,
  selectedIds,
  onToggle,
  className,
}: FamilyFilterChipsProps) {
  const [open, setOpen] = useState(false);
  if (families.length === 0) return null;

  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen(true)} className={quickFilterClass(selectedIds.length > 0)}>
        <Layers3 className="h-4 w-4" aria-hidden="true" />
        <span>Families</span>
        {selectedIds.length > 0 ? <span className="min-w-[18px] rounded-full bg-background-tertiary/80 px-1.5 py-0.5 text-center text-2xs">{selectedIds.length}</span> : null}
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Filter families" description="Select one or more service families." size="sm">
        <ModalBody className="space-y-2">
          {families.map((family) => {
            const selected = selectedIds.includes(family.id);
            const style = { '--family-color': family.displayColor } as CSSProperties;
            return (
              <button
                key={family.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onToggle(family.id)}
                style={style}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-sm transition-colors',
                  selected ? 'border-[var(--family-color)] bg-[var(--family-color)]/10 text-text-primary' : 'border-border-primary text-text-secondary hover:bg-background-tertiary',
                )}
              >
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-black/10 dark:border-white/20" style={{ backgroundColor: family.displayColor }} />
                <span className="flex-1">{family.name}</span>
                <span aria-hidden="true" className="text-xs">{selected ? '✓' : ''}</span>
              </button>
            );
          })}
        </ModalBody>
        <ModalFooter><Button type="button" size="sm" onClick={() => setOpen(false)}>Done</Button></ModalFooter>
      </Modal>
    </div>
  );
}
