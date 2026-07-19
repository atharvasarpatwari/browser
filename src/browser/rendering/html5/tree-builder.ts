/**
 * @file html5/tree-builder.ts
 *
 * Modular tree builder that delegates to insertion mode handlers.
 * Replaces the monolithic html5-tree-builder.ts with a clean orchestrator
 * that implements TreeBuilderContext and dispatches to ./modes/*.
 */

import type { Token } from '../html5-tokenizer';
import type {
  HtmlElement,
  HtmlNode,
  HtmlDocument,
  DiscoveredResource,
} from './dom';
import {
  NodeType,
  Namespace,
  type MutableNode,
  createMutableDocument,
  createMutableDoctype,
  createParseError,
  appendChild,
} from './dom';
import { Im, SPECIAL_ELEMENTS } from './constants';
import { OpenElements } from './stack';
import { ActiveFormattingElements } from './formatting';
import {
  insertHTMLElement as insertHTMLElementFn,
  insertForeignElement as insertForeignElementFn,
  insertText as insertTextFn,
  insertCharacter as insertCharacterFn,
  insertComment as insertCommentFn,
  insertCommentBeforeOpenElements as insertCommentBeforeOpenElementsFn,
  insertDoctype as insertDoctypeFn,
  createElementForToken as createElementForTokenFn,
  setElementFlags,
} from './insert';
import { generateImpliedEndTags, generateImpliedEndTagsThoroughly } from './implied';
import { adoptionAgencyAlgorithm } from './adopt';
import {
  shouldFosterParent,
  fosterParent as fosterParentFn,
} from './foster';
import { processInForeignContent } from './foreign';
import { dispatchToken } from './modes/index';
import type { TreeBuilderContext } from './modes/types';
import { LINK_REL_MAP } from './constants';

class TreeBuilder implements TreeBuilderContext {
  openElements = new OpenElements();
  formattingElements = new ActiveFormattingElements();
  document = createMutableDocument();

