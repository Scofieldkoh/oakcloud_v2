'use client';

import { useEffect, useRef, type RefObject } from 'react';

type Handler = (event: MouseEvent | TouchEvent) => void;

/**
 * Hook that triggers a callback when clicking outside of the referenced element
 *
 * @param handler - Callback function to execute when clicking outside
 * @param enabled - Whether the hook is active (default: true)
 * @returns A ref to attach to the element you want to detect outside clicks for
 *
 * @example
 * ```tsx
 * function Dropdown() {
 *   const [isOpen, setIsOpen] = useState(false);
 *   const ref = useClickOutside(() => setIsOpen(false), isOpen);
 *
 *   return (
 *     <div ref={ref}>
 *       <button onClick={() => setIsOpen(!isOpen)}>Toggle</button>
 *       {isOpen && <div>Dropdown content</div>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  handler: Handler,
  enabled: boolean = true
): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!enabled) return;

    const listener = (event: MouseEvent | TouchEvent) => {
      const el = ref.current;

      // Do nothing if clicking ref's element or descendent elements
      if (!el || el.contains(event.target as Node)) {
        return;
      }

      handler(event);
    };

    // Use mousedown/touchstart for immediate response
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);

    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [handler, enabled]);

  return ref;
}

/**
 * Hook that triggers a callback when clicking outside of multiple referenced elements
 *
 * @param handler - Callback function to execute when clicking outside
 * @param enabled - Whether the hook is active (default: true)
 * @returns An array of refs to attach to elements you want to exclude from outside click detection
 *
 * @example
 * ```tsx
 * function Popover() {
 *   const [isOpen, setIsOpen] = useState(false);
 *   const [triggerRef, contentRef] = useClickOutsideMultiple(() => setIsOpen(false), isOpen);
 *
 *   return (
 *     <>
 *       <button ref={triggerRef} onClick={() => setIsOpen(!isOpen)}>Toggle</button>
 *       {isOpen && <div ref={contentRef}>Popover content</div>}
 *     </>
 *   );
 * }
 * ```
 */
export function useClickOutsideMultiple<T extends HTMLElement = HTMLElement>(
  handler: Handler,
  enabled: boolean = true,
  count: number = 2
): RefObject<T | null>[] {
  // Create refs array only once and store it in a ref to prevent
  // recreation on every render (which would cause infinite loops)
  const refsContainer = useRef<RefObject<T | null>[]>([]);

  // Initialize refs array if empty or count changed
  if (refsContainer.current.length !== count) {
    refsContainer.current = Array.from({ length: count }, () => ({ current: null }));
  }

  const refs = refsContainer.current;

  useEffect(() => {
    if (!enabled) return;

    const listener = (event: MouseEvent | TouchEvent) => {
      // Check if click is inside any of the refs
      const isInside = refs.some((ref) => {
        const el = ref.current;
        return el && el.contains(event.target as Node);
      });

      if (!isInside) {
        handler(event);
      }
    };

    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);

    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
    // refs is stable since it's stored in refsContainer.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handler, enabled]);

  return refs;
}
