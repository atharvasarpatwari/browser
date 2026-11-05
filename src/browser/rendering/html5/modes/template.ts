import type { Token } from '../../html5-tokenizer';
import { Im } from '../constants';
import type { TreeBuilderContext } from './types';

/**
 * §13.2.6.4.18 — "in template" insertion mode.
 *
 * A start tag only switches the template insertion mode (to "in table", "in body"…) and is
 * reprocessed; text and comments use the "in body" rules. The template element stays open until
 * its end tag or the end of the file. Every start tag and text token used to pop the template off
 * the stack first, so a template's content became its following siblings and was rendered: every
 * `<template>` on a page (MDN's declarative shadow DOM included) showed its markup.
 */
export function handleInTemplate(ctx: TreeBuilderContext, token: Token): void {
  const switchTo = (mode: Im): void => {
    ctx.templateInsertionModes.pop();
    ctx.templateInsertionModes.push(mode);
    ctx.setMode(mode);
    ctx.processToken(token);
  };
  switch (token.kind) {
    case 'text': case 'comment': case 'doctype': case 'cdata': case 'pi':
      ctx.processInBodyToken(token);
      return;
    case 'open': case 'selfclose':
      switch (token.tagName) {
        case 'base': case 'basefont': case 'bgsound': case 'link':
        case 'meta': case 'noframes': case 'script': case 'style':
        case 'template': case 'title':
          ctx.processInHeadToken(token);
          return;
        case 'caption': case 'colgroup': case 'tbody': case 'tfoot': case 'thead':
          switchTo(Im.IN_TABLE);
          return;
        case 'col':
          switchTo(Im.IN_COLUMN_GROUP);
          return;
        case 'tr':
          switchTo(Im.IN_TABLE_BODY);
          return;
        case 'td': case 'th':
          switchTo(Im.IN_ROW);
          return;
        default:
          switchTo(Im.IN_BODY);
          return;
      }
    case 'close':
      if (token.tagName === 'template') {
        ctx.processInHeadToken(token);
        return;
      }
      ctx.parseError(token);
      return;
    case 'eof':
    default:
      if (!ctx.isInTemplateScope('template')) return; // stop parsing (EOF)
      ctx.parseError(token);
      ctx.popCurrentNodeUntil('template');
      ctx.formattingElements.clearUpToMarker();
      ctx.templateInsertionModes.pop();
      ctx.resetInsertionMode();
      ctx.processToken(token);
  }
}
