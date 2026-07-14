import type { Token } from '../../html5-tokenizer';
import { Im } from '../constants';
import type { TreeBuilderContext } from './types';

/**
 * §13.2.6.16 — "in select" insertion mode
 */
export function handleInSelect(ctx: TreeBuilderContext, token: Token): void {
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
      switch (token.tagName) {
        case 'html':
          ctx.parseError(token);
          ctx.processInBodyToken(token);
          return;
        case 'option':
          if (ctx.currentNode()?.tagName === 'option') {
            ctx.popCurrentNode();
          }
          ctx.insertHTMLElement(token);
          return;
        case 'optgroup':
          if (ctx.currentNode()?.tagName === 'option') {
            ctx.popCurrentNode();
          }
          if (ctx.currentNode()?.tagName === 'optgroup') {
            ctx.popCurrentNode();
          }
          ctx.insertHTMLElement(token);
          return;
        case 'select':
          ctx.parseError(token);
          if (!ctx.isInSelectScope('select')) return;
          ctx.popCurrentNodeUntil('select');
          ctx.resetInsertionMode();
          return;
        case 'textarea': case 'input': case 'keygen': case 'script':
          if (!ctx.isInSelectScope('select')) {
            ctx.parseError(token);
            return;
          }
          ctx.generateImpliedEndTags();
          if (ctx.currentNode()?.tagName !== 'select') {
            ctx.parseError(token);
            return;
          }
          ctx.popCurrentNodeUntil('select');
          ctx.resetInsertionMode();
          ctx.processToken(token);
          return;
      }
      ctx.parseError(token);
      return;
    case 'close':
      if (token.tagName === 'select') {
        if (!ctx.isInSelectScope('select')) {
          ctx.parseError(token);
          return;
        }
        ctx.popCurrentNodeUntil('select');
        ctx.resetInsertionMode();
        return;
      }
      ctx.parseError(token);
      return;
    case 'eof':
      break;
  }
}

/**
 * §13.2.6.17 — "in select in table" insertion mode
 */
export function handleInSelectInTable(ctx: TreeBuilderContext, token: Token): void {
  if (token.kind === 'open') {
    if (['table', 'tbody', 'tfoot', 'thead', 'tr', 'td', 'th'].includes(token.tagName!)) {
      ctx.parseError(token);
      if (ctx.isInSelectScope('select')) {
        ctx.popCurrentNodeUntil('select');
        ctx.resetInsertionMode();
        ctx.processToken(token);
      }
      return;
    }
  }
  if (token.kind === 'close') {
    if (['table', 'tbody', 'tfoot', 'thead', 'tr', 'td', 'th'].includes(token.tagName!)) {
      ctx.parseError(token);
      if (ctx.isInSelectScope('select')) {
        ctx.popCurrentNodeUntil('select');
        ctx.resetInsertionMode();
        ctx.processToken(token);
      }
      return;
    }
  }
  handleInSelect(ctx, token);
}
