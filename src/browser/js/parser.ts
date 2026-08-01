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
    const body: AST.Statement[] = [];
    while (!this.is(TokenType.EOF)) {
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
    }
    return { type: 'Program', body };
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

  private isValidArrowParams(left: AST.Expression): boolean {
    if (left.type === 'Identifier') return true;
    if (left.type === 'SequenceExpression') return left.expressions.every(e => e.type === 'Identifier');
    return false;
  }

  private parseArrowFunctionFromParams(left: AST.Expression): AST.ArrowFunctionExpression {
    const tok = this.peek();
    const params: AST.Identifier[] = [];
    if (left.type === 'Identifier') {
      params.push(left);
    } else if (left.type === 'SequenceExpression') {
      for (const e of left.expressions) {
        if (e.type === 'Identifier') params.push(e);
      }
    }
    this.advance(); // =>
    let body: AST.BlockStatement | AST.Expression;
    if (this.is(TokenType.LBrace)) {
      const strict = this.lookaheadStrictDirective();
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
        return { type: 'TemplateLiteral', quasis: [{ type: 'TemplateElement', value: tok.value, tail: true }], expressions: [], loc: { line: tok.line, column: tok.column } };

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
        return { type: 'Literal', value: { type: 'RegExp', pattern: tok.value.split('/')[1] ?? '', flags: tok.value.split('/').pop() ?? '' }, raw: tok.value, loc: { line: tok.line, column: tok.column } };

      case TokenType.Identifier:
        this.advance();
        return { type: 'Identifier', name: tok.value, loc: { line: tok.line, column: tok.column } };

      case TokenType.LBracket:
        return this.parseArrayExpression();

      case TokenType.LBrace:
        return this.parseObjectExpression();

      case TokenType.Function:
        return this.parseFunctionExpression();

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
    if (this.is(TokenType.Generator)) {
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
        this.advance();
        const assignRight = this.parseExpression(prec - 1);
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

    quasis.push({ type: 'TemplateElement', value: headToken.value, tail: false });
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
          quasis.push({ type: 'TemplateElement', value: seg.value, tail: false });
        } else if (seg.type === TokenType.TemplateTail) {
          quasis.push({ type: 'TemplateElement', value: seg.value, tail: true });
          break;
        }
      } else {
        const next = this.peek();
        if (next.type === TokenType.TemplateMiddle) {
          this.advance();
          quasis.push({ type: 'TemplateElement', value: next.value, tail: false });
        } else if (next.type === TokenType.TemplateTail) {
          this.advance();
          quasis.push({ type: 'TemplateElement', value: next.value, tail: true });
          break;
        } else {
          break;
        }
      }
    }

    return { type: 'TemplateLiteral', quasis, expressions, loc: { line: headToken.line, column: headToken.column } };
  }

  private parseNewExpression(): AST.NewExpression {
    const tok = this.peek();
    this.advance();
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

  private parseProperty(): AST.PropertyDefinition {
    let kind: 'init' | 'get' | 'set' = 'init';
    let isMethod = false;
    let isShorthand = false;

    if (this.is(TokenType.Get)) { this.advance(); kind = 'get'; }
    else if (this.is(TokenType.Set)) { this.advance(); kind = 'set'; }

    const key = this.parsePropertyKey();
    const computed = this.peek(-1)?.type === TokenType.RBracket;

    if (this.is(TokenType.LParen)) {
      isMethod = true;
      const params = this.parseParams();
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

    // Shorthand property
    if (key.type === 'Identifier') {
      isShorthand = true;
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
    if (this.is(TokenType.Generator)) { this.advance(); generator = true; }
    let id: AST.Identifier | null = null;
    if (this.is(TokenType.Identifier)) {
      id = { type: 'Identifier', name: this.peek().value };
      this.advance();
    }
    this.expect(TokenType.LParen);
    const params = this.parseParams();
    this.expect(TokenType.RParen);
    const strict = this.lookaheadStrictDirective();
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
    const expr = this.parseExpression();
    this.expect(TokenType.RParen);
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
        const value = this.parseBindingName();
        properties.push({ type: 'Property', key, value: value as any, shorthand: false, computed: true, loc: { line: tok.line, column: tok.column } });
        if (this.is(TokenType.Comma)) this.advance();
        continue;
      }
      const keyTok = this.peek();
      if (keyTok.type === TokenType.Identifier) {
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
        const value = this.parseBindingName();
        properties.push({ type: 'Property', key, value: value as any, shorthand: false, computed: false, loc: { line: tok.line, column: tok.column } });
      }
      if (this.is(TokenType.Comma)) this.advance();
    }
    this.expect(TokenType.RBrace);
    return { type: 'ObjectPattern', properties, loc: { line: tok.line, column: tok.column } };
  }

  /** Parse a pattern — identifier with optional default value, or rest element. Used for function params where '=' is a default value. */
  private parsePattern(): AST.Identifier | AST.AssignmentPattern | AST.RestElement {
    if (this.is(TokenType.Ellipsis)) {
      this.advance();
      return { type: 'RestElement', argument: this.parsePattern() as AST.Identifier };
    }
    const tok = this.peek();
    this.advance();
    const id: AST.Identifier = { type: 'Identifier', name: tok.value };
    if (this.is(TokenType.Equal)) {
      this.advance();
      const right = this.parseExpression();
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
    if (this.is(TokenType.Generator)) { this.advance(); generator = true; }
    const id: AST.Identifier = { type: 'Identifier', name: this.peek().value };
    this.advance();
    this.expect(TokenType.LParen);
    const params = this.parseParams();
    this.expect(TokenType.RParen);
    const strict = this.lookaheadStrictDirective();
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
    const body: (AST.PropertyDefinition | AST.MethodDefinition)[] = [];
    while (!this.is(TokenType.RBrace) && !this.is(TokenType.EOF)) {
      if (this.is(TokenType.Static)) {
        this.advance();
        const key = this.parsePropertyKey();
        this.expect(TokenType.LParen);
        const params = this.parseParams();
        this.expect(TokenType.RParen);
        this.strictStack.push(true);
        const funcBody = this.parseBlock();
        this.strictStack.pop();
        body.push({
          type: 'MethodDefinition', key,
          value: { type: 'FunctionExpression', id: null, params, body: funcBody, async: false, generator: false, strictMode: true },
          kind: 'method', computed: false, static: true,
        });
      } else {
        const key = this.parsePropertyKey();
        if (this.is(TokenType.LParen)) {
          this.advance();
          const params = this.parseParams();
          this.expect(TokenType.RParen);
          this.strictStack.push(true);
          const funcBody = this.parseBlock();
          this.strictStack.pop();
          const kind = key.type === 'Identifier' && key.name === 'constructor' ? 'constructor' : 'method';
          body.push({
            type: 'MethodDefinition', key,
            value: { type: 'FunctionExpression', id: null, params, body: funcBody, async: false, generator: false, strictMode: true },
            kind, computed: false, static: false,
          });
        } else {
          let init: AST.Expression | null = null;
          if (this.is(TokenType.Equal)) { this.advance(); init = this.parseExpression(); }
          if (this.is(TokenType.Semicolon)) this.advance();
          body.push({ type: 'PropertyDefinition', key, value: init, kind: 'init', computed: false, shorthand: false, method: false });
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
        return { type: 'ForOfStatement', left: { type: 'VariableDeclaration', declarations: [{ type: 'VariableDeclarator', id, init: null }], kind: kind as 'var' | 'let' | 'const' }, right, body, await: false, loc: { line: tok.line, column: tok.column } };
      }
      // for (var x = ...)
      let init: AST.Expression | null = null;
      if (this.is(TokenType.Equal)) {
        this.advance();
        init = this.parseExpression(2);
      }
      const decl: AST.VariableDeclaration = { type: 'VariableDeclaration', declarations: [{ type: 'VariableDeclarator', id, init }], kind: kind as 'var' | 'let' | 'const' };
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
        return { type: 'ForOfStatement', left: { type: 'Identifier', name }, right, body, await: false, loc: { line: tok.line, column: tok.column } };
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
  private lookaheadStrictDirective(): boolean {
    if (this.peek().type !== TokenType.String) return false;
    const val = this.peek().value;
    if (val !== 'use strict') return false;
    const next = this.peek(1);
    return next.type === TokenType.Semicolon || next.type === TokenType.RBrace || next.type === TokenType.EOF;
  }

  private parseParams(): (AST.Identifier | AST.RestElement | AST.AssignmentPattern)[] {
    const params: (AST.Identifier | AST.RestElement | AST.AssignmentPattern)[] = [];
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
      case TokenType.QuestionQuestionAssign: return 2;

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
      case TokenType.LParen: return 17;

      default: return 0;
    }
  }
}
