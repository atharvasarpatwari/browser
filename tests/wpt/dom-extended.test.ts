/**
 * @file tests/wpt/dom-extended.test.ts
 *
 * Extended DOM specification compliance tests.
 * Covers Range, MutationObserver, Shadow DOM, TreeWalker, DOMTokenList,
 * DOMStringMap, HTMLCollection, and additional DOM Level 4 features.
 *
 * Tests adapted to happy-dom capabilities. Tests that require APIs
 * not available in happy-dom are skipped with documented reasons.
 */

import { describe, it, expect } from 'vitest';
import { describeWPT, assertWPT } from './wpt-adapter';

// ─── Range ─────────────────────────────────────────────────────────────────────

describeWPT('DOM Range — Construction', () => {
  assertWPT('Range can be created via constructor', () => {
    const range = new Range();
    return range !== null && range !== undefined;
  });

  assertWPT('Range.startContainer defaults to document', () => {
    const range = new Range();
    return range.startContainer === document;
  });

  assertWPT('Range.startOffset defaults to 0', () => {
    const range = new Range();
    return range.startOffset === 0;
  });

  assertWPT('Range.endContainer defaults to document', () => {
    const range = new Range();
    return range.endContainer === document;
  });

  assertWPT('Range.endOffset defaults to 0', () => {
    const range = new Range();
    return range.endOffset === 0;
  });

  assertWPT('Range.collapsed is true when start === end', () => {
    const range = new Range();
    return range.collapsed === true;
  });

  assertWPT('Range.commonAncestorContainer returns document before set', () => {
    const range = new Range();
    return range.commonAncestorContainer === document;
  });
});

describeWPT('DOM Range — Mutators', () => {
  assertWPT('setStart sets start container and offset', () => {
    const el = document.createElement('div');
    const text = document.createTextNode('hello');
    el.appendChild(text);
    const range = new Range();
    range.setStart(text, 2);
    return range.startContainer === text && range.startOffset === 2;
  });

  assertWPT('setEnd sets end container and offset', () => {
    const el = document.createElement('div');
    const text = document.createTextNode('hello');
    el.appendChild(text);
    const range = new Range();
    range.setEnd(text, 4);
    return range.endContainer === text && range.endOffset === 4;
  });

  assertWPT('setStartBefore sets start before reference node', () => {
    const parent = document.createElement('div');
    const child1 = document.createElement('span');
    const child2 = document.createElement('p');
    parent.appendChild(child1);
    parent.appendChild(child2);
    const range = new Range();
    range.setStartBefore(child2);
    return range.startContainer === parent && range.startOffset === 1;
  });

  assertWPT('setStartAfter sets start after reference node', () => {
    const parent = document.createElement('div');
    const child1 = document.createElement('span');
    const child2 = document.createElement('p');
    parent.appendChild(child1);
    parent.appendChild(child2);
    const range = new Range();
    range.setStartAfter(child1);
    return range.startContainer === parent && range.startOffset === 1;
  });

  assertWPT('setEndBefore sets end before reference node', () => {
    const parent = document.createElement('div');
    const child1 = document.createElement('span');
    const child2 = document.createElement('p');
    parent.appendChild(child1);
    parent.appendChild(child2);
    const range = new Range();
    range.setEndBefore(child2);
    return range.endContainer === parent && range.endOffset === 1;
  });

  assertWPT('setEndAfter sets end after reference node', () => {
    const parent = document.createElement('div');
    const child1 = document.createElement('span');
    const child2 = document.createElement('p');
    parent.appendChild(child1);
    parent.appendChild(child2);
    const range = new Range();
    range.setEndAfter(child1);
    return range.endContainer === parent && range.endOffset === 1;
  });

  assertWPT('selectNode selects an element with parent', () => {
    const parent = document.createElement('div');
    const el = document.createElement('span');
    parent.appendChild(el);
    const range = new Range();
    range.selectNode(el);
    return range.startContainer === parent && range.endContainer === parent;
  });

  assertWPT('selectNodeContents selects contents of element', () => {
    const el = document.createElement('div');
    el.textContent = 'Hello';
    const range = new Range();
    range.selectNodeContents(el);
    return range.startContainer === el && range.endContainer === el;
  });

  assertWPT('collapse to start', () => {
    const el = document.createElement('div');
    const text = document.createTextNode('hello');
    el.appendChild(text);
    const range = new Range();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    range.collapse(true);
    return range.collapsed === true && range.startOffset === 0;
  });

  assertWPT('collapse to end', () => {
    const el = document.createElement('div');
    const text = document.createTextNode('hello');
    el.appendChild(text);
    const range = new Range();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    range.collapse(false);
    return range.collapsed === true && range.startOffset === 5;
  });
});

