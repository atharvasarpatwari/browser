import type { Token } from '../../html5-tokenizer';
import { Im, RAW_TEXT_ELEMENTS } from '../constants';
import type { TreeBuilderContext } from './types';

/**
 * §13.2.6.8 — "text" insertion mode
 */
export function handleText(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'text':
      ctx.pendingRawText += token.data ?? '';
      return;
    case 'close': {
      const cn = ctx.currentNode();
      if (cn && RAW_TEXT_ELEMENTS.has(token.tagName!)) {
        (cn as any).rawContent = ctx.pendingRawText;
      }
      ctx.popCurrentNode();
      ctx.setMode(ctx.originalInsertionMode);
      return;
    }
    default:
      ctx.parseError(token);
      ctx.popCurrentNode();
      ctx.setMode(ctx.originalInsertionMode);
      ctx.processToken(token);
      return;
  }
}

/**
 * §13.2.6.10 — "in table text" insertion mode
 */
export function handleInTableText(ctx: TreeBuilderContext, token: Token): void {
  if (token.kind === 'text') {
    ctx.pendingRawText += token.data ?? '';
    return;
  }
  if (ctx.pendingRawText) {
    const textToken: Token = { kind: 'text', data: ctx.pendingRawText, offset: token.offset };
    ctx.pendingRawText = '';
    ctx.setMode(ctx.originalInsertionMode);
    ctx.insertText(textToken);
    ctx.processToken(token);
    return;
  }
  ctx.setMode(ctx.originalInsertionMode);
  ctx.processToken(token);
}
