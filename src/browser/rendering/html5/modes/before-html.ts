import type { Token } from '../../html5-tokenizer';
import { Im } from '../constants';
import type { TreeBuilderContext } from './types';

/**
 * §13.2.6.2 — "before html" insertion mode
 */
export function handleBeforeHtml(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'doctype':
      ctx.parseError(token);
      break;
    case 'comment':
      ctx.insertComment(token);
      break;
    case 'text':
      if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) break;
      ctx.parseError(token);
      ctx.setMode(Im.BEFORE_HEAD);
      ctx.processToken(token);
      break;
    case 'open':
      if (token.tagName === 'html') {
        ctx.insertHTMLElement(token);
        ctx.htmlElement = ctx.currentNode();
        ctx.setMode(Im.BEFORE_HEAD);
        ctx.processToken(token);
        return;
      }
      ctx.setMode(Im.BEFORE_HEAD);
      ctx.processToken(token);
      break;
    case 'close':
      ctx.parseError(token);
      break;
    case 'eof':
      ctx.parseError(token);
      ctx.setMode(Im.BEFORE_HEAD);
      ctx.processToken(token);
      break;
    default:
      ctx.setMode(Im.BEFORE_HEAD);
      ctx.processToken(token);
      break;
  }
}
