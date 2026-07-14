import type { Token } from '../../html5-tokenizer';
import { Im } from '../constants';
import type { TreeBuilderContext } from './types';

/**
 * §13.2.6.1 — "initial" insertion mode
 */
export function handleInitial(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'text':
      if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) break;
      ctx.parseError(token);
      ctx.setMode(Im.BEFORE_HTML);
      ctx.processToken(token);
      break;
    case 'comment':
      ctx.insertComment(token);
      break;
    case 'doctype':
      ctx.insertDoctype(token);
      ctx.setMode(Im.BEFORE_HTML);
      break;
    default:
      ctx.parseError(token);
      ctx.setMode(Im.BEFORE_HTML);
      ctx.processToken(token);
      break;
  }
}
