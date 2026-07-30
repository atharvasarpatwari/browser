import type { Token } from '../../html5-tokenizer';
import { Im } from '../constants';
import type { TreeBuilderContext } from './types';

/**
 * §13.2.6.9 — "in table" insertion mode
 */
export function handleInTable(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'text':
      ctx.pendingRawText = token.data ?? '';
      ctx.originalInsertionMode = ctx.insertionMode;
      ctx.setMode(Im.IN_TABLE_TEXT);
      return;
    case 'comment':
      ctx.insertComment(token);
      return;
    case 'doctype':
      ctx.parseError(token);
      return;
    case 'open':
      switch (token.tagName) {
        case 'caption':
        case 'colgroup':
        case 'col':
          ctx.popCurrentNodeUntil('table');
          ctx.setMode(Im.IN_TABLE_BODY);
          ctx.processToken(token);
          return;
        case 'tbody':
        case 'tfoot':
        case 'thead':
          ctx.setMode(Im.IN_TABLE_BODY);
          ctx.processToken(token);
          return;
        case 'tr':
          ctx.setMode(Im.IN_TABLE_BODY);
          ctx.processToken(token);
          return;
        case 'td': case 'th':
          ctx.setMode(Im.IN_ROW);
          ctx.processToken(token);
          return;
        case 'table':
          ctx.parseError(token);
          ctx.popCurrentNodeUntil('table');
          ctx.resetInsertionMode();
          ctx.processToken(token);
          return;
        case 'input':
          if ((token.attrs?.get('type') ?? '').toLowerCase() !== 'hidden') {
            ctx.parseError(token);
            ctx.reprocessInBody(token);
            return;
          }
          ctx.parseError(token);
          ctx.insertHTMLElement(token);
          ctx.popCurrentNode();
          return;
        case 'form':
          ctx.parseError(token);
          if (ctx.formElement || ctx.templateInsertionModes.length > 0) return;
          {
            const el = ctx.insertHTMLElement(token);
            ctx.formElement = el;
            ctx.popCurrentNode();
          }
          return;
        default: {
          ctx.parseError(token);
          if (!ctx.isInTableScope('table')) return;
          ctx.insertHTMLElement(token);
          return;
        }
      }
    case 'close':
      if (token.tagName === 'table') {
        if (!ctx.isInTableScope('table')) {
          ctx.parseError(token);
          return;
        }
        ctx.popCurrentNodeUntil('table');
        ctx.resetInsertionMode();
        return;
      }
      ctx.parseError(token);
      return;
    case 'eof':
      ctx.handleEofInBody();
      return;
  }
  ctx.reprocessInBody(token);
}

/**
 * §13.2.6.11 — "in caption" insertion mode
 */
export function handleInCaption(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'open':
      if (['caption', 'col', 'colgroup', 'tbody', 'tfoot', 'thead', 'tr', 'td', 'th'].includes(token.tagName!)) {
        if (ctx.isInTableScope('caption')) {
          ctx.generateImpliedEndTags();
          ctx.popCurrentNode();
          ctx.activeFormattingClearUpToMarker();
          ctx.setMode(Im.IN_TABLE);
          ctx.processToken(token);
        }
        return;
      }
      break;
    case 'close':
      if (token.tagName === 'caption') {
        if (!ctx.isInTableScope('caption')) {
          ctx.parseError(token);
          return;
        }
        ctx.generateImpliedEndTags();
        ctx.popCurrentNode();
        ctx.activeFormattingClearUpToMarker();
        ctx.setMode(Im.IN_TABLE);
        return;
      }
      if (token.tagName === 'table') {
        ctx.parseError(token);
        if (ctx.isInTableScope('caption')) {
          ctx.generateImpliedEndTags();
          ctx.popCurrentNode();
          ctx.activeFormattingClearUpToMarker();
          ctx.setMode(Im.IN_TABLE);
          ctx.processToken(token);
        }
        return;
      }
      if (['body', 'col', 'colgroup', 'html', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr'].includes(token.tagName!)) {
        ctx.parseError(token);
        return;
      }
      break;
  }
  ctx.reprocessInBody(token);
}

/**
 * §13.2.6.12 — "in column group" insertion mode
 */
export function handleInColumnGroup(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'text':
      if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) {
        ctx.insertText(token);
        return;
      }
      break;
    case 'comment':
      ctx.insertComment(token);
      return;
    case 'doctype':
      ctx.parseError(token);
      return;
    case 'open':
      if (token.tagName === 'col') {
        ctx.insertHTMLElement(token);
        ctx.popCurrentNode();
        return;
      }
      break;
    case 'close':
      if (token.tagName === 'colgroup') {
        if (ctx.currentNode()?.tagName !== 'colgroup') {
          ctx.parseError(token);
          return;
        }
        ctx.popCurrentNode();
        ctx.setMode(Im.IN_TABLE);
        return;
      }
      if (token.tagName === 'col') {
        ctx.parseError(token);
        return;
      }
      break;
    case 'eof':
      break;
  }
  if (ctx.currentNode()?.tagName === 'colgroup') {
    ctx.popCurrentNode();
  }
  ctx.setMode(Im.IN_TABLE);
  ctx.processToken(token);
}

/**
 * §13.2.6.13 — "in table body" insertion mode
 */
