'use client';

import { useState, createContext, useContext, useRef, useEffect, useCallback, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// Context for sharing dropdown state
interface DropdownContextValue {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  close: () => void;
  triggerRef: React.RefObject<HTMLDivElement | null>;
  menuId: string;
  activeIndex: number;
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  menuItemsRef: React.RefObject<HTMLButtonElement[]>;
  registerMenuItem: (index: number, element: HTMLButtonElement | null) => void;
}

const DropdownContext = createContext<DropdownContextValue | null>(null);

function useDropdownContext() {
  const context = useContext(DropdownContext);
  if (!context) {
    throw new Error('Dropdown components must be used within a Dropdown');
  }
  return context;
}

// Root Dropdown component
interface DropdownProps {
  children: ReactNode;
  className?: string;
}

export function Dropdown({ children, className }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuItemsRef = useRef<HTMLButtonElement[]>([]);
  const menuId = useId();

  const close = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(-1);
  }, []);

  const registerMenuItem = useCallback((index: number, element: HTMLButtonElement | null) => {
    if (element) {
      menuItemsRef.current[index] = element;
    }
  }, []);

  // Reset active index when opening
  useEffect(() => {
    if (isOpen) {
      setActiveIndex(-1);
      menuItemsRef.current = [];
    }
  }, [isOpen]);

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // Check if click is outside both the container and any portal-rendered menu
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !(target as Element).closest?.('[data-dropdown-menu]')
      ) {
        close();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        // Return focus to trigger
        const triggerButton = triggerRef.current?.querySelector('button');
        triggerButton?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, close]);

  return (
    <DropdownContext.Provider value={{
      isOpen,
      setIsOpen,
      close,
      triggerRef,
      menuId,
      activeIndex,
      setActiveIndex,
      menuItemsRef,
      registerMenuItem
    }}>
      <div ref={containerRef} className={cn('relative', className)}>
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

// Dropdown trigger button
interface DropdownTriggerProps {
  children: ReactNode;
  className?: string;
  asChild?: boolean;
  'aria-label'?: string;
}

export function DropdownTrigger({ children, className, asChild, 'aria-label': ariaLabel }: DropdownTriggerProps) {
  const { isOpen, setIsOpen, triggerRef, menuId } = useDropdownContext();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsOpen(true);
    }
  };

  if (asChild) {
    // Clone the child and add onClick
    return (
      <div
        ref={triggerRef}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn('cursor-pointer inline-flex', className)}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={isOpen ? menuId : undefined}
        aria-label={ariaLabel}
      >
        {children}
      </div>
    );
  }

  return (
    <div ref={triggerRef}>
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={isOpen ? menuId : undefined}
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center gap-2 px-3 py-2.5 sm:py-2 text-sm rounded-md min-h-[44px] sm:min-h-0',
          'bg-background-elevated border border-border-primary',
          'hover:bg-background-tertiary text-text-primary',
          'transition-colors',
          className
        )}
      >
        {children}
        <ChevronDown
          className={cn(
            'w-4 h-4 text-text-muted transition-transform',
            isOpen && 'rotate-180'
          )}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

// Dropdown menu container
interface DropdownMenuProps {
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right';
  sideOffset?: number;
}

export function DropdownMenu({
  children,
  className,
  align = 'right',
  sideOffset = 4,
}: DropdownMenuProps) {
  const { isOpen, triggerRef, menuId, activeIndex, setActiveIndex, menuItemsRef, close } = useDropdownContext();
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Handle client-side mounting for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Calculate position when opening
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 180; // min-width of the menu

      let left: number;
      if (align === 'left') {
        left = rect.left;
      } else {
        left = rect.right - menuWidth;
      }

      // Ensure menu doesn't go off-screen horizontally
      if (left < 8) {
        left = 8;
      } else if (left + menuWidth > window.innerWidth - 8) {
        left = window.innerWidth - menuWidth - 8;
      }

      // Calculate vertical position - prefer below, but flip if not enough space
      let top = rect.bottom + sideOffset;
      const menuHeight = menuRef.current?.offsetHeight || 150; // Estimate if not yet rendered

      if (top + menuHeight > window.innerHeight - 8) {
        // Not enough space below, try above
        top = rect.top - menuHeight - sideOffset;
        if (top < 8) {
          // Not enough space above either, position at bottom of viewport
          top = window.innerHeight - menuHeight - 8;
        }
      }

      setPosition({ top, left });
    }
  }, [isOpen, triggerRef, align, sideOffset]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const items = menuItemsRef.current.filter(Boolean);
    const itemCount = items.length;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % itemCount);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((prev) => (prev - 1 + itemCount) % itemCount);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(itemCount - 1);
        break;
      case 'Tab':
        close();
        break;
    }
  }, [setActiveIndex, menuItemsRef, close]);

  // Focus active item when activeIndex changes
  useEffect(() => {
    if (isOpen && activeIndex >= 0) {
      const items = menuItemsRef.current.filter(Boolean);
      items[activeIndex]?.focus();
    }
  }, [isOpen, activeIndex, menuItemsRef]);

  if (!isOpen || !mounted) return null;

  const menuContent = (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-orientation="vertical"
      data-dropdown-menu
      onKeyDown={handleKeyDown}
      className={cn(
        'fixed z-[100] min-w-[180px] py-1.5 rounded-xl',
        'bg-background-elevated border border-border-primary shadow-elevation-2',
        'animate-fade-in',
        className
      )}
      style={{ top: position.top, left: position.left }}
    >
      {children}
    </div>
  );

  return createPortal(menuContent, document.body);
}

// Dropdown menu item
interface DropdownItemProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  icon?: ReactNode;
}

export function DropdownItem({
  children,
  className,
  onClick,
  disabled,
  destructive,
  icon,
}: DropdownItemProps) {
  const { close, registerMenuItem, menuItemsRef } = useDropdownContext();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Register this item with the menu for keyboard navigation
  useEffect(() => {
    if (buttonRef.current) {
      const currentIndex = menuItemsRef.current.length;
      registerMenuItem(currentIndex, buttonRef.current);
    }
  }, [registerMenuItem, menuItemsRef]);

  const handleClick = () => {
    if (disabled) return;
    onClick?.();
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      role="menuitem"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      tabIndex={-1}
      className={cn(
        'w-full flex items-center gap-2.5 px-3.5 py-2.5 sm:py-2 text-sm text-left min-h-[44px] sm:min-h-0',
        'hover:bg-background-tertiary focus:bg-background-tertiary focus:outline-none transition-colors',
        disabled && 'opacity-50 cursor-not-allowed',
        destructive ? 'text-status-error' : 'text-text-primary',
        className
      )}
    >
      {icon && <span className="w-4 h-4 flex-shrink-0" aria-hidden="true">{icon}</span>}
      {children}
    </button>
  );
}

// Dropdown separator
export function DropdownSeparator({ className }: { className?: string }) {
  return <div className={cn('my-1 border-t border-border-primary', className)} />;
}

// Dropdown label (non-interactive)
export function DropdownLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'px-3 py-1.5 text-xs font-medium text-text-tertiary uppercase tracking-wider',
        className
      )}
    >
      {children}
    </div>
  );
}
