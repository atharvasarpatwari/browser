import type { Token } from '../../html5-tokenizer';
import { Im } from '../constants';
import type { TreeBuilderContext } from './types';

/**
 * §13.2.6.18 — "in template" insertion mode
 */
export function handleInTemplate(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'open':
      switch (token.tagName) {
        case 'base': case 'basefont': case 'bgsound': case 'link':
        case 'meta': case 'noscript': case 'script': case 'style':
        case 'template': case 'title':
          ctx.processInHeadToken(token);
          return;
        case 'caption':
        case 'colgroup':
        case 'col':
          ctx.popCurrentNodeUntil('template');
          ctx.templateInsertionModes.push(Im.IN_TABLE);
          ctx.setMode(Im.IN_TABLE);
          ctx.processToken(token);
          return;
        case 'tbody':
        case 'tfoot':
        case 'thead':
          ctx.popCurrentNodeUntil('template');
          ctx.templateInsertionModes.push(Im.IN_TABLE_BODY);
          ctx.setMode(Im.IN_TABLE_BODY);
          ctx.processToken(token);
          return;
        case 'td': case 'th':
          ctx.popCurrentNodeUntil('template');
          ctx.templateInsertionModes.push(Im.IN_ROW);
          ctx.setMode(Im.IN_ROW);
          ctx.processToken(token);
          return;
        case 'tr':
          ctx.popCurrentNodeUntil('template');
          ctx.templateInsertionModes.push(Im.IN_TABLE_BODY);
          ctx.setMode(Im.IN_TABLE_BODY);
          ctx.processToken(token);
          return;
        case 'table':
          ctx.popCurrentNodeUntil('template');
          ctx.templateInsertionModes.push(Im.IN_TABLE);
          ctx.setMode(Im.IN_TABLE);
          ctx.processToken(token);
          return;
        default:
          ctx.popCurrentNodeUntil('template');
          ctx.templateInsertionModes.push(Im.IN_BODY);
          ctx.setMode(Im.IN_BODY);
          ctx.processToken(token);
          return;
      }
    case 'close':
      if (token.tagName === 'template') {
        if (!ctx.isInTemplateScope('template')) {
          ctx.parseError(token);
          return;
        }
        ctx.generateImpliedEndTagsThoroughly();
        ctx.popCurrentNodeUntil('template');
        ctx.templateInsertionModes.pop();
        ctx.resetInsertionMode();
        return;
      }
      ctx.parseError(token);
      return;
    default:
      break;
  }
  // Any other: if not in template scope, error; then pop template, pop mode, reprocess
  if (!ctx.isInTemplateScope('template')) {
    ctx.parseError(token);
    return;
  }
  ctx.generateImpliedEndTagsThoroughly();
  ctx.popCurrentNodeUntil('template');
  ctx.templateInsertionModes.pop();
  ctx.resetInsertionMode();
  ctx.processToken(token);
}
