import { evaluateArithmeticExpression } from '@/lib/safe-math';
import { describe, expect, it } from 'vitest';

describe('evaluateArithmeticExpression', () => {
  describe('basic arithmetic', () => {
    it('evaluates addition', () => expect(evaluateArithmeticExpression('1 + 2')).toBe(3));
    it('evaluates subtraction', () => expect(evaluateArithmeticExpression('5 - 3')).toBe(2));
    it('evaluates multiplication', () => expect(evaluateArithmeticExpression('4 * 3')).toBe(12));
    it('evaluates division', () => expect(evaluateArithmeticExpression('10 / 4')).toBe(2.5));
    it('evaluates integer literal', () => expect(evaluateArithmeticExpression('42')).toBe(42));
    it('evaluates decimal literal', () => expect(evaluateArithmeticExpression('3.14')).toBe(3.14));
  });

  describe('operator precedence', () => {
    it('multiplies before adding', () => expect(evaluateArithmeticExpression('2 + 3 * 4')).toBe(14));
    it('divides before subtracting', () => expect(evaluateArithmeticExpression('10 - 6 / 2')).toBe(7));
    it('respects left-to-right for same precedence', () => expect(evaluateArithmeticExpression('10 - 3 - 2')).toBe(5));
  });

  describe('parentheses', () => {
    it('overrides precedence with parens', () => expect(evaluateArithmeticExpression('(2 + 3) * 4')).toBe(20));
    it('handles nested parens', () => expect(evaluateArithmeticExpression('((2 + 3) * (1 + 1))')).toBe(10));
    it('handles deeply nested parens', () => expect(evaluateArithmeticExpression('(((5)))')).toBe(5));
  });

  describe('unary minus', () => {
    it('handles leading unary minus', () => expect(evaluateArithmeticExpression('-3 + 5')).toBe(2));
    it('handles unary minus in parens', () => expect(evaluateArithmeticExpression('(-3) * 2')).toBe(-6));
  });

  describe('whitespace', () => {
    it('handles no spaces', () => expect(evaluateArithmeticExpression('1+2')).toBe(3));
    it('handles extra spaces', () => expect(evaluateArithmeticExpression('  4  *  3  ')).toBe(12));
  });

  describe('edge cases', () => {
    it('returns null for empty string', () => expect(evaluateArithmeticExpression('')).toBeNull());
    it('returns null for division by zero', () => expect(evaluateArithmeticExpression('1 / 0')).toBeNull());
    it('returns null for invalid expression', () => expect(evaluateArithmeticExpression('abc')).toBeNull());
    it('returns null for incomplete expression', () => expect(evaluateArithmeticExpression('1 +')).toBeNull());
    it('returns null for mismatched parens', () => expect(evaluateArithmeticExpression('(1 + 2')).toBeNull());
    it('returns null for extra closing paren', () => expect(evaluateArithmeticExpression('1 + 2)')).toBeNull());
    it('returns null for code injection attempt', () => expect(evaluateArithmeticExpression('process.exit(0)')).toBeNull());
    it('returns null for constructor injection', () => expect(evaluateArithmeticExpression('[].constructor')).toBeNull());
    it('returns null for NaN result', () => expect(evaluateArithmeticExpression('NaN')).toBeNull());
  });

  describe('formula validation use cases', () => {
    it('handles complex arithmetic formula', () => expect(evaluateArithmeticExpression('100 + 200 * 3 / 2')).toBe(400));
    it('handles resolved field references (numeric strings)', () => {
      // After field key substitution like [fieldKey] -> 42, expr becomes "42 * 2"
      expect(evaluateArithmeticExpression('42 * 2')).toBe(84);
    });
    it('handles NaN as resolved value (field not filled)', () => {
      // [fieldKey] resolves to NaN when field not answered
      expect(evaluateArithmeticExpression('NaN + 1')).toBeNull();
    });
  });
});