export function handleInTableBody(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'open':
      switch (token.tagName) {
        case 'tr':
          ctx.generateImpliedEndTags();
          // Auto-insert <tbody> if no table body element exists in scope
          if (!ctx.isInTableScope('tbody') && !ctx.isInTableScope('thead') && !ctx.isInTableScope('tfoot')) {
            const tbodyToken: Token = { kind: 'open', tagName: 'tbody', attrs: new Map(), offset: token.offset };
            ctx.insertHTMLElement(tbodyToken);
          }
          ctx.insertHTMLElement(token);
          ctx.setMode(Im.IN_ROW);
          return;
        case 'th': case 'td':
          ctx.parseError(token);
          ctx.generateImpliedEndTags();
          // Auto-insert <tbody> if no table body element exists in scope
          if (!ctx.isInTableScope('tbody') && !ctx.isInTableScope('thead') && !ctx.isInTableScope('tfoot')) {
            const tbodyToken: Token = { kind: 'open', tagName: 'tbody', attrs: new Map(), offset: token.offset };
            ctx.insertHTMLElement(tbodyToken);
          }
          {
            const trToken: Token = { ...token, tagName: 'tr' };
            ctx.processToken(trToken);
          }
          ctx.processToken(token);
          return;
        case 'caption': case 'col': case 'colgroup':
        case 'tbody': case 'tfoot': case 'thead':
          if (!ctx.isInTableScope(token.tagName!)) {
            // Not in scope: this is the initial insertion (reprocessed from handleInTable).
            // Insert the element directly into the table structure.
            ctx.insertHTMLElement(token);
            return;
          }
          ctx.generateImpliedEndTags();
          ctx.popCurrentNode();
          ctx.setMode(Im.IN_TABLE);
          ctx.processToken(token);
          return;
      }
      break;
    case 'close':
      if (token.tagName === 'tbody' || token.tagName === 'thead' || token.tagName === 'tfoot') {
        if (!ctx.isInTableScope(token.tagName!)) {
          ctx.parseError(token);
          return;
        }
        ctx.generateImpliedEndTags();
        ctx.popCurrentNode();
        ctx.setMode(Im.IN_TABLE);
        return;
      }
      if (token.tagName === 'table') {
        if (!ctx.isInTableScope('tbody') && !ctx.isInTableScope('thead') && !ctx.isInTableScope('tfoot')) {
          ctx.parseError(token);
          return;
        }
        ctx.generateImpliedEndTags();
        ctx.popCurrentNode();
        ctx.setMode(Im.IN_TABLE);
        ctx.processToken(token);
        return;
      }
      if (['body', 'caption', 'col', 'colgroup', 'html', 'td', 'th', 'tr'].includes(token.tagName!)) {
        ctx.parseError(token);
        return;
      }
      break;
  }
  ctx.reprocessInTable(token);
}

/**
 * §13.2.6.14 — "in row" insertion mode
 */
export function handleInRow(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'open':
      switch (token.tagName) {
        case 'th': case 'td':
          ctx.generateImpliedEndTags();
          ctx.insertHTMLElement(token);
          ctx.setMode(Im.IN_CELL);
          ctx.activeFormattingClearUpToMarker();
          return;
        case 'caption': case 'col': case 'colgroup':
        case 'tbody': case 'tfoot': case 'thead': case 'table':
          if (!ctx.isInTableScope(token.tagName!)) {
            ctx.parseError(token);
            return;
          }
          ctx.generateImpliedEndTags();
          ctx.popCurrentNode();
          ctx.setMode(Im.IN_TABLE_BODY);
          ctx.processToken(token);
          return;
      }
      break;
    case 'close':
      if (token.tagName === 'tr') {
        if (!ctx.isInTableScope('tr')) {
          ctx.parseError(token);
          return;
        }
        ctx.generateImpliedEndTags();
        ctx.popCurrentNode();
        ctx.setMode(Im.IN_TABLE_BODY);
        return;
      }
      if (token.tagName === 'table') {
        if (!ctx.isInTableScope('tr')) {
          ctx.parseError(token);
          return;
        }
        ctx.generateImpliedEndTags();
        ctx.popCurrentNode();
        ctx.setMode(Im.IN_TABLE_BODY);
        ctx.processToken(token);
        return;
      }
      if (token.tagName === 'tbody' || token.tagName === 'tfoot' || token.tagName === 'thead') {
        if (!ctx.isInTableScope(token.tagName!)) {
          ctx.parseError(token);
          return;
        }
        ctx.generateImpliedEndTags();
        ctx.popCurrentNode();
        ctx.setMode(Im.IN_TABLE_BODY);
        ctx.processToken(token);
        return;
      }
      if (['body', 'caption', 'col', 'colgroup', 'html', 'td', 'th'].includes(token.tagName!)) {
        ctx.parseError(token);
        return;
      }
      break;
  }
  ctx.reprocessInTable(token);
}

/**
 * §13.2.6.15 — "in cell" insertion mode
 */
export function handleInCell(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'open':
      if (['caption', 'col', 'colgroup', 'tbody', 'tfoot', 'thead', 'tr', 'td', 'th'].includes(token.tagName!)) {
        if (ctx.isInTableScope('td') || ctx.isInTableScope('th')) {
          ctx.closeTableCellElement();
          ctx.processToken(token);
        } else {
          ctx.parseError(token);
        }
        return;
      }
      break;
    case 'close':
      if (token.tagName === 'td' || token.tagName === 'th') {
        if (!ctx.isInTableScope(token.tagName!)) {
          ctx.parseError(token);
          return;
        }
        ctx.closeTableCellElement();
        ctx.processToken(token);
        return;
      }
      if (token.tagName === 'table' || token.tagName === 'tbody' ||
          token.tagName === 'tfoot' || token.tagName === 'thead' ||
          token.tagName === 'tr') {
        if (!ctx.isInTableScope(token.tagName!)) {
          ctx.parseError(token);
          return;
        }
        ctx.closeTableCellElement();
        ctx.processToken(token);
        return;
      }
      if (['body', 'caption', 'col', 'colgroup', 'html'].includes(token.tagName!)) {
        ctx.parseError(token);
        return;
      }
      break;
  }
  ctx.reprocessInBody(token);
}
