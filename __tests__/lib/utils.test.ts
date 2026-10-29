import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('Utils', () => {
  describe('cn (classname merger)', () => {
    it('should merge class names', () => {
      const result = cn('base-class', 'additional-class');
      expect(result).toBe('base-class additional-class');
    });

    it('should handle conditional classes', () => {
      const isActive = true;
      const result = cn('base', isActive && 'active');
      expect(result).toBe('base active');
    });

    it('should filter out falsy values', () => {
      const result = cn('base', false, null, undefined, 'end');
      expect(result).toBe('base end');
    });

    it('should handle Tailwind merge conflicts', () => {
      // tailwind-merge should deduplicate conflicting classes
      const result = cn('px-2', 'px-4');
      expect(result).toBe('px-4');
    });

    it('should handle empty input', () => {
      const result = cn();
      expect(result).toBe('');
    });
  });
});
