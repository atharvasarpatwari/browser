import { TokenType, type Token } from './tokens';
import type * as AST from './ast';
import type { Lexer } from './lexer';

// ─────────────────────────────────────────────────────────────────────────────
// PARSER — Pratt parser for expressions, recursive descent for statements
// ─────────────────────────────────────────────────────────────────────────────

export class Parser {
  private tokens: Token[] = [];
  private pos = 0;
  private lexer?: Lexer;
  private templateDepth = 0;
  private strictStack: boolean[] = [];

  constructor(tokens: Token[], lexer?: Lexer) {
    if (lexer) {
      this.lexer = lexer;
    } else {
      this.tokens = tokens;
    }
  }

  parse(): AST.Program {
    // A leading `'use strict';` directive (extremely common in bundled/
    // transpiled real-world output) makes every function in the whole
    // program strict, not just ones that repeat their own directive —
    // pushed onto the same strictStack the with-statement check already
    // reads, so every function-parsing call site below inherits it for
    // free via the strictStack-or-own-directive check in lookaheadStrictDirective's callers.
    const programStrict = this.is(TokenType.String) && this.peek().value === 'use strict'
      && (this.peek(1).type === TokenType.Semicolon || this.peek(1).type === TokenType.EOF);
    if (programStrict) this.strictStack.push(true);
    const body: AST.Statement[] = [];
    while (!this.is(TokenType.EOF)) {
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
    }
    if (programStrict) this.strictStack.pop();
    return { type: 'Program', body };
  }

  /** Whether the enclosing scope (an already-strict function, or a
   *  program-level `'use strict'`) is currently strict — used so a nested
   *  function correctly inherits strictness without repeating its own
   *  directive, matching real JS's lexical strict-mode propagation. */
  private inStrictContext(): boolean {
    return this.strictStack.length > 0 && this.strictStack[this.strictStack.length - 1]!;
  }

  // ── Expression parsing (Pratt) ───────────────────────────────────────────

  private parseExpression(minPrec = 0): AST.Expression {
    // Handle async arrow: async (x) => expr or async x => expr
    if (this.is(TokenType.Async) && this.peek(1).type !== TokenType.Function) {
      const tok = this.peek();
      this.advance(); // consume 'async'
      const params: AST.Identifier[] = [];
      if (this.is(TokenType.LParen)) {
        this.advance();
        while (!this.is(TokenType.RParen) && !this.is(TokenType.EOF)) {
          if (this.is(TokenType.Comma)) { this.advance(); continue; }
          params.push({ type: 'Identifier', name: this.peek().value });
          this.advance();
        }
        this.expect(TokenType.RParen);
      } else if (this.is(TokenType.Identifier)) {
        params.push({ type: 'Identifier', name: this.peek().value });
        this.advance();
      }
      this.expect(TokenType.Arrow);
      let body: AST.BlockStatement | AST.Expression;
      if (this.is(TokenType.LBrace)) {
        body = this.parseBlock();
      } else {
        body = this.parseAssignExpr();
      }
      return { type: 'ArrowFunctionExpression', params, body, async: true, expression: !(body.type === 'BlockStatement'), loc: { line: tok.line, column: tok.column } };
    }

    let left = this.parsePrefix();

    // Arrow function: (x) => expr or x => expr
    if (this.is(TokenType.Arrow) && this.isValidArrowParams(left)) {
      return this.parseArrowFunctionFromParams(left);
    }

    while (!this.is(TokenType.EOF) && !this.is(TokenType.Semicolon) && !this.is(TokenType.RBrace) && !this.is(TokenType.RBracket) && !this.is(TokenType.RParen) && !this.is(TokenType.Colon)) {
      const prec = this.infixPrecedence(this.peek().type);
      if (prec === 0 || prec < minPrec) break;
      left = this.parseInfix(left, prec);
    }

    return left;
  }

  /** Parse an expression that stops at commas (for function args, object properties, array elements). */
  private parseAssignExpr(): AST.Expression {
    return this.parseExpression(2);
  }

  /**
   * A comma chain of 3+ items parses as a right-nested SequenceExpression
   * (`a,b,c` -> {a, {b, c}}, one pairwise node per comma), not a flat list —
   * see the Comma case in parseInfix(). Flatten it back out so arrow-param
   * detection/extraction below doesn't stop at the first nested level.
   */
  private flattenSequence(expr: AST.Expression): AST.Expression[] {
    if (expr.type !== 'SequenceExpression') return [expr];
    return expr.expressions.flatMap((e) => this.flattenSequence(e));
  }

  /**
   * Convert an expression parsed by the generic expression grammar into a
   * parameter/destructuring pattern — needed because `(a, {b, c = 1}) =>`
   * is only disambiguated from a parenthesized expression *after* it's
   * already been parsed as one (real arrow-function grammar is ambiguous
   * with a parenthesized expression until the `=>` is seen).
   */
  private expressionToPattern(expr: AST.Expression): AST.Identifier | AST.RestElement | AST.AssignmentPattern | AST.ArrayPattern | AST.ObjectPattern | null {
    if (expr.type === 'Identifier') return expr;
    if (expr.type === 'AssignmentExpression' && expr.operator === '=') {
      const left = this.expressionToPattern(expr.left as AST.Expression);
      if (!left || left.type === 'RestElement' || left.type === 'AssignmentPattern') return null;
      return { type: 'AssignmentPattern', left, right: expr.right, loc: expr.loc };
    }
    if (expr.type === 'SpreadElement') {
      const arg = this.expressionToPattern(expr.argument);
      if (!arg || arg.type === 'RestElement') return null;
      return { type: 'RestElement', argument: arg, loc: expr.loc };
    }
    if (expr.type === 'ArrayExpression') {
      const elements = expr.elements.map(e => e === null ? null : this.expressionToPattern(e));
      if (elements.some((e, i) => expr.elements[i] !== null && e === null)) return null;
      return { type: 'ArrayPattern', elements: elements as (AST.Identifier | AST.AssignmentPattern | AST.RestElement | AST.ArrayPattern | AST.ObjectPattern | null)[], loc: expr.loc };
    }
    if (expr.type === 'ObjectExpression') {
      const properties: (AST.ObjectPatternProperty | AST.RestElement)[] = [];
      for (const prop of expr.properties) {
        if (prop.type === 'SpreadElement') {
          const arg = this.expressionToPattern(prop.argument);
          if (!arg || arg.type === 'RestElement') return null;
          properties.push({ type: 'RestElement', argument: arg, loc: prop.loc });
        } else {
          if (prop.value === null) return null;
          const value = this.expressionToPattern(prop.value);
          if (!value || value.type === 'RestElement') return null;
          properties.push({ type: 'Property', key: prop.key, value, shorthand: prop.shorthand, computed: prop.computed, loc: prop.loc });
        }
      }
      return { type: 'ObjectPattern', properties, loc: expr.loc };
    }
    return null;
  }

  private isValidArrowParams(left: AST.Expression): boolean {
    if (left.type === 'Identifier') return true;
    if (left.type === 'SequenceExpression') return this.flattenSequence(left).every(e => this.expressionToPattern(e) !== null);
    return this.expressionToPattern(left) !== null;
  }

  private parseArrowFunctionFromParams(left: AST.Expression): AST.ArrowFunctionExpression {
    const tok = this.peek();
    const params: (AST.Identifier | AST.RestElement | AST.AssignmentPattern | AST.ArrayPattern | AST.ObjectPattern)[] = [];
    if (left.type === 'SequenceExpression') {
      // `() => ...` also parses as an empty SequenceExpression.
      for (const e of this.flattenSequence(left)) {
        const p = this.expressionToPattern(e);
        if (p) params.push(p);
      }
    } else {
      const p = this.expressionToPattern(left);
      if (p) params.push(p);
    }
    this.advance(); // =>
    let body: AST.BlockStatement | AST.Expression;
    if (this.is(TokenType.LBrace)) {
      const strict = this.lookaheadStrictDirective() || this.inStrictContext();
      this.strictStack.push(strict);
      body = this.parseBlock();
      this.strictStack.pop();
    } else {
      body = this.parseAssignExpr();
    }
    return { type: 'ArrowFunctionExpression', params, body, async: false, expression: !(body.type === 'BlockStatement'), loc: { line: tok.line, column: tok.column } };
  }

