/**
 * @file css5/math-functions.ts
 * CSS Math Functions: calc(), clamp(), min(), max()
 *
 * Evaluates CSS math expressions when operands share the same unit.
 * Mixed-unit expressions (e.g., calc(100% - 20px)) are preserved as-is
 * for the layout engine to resolve.
 *
 * Supports:
 * - calc(): arithmetic with +, -, *, /
 * - min(a, b, ...): returns smallest value
 * - max(a, b, ...): returns largest value
 * - clamp(min, val, max): returns clamped value
 * - Nested expressions and parentheses
 * - Unit conversion for compatible units (px, pt, em, rem, %, vw, vh, etc.)
 */

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN TYPES
// ─────────────────────────────────────────────────────────────────────────────

const enum MathTokenType {
  Number = 'number',
  Dimension = 'dimension',    // 10px, 2em
  Percentage = 'percentage',  // 50%
  Ident = 'ident',            // auto, min, max, calc, clamp
  Plus = '+',
  Minus = '-',
  Multiply = '*',
  Divide = '/',
  ParenOpen = '(',
  ParenClose = ')',
  Comma = ',',
  EOF = 'eof',
}

interface MathToken {
  type: MathTokenType;
  value: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIT CONVERSION TABLE
// ─────────────────────────────────────────────────────────────────────────────

// All units expressed relative to px at default browser settings
const UNIT_TO_PX: Record<string, (value: number, ctx: MathResolutionContext) => number> = {
  'px': (v) => v,
  'pt': (v) => v * (96 / 72),          // 1pt = 96/72 px
  'pc': (v) => v * 16,                 // 1pc = 12pt = 16px
  'in': (v) => v * 96,                 // 1in = 96px
  'cm': (v) => v * (96 / 2.54),        // 1cm = 96/2.54 px
  'mm': (v) => v * (96 / 25.4),        // 1mm = 96/25.4 px
  'Q':  (v) => v * (96 / 101.6),       // 1Q = 1mm/4
  'em': (v, ctx) => v * (ctx.fontSize ?? 16),
  'rem': (v, ctx) => v * (ctx.rootFontSize ?? 16),
  'ex': (v, ctx) => v * (ctx.fontSize ?? 16) * 0.5,  // approx
  'ch': (v, ctx) => v * (ctx.fontSize ?? 16) * 0.5,  // approx
  'vw': (v, ctx) => v * (ctx.viewportWidth ?? 1920) / 100,
  'vh': (v, ctx) => v * (ctx.viewportHeight ?? 1080) / 100,
  'vmin': (v, ctx) => {
    const min = Math.min(ctx.viewportWidth ?? 1920, ctx.viewportHeight ?? 1080);
    return v * min / 100;
  },
  'vmax': (v, ctx) => {
    const max = Math.max(ctx.viewportWidth ?? 1920, ctx.viewportHeight ?? 1080);
    return v * max / 100;
  },
  'dvw': (v, ctx) => v * (ctx.viewportWidth ?? 1920) / 100,  // dynamic viewport
  'dvh': (v, ctx) => v * (ctx.viewportHeight ?? 1080) / 100,
  'svw': (v, ctx) => v * (ctx.viewportWidth ?? 1920) / 100,  // small viewport
  'svh': (v, ctx) => v * (ctx.viewportHeight ?? 1080) / 100,
  'lvw': (v, ctx) => v * (ctx.viewportWidth ?? 1920) / 100,  // large viewport
  'lvh': (v, ctx) => v * (ctx.viewportHeight ?? 1080) / 100,
  'cqw': (v, ctx) => v * (ctx.containerWidth ?? 1920) / 100, // container queries
  'cqh': (v, ctx) => v * (ctx.containerHeight ?? 1080) / 100,
  'fr': (v) => v,  // flex grid fraction — resolved during layout
  'deg': (v) => v,
  'rad': (v) => v * (180 / Math.PI),
  'grad': (v) => v * 0.9,
  'turn': (v) => v * 360,
  's':  (v) => v,
  'ms': (v) => v / 1000,
  'Hz': (v) => v,
  'kHz': (v) => v * 1000,
  'dpi': (v) => v,
  'dpcm': (v) => v * 2.54,
  'dppx': (v) => v * 96,
  'x':  (v) => v * 96,  // alias for dppx
  '%': (v, ctx) => {
    // Percentage resolution is property-dependent — cannot be resolved generically.
    // Only used when BOTH operands are % (same-unit shortcut in evaluateNode).
    return null as unknown as number;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export interface MathResolutionContext {
  /** Element's computed font-size in px (default: 16). */
  readonly fontSize?: number;
  /** Root font-size in px (default: 16). */
  readonly rootFontSize?: number;
  /** Viewport width in px (default: 1920). */
  readonly viewportWidth?: number;
  /** Viewport height in px (default: 1080). */
  readonly viewportHeight?: number;
  /** Container width in px (for container queries). */
  readonly containerWidth?: number;
  /** Container height in px. */
  readonly containerHeight?: number;
  /** Percentage basis — the reference value for percentage resolution. */
  readonly percentageBasis?: number;
}

const DEFAULT_MATH_CTX: MathResolutionContext = {
  fontSize: 16,
  rootFontSize: 16,
  viewportWidth: 1920,
  viewportHeight: 1080,
  percentageBasis: 100,
};

// ─────────────────────────────────────────────────────────────────────────────
// AST NODES
// ─────────────────────────────────────────────────────────────────────────────

type MathNode =
  | { type: 'number'; value: number; unit: string }
  | { type: 'operator'; op: '+' | '-' | '*' | '/'; left: MathNode; right: MathNode }
  | { type: 'function'; name: string; args: MathNode[] }
  | { type: 'unresolved'; raw: string };

// ─────────────────────────────────────────────────────────────────────────────
// TOKENIZER
// ─────────────────────────────────────────────────────────────────────────────

function tokenizeMath(input: string): MathToken[] {
  const tokens: MathToken[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    // Skip whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Numbers (including negative)
    if (ch >= '0' && ch <= '9' || (ch === '.' && i + 1 < input.length && input[i + 1]! >= '0' && input[i + 1]! <= '9')) {
      let num = '';
      while (i < input.length && (input[i]! >= '0' && input[i]! <= '9' || input[i]! === '.')) {
        num += input[i]!;
        i++;
      }
      // Check for unit
      let unit = '';
      if (i < input.length && input[i]! !== ' ' && input[i]! !== ')' && input[i]! !== ',' && input[i]! !== '+' && input[i]! !== '-') {
        while (i < input.length && /[a-zA-Z%]/.test(input[i]!)) {
          unit += input[i]!;
          i++;
        }
        if (unit === '%') {
          tokens.push({ type: MathTokenType.Percentage, value: num });
        } else if (unit) {
          tokens.push({ type: MathTokenType.Dimension, value: `${num}${unit}` });
        } else {
          tokens.push({ type: MathTokenType.Number, value: num });
        }
      } else {
        tokens.push({ type: MathTokenType.Number, value: num });
      }
      continue;
    }

    // Handle +/- as unary or binary (simplified: always push as operator)
    if (ch === '+') { tokens.push({ type: MathTokenType.Plus, value: '+' }); i++; continue; }
    if (ch === '-') {
      // Check if this is a negative number (unary minus followed by digit or dot)
      if (i + 1 < input.length && (input[i + 1]! >= '0' && input[i + 1]! <= '9' || input[i + 1]! === '.')) {
        let num = '-';
        i++;
        while (i < input.length && (input[i]! >= '0' && input[i]! <= '9' || input[i]! === '.')) {
          num += input[i]!;
          i++;
        }
        let unit = '';
        if (i < input.length && input[i]! !== ' ' && input[i]! !== ')' && input[i]! !== ',' && input[i]! !== '+' && input[i]! !== '-') {
          while (i < input.length && /[a-zA-Z%]/.test(input[i]!)) {
            unit += input[i]!;
            i++;
          }
          if (unit === '%') {
            tokens.push({ type: MathTokenType.Percentage, value: num });
          } else if (unit) {
            tokens.push({ type: MathTokenType.Dimension, value: `${num}${unit}` });
          } else {
            tokens.push({ type: MathTokenType.Number, value: num });
          }
        } else {
          tokens.push({ type: MathTokenType.Number, value: num });
        }
      } else {
        tokens.push({ type: MathTokenType.Minus, value: '-' });
        i++;
      }
      continue;
    }
    if (ch === '*') { tokens.push({ type: MathTokenType.Multiply, value: '*' }); i++; continue; }
    if (ch === '/') { tokens.push({ type: MathTokenType.Divide, value: '/' }); i++; continue; }
    if (ch === '(') { tokens.push({ type: MathTokenType.ParenOpen, value: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: MathTokenType.ParenClose, value: ')' }); i++; continue; }
    if (ch === ',') { tokens.push({ type: MathTokenType.Comma, value: ',' }); i++; continue; }

    // Ident (function names, keywords)
    if (/[a-zA-Z_-]/.test(ch)) {
      let ident = '';
      while (i < input.length && /[a-zA-Z0-9_-]/.test(input[i]!)) {
        ident += input[i]!;
        i++;
      }
      tokens.push({ type: MathTokenType.Ident, value: ident });
      continue;
    }

    // Unknown character — skip
    i++;
  }

  tokens.push({ type: MathTokenType.EOF, value: '' });
  return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER (Recursive Descent — operator precedence)
// ─────────────────────────────────────────────────────────────────────────────

class MathParser {
  private pos = 0;
  private tokens: MathToken[];

  constructor(tokens: MathToken[]) {
    this.tokens = tokens;
  }

  private peek(): MathToken {
    return this.tokens[this.pos] ?? { type: MathTokenType.EOF, value: '' };
  }

  private advance(): MathToken {
    const tok = this.tokens[this.pos]!;
    this.pos++;
    return tok;
  }

  private expect(type: MathTokenType): MathToken {
    const tok = this.peek();
    if (tok.type !== type) {
      throw new Error(`Expected ${type}, got ${tok.type} (${tok.value})`);
    }
    return this.advance();
  }

  /**
   * Parse a full expression (comma-separated for functions, or single expression).
   */
  parseExpressionList(): MathNode[] {
    const nodes: MathNode[] = [];
    nodes.push(this.parseAddSub());
    while (this.peek().type === MathTokenType.Comma) {
      this.advance(); // skip comma
      nodes.push(this.parseAddSub());
    }
    return nodes;
  }

  /**
   * Addition and subtraction (lowest precedence).
   */
  parseAddSub(): MathNode {
    let left = this.parseMulDiv();

    while (this.peek().type === MathTokenType.Plus || this.peek().type === MathTokenType.Minus) {
      const op = this.advance().type === MathTokenType.Plus ? '+' : '-';
      const right = this.parseMulDiv();
      left = { type: 'operator', op, left, right };
    }

    return left;
  }

  /**
   * Multiplication and division (higher precedence).
   */
  parseMulDiv(): MathNode {
    let left = this.parseUnary();

    while (this.peek().type === MathTokenType.Multiply || this.peek().type === MathTokenType.Divide) {
      const op = this.advance().type === MathTokenType.Multiply ? '*' : '/';
      const right = this.parseUnary();
      left = { type: 'operator', op, left, right };
    }

    return left;
  }

  /**
   * Unary plus/minus.
   */
  parseUnary(): MathNode {
    if (this.peek().type === MathTokenType.Minus) {
      this.advance();
      const operand = this.parsePrimary();
      return {
        type: 'operator',
        op: '*',
        left: { type: 'number', value: -1, unit: '' },
        right: operand,
      };
    }
    if (this.peek().type === MathTokenType.Plus) {
      this.advance();
      return this.parsePrimary();
    }
    return this.parsePrimary();
  }

  /**
   * Primary: number, dimension, percentage, function call, or parenthesized expression.
   */
  parsePrimary(): MathNode {
    const tok = this.peek();

    // Number
    if (tok.type === MathTokenType.Number) {
      this.advance();
      return { type: 'number', value: parseFloat(tok.value), unit: '' };
    }

    // Dimension (e.g., 10px)
    if (tok.type === MathTokenType.Dimension) {
      this.advance();
      const match = tok.value.match(/^(-?[\d.]+)([a-zA-Z%]+)$/);
      if (match) {
        return { type: 'number', value: parseFloat(match[1]!), unit: match[2]! };
      }
      return { type: 'unresolved', raw: tok.value };
    }

    // Percentage
    if (tok.type === MathTokenType.Percentage) {
      this.advance();
      return { type: 'number', value: parseFloat(tok.value), unit: '%' };
    }

    // Function call: calc(), min(), max(), clamp()
    if (tok.type === MathTokenType.Ident && tok.value.toLowerCase() === 'calc') {
      this.advance();
      this.expect(MathTokenType.ParenOpen);
      const node = this.parseAddSub();
      this.expect(MathTokenType.ParenClose);
      return node;
    }

    if (tok.type === MathTokenType.Ident && (tok.value.toLowerCase() === 'min' || tok.value.toLowerCase() === 'max' || tok.value.toLowerCase() === 'clamp')) {
      const name = tok.value.toLowerCase();
      this.advance();
      this.expect(MathTokenType.ParenOpen);
      const args = this.parseExpressionList();
      this.expect(MathTokenType.ParenClose);
      return { type: 'function', name, args };
    }

    // Parenthesized expression
    if (tok.type === MathTokenType.ParenOpen) {
      this.advance();
      const node = this.parseAddSub();
      this.expect(MathTokenType.ParenClose);
      return node;
    }

    // Unresolved token — return as raw
    this.advance();
    return { type: 'unresolved', raw: tok.value };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVALUATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a value with a unit to its px equivalent using the context.
 */
function resolveToPx(value: number, unit: string, ctx: MathResolutionContext): number | null {
  if (unit === '') return value; // unitless
  const converter = UNIT_TO_PX[unit];
  if (!converter) return null;
  return converter(value, ctx);
}

/**
 * Returns the "better" unit for the result — prefer the unit of the first operand.
 */
function getResultUnit(a: string, b: string): string {
  if (a === b) return a;
  if (a === '') return b;
  if (b === '') return a;
  // Prefer the non-empty, non-% unit
  if (a === '%') return b;
  if (b === '%') return a;
  // Prefer px for compatible physical units
  if (a === 'px' || b === 'px') return 'px';
  return a; // default to first operand's unit
}

/**
 * Evaluates a math AST node and returns the result if fully resolvable.
 * Returns null if the expression contains unresolved units.
 */
function evaluateNode(node: MathNode, ctx: MathResolutionContext): { value: number; unit: string } | null {
  switch (node.type) {
    case 'number': {
      return { value: node.value, unit: node.unit };
    }

    case 'operator': {
      const left = evaluateNode(node.left, ctx);
      const right = evaluateNode(node.right, ctx);
      if (!left || !right) return null;

      // For addition/subtraction, units must be compatible
      if (node.op === '+' || node.op === '-') {
        // Same unit — direct arithmetic
        if (left.unit === right.unit) {
          const resultValue = node.op === '+' ? left.value + right.value : left.value - right.value;
          return { value: Math.round(resultValue * 10000) / 10000, unit: left.unit };
        }

        // Different units — try to convert both to px
        const leftPx = resolveToPx(left.value, left.unit, ctx);
        const rightPx = resolveToPx(right.value, right.unit, ctx);
        if (leftPx === null || rightPx === null) return null;

        const resultPx = node.op === '+' ? leftPx + rightPx : leftPx - rightPx;

        // If units are compatible (same physical dimension), express in the more specific unit.
        // For mixed relative/absolute (em+px), always return px.
        const leftIsPhysical = ['px', 'pt', 'pc', 'in', 'cm', 'mm'].includes(left.unit);
        const rightIsPhysical = ['px', 'pt', 'pc', 'in', 'cm', 'mm'].includes(right.unit);
        const leftIsRelative = ['em', 'rem', 'ex', 'ch'].includes(left.unit);
        const rightIsRelative = ['em', 'rem', 'ex', 'ch'].includes(right.unit);

        // If the first operand's unit can be converted back from px, use it
        // But NOT if the other operand has a different dimensional reference
        if (left.unit && leftIsPhysical && rightIsPhysical) {
          // Both physical — use the first operand's unit
          const converter = UNIT_TO_PX[left.unit];
          if (converter) {
            const pxPerUnit = converter(1, ctx);
            const resultInUnit = resultPx / pxPerUnit;
            const rounded = Math.round(resultInUnit * 10000) / 10000;
            return { value: rounded, unit: left.unit };
          }
        }
        // Mixed relative+absolute or relative+relative → return px
        return { value: Math.round(resultPx * 10000) / 10000, unit: 'px' };
      }

      // For multiplication, one operand must be unitless
      if (node.op === '*') {
        if (left.unit === '' && right.unit === '') {
          return { value: left.value * right.value, unit: '' };
        }
        if (left.unit === '') {
          return { value: left.value * right.value, unit: right.unit };
        }
        if (right.unit === '') {
          return { value: left.value * right.value, unit: left.unit };
        }
        // Both have units — can't multiply (e.g., px * px is invalid in CSS)
        return null;
      }

      // For division, divisor must be unitless
      if (node.op === '/') {
        if (right.unit === '' && right.value !== 0) {
          return { value: left.value / right.value, unit: left.unit };
        }
        // Division by a dimension is not valid in CSS calc()
        return null;
      }

      return null;
    }

    case 'function': {
      if (node.name === 'min' || node.name === 'max') {
        // Evaluate all arguments and find min/max in px
        const evaluated = node.args.map((arg) => {
          const result = evaluateNode(arg, ctx);
          if (!result) return null;
          const px = resolveToPx(result.value, result.unit, ctx);
          if (px === null) return null;
          return { px, unit: result.unit, original: result };
        });

        if (evaluated.some((e) => e === null)) return null;

        const values = evaluated as Array<{ px: number; unit: string; original: { value: number; unit: string } }>;
        const best = node.name === 'min'
          ? values.reduce((a, b) => a.px <= b.px ? a : b)
          : values.reduce((a, b) => a.px >= b.px ? a : b);

        return best.original;
      }

      if (node.name === 'clamp') {
        if (node.args.length !== 3) return null;
        const min = evaluateNode(node.args[0]!, ctx);
        const val = evaluateNode(node.args[1]!, ctx);
        const max = evaluateNode(node.args[2]!, ctx);
        if (!min || !val || !max) return null;

        const minPx = resolveToPx(min.value, min.unit, ctx);
        const valPx = resolveToPx(val.value, val.unit, ctx);
        const maxPx = resolveToPx(max.value, max.unit, ctx);
        if (minPx === null || valPx === null || maxPx === null) return null;

        const clamped = Math.min(Math.max(valPx, minPx), maxPx);

        // Express in the val's unit if possible
        if (val.unit) {
          const converter = UNIT_TO_PX[val.unit];
          if (converter) {
            const pxPerUnit = converter(1, ctx);
            const resultInUnit = clamped / pxPerUnit;
            const rounded = Math.round(resultInUnit * 10000) / 10000;
            return { value: rounded, unit: val.unit };
          }
        }
        return { value: clamped, unit: 'px' };
      }

      return null;
    }

    case 'unresolved':
      return null;
  }
}

/**
 * Formats a result value with its unit.
 */
function formatResult(result: { value: number; unit: string }): string {
  if (result.unit === '') {
    // Unitless — round to reasonable precision
    return String(Math.round(result.value * 10000) / 10000);
  }
  const rounded = Math.round(result.value * 10000) / 10000;
  return `${rounded}${result.unit}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks if a CSS value contains math functions.
 */
export function hasMathFunctions(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes('calc(') || lower.includes('min(') || lower.includes('max(') || lower.includes('clamp(');
}

/**
 * Evaluates a CSS math expression and returns the result if fully resolvable.
 * Returns null if the expression contains mixed units that can't be resolved.
 *
 * @param expression - CSS math expression (e.g., "calc(10px + 5px)")
 * @param context    - Resolution context for unit conversion
 * @returns          - Resolved value string, or null if unresolvable
 */
export function evaluateMathExpression(
  expression: string,
  context?: MathResolutionContext,
): string | null {
  const ctx = { ...DEFAULT_MATH_CTX, ...context };

  try {
    const tokens = tokenizeMath(expression);
    const parser = new MathParser(tokens);
    const ast = parser.parseAddSub();
    const result = evaluateNode(ast, ctx);
    if (result) {
      return formatResult(result);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves math functions (calc, min, max, clamp) in a CSS value string.
 * Resolves when possible, leaves as-is when units are mixed.
 *
 * Strategy: iteratively find the innermost (deepest) math function call,
 * evaluate it, substitute the result, repeat until no more math functions.
 *
 * @param value    - CSS value string potentially containing math functions
 * @param context  - Resolution context
 * @returns        - Resolved value or original if unresolvable
 */
export function resolveMathFunctions(
  value: string,
  context?: MathResolutionContext,
): string {
  if (!hasMathFunctions(value)) return value;

  const ctx: MathResolutionContext = { ...DEFAULT_MATH_CTX, ...context };

  let result = value;
  let maxIterations = 20;

  while (hasMathFunctions(result) && maxIterations-- > 0) {
    const replacement = resolveInnermostFunction(result, ctx);
    if (replacement === result) break; // No progress
    result = replacement;
  }

  return result;
}

/**
 * Finds and evaluates the innermost math function in a value string.
 * An innermost function is one whose arguments contain no nested functions.
 */
function resolveInnermostFunction(value: string, ctx: MathResolutionContext): string {
  let i = 0;
  while (i < value.length) {
    const nameMatch = value.slice(i).match(/^(calc|min|max|clamp)\s*\(/i);
    if (nameMatch) {
      const name = nameMatch[1]!.toLowerCase();
      const openParenIdx = i + nameMatch[0].length - 1; // index of the '('
      const closeParenIdx = findMatchingParen(value, openParenIdx);
      if (closeParenIdx >= 0) {
        const argsContent = value.slice(openParenIdx + 1, closeParenIdx);
        const hasNested = /(calc|min|max|clamp)\s*\(/i.test(argsContent);
        if (!hasNested) {
          const evaluated = evaluateFunction(name, argsContent, ctx);
          if (evaluated !== null) {
            return value.slice(0, i) + evaluated + value.slice(closeParenIdx + 1);
          }
        }
      }
    }
    i++;
  }
  return value;
}

/**
 * Finds the matching closing paren starting from an opening paren.
 * Returns the index of the matching ')', or -1 if unmatched.
 */
function findMatchingParen(value: string, openParenIndex: number): number {
  let depth = 0;
  for (let i = openParenIndex; i < value.length; i++) {
    if (value[i] === '(') depth++;
    if (value[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1; // Unmatched
}

/**
 * Evaluates a named CSS math function with its arguments string.
 */
function evaluateFunction(
  name: string,
  argsStr: string,
  ctx: MathResolutionContext,
): string | null {
  if (name === 'calc') {
    const result = evaluateMathExpression(argsStr, ctx);
    return result;
  }

  if (name === 'min' || name === 'max') {
    const argList = splitTopLevelCommas(argsStr);
    const evaluated = argList.map((arg) => {
      const trimmed = arg.trim();
      return evaluateMathExpression(trimmed, ctx) ?? trimmed;
    });

    // Parse all evaluated args into {value, unit}
    const values = evaluated.map((e) => {
      const m = e.match(/^(-?[\d.]+)([a-zA-Z%]+)$/);
      if (m) return { value: parseFloat(m[1]!), unit: m[2]! };
      const nm = e.match(/^(-?[\d.]+)$/);
      if (nm) return { value: parseFloat(nm[1]!), unit: '' };
      return null;
    });

    if (values.some((v) => v === null)) return null;

    const nums = values as Array<{ value: number; unit: string }>;
    const best = name === 'min'
      ? nums.reduce((a, b) => {
          const aPx = resolveToPx(a.value, a.unit, ctx);
          const bPx = resolveToPx(b.value, b.unit, ctx);
          if (aPx !== null && bPx !== null) return aPx <= bPx ? a : b;
          return a;
        })
      : nums.reduce((a, b) => {
          const aPx = resolveToPx(a.value, a.unit, ctx);
          const bPx = resolveToPx(b.value, b.unit, ctx);
          if (aPx !== null && bPx !== null) return aPx >= bPx ? a : b;
          return a;
        });

    return formatResult(best);
  }

  if (name === 'clamp') {
    const argList = splitTopLevelCommas(argsStr);
    if (argList.length !== 3) return null;

    const minStr = evaluateMathExpression(argList[0]!.trim(), ctx);
    const valStr = evaluateMathExpression(argList[1]!.trim(), ctx);
    const maxStr = evaluateMathExpression(argList[2]!.trim(), ctx);
    if (!minStr || !valStr || !maxStr) return null;

    // Parse all three
    const parseVal = (s: string) => {
      const m = s.match(/^(-?[\d.]+)([a-zA-Z%]+)$/);
      if (m) return { value: parseFloat(m[1]!), unit: m[2]! };
      const nm = s.match(/^(-?[\d.]+)$/);
      if (nm) return { value: parseFloat(nm[1]!), unit: '' };
      return null;
    };

    const minV = parseVal(minStr);
    const valV = parseVal(valStr);
    const maxV = parseVal(maxStr);
    if (!minV || !valV || !maxV) return null;

    const minPx = resolveToPx(minV.value, minV.unit, ctx);
    const valPx = resolveToPx(valV.value, valV.unit, ctx);
    const maxPx = resolveToPx(maxV.value, maxV.unit, ctx);
    if (minPx === null || valPx === null || maxPx === null) return null;

    const clamped = Math.min(Math.max(valPx, minPx), maxPx);

    // Express in the val's unit
    if (valV.unit) {
      const converter = UNIT_TO_PX[valV.unit];
      if (converter) {
        const pxPerUnit = converter(1, ctx);
        const resultInUnit = clamped / pxPerUnit;
        const rounded = Math.round(resultInUnit * 10000) / 10000;
        return `${rounded}${valV.unit}`;
      }
    }
    return `${Math.round(clamped * 10000) / 10000}px`;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Splits a CSS function's arguments on top-level commas (respecting parentheses).
 */
function splitTopLevelCommas(args: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;
  let inQuote: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const ch = args[i]!;

    if (inQuote) {
      if (ch === inQuote && args[i - 1] !== '\\') inQuote = null;
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
      continue;
    }

    if (ch === '(') depth++;
    if (ch === ')') depth--;

    if (ch === ',' && depth === 0) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current) result.push(current);
  return result;
}
