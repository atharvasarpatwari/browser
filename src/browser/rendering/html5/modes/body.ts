import type { Token } from '../../html5-tokenizer';
import {
  Im,
  HEADING_ELEMENTS,
  SPECIAL_ELEMENTS,
} from '../constants';
import type { TreeBuilderContext } from './types';

/**
 * §13.2.6.7 — "in body" insertion mode
 *
 * The largest and most complex insertion mode. Handles start tags,
 * end tags, text, comments, doctypes, and EOF for content inside <body>.
 */
export function handleInBody(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'text':
      ctx.insertText(token);
      return;
    case 'comment':
      ctx.insertComment(token);
      return;
    case 'doctype':
      ctx.parseError(token);
      return;
    case 'open':
      inBodyStartTag(ctx, token);
      return;
    case 'close':
      inBodyEndTag(ctx, token);
      return;
    case 'eof':
      ctx.handleEofInBody();
      return;
  }
}

// ── In-body: start tags ──────────────────────────────────────────────────

function inBodyStartTag(ctx: TreeBuilderContext, token: Token): void {
  const tag = token.tagName!;

  // Head-like elements: delegate to in-head
  if (tag === 'base' || tag === 'basefont' || tag === 'bgsound' ||
      tag === 'link' || tag === 'meta' || tag === 'script' ||
      tag === 'style' || tag === 'template') {
    ctx.processInHeadToken(token);
    return;
  }

  switch (tag) {
    case 'html': {
      ctx.parseError(token);
      if (ctx.templateInsertionModes.length === 0) {
        const htmlEl = ctx.openElements.elementAt(0);
        if (htmlEl) {
          htmlEl.attributes.forEach((_v: string, k: string) => {
            if (!token.attrs?.has(k)) {
              token.attrs?.set(k, _v);
            }
          });
        }
      }
      return;
    }

    case 'body': {
      if (ctx.openElements.length < 2 ||
          ctx.openElements.elementAt(1)?.tagName !== 'body' ||
          ctx.templateInsertionModes.length > 0) {
        ctx.parseError(token);
        return;
      }
      ctx.framesetOk = false;
      const body = ctx.openElements.elementAt(1)!;
      token.attrs?.forEach((v: string, k: string) => {
        if (!body.attributes.has(k)) {
          (body.attributes as Map<string, string>).set(k, v);
        }
      });
      return;
    }

    case 'frameset': {
      ctx.parseError(token);
      if (ctx.openElements.length < 2 ||
          ctx.openElements.elementAt(1)?.tagName !== 'body' ||
          !ctx.framesetOk) {
        return;
      }
      const body = ctx.openElements.elementAt(1)!;
      if (body.parent) {
        (body.parent as any).children.splice(
          (body.parent as any).children.indexOf(body), 1
        );
      }
      ctx.openElements.clear();
      ctx.openElements.push(ctx.htmlElement!);
      ctx.insertHTMLElement(token);
      ctx.setMode(Im.IN_FRAMESET);
      return;
    }

    // Address, article, aside, blockquote, center, details, dialog,
    // dir, div, fieldset, figcaption, figure, footer, form, header,
    // hgroup, hr, listing, main, menu, nav, ol, p, search, section,
    // summary, ul
    case 'address': case 'article': case 'aside': case 'blockquote':
    case 'center': case 'details': case 'dialog': case 'dir':
    case 'div': case 'fieldset': case 'figcaption': case 'figure':
    case 'footer': case 'header': case 'hgroup': case 'listing':
    case 'main': case 'menu': case 'nav': case 'ol': case 'search':
      case 'section': case 'summary': case 'ul': {
        if (ctx.isInButtonScope('p')) {
          ctx.closePElement();
        }
        ctx.insertHTMLElement(token);
        return;
      }

    case 'form': {
      if (ctx.formElement && ctx.templateInsertionModes.length === 0) {
        ctx.parseError(token);
        return;
      }
      if (ctx.isInButtonScope('p')) {
        ctx.closePElement();
      }
      ctx.insertHTMLElement(token);
      if (ctx.templateInsertionModes.length === 0) {
        ctx.formElement = ctx.currentNode();
      }
      return;
    }

    case 'p': {
      if (ctx.isInButtonScope('p')) {
        ctx.closePElement();
      }
      ctx.insertHTMLElement(token);
      return;
    }

    // Heading (h1–h6)
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      if (ctx.isInButtonScope('p')) {
        ctx.closePElement();
      }
      const cn = ctx.currentNode();
      if (cn && HEADING_ELEMENTS.has(cn.tagName)) {
        ctx.popCurrentNode();
        ctx.parseError(token);
      }
      ctx.insertHTMLElement(token);
      return;
    }

    // Pre / listing
    case 'pre': case 'listing': {
      if (ctx.isInButtonScope('p')) {
        ctx.closePElement();
      }
      ctx.insertHTMLElement(token);
      ctx.framesetOk = false;
      return;
    }

    // Li
    case 'li': {
      ctx.framesetOk = false;
      for (let i = ctx.openElements.length - 1; i >= 0; i--) {
        const el = ctx.openElements.elementAt(i)!;
        if (el.tagName === 'li') {
          ctx.popCurrentNodeUntil('li');
          break;
        }
        if (SPECIAL_ELEMENTS.has(el.tagName) && el.tagName !== 'ul' && el.tagName !== 'ol') {
          break;
        }
      }
      if (ctx.isInButtonScope('p')) {
        ctx.closePElement();
      }
      ctx.insertHTMLElement(token);
      return;
    }

    // Dd / Dt
    case 'dd': case 'dt': {
      ctx.framesetOk = false;
      ctx.generateImpliedEndTags(tag);
      for (let i = ctx.openElements.length - 1; i >= 0; i--) {
        const el = ctx.openElements.elementAt(i)!;
        if (el.tagName === tag) {
          ctx.popCurrentNodeUntil(tag);
          break;
        }
        if (SPECIAL_ELEMENTS.has(el.tagName) && el.tagName !== 'p') {
          break;
        }
      }
      if (ctx.isInButtonScope('p')) {
        ctx.closePElement();
      }
      ctx.insertHTMLElement(token);
      return;
    }

    // Plaintext
    case 'plaintext': {
      if (ctx.isInButtonScope('p')) {
        ctx.closePElement();
      }
      ctx.insertHTMLElement(token);
      return;
    }

    // A (formatting — adoption agency)
    case 'a': {
      if (ctx.activeFormattingHas('a')) {
        ctx.parseError(token);
        ctx.adoptionAgencyAlgorithm(token);
        if (ctx.openElements.contains('a')) {
          ctx.popCurrentNode();
          ctx.activeFormattingRemove('a');
        }
      }
      ctx.reconstructActiveFormattingElements();
      const el = ctx.insertHTMLElement(token);
      ctx.activeFormattingPush(el);
      return;
    }

    // Formatting: b, big, code, em, font, i, s, small, strike,
    // strong, tt, u
    case 'b': case 'big': case 'code': case 'em': case 'font':
    case 'i': case 's': case 'small': case 'strike': case 'strong':
    case 'tt': case 'u': {
      ctx.reconstructActiveFormattingElements();
      const el = ctx.insertHTMLElement(token);
      ctx.activeFormattingPush(el);
      return;
    }

    // Nobr (formatting + scope check)
    case 'nobr': {
      ctx.reconstructActiveFormattingElements();
      if (ctx.isInScope('nobr')) {
        ctx.parseError(token);
        ctx.adoptionAgencyAlgorithm(token);
        ctx.reconstructActiveFormattingElements();
      }
      const el = ctx.insertHTMLElement(token);
      ctx.activeFormattingPush(el);
      return;
    }

    // Button
    case 'button': {
      if (ctx.isInScope('button')) {
        ctx.parseError(token);
        ctx.adoptionAgencyAlgorithm(token);
        ctx.reconstructActiveFormattingElements();
      }
      ctx.reconstructActiveFormattingElements();
      ctx.insertHTMLElement(token);
      ctx.framesetOk = false;
      return;
    }

    // Marquee / Object (formatting + special)
    case 'marquee': case 'object': {
      ctx.reconstructActiveFormattingElements();
      ctx.insertHTMLElement(token);
      ctx.formattingElements.pushMarker();
      ctx.framesetOk = false;
      return;
    }

    // Table
    case 'table': {
      if (ctx.isInButtonScope('p')) {
        ctx.closePElement();
      }
      ctx.insertHTMLElement(token);
      ctx.framesetOk = false;
      ctx.setMode(Im.IN_TABLE);
      return;
    }

    // Area, br, embed, hr, img, input, keygen, source, track, wbr
    case 'area': case 'br': case 'embed': case 'hr': case 'img': case 'input':
    case 'keygen': case 'source': case 'track': case 'wbr': {
      ctx.reconstructActiveFormattingElements();
      ctx.insertHTMLElement(token);
      if (tag === 'img') ctx.discoverResources(token);
      ctx.popCurrentNode();
      token.attrs?.delete('alt');
      if (tag === 'input') {
        const type = (token.attrs?.get('type') ?? '').toLowerCase();
        if (type !== 'hidden') ctx.framesetOk = false;
      } else {
        ctx.framesetOk = false;
      }
      return;
    }

    // Image
    case 'image': {
      ctx.reconstructActiveFormattingElements();
      token.tagName = 'img';
      ctx.insertHTMLElement(token);
      ctx.popCurrentNode();
      ctx.framesetOk = false;
      return;
    }

    // Textarea (RCDATA)
    case 'textarea': {
      ctx.reconstructActiveFormattingElements();
      ctx.insertHTMLElement(token);
      ctx.originalInsertionMode = ctx.insertionMode;
      ctx.setMode(Im.TEXT);
      ctx.pendingRawText = '';
      ctx.framesetOk = false;
      return;
    }

    // Title (RCDATA)
    case 'title': {
      ctx.handleRawTextElement(token);
      return;
    }

    // Noscript (scripting enabled)
    case 'noscript': {
      ctx.insertHTMLElement(token);
      ctx.originalInsertionMode = ctx.insertionMode;
      ctx.pendingRawText = '';
      ctx.setMode(Im.TEXT);
      return;
    }

    // Select
    case 'select': {
      ctx.reconstructActiveFormattingElements();
      ctx.insertHTMLElement(token);
      ctx.framesetOk = false;
      switch (ctx.insertionMode) {
        case Im.IN_TABLE: case Im.IN_CAPTION: case Im.IN_TABLE_BODY:
        case Im.IN_ROW: case Im.IN_CELL:
          ctx.setMode(Im.IN_SELECT_IN_TABLE); break;
        default:
          ctx.setMode(Im.IN_SELECT); break;
      }
      return;
    }

    // Optgroup / Option
    case 'optgroup': case 'option': {
      if (ctx.currentNode()?.tagName === 'option') {
        ctx.popCurrentNode();
      }
      ctx.reconstructActiveFormattingElements();
      ctx.insertHTMLElement(token);
      return;
    }

    // Rb, rtc, rp, rt, ruby
    case 'rb': case 'rtc': {
      ctx.reconstructActiveFormattingElements();
      if (ctx.isInScope('ruby')) {
        ctx.generateImpliedEndTags();
      }
      ctx.insertHTMLElement(token);
      return;
    }
    case 'rp': case 'rt': {
      ctx.reconstructActiveFormattingElements();
      if (ctx.isInScope('ruby')) {
        ctx.generateImpliedEndTags('rtc');
      }
      ctx.insertHTMLElement(token);
      return;
    }
    case 'ruby': {
      ctx.reconstructActiveFormattingElements();
      ctx.insertHTMLElement(token);
      return;
    }

    // Ins / Del
    case 'ins': case 'del': {
      ctx.reconstructActiveFormattingElements();
      ctx.insertHTMLElement(token);
      ctx.framesetOk = false;
      return;
    }

    // Iframe (not handled in-head)
    case 'iframe': {
      ctx.reconstructActiveFormattingElements();
      ctx.insertHTMLElement(token);
      ctx.originalInsertionMode = ctx.insertionMode;
      ctx.pendingRawText = '';
      ctx.setMode(Im.TEXT);
      return;
    }

    // Isindex
    case 'isindex': {
      ctx.parseError(token);
      if (ctx.formElement) return;
      ctx.reconstructActiveFormattingElements();
      const inputAttrs = token.attrs ?? new Map<string, string>();
      if (inputAttrs.get('action')) {
        const formAttrs = new Map<string, string>();
        formAttrs.set('action', inputAttrs.get('action')!);
        token.attrs = new Map([['name', 'isindex']]);
        ctx.insertHTMLElement({ ...token, tagName: 'form', attrs: formAttrs });
        // Insert HR, label, input
      }
      return;
    }

    // Video / Audio
    case 'video': case 'audio': {
      ctx.reconstructActiveFormattingElements();
      ctx.insertHTMLElement(token);
      ctx.discoverResources(token);
      return;
    }
  }

  ctx.parseError(token);
}

