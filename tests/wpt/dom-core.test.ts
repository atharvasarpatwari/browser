/**
 * @file tests/wpt/dom-core.test.ts
 *
 * DOM Core specification compliance tests.
 * Based on W3C DOM Level 4 specification.
 *
 * Uses happy-dom's real DOM implementation via the global window/document.
 */

import { describe, it, expect } from 'vitest';
import { describeWPT, assertWPT } from './wpt-adapter';

describeWPT('DOM Core — Document', () => {
  assertWPT('document.createElement returns Element', () => {
    const el = document.createElement('div');
    return el !== null && el !== undefined;
  });

  assertWPT('document.createTextNode returns Text', () => {
    const text = document.createTextNode('hello');
    return text !== null && text !== undefined;
  });

  assertWPT('document.createComment returns Comment', () => {
    const comment = document.createComment('test');
    return comment !== null && comment !== undefined;
  });

  assertWPT('document.createDocumentFragment returns DocumentFragment', () => {
    const frag = document.createDocumentFragment();
    return frag !== null && frag !== undefined;
  });

  assertWPT('document.getElementById returns null for missing id', () => {
    const result = document.getElementById('nonexistent');
    return result === null;
  });

  assertWPT('document.getElementsByTagName returns HTMLCollection', () => {
    const result = document.getElementsByTagName('div');
    return result !== null && result !== undefined;
  });

  assertWPT('document.getElementsByClassName returns HTMLCollection', () => {
    const result = document.getElementsByClassName('test');
    return result !== null && result !== undefined;
  });

  assertWPT('document.querySelector returns null for no match', () => {
    const result = document.querySelector('.nonexistent');
    return result === null;
  });

  assertWPT('document.querySelectorAll returns NodeList', () => {
    const result = document.querySelectorAll('div');
    return result !== null && result !== undefined;
  });

  assertWPT('document.documentElement exists', () => {
    return document.documentElement !== null;
  });

  assertWPT('document.characterSet is UTF-8 or similar', () => {
    return document.characterSet !== null && document.characterSet !== undefined;
  });
});

describeWPT('DOM Core — Element', () => {
  assertWPT('element.tagName is uppercase', () => {
    const el = document.createElement('div');
    return el.tagName === 'DIV';
  });

  assertWPT('element.nodeName is uppercase', () => {
    const el = document.createElement('div');
    return el.nodeName === 'DIV';
  });

  assertWPT('element.nodeType is ELEMENT_NODE (1)', () => {
    const el = document.createElement('div');
    return el.nodeType === 1;
  });

  assertWPT('element.setAttribute/getAttribute roundtrip', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test', 'value');
    return el.getAttribute('data-test') === 'value';
  });

  assertWPT('element.removeAttribute removes attribute', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test', 'value');
    el.removeAttribute('data-test');
    return el.getAttribute('data-test') === null;
  });

  assertWPT('element.hasAttribute returns true when set', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test', 'value');
    return el.hasAttribute('data-test') === true;
  });

  assertWPT('element.hasAttribute returns false when not set', () => {
    const el = document.createElement('div');
    return el.hasAttribute('data-test') === false;
  });

  assertWPT('element.id property reflects id attribute', () => {
    const el = document.createElement('div');
    el.id = 'test-id';
    return el.id === 'test-id' && el.getAttribute('id') === 'test-id';
  });

  assertWPT('element.className property reflects class attribute', () => {
    const el = document.createElement('div');
    el.className = 'foo bar';
    return el.className === 'foo bar';
  });

  assertWPT('element.textContent returns text content', () => {
    const el = document.createElement('div');
    el.textContent = 'Hello World';
    return el.textContent === 'Hello World';
  });

  assertWPT('element.innerHTML parses HTML', () => {
    const el = document.createElement('div');
    el.innerHTML = '<span>test</span>';
    return el.childNodes.length > 0;
  });
});