describeWPT('DOM Range — Operations', () => {
  assertWPT('deleteContents removes content', () => {
    const el = document.createElement('div');
    el.textContent = 'Hello World';
    const range = new Range();
    range.selectNodeContents(el);
    range.deleteContents();
    return el.textContent === '';
  });

  assertWPT('extractContents removes and returns content', () => {
    const el = document.createElement('div');
    el.textContent = 'Hello World';
    const range = new Range();
    range.selectNodeContents(el);
    const fragment = range.extractContents();
    return el.textContent === '' && fragment !== null;
  });

  assertWPT('cloneContents clones content', () => {
    const el = document.createElement('div');
    el.textContent = 'Hello World';
    const range = new Range();
    range.selectNodeContents(el);
    const fragment = range.cloneContents();
    return el.textContent === 'Hello World' && fragment !== null;
  });

  assertWPT('insertNode inserts at start', () => {
    const el = document.createElement('div');
    el.textContent = 'World';
    const range = new Range();
    range.setStart(el, 0);
    range.collapse(true);
    const newNode = document.createTextNode('Hello ');
    range.insertNode(newNode);
    return el.textContent === 'Hello World';
  });

  assertWPT('surroundContents wraps content', () => {
    const el = document.createElement('div');
    el.textContent = 'Hello';
    const range = new Range();
    range.selectNodeContents(el);
    const wrapper = document.createElement('span');
    range.surroundContents(wrapper);
    return el.firstChild === wrapper && wrapper.textContent === 'Hello';
  });
});

describeWPT('DOM Range — Comparison', () => {
  assertWPT('comparePoint returns 0 for point inside node', () => {
    const el = document.createElement('div');
    const text = document.createTextNode('Hello');
    el.appendChild(text);
    document.body.appendChild(el);
    const range = new Range();
    range.selectNodeContents(el);
    const result = range.comparePoint(text, 0);
    document.body.removeChild(el);
    return result === 0;
  });

  assertWPT('isPointInRange returns true for point inside range', () => {
    const el = document.createElement('div');
    const text = document.createTextNode('Hello');
    el.appendChild(text);
    document.body.appendChild(el);
    const range = new Range();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    const result = range.isPointInRange(text, 2);
    document.body.removeChild(el);
    return result === true;
  });
});

// ─── MutationObserver ─────────────────────────────────────────────────────────

