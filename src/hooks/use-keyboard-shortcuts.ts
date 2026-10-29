'use client';

import { useEffect, useRef } from 'react';

export interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
  description: string;
}

/**
 * Hook to register keyboard shortcuts for the current component.
 * Automatically handles cleanup on unmount.
 *
 * @param shortcuts - Array of shortcut configurations
 * @param enabled - Whether shortcuts are active (default: true)
 */
export function useKeyboardShortcuts(shortcuts: ShortcutConfig[], enabled = true) {
  // Use refs to avoid re-creating event listeners on every render
  const shortcutsRef = useRef(shortcuts);
  const enabledRef = useRef(enabled);

  // Update refs when props change
  shortcutsRef.current = shortcuts;
  enabledRef.current = enabled;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!enabledRef.current) return;

      // Don't trigger shortcuts when typing in input fields
      const target = event.target as HTMLElement;
      const isInputField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;

      for (const shortcut of shortcutsRef.current) {
        const ctrlOrMeta = shortcut.ctrl || shortcut.meta;
        const matchesCtrlMeta = ctrlOrMeta
          ? (event.ctrlKey || event.metaKey)
          : (!event.ctrlKey && !event.metaKey);
        const matchesShift = shortcut.shift ? event.shiftKey : !event.shiftKey;
        const matchesAlt = shortcut.alt ? event.altKey : !event.altKey;

        if (
          event.key.toLowerCase() === shortcut.key.toLowerCase() &&
          matchesCtrlMeta &&
          matchesShift &&
          matchesAlt
        ) {
          const isBackspace = shortcut.key.toLowerCase() === 'backspace';

          // Avoid hijacking Ctrl+Backspace while typing
          if (isInputField && isBackspace) {
            continue;
          }

          // Skip non-modifier shortcuts if in input field, unless it's Escape
          if (isInputField && !ctrlOrMeta && shortcut.key.toLowerCase() !== 'escape') {
            continue;
          }

          event.preventDefault();
          shortcut.handler();
          break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []); // Empty deps - we use refs for everything
}
