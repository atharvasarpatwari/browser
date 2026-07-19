import { TokenType, type Token, lookupKeyword } from './tokens';

// ─────────────────────────────────────────────────────────────────────────────
// LEXER
// ─────────────────────────────────────────────────────────────────────────────

export class Lexer {
  private source: string;
  private pos = 0;
  private line = 1;
  private column = 1;
  private lastTokenType: TokenType = TokenType.EOF;

  constructor(source: string) {
    this.source = source;
  }

  private templateDepth = 0;

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.source.length) {
      const tok = this.nextToken();

      if (tok.type === TokenType.TemplateHead) {
        this.templateDepth++;
        tokens.push(tok);
        this.lastTokenType = tok.type;
        continue;
      }

      if (this.templateDepth > 0 && tok.type === TokenType.RBrace) {
        const seg = this.readTemplatePart(tok.line, tok.column);
        tokens.push(seg);
        if (seg.type === TokenType.TemplateTail) {
          this.templateDepth--;
        }
        this.lastTokenType = seg.type;
        continue;
      }

      if (tok.type === TokenType.Whitespace || tok.type === TokenType.Comment) {
        continue;
      }
      tokens.push(tok);
      this.lastTokenType = tok.type;
      if (tok.type === TokenType.EOF) break;
    }
    if (tokens.length === 0 || tokens[tokens.length - 1]!.type !== TokenType.EOF) {
      tokens.push(this.makeToken(TokenType.EOF, '', this.line, this.column));
    }
    return tokens;
  }

  nextToken(): Token {
    this.skipWhitespace();
    if (this.pos >= this.source.length) {
      return this.makeToken(TokenType.EOF, '', this.line, this.column);
    }

    const startLine = this.line;
    const startCol = this.column;
    const ch = this.source[this.pos]!;

    // Numbers
    if (this.isDigit(ch) || (ch === '.' && this.pos + 1 < this.source.length && this.isDigit(this.source[this.pos + 1]!))) {
      return this.readNumber(startLine, startCol);
    }

    // Strings
    if (ch === '"' || ch === "'" ) {
      return this.readString(startLine, startCol);
    }

    // Template literals
    if (ch === '`') {
      return this.readTemplate(startLine, startCol);
    }

    // Identifiers and keywords
    if (this.isIdentifierStart(ch)) {
      return this.readIdentifier(startLine, startCol);
    }

    // Comments and regex-like division
    if (ch === '/') {
      if (this.peek(1) === '/') {
        return this.readLineComment(startLine, startCol);
      }
      if (this.peek(1) === '*') {
        return this.readBlockComment(startLine, startCol);
      }
      if (this.peek(1) === '=') {
        this.advance(2);
        return this.makeToken(TokenType.SlashAssign, '/=', startLine, startCol);
      }
      // Context-aware: after expression-ending tokens, `/` is division.
      // After operators/keywords/punctuation, `/` starts a regex literal.
      if (this.isRegexContext()) {
        return this.readRegex(startLine, startCol);
      }
      this.advance();
      return this.makeToken(TokenType.Slash, '/', startLine, startCol);
    }

    // Multi-char operators
    const twoChar = this.source.slice(this.pos, this.pos + 2);
    const threeChar = this.source.slice(this.pos, this.pos + 3);

    if (threeChar === '>>>' || threeChar === '>>>=') {
      const op = threeChar;
      this.advance(3);
      if (this.peek(0) === '=') { this.advance(); return this.makeToken(TokenType.GreaterGreaterGreaterAssign, '>>>=', startLine, startCol); }
      return this.makeToken(TokenType.GreaterGreaterGreater, '>>>', startLine, startCol);
    }

    if (threeChar === '===') { this.advance(3); return this.makeToken(TokenType.EqualEqualEqual, '===', startLine, startCol); }
    if (threeChar === '!==') { this.advance(3); return this.makeToken(TokenType.BangEqualEqual, '!==', startLine, startCol); }

    switch (twoChar) {
      case '==': this.advance(2); return this.makeToken(TokenType.EqualEqual, '==', startLine, startCol);
      case '!=': this.advance(2); return this.makeToken(TokenType.BangEqual, '!=', startLine, startCol);
      case '<=': this.advance(2); return this.makeToken(TokenType.LessEqual, '<=', startLine, startCol);
      case '>=': this.advance(2); return this.makeToken(TokenType.GreaterEqual, '>=', startLine, startCol);
      case '&&': this.advance(2); return this.makeToken(TokenType.AmpersandAmpersand, '&&', startLine, startCol);
      case '||': this.advance(2); return this.makeToken(TokenType.PipePipe, '||', startLine, startCol);
      case '++': this.advance(2); return this.makeToken(TokenType.PlusPlus, '++', startLine, startCol);
      case '--': this.advance(2); return this.makeToken(TokenType.MinusMinus, '--', startLine, startCol);
      case '**': this.advance(2); return this.makeToken(TokenType.StarStar, '**', startLine, startCol);
      case '+=': this.advance(2); return this.makeToken(TokenType.PlusAssign, '+=', startLine, startCol);
      case '-=': this.advance(2); return this.makeToken(TokenType.MinusAssign, '-=', startLine, startCol);
      case '*=': this.advance(2); return this.makeToken(TokenType.StarAssign, '*=', startLine, startCol);
      case '/=': this.advance(2); return this.makeToken(TokenType.SlashAssign, '/=', startLine, startCol);
      case '%=': this.advance(2); return this.makeToken(TokenType.PercentAssign, '%=', startLine, startCol);
      case '&=': this.advance(2); return this.makeToken(TokenType.AmpersandAssign, '&=', startLine, startCol);
      case '|=': this.advance(2); return this.makeToken(TokenType.PipeAssign, '|=', startLine, startCol);
      case '^=': this.advance(2); return this.makeToken(TokenType.CaretAssign, '^=', startLine, startCol);
      case '<<': {
        this.advance(2);
        if (this.peek(0) === '=') { this.advance(); return this.makeToken(TokenType.LessLessAssign, '<<=', startLine, startCol); }
        return this.makeToken(TokenType.LessLess, '<<', startLine, startCol);
      }
      case '>>': {
        this.advance(2);
        if (this.peek(0) === '=') { this.advance(); return this.makeToken(TokenType.GreaterGreaterAssign, '>>=', startLine, startCol); }
        return this.makeToken(TokenType.GreaterGreater, '>>', startLine, startCol);
      }
      case '=>': this.advance(2); return this.makeToken(TokenType.Arrow, '=>', startLine, startCol);
      case '..': this.advance(2); if (this.peek(0) === '.') { this.advance(); return this.makeToken(TokenType.Ellipsis, '...', startLine, startCol); }
        return this.makeToken(TokenType.Illegal, '..', startLine, startCol);
    }

    // Single-char tokens
    this.advance();
    switch (ch) {
      case '+': return this.makeToken(TokenType.Plus, '+', startLine, startCol);
      case '-': return this.makeToken(TokenType.Minus, '-', startLine, startCol);
      case '*': return this.makeToken(TokenType.Star, '*', startLine, startCol);
      case '%': return this.makeToken(TokenType.Percent, '%', startLine, startCol);
      case '&': return this.makeToken(TokenType.Ampersand, '&', startLine, startCol);
      case '|': return this.makeToken(TokenType.Pipe, '|', startLine, startCol);
      case '^': return this.makeToken(TokenType.Caret, '^', startLine, startCol);
      case '~': return this.makeToken(TokenType.Tilde, '~', startLine, startCol);
      case '!': return this.makeToken(TokenType.Bang, '!', startLine, startCol);
      case '=': return this.makeToken(TokenType.Equal, '=', startLine, startCol);
      case '<': return this.makeToken(TokenType.Less, '<', startLine, startCol);
      case '>': return this.makeToken(TokenType.Greater, '>', startLine, startCol);
      case '(': return this.makeToken(TokenType.LParen, '(', startLine, startCol);
      case ')': return this.makeToken(TokenType.RParen, ')', startLine, startCol);
      case '{': return this.makeToken(TokenType.LBrace, '{', startLine, startCol);
      case '}': return this.makeToken(TokenType.RBrace, '}', startLine, startCol);
      case '[': return this.makeToken(TokenType.LBracket, '[', startLine, startCol);
      case ']': return this.makeToken(TokenType.RBracket, ']', startLine, startCol);
      case ';': return this.makeToken(TokenType.Semicolon, ';', startLine, startCol);
      case ',': return this.makeToken(TokenType.Comma, ',', startLine, startCol);
      case '.': return this.makeToken(TokenType.Dot, '.', startLine, startCol);
      case '?': return this.makeToken(TokenType.Question, '?', startLine, startCol);
      case ':': return this.makeToken(TokenType.Colon, ':', startLine, startCol);
      case '`': return this.makeToken(TokenType.Backtick, '`', startLine, startCol);
      case '\n':
        this.line++;
        this.column = 1;
        return this.makeToken(TokenType.Newline, '\n', startLine, startCol);
      default:
        return this.makeToken(TokenType.Illegal, ch, startLine, startCol);
    }
  }

  // ───────────── Private helpers ─────────────

  private readNumber(line: number, col: number): Token {
    const start = this.pos;

    if (this.source[this.pos] === '0' && (this.source[this.pos + 1] === 'x' || this.source[this.pos + 1] === 'X')) {
      this.advance(2);
      while (this.pos < this.source.length && this.isHexDigit(this.source[this.pos]!)) this.advance();
    } else if (this.source[this.pos] === '0' && (this.source[this.pos + 1] === 'b' || this.source[this.pos + 1] === 'B')) {
      this.advance(2);
      while (this.pos < this.source.length && (this.source[this.pos] === '0' || this.source[this.pos] === '1')) this.advance();
    } else if (this.source[this.pos] === '0' && (this.source[this.pos + 1] === 'o' || this.source[this.pos + 1] === 'O')) {
      this.advance(2);
      while (this.pos < this.source.length && this.isOctalDigit(this.source[this.pos]!)) this.advance();
    } else {
      while (this.pos < this.source.length && this.isDigit(this.source[this.pos]!)) this.advance();
      if (this.pos < this.source.length && this.source[this.pos] === '.') {
        this.advance();
        while (this.pos < this.source.length && this.isDigit(this.source[this.pos]!)) this.advance();
      }
      if (this.pos < this.source.length && (this.source[this.pos] === 'e' || this.source[this.pos] === 'E')) {
        this.advance();
        if (this.pos < this.source.length && (this.source[this.pos] === '+' || this.source[this.pos] === '-')) this.advance();
        while (this.pos < this.source.length && this.isDigit(this.source[this.pos]!)) this.advance();
      }
    }

    // BigInt suffix
    if (this.pos < this.source.length && this.source[this.pos] === 'n') {
      this.advance();
      return this.makeToken(TokenType.BigInt, this.source.slice(start, this.pos), line, col);
    }

    return this.makeToken(TokenType.Number, this.source.slice(start, this.pos), line, col);
  }

  private readString(line: number, col: number): Token {
    const quote = this.source[this.pos]!;
    this.advance();
    let value = '';
    while (this.pos < this.source.length && this.source[this.pos] !== quote) {
      if (this.source[this.pos] === '\\') {
        this.advance();
        const ch = this.source[this.pos] ?? '';
        switch (ch) {
          case 'n': value += '\n'; break;
          case 'r': value += '\r'; break;
          case 't': value += '\t'; break;
          case '\\': value += '\\'; break;
          case "'": value += "'"; break;
          case '"': value += '"'; break;
          case '`': value += '`'; break;
          case '0': value += '\0'; break;
          case 'b': value += '\b'; break;
          case 'f': value += '\f'; break;
          case 'v': value += '\v'; break;
          case 'u': {
            const hex = this.source.slice(this.pos + 1, this.pos + 5);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) {
              value += String.fromCharCode(parseInt(hex, 16));
              this.advance(4);
            } else {
              value += 'u';
            }
            break;
          }
          case 'x': {
            const hex = this.source.slice(this.pos + 1, this.pos + 3);
            if (/^[0-9a-fA-F]{2}$/.test(hex)) {
              value += String.fromCharCode(parseInt(hex, 16));
              this.advance(2);
            } else {
              value += 'x';
            }
            break;
          }
          case '\n':
            this.line++; this.column = 1;
            break;
          default: value += ch; break;
        }
        this.advance();
      } else {
        if (this.source[this.pos] === '\n') { this.line++; this.column = 1; }
        value += this.source[this.pos];
        this.advance();
      }
    }
    if (this.pos < this.source.length) this.advance(); // closing quote
    return this.makeToken(TokenType.String, value, line, col);
  }

  private readTemplate(line: number, col: number): Token {
    this.advance(); // opening backtick
    const start = this.pos;
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]!;
      if (ch === '`') {
        const value = this.source.slice(start, this.pos);
        this.advance(); // closing backtick
        return this.makeToken(TokenType.TemplateEnd, value, line, col);
      }
      if (ch === '$' && this.peek(1) === '{') {
        const value = this.source.slice(start, this.pos);
        this.advance(); // skip ${
        this.advance();
        return this.makeToken(TokenType.TemplateHead, value, line, col);
      }
      if (ch === '\\') {
        this.advance();
        if (this.pos < this.source.length) {
          if (this.source[this.pos] === '\n') { this.line++; this.column = 1; }
          this.advance();
        }
        continue;
      }
      if (ch === '\n') { this.line++; this.column = 1; }
      this.advance();
    }
    return this.makeToken(TokenType.TemplateEnd, this.source.slice(start, this.pos), line, col);
  }

  readTemplatePart(line: number, col: number): Token {
    const start = this.pos;
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]!;
      if (ch === '`') {
        const value = this.source.slice(start, this.pos);
        this.advance(); // closing backtick
        return this.makeToken(TokenType.TemplateTail, value, line, col);
      }
      if (ch === '$' && this.peek(1) === '{') {
        const value = this.source.slice(start, this.pos);
        this.advance(); // skip ${
        this.advance();
        return this.makeToken(TokenType.TemplateMiddle, value, line, col);
      }
      if (ch === '\\') {
        this.advance();
        if (this.pos < this.source.length) {
          if (this.source[this.pos] === '\n') { this.line++; this.column = 1; }
          this.advance();
        }
        continue;
      }
      if (ch === '\n') { this.line++; this.column = 1; }
      this.advance();
    }
    return this.makeToken(TokenType.TemplateTail, this.source.slice(start, this.pos), line, col);
  }

  private readIdentifier(line: number, col: number): Token {
    const start = this.pos;
    while (this.pos < this.source.length && this.isIdentifierPart(this.source[this.pos]!)) {
      this.advance();
    }
    const value = this.source.slice(start, this.pos);
    const type = lookupKeyword(value);
    return this.makeToken(type, value, line, col);
  }

  private readLineComment(line: number, col: number): Token {
    this.advance(2); // //
    const start = this.pos;
    while (this.pos < this.source.length && this.source[this.pos] !== '\n') this.advance();
    return this.makeToken(TokenType.Comment, this.source.slice(start, this.pos), line, col);
  }

  private readBlockComment(line: number, col: number): Token {
    this.advance(2); // /*
    const start = this.pos;
    while (this.pos < this.source.length) {
      if (this.source[this.pos] === '*' && this.peek(1) === '/') {
        this.advance(2);
        return this.makeToken(TokenType.Comment, this.source.slice(start, this.pos - 2), line, col);
      }
      if (this.source[this.pos] === '\n') { this.line++; this.column = 1; }
      this.advance();
    }
    return this.makeToken(TokenType.Comment, this.source.slice(start), line, col);
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]!;
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.advance();
      } else if (ch === '\n') {
        this.advance();
        this.line++;
        this.column = 1;
      } else if (ch === '/' && this.peek(1) === '/') {
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') this.advance();
      } else if (ch === '/' && this.peek(1) === '*') {
        this.advance(2);
        while (this.pos < this.source.length) {
          if (this.source[this.pos] === '*' && this.peek(1) === '/') { this.advance(2); break; }
          if (this.source[this.pos] === '\n') { this.line++; this.column = 1; }
          this.advance();
        }
      } else {
        break;
      }
    }
  }

  private isRegexContext(): boolean {
    // After these tokens, `/` starts a regex literal
    switch (this.lastTokenType) {
      case TokenType.EOF:
      case TokenType.Plus:
      case TokenType.Minus:
      case TokenType.Star:
      case TokenType.Slash:
      case TokenType.Percent:
      case TokenType.StarStar:
      case TokenType.Ampersand:
      case TokenType.Pipe:
      case TokenType.Caret:
      case TokenType.Tilde:
      case TokenType.Bang:
      case TokenType.Equal:
      case TokenType.EqualEqual:
      case TokenType.EqualEqualEqual:
      case TokenType.BangEqual:
      case TokenType.BangEqualEqual:
      case TokenType.Less:
      case TokenType.Greater:
      case TokenType.LessEqual:
      case TokenType.GreaterEqual:
      case TokenType.LessLess:
      case TokenType.GreaterGreater:
      case TokenType.GreaterGreaterGreater:
      case TokenType.AmpersandAmpersand:
      case TokenType.PipePipe:
      case TokenType.PlusAssign:
      case TokenType.MinusAssign:
      case TokenType.StarAssign:
      case TokenType.SlashAssign:
      case TokenType.PercentAssign:
      case TokenType.AmpersandAssign:
      case TokenType.PipeAssign:
      case TokenType.CaretAssign:
      case TokenType.LessLessAssign:
      case TokenType.GreaterGreaterAssign:
      case TokenType.GreaterGreaterGreaterAssign:
      case TokenType.Question:
      case TokenType.Colon:
      case TokenType.Comma:
      case TokenType.LParen:
      case TokenType.LBrace:
      case TokenType.LBracket:
      case TokenType.Semicolon:
      case TokenType.Return:
      case TokenType.If:
      case TokenType.Else:
      case TokenType.While:
      case TokenType.Do:
      case TokenType.For:
      case TokenType.Switch:
      case TokenType.Case:
      case TokenType.Default:
      case TokenType.Throw:
      case TokenType.New:
      case TokenType.Delete:
      case TokenType.Typeof:
      case TokenType.Instanceof:
      case TokenType.Void:
      case TokenType.In:
      case TokenType.Arrow:
      case TokenType.Var:
      case TokenType.Let:
      case TokenType.Const:
      case TokenType.Function:
      case TokenType.Class:
      case TokenType.Extends:
      case TokenType.Yield:
        return true;
      default:
        return false;
    }
  }

  private readRegex(line: number, col: number): Token {
    this.advance(); // consume opening /
    let pattern = '';
    let inCharClass = false;

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]!;

      if (ch === '\n') {
        // Regex cannot contain unescaped newlines — treat as end of regex
        break;
      }

      if (ch === '\\') {
        // Escape sequence — consume both the backslash and next char
        pattern += ch;
        this.advance();
        if (this.pos < this.source.length) {
          pattern += this.source[this.pos]!;
          this.advance();
        }
        continue;
      }

      if (ch === '[') {
        inCharClass = true;
      } else if (ch === ']') {
        inCharClass = false;
      }

      if (ch === '/' && !inCharClass) {
        this.advance(); // consume closing /
        break;
      }

      pattern += ch;
      this.advance();
    }

    // Read flags (g, i, m, s, u, y, d)
    let flags = '';
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]!;
      if (ch === 'g' || ch === 'i' || ch === 'm' || ch === 's' || ch === 'u' || ch === 'y' || ch === 'd') {
        flags += ch;
        this.advance();
      } else {
        break;
      }
    }

    const value = `/${pattern}/${flags}`;
    return this.makeToken(TokenType.RegExp, value, line, col);
  }

  private advance(count = 1): void {
    for (let i = 0; i < count && this.pos < this.source.length; i++) {
      this.pos++;
      this.column++;
    }
  }

  private peek(offset: number): string {
    return this.source[this.pos + offset] ?? '';
  }

  private makeToken(type: TokenType, value: string, line: number, column: number): Token {
    return { type, value, line, column };
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isHexDigit(ch: string): boolean {
    return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
  }

  private isOctalDigit(ch: string): boolean {
    return ch >= '0' && ch <= '7';
  }

  private isIdentifierStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
  }

  private isIdentifierPart(ch: string): boolean {
    return this.isIdentifierStart(ch) || this.isDigit(ch);
  }
}