  insertionMode: Im = Im.INITIAL;
  originalInsertionMode: Im = Im.IN_BODY;
  framesetOk = true;
  formElement: HtmlElement | null = null;
  headElement: HtmlElement | null = null;
  bodyElement: HtmlElement | null = null;
  htmlElement: HtmlElement | null = null;
  templateInsertionModes: Im[] = [];
  pendingRawText = '';
  baseUrl = '';
  scriptingEnabled = false;
  resources: DiscoveredResource[] = [];
  metaCharset: string | null = null;

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  build(
    tokens: Token[],
    baseUrl: string,
  ): { document: HtmlDocument; resources: DiscoveredResource[] } {
    this.reset(baseUrl);

    for (const token of tokens) {
      this.processToken(token);
    }
    this.handleEof();

    return {
      document: this.createDocument(),
      resources: this.resources,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOKEN DISPATCH
  // ─────────────────────────────────────────────────────────────────────────

  processToken(token: Token): void {
    if (token.kind === 'selfclose') {
      token = { ...token, kind: 'open' } as Token;
    }
    dispatchToken(this, token);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INSERTION CONTEXT (shared by all insertion helpers)
  // ─────────────────────────────────────────────────────────────────────────

  private ictx() {
    return {
      openElements: this.openElements,
      formattingElements: this.formattingElements,
      insertionMode: this.insertionMode,
      currentNode: () => this.currentNode(),
      shouldFosterParent: () => shouldFosterParent(this.openElements, this.insertionMode),
      fosterParent: (node: HtmlNode) => this.fosterParent(node),
      getAttributeFromToken: (token: Token, name: string) => (token.attrs?.get(name) ?? ''),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ERROR HANDLING
  // ─────────────────────────────────────────────────────────────────────────

  parseError(token: Token): void {
    this.document.errors.push(
      createParseError(
        `Parse error at ${token.kind}${token.tagName ? ' <' + token.tagName + '>' : ''}`,
        token.offset,
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INSERTION HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  insertHTMLElement(token: Token, ns?: Namespace): HtmlElement {
    const wasEmpty = this.openElements.length === 0;
    const result = insertHTMLElementFn(this.ictx(), token, ns);
    // If the stack was empty before inserting, appendToCurrentNode in insert.ts
    // silently dropped the node. Fall back to document.children.
    if (wasEmpty) {
      const el = this.openElements.currentNode()!;
      appendChild(this.document, el as unknown as MutableNode);
    }
    return result;
  }

  insertForeignElement(token: Token, ns: Namespace): HtmlElement {
    const wasEmpty = this.openElements.length === 0;
    const result = insertForeignElementFn(this.ictx(), token, ns);
    if (wasEmpty) {
      const el = this.openElements.currentNode()!;
      appendChild(this.document, el as unknown as MutableNode);
    }
    return result;
  }

  insertText(token: Token): void {
    const text = token.data ?? '';
    if (!text) return;

    if (this.insertionMode === Im.TEXT || this.insertionMode === Im.IN_TABLE_TEXT) {
      this.pendingRawText += text;
      return;
    }

    insertTextFn(this.ictx(), token);
  }

  insertCharacter(text: string): void {
    if (!text) return;
    insertCharacterFn(this.ictx(), text);
  }

  insertComment(token: Token): void {
    insertCommentFn(this.ictx(), token);
  }

  insertCommentBeforeOpenElements(token: Token): void {
    insertCommentBeforeOpenElementsFn(this.ictx(), token);
  }

  insertDoctype(token: Token): void {
    const doctype = createMutableDoctype(
      (token.tagName ?? 'html').toLowerCase(),
      token.data?.split(/\s+/)[1] ?? '',
      token.data?.split(/\s+/)[2] ?? '',
      token.offset,
    );
    this.document.doctype = doctype;
    this.document.children.push(doctype);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SPECIAL ELEMENT INSERTION
  // ─────────────────────────────────────────────────────────────────────────

  insertHeadElement(token: Token): HtmlElement {
    const headToken: Token = { ...token, tagName: 'head' };
    const el = this.insertHTMLElement(headToken);
    this.headElement = el;
    return el;
  }

  insertBodyElement(token: Token): HtmlElement {
    if (this.openElements.length >= 2 && this.openElements.elementAt(1)?.tagName === 'body') {
      return this.openElements.elementAt(1);
    }
    const bodyToken: Token = { ...token, tagName: 'body' };
    const el = this.insertHTMLElement(bodyToken);
    this.bodyElement = el;
    return el;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STACK HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  currentNode(): HtmlElement | null {
    return this.openElements.currentNode();
  }

  popCurrentNode(): HtmlElement {
    return this.openElements.pop();
  }

  popCurrentNodeUntil(tagName: string): void {
    this.openElements.popUntil(tagName);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FORMATTING HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  reconstructActiveFormattingElements(): void {
    this.formattingElements.reconstruct(
      (el) => this.openElements.containsElement(el),
      (el) => {
        const token: Token = { kind: 'open', tagName: el.tagName, attrs: new Map(el.attributes), offset: el.sourceOffset } as Token;
        return insertHTMLElementFn(this.ictx(), token);
      },
    );
  }

  activeFormattingPush(el: HtmlElement): void {
    this.formattingElements.push(el);
  }

  activeFormattingHas(tagName: string): boolean {
    return this.formattingElements.has(tagName);
  }

  activeFormattingRemove(tagName: string): void {
    const entries = this.formattingElements.array;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if ((entry as HtmlElement).tagName === tagName) {
        this.formattingElements.remove(entry as HtmlElement);
        break;
      }
    }
  }

  activeFormattingClearUpToMarker(): void {
    this.formattingElements.clearUpToMarker();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // IMPLIED END TAGS
  // ─────────────────────────────────────────────────────────────────────────

  generateImpliedEndTags(except?: string): void {
    generateImpliedEndTags(this.openElements, except);
  }

  generateImpliedEndTagsThoroughly(except?: string): void {
    generateImpliedEndTagsThoroughly(this.openElements, except);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SCOPE CHECKS
  // ─────────────────────────────────────────────────────────────────────────

  isInScope(tagName: string): boolean {
    return this.openElements.isInScope(tagName);
  }

  isInButtonScope(tagName: string): boolean {
    return this.openElements.isInButtonScope(tagName);
  }

  isInListItemScope(tagName: string): boolean {
    return this.openElements.isInListItemScope(tagName);
  }

  isInTableScope(tagName: string): boolean {
    return this.openElements.isInTableScope(tagName);
  }

  isInSelectScope(tagName: string): boolean {
    return this.openElements.isInSelectScope(tagName);
  }

  isInTemplateScope(tagName: string): boolean {
    return this.openElements.isInTemplateScope(tagName);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MODE SWITCHING
  // ─────────────────────────────────────────────────────────────────────────

  setMode(mode: Im): void {
    this.insertionMode = mode;
  }

  resetInsertionMode(): void {
    const node = this.openElements.currentNode();
    if (!node) {
      this.insertionMode = Im.IN_BODY;
      return;
    }

    const tag = node.tagName;

    if (tag === 'select' && this.templateInsertionModes.length > 0) {
      this.insertionMode = Im.IN_SELECT_IN_TABLE;
    } else if (tag === 'select') {
      this.insertionMode = Im.IN_SELECT;
    } else if (tag === 'tbody' || tag === 'tfoot' || tag === 'thead') {
      this.insertionMode = Im.IN_TABLE_BODY;
    } else if (tag === 'caption') {
      this.insertionMode = Im.IN_CAPTION;
    } else if (tag === 'colgroup') {
      this.insertionMode = Im.IN_COLUMN_GROUP;
    } else if (tag === 'table') {
      this.insertionMode = Im.IN_TABLE;
    } else if (tag === 'body') {
      this.insertionMode = Im.IN_BODY;
    } else if (tag === 'frameset') {
      this.insertionMode = Im.IN_FRAMESET;
    } else if (tag === 'head') {
      this.insertionMode = Im.IN_BODY;
    } else if (tag === 'template' && this.templateInsertionModes.length > 0) {
      this.insertionMode = this.templateInsertionModes[this.templateInsertionModes.length - 1];
    } else if (tag === 'html') {
      this.insertionMode = this.headElement ? Im.AFTER_HEAD : Im.BEFORE_HEAD;
    } else {
      this.insertionMode = Im.IN_BODY;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REPROCESSING HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  reprocessInBody(token: Token): void {
    this.insertionMode = Im.IN_BODY;
    this.processToken(token);
  }

  reprocessInTable(token: Token): void {
    this.insertionMode = Im.IN_TABLE;
    this.processToken(token);
  }

  processInHeadToken(token: Token): void {
    this.insertionMode = Im.IN_HEAD;
    this.processToken(token);
  }

  processInBodyToken(token: Token): void {
    const saved = this.insertionMode;
    this.insertionMode = Im.IN_BODY;
    this.processToken(token);
    this.insertionMode = saved;
  }

  reprocessInForeignContent(token: Token): void {
    const ctx = {
      openElements: this.openElements,
      currentNode: () => this.currentNode()!,
      popCurrentNode: () => this.popCurrentNode(),
      insertElement: (t: Token) => this.insertHTMLElement(t),
      insertForeignElement: (t: Token, ns: Namespace) => this.insertForeignElement(t, ns),
      insertCharacter: (text: string, _offset: number) => {
        this.insertCharacter(text);
      },
      reprocessInBody: (t: Token) => this.reprocessInBody(t),
      parseError: (t: Token) => this.parseError(t),
      resetInsertionMode: () => this.resetInsertionMode(),
    };
    processInForeignContent(token, ctx);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CLOSE ELEMENT HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  closePElement(): void {
    this.generateImpliedEndTags('p');
    const stack = this.openElements.array;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.tagName === 'p') {
        this.openElements.remove(stack[i]!);
        break;
      }
    }
  }

  closeTableCellElement(): void {
    this.generateImpliedEndTags();
    if (this.isInTableScope('td')) {
      this.popCurrentNodeUntil('td');
    } else if (this.isInTableScope('th')) {
      this.popCurrentNodeUntil('th');
    }
    this.activeFormattingClearUpToMarker();
    this.insertionMode = Im.IN_ROW;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ADOPTION AGENCY
  // ─────────────────────────────────────────────────────────────────────────

  adoptionAgencyAlgorithm(token: Token): void {
    adoptionAgencyAlgorithm(
      token,
      this.openElements,
      this.formattingElements,
      () => this.currentNode()!,
      (t) => this.parseError(t),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FOSTER PARENTING
  // ─────────────────────────────────────────────────────────────────────────

  fosterParent(node: HtmlNode): void {
    fosterParentFn(node, this.openElements);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EOF
  // ─────────────────────────────────────────────────────────────────────────

  handleEofInBody(): void {
    while (this.templateInsertionModes.length > 0) {
      this.templateInsertionModes.pop();
    }
    this.parseError({ kind: 'eof', offset: 0 });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RESOURCE DISCOVERY
  // ─────────────────────────────────────────────────────────────────────────

  discoverResources(token: Token): void {
    const tag = token.tagName!;
    const attrs = token.attrs ?? new Map<string, string>();
    const resolve = (href: string): string => {
      try { return new URL(href, this.baseUrl || undefined).href; }
      catch { return href; }
    };

    const getFetchPriority = (): 'high' | 'low' | 'auto' | undefined => {
      const v = attrs.get('fetchpriority')?.toLowerCase();
      if (v === 'high' || v === 'low') return v;
      return undefined;
    };

    const inHead = this.openElements.array.some(el => el.tagName === 'head');
    let res: DiscoveredResource | null = null;

    switch (tag) {
      case 'link': {
        const rel  = (attrs.get('rel') ?? '').toLowerCase().trim();
        const href = attrs.get('href');
        if (!href) return;
        const kind = LINK_REL_MAP.get(rel) ?? 'other';

        if (rel === 'preload') {
          const as = (attrs.get('as') ?? '').toLowerCase();
          const asKind = as === 'script' ? 'script' : as === 'style' ? 'stylesheet' : as === 'image' ? 'image' : as === 'font' ? 'font' : as === 'fetch' ? 'other' : 'other';
          res = {
            url: resolve(href), kind: asKind,
            blocking: false, deferred: false,
            sourceTag: 'link', fetchPriority: getFetchPriority(),
          };
          // Also mark as preload type
          res = { ...res, kind: 'preload' };
        } else if (rel === 'prefetch') {
          res = {
            url: resolve(href), kind: 'prefetch',
            blocking: false, deferred: true,
            sourceTag: 'link', fetchPriority: getFetchPriority(),
          };
        } else if (rel === 'preconnect') {
          res = {
            url: resolve(href), kind: 'preconnect',
            blocking: false, deferred: false,
            sourceTag: 'link', fetchPriority: getFetchPriority(),
          };
        } else {
          res = {
            url: resolve(href), kind,
            blocking: rel === 'stylesheet' && inHead,
            deferred: false, sourceTag: 'link',
            fetchPriority: getFetchPriority(),
          };
        }
        break;
      }
      case 'script': {
        const src = attrs.get('src');
        if (!src) return;
        res = {
          url: resolve(src), kind: 'script',
          blocking: !attrs.has('defer') && !attrs.has('async') && inHead,
          deferred: attrs.has('defer') || attrs.has('async'),
          sourceTag: 'script', fetchPriority: getFetchPriority(),
        };
        break;
      }
      case 'img': {
        const src = attrs.get('src') ?? attrs.get('data-src');
        if (!src) return;
        const loading = attrs.get('loading')?.toLowerCase();
        res = {
          url: resolve(src), kind: 'image',
          blocking: false, deferred: loading === 'lazy',
          sourceTag: 'img', fetchPriority: getFetchPriority(),
        };
        break;
      }
      case 'video': case 'audio': {
        const src = attrs.get('src');
        if (!src) return;
        res = {
          url: resolve(src), kind: 'media',
          blocking: false, deferred: true,
          sourceTag: tag, fetchPriority: getFetchPriority(),
        };
        break;
      }
      case 'iframe': {
        const src = attrs.get('src');
        if (!src) return;
        res = {
          url: resolve(src), kind: 'document',
          blocking: false, deferred: true,
          sourceTag: 'iframe', fetchPriority: getFetchPriority(),
        };
        break;
      }
    }
    if (res) this.resources.push(res);
  }

  checkMetaCharset(token: Token): void {
    if (this.metaCharset) return;
    const attrs = token.attrs ?? new Map<string, string>();
    const charset = attrs.get('charset');
    if (charset) {
      this.metaCharset = charset.toLowerCase();
    } else if (attrs.get('http-equiv')?.toLowerCase() === 'content-type') {
      const ct = attrs.get('content') ?? '';
      const m = /charset=([^\s;]+)/i.exec(ct);
      if (m) this.metaCharset = m[1]!.toLowerCase();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RAW TEXT ELEMENT HANDLING
  // ─────────────────────────────────────────────────────────────────────────

  handleRawTextElement(token: Token): void {
    this.insertHTMLElement(token);
    this.originalInsertionMode = this.insertionMode;
    this.insertionMode = Im.TEXT;
    this.pendingRawText = '';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EOF (final after all tokens)
  // ─────────────────────────────────────────────────────────────────────────

  private handleEof(): void {
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      const el = this.openElements.elementAt(i);
      if (el && el.tagName !== 'body' && el.tagName !== 'html' && el.tagName !== 'template') {
        this.parseError({ kind: 'eof', offset: 0 });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DOCUMENT CREATION
  // ─────────────────────────────────────────────────────────────────────────

  private createDocument(): HtmlDocument {
    const doc = this.document;
    doc.htmlElement = this.htmlElement;
    doc.headElement = this.headElement;
    doc.bodyElement = this.bodyElement;
    doc.hasDoctype = this.document.doctype !== null;
    doc.declaredCharset = this.metaCharset;
    doc.metaCharset = this.metaCharset;
    doc.firstChild = doc.children[0] ?? null;
    doc.lastChild = doc.children.length > 0 ? doc.children[doc.children.length - 1] : null;
    return doc;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RESET
  // ─────────────────────────────────────────────────────────────────────────

  private reset(baseUrl: string): void {
    this.insertionMode        = Im.INITIAL;
    this.originalInsertionMode = Im.IN_BODY;
    this.openElements         = new OpenElements();
    this.formattingElements   = new ActiveFormattingElements();
    this.document             = createMutableDocument();
    this.templateInsertionModes = [];
    this.framesetOk           = true;
    this.formElement          = null;
    this.resources            = [];
    this.baseUrl              = baseUrl;
    this.htmlElement          = null;
    this.headElement          = null;
    this.bodyElement          = null;
    this.metaCharset          = null;
    this.pendingRawText       = '';
    this.scriptingEnabled     = false;
  }
}

export { TreeBuilder };