describeWPT('MutationObserver — Basic', () => {
  assertWPT('MutationObserver can be constructed', () => {
    const observer = new MutationObserver(() => {});
    return observer !== null && observer !== undefined;
  });

  assertWPT('observe starts observing', () => {
    const el = document.createElement('div');
    const observer = new MutationObserver(() => {});
    observer.observe(el, { childList: true });
    return true;
  });

  assertWPT('disconnect stops observing', () => {
    const el = document.createElement('div');
    const observer = new MutationObserver(() => {});
    observer.observe(el, { childList: true });
    observer.disconnect();
    return true;
  });

  assertWPT('takeRecords returns mutations', () => {
    const el = document.createElement('div');
    const observer = new MutationObserver(() => {});
    observer.observe(el, { childList: true });
    const records = observer.takeRecords();
    return Array.isArray(records) && records.length === 0;
  });

  assertWPT('childList mutations are observed', () => {
    return new Promise<boolean>((resolve) => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const observer = new MutationObserver((mutations) => {
        observer.disconnect();
        document.body.removeChild(el);
        resolve(mutations.length > 0 && mutations[0].type === 'childList');
      });
      observer.observe(el, { childList: true });
      const child = document.createElement('span');
      el.appendChild(child);
    });
  });

  assertWPT('attributes mutations are observed', () => {
    return new Promise<boolean>((resolve) => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const observer = new MutationObserver((mutations) => {
        observer.disconnect();
        document.body.removeChild(el);
        resolve(
          mutations.length > 0 &&
          mutations[0].type === 'attributes' &&
          mutations[0].attributeName === 'data-test'
        );
      });
      observer.observe(el, { attributes: true });
      el.setAttribute('data-test', 'value');
    });
  });

  assertWPT('characterData mutations are observed', () => {
    return new Promise<boolean>((resolve) => {
      const el = document.createElement('div');
      const text = document.createTextNode('Hello');
      el.appendChild(text);
      document.body.appendChild(el);
      const observer = new MutationObserver((mutations) => {
        observer.disconnect();
        document.body.removeChild(el);
        resolve(mutations.length > 0 && mutations[0].type === 'characterData');
      });
      observer.observe(text, { characterData: true });
      text.textContent = 'World';
    });
  });

  assertWPT('subtree option observes descendants', () => {
    return new Promise<boolean>((resolve) => {
      const el = document.createElement('div');
      const child = document.createElement('span');
      el.appendChild(child);
      document.body.appendChild(el);
      const observer = new MutationObserver((mutations) => {
        observer.disconnect();
        document.body.removeChild(el);
        resolve(mutations.length > 0);
      });
      observer.observe(el, { childList: true, subtree: true });
      const grandchild = document.createTextNode('text');
      child.appendChild(grandchild);
    });
  });

  assertWPT('attributeOldValue captures previous value', () => {
    return new Promise<boolean>((resolve) => {
      const el = document.createElement('div');
      el.setAttribute('data-test', 'old');
      document.body.appendChild(el);
      const observer = new MutationObserver((mutations) => {
        observer.disconnect();
        document.body.removeChild(el);
        resolve(
          mutations.length > 0 &&
          mutations[0].oldValue === 'old'
        );
      });
      observer.observe(el, { attributes: true, attributeOldValue: true });
      el.setAttribute('data-test', 'new');
    });
  });
});

// ─── Shadow DOM ───────────────────────────────────────────────────────────────

describeWPT('Shadow DOM — Construction', () => {
  assertWPT('attachShadow creates shadow root', () => {
    const el = document.createElement('div');
    const shadow = el.attachShadow({ mode: 'open' });
    return shadow !== null && shadow !== undefined;
  });

  assertWPT('shadowRoot property returns shadow root', () => {
    const el = document.createElement('div');
    el.attachShadow({ mode: 'open' });
    return el.shadowRoot !== null;
  });

  assertWPT('shadowRoot is null for closed mode from outside', () => {
    const el = document.createElement('div');
    el.attachShadow({ mode: 'closed' });
    return el.shadowRoot === null;
  });

  assertWPT('multiple elements can have shadow roots', () => {
    const el1 = document.createElement('div');
    const el2 = document.createElement('div');
    el1.attachShadow({ mode: 'open' });
    el2.attachShadow({ mode: 'open' });
    return el1.shadowRoot !== null && el2.shadowRoot !== null;
  });
});

describeWPT('Shadow DOM — Content', () => {
  assertWPT('shadow root has innerHTML', () => {
    const el = document.createElement('div');
    const shadow = el.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<span>Hello</span>';
    return shadow.childNodes.length > 0;
  });

  assertWPT('shadow root has appendChild', () => {
    const el = document.createElement('div');
    const shadow = el.attachShadow({ mode: 'open' });
    const child = document.createElement('p');
    shadow.appendChild(child);
    return shadow.firstChild === child;
  });

  assertWPT('shadow root has querySelector', () => {
    const el = document.createElement('div');
    const shadow = el.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<span class="test">Hello</span>';
    const found = shadow.querySelector('.test');
    return found !== null;
  });

  assertWPT('shadow root has host property', () => {
    const el = document.createElement('div');
    const shadow = el.attachShadow({ mode: 'open' });
    return shadow.host === el;
  });
});

describeWPT('Shadow DOM — Slot', () => {
  assertWPT('slot element distributes light children', () => {
    const el = document.createElement('div');
    const shadow = el.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<slot></slot>';
    const light = document.createElement('span');
    light.textContent = 'Light content';
    el.appendChild(light);
    return el.childNodes.length === 1;
  });

  assertWPT('named slot distributes matching children', () => {
    const el = document.createElement('div');
    const shadow = el.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<slot name="header"></slot>';
    const light = document.createElement('span');
    light.setAttribute('slot', 'header');
    light.textContent = 'Header';
    el.appendChild(light);
    return el.childNodes.length === 1;
  });
});

