/**
 * @file src/browser/rendering/html5-tree-builder.ts
 * @session 11
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Stage 2 of the HTML5 parsing pipeline: convert a flat token stream (from
 * html5-tokenizer.ts) into a typed HtmlDocument tree. Implements the full
 * WHATWG §13.2.6 tree construction algorithm with all 23 insertion modes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INSERTION MODES
 * ─────────────────────────────────────────────────────────────────────────────
 *   initial, beforeHtml, beforeHead, inHead, inHeadNoscript, afterHead,
 *   inBody, text, inTable, inTableText, inCaption, inColumnGroup,
 *   inTableBody, inRow, inCell, inSelect, inSelectInTable, inTemplate,
 *   afterBody, inFrameset, afterFrameset, afterAfterBody, afterAfterFrameset
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KEY DATA STRUCTURES
 * ─────────────────────────────────────────────────────────────────────────────
 *   Stack of Open Elements — with scope algorithms (default, list item,
 *     button, table, select scope)
 *   List of Active Formatting Elements — with reconstruction algorithm
 *   Template Insertion Mode Stack
 *   Foster Parenting (for table misnesting)
 *   Adoption Agency Algorithm (for formatting elements)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      TreeBuilder is the single entry (build method).
 *  Encapsulation    All state fields and helpers are private.
 *  Single-Resp.     This file builds trees from tokens — no tokenization.
 *  Open / Closed    New formatting tags: add to FORMATTTING_ELEMENTS set.
 *  Dependency-Inv.  Imports only Token (tokenizer) and node types (parser).
 */

import type { Token } from './html5-tokenizer';
import {
  NodeType,
  VOID_ELEMENTS,
  RAW_TEXT_ELEMENTS,
  type HtmlNode,
  type HtmlElement,
  type HtmlTextNode,
  type HtmlComment,
  type HtmlDoctype,
  type HtmlCdata,
  type HtmlParseError,
  type HtmlDocument,
  type DiscoveredResource,
} from './html-parser';

// ─────────────────────────────────────────────────────────────────────────────
// INSERTION MODES  (WHATWG §13.2.6)
// ─────────────────────────────────────────────────────────────────────────────

