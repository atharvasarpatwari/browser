import type { Token } from '../../html5-tokenizer';
import { Im } from '../constants';
import type { TreeBuilderContext } from './types';

import { handleInitial } from './initial';
import { handleBeforeHtml } from './before-html';
import { handleBeforeHead } from './before-head';
import { handleInHead, handleInHeadNoscript, handleAfterHead } from './head';
import { handleInBody } from './body';
import { handleText, handleInTableText } from './text';
import {
  handleInTable,
  handleInCaption,
  handleInColumnGroup,
  handleInTableBody,
  handleInRow,
  handleInCell,
} from './table';
import { handleInSelect, handleInSelectInTable } from './select';
import { handleInTemplate } from './template';
import {
  handleAfterBody,
  handleInFrameset,
  handleAfterFrameset,
  handleAfterAfterBody,
  handleAfterAfterFrameset,
} from './after';

export type { TreeBuilderContext } from './types';

export function dispatchToken(ctx: TreeBuilderContext, token: Token): void {
  switch (ctx.insertionMode) {
    case Im.INITIAL:              return handleInitial(ctx, token);
    case Im.BEFORE_HTML:          return handleBeforeHtml(ctx, token);
    case Im.BEFORE_HEAD:          return handleBeforeHead(ctx, token);
    case Im.IN_HEAD:              return handleInHead(ctx, token);
    case Im.IN_HEAD_NOSCRIPT:     return handleInHeadNoscript(ctx, token);
    case Im.AFTER_HEAD:           return handleAfterHead(ctx, token);
    case Im.IN_BODY:              return handleInBody(ctx, token);
    case Im.TEXT:                 return handleText(ctx, token);
    case Im.IN_TABLE:             return handleInTable(ctx, token);
    case Im.IN_TABLE_TEXT:        return handleInTableText(ctx, token);
    case Im.IN_CAPTION:           return handleInCaption(ctx, token);
    case Im.IN_COLUMN_GROUP:      return handleInColumnGroup(ctx, token);
    case Im.IN_TABLE_BODY:        return handleInTableBody(ctx, token);
    case Im.IN_ROW:               return handleInRow(ctx, token);
    case Im.IN_CELL:              return handleInCell(ctx, token);
    case Im.IN_SELECT:            return handleInSelect(ctx, token);
    case Im.IN_SELECT_IN_TABLE:   return handleInSelectInTable(ctx, token);
    case Im.IN_TEMPLATE:          return handleInTemplate(ctx, token);
    case Im.AFTER_BODY:           return handleAfterBody(ctx, token);
    case Im.IN_FRAMESET:          return handleInFrameset(ctx, token);
    case Im.AFTER_FRAMESET:       return handleAfterFrameset(ctx, token);
    case Im.AFTER_AFTER_BODY:     return handleAfterAfterBody(ctx, token);
    case Im.AFTER_AFTER_FRAMESET: return handleAfterAfterFrameset(ctx, token);
  }
}