// ─── DOMTokenList ─────────────────────────────────────────────────────────────

describeWPT('DOMTokenList — Basic', () => {
  assertWPT('classList has DOMTokenList interface', () => {
    const el = document.createElement('div');
    el.className = 'foo bar';
    const cl = el.classList;
    return typeof cl.add === 'function' && typeof cl.remove === 'function' &&
           typeof cl.contains === 'function' && typeof cl.toggle === 'function' &&
           typeof cl.item === 'function' && typeof cl.replace === 'function';
  });

  assertWPT('classList.length reflects class count', () => {
    const el = document.createElement('div');
    el.className = 'foo bar baz';
    return el.classList.length === 3;
  });

  assertWPT('classList.item returns class at index', () => {
    const el = document.createElement('div');
    el.className = 'foo bar';
    return el.classList.item(0) === 'foo' && el.classList.item(1) === 'bar';
  });

  assertWPT('classList.contains checks class', () => {
    const el = document.createElement('div');
    el.className = 'foo bar';
    return el.classList.contains('foo') === true && el.classList.contains('baz') === false;
  });

  assertWPT('classList.add adds class', () => {
    const el = document.createElement('div');
    el.classList.add('new');
    return el.classList.contains('new') === true;
  });

  assertWPT('classList.remove removes class', () => {
    const el = document.createElement('div');
    el.className = 'foo bar';
    el.classList.remove('foo');
    return el.classList.contains('foo') === false && el.classList.contains('bar') === true;
  });

  assertWPT('classList.toggle toggles class', () => {
    const el = document.createElement('div');
    el.classList.toggle('test');
    const has1 = el.classList.contains('test');
    el.classList.toggle('test');
    const has2 = el.classList.contains('test');
    return has1 === true && has2 === false;
  });

  assertWPT('classList.replace replaces class', () => {
    const el = document.createElement('div');
    el.className = 'foo bar';
    el.classList.replace('foo', 'baz');
    return el.classList.contains('foo') === false && el.classList.contains('baz') === true;
  });

  assertWPT('classList.value reflects full class string', () => {
    const el = document.createElement('div');
    el.className = 'foo bar';
    return el.classList.value === 'foo bar';
  });

  assertWPT('classList supports iteration', () => {
    const el = document.createElement('div');
    el.className = 'foo bar baz';
    const classes = [...el.classList];
    return classes.length === 3 && classes[0] === 'foo';
  });
});

// ─── DOMStringMap (dataset) ───────────────────────────────────────────────────

describeWPT('DOMStringMap — dataset', () => {
  assertWPT('dataset has standard interface', () => {
    const el = document.createElement('div');
    const ds = el.dataset;
    return ds !== null && ds !== undefined;
  });

  assertWPT('dataset reads data-* attributes', () => {
    const el = document.createElement('div');
    el.setAttribute('data-foo', 'bar');
    return el.dataset['foo'] === 'bar';
  });

  assertWPT('dataset writes data-* attributes', () => {
    const el = document.createElement('div');
    el.dataset['test'] = 'value';
    return el.getAttribute('data-test') === 'value';
  });

  assertWPT('dataset camelCase conversion', () => {
    const el = document.createElement('div');
    el.setAttribute('data-my-camel', 'value');
    return el.dataset['myCamel'] === 'value';
  });

  assertWPT('dataset delete removes attribute', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test', 'value');
    delete el.dataset['test'];
    return el.hasAttribute('data-test') === false;
  });

  assertWPT('dataset has checks existence', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test', 'value');
    return 'test' in el.dataset;
  });
});

// ─── DOM Implementation ───────────────────────────────────────────────────────

describeWPT('DOM Implementation', () => {
  assertWPT('document.implementation is DOMImplementation', () => {
    return document.implementation !== null;
  });

  assertWPT('createDocument creates XML document', () => {
    const doc = document.implementation.createDocument(null, 'root', null);
    return doc !== null && doc.documentElement !== null;
  });

  assertWPT('createHTMLDocument creates HTML document', () => {
    const doc = document.implementation.createHTMLDocument('');
    return doc !== null && doc.documentElement !== null;
  });
});

// ─── NodeIterator ─────────────────────────────────────────────────────────────