  private parsePrefix(): AST.Expression {
    const tok = this.peek();

    switch (tok.type) {
      case TokenType.Number:
        this.advance();
        return { type: 'Literal', value: Number(tok.value), raw: tok.value, loc: { line: tok.line, column: tok.column } };

      case TokenType.String:
        this.advance();
        return { type: 'Literal', value: tok.value, raw: `"${tok.value}"`, loc: { line: tok.line, column: tok.column } };

      case TokenType.TemplateEnd:
        this.advance();
        return { type: 'TemplateLiteral', quasis: [{ type: 'TemplateElement', value: tok.value, raw: tok.raw ?? tok.value, tail: true }], expressions: [], loc: { line: tok.line, column: tok.column } };

      case TokenType.TemplateHead:
        return this.parseTemplateLiteral(tok);

      case TokenType.True:
        this.advance();
        return { type: 'Literal', value: true, raw: 'true', loc: { line: tok.line, column: tok.column } };

      case TokenType.False:
        this.advance();
        return { type: 'Literal', value: false, raw: 'false', loc: { line: tok.line, column: tok.column } };

      case TokenType.Null:
        this.advance();
        return { type: 'Literal', value: null, raw: 'null', loc: { line: tok.line, column: tok.column } };

      case TokenType.NaN:
        this.advance();
        return { type: 'Literal', value: NaN, raw: 'NaN', loc: { line: tok.line, column: tok.column } };

      case TokenType.Infinity:
        this.advance();
        return { type: 'Literal', value: Infinity, raw: 'Infinity', loc: { line: tok.line, column: tok.column } };

      case TokenType.This:
        this.advance();
        return { type: 'ThisExpression', loc: { line: tok.line, column: tok.column } };

      case TokenType.RegExp:
        this.advance();
        // Read pattern/flags from regexParts, not by re-splitting tok.value
        // on '/' — that breaks the instant the pattern contains an escaped
        // slash ("\/"), since split() doesn't know it isn't a delimiter.
        return { type: 'Literal', value: { type: 'RegExp', pattern: tok.regexParts?.pattern ?? '', flags: tok.regexParts?.flags ?? '' }, raw: tok.value, loc: { line: tok.line, column: tok.column } };

      case TokenType.Identifier:
        this.advance();
        return { type: 'Identifier', name: tok.value, loc: { line: tok.line, column: tok.column } };

      case TokenType.LBracket:
        return this.parseArrayExpression();

      case TokenType.LBrace:
        return this.parseObjectExpression();

      case TokenType.Function:
      // Reached only for `async function(...)` — parseExpression()'s own
      // Async handling above covers every async-arrow shape and explicitly
      // excludes this one. parseFunctionExpression() already consumes an
      // optional leading `async` itself.
      case TokenType.Async:
        return this.parseFunctionExpression();

      // Class expression: `var x = class {}`, `new class {}`, `(class {}).x`.
      // parseClassDeclaration() already tolerates a missing name.
      case TokenType.Class:
        return this.parseClassDeclaration();

      case TokenType.LParen:
        return this.parseParenExpression();

      case TokenType.Plus:
      case TokenType.Minus:
      case TokenType.Bang:
      case TokenType.Tilde:
      case TokenType.Typeof:
      case TokenType.Void:
      case TokenType.Delete:
        return this.parseUnaryExpression();

      case TokenType.PlusPlus:
      case TokenType.MinusMinus:
        return this.parsePrefixUpdate();

      case TokenType.New:
        return this.parseNewExpression();

      case TokenType.Undefined:
        this.advance();
        return { type: 'Literal', value: undefined, raw: 'undefined', loc: { line: tok.line, column: tok.column } };

      case TokenType.Super:
        this.advance();
        return { type: 'SuperExpression', loc: { line: tok.line, column: tok.column } };

      case TokenType.Backtick:
        return this.parseTemplateLiteral(this.peek());

      case TokenType.Yield:
        return this.parseYieldExpression(false);

      case TokenType.Await:
        return this.parseAwaitExpression();

      default:
        this.advance();
        return { type: 'Literal', value: null, raw: tok.value, loc: { line: tok.line, column: tok.column } };
    }
  }

  private parseAwaitExpression(): AST.AwaitExpression {
    const tok = this.peek();
    this.advance();
    const argument = this.parseExpression(14);
    return { type: 'AwaitExpression', argument, loc: { line: tok.line, column: tok.column } };
  }

  private parseYieldExpression(delegate: boolean): AST.YieldExpression {
    const tok = this.peek();
    this.advance();
    let isDelegate = delegate;
    if (this.is(TokenType.Star)) {
      this.advance();
      isDelegate = true;
    }
    let argument: AST.Expression | null = null;
    if (!this.is(TokenType.Semicolon) && !this.is(TokenType.RBrace) && !this.is(TokenType.EOF)) {
      argument = this.parseExpression(2);
    }
    return { type: 'YieldExpression', argument, delegate: isDelegate, loc: { line: tok.line, column: tok.column } };
  }

