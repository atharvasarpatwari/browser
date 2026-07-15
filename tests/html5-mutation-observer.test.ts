import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createMutableDocument,
  createMutableElement,
  createMutableTextNode,
  createMutableComment,
  appendChild,
  insertBefore,
  removeChild,
  replaceChild,
  elementSetAttribute,
  elementRemoveAttribute,
  setTextContent,
  cloneNode,
  NodeType,
  type HtmlNode,
} from '../src/browser/rendering/html5/dom';
import {
  MutationObserver,
  deliverRecordsSync,
  clearAllRegistrations,
  getRegistrationCount,
  type MutationRecord,
  type MutationObserverInit,
} from '../src/browser/rendering/html5/mutation-observer';

// ─────────────────────────────────────────────────────────────────────────────
// SETUP / TEARDOWN
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearAllRegistrations();
});

afterEach(() => {
  clearAllRegistrations();
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

function collectRecords(observer: MutationObserver): MutationRecord[] {
  return observer.takeRecords();
}

// ─────────────────────────────────────────────────────────────────────────────
// BASIC CONSTRUCTION
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver — construction', () => {
  it('creates an observer with a callback', () => {
    let called = false;
    const obs = new MutationObserver(() => { called = true; });
    expect(obs).toBeDefined();
    obs.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHILD LIST MUTATIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver — childList', () => {
  it('fires when a child is appended', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { childList: true });

    const p = createMutableElement('p');
    appendChild(div, p);
    deliverRecordsSync();

    expect(records.length).toBe(1);
    expect(records[0].type).toBe('childList');
    expect(records[0].addedNodes.length).toBe(1);
    expect(records[0].addedNodes[0]).toBe(p);
    expect(records[0].removedNodes.length).toBe(0);

    obs.disconnect();
  });

  it('fires when a child is removed', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    const p = createMutableElement('p');
    appendChild(div, p);
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { childList: true });

    removeChild(div, p);
    deliverRecordsSync();

    expect(records.length).toBe(1);
    expect(records[0].type).toBe('childList');
    expect(records[0].removedNodes.length).toBe(1);
    expect(records[0].removedNodes[0]).toBe(p);

    obs.disconnect();
  });

  it('fires when a child is replaced', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    const old = createMutableElement('span');
    const repl = createMutableElement('b');
    appendChild(div, old);
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { childList: true });

    replaceChild(div, repl, old);
    deliverRecordsSync();

    expect(records.length).toBe(1);
    expect(records[0].addedNodes[0]).toBe(repl);
    expect(records[0].removedNodes[0]).toBe(old);
  });

  it('fires when a child is inserted before a reference node', () => {
    const doc = createMutableDocument();
    const ul = createMutableElement('ul');
    const li1 = createMutableElement('li');
    const li2 = createMutableElement('li');
    appendChild(ul, li1);
    appendChild(doc, ul);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(ul, { childList: true });

    insertBefore(ul, li2, li1);
    deliverRecordsSync();

    expect(records.length).toBe(1);
    expect(records[0].addedNodes[0]).toBe(li2);
    expect(records[0].nextSibling).toBe(li1);
  });

  it('fires multiple records for multiple mutations', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { childList: true });

    appendChild(div, createMutableElement('a'));
    appendChild(div, createMutableElement('b'));
    appendChild(div, createMutableElement('c'));
    deliverRecordsSync();

    expect(records.length).toBe(3);
  });

  it('does NOT fire when childList is false', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { attributes: true });

    appendChild(div, createMutableElement('p'));
    deliverRecordsSync();

    expect(records.length).toBe(0);
    obs.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUBTREE OBSERVATION
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver — subtree', () => {
  it('fires for deep mutations when subtree is true', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    const inner = createMutableElement('span');
    appendChild(div, inner);
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { childList: true, subtree: true });

    const child = createMutableElement('b');
    appendChild(inner, child);
    deliverRecordsSync();

    expect(records.length).toBe(1);
    expect(records[0].target).toBe(inner);
    expect(records[0].addedNodes[0]).toBe(child);

    obs.disconnect();
  });

  it('does NOT fire for deep mutations when subtree is false', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    const inner = createMutableElement('span');
    appendChild(div, inner);
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { childList: true });

    appendChild(inner, createMutableElement('b'));
    deliverRecordsSync();

    expect(records.length).toBe(0);
    obs.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATTRIBUTE MUTATIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver — attributes', () => {
  it('fires when an attribute is set', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { attributes: true });

    elementSetAttribute(div, 'class', 'foo');
    deliverRecordsSync();

    expect(records.length).toBe(1);
    expect(records[0].type).toBe('attributes');
    expect(records[0].attributeName).toBe('class');
  });

  it('includes old value when attributeOldValue is true', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);
    elementSetAttribute(div, 'class', 'old');

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { attributes: true, attributeOldValue: true });

    elementSetAttribute(div, 'class', 'new');
    deliverRecordsSync();

    expect(records.length).toBe(1);
    expect(records[0].oldValue).toBe('old');
  });

  it('does NOT include old value when attributeOldValue is false', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);
    elementSetAttribute(div, 'class', 'old');

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { attributes: true });

    elementSetAttribute(div, 'class', 'new');
    deliverRecordsSync();

    expect(records[0].oldValue).toBeNull();
  });

  it('fires when an attribute is removed', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);
    elementSetAttribute(div, 'id', 'x');

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { attributes: true, attributeOldValue: true });

    elementRemoveAttribute(div, 'id');
    deliverRecordsSync();

    expect(records.length).toBe(1);
    expect(records[0].oldValue).toBe('x');
  });

  it('filters by attributeFilter', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { attributes: true, attributeFilter: ['class'] });

    elementSetAttribute(div, 'id', 'x');
    elementSetAttribute(div, 'class', 'y');
    deliverRecordsSync();

    expect(records.length).toBe(1);
    expect(records[0].attributeName).toBe('class');
  });

  it('does NOT fire when attributes option is false', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { childList: true });

    elementSetAttribute(div, 'class', 'x');
    deliverRecordsSync();

    expect(records.length).toBe(0);
    obs.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTER DATA MUTATIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver — characterData', () => {
  it('fires when text content is changed', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    const text = createMutableTextNode('hello');
    appendChild(div, text);
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(text, { characterData: true, characterDataOldValue: true });

    setTextContent(text, 'world');
    deliverRecordsSync();

    expect(records.length).toBe(1);
    expect(records[0].type).toBe('characterData');
    expect(records[0].oldValue).toBe('hello');
  });

  it('fires for deep characterData mutations with subtree', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    const text = createMutableTextNode('old');
    appendChild(div, text);
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { characterData: true, subtree: true, characterDataOldValue: true });

    setTextContent(text, 'new');
    deliverRecordsSync();

    expect(records.length).toBe(1);
    expect(records[0].target).toBe(text);
    expect(records[0].oldValue).toBe('old');
  });

  it('does NOT fire when characterData is false', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    const text = createMutableTextNode('hello');
    appendChild(div, text);
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(text, { childList: true });

    setTextContent(text, 'world');
    deliverRecordsSync();

    expect(records.length).toBe(0);
    obs.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVER LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver — lifecycle', () => {
  it('takeRecords returns records and clears queue', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    const obs = new MutationObserver(() => {});
    obs.observe(div, { childList: true });

    appendChild(div, createMutableElement('p'));
    const records = collectRecords(obs);

    expect(records.length).toBe(1);
    expect(collectRecords(obs).length).toBe(0);
    obs.disconnect();
  });

  it('disconnect stops future notifications', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    let callCount = 0;
    const obs = new MutationObserver(() => { callCount++; });
    obs.observe(div, { childList: true });

    obs.disconnect();
    appendChild(div, createMutableElement('p'));
    deliverRecordsSync();

    expect(callCount).toBe(0);
  });

  it('disconnect clears accumulated records', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    const obs = new MutationObserver(() => {});
    obs.observe(div, { childList: true });

    appendChild(div, createMutableElement('p'));
    obs.disconnect();
    const records = obs.takeRecords();

    expect(records.length).toBe(0);
  });

  it('observe replaces previous registration for same target', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    let records1: MutationRecord[] = [];
    let records2: MutationRecord[] = [];
    const obs1 = new MutationObserver((r) => { records1 = records1.concat(r); });
    const obs2 = new MutationObserver((r) => { records2 = records2.concat(r); });

    // First registration
    obs1.observe(div, { childList: true });
    expect(getRegistrationCount()).toBe(1);

    // Second observer on same target
    obs2.observe(div, { childList: true });
    expect(getRegistrationCount()).toBe(2);

    appendChild(div, createMutableElement('p'));
    deliverRecordsSync();

    // Both observers should fire
    expect(records1.length).toBe(1);
    expect(records2.length).toBe(1);

    obs1.disconnect();
    obs2.disconnect();
  });

  it('observing with only subtree: true without childList/attributes/characterData is invalid', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    // Invalid: no childList, attributes, or characterData
    obs.observe(div, { subtree: true });

    appendChild(div, createMutableElement('p'));
    deliverRecordsSync();

    expect(records.length).toBe(0);
    expect(getRegistrationCount()).toBe(0);
    obs.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ANCESTOR WALKING
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver — ancestor observation', () => {
  it('observes ancestors when subtree is true on ancestor', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    const inner = createMutableElement('span');
    const leaf = createMutableElement('b');
    appendChild(inner, leaf);
    appendChild(div, inner);
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { childList: true, subtree: true });

    appendChild(leaf, createMutableTextNode('hi'));
    deliverRecordsSync();

    expect(records.length).toBe(1);
    expect(records[0].target).toBe(leaf);
    obs.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NODE REMOVAL CLEANUP
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver — node removal cleanup', () => {
  it('cleans up registrations when a node is removed', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    const child = createMutableElement('span');
    appendChild(div, child);
    appendChild(doc, div);

    const obs = new MutationObserver(() => {});
    obs.observe(child, { childList: true });
    expect(getRegistrationCount()).toBe(1);

    removeChild(div, child);
    // Registration for removed node should be cleaned up
    expect(getRegistrationCount()).toBe(0);
    obs.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RECORD PROPERTIES
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver — record properties', () => {
  it('has correct previousSibling and nextSibling on childList mutation', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    const a = createMutableElement('a');
    const c = createMutableElement('c');
    appendChild(div, a);
    appendChild(div, c);
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { childList: true });

    const b = createMutableElement('b');
    insertBefore(div, b, c);
    deliverRecordsSync();

    expect(records[0].previousSibling).toBe(a);
    expect(records[0].nextSibling).toBe(c);
    obs.disconnect();
  });

  it('has null nextSibling when appending', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { childList: true });

    appendChild(div, createMutableElement('p'));
    deliverRecordsSync();

    expect(records[0].nextSibling).toBeNull();
    obs.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BATCHED DELIVERY
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver — batched delivery', () => {
  it('delivers all records in one callback, not one per mutation', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    let callbackCount = 0;
    let lastBatchSize = 0;
    const obs = new MutationObserver((records) => {
      callbackCount++;
      lastBatchSize = records.length;
    });
    obs.observe(div, { childList: true });

    appendChild(div, createMutableElement('a'));
    appendChild(div, createMutableElement('b'));
    appendChild(div, createMutableElement('c'));
    deliverRecordsSync();

    expect(callbackCount).toBe(1);
    expect(lastBatchSize).toBe(3);
    obs.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REPLACE CHILD (SIMULTANEOUS ADD + REMOVE)
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver — replaceChild', () => {
  it('records both added and removed in single record', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    const old = createMutableElement('span');
    const repl = createMutableElement('em');
    appendChild(div, old);
    appendChild(doc, div);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(div, { childList: true });

    replaceChild(div, repl, old);
    deliverRecordsSync();

    expect(records.length).toBe(1);
    expect(records[0].addedNodes[0]).toBe(repl);
    expect(records[0].removedNodes[0]).toBe(old);
    obs.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: FULL PARSE CYCLE
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver — parse cycle integration', () => {
  it('fires mutations during parsing if observer is registered', () => {
    // Create a document and register an observer before parsing content
    const doc = createMutableDocument();
    const html = createMutableElement('html');
    const head = createMutableElement('head');
    const body = createMutableElement('body');
    const div = createMutableElement('div');

    appendChild(doc, html);
    appendChild(html, head);
    appendChild(html, body);

    let records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => { records = records.concat(r); });
    obs.observe(body, { childList: true, subtree: true });

    // Simulate adding elements as parser would
    appendChild(body, div);
    appendChild(div, createMutableTextNode('Hello'));
    deliverRecordsSync();

    expect(records.length).toBe(2);
    expect(records[0].addedNodes[0]).toBe(div);
    expect(records[1].addedNodes[0]).toMatchObject({ nodeType: NodeType.Text });
    obs.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MULTIPLE OBSERVERS
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver — multiple observers', () => {
  it('notifies multiple independent observers', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    let r1 = 0, r2 = 0;
    const obs1 = new MutationObserver(() => { r1++; });
    const obs2 = new MutationObserver(() => { r2++; });
    obs1.observe(div, { childList: true });
    obs2.observe(div, { childList: true });

    appendChild(div, createMutableElement('p'));
    deliverRecordsSync();

    expect(r1).toBe(1);
    expect(r2).toBe(1);
    obs1.disconnect();
    obs2.disconnect();
  });

  it('only affected observer is notified', () => {
    const doc = createMutableDocument();
    const div1 = createMutableElement('div');
    const div2 = createMutableElement('div');
    appendChild(doc, div1);
    appendChild(doc, div2);

    let r1 = 0, r2 = 0;
    const obs1 = new MutationObserver(() => { r1++; });
    const obs2 = new MutationObserver(() => { r2++; });
    obs1.observe(div1, { childList: true });
    obs2.observe(div2, { childList: true });

    appendChild(div1, createMutableElement('p'));
    deliverRecordsSync();

    expect(r1).toBe(1);
    expect(r2).toBe(0);
    obs1.disconnect();
    obs2.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DISCONNECT + RE-OBSERVE
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver — disconnect and re-observe', () => {
  it('can observe again after disconnect', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    let count = 0;
    const obs = new MutationObserver(() => { count++; });
    obs.observe(div, { childList: true });

    appendChild(div, createMutableElement('a'));
    deliverRecordsSync();
    expect(count).toBe(1);

    obs.disconnect();

    appendChild(div, createMutableElement('b'));
    deliverRecordsSync();
    expect(count).toBe(1); // No change after disconnect

    obs.observe(div, { childList: true });
    appendChild(div, createMutableElement('c'));
    deliverRecordsSync();
    expect(count).toBe(2);
    obs.disconnect();
  });
});
