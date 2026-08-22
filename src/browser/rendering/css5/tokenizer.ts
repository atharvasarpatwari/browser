/**
 * @file css5/tokenizer.ts
 * CSS Tokenizer — implementation of CSS Syntax Level 3.
 *
 * Converts raw CSS text into a stream of CssToken values.
 * Handles:
 *   - Identifiers, strings, numbers, dimensions, percentages
 *   - Hash tokens (ID selectors, color literals)
 *   - Function tokens (rgb(), var(), calc(), etc.)
 *   - Comments (/* ... *​/)
 *   - At-keywords (@media, @import, etc.)
 *   - URL tokens (url(...))
 *   - Escaped characters
 *   - Bad strings and bad URLs (error recovery)
 *   - Whitespace handling for selector/combinator detection
 */

import { CssTokenType, type CssToken } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// TOKENIZER CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class CssTokenizer {
  private input: string;
  private pos: number;
  private tokens: CssToken[];
  private line: number;
  private column: number;

  constructor(input: string) {
    this.input = input;
    this.pos = 0;
    this.tokens = [];
    this.line = 1;
    this.column = 1;
  }

  /** Tokenize the full input and return all tokens. */
  tokenize(): CssToken[] {
    this.tokens = [];
    this.pos = 0;
    this.line = 1;
    this.column = 1;

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos]!;

      // Whitespace
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.consumeWhitespace();
        continue;
      }

      // String
      if (ch === '"' || ch === "'") {
        this.consumeString();
        continue;
      }

      // Comment
      if (ch === '/' && this.peek(1) === '*') {
        this.consumeComment();
        continue;
      }

      // Hash
      if (ch === '#') {
        this.consumeHash();
        continue;
      }

      // At-keyword
      if (ch === '@') {
        this.consumeAtKeyword();
        continue;
      }

      // Number or dimension or percentage (must be checked before ident — spec §4.3.1)
      if (this.isDigit(ch) || (ch === '.' && this.peek(1) !== undefined && this.isDigit(this.peek(1)!)) || (ch === '+' || ch === '-')) {
        if (this.couldStartNumber()) {
          this.consumeNumberOrDimension();
          continue;
        }
        // + / - could be operator, fall through
      }

      // CDOToken/CDC (for HTML integration) — must be checked before ident for '-' and '<'
      if (ch === '<' && this.matchAhead('!--')) {
        this.addToken(CssTokenType.CDOToken, '<!--');
        continue;
      }
      if (ch === '-' && this.matchAhead('->')) {
        this.addToken(CssTokenType.CDCToken, '-->');
        continue;
      }

      // URL — must be checked before ident since 'u' is an ident start character
      if (ch === 'u' && this.matchAhead('url(')) {
        this.consumeUrl();
        continue;
      }

      // Function or ident (including backslash-escaped identifiers and -- prefix)
      if (this.isIdentStart(ch) || ch === '\\' ||
          (ch === '-' && this.peek(1) !== undefined && (this.isIdentStart(this.peek(1)!) || this.peek(1) === '-'))) {
        this.consumeIdentOrFunction();
        continue;
      }

      // Delimiters
      if (ch === '{') { this.addToken(CssTokenType.CurlyBracketOpen, '{'); continue; }
      if (ch === '}') { this.addToken(CssTokenType.CurlyBracketClose, '}'); continue; }
      if (ch === '(') { this.addToken(CssTokenType.ParenthesisOpen, '('); continue; }
      if (ch === ')') { this.addToken(CssTokenType.ParenthesisClose, ')'); continue; }
      if (ch === '[') { this.addToken(CssTokenType.SquareBracketOpen, '['); continue; }
      if (ch === ']') { this.addToken(CssTokenType.SquareBracketClose, ']'); continue; }
      if (ch === ',') { this.addToken(CssTokenType.Comma, ','); continue; }
      if (ch === ':') { this.addToken(CssTokenType.Colon, ':'); continue; }
      if (ch === ';') { this.addToken(CssTokenType.Semicolon, ';'); continue; }
      if (ch === '>') { this.addToken(CssTokenType.GreaterThan, '>'); continue; }
      if (ch === '+') { this.addToken(CssTokenType.Plus, '+'); continue; }
      if (ch === '~') { this.addToken(CssTokenType.Tilde, '~'); continue; }
      if (ch === '.') { this.addToken(CssTokenType.Period, '.'); continue; }
      if (ch === '=') { this.addToken(CssTokenType.Equals, '='); continue; }
      if (ch === '*') { this.addToken(CssTokenType.Asterisk, '*'); continue; }
      if (ch === '|' || ch === '^' || ch === '$') { this.addToken(CssTokenType.Ident, ch); continue; }

      // Unknown character — skip
      this.advance();
    }

    this.tokens.push({ type: CssTokenType.EOF, value: '', start: this.pos, end: this.pos, sourceLine: this.line, sourceColumn: this.column });
    return this.tokens;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CONSUMPTION METHODS
  // ───────────────────────────────────────────────────────────────────────────

  private consumeWhitespace(): void {
    const start = this.pos;
    const startLine = this.line;
    const startCol = this.column;
    while (this.pos < this.input.length && this.isWhitespace(this.input[this.pos]!)) {
      this.advance();
    }
    this.tokens.push({ type: CssTokenType.Whitespace, value: this.input.slice(start, this.pos), start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
  }

  private consumeString(): void {
    const start = this.pos;
    const startLine = this.line;
    const startCol = this.column;
    const quote = this.input[this.pos]!;
    this.advance(); // skip opening quote

    let value = '';
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos]!;
      if (ch === quote) {
        this.advance();
        this.tokens.push({ type: CssTokenType.String, value, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
        return;
      }
      if (ch === '\n') {
        this.tokens.push({ type: CssTokenType.BadString, value, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
        return;
      }
      if (ch === '\\') {
        this.advance();
        if (this.pos < this.input.length) {
          const escaped = this.input[this.pos]!;
          if (escaped === '\n') {
            this.advance();
            continue;
          }
          value += this.consumeEscaped();
          continue;
        }
      }
      value += ch;
      this.advance();
    }

    // Unterminated string — emit BadString per spec §4.3.4
    this.tokens.push({ type: CssTokenType.BadString, value, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
  }

  private consumeComment(): void {
    const start = this.pos;
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // /
    this.advance(); // *

    while (this.pos < this.input.length) {
      if (this.input[this.pos] === '*' && this.peek(1) === '/') {
        this.advance(); // *
        this.advance(); // /
        this.tokens.push({ type: CssTokenType.Comment, value: this.input.slice(start, this.pos), start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
        return;
      }
      this.advance();
    }

    // Unterminated comment
    this.tokens.push({ type: CssTokenType.BadComment, value: this.input.slice(start, this.pos), start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
  }

  private consumeHash(): void {
    const start = this.pos;
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // #

    let value = '';
    while (this.pos < this.input.length && this.isIdentChar(this.input[this.pos]!)) {
      if (this.input[this.pos] === '\\') {
        this.advance();
        value += this.consumeEscaped();
      } else {
        value += this.input[this.pos]!;
        this.advance();
      }
    }

    this.tokens.push({ type: CssTokenType.Hash, value, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
  }

  private consumeAtKeyword(): void {
    const start = this.pos;
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // @

    let value = '';
    while (this.pos < this.input.length && this.isIdentChar(this.input[this.pos]!)) {
      if (this.input[this.pos] === '\\') {
        this.advance();
        value += this.consumeEscaped();
      } else {
        value += this.input[this.pos]!;
        this.advance();
      }
    }

    this.tokens.push({ type: CssTokenType.AtKeyword, value, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
  }

  private consumeIdentOrFunction(): void {
    const start = this.pos;
    const startLine = this.line;
    const startCol = this.column;

    const value = this.consumeIdent();

    // Check if it's followed by ( — making it a function token
    // Save position before skipping whitespace so we can restore if not a function
    const savedPos = this.pos;
    const savedLine = this.line;
    const savedCol = this.column;
    this.skipWhitespace();
    if (this.pos < this.input.length && this.input[this.pos] === '(') {
      this.advance(); // (
      this.tokens.push({ type: CssTokenType.Function, value, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
      return;
    }
    // Not a function — restore position so whitespace becomes a separate token
    this.pos = savedPos;
    this.line = savedLine;
    this.column = savedCol;

    this.tokens.push({ type: CssTokenType.Ident, value, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
  }

  private consumeIdent(): string {
    let value = '';

    // Handle -- prefix (custom properties)
    if (this.pos < this.input.length && this.input[this.pos] === '-') {
      if (this.peek(1) !== undefined && (this.isIdentStart(this.peek(1)!) || this.peek(1) === '-')) {
        value += this.advance();
      }
    }

    if (this.pos < this.input.length && (this.isIdentStart(this.input[this.pos]!) || this.input[this.pos] === '\\')) {
      if (this.input[this.pos] === '\\') {
        this.advance();
        value += this.consumeEscaped();
      } else {
        value += this.advance();
      }
    }

    while (this.pos < this.input.length && this.isIdentChar(this.input[this.pos]!)) {
      if (this.input[this.pos] === '\\') {
        this.advance();
        value += this.consumeEscaped();
      } else {
        value += this.advance();
      }
    }

    return value;
  }

  private consumeNumberOrDimension(): void {
    const start = this.pos;
    const startLine = this.line;
    const startCol = this.column;

    const numStr = this.consumeNumber();

    // Save position before checking for dimension/percentage suffix
    const savedPos = this.pos;
    const savedLine = this.line;
    const savedCol = this.column;

    // Check for dimension suffix (px, em, rem, etc.) — must be immediately adjacent (no whitespace)
    if (this.pos < this.input.length && this.isIdentStart(this.input[this.pos]!)) {
      const unit = this.consumeIdent();
      this.tokens.push({ type: CssTokenType.Dimension, value: numStr + unit, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
      return;
    }

    // Check for percentage
    if (this.pos < this.input.length && this.input[this.pos] === '%') {
      this.advance();
      this.tokens.push({ type: CssTokenType.Percentage, value: numStr + '%', start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
      return;
    }

    // Not a dimension or percentage — restore position so whitespace becomes a separate token
    this.pos = savedPos;
    this.line = savedLine;
    this.column = savedCol;

    this.tokens.push({ type: CssTokenType.Number, value: numStr, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
  }

  private consumeNumber(): string {
    let value = '';

    // Sign
    if (this.pos < this.input.length && (this.input[this.pos] === '+' || this.input[this.pos] === '-')) {
      value += this.input[this.pos]!;
      this.advance();
    }

    // Integer part
    while (this.pos < this.input.length && this.isDigit(this.input[this.pos]!)) {
      value += this.input[this.pos]!;
      this.advance();
    }

    // Decimal part
    if (this.pos < this.input.length && this.input[this.pos] === '.') {
      value += '.';
      this.advance();
      while (this.pos < this.input.length && this.isDigit(this.input[this.pos]!)) {
        value += this.input[this.pos]!;
        this.advance();
      }
    }

    // Exponent
    if (this.pos < this.input.length && (this.input[this.pos] === 'e' || this.input[this.pos] === 'E')) {
      const saved = this.pos;
      const expCh = this.input[this.pos]!;
      this.advance();
      if (this.pos < this.input.length && (this.input[this.pos] === '+' || this.input[this.pos] === '-' || this.isDigit(this.input[this.pos]!))) {
        value += expCh + this.input[this.pos]!;
        this.advance();
        while (this.pos < this.input.length && this.isDigit(this.input[this.pos]!)) {
          value += this.input[this.pos]!;
          this.advance();
        }
      } else {
        this.pos = saved;
      }
    }

    return value;
  }

  private consumeUrl(): void {
    const start = this.pos;
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // u
    this.advance(); // r
    this.advance(); // l
    this.advance(); // (

    this.skipWhitespace();

    let value = '';
    if (this.pos < this.input.length && (this.input[this.pos] === '"' || this.input[this.pos] === "'")) {
      // Quoted URL
      const quote = this.input[this.pos]!;
      this.advance();
      while (this.pos < this.input.length && this.input[this.pos] !== quote && this.input[this.pos] !== '\n') {
        if (this.input[this.pos] === '\\') {
          this.advance();
          value += this.consumeEscaped();
        } else {
          value += this.input[this.pos]!;
          this.advance();
        }
      }
      if (this.pos < this.input.length) this.advance(); // closing quote
      this.skipWhitespace();
      if (this.pos < this.input.length && this.input[this.pos] === ')') {
        this.advance();
        this.tokens.push({ type: CssTokenType.Url, value, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
      } else {
        this.tokens.push({ type: CssTokenType.BadUrl, value, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
      }
    } else {
      // Unquoted URL — per spec §4.3.5, \, (, ", ', non-printable chars = BadUrl
      while (this.pos < this.input.length && this.input[this.pos] !== ')' && !this.isWhitespace(this.input[this.pos]!)) {
        const ch = this.input[this.pos]!;
        if (ch === '"' || ch === "'" || ch === '(' || ch === '\\' || this.isNonPrintable(ch)) {
          // Parse error — emit BadUrl and consume until ) or EOF
          while (this.pos < this.input.length && this.input[this.pos] !== ')') {
            this.advance();
          }
          if (this.pos < this.input.length && this.input[this.pos] === ')') {
            this.advance();
          }
          this.tokens.push({ type: CssTokenType.BadUrl, value, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
          return;
        }
        value += ch;
        this.advance();
      }
      this.skipWhitespace();
      if (this.pos < this.input.length && this.input[this.pos] === ')') {
        this.advance();
        this.tokens.push({ type: CssTokenType.Url, value, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
      } else {
        this.tokens.push({ type: CssTokenType.BadUrl, value, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ESCAPING
  // ───────────────────────────────────────────────────────────────────────────

  private consumeEscaped(): string {
    if (this.pos >= this.input.length) return '';

    const ch = this.input[this.pos]!;

    if (this.isHexDigit(ch)) {
      let hex = ch;
      this.advance();
      for (let i = 0; i < 5 && this.pos < this.input.length && this.isHexDigit(this.input[this.pos]!); i++) {
        hex += this.input[this.pos]!;
        this.advance();
      }
      // If followed by whitespace, consume it
      if (this.pos < this.input.length && this.isWhitespace(this.input[this.pos]!)) {
        this.advance();
      }
      const codePoint = parseInt(hex, 16);
      // Per spec §4.3.19: replace null, surrogates, >0x10FFFF, U+FFFE, U+FFFF with U+FFFD
      if (codePoint === 0 || codePoint > 0x10FFFF ||
          (codePoint >= 0xD800 && codePoint <= 0xDFFF) ||
          codePoint === 0xFFFE || codePoint === 0xFFFF) {
        return '\uFFFD';
      }
      return String.fromCodePoint(codePoint);
    }

    if (ch === '\n') {
      this.advance();
      return '';
    }

    this.advance();
    return ch;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ───────────────────────────────────────────────────────────────────────────

  private advance(): string {
    const ch = this.input[this.pos]!;
    this.pos++;
    if (ch === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private peek(offset: number): string | undefined {
    return this.input[this.pos + offset];
  }

  private matchAhead(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
      if (this.pos + i >= this.input.length || this.input[this.pos + i] !== str[i]) return false;
    }
    return true;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length && this.isWhitespace(this.input[this.pos]!)) {
      this.advance();
    }
  }

  private couldStartNumber(): boolean {
    const ch = this.input[this.pos]!;
    if (ch === '.' || this.isDigit(ch)) return true;
    if ((ch === '+' || ch === '-') && this.peek(1) !== undefined) {
      const next = this.peek(1)!;
      return this.isDigit(next) || (next === '.' && this.peek(2) !== undefined && this.isDigit(this.peek(2)!));
    }
    return false;
  }

  private addToken(type: CssTokenType, value: string): void {
    const start = this.pos;
    const startLine = this.line;
    const startCol = this.column;
    for (let i = 0; i < value.length; i++) {
      this.advance();
    }
    this.tokens.push({ type, value, start, end: this.pos, sourceLine: startLine, sourceColumn: startCol });
  }

  private isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isHexDigit(ch: string): boolean {
    return this.isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
  }

  private isNonPrintable(ch: string): boolean {
    const code = ch.charCodeAt(0);
    return (code >= 0x0000 && code <= 0x0008) || (code >= 0x000E && code <= 0x001F) || code === 0x007F;
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch >= '\u0080';
  }

  private isIdentChar(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch) || ch === '-';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: Filter out whitespace/comment tokens for parser
// ─────────────────────────────────────────────────────────────────────────────

export function tokenizeCss(input: string): CssToken[] {
  const tokenizer = new CssTokenizer(input);
  return tokenizer.tokenize();
}

/** Return only non-whitespace, non-comment tokens. */
export function tokenizeCssClean(input: string): CssToken[] {
  return tokenizeCss(input).filter(t =>
    t.type !== CssTokenType.Whitespace &&
    t.type !== CssTokenType.Comment &&
    t.type !== CssTokenType.BadComment &&
    t.type !== CssTokenType.EOF
  );
}