  private parseInfix(left: AST.Expression, prec: number): AST.Expression {
    const tok = this.peek();

    switch (tok.type) {
      // Binary operators
      case TokenType.Plus:
      case TokenType.Minus:
      case TokenType.Star:
      case TokenType.Slash:
      case TokenType.Percent:
      case TokenType.StarStar:
      case TokenType.Ampersand:
      case TokenType.Pipe:
      case TokenType.Caret:
      case TokenType.LessLess:
      case TokenType.GreaterGreater:
      case TokenType.GreaterGreaterGreater:
      case TokenType.Less:
      case TokenType.Greater:
      case TokenType.LessEqual:
      case TokenType.GreaterEqual:
      case TokenType.EqualEqual:
      case TokenType.BangEqual:
      case TokenType.EqualEqualEqual:
      case TokenType.BangEqualEqual:
      case TokenType.Instanceof:
      case TokenType.In:
        this.advance();
        const right = this.parseExpression(prec);
        return { type: 'BinaryExpression', operator: tok.value, left, right, loc: { line: tok.line, column: tok.column } };

      // Logical operators
      case TokenType.AmpersandAmpersand:
      case TokenType.PipePipe:
      case TokenType.QuestionQuestion:
        this.advance();
        const logRight = this.parseExpression(prec);
        return { type: 'LogicalExpression', operator: tok.value, left, right: logRight, loc: { line: tok.line, column: tok.column } };

      // Assignment operators
      case TokenType.Equal:
      case TokenType.PlusAssign:
      case TokenType.MinusAssign:
      case TokenType.StarAssign:
      case TokenType.SlashAssign:
      case TokenType.PercentAssign:
      case TokenType.StarStarAssign:
      case TokenType.AmpersandAssign:
      case TokenType.PipeAssign:
      case TokenType.CaretAssign:
      case TokenType.LessLessAssign:
      case TokenType.GreaterGreaterAssign:
      case TokenType.GreaterGreaterGreaterAssign:
      case TokenType.QuestionQuestionAssign:
      case TokenType.AmpersandAmpersandAssign:
      case TokenType.PipePipeAssign:
        this.advance();
        // Assignment is right-associative, so the right side must accept
        // another same-precedence assignment (`a = b = c` → `a = (b = c)`)
        // — but `prec - 1` overshoots: since Comma sits at exactly
        // `prec - 1`, that also let the right side swallow a following
        // comma (e.g. `{ k: () => n ||= 5, other: () => 1 }` parsed the
        // arrow's whole concise body as `n ||= (5, other)`, eating the next
        // property's key and desyncing everything after it). Recursing at
        // the SAME precedence gets right-associativity without also
        // annexing the next-lower-precedence operator.
        const assignRight = this.parseExpression(prec);
        return { type: 'AssignmentExpression', operator: tok.value, left, right: assignRight, loc: { line: tok.line, column: tok.column } };

      // Update operators
      case TokenType.PlusPlus:
      case TokenType.MinusMinus:
        this.advance();
        return { type: 'UpdateExpression', operator: tok.value, argument: left, prefix: false, loc: { line: tok.line, column: tok.column } };

      // Member access
      case TokenType.Dot:
        this.advance();
        const propTok = this.peek();
        const prop: AST.Identifier = { type: 'Identifier', name: propTok.value, loc: { line: propTok.line, column: propTok.column } };
        this.advance();
        return { type: 'MemberExpression', object: left, property: prop, computed: false, optional: false, loc: { line: tok.line, column: tok.column } };

      // Optional chaining
      case TokenType.QuestionDot:
        this.advance();
        if (this.is(TokenType.LBracket)) {
          this.advance();
          const optComputed = this.parseExpression();
          this.expect(TokenType.RBracket);
          return { type: 'MemberExpression', object: left, property: optComputed, computed: true, optional: true, loc: { line: tok.line, column: tok.column } };
        }
        if (this.is(TokenType.LParen)) {
          this.advance();
          const optArgs = this.parseArguments();
          this.expect(TokenType.RParen);
          return { type: 'CallExpression', callee: left, arguments: optArgs, optional: true, loc: { line: tok.line, column: tok.column } };
        }
        const optPropTok = this.peek();
        const optProp: AST.Identifier = { type: 'Identifier', name: optPropTok.value, loc: { line: optPropTok.line, column: optPropTok.column } };
        this.advance();
        return { type: 'MemberExpression', object: left, property: optProp, computed: false, optional: true, loc: { line: tok.line, column: tok.column } };

      case TokenType.LBracket:
        this.advance();
        const computed = this.parseExpression();
        this.expect(TokenType.RBracket);
        return { type: 'MemberExpression', object: left, property: computed, computed: true, optional: false, loc: { line: tok.line, column: tok.column } };

      // Call
      case TokenType.LParen:
        this.advance();
        const args = this.parseArguments();
        this.expect(TokenType.RParen);
        return { type: 'CallExpression', callee: left, arguments: args, optional: false, loc: { line: tok.line, column: tok.column } };

      // Tagged template: tag`...` — a template literal immediately following
      // an expression with no operator between them (e.g. String.raw`a${b}c`,
      // or the minifier idiom (0, fn)``). Binds as tightly as a call.
      case TokenType.TemplateHead: {
        const quasi = this.parseTemplateLiteral(tok);
        return { type: 'TaggedTemplateExpression', tag: left, quasi, loc: { line: tok.line, column: tok.column } };
      }
      case TokenType.TemplateEnd: {
        this.advance();
        const quasi: AST.TemplateLiteral = {
          type: 'TemplateLiteral',
          quasis: [{ type: 'TemplateElement', value: tok.value, raw: tok.raw ?? tok.value, tail: true }],
          expressions: [],
          loc: { line: tok.line, column: tok.column },
        };
        return { type: 'TaggedTemplateExpression', tag: left, quasi, loc: { line: tok.line, column: tok.column } };
      }

      // Ternary
      case TokenType.Question:
        this.advance();
        const consequent = this.parseExpression();
        this.expect(TokenType.Colon);
        const alternate = this.parseExpression(prec);
        return { type: 'ConditionalExpression', test: left, consequent, alternate, loc: { line: tok.line, column: tok.column } };

      // Comma (sequence)
      case TokenType.Comma:
        this.advance();
        const seqRight = this.parseExpression(0);
        return { type: 'SequenceExpression', expressions: [left, seqRight], loc: { line: tok.line, column: tok.column } };

      default:
        return left;
    }
  }

  private parseUnaryExpression(): AST.UnaryExpression {
    const tok = this.peek();
    this.advance();
    const arg = this.parseExpression(14);
    return { type: 'UnaryExpression', operator: tok.value, argument: arg, prefix: true, loc: { line: tok.line, column: tok.column } };
  }

  private parsePrefixUpdate(): AST.UpdateExpression {
    const tok = this.peek();
    this.advance();
    const arg = this.parseExpression(16);
    return { type: 'UpdateExpression', operator: tok.value, argument: arg, prefix: true, loc: { line: tok.line, column: tok.column } };
  }

  private parseTemplateLiteral(headToken: Token): AST.TemplateLiteral {
    const quasis: AST.TemplateElement[] = [];
    const expressions: AST.Expression[] = [];

    quasis.push({ type: 'TemplateElement', value: headToken.value, raw: headToken.raw ?? headToken.value, tail: false });
    this.advance(); // consume TemplateHead

    while (true) {
      expressions.push(this.parseExpression());

      // Consume the closing } of ${}
      if (this.is(TokenType.RBrace)) {
        this.advance();
      }

      if (this.lexer) {
        const seg = this.lexer.readTemplatePart(headToken.line, headToken.column);
        if (seg.type === TokenType.TemplateMiddle) {
          quasis.push({ type: 'TemplateElement', value: seg.value, raw: seg.raw ?? seg.value, tail: false });
        } else if (seg.type === TokenType.TemplateTail) {
          quasis.push({ type: 'TemplateElement', value: seg.value, raw: seg.raw ?? seg.value, tail: true });
          break;
        }
      } else {
        const next = this.peek();
        if (next.type === TokenType.TemplateMiddle) {
          this.advance();
          quasis.push({ type: 'TemplateElement', value: next.value, raw: next.raw ?? next.value, tail: false });
        } else if (next.type === TokenType.TemplateTail) {
          this.advance();
          quasis.push({ type: 'TemplateElement', value: next.value, raw: next.raw ?? next.value, tail: true });
          break;
        } else {
          break;
        }
      }
    }

    return { type: 'TemplateLiteral', quasis, expressions, loc: { line: headToken.line, column: headToken.column } };
  }

  private parseNewExpression(): AST.NewExpression | AST.NewTargetExpression {
    const tok = this.peek();
    this.advance();
    // `new.target` — the meta-property, not a constructor call. Without this
    // check, `.target` fell straight into parseExpression(18) as if it were
    // the constructor callee, which doesn't start a valid expression — the
    // resulting mis-parse silently produced garbage (extra, nonsensical
    // console.log arguments in practice) rather than a clean error.
    if (this.is(TokenType.Dot)) {
      this.advance();
      this.expect(TokenType.Identifier); // "target"
      return { type: 'NewTargetExpression', loc: { line: tok.line, column: tok.column } };
    }
    const callee = this.parseExpression(18);
    let args: AST.Expression[] = [];
    if (this.is(TokenType.LParen)) {
      this.advance();
      args = this.parseArguments();
      this.expect(TokenType.RParen);
    }
    return { type: 'NewExpression', callee, arguments: args, loc: { line: tok.line, column: tok.column } };
  }

  private parseArrayExpression(): AST.ArrayExpression {
    const tok = this.peek();
    this.advance();
    const elements: (AST.Expression | AST.SpreadElement | null)[] = [];
    while (!this.is(TokenType.RBracket) && !this.is(TokenType.EOF)) {
      if (this.is(TokenType.Comma)) {
        elements.push(null);
        this.advance();
        continue;
      }
      if (this.is(TokenType.Ellipsis)) {
        this.advance();
        elements.push({ type: 'SpreadElement', argument: this.parseAssignExpr() });
      } else {
        elements.push(this.parseAssignExpr());
      }
      if (this.is(TokenType.Comma)) this.advance();
    }
    this.expect(TokenType.RBracket);
    return { type: 'ArrayExpression', elements, loc: { line: tok.line, column: tok.column } };
  }