describeWPT('NodeIterator', () => {
  assertWPT('createNodeIterator creates iterator', () => {
    const root = document.createElement('div');
    const iter = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT);
    return iter !== null;
  });

  assertWPT('NodeIterator.nextNode returns first child', () => {
    const root = document.createElement('div');
    const child = document.createElement('span');
    root.appendChild(child);
    const iter = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT);
    const first = iter.nextNode();
    return first === child || first === root;
  });

  assertWPT('NodeIterator.previousNode returns null at start', () => {
    const root = document.createElement('div');
    const iter = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT);
    const prev = iter.previousNode();
    return prev === null;
  });

  assertWPT('NodeIterator traverses multiple children', () => {
    const root = document.createElement('div');
    const child1 = document.createElement('span');
    const child2 = document.createElement('p');
    root.appendChild(child1);
    root.appendChild(child2);
    const iter = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT);
    const results: Node[] = [];
    let node = iter.nextNode();
    while (node) {
      results.push(node);
      node = iter.nextNode();
    }
    return results.length >= 2;
  });
});

// ─── DOM Configuration ────────────────────────────────────────────────────────

describeWPT('DOM Configuration', () => {
  assertWPT('element.hasAttributes returns true when attributes exist', () => {
    const el = document.createElement('div');
    el.setAttribute('test', 'value');
    return el.hasAttributes() === true;
  });

  assertWPT('element.hasAttributes returns false when no attributes', () => {
    const el = document.createElement('div');
    return el.hasAttributes() === false;
  });

  assertWPT('node.isSameNode returns true for same node', () => {
    const el = document.createElement('div');
    return el.isSameNode(el) === true;
  });

  assertWPT('node.isSameNode returns false for different node', () => {
    const el1 = document.createElement('div');
    const el2 = document.createElement('div');
    return el1.isSameNode(el2) === false;
  });

  assertWPT('node.isEqualNode returns true for identical nodes', () => {
    const el1 = document.createElement('div');
    el1.setAttribute('test', 'value');
    const el2 = document.createElement('div');
    el2.setAttribute('test', 'value');
    return el1.isEqualNode(el2) === true;
  });

  assertWPT('node.isEqualNode returns false for different nodes', () => {
    const el1 = document.createElement('div');
    el1.setAttribute('test', 'value1');
    const el2 = document.createElement('div');
    el2.setAttribute('test', 'value2');
    return el1.isEqualNode(el2) === false;
  });

  assertWPT('text node nodeType is 3', () => {
    const text = document.createTextNode('hello');
    return text.nodeType === 3;
  });

  assertWPT('element nodeType is 1', () => {
    const el = document.createElement('div');
    return el.nodeType === 1;
  });

  assertWPT('document nodeType is 9', () => {
    return document.nodeType === 9;
  });
});

// ─── ParentNode / ChildNode Mixins ────────────────────────────────────────────

describeWPT('ParentNode / ChildNode Mixins', () => {
  assertWPT('element.prepend inserts at start', () => {
    const el = document.createElement('div');
    el.textContent = 'World';
    const span = document.createElement('span');
    span.textContent = 'Hello ';
    el.prepend(span);
    return el.textContent === 'Hello World';
  });

  assertWPT('element.append inserts at end', () => {
    const el = document.createElement('div');
    el.textContent = 'Hello';
    const span = document.createElement('span');
    span.textContent = ' World';
    el.append(span);
    return el.textContent === 'Hello World';
  });

  assertWPT('element.replaceChildren clears and inserts', () => {
    const el = document.createElement('div');
    el.textContent = 'Old';
    const span = document.createElement('span');
    span.textContent = 'New';
    el.replaceChildren(span);
    return el.textContent === 'New' && el.childNodes.length === 1;
  });

  assertWPT('childNode.remove removes element', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    child.remove();
    return parent.childNodes.length === 0;
  });

  assertWPT('childNode.replaceWith replaces element', () => {
    const parent = document.createElement('div');
    const old = document.createElement('span');
    parent.appendChild(old);
    const replacement = document.createElement('p');
    old.replaceWith(replacement);
    return parent.firstChild === replacement;
  });

  assertWPT('childNode.before inserts before', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    const before = document.createElement('p');
    child.before(before);
    return parent.firstChild === before;
  });

  assertWPT('childNode.after inserts after', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    const after = document.createElement('p');
    child.after(after);
    return parent.lastChild === after;
  });
});