const enum Im {
  INITIAL,
  BEFORE_HTML,
  BEFORE_HEAD,
  IN_HEAD,
  IN_HEAD_NOSCRIPT,
  AFTER_HEAD,
  IN_BODY,
  TEXT,
  IN_TABLE,
  IN_TABLE_TEXT,
  IN_CAPTION,
  IN_COLUMN_GROUP,
  IN_TABLE_BODY,
  IN_ROW,
  IN_CELL,
  IN_SELECT,
  IN_SELECT_IN_TABLE,
  IN_TEMPLATE,
  AFTER_BODY,
  IN_FRAMESET,
  AFTER_FRAMESET,
  AFTER_AFTER_BODY,
  AFTER_AFTER_FRAMESET,
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT CATEGORIES  (WHATWG §13.2.6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Special elements — close when encountering certain end tags and are
 * handled differently in scope checks and stack manipulation.
 */
const SPECIAL_ELEMENTS = new Set<string>([
  'address','article','aside','base','basefont','bgsound','blockquote','body',
  'br','button','caption','center','col','colgroup','dd','details','dialog',
  'dir','div','dl','dt','fieldset','figcaption','figure','footer','form',
  'h1','h2','h3','h4','h5','h6','head','header','hgroup','hr','html',
  'iframe','li','link','listing','main','menu','meta','nav','noembed',
  'noframes','object','ol','optgroup','option','p','param','pre','script',
  'search','section','select','source','style','summary','table','tbody',
  'td','template','textarea','tfoot','th','thead','title','tr','track',
  'ul','wbr','xmp',
]);

/**
 * Scoping elements — used in scope-checking algorithms.
 * Default scope also includes html, template, and table.
 */
const SCOPING_ELEMENTS = new Set<string>([
  'applet','caption','html','marquee','object','select','table','td','th',
]);

const FORMATTING_ELEMENTS = new Set<string>([
  'a','b','big','code','em','font','i','nobr','s','small','strike',
  'strong','tt','u',
]);

const HEADING_ELEMENTS = new Set<string>([
  'h1','h2','h3','h4','h5','h6',
]);

const TABLE_ELEMENTS = new Set<string>([
  'caption','col','colgroup','tbody','td','tfoot','th','thead','tr','table',
]);

const TABLE_BODY_CONTEXT = new Set<string>([
  'table','tbody','tfoot','thead','template','body',
]);

/** Elements where foster parenting applies (spec §13.2.6) */
const FOSTER_PARENT_CONTEXT = new Set<string>([
  'table','tbody','tfoot','thead','tr',
]);

const IMPLIED_END_TAG_ELEMENTS = new Set<string>([
  'dd','dt','li','optgroup','option','p','rb','rtc','rp',
]);

/** Elements that have implied end tags "thoroughly" — includes table elements */
const THOROUGH_IMPLIED_END_TAG_ELEMENTS = new Set<string>([
  'caption','colgroup','dd','dt','li','optgroup','option','p',
  'rb','rp','rt','rtc','tbody','td','tfoot','th','thead','tr',
]);

const VOID_ADJUSTMENT_ELEMENTS = new Set<string>([
  'image','input','keygen',
]);

// ─────────────────────────────────────────────────────────────────────────────
// MARKER sentinel for active formatting elements list
// ─────────────────────────────────────────────────────────────────────────────

const MARKER: unique symbol = Symbol('marker');

// ─────────────────────────────────────────────────────────────────────────────
// LINK REL → RESOURCE KIND
// ─────────────────────────────────────────────────────────────────────────────

const LINK_REL_MAP: ReadonlyMap<string, DiscoveredResource['kind']> = new Map([
  ['stylesheet',   'stylesheet'],
  ['preload',      'other'],
  ['modulepreload','script'],
  ['icon',         'other'],
  ['shortcut icon','other'],
  ['manifest',     'other'],
]);

// ─────────────────────────────────────────────────────────────────────────────
// TREE BUILDER  (WHATWG §13.2.6)
// ─────────────────────────────────────────────────────────────────────────────

class TreeBuilder {
  // ── Insertion state ────────────────────────────────────────────────────
  private insertionMode: Im = Im.INITIAL;
  private originalInsertionMode: Im = Im.IN_BODY;

  // ── Stack of open elements (§13.2.6.1) ────────────────────────────────
  private openElements: HtmlElement[] = [];

  // ── List of active formatting elements (§13.2.6.2) ────────────────────
  // Entries are HtmlElement | typeof MARKER
  private activeFormattingElements: (HtmlElement | typeof MARKER)[] = [];

  // ── Template insertion mode stack (§13.2.6.1) ─────────────────────────
  private templateInsertionModes: Im[] = [];

  // ── Other state ────────────────────────────────────────────────────────
  private framesetOk: boolean = true;
  private formElement: HtmlElement | null = null;

  // ── Output accumulators ────────────────────────────────────────────────
  private rootNodes:     HtmlNode[]       = [];
  private errors:        HtmlParseError[] = [];
  private resources:     DiscoveredResource[] = [];
  private baseUrl:       string           = '';

  // ── Document-level tracking ────────────────────────────────────────────
  private doctype:       HtmlDoctype | null     = null;
  private htmlElement:   HtmlElement | null     = null;
  private headElement:   HtmlElement | null     = null;
  private bodyElement:   HtmlElement | null     = null;
  private metaCharset:   string | null          = null;

  // ── Pending text accumulator for raw-text elements ─────────────────────
  private pendingRawText = '';

  // ────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ────────────────────────────────────────────────────────────────────────

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

  // ────────────────────────────────────────────────────────────────────────
  // TOKEN DISPATCH  (§13.2.6 — "tree construction dispatcher")
  // ────────────────────────────────────────────────────────────────────────

  private processToken(token: Token): void {
    if (token.kind === 'selfclose') {
      token = { ...token, kind: 'open' } as Token;
    }
    switch (this.insertionMode) {
      case Im.INITIAL:              this.initial(token); break;
      case Im.BEFORE_HTML:          this.beforeHtml(token); break;
      case Im.BEFORE_HEAD:          this.beforeHead(token); break;
      case Im.IN_HEAD:              this.inHead(token); break;
      case Im.IN_HEAD_NOSCRIPT:     this.inHeadNoscript(token); break;
      case Im.AFTER_HEAD:           this.afterHead(token); break;
      case Im.IN_BODY:              this.inBody(token); break;
      case Im.TEXT:                 this.text(token); break;
      case Im.IN_TABLE:             this.inTable(token); break;
      case Im.IN_TABLE_TEXT:        this.inTableText(token); break;
      case Im.IN_CAPTION:           this.inCaption(token); break;
      case Im.IN_COLUMN_GROUP:      this.inColumnGroup(token); break;
      case Im.IN_TABLE_BODY:        this.inTableBody(token); break;
      case Im.IN_ROW:               this.inRow(token); break;
      case Im.IN_CELL:              this.inCell(token); break;
      case Im.IN_SELECT:            this.inSelect(token); break;
      case Im.IN_SELECT_IN_TABLE:   this.inSelectInTable(token); break;
      case Im.IN_TEMPLATE:          this.inTemplate(token); break;
      case Im.AFTER_BODY:           this.afterBody(token); break;
      case Im.IN_FRAMESET:          this.inFrameset(token); break;
      case Im.AFTER_FRAMESET:       this.afterFrameset(token); break;
      case Im.AFTER_AFTER_BODY:     this.afterAfterBody(token); break;
      case Im.AFTER_AFTER_FRAMESET:this.afterAfterFrameset(token); break;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: INITIAL  (§13.2.6.1)
  // ────────────────────────────────────────────────────────────────────────

  private initial(token: Token): void {
    switch (token.kind) {
      case 'text':
        if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) break;
        this.parseError(token);
        this.insertionMode = Im.BEFORE_HTML;
        this.processToken(token);
        break;
      case 'comment':
        this.insertComment(token);
        break;
      case 'doctype':
        this.doctype = {
          nodeType:  NodeType.Doctype,
          name:      (token.tagName ?? 'html').toLowerCase(),
          publicId:  token.data?.split(/\s+/)[1] ?? '',
          systemId:  token.data?.split(/\s+/)[2] ?? '',
          parent:    null,
          sourceOffset: token.offset,
        };
        this.rootNodes.push(this.doctype);
        this.insertionMode = Im.BEFORE_HTML;
        break;
      default:
        this.parseError(token);
        this.insertionMode = Im.BEFORE_HTML;
        this.processToken(token);
        break;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: BEFORE HTML  (§13.2.6.2)
  // ────────────────────────────────────────────────────────────────────────

  private beforeHtml(token: Token): void {
    switch (token.kind) {
      case 'doctype':
        this.parseError(token);
        break;
      case 'comment':
        this.insertComment(token);
        break;
      case 'text':
        if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) break;
        this.parseError(token);
        this.insertionMode = Im.BEFORE_HEAD;
        this.processToken(token);
        break;
      case 'open':
        if (token.tagName === 'html') {
          this.createElementForToken(token);
          this.htmlElement = this.currentNode();
          this.insertionMode = Im.BEFORE_HEAD;
          this.processToken(token);
          return;
        }
        this.insertionMode = Im.BEFORE_HEAD;
        this.processToken(token);
        break;
      case 'close':
        this.parseError(token);
        break;
      case 'eof':
        this.parseError(token);
        this.insertionMode = Im.BEFORE_HEAD;
        this.processToken(token);
        break;
      default:
        this.insertionMode = Im.BEFORE_HEAD;
        this.processToken(token);
        break;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: BEFORE HEAD  (§13.2.6.3)
  // ────────────────────────────────────────────────────────────────────────

  private beforeHead(token: Token): void {
    switch (token.kind) {
      case 'text':
        if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) break;
        this.parseError(token);
        this.insertionMode = Im.IN_HEAD;
        this.processToken(token);
        break;
      case 'comment':
        this.insertComment(token);
        break;
      case 'doctype':
        this.parseError(token);
        break;
      case 'open':
        if (token.tagName === 'head') {
          this.createElementForToken(token);
          this.headElement = this.currentNode();
          this.insertionMode = Im.IN_HEAD;
          return;
        }
        this.insertHeadElement(token);
        this.insertionMode = Im.IN_HEAD;
        this.processToken(token);
        break;
      case 'close':
        this.insertionMode = Im.IN_HEAD;
        this.processToken(token);
        break;
      case 'eof':
        this.insertHeadElement(token);
        this.insertionMode = Im.IN_HEAD;
        this.processToken(token);
        break;
      default:
        this.insertHeadElement(token);
        this.insertionMode = Im.IN_HEAD;
        this.processToken(token);
        break;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: IN HEAD  (§13.2.6.4)
  // ────────────────────────────────────────────────────────────────────────

  private inHead(token: Token): void {
    switch (token.kind) {
      case 'text':
        this.pendingRawText = token.data ?? '';
        this.originalInsertionMode = this.insertionMode;
        this.insertionMode = Im.TEXT;
        return;
      case 'comment':
        this.insertComment(token);
        return;
      case 'doctype':
        this.parseError(token);
        return;
      case 'open':
        switch (token.tagName) {
          case 'html':
            this.processInBodyToken(token);
            return;
          case 'base': case 'basefont': case 'bgsound': case 'link': case 'meta':
            this.createElementForToken(token);
            this.popCurrentNode();
            if (token.tagName === 'meta') this.checkMetaCharset(token);
            this.discoverResources(token);
            return;
          case 'title':
            this.handleRawTextElement(token);
            return;
          case 'noscript':
            if (false /* scripting disabled */) {
              this.handleRawTextElement(token);
            } else {
              this.createElementForToken(token);
              this.originalInsertionMode = this.insertionMode;
              this.insertionMode = Im.TEXT;
            }
            return;
          case 'script':
            this.createElementForToken(token);
            this.originalInsertionMode = this.insertionMode;
            this.insertionMode = Im.TEXT;
            this.discoverResources(token);
            return;
          case 'style': case 'xmp': case 'iframe': case 'noembed': case 'noframes':
            this.handleRawTextElement(token);
            return;
          case 'template':
            this.createElementForToken(token);
            this.activeFormattingElements.push(MARKER);
            this.framesetOk = false;
            this.insertionMode = Im.IN_TEMPLATE;
            this.templateInsertionModes.push(Im.IN_TEMPLATE);
            return;
          case 'head':
            this.parseError(token);
            return;
          default:
            break;
        }
        break;
      case 'close':
        if (token.tagName === 'head') {
          this.popCurrentNode();
          this.insertionMode = Im.AFTER_HEAD;
          return;
        }
        if (token.tagName === 'body' || token.tagName === 'html' || token.tagName === 'br') {
          this.parseError(token);
          this.popCurrentNode();
          this.insertionMode = Im.AFTER_HEAD;
          this.processToken(token);
          return;
        }
        if (token.tagName === 'template') {
          if (this.isInScope('template')) {
            this.generateAllImpliedEndTagsThoroughly();
            if (this.currentNode()?.tagName === 'template') {
              this.popCurrentNode();
            }
            this.activeFormattingElementsUpToMarker();
            this.templateInsertionModes.pop();
            this.resetInsertionMode();
          }
          return;
        }
        this.parseError(token);
        return;
      case 'eof':
        this.popCurrentNode();
        this.insertionMode = Im.AFTER_HEAD;
        this.processToken(token);
        return;
    }

    this.parseError(token);
    this.popCurrentNode();
    this.insertionMode = Im.AFTER_HEAD;
    this.processToken(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: IN HEAD NOSCRIPT  (§13.2.6.5)
  // ────────────────────────────────────────────────────────────────────────

  private inHeadNoscript(token: Token): void {
    switch (token.kind) {
      case 'doctype':
        this.parseError(token);
        return;
      case 'open':
        if (token.tagName === 'html') {
          this.processInBodyToken(token);
          return;
        }
        break;
      case 'close':
        if (token.tagName === 'noscript' || token.tagName === 'br') {
          this.parseError(token);
          this.popCurrentNode();
          this.insertionMode = Im.IN_HEAD;
          return;
        }
        break;
      case 'text':
        if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) break;
        break;
      case 'comment':
        this.insertComment(token);
        return;
    }
    this.parseError(token);
    this.popCurrentNode();
    this.insertionMode = Im.IN_HEAD;
    this.processToken(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: AFTER HEAD  (§13.2.6.6)
  // ────────────────────────────────────────────────────────────────────────

  private afterHead(token: Token): void {
    switch (token.kind) {
      case 'text':
        if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) break;
        this.parseError(token);
        this.insertBodyElement(token);
        this.framesetOk = false;
        this.insertionMode = Im.IN_BODY;
        this.processToken(token);
        return;
      case 'comment':
        this.insertComment(token);
        return;
      case 'doctype':
        this.parseError(token);
        return;
      case 'open':
        if (token.tagName === 'html') {
          this.processInBodyToken(token);
          return;
        }
        if (token.tagName === 'body') {
          this.insertBodyElement(token);
          this.framesetOk = false;
          this.insertionMode = Im.IN_BODY;
          return;
        }
        if (token.tagName === 'frameset') {
          this.insertionMode = Im.IN_FRAMESET;
          return;
        }
        if (['base','basefont','bgsound','link','meta','noscript','script','style','template','title'].includes(token.tagName!)) {
          this.parseError(token);
          const saved = this.headElement;
          this.popCurrentNode();
          this.insertionMode = Im.IN_HEAD;
          this.processToken(token);
          if (token.tagName === 'template' && this.templateInsertionModes.length === 0) {
            // template processing already done
          }
          this.headElement = saved;
          return;
        }
        break;
      case 'close':
        if (token.tagName === 'head') {
          this.popCurrentNode();
          this.insertionMode = Im.IN_BODY;
          return;
        }
        break;
      case 'eof':
        break;
    }
    this.insertBodyElement(token);
    this.framesetOk = false;
    this.insertionMode = Im.IN_BODY;
    this.processToken(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: IN BODY  (§13.2.6.7) — largest and most complex
  // ────────────────────────────────────────────────────────────────────────

  private inBody(token: Token): void {
    switch (token.kind) {
      case 'text':
        this.insertText(token);
        return;
      case 'comment':
        this.insertComment(token);
        return;
      case 'doctype':
        this.parseError(token);
        return;
      case 'open':
        this.inBodyStartTag(token);
        return;
      case 'close':
        this.inBodyEndTag(token);
        return;
      case 'eof':
        this.handleEofInBody();
        return;
    }
  }

  // ── In-body: start tags ────────────────────────────────────────────────

  private inBodyStartTag(token: Token): void {
    const tag = token.tagName!;

    // ── Head-like elements: delegate to in-head ──────────────────────────
    if (tag === 'base' || tag === 'basefont' || tag === 'bgsound' ||
        tag === 'link' || tag === 'meta' || tag === 'script' ||
        tag === 'style' || tag === 'template') {
      this.processInHeadToken(token);
      return;
    }

    switch (tag) {
      case 'html': {
        this.parseError(token);
        if (this.templateInsertionModes.length === 0) {
          this.openElements[0]?.attributes.forEach((_v, k) => {
            if (!token.attrs?.has(k)) {
              token.attrs?.set(k, _v);
            }
          });
        }
        return;
      }

      case 'body': {
        if (this.openElements.length < 2 ||
            this.openElements[1]?.tagName !== 'body' ||
            this.templateInsertionModes.length > 0) {
          this.parseError(token);
          return;
        }
        this.framesetOk = false;
        const body = this.openElements[1]!;
        token.attrs?.forEach((v, k) => {
          if (!body.attributes.has(k)) {
            (body.attributes as Map<string, string>).set(k, v);
          }
        });
        return;
      }

      case 'frameset': {
        this.parseError(token);
        if (this.openElements.length < 2 ||
            this.openElements[1]?.tagName !== 'body' ||
            !this.framesetOk) {
          return;
        }
        const body = this.openElements[1]!;
        if (body.parent) {
          (body.parent.children as HtmlNode[]).splice(
            (body.parent.children as HtmlNode[]).indexOf(body), 1
          );
        }
        this.openElements.length = 1;
        this.createElementForToken(token);
        this.insertionMode = Im.IN_FRAMESET;
        return;
      }

      // ── Address, article, aside, blockquote, center, details, dialog,
      //    dir, div, fieldset, figcaption, figure, footer, form, header,
      //    hgroup, hr, listing, main, menu, nav, ol, p, search, section,
      //    summary, ul ────────────────────────────────────────────────────
      case 'address': case 'article': case 'aside': case 'blockquote':
      case 'center': case 'details': case 'dialog': case 'dir':
      case 'div': case 'fieldset': case 'figcaption': case 'figure':
      case 'footer': case 'header': case 'hgroup': case 'listing':
      case 'main': case 'menu': case 'nav': case 'ol': case 'search':
      case 'section': case 'summary': case 'ul': {
        if (this.isInButtonScope('p')) {
          this.closePElement();
        }
        this.insertElement(token);
        if (tag === 'hr') {
          this.popCurrentNode();
        } else if (tag === 'form') {
          if (!this.formElement) {
            this.formElement = this.currentNode();
          }
        }
        return;
      }

      case 'form': {
        if (this.formElement && this.templateInsertionModes.length === 0) {
          this.parseError(token);
          return;
        }
        if (this.isInButtonScope('p')) {
          this.closePElement();
        }
        this.insertElement(token);
        if (this.templateInsertionModes.length === 0) {
          this.formElement = this.currentNode();
        }
        return;
      }

      case 'p': {
        if (this.isInButtonScope('p')) {
          this.closePElement();
        }
        this.insertElement(token);
        return;
      }

      // ── Heading (h1–h6) ───────────────────────────────────────────────
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        if (this.isInButtonScope('p')) {
          this.closePElement();
        }
        const cn = this.currentNode();
        if (cn && HEADING_ELEMENTS.has(cn.tagName)) {
          this.popCurrentNode();
          this.parseError(token);
        }
        this.insertElement(token);
        return;
      }

      // ── Pre / listing ─────────────────────────────────────────────────
      case 'pre': case 'listing': {
        if (this.isInButtonScope('p')) {
          this.closePElement();
        }
        this.insertElement(token);
        this.framesetOk = false;
        return;
      }

      // ── Li ────────────────────────────────────────────────────────────
      case 'li': {
        this.framesetOk = false;
        for (let i = this.openElements.length - 1; i >= 0; i--) {
          const el = this.openElements[i]!;
          if (el.tagName === 'li') {
            this.openElements.length = i + 1;
            this.popCurrentNode();
            break;
          }
          if (SPECIAL_ELEMENTS.has(el.tagName) && el.tagName !== 'ul' && el.tagName !== 'ol') {
            break;
          }
        }
        if (this.isInButtonScope('p')) {
          this.closePElement();
        }
        this.insertElement(token);
        return;
      }

      // ── Dd / Dt ───────────────────────────────────────────────────────
      case 'dd': case 'dt': {
        this.framesetOk = false;
        // Generate implied end tags (except for same tag) per WHATWG spec
        this.generateImpliedEndTags(tag);
        for (let i = this.openElements.length - 1; i >= 0; i--) {
          const el = this.openElements[i]!;
          if (el.tagName === tag) {
            this.openElements.length = i + 1;
            this.popCurrentNode();
            break;
          }
          if (SPECIAL_ELEMENTS.has(el.tagName) && el.tagName !== 'p') {
            break;
          }
        }
        if (this.isInButtonScope('p')) {
          this.closePElement();
        }
        this.insertElement(token);
        return;
      }

      // ── Plaintext ─────────────────────────────────────────────────────
      case 'plaintext': {
        if (this.isInButtonScope('p')) {
          this.closePElement();
        }
        this.insertElement(token);
        return;
      }

      // ── A (formatting — adoption agency) ──────────────────────────────
      case 'a': {
        if (this.activeFormattingHas('a')) {
          this.parseError(token);
          this.adoptionAgencyAlgorithm(token);
          if (this.openElementsIncludes('a')) {
            this.popCurrentNode();
            this.activeFormattingRemove('a');
          }
        }
        this.reconstructActiveFormattingElements();
        const el = this.insertElement(token);
        this.activeFormattingElementsPush(el);
        return;
      }

      // ── Formatting: b, big, code, em, font, i, s, small, strike,
      //    strong, tt, u ──────────────────────────────────────────────────
      case 'b': case 'big': case 'code': case 'em': case 'font':
      case 'i': case 's': case 'small': case 'strike': case 'strong':
      case 'tt': case 'u': {
        this.reconstructActiveFormattingElements();
        const el = this.insertElement(token);
        this.activeFormattingElementsPush(el);
        return;
      }

      // ── Nobr (formatting + scope check) ───────────────────────────────
      case 'nobr': {
        this.reconstructActiveFormattingElements();
        if (this.isInScope('nobr')) {
          this.parseError(token);
          this.adoptionAgencyAlgorithm(token);
          this.reconstructActiveFormattingElements();
        }
        const el = this.insertElement(token);
        this.activeFormattingElementsPush(el);
        return;
      }

      // ── Button ────────────────────────────────────────────────────────
      case 'button': {
        if (this.isInScope('button')) {
          this.parseError(token);
          this.adoptionAgencyAlgorithm(token);
          this.reconstructActiveFormattingElements();
        }
        this.reconstructActiveFormattingElements();
        this.insertElement(token);
        this.framesetOk = false;
        return;
      }

      // ── Marquee / Object (formatting + special) ───────────────────────
      case 'marquee': case 'object': {
        this.reconstructActiveFormattingElements();
        const el = this.insertElement(token);
        this.activeFormattingElementsPush(MARKER);
        this.framesetOk = false;
        return;
      }

      // ── Table ─────────────────────────────────────────────────────────
      case 'table': {
        if (this.isInButtonScope('p')) {
          this.closePElement();
        }
        this.insertElement(token);
        this.framesetOk = false;
        this.insertionMode = Im.IN_TABLE;
        return;
      }

      // ── Area, br, embed, img, input, keygen, source, track, wbr ──────
      case 'area': case 'br': case 'embed': case 'img': case 'input':
      case 'keygen': case 'source': case 'track': case 'wbr': {
        this.reconstructActiveFormattingElements();
        this.insertElement(token);
        if (tag === 'img') this.discoverResources(token);
        this.popCurrentNode();
        token.attrs?.delete('alt');
        if (tag === 'input') {
          const type = (token.attrs?.get('type') ?? '').toLowerCase();
          if (type !== 'hidden') this.framesetOk = false;
        } else {
          this.framesetOk = false;
        }
        return;
      }

      // ── Image ─────────────────────────────────────────────────────────
      case 'image': {
        this.reconstructActiveFormattingElements();
        token.tagName = 'img';
        this.insertElement(token);
        this.popCurrentNode();
        this.framesetOk = false;
        return;
      }

      // ── Textarea (RCDATA) ─────────────────────────────────────────────
      case 'textarea': {
        this.reconstructActiveFormattingElements();
        this.insertElement(token);
        this.originalInsertionMode = this.insertionMode;
        this.insertionMode = Im.TEXT;
        this.pendingRawText = '';
        this.framesetOk = false;
        return;
      }

      // ── Title (RCDATA) ────────────────────────────────────────────────
      case 'title': {
        this.handleRawTextElement(token);
        return;
      }

      // ── Noscript (scripting enabled) ──────────────────────────────────
      case 'noscript': {
        this.insertElement(token);
        this.originalInsertionMode = this.insertionMode;
        this.insertionMode = Im.TEXT;
        return;
      }

      // ── Select ────────────────────────────────────────────────────────
      case 'select': {
        this.reconstructActiveFormattingElements();
        this.insertElement(token);
        this.framesetOk = false;
        switch (this.insertionMode) {
          case Im.IN_TABLE: case Im.IN_CAPTION: case Im.IN_TABLE_BODY:
          case Im.IN_ROW: case Im.IN_CELL:
            this.insertionMode = Im.IN_SELECT_IN_TABLE; break;
          default:
            this.insertionMode = Im.IN_SELECT; break;
        }
        return;
      }

      // ── Optgroup / Option ─────────────────────────────────────────────
      case 'optgroup': case 'option': {
        if (this.currentNode()?.tagName === 'option') {
          this.popCurrentNode();
        }
        this.reconstructActiveFormattingElements();
        this.insertElement(token);
        return;
      }

      // ── Rb, rt, rtc, ruby, rp ────────────────────────────────────────
      case 'rb': case 'rtc': {
        this.reconstructActiveFormattingElements();
        if (this.isInScope('ruby')) {
          this.generateImpliedEndTags();
        }
        this.insertElement(token);
        return;
      }
      case 'rp': case 'rt': {
        this.reconstructActiveFormattingElements();
        if (this.isInScope('ruby')) {
          this.generateImpliedEndTags('rtc');
        }
        this.insertElement(token);
        return;
      }
      case 'ruby': {
        this.reconstructActiveFormattingElements();
        this.insertElement(token);
        return;
      }

      // ── Ins / Del / Font (formatting) ─────────────────────────────────
      case 'ins': case 'del': {
        this.reconstructActiveFormattingElements();
        this.insertElement(token);
        this.framesetOk = false;
        return;
      }

      // ── Iframe (not handled in-head) ──────────────────────────────────
      case 'iframe': {
        this.reconstructActiveFormattingElements();
        this.insertElement(token);
        this.originalInsertionMode = this.insertionMode;
        this.insertionMode = Im.TEXT;
        return;
      }

      // ── Isindex ───────────────────────────────────────────────────────
      case 'isindex': {
        this.parseError(token);
        if (this.formElement) return;
        this.reconstructActiveFormattingElements();
        const inputAttrs = token.attrs ?? new Map<string, string>();
        if (inputAttrs.get('action')) {
          const formAttrs = new Map<string, string>();
          formAttrs.set('action', inputAttrs.get('action')!);
          token.attrs = new Map([['name', 'isindex']]);
          this.insertElement({ ...token, tagName: 'form' });
          // Insert HR, label, input
        }
        return;
      }

      // ── Video / Audio ─────────────────────────────────────────────────
      case 'video': case 'audio': {
        this.reconstructActiveFormattingElements();
        this.insertElement(token);
        this.discoverResources(token);
        return;
      }
    }

    this.parseError(token);
  }

  // ── In-body: end tags ──────────────────────────────────────────────────

  private inBodyEndTag(token: Token): void {
    const tag = token.tagName!;

    switch (tag) {
      case 'body': {
        if (!this.isInScope('body')) {
          this.parseError(token);
          return;
        }
        this.framesetOk = false;
        this.insertionMode = Im.AFTER_BODY;
        return;
      }

      case 'html': {
        if (!this.isInScope('body')) {
          this.parseError(token);
          return;
        }
        if (!this.framesetOk) {
          this.parseError(token);
          return;
        }
        this.insertionMode = Im.AFTER_BODY;
        this.processToken(token);
        return;
      }

      case 'address': case 'article': case 'aside': case 'blockquote':
      case 'center': case 'details': case 'dialog': case 'dir':
      case 'div': case 'fieldset': case 'figcaption': case 'figure':
      case 'footer': case 'form': case 'header': case 'hgroup':
      case 'hr': case 'listing': case 'main': case 'menu': case 'nav':
      case 'ol': case 'p': case 'search': case 'section': case 'summary':
      case 'ul': {
        if (!this.isInScope(tag)) {
          this.parseError(token);
          return;
        }
        this.generateImpliedEndTags();
        if (this.currentNode()?.tagName === tag) {
          this.popCurrentNode();
        } else {
          let found = false;
          for (let i = this.openElements.length - 1; i >= 0; i--) {
            if (this.openElements[i]!.tagName === tag) {
              this.openElements.length = i;
              found = true;
              break;
            }
          }
          if (!found) this.parseError(token);
        }
        return;
      }

      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        if (!this.isInScope(tag)) {
          this.parseError(token);
          return;
        }
        this.generateImpliedEndTags();
        if (this.currentNode()?.tagName !== tag) {
          this.parseError(token);
        }
        let found = false;
        for (let i = this.openElements.length - 1; i >= 0; i--) {
          if (this.openElements[i]!.tagName === tag) {
            this.openElements.length = i;
            found = true;
            break;
          }
          if (!HEADING_ELEMENTS.has(this.openElements[i]!.tagName)) break;
        }
        if (!found) this.parseError(token);
        return;
      }

      case 'dd': case 'dt': case 'li': {
        if (!this.isInListItemScope(tag)) {
          this.parseError(token);
          return;
        }
        this.generateImpliedEndTags(tag);
        if (this.currentNode()?.tagName !== tag) {
          this.parseError(token);
        }
        for (let i = this.openElements.length - 1; i >= 0; i--) {
          if (this.openElements[i]!.tagName === tag) {
            this.openElements.length = i;
            break;
          }
        }
        return;
      }

      case 'applet': case 'marquee': case 'object': {
        if (!this.isInScope(tag)) {
          this.parseError(token);
          return;
        }
        this.generateImpliedEndTags();
        this.popCurrentNode();
        this.activeFormattingElementsUpToMarker();
        this.framesetOk = false;
        return;
      }

      case 'rb': case 'rtc': {
        if (!this.isInScope(tag)) {
          this.parseError(token);
          return;
        }
        this.generateImpliedEndTags();
        if (this.currentNode()?.tagName === tag) {
          this.popCurrentNode();
        }
        return;
      }

      case 'rp': case 'rt': {
        if (!this.isInScope('ruby')) {
          this.parseError(token);
          return;
        }
        this.generateImpliedEndTags('rtc');
        if (this.currentNode()?.tagName === tag) {
          this.popCurrentNode();
        }
        return;
      }

      case 'caption': case 'col': case 'colgroup': case 'frame':
      case 'head': case 'tbody': case 'td': case 'tfoot': case 'th':
      case 'thead': case 'tr': {
        this.parseError(token);
        return;
      }

      case 'table': {
        if (!this.isInTableScope('table')) {
          this.parseError(token);
          return;
        }
        this.popCurrentNode();
        this.resetInsertionMode();
        return;
      }

      case 'close': {
        if (this.currentNode()?.tagName === 'template') {
          this.processInHeadToken(token);
          return;
        }
        break;
      }

      // ── Formatting end tags (adoption agency) ─────────────────────────
      case 'a': case 'b': case 'big': case 'code': case 'em':
      case 'font': case 'i': case 'nobr': case 's': case 'small':
      case 'strike': case 'strong': case 'tt': case 'u': {
        this.adoptionAgencyAlgorithm(token);
        return;
      }

      case 'area': case 'base': case 'basefont': case 'bgsound':
      case 'br': case 'embed': case 'hr': case 'img': case 'input':
      case 'keygen': case 'link': case 'meta': case 'param':
      case 'source': case 'track': case 'wbr': {
        this.parseError(token);
        return;
      }

      case 'select': case 'option': case 'optgroup': {
        if (this.isInScope(tag)) {
          this.popCurrentNode();
        } else {
          this.parseError(token);
        }
        return;
      }
    }

    this.parseError(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: TEXT  (§13.2.6.8)
  // ────────────────────────────────────────────────────────────────────────

  private text(token: Token): void {
    switch (token.kind) {
      case 'text':
        this.insertText(token);
        return;
      case 'close': {
        if (token.tagName === 'script') {
          // Script already handled by tokenizer → raw text in pendingRawText
          // Insert as raw content of current node
          const cn = this.currentNode();
          if (cn && cn.tagName === 'script') {
            (cn as { rawContent: string }).rawContent = this.pendingRawText;
          }
          this.popCurrentNode();
          this.insertionMode = this.originalInsertionMode;
          return;
        }
        if (token.tagName === 'textarea') {
          const cn = this.currentNode();
          if (cn && cn.tagName === 'textarea') {
            (cn as { rawContent: string }).rawContent = this.pendingRawText;
          }
          this.popCurrentNode();
          this.insertionMode = this.originalInsertionMode;
          return;
        }
        if (token.tagName === 'title') {
          const cn = this.currentNode();
          if (cn && cn.tagName === 'title') {
            (cn as { rawContent: string }).rawContent = this.pendingRawText;
          }
          this.popCurrentNode();
          this.insertionMode = this.originalInsertionMode;
          return;
        }
        this.parseError(token);
        this.popCurrentNode();
        this.insertionMode = this.originalInsertionMode;
        return;
      }
      default:
        this.parseError(token);
        this.popCurrentNode();
        this.insertionMode = this.originalInsertionMode;
        this.processToken(token);
        return;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: IN TABLE  (§13.2.6.9)
  // ────────────────────────────────────────────────────────────────────────

  private inTable(token: Token): void {
    switch (token.kind) {
      case 'text':
        this.pendingRawText = token.data ?? '';
        this.originalInsertionMode = this.insertionMode;
        this.insertionMode = Im.IN_TABLE_TEXT;
        return;
      case 'comment':
        this.insertComment(token);
        return;
      case 'doctype':
        this.parseError(token);
        return;
      case 'open':
        switch (token.tagName) {
          case 'caption':
          case 'colgroup':
          case 'col':
            this.popCurrentNodeUntil('table');
            this.insertionMode = Im.IN_TABLE_BODY;
            this.processToken(token);
            return;
          case 'tbody':
          case 'tfoot':
          case 'thead':
            this.popCurrentNodeUntil('table');
            this.insertionMode = Im.IN_TABLE_BODY;
            this.processToken(token);
            return;
          case 'tr':
            this.popCurrentNodeUntil('table');
            this.insertionMode = Im.IN_TABLE_BODY;
            this.processToken(token);
            return;
          case 'td': case 'th':
            this.popCurrentNodeUntil('table');
            this.insertionMode = Im.IN_ROW;
            this.processToken(token);
            return;
          case 'table':
            this.parseError(token);
            this.popCurrentNodeUntil('table');
            this.resetInsertionMode();
            this.processToken(token);
            return;
          case 'input':
            if ((token.attrs?.get('type') ?? '').toLowerCase() !== 'hidden') {
              this.parseError(token);
              this.reprocessInBody(token);
              return;
            }
            this.parseError(token);
            this.insertElement(token);
            this.popCurrentNode();
            return;
          case 'form':
            this.parseError(token);
            if (this.formElement || this.templateInsertionModes.length > 0) return;
            const el = this.insertElement(token);
            this.formElement = el;
            this.popCurrentNode();
            return;
          default: {
            this.parseError(token);
            if (!this.isInTableScope('table')) return;
            this.insertElement(token);
            return;
          }
        }
      case 'close':
        if (token.tagName === 'table') {
          if (!this.isInTableScope('table')) {
            this.parseError(token);
            return;
          }
          this.popCurrentNodeUntil('table');
          this.resetInsertionMode();
          return;
        }
        this.parseError(token);
        return;
      case 'eof':
        this.handleEofInBody();
        return;
    }
    this.reprocessInBody(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: IN TABLE TEXT  (§13.2.6.10)
  // ────────────────────────────────────────────────────────────────────────

  private inTableText(token: Token): void {
    if (token.kind === 'text') {
      this.pendingRawText += token.data ?? '';
      return;
    }
    if (this.pendingRawText) {
      const textToken: Token = { kind: 'text', data: this.pendingRawText, offset: token.offset };
      this.pendingRawText = '';
      this.insertionMode = this.originalInsertionMode;
      this.insertText(textToken);
      this.processToken(token);
      return;
    }
    this.insertionMode = this.originalInsertionMode;
    this.processToken(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: IN CAPTION  (§13.2.6.11)
  // ────────────────────────────────────────────────────────────────────────

  private inCaption(token: Token): void {
    switch (token.kind) {
      case 'open':
        if (['caption','col','colgroup','tbody','tfoot','thead','tr','td','th'].includes(token.tagName!)) {
          if (this.isInTableScope('caption')) {
            this.generateImpliedEndTags();
            this.popCurrentNode();
            this.activeFormattingElementsUpToMarker();
            this.insertionMode = Im.IN_TABLE;
            this.processToken(token);
          }
          return;
        }
        break;
      case 'close':
        if (token.tagName === 'caption') {
          if (!this.isInTableScope('caption')) {
            this.parseError(token);
            return;
          }
          this.generateImpliedEndTags();
          this.popCurrentNode();
          this.activeFormattingElementsUpToMarker();
          this.insertionMode = Im.IN_TABLE;
          return;
        }
        if (token.tagName === 'table') {
          this.parseError(token);
          if (this.isInTableScope('caption')) {
            this.generateImpliedEndTags();
            this.popCurrentNode();
            this.activeFormattingElementsUpToMarker();
            this.insertionMode = Im.IN_TABLE;
            this.processToken(token);
          }
          return;
        }
        if (['body','col','colgroup','html','tbody','td','tfoot','th','thead','tr'].includes(token.tagName!)) {
          this.parseError(token);
          return;
        }
        break;
    }
    this.reprocessInBody(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: IN COLUMN GROUP  (§13.2.6.12)
  // ────────────────────────────────────────────────────────────────────────

  private inColumnGroup(token: Token): void {
    switch (token.kind) {
      case 'text':
        if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) {
          this.insertText(token);
          return;
        }
        break;
      case 'comment':
        this.insertComment(token);
        return;
      case 'doctype':
        this.parseError(token);
        return;
      case 'open':
        if (token.tagName === 'col') {
          this.insertElement(token);
          this.popCurrentNode();
          return;
        }
        break;
      case 'close':
        if (token.tagName === 'colgroup') {
          if (this.currentNode()?.tagName !== 'colgroup') {
            this.parseError(token);
            return;
          }
          this.popCurrentNode();
          this.insertionMode = Im.IN_TABLE;
          return;
        }
        if (token.tagName === 'col') {
          this.parseError(token);
          return;
        }
        break;
      case 'eof':
        break;
    }
    if (this.currentNode()?.tagName === 'colgroup') {
      this.popCurrentNode();
    }
    this.insertionMode = Im.IN_TABLE;
    this.processToken(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: IN TABLE BODY  (§13.2.6.13)
  // ────────────────────────────────────────────────────────────────────────

  private inTableBody(token: Token): void {
    switch (token.kind) {
      case 'open':
        switch (token.tagName) {
          case 'tr':
            this.generateImpliedEndTags();
            this.insertElement(token);
            this.insertionMode = Im.IN_ROW;
            return;
          case 'th': case 'td':
            this.parseError(token);
            this.generateImpliedEndTags();
            const tr: Token = { ...token, tagName: 'tr' };
            this.processToken(tr);
            this.processToken(token);
            return;
          case 'caption': case 'col': case 'colgroup':
          case 'tbody': case 'tfoot': case 'thead':
            if (!this.isInTableScope(token.tagName!)) {
              this.parseError(token);
              return;
            }
            this.generateImpliedEndTags();
            this.popCurrentNode();
            this.insertionMode = Im.IN_TABLE;
            this.processToken(token);
            return;
        }
        break;
      case 'close':
        if (token.tagName === 'tbody' || token.tagName === 'thead' || token.tagName === 'tfoot') {
          if (!this.isInTableScope(token.tagName!)) {
            this.parseError(token);
            return;
          }
          this.generateImpliedEndTags();
          this.popCurrentNode();
          this.insertionMode = Im.IN_TABLE;
          return;
        }
        if (token.tagName === 'table') {
          if (!this.isInTableScope('tbody') && !this.isInTableScope('thead') && !this.isInTableScope('tfoot')) {
            this.parseError(token);
            return;
          }
          this.generateImpliedEndTags();
          this.popCurrentNode();
          this.insertionMode = Im.IN_TABLE;
          this.processToken(token);
          return;
        }
        if (['body','caption','col','colgroup','html','td','th','tr'].includes(token.tagName!)) {
          this.parseError(token);
          return;
        }
        break;
    }
    this.reprocessInTable(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: IN ROW  (§13.2.6.14)
  // ────────────────────────────────────────────────────────────────────────

  private inRow(token: Token): void {
    switch (token.kind) {
      case 'open':
        switch (token.tagName) {
          case 'th': case 'td':
            this.generateImpliedEndTags();
            this.insertElement(token);
            this.insertionMode = Im.IN_CELL;
            this.activeFormattingElementsUpToMarker();
            return;
          case 'caption': case 'col': case 'colgroup':
          case 'tbody': case 'tfoot': case 'thead': case 'table':
            if (!this.isInTableScope(token.tagName!)) {
              this.parseError(token);
              return;
            }
            this.generateImpliedEndTags();
            this.popCurrentNode();
            this.insertionMode = Im.IN_TABLE_BODY;
            this.processToken(token);
            return;
        }
        break;
      case 'close':
        if (token.tagName === 'tr') {
          if (!this.isInTableScope('tr')) {
            this.parseError(token);
            return;
          }
          this.generateImpliedEndTags();
          this.popCurrentNode();
          this.insertionMode = Im.IN_TABLE_BODY;
          return;
        }
        if (token.tagName === 'table') {
          if (!this.isInTableScope('tr')) {
            this.parseError(token);
            return;
          }
          this.generateImpliedEndTags();
          this.popCurrentNode();
          this.insertionMode = Im.IN_TABLE_BODY;
          this.processToken(token);
          return;
        }
        if (token.tagName === 'tbody' || token.tagName === 'tfoot' || token.tagName === 'thead') {
          if (!this.isInTableScope(token.tagName!)) {
            this.parseError(token);
            return;
          }
          this.generateImpliedEndTags();
          this.popCurrentNode();
          this.insertionMode = Im.IN_TABLE_BODY;
          this.processToken(token);
          return;
        }
        if (['body','caption','col','colgroup','html','td','th'].includes(token.tagName!)) {
          this.parseError(token);
          return;
        }
        break;
    }
    this.reprocessInTable(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: IN CELL  (§13.2.6.15)
  // ────────────────────────────────────────────────────────────────────────

  private inCell(token: Token): void {
    switch (token.kind) {
      case 'open':
        if (['caption','col','colgroup','tbody','tfoot','thead','tr','td','th'].includes(token.tagName!)) {
          if (this.isInTableScope('td') || this.isInTableScope('th')) {
            this.closeTableCell();
            this.processToken(token);
          } else {
            this.parseError(token);
          }
          return;
        }
        break;
      case 'close':
        if (token.tagName === 'td' || token.tagName === 'th') {
          if (!this.isInTableScope(token.tagName!)) {
            this.parseError(token);
            return;
          }
          this.closeTableCell();
          this.processToken(token);
          return;
        }
        if (token.tagName === 'table' || token.tagName === 'tbody' ||
            token.tagName === 'tfoot' || token.tagName === 'thead' ||
            token.tagName === 'tr') {
          if (!this.isInTableScope(token.tagName!)) {
            this.parseError(token);
            return;
          }
          this.closeTableCell();
          this.processToken(token);
          return;
        }
        if (['body','caption','col','colgroup','html'].includes(token.tagName!)) {
          this.parseError(token);
          return;
        }
        break;
    }
    this.reprocessInBody(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: IN SELECT  (§13.2.6.16)
  // ────────────────────────────────────────────────────────────────────────

  private inSelect(token: Token): void {
    switch (token.kind) {
      case 'text':
        this.insertText(token);
        return;
      case 'comment':
        this.insertComment(token);
        return;
      case 'doctype':
        this.parseError(token);
        return;
      case 'open':
        switch (token.tagName) {
          case 'html':
            this.parseError(token);
            this.processInBodyToken(token);
            return;
          case 'option':
            if (this.currentNode()?.tagName === 'option') {
              this.popCurrentNode();
            }
            this.insertElement(token);
            return;
          case 'optgroup':
            if (this.currentNode()?.tagName === 'option') {
              this.popCurrentNode();
            }
            if (this.currentNode()?.tagName === 'optgroup') {
              this.popCurrentNode();
            }
            this.insertElement(token);
            return;
          case 'select':
            this.parseError(token);
            if (!this.isInSelectScope('select')) return;
            this.popCurrentNodeUntil('select');
            this.resetInsertionMode();
            return;
          case 'textarea': case 'input': case 'keygen': case 'script':
            if (!this.isInSelectScope('select')) {
              this.parseError(token);
              return;
            }
            this.generateImpliedEndTags();
            if (this.currentNode()?.tagName !== 'select') {
              this.parseError(token);
              return;
            }
            this.popCurrentNodeUntil('select');
            this.resetInsertionMode();
            this.processToken(token);
            return;
        }
        this.parseError(token);
        return;
      case 'close':
        if (token.tagName === 'select') {
          if (!this.isInSelectScope('select')) {
            this.parseError(token);
            return;
          }
          this.popCurrentNodeUntil('select');
          this.resetInsertionMode();
          return;
        }
        this.parseError(token);
        return;
      case 'eof':
        break;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: IN SELECT IN TABLE  (§13.2.6.17)
  // ────────────────────────────────────────────────────────────────────────

  private inSelectInTable(token: Token): void {
    if (token.kind === 'open') {
      if (['table','tbody','tfoot','thead','tr','td','th'].includes(token.tagName!)) {
        this.parseError(token);
        if (this.isInSelectScope('select')) {
          if (this.isInSelectScope('select')) {
            this.popCurrentNodeUntil('select');
            this.resetInsertionMode();
            this.processToken(token);
          }
        }
        return;
      }
    }
    if (token.kind === 'close') {
      if (['table','tbody','tfoot','thead','tr','td','th'].includes(token.tagName!)) {
        this.parseError(token);
        if (this.isInSelectScope('select')) {
          this.popCurrentNodeUntil('select');
          this.resetInsertionMode();
          this.processToken(token);
        }
        return;
      }
    }
    this.inSelect(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: IN TEMPLATE  (§13.2.6.18)
  // ────────────────────────────────────────────────────────────────────────

  private inTemplate(token: Token): void {
    switch (token.kind) {
      case 'open':
        switch (token.tagName) {
          case 'base': case 'basefont': case 'bgsound': case 'link':
          case 'meta': case 'noscript': case 'script': case 'style':
          case 'template': case 'title':
            this.processInHeadToken(token);
            return;
          case 'caption':
          case 'colgroup':
          case 'col':
            this.popCurrentNodeUntil('template');
            this.templateInsertionModes.push(Im.IN_TABLE);
            this.insertionMode = Im.IN_TABLE;
            this.processToken(token);
            return;
          case 'tbody':
          case 'tfoot':
          case 'thead':
            this.popCurrentNodeUntil('template');
            this.templateInsertionModes.push(Im.IN_TABLE_BODY);
            this.insertionMode = Im.IN_TABLE_BODY;
            this.processToken(token);
            return;
          case 'td': case 'th':
            this.popCurrentNodeUntil('template');
            this.templateInsertionModes.push(Im.IN_ROW);
            this.insertionMode = Im.IN_ROW;
            this.processToken(token);
            return;
          case 'tr':
            this.popCurrentNodeUntil('template');
            this.templateInsertionModes.push(Im.IN_TABLE_BODY);
            this.insertionMode = Im.IN_TABLE_BODY;
            this.processToken(token);
            return;
          case 'table':
            this.popCurrentNodeUntil('template');
            this.templateInsertionModes.push(Im.IN_TABLE);
            this.insertionMode = Im.IN_TABLE;
            this.processToken(token);
            return;
          default:
            this.popCurrentNodeUntil('template');
            this.templateInsertionModes.push(Im.IN_BODY);
            this.insertionMode = Im.IN_BODY;
            this.processToken(token);
            return;
        }
      case 'close':
        if (token.tagName === 'template') {
          if (!this.isInTemplateScope('template')) {
            this.parseError(token);
            return;
          }
          this.generateAllImpliedEndTagsThoroughly();
          this.popCurrentNodeUntil('template');
          this.templateInsertionModes.pop();
          this.resetInsertionMode();
          return;
        }
        this.parseError(token);
        return;
      default:
        break;
    }
    if (!this.isInTemplateScope('template')) {
      this.parseError(token);
      return;
    }
    this.generateAllImpliedEndTagsThoroughly();
    this.popCurrentNodeUntil('template');
    this.templateInsertionModes.pop();
    this.resetInsertionMode();
    this.processToken(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: AFTER BODY  (§13.2.6.19)
  // ────────────────────────────────────────────────────────────────────────

  private afterBody(token: Token): void {
    switch (token.kind) {
      case 'text':
        if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) {
          this.insertText(token);
          return;
        }
        break;
      case 'comment':
        this.insertComment(token);
        return;
      case 'doctype':
        this.parseError(token);
        return;
      case 'open':
        if (token.tagName === 'html') {
          this.parseError(token);
          this.processInBodyToken(token);
          return;
        }
        break;
      case 'close':
        if (token.tagName === 'html') {
          this.insertionMode = Im.AFTER_AFTER_BODY;
          return;
        }
        break;
      case 'eof':
        break;
    }
    this.insertionMode = Im.AFTER_AFTER_BODY;
    this.processToken(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: IN FRAMESET  (§13.2.6.20)
  // ────────────────────────────────────────────────────────────────────────

  private inFrameset(token: Token): void {
    switch (token.kind) {
      case 'text':
        if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) {
          this.insertText(token);
          return;
        }
        break;
      case 'comment':
        this.insertComment(token);
        return;
      case 'doctype':
        this.parseError(token);
        return;
      case 'open':
        if (token.tagName === 'html') {
          this.processInBodyToken(token);
          return;
        }
        if (token.tagName === 'frameset') {
          this.insertElement(token);
          return;
        }
        break;
      case 'close':
        if (token.tagName === 'frameset') {
          if (this.currentNode()?.tagName !== 'html') {
            this.popCurrentNode();
          }
          return;
        }
        break;
      case 'eof':
        break;
    }
    this.parseError(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: AFTER FRAMESET  (§13.2.6.21)
  // ────────────────────────────────────────────────────────────────────────

  private afterFrameset(token: Token): void {
    switch (token.kind) {
      case 'text':
        if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) {
          this.insertText(token);
          return;
        }
        break;
      case 'comment':
        this.insertComment(token);
        return;
      case 'doctype':
        this.parseError(token);
        return;
      case 'open':
        if (token.tagName === 'html') {
          this.processInBodyToken(token);
          return;
        }
        if (token.tagName === 'noframes') {
          this.insertElement(token);
          return;
        }
        break;
      case 'close':
        if (token.tagName === 'html') {
          this.insertionMode = Im.AFTER_AFTER_FRAMESET;
          return;
        }
        break;
      case 'eof':
        break;
    }
    this.parseError(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: AFTER AFTER BODY  (§13.2.6.22)
  // ────────────────────────────────────────────────────────────────────────

  private afterAfterBody(token: Token): void {
    switch (token.kind) {
      case 'comment':
        this.insertComment(token);
        return;
      case 'doctype':
        this.parseError(token);
        return;
      case 'text':
        if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) {
          this.insertText(token);
          return;
        }
        break;
      case 'open':
        if (token.tagName === 'html') {
          this.processInBodyToken(token);
          return;
        }
        break;
      case 'close':
        if (token.tagName === 'html') {
          this.insertionMode = Im.AFTER_AFTER_FRAMESET;
          return;
        }
        break;
      case 'eof':
        break;
    }
    this.parseError(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // INSERTION MODE: AFTER AFTER FRAMESET  (§13.2.6.23)
  // ────────────────────────────────────────────────────────────────────────

  private afterAfterFrameset(token: Token): void {
    switch (token.kind) {
      case 'comment':
        this.insertComment(token);
        return;
      case 'doctype':
        this.parseError(token);
        return;
      case 'text':
        if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) {
          this.insertText(token);
          return;
        }
        break;
      case 'open':
        if (token.tagName === 'html') {
          this.processInBodyToken(token);
          return;
        }
        if (token.tagName === 'noframes') {
          this.insertElement(token);
          return;
        }
        break;
      case 'eof':
        break;
    }
    this.parseError(token);
  }

  // ────────────────────────────────────────────────────────────────────────
  // EOF HANDLING
  // ────────────────────────────────────────────────────────────────────────

  private handleEof(): void {
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      const el = this.openElements[i]!;
      if (el.tagName !== 'body' && el.tagName !== 'html' && el.tagName !== 'template') {
        this.parseError({ kind: 'eof', offset: 0 });
      }
    }
  }

  private handleEofInBody(): void {
    // Spec: pop all template insertion modes first
    while (this.templateInsertionModes.length > 0) {
      this.templateInsertionModes.pop();
    }
    this.parseError({ kind: 'eof', offset: 0 });
  }

  // ────────────────────────────────────────────────────────────────────────
  // STACK OF OPEN ELEMENTS — SCOPE ALGORITHMS  (§13.2.6.1)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Has an element in scope (default).
   * Stops at: html, table, template.
   */
  private isInScope(tagName: string): boolean {
    return this.hasElementInScope(tagName, SCOPING_ELEMENTS);
  }

  /**
   * Has an element in button scope.
   * Stops at: html, table, template, button.
   */
  private isInButtonScope(tagName: string): boolean {
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      const el = this.openElements[i]!;
      if (el.tagName === tagName) return true;
      if (SCOPING_ELEMENTS.has(el.tagName) || el.tagName === 'button' ||
          el.tagName === 'html' || el.tagName === 'table' || el.tagName === 'template') {
        return false;
      }
    }
    return false;
  }

  /**
   * Has an element in list item scope.
   * Stops at: html, table, template, ol, ul.
   */
  private isInListItemScope(tagName: string): boolean {
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      const el = this.openElements[i]!;
      if (el.tagName === tagName) return true;
      if (SCOPING_ELEMENTS.has(el.tagName) || el.tagName === 'ol' ||
          el.tagName === 'ul' || el.tagName === 'html' ||
          el.tagName === 'table' || el.tagName === 'template') {
        return false;
      }
    }
    return false;
  }

  /**
   * Has an element in table scope.
   * Stops at: html, template, table.
   */
  private isInTableScope(tagName: string): boolean {
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      const el = this.openElements[i]!;
      if (el.tagName === tagName) return true;
      if (el.tagName === 'html' || el.tagName === 'template' || el.tagName === 'table') {
        return false;
      }
    }
    return false;
  }

  /**
   * Has an element in select scope.
   * Stops at: html, template, select.
   */
  private isInSelectScope(tagName: string): boolean {
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      const el = this.openElements[i]!;
      if (el.tagName === tagName) return true;
      if (el.tagName === 'html' || el.tagName === 'template' || el.tagName === 'select') {
        return false;
      }
    }
    return false;
  }

  /**
   * Has an element in template scope.
   * Stops at: html, template.
   */
  private isInTemplateScope(tagName: string): boolean {
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      const el = this.openElements[i]!;
      if (el.tagName === tagName) return true;
      if (el.tagName === 'html' || el.tagName === 'template') return false;
    }
    return false;
  }

  private hasElementInScope(tagName: string, extra: Set<string>): boolean {
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      const el = this.openElements[i]!;
      if (el.tagName === tagName) return true;
      if (extra.has(el.tagName) || el.tagName === 'html' ||
          el.tagName === 'table' || el.tagName === 'template') {
        return false;
      }
    }
    return false;
  }

  // ────────────────────────────────────────────────────────────────────────
  // LIST OF ACTIVE FORMATTING ELEMENTS  (§13.2.6.2)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Reconstruct the active formatting elements list.
   * If the last entry is a marker or in the open elements, return.
   * Otherwise, find the first entry not in open elements, then re-create
   * entries from that point forward.
   */
  private reconstructActiveFormattingElements(): void {
    if (this.activeFormattingElements.length === 0) return;

    let lastIdx = this.activeFormattingElements.length - 1;
    const lastEntry = this.activeFormattingElements[lastIdx];
    if (lastEntry === MARKER || this.openElements.includes(lastEntry as HtmlElement)) {
      return;
    }

    // Walk backwards to find the first entry not in open elements
    while (lastIdx > 0) {
      const entry = this.activeFormattingElements[lastIdx - 1];
      if (entry === MARKER || this.openElements.includes(entry as HtmlElement)) {
        break;
      }
      lastIdx--;
    }

    // Reconstruct from lastIdx forward
    let idx = lastIdx;
    while (idx < this.activeFormattingElements.length) {
      const entry = this.activeFormattingElements[idx] as HtmlElement;
      const clone = this.cloneElement(entry);
      this.activeFormattingElements[idx] = clone;

      const current = this.currentNode();
      if (current) {
        (current.children as HtmlNode[]).push(clone);
        (clone as { parent: HtmlElement | null }).parent = current;
      } else {
        (this.rootNodes as HtmlNode[]).push(clone);
      }
      this.openElements.push(clone);
      idx++;
    }
  }

  private activeFormattingElementsPush(node: HtmlElement): void {
    // Count consecutive elements (not markers) from the end
    let count = 0;
    for (let i = this.activeFormattingElements.length - 1; i >= 0; i--) {
      if (this.activeFormattingElements[i] === MARKER) break;
      const entry = this.activeFormattingElements[i] as HtmlElement;
      if (entry.tagName === node.tagName &&
          entry.attributes.size === node.attributes.size) {
        count++;
        if (count >= 3) {
          this.activeFormattingElements.splice(i, 1);
        }
      } else {
        break;
      }
    }
    this.activeFormattingElements.push(node);
  }

  private activeFormattingHas(tagName: string): boolean {
    for (let i = this.activeFormattingElements.length - 1; i >= 0; i--) {
      const entry = this.activeFormattingElements[i];
      if (entry === MARKER) return false;
      if ((entry as HtmlElement).tagName === tagName) return true;
    }
    return false;
  }

  private activeFormattingRemove(tagName: string): void {
    for (let i = this.activeFormattingElements.length - 1; i >= 0; i--) {
      const entry = this.activeFormattingElements[i];
      if (entry === MARKER) return;
      if ((entry as HtmlElement).tagName === tagName) {
        this.activeFormattingElements.splice(i, 1);
        return;
      }
    }
  }

  /**
   * Clear the active formatting elements up to (and including) the last marker.
   */
  private activeFormattingElementsUpToMarker(): void {
    while (this.activeFormattingElements.length > 0) {
      const last = this.activeFormattingElements[this.activeFormattingElements.length - 1];
      this.activeFormattingElements.pop();
      if (last === MARKER) break;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // ADOPTION AGENCY ALGORITHM  (§13.2.6.1 — steps 1–19)
  //
  // Handles misnested formatting tags like <b><i></b></i>.
  // The algorithm restructures both the stack of open elements and
  // the list of active formatting elements.
  // ────────────────────────────────────────────────────────────────────────

  private adoptionAgencyAlgorithm(token: Token): void {
    const subject = token.tagName!;

    // Step 2: If current node matches subject and is NOT in the active
    // formatting elements list, just pop it and return.
    const cn = this.currentNode();
    if (cn && cn.tagName === subject && !this.activeFormattingHas(subject)) {
      this.popCurrentNode();
      return;
    }

    // Step 3
    let outerLoopCounter = 0;

    // Step 4: Outer loop (up to 8 iterations)
    while (outerLoopCounter < 8) {
      outerLoopCounter++;

      // Step 4.3: Find the last formatting element with matching tag name
      let formattingElement: HtmlElement | null = null;
      let formattingIdx = -1;
      for (let i = this.activeFormattingElements.length - 1; i >= 0; i--) {
        const entry = this.activeFormattingElements[i];
        if (entry === MARKER) break;
        if ((entry as HtmlElement).tagName === subject) {
          formattingElement = entry as HtmlElement;
          formattingIdx = i;
          break;
        }
      }

      if (!formattingElement) {
        // "Any other end tag" behavior
        this.parseError(token);
        return;
      }

      // Step 4.4: If formatting element is not in the stack of open elements
      if (!this.openElements.includes(formattingElement)) {
        this.parseError(token);
        this.activeFormattingElements.splice(
          this.activeFormattingElements.indexOf(formattingElement), 1
        );
        return;
      }

      // Step 4.5: If formatting element is in the stack but not in scope
      if (!this.isInScope(subject)) {
        this.parseError(token);
        return;
      }

      // Step 4.6: If formatting element is not the current node (parse error, continue)
      if (this.currentNode() !== formattingElement) {
        this.parseError(token);
      }

      // Step 4.7: Find the furthest block — the topmost node in the stack
      // below formattingElement that is a special element
      const fmtStackIdx = this.openElements.indexOf(formattingElement);
      let furthestBlock: HtmlElement | null = null;
      let furthestBlockStackIdx = -1;
      for (let i = this.openElements.length - 1; i > fmtStackIdx; i--) {
        if (SPECIAL_ELEMENTS.has(this.openElements[i]!.tagName)) {
          furthestBlock = this.openElements[i]!;
          furthestBlockStackIdx = i;
          break;
        }
      }

      // Step 4.8: No furthest block — pop everything up to and including formattingElement
      if (!furthestBlock) {
        this.openElements.length = fmtStackIdx; // removes formattingElement and everything above
        this.activeFormattingElements.splice(formattingIdx, 1);
        return;
      }

      // Step 4.9: commonAncestor is the element immediately above formattingElement
      const commonAncestor = this.openElements[fmtStackIdx - 1] ?? null;

      // Step 4.10: Bookmark the position of formattingElement in the formatting list
      let bookmark = formattingIdx;

      // Step 4.11: node and lastNode start as furthestBlock
      let lastNode: HtmlElement = furthestBlock;

      // Step 4.12: Inner loop — walk up from furthestBlock toward formattingElement
      let innerLoopCounter = 0;
      let nodeStackIdx = furthestBlockStackIdx;

      while (true) {
        innerLoopCounter++;

        // 4.12.2: Let node be the element immediately above the current position
        nodeStackIdx--;
        const node = this.openElements[nodeStackIdx]!;

        // 4.12.3: If node is formattingElement, break the inner loop
        if (node === formattingElement) break;

        // 4.12.4: If innerLoopCounter > 3 and node is in formatting list, remove it
        if (innerLoopCounter > 3) {
          const idx = this.activeFormattingElements.indexOf(node);
          if (idx >= 0) {
            this.activeFormattingElements.splice(idx, 1);
            if (bookmark > idx) bookmark--;
          }
        }

        // 4.12.5: If node is not in the formatting list, remove from stack and continue
        if (!this.activeFormattingElements.includes(node)) {
          this.openElements.splice(nodeStackIdx, 1);
          // Don't decrement nodeStackIdx — the element above shifted down
          continue;
        }

        // 4.12.6: Clone node, replace in both lists
        const clone = this.cloneElement(node);
        this.openElements[nodeStackIdx] = clone;
        const fmtIdx = this.activeFormattingElements.indexOf(node);
        if (fmtIdx >= 0) {
          this.activeFormattingElements[fmtIdx] = clone;
        }

        // 4.12.7: If lastNode was furthestBlock, move bookmark after the clone
        if (lastNode === furthestBlock) {
          const cloneFmtIdx = this.activeFormattingElements.indexOf(clone);
          if (cloneFmtIdx >= 0) bookmark = cloneFmtIdx + 1;
        }

        // 4.12.8: Append lastNode as a child of node (the clone)
        (clone.children as HtmlNode[]).push(lastNode);
        (lastNode as { parent: HtmlElement | null }).parent = clone;

        // 4.12.9: lastNode = node (the clone)
        lastNode = clone;
      }

      // Step 4.13–4.14: Insert lastNode into commonAncestor after its last child
      if (commonAncestor && lastNode !== furthestBlock) {
        // Remove lastNode from its current parent if any
        if (lastNode.parent) {
          (lastNode.parent.children as HtmlNode[]).splice(
            (lastNode.parent.children as HtmlNode[]).indexOf(lastNode), 1
          );
        }
        (commonAncestor.children as HtmlNode[]).push(lastNode);
        (lastNode as { parent: HtmlElement | null }).parent = commonAncestor;
      }

      // Step 4.15: Create a new element for formattingElement's token
      const newElement = this.cloneElement(formattingElement);

      // Step 4.16: Move all children of furthestBlock to the new element
      const furthestChildren = [...furthestBlock.children] as HtmlNode[];
      (furthestBlock.children as HtmlNode[]).length = 0;
      for (const child of furthestChildren) {
        (child as { parent: HtmlElement | null }).parent = newElement;
        (newElement.children as HtmlNode[]).push(child);
      }

      // Step 4.17: Append the new element to furthestBlock
      (furthestBlock.children as HtmlNode[]).push(newElement);
      (newElement as { parent: HtmlElement | null }).parent = furthestBlock;

      // Step 4.18: Replace formattingElement with newElement in formatting list at bookmark
      if (bookmark > this.activeFormattingElements.length) {
        bookmark = this.activeFormattingElements.length;
      }
      this.activeFormattingElements.splice(
        this.activeFormattingElements.indexOf(formattingElement), 1
      );
      // Adjust bookmark after removal
      const newBookmark = Math.min(bookmark, this.activeFormattingElements.length);
      this.activeFormattingElements.splice(newBookmark, 0, newElement);

      // Step 4.19: Remove formattingElement from stack, insert newElement below furthestBlock
      this.openElements.splice(fmtStackIdx, 1);
      const newFbIdx = this.openElements.indexOf(furthestBlock);
      this.openElements.splice(newFbIdx + 1, 0, newElement);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // FOSTER PARENTING  (§13.2.6 — "appropriate place for inserting")
  //
  // When content appears inside table context elements where it doesn't
  // belong, it must be "foster parented" — inserted before/after the table
  // rather than inside the table structure.
  //
  // The spec defines a fallback chain:
  //   1. Last template in stack  → insert inside template contents
  //   2. No table in stack       → insert inside first element (html)
  //   3. Table has a parent      → insert BEFORE the table
  //   4. Table has no parent     → insert inside the element above table
  //
  // After finding the location, a template contents redirect is applied
  // if the target is inside a template.
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Check if the current node is in a context where foster parenting should
   * be applied. Per the WHATWG spec, this applies when the target is a
   * table, tbody, tfoot, thead, or tr element.
   */
  private shouldFosterParent(): boolean {
    if (this.insertionMode !== Im.IN_TABLE && this.insertionMode !== Im.IN_TABLE_TEXT) return false;
    const cn = this.currentNode();
    if (!cn) return false;
    return FOSTER_PARENT_CONTEXT.has(cn.tagName);
  }

  /**
   * Find the foster parent target — the element and optional "before" node
   * that determine where content should be inserted when foster parenting
   * is active. Returns null if foster parenting is not needed.
   *
   * Spec: §13.2.6 "appropriate place for inserting"
   */
  private getFosterParentTarget(): { parent: HtmlElement; before: HtmlNode | null } | null {
    // Find last template in the stack
    let lastTemplate: HtmlElement | null = null;
    let lastTemplateIdx = -1;
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      if (this.openElements[i]!.tagName === 'template') {
        lastTemplate = this.openElements[i]!;
        lastTemplateIdx = i;
        break;
      }
    }

    // Find last table in the stack
    let lastTable: HtmlElement | null = null;
    let lastTableIdx = -1;
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      if (this.openElements[i]!.tagName === 'table') {
        lastTable = this.openElements[i]!;
        lastTableIdx = i;
        break;
      }
    }

    // Fallback 1: If there's a template and it's higher than (or there's no) table
    if (lastTemplate && (!lastTable || lastTemplateIdx > lastTableIdx)) {
      // Insert inside the template's template contents
      return { parent: lastTemplate, before: null };
    }

    // Fallback 2: No table in stack — insert inside the html element
    if (!lastTable) {
      const html = this.openElements[0];
      if (html) return { parent: html, before: null };
      return null;
    }

    // Fallback 3: Table has a parent node — insert BEFORE the table
    if (lastTable.parent) {
      const parent = lastTable.parent as HtmlElement;
      return { parent, before: lastTable };
    }

    // Fallback 4: Table has no parent — insert inside the element above it
    if (lastTableIdx > 0) {
      return { parent: this.openElements[lastTableIdx - 1]!, before: null };
    }

    // Should not reach here in normal circumstances
    return { parent: this.openElements[0]!, before: null };
  }

  /**
   * Insert a node at the foster parent location.
   * Handles both element nodes and text/comment nodes.
   */
  private fosterParentNode(node: HtmlNode): void {
    const target = this.getFosterParentTarget();
    if (!target) {
      (this.rootNodes as HtmlNode[]).push(node);
      (node as { parent: HtmlElement | null }).parent = null;
      return;
    }

    // Step 3: Template contents redirect
    let insertParent = target.parent;
    if (insertParent.tagName === 'template') {
      // Redirect to template's template contents (children of template)
      // For now, we treat the template's children as its template contents
    }

    if (target.before) {
      const idx = (insertParent.children as HtmlNode[]).indexOf(target.before);
      if (idx >= 0) {
        (insertParent.children as HtmlNode[]).splice(idx, 0, node);
      } else {
        (insertParent.children as HtmlNode[]).push(node);
      }
    } else {
      (insertParent.children as HtmlNode[]).push(node);
    }
    (node as { parent: HtmlElement | null }).parent = insertParent;
  }

  // ────────────────────────────────────────────────────────────────────────
  // RESET INSERTION MODE  (§13.2.6)
  // ────────────────────────────────────────────────────────────────────────

  private resetInsertionMode(): void {
    const node = this.openElements[this.openElements.length - 1];
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

  // ────────────────────────────────────────────────────────────────────────
  // IMPLIED END TAGS
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Generate implied end tags (§13.2.6.3).
   * Pops elements while the current node is one of the implied end tag
   * elements: dd, dt, li, optgroup, option, p, rb, rp, rt, rtc.
   */
  private generateImpliedEndTags(except?: string): void {
    while (this.currentNode() && IMPLIED_END_TAG_ELEMENTS.has(this.currentNode()!.tagName) &&
           this.currentNode()!.tagName !== except) {
      this.popCurrentNode();
    }
  }

  /**
   * Generate all implied end tags thoroughly (§13.2.6.3).
   * Like generateImpliedEndTags but also includes table-related elements:
   * caption, colgroup, tbody, td, tfoot, th, thead, tr.
   * Used when closing a template end tag.
   */
  private generateAllImpliedEndTagsThoroughly(except?: string): void {
    while (this.currentNode() && THOROUGH_IMPLIED_END_TAG_ELEMENTS.has(this.currentNode()!.tagName) &&
           this.currentNode()!.tagName !== except) {
      this.popCurrentNode();
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // CORE HELPERS
  // ────────────────────────────────────────────────────────────────────────

  private currentNode(): HtmlElement | null {
    return this.openElements[this.openElements.length - 1] ?? null;
  }

  private appendToCurrentNode(node: HtmlNode): void {
    const current = this.currentNode();
    if (current) {
      (current.children as HtmlNode[]).push(node);
      (node as { parent: HtmlElement | null }).parent = current;
    } else {
      (this.rootNodes as HtmlNode[]).push(node);
    }
  }

  private popCurrentNode(): HtmlElement {
    return this.openElements.pop()!;
  }

  private popCurrentNodeUntil(tagName: string): void {
    while (this.openElements.length > 0) {
      const el = this.openElements[this.openElements.length - 1]!;
      this.openElements.pop();
      if (el.tagName === tagName) break;
    }
  }

  private openElementsIncludes(tagName: string): boolean {
    return this.openElements.some(el => el.tagName === tagName);
  }

  private insertElement(token: Token): HtmlElement {
    const tag = token.tagName!;
    const attrs = token.attrs ?? new Map<string, string>();

    const element: HtmlElement = {
      nodeType:    NodeType.Element,
      tagName:     tag,
      attributes:  attrs,
      children:    [],
      parent:      null,
      isVoid:      VOID_ELEMENTS.has(tag),
      isRawText:   RAW_TEXT_ELEMENTS.has(tag),
      rawContent:  '',
      sourceOffset: token.offset,
    } as HtmlElement;

    if (this.shouldFosterParent()) {
      this.fosterParentNode(element);
    } else {
      this.appendToCurrentNode(element);
    }

    this.openElements.push(element);
    return element;
  }

  private createElementForToken(token: Token): HtmlElement {
    const tag = token.tagName!;
    const attrs = token.attrs ?? new Map<string, string>();

    const element: HtmlElement = {
      nodeType:    NodeType.Element,
      tagName:     tag,
      attributes:  attrs,
      children:    [],
      parent:      null,
      isVoid:      VOID_ELEMENTS.has(tag),
      isRawText:   RAW_TEXT_ELEMENTS.has(tag),
      rawContent:  '',
      sourceOffset: token.offset,
    } as HtmlElement;

    this.appendToCurrentNode(element);
    this.openElements.push(element);
    return element;
  }

  private insertHeadElement(token: Token): HtmlElement {
    const headToken: Token = { ...token, tagName: 'head' };
    const el = this.createElementForToken(headToken);
    this.headElement = el;
    return el;
  }

  private insertBodyElement(token: Token): HtmlElement {
    if (this.openElements.length >= 2 && this.openElements[1]?.tagName === 'body') {
      return this.openElements[1]!;
    }
    const bodyToken: Token = { ...token, tagName: 'body' };
    const el = this.createElementForToken(bodyToken);
    this.bodyElement = el;
    return el;
  }

  private insertComment(token: Token): void {
    const node: HtmlComment = {
      nodeType:  NodeType.Comment,
      data:      token.data ?? '',
      parent:    null,
      sourceOffset: token.offset,
    };
    if (this.shouldFosterParent()) {
      this.fosterParentNode(node);
    } else {
      this.appendToCurrentNode(node);
    }
  }

  private insertText(token: Token): void {
    const text = token.data ?? '';
    if (!text) return;

    // Accumulate pending raw text for text mode
    if (this.insertionMode === Im.TEXT || this.insertionMode === Im.IN_TABLE_TEXT) {
      this.pendingRawText += text;
      return;
    }

    const current = this.currentNode();

    // Handle raw text elements
    if (current && current.isRawText) {
      (current as { rawContent: string }).rawContent += text;
      return;
    }

    if (!current) {
      const textNode: HtmlTextNode = {
        nodeType: NodeType.Text,
        text,
        parent: null,
        sourceOffset: token.offset,
      };
      (this.rootNodes as HtmlNode[]).push(textNode);
      return;
    }

    // Foster parent text when in table context
    if (this.shouldFosterParent()) {
      const textNode: HtmlTextNode = {
        nodeType: NodeType.Text,
        text,
        parent: null,
        sourceOffset: token.offset,
      };
      this.fosterParentNode(textNode);
      return;
    }

    // Merge with adjacent text nodes
    const lastChild = current.children[current.children.length - 1];
    if (lastChild && lastChild.nodeType === NodeType.Text) {
      (lastChild as { text: string }).text += text;
    } else {
      const textNode: HtmlTextNode = {
        nodeType: NodeType.Text,
        text,
        parent: current,
        sourceOffset: token.offset,
      };
      (current.children as HtmlNode[]).push(textNode);
    }
  }

  private cloneElement(element: HtmlElement): HtmlElement {
    return {
      nodeType:    NodeType.Element,
      tagName:     element.tagName,
      attributes:  new Map(element.attributes),
      children:    [],
      parent:      null,
      isVoid:      element.isVoid,
      isRawText:   element.isRawText,
      rawContent:  '',
      sourceOffset: element.sourceOffset,
    } as HtmlElement;
  }

  private closePElement(): void {
    this.generateImpliedEndTags('p');
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      if (this.openElements[i]!.tagName === 'p') {
        this.openElements.splice(i, 1);
        break;
      }
    }
  }

  private closeTableCell(): void {
    this.generateImpliedEndTags();
    if (this.isInTableScope('td')) {
      this.popCurrentNodeUntil('td');
    } else if (this.isInTableScope('th')) {
      this.popCurrentNodeUntil('th');
    }
    this.activeFormattingElementsUpToMarker();
    this.insertionMode = Im.IN_ROW;
  }

  private handleRawTextElement(token: Token): void {
    this.insertElement(token);
    this.originalInsertionMode = this.insertionMode;
    this.insertionMode = Im.TEXT;
    this.pendingRawText = '';
  }

  // ────────────────────────────────────────────────────────────────────────
  // REPROCESSING HELPERS
  // ────────────────────────────────────────────────────────────────────────

  private reprocessInBody(token: Token): void {
    this.insertionMode = Im.IN_BODY;
    this.processToken(token);
  }

  private reprocessInTable(token: Token): void {
    this.insertionMode = Im.IN_TABLE;
    this.processToken(token);
  }

  private processInHeadToken(token: Token): void {
    this.insertionMode = Im.IN_HEAD;
    this.processToken(token);
  }

  private processInBodyToken(token: Token): void {
    const saved = this.insertionMode;
    this.insertionMode = Im.IN_BODY;
    this.processToken(token);
    this.insertionMode = saved;
  }

  // ────────────────────────────────────────────────────────────────────────
  // RESOURCE DISCOVERY
  // ────────────────────────────────────────────────────────────────────────

  private discoverResources(token: Token): void {
    const tag  = token.tagName!;
    const attrs = token.attrs ?? new Map<string, string>();
    const resolve = (href: string): string => {
      try { return new URL(href, this.baseUrl || undefined).href; }
      catch { return href; }
    };

    const inHead = this.openElements.some(el => el.tagName === 'head');
    let res: DiscoveredResource | null = null;

    switch (tag) {
      case 'link': {
        const rel  = (attrs.get('rel') ?? '').toLowerCase().trim();
        const href = attrs.get('href');
        if (!href) return;
        const kind = LINK_REL_MAP.get(rel) ?? 'other';
        res = {
          url: resolve(href), kind,
          blocking: rel === 'stylesheet' && inHead,
          deferred: false, sourceTag: 'link',
        };
        break;
      }
      case 'script': {
        const src = attrs.get('src');
        if (!src) return;
        res = {
          url: resolve(src), kind: 'script',
          blocking: !attrs.has('defer') && !attrs.has('async') && inHead,
          deferred: attrs.has('defer') || attrs.has('async'),
          sourceTag: 'script',
        };
        break;
      }
      case 'img': {
        const src = attrs.get('src') ?? attrs.get('data-src');
        if (!src) return;
        res = { url: resolve(src), kind: 'image', blocking: false, deferred: false, sourceTag: 'img' };
        break;
      }
      case 'video': case 'audio': {
        const src = attrs.get('src');
        if (!src) return;
        res = { url: resolve(src), kind: 'media', blocking: false, deferred: true, sourceTag: tag };
        break;
      }
      case 'iframe': {
        const src = attrs.get('src');
        if (!src) return;
        res = { url: resolve(src), kind: 'document', blocking: false, deferred: true, sourceTag: 'iframe' };
        break;
      }
    }
    if (res) this.resources.push(res);
  }

  private checkMetaCharset(token: Token): void {
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

  // ────────────────────────────────────────────────────────────────────────
  // PARSE ERROR
  // ────────────────────────────────────────────────────────────────────────

  private parseError(token: Token, msg?: string): void {
    this.errors.push({
      nodeType:  NodeType.ParseError,
      message:   msg ?? `Parse error at ${token.kind}${token.tagName ? ' <' + token.tagName + '>' : ''}`,
      parent:    null,
      sourceOffset: token.offset,
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // DOCUMENT CREATION
  // ────────────────────────────────────────────────────────────────────────

  private createDocument(): HtmlDocument {
    return {
      nodeType:     NodeType.Document,
      children:     this.rootNodes,
      doctype:      this.doctype,
      htmlElement:  this.htmlElement,
      headElement:  this.headElement,
      bodyElement:  this.bodyElement,
      errors:       this.errors,
      hasDoctype:   this.doctype !== null,
      metaCharset:  this.metaCharset,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // RESET
  // ────────────────────────────────────────────────────────────────────────

  private reset(baseUrl: string): void {
    this.insertionMode        = Im.INITIAL;
    this.originalInsertionMode = Im.IN_BODY;
    this.openElements         = [];
    this.activeFormattingElements = [];
    this.templateInsertionModes = [];
    this.framesetOk           = true;
    this.formElement          = null;
    this.rootNodes            = [];
    this.errors               = [];
    this.resources            = [];
    this.baseUrl              = baseUrl;
    this.doctype              = null;
    this.htmlElement          = null;
    this.headElement          = null;
    this.bodyElement          = null;
    this.metaCharset          = null;
    this.pendingRawText       = '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { TreeBuilder };