  private parseObjectExpression(): AST.ObjectExpression {
    const tok = this.peek();
    this.advance();
    const properties: (AST.PropertyDefinition | AST.SpreadElement)[] = [];
    while (!this.is(TokenType.RBrace) && !this.is(TokenType.EOF)) {
      if (this.is(TokenType.Ellipsis)) {
        this.advance();
        properties.push({ type: 'SpreadElement', argument: this.parseAssignExpr() });
      } else {
        properties.push(this.parseProperty());
      }
      if (this.is(TokenType.Comma)) this.advance();
    }
    this.expect(TokenType.RBrace);
    return { type: 'ObjectExpression', properties, loc: { line: tok.line, column: tok.column } };
  }

  /**
   * `get`/`set` only introduce an accessor when a real property-key token
   * follows — otherwise the word itself IS the property's name, as in
   * `{ get: expr }` (plain property), `{ get, }` (shorthand), or
   * `{ get() {} }` (a method literally named "get"). Without this check,
   * `parseProperty()` always consumed `get`/`set` and handed whatever came
   * next (even a bare `:`) to parsePropertyKey(), which silently swallowed
   * it as a garbage key and cascaded into nonsense a token at a time.
   */
  private startsAccessorName(): boolean {
    const next = this.peek(1).type;
    return next === TokenType.Identifier || next === TokenType.String
      || next === TokenType.Number || next === TokenType.LBracket;
  }

  private parseProperty(): AST.PropertyDefinition {
    let kind: 'init' | 'get' | 'set' = 'init';
    let isMethod = false;
    let isShorthand = false;

    if (this.is(TokenType.Get) && this.startsAccessorName()) { this.advance(); kind = 'get'; }
    else if (this.is(TokenType.Set) && this.startsAccessorName()) { this.advance(); kind = 'set'; }

    const key = this.parsePropertyKey();
    const computed = this.peek(-1)?.type === TokenType.RBracket;

    if (this.is(TokenType.LParen)) {
      isMethod = true;
      this.expect(TokenType.LParen);
      const params = this.parseParams();
      this.expect(TokenType.RParen);
      const body = this.parseBlock();
      return {
        type: 'PropertyDefinition', key, value: {
          type: 'FunctionExpression', id: null, params, body, async: false, generator: false,
        },
        kind, computed, shorthand: false, method: isMethod,
      };
    }

    if (this.is(TokenType.Colon)) {
      this.advance();
      const value = this.parseAssignExpr();
      return { type: 'PropertyDefinition', key, value, kind, computed, shorthand: false, method: false };
    }

    // Shorthand property, optionally with a default (`{a = 1}`) — only
    // valid when this object literal turns out to be a destructuring
    // pattern (`const {a = 1} = x` or an arrow param), but real engines
    // parse it permissively here and only matter once it's actually used
    // as a pattern (via expressionToPattern) rather than as a value.
    if (key.type === 'Identifier') {
      isShorthand = true;
      if (this.is(TokenType.Equal)) {
        this.advance();
        const right = this.parseAssignExpr();
        return { type: 'PropertyDefinition', key, value: { type: 'AssignmentExpression', operator: '=', left: key, right, loc: key.loc }, kind, computed, shorthand: true, method: false };
      }
      return { type: 'PropertyDefinition', key, value: key, kind, computed, shorthand: true, method: false };
    }

    return { type: 'PropertyDefinition', key, value: null, kind, computed, shorthand: false, method: false };
  }

  private parsePropertyKey(): AST.Expression {
    if (this.is(TokenType.LBracket)) {
      this.advance();
      const expr = this.parseExpression();
      this.expect(TokenType.RBracket);
      return expr;
    }
    const tok = this.peek();
    if (tok.type === TokenType.Identifier || tok.type === TokenType.String || tok.type === TokenType.Number) {
      this.advance();
      return { type: 'Identifier', name: tok.value, loc: { line: tok.line, column: tok.column } };
    }
    this.advance();
    return { type: 'Identifier', name: tok.value, loc: { line: tok.line, column: tok.column } };
  }

  private parseFunctionExpression(): AST.FunctionExpression {
    const tok = this.peek();
    let async = false;
    if (this.is(TokenType.Async)) { this.advance(); async = true; }
    this.expect(TokenType.Function);
    let generator = false;
    if (this.is(TokenType.Star)) { this.advance(); generator = true; }
    let id: AST.Identifier | null = null;
    if (this.is(TokenType.Identifier)) {
      id = { type: 'Identifier', name: this.peek().value };
      this.advance();
    }
    this.expect(TokenType.LParen);
    const params = this.parseParams();
    this.expect(TokenType.RParen);
    const strict = this.lookaheadStrictDirective() || this.inStrictContext();
    this.strictStack.push(strict);
    const body = this.parseBlock();
    this.strictStack.pop();
    return { type: 'FunctionExpression', id, params, body, async, generator, strictMode: strict, loc: { line: tok.line, column: tok.column } };
  }

  private parseParenExpression(): AST.Expression {
    const openTok = this.peek();
    this.advance(); // (
    // Handle () => ... (empty arrow params)
    if (this.is(TokenType.RParen) && this.peek(1).type === TokenType.Arrow) {
      this.advance(); // )
      return this.parseArrowFunctionFromParams({ type: 'SequenceExpression', expressions: [], loc: { line: openTok.line, column: openTok.column } });
    }
    // A leading/embedded `...` (`(...args) => `, `(a, ...rest) => `) is only
    // ever valid here as an arrow rest parameter — real comma-expression
    // grammar has no such thing — but the generic expression parser has no
    // way to parse a bare `...expr` at all, since spread is otherwise only
    // legal inside call arguments / array / object literals. Build the
    // parenthesized item list by hand instead of delegating straight to
    // parseExpression() so a `...` item can be recognized before it's
    // reached as if it were a normal expression term.
    const items: AST.Expression[] = [];
    let sawSpread = false;
    for (;;) {
      if (this.is(TokenType.Ellipsis)) {
        sawSpread = true;
        const spreadTok = this.peek();
        this.advance();
        items.push({ type: 'SpreadElement', argument: this.parseAssignExpr(), loc: { line: spreadTok.line, column: spreadTok.column } });
      } else {
        items.push(this.parseAssignExpr());
      }
      if (this.is(TokenType.Comma)) { this.advance(); continue; }
      break;
    }
    this.expect(TokenType.RParen);
    const expr: AST.Expression = (items.length === 1 && !sawSpread)
      ? items[0]
      : { type: 'SequenceExpression', expressions: items, loc: { line: openTok.line, column: openTok.column } };
    // Arrow function: (params) => body
    if (this.is(TokenType.Arrow) && this.isValidArrowParams(expr)) {
      return this.parseArrowFunctionFromParams(expr);
    }
    return expr;
  }

  // ── Statement parsing ─────────────────────────────────────────────────────