// ── In-body: end tags ────────────────────────────────────────────────────

function inBodyEndTag(ctx: TreeBuilderContext, token: Token): void {
  const tag = token.tagName!;

  switch (tag) {
    case 'body': {
      if (!ctx.isInScope('body')) {
        ctx.parseError(token);
        return;
      }
      ctx.framesetOk = false;
      ctx.setMode(Im.AFTER_BODY);
      return;
    }

    case 'html': {
      if (!ctx.isInScope('body')) {
        ctx.parseError(token);
        return;
      }
      if (!ctx.framesetOk) {
        ctx.parseError(token);
        return;
      }
      ctx.setMode(Im.AFTER_BODY);
      ctx.processToken(token);
      return;
    }

    case 'address': case 'article': case 'aside': case 'blockquote':
    case 'center': case 'details': case 'dialog': case 'dir':
    case 'div': case 'fieldset': case 'figcaption': case 'figure':
    case 'footer': case 'form': case 'header': case 'hgroup':
    case 'hr': case 'listing': case 'main': case 'menu': case 'nav':
    case 'ol': case 'p': case 'search': case 'section': case 'summary':
    case 'ul': {
      if (!ctx.isInScope(tag)) {
        ctx.parseError(token);
        return;
      }
      ctx.generateImpliedEndTags();
      if (ctx.currentNode()?.tagName === tag) {
        ctx.popCurrentNode();
      } else {
        let found = false;
        for (let i = ctx.openElements.length - 1; i >= 0; i--) {
          if (ctx.openElements.elementAt(i).tagName === tag) {
            while (ctx.openElements.length > i) {
              ctx.popCurrentNode();
            }
            found = true;
            break;
          }
        }
        if (!found) ctx.parseError(token);
      }
      return;
    }

    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      if (!ctx.isInScope(tag)) {
        ctx.parseError(token);
        return;
      }
      ctx.generateImpliedEndTags();
      if (ctx.currentNode()?.tagName !== tag) {
        ctx.parseError(token);
      }
      let found = false;
      for (let i = ctx.openElements.length - 1; i >= 0; i--) {
        const el = ctx.openElements.elementAt(i);
        if (el.tagName === tag) {
          while (ctx.openElements.length > i) {
            ctx.popCurrentNode();
          }
          found = true;
          break;
        }
        if (!HEADING_ELEMENTS.has(el.tagName)) break;
      }
      if (!found) ctx.parseError(token);
      return;
    }

    case 'dd': case 'dt': case 'li': {
      if (!ctx.isInListItemScope(tag)) {
        ctx.parseError(token);
        return;
      }
      ctx.generateImpliedEndTags(tag);
      if (ctx.currentNode()?.tagName !== tag) {
        ctx.parseError(token);
      }
      for (let i = ctx.openElements.length - 1; i >= 0; i--) {
        if (ctx.openElements.elementAt(i).tagName === tag) {
          while (ctx.openElements.length > i) {
            ctx.popCurrentNode();
          }
          break;
        }
      }
      return;
    }

    case 'applet': case 'marquee': case 'object': {
      if (!ctx.isInScope(tag)) {
        ctx.parseError(token);
        return;
      }
      ctx.generateImpliedEndTags();
      ctx.popCurrentNode();
      ctx.activeFormattingClearUpToMarker();
      ctx.framesetOk = false;
      return;
    }

    case 'rb': case 'rtc': {
      if (!ctx.isInScope(tag)) {
        ctx.parseError(token);
        return;
      }
      ctx.generateImpliedEndTags();
      if (ctx.currentNode()?.tagName === tag) {
        ctx.popCurrentNode();
      }
      return;
    }

    case 'rp': case 'rt': {
      if (!ctx.isInScope('ruby')) {
        ctx.parseError(token);
        return;
      }
      ctx.generateImpliedEndTags('rtc');
      if (ctx.currentNode()?.tagName === tag) {
        ctx.popCurrentNode();
      }
      return;
    }

    case 'caption': case 'col': case 'colgroup': case 'frame':
    case 'head': case 'tbody': case 'td': case 'tfoot': case 'th':
    case 'thead': case 'tr': {
      ctx.parseError(token);
      return;
    }

    case 'table': {
      if (!ctx.isInTableScope('table')) {
        ctx.parseError(token);
        return;
      }
      ctx.popCurrentNode();
      ctx.resetInsertionMode();
      return;
    }

    case 'template': {
      if (ctx.currentNode()?.tagName === 'template') {
        ctx.processInHeadToken(token);
        return;
      }
      break;
    }

    // Formatting end tags (adoption agency)
    case 'a': case 'b': case 'big': case 'code': case 'em':
    case 'font': case 'i': case 'nobr': case 's': case 'small':
    case 'strike': case 'strong': case 'tt': case 'u': {
      ctx.adoptionAgencyAlgorithm(token);
      return;
    }

    case 'area': case 'base': case 'basefont': case 'bgsound':
    case 'br': case 'embed': case 'hr': case 'img': case 'input':
    case 'keygen': case 'link': case 'meta': case 'param':
    case 'source': case 'track': case 'wbr': {
      ctx.parseError(token);
      return;
    }

    case 'select': case 'option': case 'optgroup': {
      if (ctx.isInScope(tag)) {
        ctx.popCurrentNode();
      } else {
        ctx.parseError(token);
      }
      return;
    }
  }

  ctx.parseError(token);
}
