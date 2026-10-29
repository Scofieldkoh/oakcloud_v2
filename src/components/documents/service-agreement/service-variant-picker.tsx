'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Info } from 'lucide-react';
import type { ServiceVariantDto } from '@/services/service-catalog/types';

interface DescriptionPosition {
  top: number;
  left: number;
  width: number;
  placement: 'above' | 'below';
}

export interface ServiceVariantPickerProps {
  variants: ServiceVariantDto[];
  value: string;
  onChange: (variantId: string) => void;
  disabled?: boolean;
}

export function ServiceVariantPicker({
  variants,
  value,
  onChange,
  disabled = false,
}: ServiceVariantPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [hoveredDescriptionId, setHoveredDescriptionId] = useState<string | null>(null);
  const [pinnedDescriptionId, setPinnedDescriptionId] = useState<string | null>(null);
  const [descriptionPosition, setDescriptionPosition] = useState<DescriptionPosition | null>(null);
  const [menuPosition, setMenuPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 288,
    placement: 'below' as 'above' | 'below',
  });
  const pickerId = useId();
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const infoButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const selectedVariant = variants.find((variant) => variant.id === value);
  const activeDescriptionId = hoveredDescriptionId ?? pinnedDescriptionId;

  const closePicker = useCallback(() => {
    setIsOpen(false);
    setHoveredDescriptionId(null);
    setPinnedDescriptionId(null);
    setDescriptionPosition(null);
  }, []);

  const updateDescriptionPosition = useCallback((button: HTMLElement | null) => {
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(320, Math.max(0, window.innerWidth - 32));
    const left = Math.min(
      Math.max(16, rect.right - width),
      Math.max(16, window.innerWidth - width - 16),
    );
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - 16);
    const spaceAbove = Math.max(0, rect.top - 16);
    const placement = spaceBelow < 180 && spaceAbove > spaceBelow ? 'above' : 'below';

    setDescriptionPosition({
      top: placement === 'above' ? rect.top - 8 : rect.bottom + 8,
      left,
      width,
      placement,
    });
  }, []);

  const showHoveredDescription = useCallback((variantId: string, button: HTMLElement | null) => {
    setHoveredDescriptionId(variantId);
    updateDescriptionPosition(button);
  }, [updateDescriptionPosition]);

  useEffect(() => {
    if (!activeDescriptionId) {
      setDescriptionPosition(null);
      return;
    }

    const button = infoButtonRefs.current[activeDescriptionId];
    if (!button) return;

    const update = () => updateDescriptionPosition(button);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [activeDescriptionId, updateDescriptionPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const selectedIndex = variants.findIndex((variant) => variant.id === value);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        pickerRef.current
        && !pickerRef.current.contains(target)
        && !menuRef.current?.contains(target)
      ) {
        closePicker();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closePicker, isOpen, value, variants]);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const width = Math.min(rect.width, Math.max(0, viewportWidth - 16));
    const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - width - 8));
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - 16);
    const spaceAbove = Math.max(0, rect.top - 16);
    const placement = spaceBelow < 180 && spaceAbove > spaceBelow ? 'above' : 'below';
    const maxHeight = Math.min(288, Math.max(120, placement === 'above' ? spaceAbove : spaceBelow));

    setMenuPosition({
      top: rect.bottom + 4,
      left,
      width,
      maxHeight,
      placement,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen, updateMenuPosition]);

  const chooseVariant = (variantId: string) => {
    onChange(variantId);
    closePicker();
  };

  const openPicker = () => {
    const selectedIndex = variants.findIndex((variant) => variant.id === value);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setIsOpen(true);
  };

  return (
    <div ref={pickerRef} className="relative flex-1 text-xs text-text-secondary">
      <span className="block font-medium text-text-secondary">Service variant</span>
      <button
        type="button"
        id={`${pickerId}-trigger`}
        ref={triggerRef}
        role="combobox"
        aria-label="Service variant"
        aria-expanded={isOpen}
        aria-controls={`${pickerId}-options`}
        aria-haspopup="listbox"
        aria-activedescendant={isOpen && variants[highlightedIndex]
          ? `${pickerId}-option-${variants[highlightedIndex].id}`
          : undefined}
        disabled={disabled}
        onClick={() => (isOpen ? closePicker() : openPicker())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!isOpen) {
              openPicker();
            } else {
              setHighlightedIndex((current) => Math.min(current + 1, variants.length - 1));
            }
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!isOpen) {
              openPicker();
            } else {
              setHighlightedIndex((current) => Math.max(current - 1, 0));
            }
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!isOpen) {
              openPicker();
            } else if (variants[highlightedIndex]) {
              chooseVariant(variants[highlightedIndex].id);
            }
          } else if (event.key === 'Escape') {
            event.preventDefault();
            closePicker();
          }
        }}
        className="mt-1 flex h-11 w-full items-center justify-between gap-2 rounded border border-border-primary bg-background-primary px-3 text-left text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9"
      >
        <span className={selectedVariant ? 'truncate' : 'truncate text-text-muted'}>
          {selectedVariant?.name ?? 'Select a service'}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
      </button>
      {isOpen && typeof document !== 'undefined' ? createPortal(
        <div
          ref={menuRef}
          id={`${pickerId}-options`}
          role="listbox"
          aria-label="Service variant options"
          className="fixed z-[100] overflow-y-auto rounded-lg border border-border-primary bg-background-elevated p-1 shadow-elevation-2"
          style={{
            top: menuPosition.placement === 'below' ? menuPosition.top : undefined,
            bottom: menuPosition.placement === 'above'
              ? window.innerHeight - (triggerRef.current?.getBoundingClientRect().top ?? 0) + 4
              : undefined,
            left: menuPosition.left,
            width: menuPosition.width,
            maxHeight: menuPosition.maxHeight,
          }}
        >
          {variants.length === 0 ? (
            <p className="px-3 py-2 text-sm text-text-muted">No service variants available.</p>
          ) : variants.map((variant, index) => {
            const descriptionVisible = activeDescriptionId === variant.id;
            const descriptionId = `${pickerId}-description-${variant.id}`;
            const descriptionText = variant.description?.trim()
              || 'No description is available for this service variant.';
            return (
              <div
                key={variant.id}
                id={`${pickerId}-option-${variant.id}`}
                role="option"
                aria-label={variant.name}
                aria-selected={variant.id === value}
                aria-describedby={descriptionVisible ? descriptionId : undefined}
                tabIndex={-1}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => chooseVariant(variant.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    chooseVariant(variant.id);
                  }
                }}
                className="relative flex min-h-11 items-center gap-2 rounded px-3 py-2 text-sm text-text-primary outline-none hover:bg-background-secondary focus:bg-background-secondary"
              >
                <span className="min-w-0 flex-1 truncate">{variant.name}</span>
                <span
                  className="relative shrink-0"
                  onMouseEnter={() => showHoveredDescription(
                    variant.id,
                    infoButtonRefs.current[variant.id],
                  )}
                  onMouseLeave={() => setHoveredDescriptionId(null)}
                >
                  <button
                    type="button"
                    ref={(button) => {
                      infoButtonRefs.current[variant.id] = button;
                    }}
                    aria-label={`Show description for ${variant.name}`}
                    aria-expanded={descriptionVisible}
                    aria-controls={descriptionId}
                    title="Show service description"
                    onFocus={(event) => showHoveredDescription(variant.id, event.currentTarget)}
                    onBlur={() => setHoveredDescriptionId(null)}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      updateDescriptionPosition(event.currentTarget);
                      setPinnedDescriptionId((current) => current === variant.id ? null : variant.id);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-border-primary bg-background-secondary/50 text-oak-primary transition-colors hover:bg-background-tertiary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
                  >
                    <Info className="h-4 w-4" aria-hidden="true" />
                  </button>
                </span>
                {descriptionVisible && descriptionPosition && typeof document !== 'undefined'
                  ? createPortal(
                    <div
                      id={descriptionId}
                      role="tooltip"
                      className="fixed z-[200] rounded-md border border-border-primary bg-background-elevated p-3 text-xs leading-5 text-text-secondary shadow-elevation-2"
                      style={{
                        top: descriptionPosition.top,
                        left: descriptionPosition.left,
                        width: descriptionPosition.width,
                        transform: descriptionPosition.placement === 'above'
                          ? 'translateY(-100%)'
                          : undefined,
                      }}
                    >
                      {descriptionText}
                    </div>,
                    document.body,
                  )
                  : null}
              </div>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