  private parseStatement(): AST.Statement | null {
    const tok = this.peek();

    switch (tok.type) {
      case TokenType.LBrace: return this.parseBlock();
      case TokenType.Semicolon: this.advance(); return null;
      case TokenType.Var:
      case TokenType.Let:
      case TokenType.Const: return this.parseVariableDeclaration();
      case TokenType.Function: return this.parseFunctionDeclaration();
      case TokenType.Async:
        if (this.peek(1).type === TokenType.Function) {
          return this.parseFunctionDeclaration(true);
        }
        return this.parseExpressionStatement();
      case TokenType.Class: return this.parseClassDeclaration();
      case TokenType.Return: return this.parseReturnStatement();
      case TokenType.If: return this.parseIfStatement();
      case TokenType.While: return this.parseWhileStatement();
      case TokenType.Do: return this.parseDoWhileStatement();
      case TokenType.For: return this.parseForStatement();
      case TokenType.Switch: return this.parseSwitchStatement();
      case TokenType.Try: return this.parseTryStatement();
      case TokenType.Throw: return this.parseThrowStatement();
      case TokenType.Break: return this.parseBreakStatement();
      case TokenType.Continue: return this.parseContinueStatement();
      case TokenType.Debugger:
        this.advance();
        return { type: 'DebuggerStatement', loc: { line: tok.line, column: tok.column } };
      case TokenType.With:
        return this.parseWithStatement();
      default:
        if (tok.type === TokenType.Identifier && this.peek(1).type === TokenType.Colon) {
          return this.parseLabeledStatement();
        }
        return this.parseExpressionStatement();
    }
  }

  private parseBlock(): AST.BlockStatement {
    const tok = this.peek();
    this.expect(TokenType.LBrace);
    const body: AST.Statement[] = [];
    while (!this.is(TokenType.RBrace) && !this.is(TokenType.EOF)) {
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
    }
    this.expect(TokenType.RBrace);
    return { type: 'BlockStatement', body, loc: { line: tok.line, column: tok.column } };
  }

  private parseExpressionStatement(): AST.ExpressionStatement {
    const tok = this.peek();
    const expr = this.parseExpression();
    this.eatSemicolon();
    return { type: 'ExpressionStatement', expression: expr, loc: { line: tok.line, column: tok.column } };
  }

  private parseWithStatement(): AST.WithStatement {
    const tok = this.peek();
    if (this.strictStack.length > 0 && this.strictStack[this.strictStack.length - 1]) {
      throw new Error(`SyntaxError: 'with' statements cannot be used in strict mode at line ${tok.line}:${tok.column}`);
    }
    this.advance(); // consume 'with'
    this.expect(TokenType.LParen);
    const object = this.parseExpression();
    this.expect(TokenType.RParen);
    const body = this.parseStatement()!;
    return { type: 'WithStatement', object, body, loc: { line: tok.line, column: tok.column } };
  }

  private parseVariableDeclaration(): AST.VariableDeclaration {
    const tok = this.peek();
    const kind = tok.value as 'var' | 'let' | 'const';
    this.advance();
    const declarations: AST.VariableDeclarator[] = [];
    do {
      const id = this.parseBindingName();
      let init: AST.Expression | null = null;
      if (this.is(TokenType.Equal)) {
        this.advance();
        init = this.parseExpression(2);
      }
      declarations.push({ type: 'VariableDeclarator', id, init });
    } while (this.is(TokenType.Comma) && (this.advance(), true));
    this.eatSemicolon();
    return { type: 'VariableDeclaration', declarations, kind, loc: { line: tok.line, column: tok.column } };
  }

  /** Parse a binding name — identifier, rest element, array pattern, or object pattern. */
  private parseBindingName(): AST.Identifier | AST.RestElement | AST.ArrayPattern | AST.ObjectPattern {
    if (this.is(TokenType.Ellipsis)) {
      this.advance();
      return { type: 'RestElement', argument: this.parseBindingName() as AST.Identifier };
    }
    if (this.is(TokenType.LBracket)) {
      return this.parseArrayPattern();
    }
    if (this.is(TokenType.LBrace)) {
      return this.parseObjectPattern();
    }
    const tok = this.peek();
    this.advance();
    return { type: 'Identifier', name: tok.value };
  }

  private parseArrayPattern(): AST.ArrayPattern {
    const tok = this.peek();
    this.advance();
    const elements: (AST.Identifier | AST.AssignmentPattern | AST.RestElement | AST.ArrayPattern | AST.ObjectPattern | null)[] = [];
    while (!this.is(TokenType.RBracket) && !this.is(TokenType.EOF)) {
      if (this.is(TokenType.Comma)) {
        elements.push(null);
        this.advance();
        continue;
      }
      if (this.is(TokenType.Ellipsis)) {
        this.advance();
        elements.push({ type: 'RestElement', argument: this.parseBindingName() as AST.Identifier });
        if (this.is(TokenType.Comma)) this.advance();
        continue;
      }
      elements.push(this.parseBindingName());
      if (this.is(TokenType.Equal)) {
        const last = elements[elements.length - 1] as AST.Identifier;
        this.advance();
        elements[elements.length - 1] = { type: 'AssignmentPattern', left: last, right: this.parseExpression(2) };
      }
      if (this.is(TokenType.Comma)) this.advance();
    }
    this.expect(TokenType.RBracket);
    return { type: 'ArrayPattern', elements, loc: { line: tok.line, column: tok.column } };
  }

  private parseObjectPattern(): AST.ObjectPattern {
    const tok = this.peek();
    this.advance();
    const properties: (AST.ObjectPatternProperty | AST.RestElement)[] = [];
    while (!this.is(TokenType.RBrace) && !this.is(TokenType.EOF)) {
      if (this.is(TokenType.Ellipsis)) {
        this.advance();
        properties.push({ type: 'RestElement', argument: this.parseBindingName() as AST.Identifier });
        if (this.is(TokenType.Comma)) this.advance();
        continue;
      }
      if (this.is(TokenType.LBracket)) {
        const key = this.parseExpression();
        this.expect(TokenType.Colon);
        let value: AST.Identifier | AST.AssignmentPattern | AST.ArrayPattern | AST.ObjectPattern | AST.RestElement = this.parseBindingName();
        if (this.is(TokenType.Equal)) {
          this.advance();
          value = { type: 'AssignmentPattern', left: value as AST.Identifier, right: this.parseExpression(2) };
        }
        properties.push({ type: 'Property', key, value: value as any, shorthand: false, computed: true, loc: { line: tok.line, column: tok.column } });
        if (this.is(TokenType.Comma)) this.advance();
        continue;
      }
      const keyTok = this.peek();
      // Any IdentifierName is a valid destructuring key, including reserved
      // words (`{class: r}`, `{get: g}`, `{as: a}`) — real minified React/
      // Tailwind CSS code renames a `class` prop this way. Only a genuine
      // string/number literal key needs the general-expression path below
      // (it can't be used as a shorthand or plain binding name anyway).
      if (keyTok.type !== TokenType.String && keyTok.type !== TokenType.Number) {
        this.advance();
        const key: AST.Identifier = { type: 'Identifier', name: keyTok.value, loc: { line: keyTok.line, column: keyTok.column } };
        let value: AST.Identifier | AST.AssignmentPattern | AST.ArrayPattern | AST.ObjectPattern | AST.RestElement;
        let shorthand = false;
        if (this.is(TokenType.Colon)) {
          this.advance();
          value = this.parseBindingName();
        } else {
          shorthand = true;
          value = key;
        }
        if (this.is(TokenType.Equal)) {
          this.advance();
          value = { type: 'AssignmentPattern', left: value as AST.Identifier, right: this.parseExpression(2) };
        }
        properties.push({ type: 'Property', key, value: value as any, shorthand, computed: false, loc: { line: tok.line, column: tok.column } });
      } else {
        const key = this.parseExpression();
        this.expect(TokenType.Colon);
        let value: AST.Identifier | AST.AssignmentPattern | AST.ArrayPattern | AST.ObjectPattern | AST.RestElement = this.parseBindingName();
        if (this.is(TokenType.Equal)) {
          this.advance();
          value = { type: 'AssignmentPattern', left: value as AST.Identifier, right: this.parseExpression(2) };
        }
        properties.push({ type: 'Property', key, value: value as any, shorthand: false, computed: false, loc: { line: tok.line, column: tok.column } });
      }
      if (this.is(TokenType.Comma)) this.advance();
    }
    this.expect(TokenType.RBrace);
    return { type: 'ObjectPattern', properties, loc: { line: tok.line, column: tok.column } };
  }

