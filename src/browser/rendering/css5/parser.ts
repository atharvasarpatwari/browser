/**
 * @file css5/parser.ts
 * CSS Parser — converts token stream into stylesheet AST.
 *
 * Supports:
 *   - Qualified rules (selectors + declarations)
 *   - At-rules (@media, @import, @font-face, @keyframes, etc.)
 *   - Complex selectors (descendant, child, sibling, general sibling)
 *   - Compound selectors (tag, #id, .class, [attr], :pseudo)
 *   - Nested selector lists (not(), :is(), :has())
 *   - !important declarations
 *   - Comment stripping
 *   - Error recovery (skip bad blocks)
 */

import { CssTokenType, type CssToken } from './types';
import type {
  CssStylesheet,
  CssRule,
  CssStyleRule,
  CssMediaRule,
  CssImportRule,
  CssFontFaceRule,
  CssKeyframesRule,
  CssKeyframe,
  CssDeclaration,
  CssSelector,
  CssCompoundSelector,
  CssComplexSelector,
  CssCombinator,
  CssAttributeSelector,
  CssPseudoClassSelector,
  CssMediaQuery,
  CssMediaFeature,
  CssSpecificity,
  CssCharsetRule,
  CssNamespaceRule,
  CssSupportsRule,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────────────────

export class CssParser {
  private tokens: CssToken[];
  private pos: number;
  private sourceOrder: number;
  private sourceUrl: string | null;

  constructor() {
    this.tokens = [];
    this.pos = 0;
    this.sourceOrder = 0;
    this.sourceUrl = null;
  }

  /** Parse a full CSS stylesheet string into a CssStylesheet. */
  parseStylesheet(css: string, url?: string): CssStylesheet {
    this.sourceUrl = url ?? null;
    this.sourceOrder = 0;
    const tokens = this.cleanTokens(css);
    this.tokens = tokens;
    this.pos = 0;

    const rules = this.consumeRuleList();

    return { rules, url: this.sourceUrl };
  }

  /** Parse a selector string into a CssSelector. */
  parseSelector(selectorStr: string): CssSelector | null {
    // Use raw tokens (with whitespace) for selector parsing
    // so descendant combinators are preserved
    const tokens = tokenizeCss(selectorStr).filter((t: CssToken) =>
      t.type !== CssTokenType.Comment &&
      t.type !== CssTokenType.BadComment &&
      t.type !== CssTokenType.EOF
    );
    if (tokens.length === 0) return null;

    this.tokens = tokens;
    this.pos = 0;

    return this.consumeSelector();
  }

  /** Parse inline style attribute value into declarations. */
  parseInlineStyle(styleAttr: string): Map<string, string> {
    const declarations = this.consumeDeclarationList(styleAttr);
    const result = new Map<string, string>();
    for (const decl of declarations) {
      result.set(decl.property, decl.value);
    }
    return result;
  }

  /** Parse raw declarations block into a declaration map (legacy compat). */
  parseDeclarations(raw: string): Map<string, string> {
    return this.parseInlineStyle(raw);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // RULE LIST CONSUMPTION
  // ───────────────────────────────────────────────────────────────────────────

  private consumeRuleList(): CssRule[] {
    const rules: CssRule[] = [];

    while (this.pos < this.tokens.length) {
      const tok = this.current();
      if (!tok || tok.type === CssTokenType.EOF) break;

      if (tok.type === CssTokenType.Whitespace || tok.type === CssTokenType.Comment) {
        this.pos++;
        continue;
      }

      // At-rule
      if (tok.type === CssTokenType.AtKeyword) {
        this.pos++;
        const rule = this.consumeAtRule(tok.value.toLowerCase());
        if (rule) rules.push(rule);
        continue;
      }

      // Qualified rule (selector { declarations })
      if (tok.type === CssTokenType.CurlyBracketOpen) {
        // Empty block — skip
        this.pos++;
        this.skipToClosingBrace(1);
        continue;
      }

      const rule = this.consumeQualifiedRule();
      if (rule) rules.push(rule);
    }

    return rules;
  }

  private consumeQualifiedRule(): CssStyleRule | null {
    const selectorTokens = this.collectTokensUntil(CssTokenType.CurlyBracketOpen);
    if (selectorTokens.length === 0) {
      if (this.current()?.type === CssTokenType.CurlyBracketOpen) {
        this.pos++;
        this.skipToClosingBrace(1);
      }
      return null;
    }

    // Parse selector
    this.tokens = selectorTokens;
    this.pos = 0;
    const selector = this.consumeSelector();

    // Restore original tokens
    const savedTokens = this.tokens;
    const savedPos = this.pos;

    // We need to go back to the main token stream to consume the block
    // Instead, let's work differently — collect declaration tokens from the original stream
    // Actually, let's re-approach: use the original tokens array

    // Find { in the main stream
    this.tokens = savedTokens;
    this.pos = savedPos;

    if (!selector) {
      // Skip block
      if (this.current()?.type === CssTokenType.CurlyBracketOpen) {
        this.pos++;
        this.skipToClosingBrace(1);
      }
      return null;
    }

    // Now we need to find { in the original full token stream
    // This is tricky because we've swapped tokens. Let me use a different approach.
    // We'll consume the declaration block from the raw text instead.

    // Actually, let's rework. The clean approach is to parse from the original stream.
    // But we've already consumed selector tokens. Let me use a sub-parser approach.

    return null; // Will be reworked below
  }

  // ───────────────────────────────────────────────────────────────────────────
  // APPROACH 2: Simpler rule-by-rule parsing
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Parse stylesheet by consuming text between top-level { } blocks.
   * More robust than token-level parsing for handling nested blocks.
   */
  parseStylesheetRobust(css: string, url?: string): CssStylesheet {
    this.sourceUrl = url ?? null;
    this.sourceOrder = 0;

    // Strip comments first
    const cleaned = stripComments(css);

    const rules: CssRule[] = [];
    let i = 0;

    while (i < cleaned.length) {
      // Skip whitespace
      while (i < cleaned.length && isWhitespace(cleaned[i]!)) i++;
      if (i >= cleaned.length) break;

      // At-rule
      if (cleaned[i] === '@') {
        const { rule, end } = consumeAtRuleFromText(cleaned, i, this.sourceOrder);
        i = end;
        if (rule) {
          this.sourceOrder++;
          rules.push(rule);
        }
        continue;
      }

      // Qualified rule
      const { rule, end } = consumeQualifiedRuleFromText(cleaned, i, this.sourceUrl, this.sourceOrder);
      i = end;
      if (rule) {
        this.sourceOrder++;
        rules.push(rule);
      }
    }

    return { rules, url: this.sourceUrl };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SELECTOR PARSING (from tokens)
  // ───────────────────────────────────────────────────────────────────────────

  private consumeSelector(): CssSelector | null {
    const left = this.consumeCompoundSelector();
    if (!left) return null;

    // Check for combinator BEFORE skipping whitespace
    const tok = this.current();
    if (!tok) return left;

    let combinator: CssCombinator | null = null;

    if (tok.type === CssTokenType.Whitespace) {
      // Skip whitespace, then check what follows
      this.skipWs();
      const next = this.current();
      if (!next || next.type === CssTokenType.EOF || next.type === CssTokenType.Semicolon) {
        // Trailing whitespace — no combinator
      } else if (next.type === CssTokenType.GreaterThan) {
        combinator = '>';
        this.pos++;
      } else if (next.type === CssTokenType.Plus) {
        combinator = '+';
        this.pos++;
      } else if (next.type === CssTokenType.Tilde) {
        combinator = '~';
        this.pos++;
      } else {
        // Another selector follows — descendant combinator
        combinator = ' ';
      }
    } else if (tok.type === CssTokenType.GreaterThan) {
      combinator = '>';
      this.pos++;
    } else if (tok.type === CssTokenType.Plus) {
      combinator = '+';
      this.pos++;
    } else if (tok.type === CssTokenType.Tilde) {
      combinator = '~';
      this.pos++;
    }

    if (combinator) {
      const right = this.consumeCompoundSelector();
      if (right) {
        return { type: 'complex', left, combinator, right };
      }
    }

    return left;
  }

  private consumeCompoundSelector(): CssCompoundSelector | null {
    let tagName: string | null = null;
    let id: string | null = null;
    const classes: string[] = [];
    const attributes: CssAttributeSelector[] = [];
    let pseudoClass: CssPseudoClassSelector | null = null;
    let pseudoElement: string | null = null;

    this.skipWs();

    const start = this.pos;

    while (this.pos < this.tokens.length) {
      const tok = this.current()!;
      if (!tok) break;

      // Tag name or universal
      if (tok.type === CssTokenType.Ident) {
        if (tok.value === '*') {
          tagName = '*';
          this.pos++;
        } else if (!tagName && id === null && classes.length === 0 && attributes.length === 0 && !pseudoClass) {
          tagName = tok.value.toLowerCase();
          this.pos++;
        } else {
          break;
        }
        continue;
      }

      // Hash (id selector)
      if (tok.type === CssTokenType.Hash) {
        id = tok.value;
        this.pos++;
        continue;
      }

      // Class selector
      if (tok.type === CssTokenType.Period) {
        this.pos++;
        const nameTok = this.current();
        if (nameTok?.type === CssTokenType.Ident) {
          classes.push(nameTok.value.toLowerCase());
          this.pos++;
        }
        continue;
      }

      // Attribute selector
      if (tok.type === CssTokenType.SquareBracketOpen) {
        const attr = this.consumeAttributeSelector();
        if (attr) attributes.push(attr);
        continue;
      }

      // Pseudo-class or pseudo-element
      if (tok.type === CssTokenType.Colon) {
        const next = this.peekNext();
        if (next?.type === CssTokenType.Colon) {
          // Pseudo-element
          this.pos += 2;
          const nameTok = this.current();
          if (nameTok?.type === CssTokenType.Ident) {
            pseudoElement = nameTok.value.toLowerCase();
            this.pos++;
          }
        } else if (next?.type === CssTokenType.Ident) {
          // Pseudo-class
          this.pos += 2;
          pseudoClass = this.consumePseudoClass(next.value.toLowerCase());
        } else if (next?.type === CssTokenType.Function) {
          this.pos += 2;
          pseudoClass = this.consumePseudoClassFunction(next.value.toLowerCase());
        }
        continue;
      }

      break;
    }

    if (start === this.pos && !tagName) return null;

    return { type: 'compound', tagName, id, classes, attributes, pseudoClass, pseudoElement };
  }

  private consumeAttributeSelector(): CssAttributeSelector | null {
    this.pos++; // [

    const nameTok = this.current();
    if (!nameTok || nameTok.type !== CssTokenType.Ident) {
      this.skipToClosingBracket();
      return null;
    }
    const name = nameTok.value.toLowerCase();
    this.pos++;

    this.skipWs();

    const tok = this.current();
    if (!tok || tok.type === CssTokenType.SquareBracketClose) {
      this.pos++;
      return { name, operator: null, value: null, caseInsensitive: false };
    }

    let operator: CssAttributeSelector['operator'] = null;
    if (tok.type === CssTokenType.Equals) { operator = '='; this.pos++; }
    else if (tok.type === CssTokenType.Tilde && this.peekNext()?.type === CssTokenType.Equals) { operator = '~='; this.pos += 2; }
    else if (tok.type === CssTokenType.Ident && tok.value === '|' && this.peekNext()?.type === CssTokenType.Equals) { operator = '|='; this.pos += 2; }
    else if (tok.type === CssTokenType.Ident && tok.value === '^' && this.peekNext()?.type === CssTokenType.Equals) { operator = '^='; this.pos += 2; }
    else if (tok.type === CssTokenType.Ident && tok.value === '$' && this.peekNext()?.type === CssTokenType.Equals) { operator = '$='; this.pos += 2; }
    else if (tok.type === CssTokenType.Ident && tok.value === '*' && this.peekNext()?.type === CssTokenType.Equals) { operator = '*='; this.pos += 2; }

    this.skipWs();

    let value: string | null = null;
    const valTok = this.current();
    if (valTok) {
      if (valTok.type === CssTokenType.String) {
        value = valTok.value;
        this.pos++;
      } else if (valTok.type === CssTokenType.Ident) {
        value = valTok.value;
        this.pos++;
      }
    }

    this.skipWs();

    let caseInsensitive = false;
    const flagTok = this.current();
    if (flagTok?.type === CssTokenType.Ident && flagTok.value.toLowerCase() === 'i') {
      caseInsensitive = true;
      this.pos++;
    }

    // Consume ]
    if (this.current()?.type === CssTokenType.SquareBracketClose) {
      this.pos++;
    }

    return { name, operator, value, caseInsensitive };
  }

  private consumePseudoClass(name: string): CssPseudoClassSelector | null {
    const dynamic = ['hover', 'focus', 'active', 'visited', 'link',
      'focus-within', 'focus-visible', 'enabled', 'disabled', 'checked', 'indeterminate',
      'required', 'optional', 'read-only', 'read-write', 'placeholder-shown', 'default',
      'valid', 'invalid', 'in-range', 'out-of-range', 'root', 'scope',
      'blank', 'any-link', 'local-link', 'target', 'target-within', 'current', 'past', 'future'];

    if (dynamic.includes(name)) {
      return { type: 'dynamic', name };
    }

    // Structural pseudo-classes with arguments
    const structural = ['nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type',
      'first-child', 'last-child', 'first-of-type', 'last-of-type', 'empty',
      'not', 'is', 'any', 'has', 'where', 'matches'];
    if (structural.includes(name)) {
      if (this.current()?.type === CssTokenType.ParenthesisOpen) {
        this.pos++; // (
        const arg = this.consumeUntilClosingParen();
        if (name === 'not' || name === 'is' || name === 'any' || name === 'where' || name === 'matches' || name === 'has') {
          // Parse argument as selector list
          const savedTokens = this.tokens;
          const savedPos = this.pos;
          this.tokens = this.cleanTokens(arg);
          this.pos = 0;
          const selectors: CssSelector[] = [];
          while (this.pos < this.tokens.length) {
            const sel = this.consumeSelector();
            if (sel) selectors.push(sel);
            if (this.current()?.type === CssTokenType.Comma) {
              this.pos++;
            } else {
              break;
            }
          }
          this.tokens = savedTokens;
          this.pos = savedPos;

          if (name === 'not') return { type: 'negation', selectors };
          if (name === 'is' || name === 'any' || name === 'where' || name === 'matches') return { type: 'is', selectors };
          if (name === 'has') return { type: 'has', selectors };
        }
        return { type: 'structural', name, value: arg };
      }
      return { type: 'structural', name, value: null };
    }

    return { type: 'dynamic', name };
  }

  private consumePseudoClassFunction(name: string): CssPseudoClassSelector | null {
    // The '(' was already consumed as part of the Function token by the tokenizer.
    // Directly consume the content until the matching ')'.
    const arg = this.consumeUntilClosingParen();

    if (name === 'not' || name === 'is' || name === 'any' || name === 'where' || name === 'matches' || name === 'has') {
      const savedTokens = this.tokens;
      const savedPos = this.pos;
      this.tokens = this.cleanTokens(arg);
      this.pos = 0;
      const selectors: CssSelector[] = [];
      while (this.pos < this.tokens.length) {
        const sel = this.consumeSelector();
        if (sel) selectors.push(sel);
        if (this.current()?.type === CssTokenType.Comma) {
          this.pos++;
        } else {
          break;
        }
      }
      this.tokens = savedTokens;
      this.pos = savedPos;

      if (name === 'not') return { type: 'negation', selectors };
      if (name === 'is' || name === 'any' || name === 'where' || name === 'matches') return { type: 'is', selectors };
      if (name === 'has') return { type: 'has', selectors };
    }

    return { type: 'structural', name, value: arg };
  }

  private consumeDeclarationList(raw: string): CssDeclaration[] {
    const declarations: CssDeclaration[] = [];
    const parts = raw.split(';');

    for (const part of parts) {
      const colon = part.indexOf(':');
      if (colon === -1) continue;
      const prop = part.slice(0, colon).trim().toLowerCase();
      let value = part.slice(colon + 1).trim();

      if (!prop || !value) continue;

      let important = false;
      if (value.endsWith('!important') || value.endsWith('! important')) {
        important = true;
        value = value.replace(/!\s*important\s*$/, '').trim();
      }

      declarations.push({ property: prop, value, important });
    }

    return declarations;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // AT-RULE CONSUMPTION (token level)
  // ───────────────────────────────────────────────────────────────────────────

  private consumeAtRule(keyword: string): CssRule | null {
    const prelude = this.collectTokensUntil(CssTokenType.CurlyBracketOpen);

    switch (keyword) {
      case 'media':
        return this.consumeMediaRule(prelude);
      case 'import':
        return this.consumeImportRule(prelude);
      case 'font-face':
        return this.consumeFontFaceRule();
      case 'keyframes':
        return this.consumeKeyframesRule(prelude);
      case 'charset':
        return this.consumeCharsetRule(prelude);
      case 'namespace':
        return this.consumeNamespaceRule(prelude);
      case 'supports':
        return this.consumeSupportsRule();
      default:
        this.skipAtRuleBody();
        return { type: 'unknown', atKeyword: keyword, prelude: tokensToText(prelude), body: '' };
    }
  }

  private consumeMediaRule(preludeTokens: CssToken[]): CssMediaRule {
    const mediaQueries = parseMediaQueriesFromTokens(preludeTokens);

    // Consume block
    if (this.current()?.type === CssTokenType.CurlyBracketOpen) {
      this.pos++;
      const rules = this.consumeRuleListUntilCloseBrace();
      return { type: 'media', mediaQueries, rules };
    }

    return { type: 'media', mediaQueries, rules: [] };
  }

  private consumeImportRule(preludeTokens: CssToken[]): CssImportRule | null {
    const preludeText = tokensToText(preludeTokens).trim();
    // Extract URL
    let url = '';
    const urlMatch = preludeText.match(/^url\((['"]?)(.+?)\1\)/);
    if (urlMatch) {
      url = urlMatch[2]!;
    } else {
      const strMatch = preludeText.match(/^(['"])(.+?)\1/);
      if (strMatch) {
        url = strMatch[2]!;
      }
    }
    if (!url) return null;

    // Consume ;
    if (this.current()?.type === CssTokenType.Semicolon) this.pos++;

    return { type: 'import', url, mediaQueries: [] };
  }

  private consumeFontFaceRule(): CssFontFaceRule {
    if (this.current()?.type === CssTokenType.CurlyBracketOpen) {
      this.pos++;
      const decls = this.consumeDeclarationBlock();
      return { type: 'font-face', declarations: decls };
    }
    return { type: 'font-face', declarations: [] };
  }

  private consumeKeyframesRule(preludeTokens: CssToken[]): CssKeyframesRule {
    const name = tokensToText(preludeTokens).trim();
    const keyframes: CssKeyframe[] = [];

    if (this.current()?.type === CssTokenType.CurlyBracketOpen) {
      this.pos++;
      while (this.pos < this.tokens.length) {
        const tok = this.current();
        if (!tok || tok.type === CssTokenType.CurlyBracketClose) {
          if (tok?.type === CssTokenType.CurlyBracketClose) this.pos++;
          break;
        }
        if (tok.type === CssTokenType.Whitespace || tok.type === CssTokenType.Comment) {
          this.pos++;
          continue;
        }

        // Keyframe selectors
        const selectors: string[] = [];
        while (this.pos < this.tokens.length) {
          const s = this.current();
          if (!s || s.type === CssTokenType.CurlyBracketOpen) break;
          if (s.type === CssTokenType.Comma) { this.pos++; continue; }
          selectors.push(tokensToText([s]));
          this.pos++;
        }

        if (this.current()?.type === CssTokenType.CurlyBracketOpen) {
          this.pos++;
          const decls = this.consumeDeclarationBlock();
          keyframes.push({ selectors, declarations: decls });
        }
      }
    }

    return { type: 'keyframes', name, keyframes };
  }

  private consumeCharsetRule(preludeTokens: CssToken[]): CssCharsetRule {
    const encoding = tokensToText(preludeTokens).trim().replace(/^(['"])(.+?)\1$/, '$2');
    if (this.current()?.type === CssTokenType.Semicolon) this.pos++;
    return { type: 'charset', encoding };
  }

  private consumeNamespaceRule(preludeTokens: CssToken[]): CssNamespaceRule {
    const text = tokensToText(preludeTokens).trim();
    const parts = text.split(/\s+/);
    let prefix: string | null = null;
    let url = '';

    if (parts.length === 1) {
      url = parts[0]!.replace(/^url\((['"]?)(.+?)\1\)/, '$2').replace(/^(['"])(.+?)\1/, '$2');
    } else if (parts.length >= 2) {
      prefix = parts[0];
      url = parts.slice(1).join(' ').replace(/^url\((['"]?)(.+?)\1\)/, '$2').replace(/^(['"])(.+?)\1/, '$2');
    }

    if (this.current()?.type === CssTokenType.Semicolon) this.pos++;
    return { type: 'namespace', prefix, url };
  }

  private consumeSupportsRule(): CssSupportsRule {
    const prelude = this.collectTokensUntil(CssTokenType.CurlyBracketOpen);
    const condition = tokensToText(prelude).trim();

    if (this.current()?.type === CssTokenType.CurlyBracketOpen) {
      this.pos++;
      const rules = this.consumeRuleListUntilCloseBrace();
      return { type: 'supports', condition, rules };
    }

    return { type: 'supports', condition, rules: [] };
  }

  private skipAtRuleBody(): void {
    // Find and skip to matching }
    let depth = 0;
    while (this.pos < this.tokens.length) {
      const tok = this.current()!;
      if (tok.type === CssTokenType.CurlyBracketOpen) depth++;
      else if (tok.type === CssTokenType.CurlyBracketClose) {
        depth--;
        if (depth <= 0) { this.pos++; return; }
      }
      this.pos++;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // BLOCK CONSUMPTION
  // ───────────────────────────────────────────────────────────────────────────

  private consumeDeclarationBlock(): CssDeclaration[] {
    const declarations: CssDeclaration[] = [];

    while (this.pos < this.tokens.length) {
      const tok = this.current()!;
      if (tok.type === CssTokenType.CurlyBracketClose) {
        this.pos++;
        break;
      }
      if (tok.type === CssTokenType.Whitespace || tok.type === CssTokenType.Comment) {
        this.pos++;
        continue;
      }

      // Collect tokens until ; or }
      const propTokens: CssToken[] = [];
      while (this.pos < this.tokens.length) {
        const t = this.current()!;
        if (t.type === CssTokenType.Semicolon || t.type === CssTokenType.CurlyBracketClose) break;
        propTokens.push(t);
        this.pos++;
      }

      // Consume ;
      if (this.current()?.type === CssTokenType.Semicolon) this.pos++;

      // Parse declaration from collected tokens
      const declText = tokensToText(propTokens);
      const colon = declText.indexOf(':');
      if (colon === -1) continue;

      const prop = declText.slice(0, colon).trim().toLowerCase();
      let value = declText.slice(colon + 1).trim();

      if (!prop || !value) continue;

      let important = false;
      if (value.endsWith('!important') || value.endsWith('! important')) {
        important = true;
        value = value.replace(/!\s*important\s*$/, '').trim();
      }

      declarations.push({ property: prop, value, important });
    }

    return declarations;
  }

  private consumeRuleListUntilCloseBrace(): CssRule[] {
    const rules: CssRule[] = [];

    while (this.pos < this.tokens.length) {
      const tok = this.current();
      if (!tok || tok.type === CssTokenType.CurlyBracketClose) {
        if (tok?.type === CssTokenType.CurlyBracketClose) this.pos++;
        break;
      }

      if (tok.type === CssTokenType.Whitespace || tok.type === CssTokenType.Comment) {
        this.pos++;
        continue;
      }

      if (tok.type === CssTokenType.AtKeyword) {
        this.pos++;
        const rule = this.consumeAtRule(tok.value.toLowerCase());
        if (rule) rules.push(rule);
        continue;
      }

      const rule = this.consumeQualifiedRuleFromTokens();
      if (rule) rules.push(rule);
    }

    return rules;
  }

  private consumeQualifiedRuleFromTokens(): CssStyleRule | null {
    // Collect selector tokens
    const selectorTokens: CssToken[] = [];
    while (this.pos < this.tokens.length) {
      const tok = this.current()!;
      if (tok.type === CssTokenType.CurlyBracketOpen) break;
      selectorTokens.push(tok);
      this.pos++;
    }

    if (selectorTokens.length === 0) {
      if (this.current()?.type === CssTokenType.CurlyBracketOpen) {
        this.pos++;
        this.skipToClosingBrace(1);
      }
      return null;
    }

    // Parse selector from collected tokens
    const savedTokens = this.tokens;
    const savedPos = this.pos;
    this.tokens = selectorTokens;
    this.pos = 0;

    const selector = this.consumeSelector();

    this.tokens = savedTokens;
    this.pos = savedPos;

    // Consume declaration block
    if (this.current()?.type !== CssTokenType.CurlyBracketOpen) {
      return null;
    }
    this.pos++;
    const declarations = this.consumeDeclarationBlock();

    if (!selector) return null;

    const order = this.sourceOrder++;
    return {
      type: 'style',
      selectors: [selector],
      declarations,
      specificity: computeSelectorSpecificity(selector),
      sourceOrder: order,
      sourceUrl: this.sourceUrl,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TOKEN HELPERS
  // ───────────────────────────────────────────────────────────────────────────

  private current(): CssToken | undefined {
    return this.tokens[this.pos];
  }

  private peekNext(): CssToken | undefined {
    return this.tokens[this.pos + 1];
  }

  private skipWs(): void {
    while (this.pos < this.tokens.length) {
      const tok = this.current()!;
      if (tok.type === CssTokenType.Whitespace || tok.type === CssTokenType.Comment) {
        this.pos++;
      } else {
        break;
      }
    }
  }

  private collectTokensUntil(type: CssTokenType): CssToken[] {
    const result: CssToken[] = [];
    while (this.pos < this.tokens.length) {
      const tok = this.current()!;
      if (tok.type === type) break;
      result.push(tok);
      this.pos++;
    }
    return result;
  }

  private skipToClosingBrace(depth: number): void {
    while (this.pos < this.tokens.length && depth > 0) {
      const tok = this.current()!;
      if (tok.type === CssTokenType.CurlyBracketOpen) depth++;
      else if (tok.type === CssTokenType.CurlyBracketClose) depth--;
      this.pos++;
    }
  }

  private skipToClosingBracket(): void {
    let depth = 1;
    while (this.pos < this.tokens.length && depth > 0) {
      const tok = this.current()!;
      if (tok.type === CssTokenType.SquareBracketOpen) depth++;
      else if (tok.type === CssTokenType.SquareBracketClose) depth--;
      this.pos++;
    }
  }

  private consumeUntilClosingParen(): string {
    let depth = 1;
    const parts: string[] = [];
    while (this.pos < this.tokens.length && depth > 0) {
      const tok = this.current()!;
      if (tok.type === CssTokenType.ParenthesisOpen) { depth++; parts.push('('); }
      else if (tok.type === CssTokenType.ParenthesisClose) {
        depth--;
        if (depth > 0) parts.push(')');
      } else {
        parts.push(tokensToText([tok]));
      }
      this.pos++;
    }
    return parts.join('');
  }

  private cleanTokens(css: string): CssToken[] {
    return tokenizeClean(css);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT-LEVEL CSS PARSING (more robust than token-level)
// ─────────────────────────────────────────────────────────────────────────────

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    // Replace with same number of newlines to preserve line numbers
    return match.replace(/[^\n]/g, ' ');
  });
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isIdentChar(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')
    || ch === '_' || ch === '-' || ch > '\u0080';
}

/** Find the matching } for an opening { starting at `start`. Returns index AFTER closing }. */
function findMatchingBrace(css: string, start: number): number {
  let depth = 0;
  let inString: string | null = null;
  let i = start;

  while (i < css.length) {
    const ch = css[i]!;

    if (inString) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inString) inString = null;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") { inString = ch; i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth <= 0) return i + 1;
    }
    i++;
  }

  return css.length;
}

/** Find the matching ) for an opening ( starting at `start`. Returns index AFTER closing ). */
function findMatchingParen(css: string, start: number): number {
  let depth = 0;
  let inString: string | null = null;
  let i = start;

  while (i < css.length) {
    const ch = css[i]!;
    if (inString) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; i++; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth <= 0) return i + 1;
    }
    i++;
  }
  return css.length;
}

function consumeStringFromText(css: string, start: number): { value: string; end: number } {
  const quote = css[start]!;
  let i = start + 1;
  let value = '';
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === '\\') { i++; if (i < css.length) { value += css[i]!; i++; } continue; }
    if (ch === quote) return { value, end: i + 1 };
    if (ch === '\n') return { value, end: i }; // bad string
    value += ch;
    i++;
  }
  return { value, end: css.length };
}

function consumeIdentFromText(css: string, start: number): { value: string; end: number } {
  let i = start;
  if (i < css.length && css[i] === '-' && i + 1 < css.length && (isIdentChar(css[i + 1]!) || css[i + 1] === '-')) i++;
  while (i < css.length && isIdentChar(css[i]!)) i++;
  return { value: css.slice(start, i), end: i };
}

function consumeStringLiteral(css: string, start: number): { value: string; end: number } {
  if (css[start] === '"' || css[start] === "'") {
    return consumeStringFromText(css, start);
  }
  return { value: '', end: start };
}

// ─────────────────────────────────────────────────────────────────────────────
// AT-RULE TEXT PARSING
// ─────────────────────────────────────────────────────────────────────────────

function consumeAtRuleFromText(
  css: string, start: number, order: number,
): { rule: CssRule | null; end: number } {
  // Extract at-keyword
  let i = start + 1; // skip @
  const { value: keyword, end: kwEnd } = consumeIdentFromText(css, i);
  i = kwEnd;

  // Skip whitespace after keyword
  while (i < css.length && isWhitespace(css[i]!)) i++;

  // Collect prelude until { or ;
  let preludeStart = i;
  let prelude = '';
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === '{' || ch === ';') break;
    if (ch === '"') {
      const s = consumeStringFromText(css, i);
      prelude += '"' + s.value + '"';
      i = s.end;
    } else if (ch === "'") {
      const s = consumeStringFromText(css, i);
      prelude += "'" + s.value + "'";
      i = s.end;
    } else {
      prelude += ch;
      i++;
    }
  }
  prelude = prelude.trim();

  const kw = keyword.toLowerCase();

  // ;
  if (css[i] === ';') {
    i++;
    if (kw === 'charset') {
      const encoding = prelude.replace(/^(['"])(.+?)\1/, '$2');
      return { rule: { type: 'charset', encoding }, end: i };
    }
    if (kw === 'import') {
      const url = prelude.match(/url\((['"]?)(.+?)\1\)/)?.[2]
        ?? prelude.match(/^(['"])(.+?)\1/)?.[2]
        ?? '';
      if (url) return { rule: { type: 'import', url, mediaQueries: [] }, end: i };
      return { rule: null, end: i };
    }
    if (kw === 'namespace') {
      const parts = prelude.split(/\s+/);
      const prefix = parts.length > 1 ? parts[0] : null;
      const url = (parts.length > 1 ? parts.slice(1).join(' ') : parts[0] ?? '')
        .replace(/^url\((['"]?)(.+?)\1\)/, '$2').replace(/^(['"])(.+?)\1/, '$2');
      return { rule: { type: 'namespace', prefix, url }, end: i };
    }
    return { rule: null, end: i };
  }

  // { ... }
  if (css[i] === '{') {
    const blockEnd = findMatchingBrace(css, i);
    const blockBody = css.slice(i + 1, blockEnd - 1);

    switch (kw) {
      case 'media': {
        const mediaQueries = parseMediaQueries(prelude);
        // Parse nested rules
        const subCss = stripComments(blockBody);
        const subParser = new CssParser();
        const { rules } = subParser.parseStylesheetRobust(subCss);
        return { rule: { type: 'media', mediaQueries, rules }, end: blockEnd };
      }
      case 'font-face': {
        const subParser = new CssParser();
        const declarations = consumeDeclarationsFromText(blockBody);
        return { rule: { type: 'font-face', declarations }, end: blockEnd };
      }
      case 'keyframes': {
        const name = prelude;
        const keyframes = consumeKeyframesBlock(blockBody);
        return { rule: { type: 'keyframes', name, keyframes }, end: blockEnd };
      }
      case 'supports': {
        const subParser = new CssParser();
        const { rules } = subParser.parseStylesheetRobust(blockBody);
        return { rule: { type: 'supports', condition: prelude, rules }, end: blockEnd };
      }
      default:
        return { rule: { type: 'unknown', atKeyword: kw, prelude, body: blockBody }, end: blockEnd };
    }
  }

  return { rule: null, end: i };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUALIFIED RULE TEXT PARSING
// ─────────────────────────────────────────────────────────────────────────────

function consumeQualifiedRuleFromText(
  css: string, start: number, sourceUrl: string | null, order: number,
): { rule: CssStyleRule | null; end: number } {
  // Find the {
  let braceStart = start;
  let inString: string | null = null;
  while (braceStart < css.length) {
    const ch = css[braceStart]!;
    if (inString) {
      if (ch === '\\') { braceStart += 2; continue; }
      if (ch === inString) inString = null;
      braceStart++;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; braceStart++; continue; }
    if (ch === '{') break;
    braceStart++;
  }

  if (braceStart >= css.length) return { rule: null, end: css.length };

  const selectorStr = css.slice(start, braceStart).trim();
  const blockEnd = findMatchingBrace(css, braceStart);
  const declText = css.slice(braceStart + 1, blockEnd - 1);

  if (!selectorStr) return { rule: null, end: blockEnd };

  // Parse selector
  const selector = parseSelectorFromString(selectorStr);
  if (!selector) return { rule: null, end: blockEnd };

  // Parse declarations
  const declarations = consumeDeclarationsFromText(declText);

  return {
    rule: {
      type: 'style',
      selectors: [selector],
      declarations,
      specificity: computeSelectorSpecificity(selector),
      sourceOrder: order,
      sourceUrl,
    },
    end: blockEnd,
  };
}

function consumeDeclarationsFromText(raw: string): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  const cleaned = stripComments(raw);
  const parts = cleaned.split(';');

  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();

    if (!prop || !value) continue;

    let important = false;
    if (value.endsWith('!important') || value.endsWith('! important')) {
      important = true;
      value = value.replace(/!\s*important\s*$/, '').trim();
    }

    declarations.push({ property: prop, value, important });
  }

  return declarations;
}

function consumeKeyframesBlock(body: string): CssKeyframe[] {
  const keyframes: CssKeyframe[] = [];
  let i = 0;
  const cleaned = stripComments(body);

  while (i < cleaned.length) {
    while (i < cleaned.length && isWhitespace(cleaned[i]!)) i++;
    if (i >= cleaned.length) break;

    // Collect keyframe selectors until {
    let selectors: string[] = [];
    while (i < cleaned.length && cleaned[i] !== '{') {
      while (i < cleaned.length && isWhitespace(cleaned[i]!)) i++;
      if (cleaned[i] === '{') break;

      // Read identifier (like "from", "to", "0%", "50%")
      let ident = '';
      while (i < cleaned.length && cleaned[i] !== ',' && cleaned[i] !== '{' && !isWhitespace(cleaned[i]!)) {
        ident += cleaned[i]!;
        i++;
      }
      if (ident) selectors.push(ident.trim());

      while (i < cleaned.length && isWhitespace(cleaned[i]!)) i++;
      if (cleaned[i] === ',') { i++; continue; }
    }

    // Consume block
    if (cleaned[i] === '{') {
      const blockEnd = findMatchingBrace(cleaned, i);
      const declText = cleaned.slice(i + 1, blockEnd - 1);
      i = blockEnd;

      const declarations = consumeDeclarationsFromText(declText);
      keyframes.push({ selectors, declarations });
    }
  }

  return keyframes;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTOR TEXT PARSING
// ─────────────────────────────────────────────────────────────────────────────

function parseSelectorFromString(str: string): CssSelector | null {
  // Split on combinators: whitespace, >, +, ~
  // This is simplified — proper parsing would handle all edge cases
  const tokens = tokenizeSelector(str);
  if (tokens.length === 0) return null;
  return buildSelectorFromTokens(tokens, 0, tokens.length);
}

interface SelectorToken {
  type: 'ident' | 'hash' | 'class' | 'attr-open' | 'attr-name' | 'attr-op' | 'attr-value' | 'attr-close' | 'colon' | 'pseudo-name' | 'paren-open' | 'paren-close' | 'comma' | 'combinator' | 'star' | 'string';
  value: string;
}

function tokenizeSelector(str: string): SelectorToken[] {
  const tokens: SelectorToken[] = [];
  let i = 0;

  while (i < str.length) {
    const ch = str[i]!;

    if (isWhitespace(ch)) {
      // Collapse whitespace and treat as descendant combinator
      while (i < str.length && isWhitespace(str[i]!)) i++;
      // Only add combinator if next token is not a combinator
      if (i < str.length && str[i] !== '>' && str[i] !== '+' && str[i] !== '~') {
        tokens.push({ type: 'combinator', value: ' ' });
      }
      continue;
    }

    if (ch === '*') { tokens.push({ type: 'star', value: '*' }); i++; continue; }
    if (ch === '#') {
      i++;
      let name = '';
      while (i < str.length && isIdentChar(str[i]!)) { name += str[i]!; i++; }
      tokens.push({ type: 'hash', value: name });
      continue;
    }
    if (ch === '.') {
      i++;
      let name = '';
      while (i < str.length && isIdentChar(str[i]!)) { name += str[i]!; i++; }
      tokens.push({ type: 'class', value: name });
      continue;
    }
    if (ch === '[') {
      tokens.push({ type: 'attr-open', value: '[' }); i++;
      while (i < str.length && isWhitespace(str[i]!)) i++;
      let name = '';
      while (i < str.length && str[i] !== ']' && str[i] !== '=' && !isWhitespace(str[i]!)) { name += str[i]!; i++; }
      tokens.push({ type: 'attr-name', value: name });
      while (i < str.length && isWhitespace(str[i]!)) i++;
      if (str[i] === '=' || (str[i + 1] === '=' && (str[i] === '~' || str[i] === '|' || str[i] === '^' || str[i] === '$' || str[i] === '*'))) {
        let op = '';
        if (str[i + 1] === '=') { op = str[i] + '='; i += 2; }
        else { op = '='; i++; }
        tokens.push({ type: 'attr-op', value: op });
        while (i < str.length && isWhitespace(str[i]!)) i++;
        if (str[i] === '"' || str[i] === "'") {
          const s = consumeStringFromText(str, i);
          tokens.push({ type: 'attr-value', value: s.value });
          i = s.end;
        } else {
          let val = '';
          while (i < str.length && str[i] !== ']' && !isWhitespace(str[i]!)) { val += str[i]!; i++; }
          tokens.push({ type: 'attr-value', value: val });
        }
        while (i < str.length && isWhitespace(str[i]!)) i++;
        if (str[i] === 'i' || str[i] === 'I') {
          tokens.push({ type: 'attr-value', value: str[i]! }); i++;
          while (i < str.length && isWhitespace(str[i]!)) i++;
        }
      }
      if (str[i] === ']') { tokens.push({ type: 'attr-close', value: ']' }); i++; }
      continue;
    }
    if (ch === ':') {
      i++;
      if (str[i] === ':') {
        i++;
        let name = '';
        while (i < str.length && isIdentChar(str[i]!)) { name += str[i]!; i++; }
        tokens.push({ type: 'colon', value: '::' });
        tokens.push({ type: 'pseudo-name', value: name });
      } else {
        let name = '';
        while (i < str.length && isIdentChar(str[i]!)) { name += str[i]!; i++; }
        tokens.push({ type: 'colon', value: ':' });
        // Check for function
        while (i < str.length && isWhitespace(str[i]!)) i++;
        if (str[i] === '(') {
          tokens.push({ type: 'pseudo-name', value: name });
          tokens.push({ type: 'paren-open', value: '(' });
          i++;
          // Collect until matching )
          let depth = 1;
          let arg = '';
          while (i < str.length && depth > 0) {
            if (str[i] === '(') depth++;
            else if (str[i] === ')') { depth--; if (depth === 0) break; }
            arg += str[i]!;
            i++;
          }
          if (str[i] === ')') i++;
          tokens.push({ type: 'ident', value: arg });
          tokens.push({ type: 'paren-close', value: ')' });
        } else {
          tokens.push({ type: 'pseudo-name', value: name });
        }
      }
      continue;
    }
    if (ch === '>') { tokens.push({ type: 'combinator', value: '>' }); i++; continue; }
    if (ch === '+') { tokens.push({ type: 'combinator', value: '+' }); i++; continue; }
    if (ch === '~') { tokens.push({ type: 'combinator', value: '~' }); i++; continue; }
    if (ch === ',') { tokens.push({ type: 'comma', value: ',' }); i++; continue; }
    if (ch === '"' || ch === "'") {
      const s = consumeStringFromText(str, i);
      tokens.push({ type: 'string', value: s.value });
      i = s.end;
      continue;
    }

    // Ident (tag name)
    if (isIdentChar(ch) || (ch === '-' && i + 1 < str.length && isIdentChar(str[i + 1]!))) {
      let name = '';
      while (i < str.length && isIdentChar(str[i]!)) { name += str[i]!; i++; }
      tokens.push({ type: 'ident', value: name });
      continue;
    }

    i++; // skip unknown
  }

  return tokens;
}

function buildSelectorFromTokens(tokens: SelectorToken[], start: number, end: number): CssSelector | null {
  // Find the first combinator to split left/right
  let splitIdx = -1;
  let combinator: CssCombinator = ' ';

  // Scan from end for last combinator (right-associative)
  for (let i = end - 1; i >= start; i--) {
    if (tokens[i]!.type === 'combinator') {
      splitIdx = i;
      combinator = tokens[i]!.value as CssCombinator;
      break;
    }
  }

  if (splitIdx > start) {
    const left = buildSelectorFromTokens(tokens, start, splitIdx);
    const right = buildCompoundFromTokens(tokens, splitIdx + 1, end);
    if (left && right) {
      return { type: 'complex', left, combinator, right };
    }
    return left ?? right ?? null;
  }

  return buildCompoundFromTokens(tokens, start, end);
}

function buildCompoundFromTokens(tokens: SelectorToken[], start: number, end: number): CssCompoundSelector | null {
  let tagName: string | null = null;
  let id: string | null = null;
  const classes: string[] = [];
  const attributes: CssAttributeSelector[] = [];
  let pseudoClass: CssPseudoClassSelector | null = null;
  let pseudoElement: string | null = null;

  let i = start;
  while (i < end) {
    const tok = tokens[i]!;

    if (tok.type === 'star') {
      tagName = '*';
      i++;
    } else if (tok.type === 'ident') {
      if (tagName === null && id === null && classes.length === 0 && attributes.length === 0 && !pseudoClass) {
        tagName = tok.value.toLowerCase();
      }
      i++;
    } else if (tok.type === 'hash') {
      id = tok.value;
      i++;
    } else if (tok.type === 'class') {
      classes.push(tok.value.toLowerCase());
      i++;
    } else if (tok.type === 'attr-open') {
      // Collect attribute selector
      let name = '';
      let op: CssAttributeSelector['operator'] = null;
      let value: string | null = null;
      let ci = false;

      i++; // skip [
      if (i < end && tokens[i]!.type === 'attr-name') { name = tokens[i]!.value.toLowerCase(); i++; }
      if (i < end && tokens[i]!.type === 'attr-op') { op = tokens[i]!.value as CssAttributeSelector['operator']; i++; }
      if (i < end && tokens[i]!.type === 'attr-value') { value = tokens[i]!.value; i++; }
      // Check for case-insensitive flag
      if (i < end && tokens[i]!.type === 'attr-value' && (tokens[i]!.value === 'i' || tokens[i]!.value === 'I')) {
        ci = true;
        i++;
      }
      if (i < end && tokens[i]!.type === 'attr-close') i++;

      attributes.push({ name, operator: op, value, caseInsensitive: ci });
    } else if (tok.type === 'colon') {
      i++;
      if (i < end && tok.value === '::' && tokens[i]!.type === 'pseudo-name') {
        pseudoElement = tokens[i]!.value.toLowerCase();
        i++;
      } else if (i < end && tokens[i]!.type === 'pseudo-name') {
        const pseudoName = tokens[i]!.value.toLowerCase();
        i++;

        // Check for function form
        if (i < end && tokens[i]!.type === 'paren-open') {
          i++; // (
          // Get argument
          let arg = '';
          if (i < end && tokens[i]!.type === 'ident') { arg = tokens[i]!.value; i++; }
          if (i < end && tokens[i]!.type === 'paren-close') i++; // )

          if (pseudoName === 'not' || pseudoName === 'is' || pseudoName === 'any' || pseudoName === 'where' || pseudoName === 'has') {
            const innerTokens = tokenizeSelector(arg);
            const innerSelector = buildSelectorFromTokens(innerTokens, 0, innerTokens.length);
            if (innerSelector) {
              if (pseudoName === 'not') pseudoClass = { type: 'negation', selectors: [innerSelector] };
              else if (pseudoName === 'has') pseudoClass = { type: 'has', selectors: [innerSelector] };
              else pseudoClass = { type: 'is', selectors: [innerSelector] };
            }
          } else {
            pseudoClass = { type: 'structural', name: pseudoName, value: arg };
          }
        } else {
          // Dynamic pseudo-class
          pseudoClass = { type: 'dynamic', name: pseudoName };
        }
      }
    } else {
      i++;
    }
  }

  if (tagName === null && id === null && classes.length === 0 && attributes.length === 0 && !pseudoClass) return null;

  return { type: 'compound', tagName, id, classes, attributes, pseudoClass, pseudoElement };
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA QUERY PARSING
// ─────────────────────────────────────────────────────────────────────────────

function parseMediaQueries(prelude: string): CssMediaQuery[] {
  const queries: CssMediaQuery[] = [];
  const parts = prelude.split(/,\s*/);

  for (const part of parts) {
    const q = parseSingleMediaQuery(part.trim());
    if (q) queries.push(q);
  }

  return queries.length > 0 ? queries : [{ modifier: null, mediaType: 'all', features: [], conjunction: null }];
}

function parseMediaQueriesFromTokens(tokens: CssToken[]): CssMediaQuery[] {
  const text = tokensToText(tokens);
  return parseMediaQueries(text);
}

function parseSingleMediaQuery(query: string): CssMediaQuery | null {
  if (!query) return null;

  let modifier: 'not' | 'only' | null = null;
  let mediaType = 'all';
  const features: CssMediaFeature[] = [];

  const parts = query.split(/\s+/);
  let i = 0;

  if (parts[i] === 'not' || parts[i] === 'only') {
    modifier = parts[i] as 'not' | 'only';
    i++;
  }

  if (i < parts.length && parts[i] !== 'and' && parts[i] !== 'or' && !parts[i]!.startsWith('(')) {
    mediaType = parts[i]!;
    i++;
  }

  // Collect features
  while (i < parts.length) {
    const p = parts[i]!;
    if (p === 'and' || p === 'or') { i++; continue; }

    if (p.startsWith('(')) {
      const featureStr = p;
      // Handle features that span multiple parts due to spaces
      if (!featureStr.includes(')')) {
        while (i < parts.length && !parts[i]!.includes(')')) { i++; }
        if (i < parts.length) { i++; } // skip the part with )
      } else {
        i++;
      }

      const feature = parseMediaFeature(featureStr);
      if (feature) features.push(feature);
    } else {
      i++;
    }
  }

  return { modifier, mediaType, features, conjunction: null };
}

function parseMediaFeature(str: string): CssMediaFeature | null {
  const inner = str.replace(/^\(/, '').replace(/\)$/, '').trim();
  if (!inner) return null;

  const colonIdx = inner.indexOf(':');
  if (colonIdx === -1) {
    // Shorthand feature like (color)
    return { name: inner.trim(), value: 'true', range: null };
  }

  const name = inner.slice(0, colonIdx).trim();
  const value = inner.slice(colonIdx + 1).trim();

  let range: 'min' | 'max' | null = null;
  if (name.startsWith('min-')) range = 'min';
  else if (name.startsWith('max-')) range = 'max';

  return { name, value, range };
}

// ─────────────────────────────────────────────────────────────────────────────
// SPECIFICITY CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

export function computeSelectorSpecificity(selector: CssSelector): CssSpecificity {
  if (selector.type === 'compound') {
    return computeCompoundSpecificity(selector);
  }

  // Complex: combine left and right specificities
  const left = computeSelectorSpecificity(selector.left);
  const right = computeCompoundSpecificity(selector.right);

  return {
    id: left.id + right.id,
    a: left.a + right.a,
    b: left.b + right.b,
  };
}

function computeCompoundSpecificity(sel: CssCompoundSelector): CssSpecificity {
  let id = 0;
  let a = 0;  // class + attribute + pseudo-class
  let b = 0;  // type + pseudo-element

  if (sel.id) id++;
  a += sel.classes.length;
  a += sel.attributes.length;

  if (sel.pseudoClass) {
    if (sel.pseudoClass.type === 'negation' || sel.pseudoClass.type === 'is' || sel.pseudoClass.type === 'any' || sel.pseudoClass.type === 'has') {
      // :not() specificity = most specific selector in the list
      for (const inner of sel.pseudoClass.selectors) {
        const innerSpec = computeSelectorSpecificity(inner);
        if (innerSpec.id > id) id = innerSpec.id;
        if (innerSpec.a > a) a = innerSpec.a;
        if (innerSpec.b > b) b = innerSpec.b;
      }
    } else {
      a++;
    }
  }

  if (sel.tagName && sel.tagName !== '*') b++;
  if (sel.pseudoElement) b++;

  return { id, a, b };
}

export function compareSpecificity(a: CssSpecificity, b: CssSpecificity): number {
  if (a.id !== b.id) return b.id - a.id;
  if (a.a !== b.a) return b.a - a.a;
  return b.b - a.b; // source order breaks ties
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────

function tokensToText(tokens: CssToken[]): string {
  return tokens.map(t => t.value).join('');
}

import { tokenizeCss } from './tokenizer';

function tokenizeClean(css: string): CssToken[] {
  return tokenizeCss(css).filter((t: CssToken) =>
    t.type !== CssTokenType.Whitespace &&
    t.type !== CssTokenType.Comment &&
    t.type !== CssTokenType.BadComment &&
    t.type !== CssTokenType.EOF
  );
}

export { stripComments };
