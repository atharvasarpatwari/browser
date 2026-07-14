import type { Token } from '../../html5-tokenizer';
import { Im } from '../constants';
import type { TreeBuilderContext } from './types';

/**
 * §13.2.6.4 — "in head" insertion mode
 */
export function handleInHead(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'comment':
      ctx.insertComment(token);
      return;
    case 'doctype':
      ctx.parseError(token);
      return;
    case 'open':
      switch (token.tagName) {
        case 'html':
          ctx.processInBodyToken(token);
          return;
        case 'base': case 'basefont': case 'bgsound': case 'link': case 'meta':
          ctx.insertHTMLElement(token);
          ctx.popCurrentNode();
          if (token.tagName === 'meta') ctx.checkMetaCharset(token);
          ctx.discoverResources(token);
          return;
        case 'title':
          ctx.handleRawTextElement(token);
          return;
        case 'noscript':
          if (!ctx.scriptingEnabled) {
            ctx.handleRawTextElement(token);
          } else {
            ctx.insertHTMLElement(token);
            ctx.originalInsertionMode = ctx.insertionMode;
            ctx.setMode(Im.TEXT);
          }
          return;
        case 'script':
          ctx.insertHTMLElement(token);
          ctx.originalInsertionMode = ctx.insertionMode;
          ctx.setMode(Im.TEXT);
          ctx.discoverResources(token);
          return;
        case 'style': case 'xmp': case 'iframe': case 'noembed': case 'noframes':
          ctx.handleRawTextElement(token);
          return;
        case 'template':
          ctx.insertHTMLElement(token);
          ctx.formattingElements.pushMarker();
          ctx.framesetOk = false;
          ctx.setMode(Im.IN_TEMPLATE);
          ctx.templateInsertionModes.push(Im.IN_TEMPLATE);
          return;
        case 'head':
          ctx.parseError(token);
          return;
        default:
          break;
      }
      break;
    case 'close':
      if (token.tagName === 'head') {
        ctx.popCurrentNode();
        ctx.setMode(Im.AFTER_HEAD);
        return;
      }
      if (token.tagName === 'body' || token.tagName === 'html' || token.tagName === 'br') {
        ctx.parseError(token);
        ctx.popCurrentNode();
        ctx.setMode(Im.AFTER_HEAD);
        ctx.processToken(token);
        return;
      }
      if (token.tagName === 'template') {
        if (ctx.isInTemplateScope('template')) {
          ctx.generateImpliedEndTagsThoroughly();
          if (ctx.currentNode()?.tagName === 'template') {
            ctx.popCurrentNode();
          }
          ctx.activeFormattingClearUpToMarker();
          ctx.templateInsertionModes.pop();
          ctx.resetInsertionMode();
        }
        return;
      }
      ctx.parseError(token);
      return;
    case 'eof':
      ctx.popCurrentNode();
      ctx.setMode(Im.AFTER_HEAD);
      ctx.processToken(token);
      return;
  }

  ctx.parseError(token);
  ctx.popCurrentNode();
  ctx.setMode(Im.AFTER_HEAD);
  ctx.processToken(token);
}

/**
 * §13.2.6.5 — "in head noscript" insertion mode
 */
export function handleInHeadNoscript(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'doctype':
      ctx.parseError(token);
      return;
    case 'open':
      if (token.tagName === 'html') {
        ctx.processInBodyToken(token);
        return;
      }
      break;
    case 'close':
      if (token.tagName === 'noscript' || token.tagName === 'br') {
        ctx.parseError(token);
        ctx.popCurrentNode();
        ctx.setMode(Im.IN_HEAD);
        return;
      }
      break;
    case 'text':
      if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) break;
      break;
    case 'comment':
      ctx.insertComment(token);
      return;
  }
  ctx.parseError(token);
  ctx.popCurrentNode();
  ctx.setMode(Im.IN_HEAD);
  ctx.processToken(token);
}

/**
 * §13.2.6.6 — "after head" insertion mode
 */
export function handleAfterHead(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'text':
      if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) break;
      ctx.parseError(token);
      // Insert <body> element
      {
        const bodyToken: Token = { ...token, tagName: 'body' };
        ctx.insertHTMLElement(bodyToken);
        ctx.bodyElement = ctx.currentNode();
      }
      ctx.framesetOk = false;
      ctx.setMode(Im.IN_BODY);
      ctx.processToken(token);
      return;
    case 'comment':
      ctx.insertComment(token);
      return;
    case 'doctype':
      ctx.parseError(token);
      return;
    case 'open':
      if (token.tagName === 'html') {
        ctx.processInBodyToken(token);
        return;
      }
      if (token.tagName === 'body') {
        {
          const bodyToken: Token = { ...token, tagName: 'body' };
          ctx.insertHTMLElement(bodyToken);
          ctx.bodyElement = ctx.currentNode();
        }
        ctx.framesetOk = false;
        ctx.setMode(Im.IN_BODY);
        return;
      }
      if (token.tagName === 'frameset') {
        ctx.setMode(Im.IN_FRAMESET);
        return;
      }
      if (['base', 'basefont', 'bgsound', 'link', 'meta', 'noscript', 'script', 'style', 'template', 'title'].includes(token.tagName!)) {
        ctx.parseError(token);
        const saved = ctx.headElement;
        ctx.popCurrentNode();
        ctx.setMode(Im.IN_HEAD);
        ctx.processToken(token);
        // template processing already done
        ctx.headElement = saved;
        return;
      }
      break;
    case 'close':
      if (token.tagName === 'head') {
        ctx.popCurrentNode();
        ctx.setMode(Im.IN_BODY);
        return;
      }
      break;
    case 'eof':
      break;
  }
  // Any other: insert <body> and reprocess
  {
    const bodyToken: Token = { tagName: 'body', kind: 'open', attrs: new Map(), offset: token.offset };
    ctx.insertHTMLElement(bodyToken);
    ctx.bodyElement = ctx.currentNode();
  }
  ctx.framesetOk = false;
  ctx.setMode(Im.IN_BODY);
  ctx.processToken(token);
}