  /** Parse a pattern — identifier with optional default value, or rest element. Used for function params where '=' is a default value. */
  private parsePattern(): AST.Identifier | AST.AssignmentPattern | AST.RestElement | AST.ArrayPattern | AST.ObjectPattern {
    if (this.is(TokenType.Ellipsis)) {
      this.advance();
      return { type: 'RestElement', argument: this.parsePattern() as AST.Identifier };
    }
    if (this.is(TokenType.LBracket) || this.is(TokenType.LBrace)) {
      const target = this.is(TokenType.LBracket) ? this.parseArrayPattern() : this.parseObjectPattern();
      if (this.is(TokenType.Equal)) {
        this.advance();
        return { type: 'AssignmentPattern', left: target, right: this.parseExpression(2) };
      }
      return target;
    }
    const tok = this.peek();
    this.advance();
    const id: AST.Identifier = { type: 'Identifier', name: tok.value };
    if (this.is(TokenType.Equal)) {
      this.advance();
      const right = this.parseExpression(2);
      return { type: 'AssignmentPattern', left: id, right };
    }
    return id;
  }

  private parseFunctionDeclaration(isAsync = false): AST.FunctionDeclaration {
    const tok = this.peek();
    let async = isAsync;
    if (this.is(TokenType.Async)) { this.advance(); async = true; }
    this.expect(TokenType.Function);
    let generator = false;
    if (this.is(TokenType.Star)) { this.advance(); generator = true; }
    const id: AST.Identifier = { type: 'Identifier', name: this.peek().value };
    this.advance();
    this.expect(TokenType.LParen);
    const params = this.parseParams();
    this.expect(TokenType.RParen);
    const strict = this.lookaheadStrictDirective() || this.inStrictContext();
    this.strictStack.push(strict);
    const body = this.parseBlock();
    this.strictStack.pop();
    return { type: 'FunctionDeclaration', id, params, body, async, generator, strictMode: strict, loc: { line: tok.line, column: tok.column } };
  }

  private parseClassDeclaration(): AST.ClassDeclaration {
    const tok = this.peek();
    this.advance();
    let id: AST.Identifier | null = null;
    if (this.is(TokenType.Identifier)) {
      id = { type: 'Identifier', name: this.peek().value };
      this.advance();
    }
    let superClass: AST.Expression | null = null;
    if (this.is(TokenType.Extends)) {
      this.advance();
      superClass = this.parseExpression();
    }
    const body = this.parseClassBody();
    return { type: 'ClassDeclaration', id, superClass, body, loc: { line: tok.line, column: tok.column } };
  }

  private parseClassBody(): AST.ClassBody {
    this.expect(TokenType.LBrace);
    const body: (AST.PropertyDefinition | AST.MethodDefinition | AST.StaticBlock)[] = [];
    while (!this.is(TokenType.RBrace) && !this.is(TokenType.EOF)) {
      if (this.is(TokenType.Static)) {
        this.advance();
        // `static { ... }` — a static initialization block, not a member
        // named "static" followed by a property. Without this check the
        // `{` fell straight into parsePropertyKey() (expecting a member
        // name or a computed `[expr]` key), which mis-parsed the block's
        // contents as if they were a key expression — anywhere from an
        // outright parse error to silently swallowing the block with no
        // effect, depending on what happened to be inside it.
        if (this.is(TokenType.LBrace)) {
          const blockBody = this.parseBlock();
          body.push({ type: 'StaticBlock', body: blockBody.body });
          continue;
        }
        let accessorKind: 'get' | 'set' | null = null;
        if (this.is(TokenType.Get) && this.startsAccessorName()) { this.advance(); accessorKind = 'get'; }
        else if (this.is(TokenType.Set) && this.startsAccessorName()) { this.advance(); accessorKind = 'set'; }
        const key = this.parsePropertyKey();
        // parsePropertyKey() consumes `]` itself for a computed `[expr]`
        // key, so the previous token tells us which form it was — this
        // was hardcoded to `computed: false` unconditionally, so a
        // computed method name evaluated to the *variable's own name*
        // instead of its value (`[methodName]() {}` defined a method
        // literally called "methodName", not whatever methodName held).
        const computed = this.peek(-1)?.type === TokenType.RBracket;
        if (this.is(TokenType.LParen)) {
          this.advance();
          const params = this.parseParams();
          this.expect(TokenType.RParen);
          this.strictStack.push(true);
          const funcBody = this.parseBlock();
          this.strictStack.pop();
          body.push({
            type: 'MethodDefinition', key,
            value: { type: 'FunctionExpression', id: null, params, body: funcBody, async: false, generator: false, strictMode: true },
            kind: accessorKind ?? 'method', computed, static: true,
          });
        } else {
          // A static field (`static x = 1;`), not a method — the static
          // branch previously assumed every `static <key>` was a method
          // and unconditionally expected `(` next, so `static count = 0`
          // failed to parse at all.
          let init: AST.Expression | null = null;
          if (this.is(TokenType.Equal)) { this.advance(); init = this.parseExpression(); }
          if (this.is(TokenType.Semicolon)) this.advance();
          body.push({ type: 'PropertyDefinition', key, value: init, kind: 'init', computed, shorthand: false, method: false, static: true });
        }
      } else {
        let accessorKind: 'get' | 'set' | null = null;
        if (this.is(TokenType.Get) && this.startsAccessorName()) { this.advance(); accessorKind = 'get'; }
        else if (this.is(TokenType.Set) && this.startsAccessorName()) { this.advance(); accessorKind = 'set'; }
        const key = this.parsePropertyKey();
        const computed = this.peek(-1)?.type === TokenType.RBracket;
        if (this.is(TokenType.LParen)) {
          this.advance();
          const params = this.parseParams();
          this.expect(TokenType.RParen);
          this.strictStack.push(true);
          const funcBody = this.parseBlock();
          this.strictStack.pop();
          const kind = accessorKind ?? (key.type === 'Identifier' && key.name === 'constructor' ? 'constructor' : 'method');
          body.push({
            type: 'MethodDefinition', key,
            value: { type: 'FunctionExpression', id: null, params, body: funcBody, async: false, generator: false, strictMode: true },
            kind, computed, static: false,
          });
        } else {
          let init: AST.Expression | null = null;
          if (this.is(TokenType.Equal)) { this.advance(); init = this.parseExpression(); }
          if (this.is(TokenType.Semicolon)) this.advance();
          body.push({ type: 'PropertyDefinition', key, value: init, kind: 'init', computed, shorthand: false, method: false });
        }
      }
    }
    this.expect(TokenType.RBrace);
    return { type: 'ClassBody', body };
  }

  private parseReturnStatement(): AST.ReturnStatement {
    const tok = this.peek();
    this.advance();
    let arg: AST.Expression | null = null;
    // ASI: per spec, return [lookahead ∉ {*, +/, */}] Expression_opt
    // If the next token is on a new line, ASI inserts a semicolon
    if (!this.is(TokenType.Semicolon) && !this.is(TokenType.RBrace) && !this.is(TokenType.EOF) && !this.hasNewlineBeforeCurrent()) {
      arg = this.parseExpression();
    }
    this.eatSemicolon();
    return { type: 'ReturnStatement', argument: arg, loc: { line: tok.line, column: tok.column } };
  }

  private parseIfStatement(): AST.IfStatement {
    const tok = this.peek();
    this.advance();
    this.expect(TokenType.LParen);
    const test = this.parseExpression();
    this.expect(TokenType.RParen);
    const consequent = this.parseStatement()!;
    let alternate: AST.Statement | null = null;
    if (this.is(TokenType.Else)) {
      this.advance();
      alternate = this.parseStatement();
    }
    return { type: 'IfStatement', test, consequent, alternate, loc: { line: tok.line, column: tok.column } };
  }

