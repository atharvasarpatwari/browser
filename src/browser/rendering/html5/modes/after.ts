import type { Token } from '../../html5-tokenizer';
import { Im } from '../constants';
import type { TreeBuilderContext } from './types';

/**
 * §13.2.6.19 — "after body" insertion mode
 */
export function handleAfterBody(ctx: TreeBuilderContext, token: Token): void {
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
      if (token.tagName === 'html') {
        ctx.parseError(token);
        ctx.processInBodyToken(token);
        return;
      }
      break;
    case 'close':
      if (token.tagName === 'html') {
        ctx.setMode(Im.AFTER_AFTER_BODY);
        return;
      }
      break;
    case 'eof':
      break;
  }
  ctx.setMode(Im.AFTER_AFTER_BODY);
  ctx.processToken(token);
}

/**
 * §13.2.6.20 — "in frameset" insertion mode
 */
export function handleInFrameset(ctx: TreeBuilderContext, token: Token): void {
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
      if (token.tagName === 'html') {
        ctx.processInBodyToken(token);
        return;
      }
      if (token.tagName === 'frameset') {
        ctx.insertHTMLElement(token);
        return;
      }
      break;
    case 'close':
      if (token.tagName === 'frameset') {
        if (ctx.currentNode()?.tagName !== 'html') {
          ctx.popCurrentNode();
        }
        return;
      }
      break;
    case 'eof':
      break;
  }
  ctx.parseError(token);
}

/**
 * §13.2.6.21 — "after frameset" insertion mode
 */
export function handleAfterFrameset(ctx: TreeBuilderContext, token: Token): void {
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
      if (token.tagName === 'html') {
        ctx.processInBodyToken(token);
        return;
      }
      if (token.tagName === 'noframes') {
        ctx.insertHTMLElement(token);
        return;
      }
      break;
    case 'close':
      if (token.tagName === 'html') {
        ctx.setMode(Im.AFTER_AFTER_FRAMESET);
        return;
      }
      break;
    case 'eof':
      break;
  }
  ctx.parseError(token);
}

/**
 * §13.2.6.22 — "after after body" insertion mode
 */
export function handleAfterAfterBody(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'comment':
      ctx.insertComment(token);
      return;
    case 'doctype':
      ctx.parseError(token);
      return;
    case 'text':
      if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) {
        ctx.insertText(token);
        return;
      }
      break;
    case 'open':
      if (token.tagName === 'html') {
        ctx.processInBodyToken(token);
        return;
      }
      break;
    case 'close':
      if (token.tagName === 'html') {
        ctx.setMode(Im.AFTER_AFTER_FRAMESET);
        return;
      }
      break;
    case 'eof':
      break;
  }
  ctx.parseError(token);
}

/**
 * §13.2.6.23 — "after after frameset" insertion mode
 */
export function handleAfterAfterFrameset(ctx: TreeBuilderContext, token: Token): void {
  switch (token.kind) {
    case 'comment':
      ctx.insertComment(token);
      return;
    case 'doctype':
      ctx.parseError(token);
      return;
    case 'text':
      if (/^[\t\n\f\r ]*$/.test(token.data ?? '')) {
        ctx.insertText(token);
        return;
      }
      break;
    case 'open':
      if (token.tagName === 'html') {
        ctx.processInBodyToken(token);
        return;
      }
      if (token.tagName === 'noframes') {
        ctx.insertHTMLElement(token);
        return;
      }
      break;
    case 'eof':
      break;
  }
  ctx.parseError(token);
}
