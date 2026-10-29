/**
 * Safe arithmetic expression evaluator.
 * Supports: numbers, +, -, *, /, parentheses, whitespace.
 * No eval or Function() — implemented as a recursive descent parser.
 */

/**
 * Evaluate a simple arithmetic expression string.
 * Returns null if the expression is invalid or produces a non-finite result.
 */
export function evaluateArithmeticExpression(expr: string): number | null {
  const input = expr.trim();
  if (!input) return null;

  let pos = 0;

  function peek(): string {
    return input[pos] ?? '';
  }

  function skipWhitespace(): void {
    while (pos < input.length && input[pos] === ' ') pos++;
  }

  function parseNumber(): number | null {
    skipWhitespace();
    let numStr = '';
    if (peek() === '-' || peek() === '+') {
      numStr += input[pos++];
    }
    while (pos < input.length && (input[pos] >= '0' && input[pos] <= '9')) {
      numStr += input[pos++];
    }
    if (pos < input.length && input[pos] === '.') {
      numStr += input[pos++];
      while (pos < input.length && (input[pos] >= '0' && input[pos] <= '9')) {
        numStr += input[pos++];
      }
    }
    if (numStr === '' || numStr === '-' || numStr === '+') return null;
    const n = parseFloat(numStr);
    return isNaN(n) ? null : n;
  }

  // Forward declarations via wrapper functions
  function parseExpr(): number | null {
    return parseAddSub();
  }

  function parseAddSub(): number | null {
    let left = parseMulDiv();
    if (left === null) return null;

    while (true) {
      skipWhitespace();
      const op = peek();
      if (op !== '+' && op !== '-') break;
      pos++;
      const right = parseMulDiv();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseMulDiv(): number | null {
    let left = parseUnary();
    if (left === null) return null;

    while (true) {
      skipWhitespace();
      const op = peek();
      if (op !== '*' && op !== '/') break;
      pos++;
      const right = parseUnary();
      if (right === null) return null;
      if (op === '/') {
        if (right === 0) return null; // division by zero
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  function parseUnary(): number | null {
    skipWhitespace();
    if (peek() === '-') {
      pos++;
      const val = parsePrimary();
      return val === null ? null : -val;
    }
    if (peek() === '+') {
      pos++;
    }
    return parsePrimary();
  }

  function parsePrimary(): number | null {
    skipWhitespace();
    if (peek() === '(') {
      pos++; // consume '('
      const val = parseExpr();
      if (val === null) return null;
      skipWhitespace();
      if (peek() !== ')') return null; // missing closing paren
      pos++; // consume ')'
      return val;
    }
    return parseNumber();
  }

  const result = parseExpr();
  if (result === null) return null;

  // Ensure entire input was consumed
  skipWhitespace();
  if (pos !== input.length) return null;

  return Number.isFinite(result) ? result : null;
}