  private parseWhileStatement(): AST.WhileStatement {
    const tok = this.peek();
    this.advance();
    this.expect(TokenType.LParen);
    const test = this.parseExpression();
    this.expect(TokenType.RParen);
    const body = this.parseStatement()!;
    return { type: 'WhileStatement', test, body, loc: { line: tok.line, column: tok.column } };
  }

  private parseDoWhileStatement(): AST.DoWhileStatement {
    const tok = this.peek();
    this.advance();
    const body = this.parseStatement()!;
    this.expect(TokenType.While);
    this.expect(TokenType.LParen);
    const test = this.parseExpression();
    this.expect(TokenType.RParen);
    this.eatSemicolon();
    return { type: 'DoWhileStatement', test, body, loc: { line: tok.line, column: tok.column } };
  }

  private parseForStatement(): AST.Statement {
    const tok = this.peek();
    this.advance();
    const isAwait = this.is(TokenType.Await);
    if (isAwait) this.advance();
    this.expect(TokenType.LParen);

    // for-in / for-of
    if (this.is(TokenType.Var) || this.is(TokenType.Let) || this.is(TokenType.Const)) {
      const kind = this.peek().value;
      this.advance();
      const id = this.parseBindingName();
      if (this.is(TokenType.In)) {
        this.advance();
        const right = this.parseExpression();
        this.expect(TokenType.RParen);
        const body = this.parseStatement()!;
        return { type: 'ForInStatement', left: { type: 'VariableDeclaration', declarations: [{ type: 'VariableDeclarator', id, init: null }], kind: kind as 'var' | 'let' | 'const' }, right, body, loc: { line: tok.line, column: tok.column } };
      }
      if (this.is(TokenType.Of)) {
        this.advance();
        const right = this.parseExpression();
        this.expect(TokenType.RParen);
        const body = this.parseStatement()!;
        return { type: 'ForOfStatement', left: { type: 'VariableDeclaration', declarations: [{ type: 'VariableDeclarator', id, init: null }], kind: kind as 'var' | 'let' | 'const' }, right, body, await: isAwait, loc: { line: tok.line, column: tok.column } };
      }
      // for (var x = ..., y = ...; ...) — one or more comma-separated declarators
      let init: AST.Expression | null = null;
      if (this.is(TokenType.Equal)) {
        this.advance();
        init = this.parseExpression(2);
      }
      const declarations: AST.VariableDeclarator[] = [{ type: 'VariableDeclarator', id, init }];
      while (this.is(TokenType.Comma)) {
        this.advance();
        const nextId = this.parseBindingName();
        let nextInit: AST.Expression | null = null;
        if (this.is(TokenType.Equal)) {
          this.advance();
          nextInit = this.parseExpression(2);
        }
        declarations.push({ type: 'VariableDeclarator', id: nextId, init: nextInit });
      }
      const decl: AST.VariableDeclaration = { type: 'VariableDeclaration', declarations, kind: kind as 'var' | 'let' | 'const' };
      this.expect(TokenType.Semicolon);
      const test = this.is(TokenType.Semicolon) ? null : this.parseExpression();
      this.expect(TokenType.Semicolon);
      const update = this.is(TokenType.RParen) ? null : this.parseExpression();
      this.expect(TokenType.RParen);
      const body = this.parseStatement()!;
      return { type: 'ForStatement', init: decl, test, update, body, loc: { line: tok.line, column: tok.column } };
    }

    // for (expr in/of)
    if (this.is(TokenType.Identifier)) {
      const savedPos = this.pos;
      const name = this.peek().value;
      this.advance();
      if (this.is(TokenType.In)) {
        this.advance();
        const right = this.parseExpression();
        this.expect(TokenType.RParen);
        const body = this.parseStatement()!;
        return { type: 'ForInStatement', left: { type: 'Identifier', name }, right, body, loc: { line: tok.line, column: tok.column } };
      }
      if (this.is(TokenType.Of)) {
        this.advance();
        const right = this.parseExpression();
        this.expect(TokenType.RParen);
        const body = this.parseStatement()!;
        return { type: 'ForOfStatement', left: { type: 'Identifier', name }, right, body, await: isAwait, loc: { line: tok.line, column: tok.column } };
      }
      this.pos = savedPos;
    }

    // for (;;)
    let init: AST.Expression | AST.VariableDeclaration | null = null;
    if (!this.is(TokenType.Semicolon)) {
      init = this.parseExpression();
    }
    this.expect(TokenType.Semicolon);
    const test = !this.is(TokenType.Semicolon) ? this.parseExpression() : null;
    this.expect(TokenType.Semicolon);
    const update = !this.is(TokenType.RParen) ? this.parseExpression() : null;
    this.expect(TokenType.RParen);
    const body = this.parseStatement()!;
    return { type: 'ForStatement', init, test, update, body, loc: { line: tok.line, column: tok.column } };
  }

  private parseSwitchStatement(): AST.SwitchStatement {
    const tok = this.peek();
    this.advance();
    this.expect(TokenType.LParen);
    const discriminant = this.parseExpression();
    this.expect(TokenType.RParen);
    this.expect(TokenType.LBrace);
    const cases: AST.SwitchCase[] = [];
    while (!this.is(TokenType.RBrace) && !this.is(TokenType.EOF)) {
      const caseTok = this.peek();
      if (this.is(TokenType.Case)) {
        this.advance();
        const test = this.parseExpression();
        this.expect(TokenType.Colon);
        const consequent: AST.Statement[] = [];
        while (!this.is(TokenType.Case) && !this.is(TokenType.Default) && !this.is(TokenType.RBrace)) {
          const s = this.parseStatement();
          if (s) consequent.push(s);
        }
        cases.push({ type: 'SwitchCase', test, consequent, loc: { line: caseTok.line, column: caseTok.column } });
      } else if (this.is(TokenType.Default)) {
        this.advance();
        this.expect(TokenType.Colon);
        const consequent: AST.Statement[] = [];
        while (!this.is(TokenType.Case) && !this.is(TokenType.RBrace)) {
          const s = this.parseStatement();
          if (s) consequent.push(s);
        }
        cases.push({ type: 'SwitchCase', test: null, consequent, loc: { line: caseTok.line, column: caseTok.column } });
      }
    }
    this.expect(TokenType.RBrace);
    return { type: 'SwitchStatement', discriminant, cases, loc: { line: tok.line, column: tok.column } };
  }

  private parseTryStatement(): AST.TryStatement {
    const tok = this.peek();
    this.advance();
    const block = this.parseBlock();
    let handler: AST.CatchClause | null = null;
    if (this.is(TokenType.Catch)) {
      this.advance();
      let param: AST.Identifier | null = null;
      if (this.is(TokenType.LParen)) {
        this.advance();
        param = { type: 'Identifier', name: this.peek().value };
        this.advance();
        this.expect(TokenType.RParen);
      }
      const catchBody = this.parseBlock();
      handler = { type: 'CatchClause', param, body: catchBody };
    }
    let finalizer: AST.BlockStatement | null = null;
    if (this.is(TokenType.Finally)) {
      this.advance();
      finalizer = this.parseBlock();
    }
    return { type: 'TryStatement', block, handler, finalizer, loc: { line: tok.line, column: tok.column } };
  }

  private parseThrowStatement(): AST.ThrowStatement {
    const tok = this.peek();
    this.advance();
    const argument = this.parseExpression();
    this.eatSemicolon();
    return { type: 'ThrowStatement', argument, loc: { line: tok.line, column: tok.column } };
  }

  private parseBreakStatement(): AST.BreakStatement {
    const tok = this.peek();
    this.advance();
    let label: AST.Identifier | null = null;
    // ASI: label only accepted if on same line as 'break'
    if (this.is(TokenType.Identifier) && !this.hasNewlineBeforeCurrent()) {
      label = { type: 'Identifier', name: this.peek().value };
      this.advance();
    }
    this.eatSemicolon();
    return { type: 'BreakStatement', label, loc: { line: tok.line, column: tok.column } };
  }

