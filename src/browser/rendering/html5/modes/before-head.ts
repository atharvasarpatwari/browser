import type { Token } from '../../html5-tokenizer';
import { Im } from '../constants';
import type { TreeBuilderContext } from './types';

/**
 * §13.2.6.3 — "before head" insertion mode
 */
export function handleBeforeHead(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'text':
      if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) break;
      ctx.parseError(token);
      {
        const headToken: Token = { tagName: 'head', kind: 'open', attrs: new Map(), offset: token.offset };
        ctx.insertHTMLElement(headToken);
        ctx.headElement = ctx.currentNode();
      }
      ctx.setMode(Im.IN_HEAD);
      ctx.processToken(token);
      break;
    case 'comment':
      ctx.insertComment(token);
      break;
    case 'doctype':
      ctx.parseError(token);
      break;
    case 'open':
      if (token.tagName === 'head') {
        ctx.insertHTMLElement(token);
        ctx.headElement = ctx.currentNode();
        ctx.setMode(Im.IN_HEAD);
        return;
      }
      // Any other start tag: insert <head> element, then reprocess
      {
        const headToken: Token = { ...token, tagName: 'head' };
        ctx.insertHTMLElement(headToken);
        ctx.headElement = ctx.currentNode();
      }
      ctx.setMode(Im.IN_HEAD);
      ctx.processToken(token);
      break;
    case 'close':
      ctx.setMode(Im.IN_HEAD);
      ctx.processToken(token);
      break;
    case 'eof':
      {
        const headToken: Token = { tagName: 'head', kind: 'open', attrs: new Map(), offset: token.offset };
        ctx.insertHTMLElement(headToken);
        ctx.headElement = ctx.currentNode();
      }
      ctx.setMode(Im.IN_HEAD);
      ctx.processToken(token);
      break;
    default:
      {
        const headToken: Token = { tagName: 'head', kind: 'open', attrs: new Map(), offset: token.offset };
        ctx.insertHTMLElement(headToken);
        ctx.headElement = ctx.currentNode();
      }
      ctx.setMode(Im.IN_HEAD);
      ctx.processToken(token);
      break;
  }
}