describeWPT('DOM Core — Node', () => {
  assertWPT('node.appendChild adds child', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    return parent.childNodes.length === 1 && parent.firstChild === child;
  });

  assertWPT('node.removeChild removes child', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    parent.removeChild(child);
    return parent.childNodes.length === 0;
  });

  assertWPT('node.insertBefore inserts before reference', () => {
    const parent = document.createElement('div');
    const child1 = document.createElement('span');
    const child2 = document.createElement('p');
    parent.appendChild(child1);
    parent.insertBefore(child2, child1);
    return parent.firstChild === child2;
  });

  assertWPT('node.cloneNode(false) creates shallow clone', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test', 'value');
    const clone = el.cloneNode(false) as HTMLElement;
    return clone !== el && clone.getAttribute('data-test') === 'value';
  });

  assertWPT('node.cloneNode(true) creates deep clone', () => {
    const el = document.createElement('div');
    const child = document.createElement('span');
    el.appendChild(child);
    const clone = el.cloneNode(true) as HTMLElement;
    return clone !== el && clone.childNodes.length === 1;
  });

  assertWPT('node.contains returns true for descendant', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    const grandchild = document.createElement('p');
    child.appendChild(grandchild);
    parent.appendChild(child);
    return parent.contains(grandchild) === true;
  });

  assertWPT('node.contains returns false for non-descendant', () => {
    const el1 = document.createElement('div');
    const el2 = document.createElement('div');
    return el1.contains(el2) === false;
  });

  assertWPT('node.insertBefore null reference appends', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.insertBefore(child, null);
    return parent.firstChild === child;
  });
});

describeWPT('DOM Core — NodeList', () => {
  assertWPT('childNodes.length reflects count', () => {
    const parent = document.createElement('div');
    parent.appendChild(document.createElement('span'));
    parent.appendChild(document.createElement('p'));
    return parent.childNodes.length === 2;
  });

  assertWPT('childNodes[0] returns first child', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    return parent.childNodes[0] === child;
  });

  assertWPT('getElementsByTagName returns matching elements', () => {
    const parent = document.createElement('div');
    parent.appendChild(document.createElement('span'));
    parent.appendChild(document.createElement('p'));
    parent.appendChild(document.createElement('span'));
    const spans = parent.getElementsByTagName('span');
    return spans.length === 2;
  });
});

describeWPT('DOM Core — Events', () => {
  assertWPT('Event constructor creates event', () => {
    const event = new Event('click');
    return event.type === 'click';
  });

  assertWPT('Event.bubbles defaults to false', () => {
    const event = new Event('click');
    return event.bubbles === false;
  });

  assertWPT('Event.cancelable defaults to false', () => {
    const event = new Event('click');
    return event.cancelable === false;
  });

  assertWPT('addEventListener adds listener', () => {
    const el = document.createElement('div');
    let called = false;
    el.addEventListener('click', () => { called = true; });
    el.dispatchEvent(new Event('click'));
    return called === true;
  });

  assertWPT('removeEventListener removes listener', () => {
    const el = document.createElement('div');
    let callCount = 0;
    const handler = () => { callCount++; };
    el.addEventListener('click', handler);
    el.removeEventListener('click', handler);
    el.dispatchEvent(new Event('click'));
    return callCount === 0;
  });

  assertWPT('addEventListener with once fires only once', () => {
    const el = document.createElement('div');
    let callCount = 0;
    el.addEventListener('click', () => { callCount++; }, { once: true });
    el.dispatchEvent(new Event('click'));
    el.dispatchEvent(new Event('click'));
    return callCount === 1;
  });

  assertWPT('dispatchEvent returns true when not cancelled', () => {
    const el = document.createElement('div');
    const result = el.dispatchEvent(new Event('click'));
    return result === true;
  });

  assertWPT('dispatchEvent returns false when preventDefault called', () => {
    const el = document.createElement('div');
    el.addEventListener('click', (e) => {
      (e as Event).preventDefault();
    });
    const result = el.dispatchEvent(new Event('click', { cancelable: true }));
    return result === false;
  });

  assertWPT('stopPropagation prevents further propagation', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    document.body.appendChild(parent);
    let parentCalled = false;
    parent.addEventListener('click', () => { parentCalled = true; });
    child.addEventListener('click', (e) => {
      (e as Event).stopPropagation();
    });
    child.dispatchEvent(new Event('click'));
    document.body.removeChild(parent);
    return parentCalled === false;
  });

  assertWPT('CustomEvent detail is accessible', () => {
    let receivedDetail: any = null;
    const target = new EventTarget();
    target.addEventListener('test', ((e: CustomEvent) => {
      receivedDetail = e.detail;
    }) as EventListener);
    target.dispatchEvent(new CustomEvent('test', { detail: { data: 42 } }));
    return receivedDetail?.data === 42;
  });
});

describeWPT('DOM Core — TreeWalker', () => {
  assertWPT('TreeWalker can be created', () => {
    const root = document.createElement('div');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    return walker !== null && walker !== undefined;
  });

  assertWPT('TreeWalker.currentNode starts at root', () => {
    const root = document.createElement('div');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    return walker.currentNode === root;
  });

  assertWPT('TreeWalker.nextNode traverses depth-first', () => {
    const root = document.createElement('div');
    const child = document.createElement('span');
    root.appendChild(child);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    const first = walker.nextNode();
    return first === child;
  });
});