  private parseContinueStatement(): AST.ContinueStatement {
    const tok = this.peek();
    this.advance();
    let label: AST.Identifier | null = null;
    // ASI: label only accepted if on same line as 'continue'
    if (this.is(TokenType.Identifier) && !this.hasNewlineBeforeCurrent()) {
      label = { type: 'Identifier', name: this.peek().value };
      this.advance();
    }
    this.eatSemicolon();
    return { type: 'ContinueStatement', label, loc: { line: tok.line, column: tok.column } };
  }

  private parseLabeledStatement(): AST.LabeledStatement {
    const tok = this.peek();
    const label: AST.Identifier = { type: 'Identifier', name: tok.value, loc: { line: tok.line, column: tok.column } };
    this.advance();
    this.expect(TokenType.Colon);
    const body = this.parseStatement();
    return { type: 'LabeledStatement', label, body: body as AST.Statement, loc: { line: tok.line, column: tok.column } };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Pre-scan: check if the next tokens are a 'use strict' directive without consuming them. */
  // Called right before parseBlock(), with the body's opening '{' still the
  // current token (every call site checks `this.is(TokenType.LBrace)` or has
  // just consumed the parameter list, both leaving '{' next) — so the
  // potential directive is one token further ahead, not the current token.
  // Checking `this.peek()` here meant this always saw '{' itself, never a
  // string, so a `'use strict'` directive was silently ignored everywhere:
  // every function's `this` fallback (interpreter.ts) treated it as
  // non-strict, handing it the global object instead of `undefined`.
  private lookaheadStrictDirective(): boolean {
    if (this.peek(1).type !== TokenType.String) return false;
    const val = this.peek(1).value;
    if (val !== 'use strict') return false;
    const after = this.peek(2);
    return after.type === TokenType.Semicolon || after.type === TokenType.RBrace || after.type === TokenType.EOF;
  }

  private parseParams(): (AST.Identifier | AST.RestElement | AST.AssignmentPattern | AST.ArrayPattern | AST.ObjectPattern)[] {
    const params: (AST.Identifier | AST.RestElement | AST.AssignmentPattern | AST.ArrayPattern | AST.ObjectPattern)[] = [];
    while (!this.is(TokenType.RParen) && !this.is(TokenType.EOF)) {
      params.push(this.parsePattern());
      if (this.is(TokenType.Comma)) this.advance();
    }
    return params;
  }

  private parseArguments(): (AST.Expression | AST.SpreadElement)[] {
    const args: (AST.Expression | AST.SpreadElement)[] = [];
    while (!this.is(TokenType.RParen) && !this.is(TokenType.EOF)) {
      if (this.is(TokenType.Ellipsis)) {
        this.advance();
        args.push({ type: 'SpreadElement', argument: this.parseAssignExpr() });
      } else {
        args.push(this.parseAssignExpr());
      }
      if (this.is(TokenType.Comma)) this.advance();
    }
    return args;
  }

  // ── Token navigation ──────────────────────────────────────────────────────

  private ensureToken(): void {
    if (this.lexer && this.pos >= this.tokens.length) {
      this.tokens.push(this.lexer.nextToken());
    }
  }

  private peek(offset = 0): Token {
    if (this.lexer) {
      while (this.pos + offset >= this.tokens.length) {
        this.tokens.push(this.lexer.nextToken());
      }
      return this.tokens[this.pos + offset] ?? { type: TokenType.EOF, value: '', line: 0, column: 0 };
    }
    return this.tokens[this.pos + offset] ?? { type: TokenType.EOF, value: '', line: 0, column: 0 };
  }

  private advance(): Token {
    const tok = this.peek();
    this.pos++;
    return tok;
  }

  private expect(type: TokenType): Token {
    const tok = this.peek();
    if (tok.type !== type) {
      throw new Error(`Expected ${TokenType[type]}, got ${TokenType[tok.type]} ("${tok.value}") at line ${tok.line}:${tok.column}`);
    }
    return this.advance();
  }

  private is(type: TokenType): boolean {
    return this.peek().type === type;
  }

  /**
   * Eat a semicolon, with ASI (Automatic Semicolon Insertion) support.
   * Per ECMAScript § 11.9.1, a semicolon is automatically inserted when:
   * 1. The offending token is separated by at least one LineTerminator
   * 2. The offending token is `}`
   * 3. End of input
   *
   * This method skips Newline tokens when looking for the semicolon.
   */
  private eatSemicolon(): void {
    if (this.is(TokenType.Semicolon)) {
      this.advance();
      return;
    }

    // ASI: check if there's a newline before the current token
    const prev = this.peek(0);
    const hasNewlineBefore = this.hasNewlineBeforeCurrent();

    // ASI Rule 1: EOF — always insert semicolon
    if (this.is(TokenType.EOF)) {
      return;
    }

    // ASI Rule 2: `}` — always insert semicolon
    if (this.is(TokenType.RBrace)) {
      return;
    }

    // ASI Rule 3: offending token on a new line
    if (hasNewlineBefore) {
      return;
    }

    // No ASI applicable — the semicolon is required
    // (caller can throw if needed, but for now we're lenient)
  }

  /**
   * Check if there's a newline between the previous token and the current one.
   * Used for ASI decisions per ECMAScript § 11.9.
   */
  private hasNewlineBeforeCurrent(): boolean {
    if (this.pos === 0) return false;
    const prevToken = this.peek(-1);
    const currToken = this.peek(0);
    return prevToken.line < currToken.line;
  }

  // ── Operator precedence ───────────────────────────────────────────────────

  private infixPrecedence(type: TokenType): number {
    switch (type) {
      case TokenType.Comma: return 1;
      case TokenType.Equal:
      case TokenType.PlusAssign:
      case TokenType.MinusAssign:
      case TokenType.StarAssign:
      case TokenType.SlashAssign:
      case TokenType.PercentAssign:
      case TokenType.StarStarAssign:
      case TokenType.AmpersandAssign:
      case TokenType.PipeAssign:
      case TokenType.CaretAssign:
      case TokenType.LessLessAssign:
      case TokenType.GreaterGreaterAssign:
      case TokenType.GreaterGreaterGreaterAssign:
      case TokenType.QuestionQuestionAssign:
      case TokenType.AmpersandAmpersandAssign:
      case TokenType.PipePipeAssign: return 2;

      case TokenType.Question: return 3;
      case TokenType.QuestionQuestion: return 4;
      case TokenType.PipePipe: return 5;
      case TokenType.AmpersandAmpersand: return 6;
      case TokenType.Pipe: return 7;
      case TokenType.Caret: return 8;
      case TokenType.Ampersand: return 9;
      case TokenType.EqualEqual:
      case TokenType.BangEqual:
      case TokenType.EqualEqualEqual:
      case TokenType.BangEqualEqual: return 10;

      case TokenType.Less:
      case TokenType.Greater:
      case TokenType.LessEqual:
      case TokenType.GreaterEqual:
      case TokenType.Instanceof:
      case TokenType.In: return 11;

      case TokenType.LessLess:
      case TokenType.GreaterGreater:
      case TokenType.GreaterGreaterGreater: return 12;

      case TokenType.Plus:
      case TokenType.Minus: return 13;

      case TokenType.Star:
      case TokenType.Slash:
      case TokenType.Percent: return 14;

      case TokenType.StarStar: return 15;

      case TokenType.PlusPlus:
      case TokenType.MinusMinus: return 16;

      case TokenType.Dot:
      case TokenType.QuestionDot:
      case TokenType.LBracket:
      case TokenType.LParen:
      case TokenType.TemplateHead:
      case TokenType.TemplateEnd: return 17;

      default: return 0;
    }
  }
}
