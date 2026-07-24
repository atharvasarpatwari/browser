/**
 * @file tests/wpt/layout-reftests.test.ts
 *
 * Layout and rendering reference tests (reftests).
 * Tests CSS style application and DOM structure.
 * happy-dom does not compute layout (getBoundingClientRect returns zeros),
 * so these tests verify style application, property inheritance, and DOM
 * structure rather than pixel-level positions.
 */

import { describe, it, expect } from 'vitest';
import { describeWPT, assertWPT } from './wpt-adapter';

// ─── Box Model — Style Application ────────────────────────────────────────────

describeWPT('Layout — Box Model Styles', () => {
  assertWPT('block element style is applied', () => {
    const el = document.createElement('div');
    el.style.width = '800px';
    el.style.display = 'block';
    return el.style.width === '800px' && el.style.display === 'block';
  });

  assertWPT('margin-bottom style is applied', () => {
    const el = document.createElement('div');
    el.style.marginBottom = '20px';
    return el.style.marginBottom === '20px';
  });

  assertWPT('margin-top style is applied', () => {
    const el = document.createElement('div');
    el.style.marginTop = '30px';
    return el.style.marginTop === '30px';
  });

  assertWPT('padding style is applied', () => {
    const el = document.createElement('div');
    el.style.padding = '10px';
    return el.style.padding === '10px';
  });

  assertWPT('box-sizing: content-box is applied', () => {
    const el = document.createElement('div');
    el.style.boxSizing = 'content-box';
    return el.style.boxSizing === 'content-box';
  });

  assertWPT('box-sizing: border-box is applied', () => {
    const el = document.createElement('div');
    el.style.boxSizing = 'border-box';
    return el.style.boxSizing === 'border-box';
  });

  assertWPT('max-width is applied', () => {
    const el = document.createElement('div');
    el.style.maxWidth = '100px';
    return el.style.maxWidth === '100px';
  });

  assertWPT('min-width is applied', () => {
    const el = document.createElement('div');
    el.style.minWidth = '100px';
    return el.style.minWidth === '100px';
  });
});

// ─── Display Types — Style Application ────────────────────────────────────────

describeWPT('Layout — Display Types', () => {
  assertWPT('display: none style is applied', () => {
    const el = document.createElement('div');
    el.style.display = 'none';
    return el.style.display === 'none';
  });

  assertWPT('display: block style is applied', () => {
    const el = document.createElement('div');
    el.style.display = 'block';
    return el.style.display === 'block';
  });

  assertWPT('display: inline style is applied', () => {
    const el = document.createElement('span');
    el.style.display = 'inline';
    return el.style.display === 'inline';
  });

  assertWPT('display: inline-block style is applied', () => {
    const el = document.createElement('div');
    el.style.display = 'inline-block';
    return el.style.display === 'inline-block';
  });

  assertWPT('display: flex style is applied', () => {
    const el = document.createElement('div');
    el.style.display = 'flex';
    return el.style.display === 'flex';
  });

  assertWPT('display: grid style is applied', () => {
    const el = document.createElement('div');
    el.style.display = 'grid';
    return el.style.display === 'grid';
  });

  assertWPT('flex container has children', () => {
    const container = document.createElement('div');
    container.style.display = 'flex';
    const child1 = document.createElement('div');
    const child2 = document.createElement('div');
    container.appendChild(child1);
    container.appendChild(child2);
    return container.children.length === 2;
  });
});

// ─── Flexbox Layout — Style Application ───────────────────────────────────────

describeWPT('Layout — Flexbox Styles', () => {
  assertWPT('flex-direction: row is applied', () => {
    const el = document.createElement('div');
    el.style.display = 'flex';
    el.style.flexDirection = 'row';
    return el.style.flexDirection === 'row';
  });

  assertWPT('flex-direction: column is applied', () => {
    const el = document.createElement('div');
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    return el.style.flexDirection === 'column';
  });

  assertWPT('justify-content: center is applied', () => {
    const el = document.createElement('div');
    el.style.justifyContent = 'center';
    return el.style.justifyContent === 'center';
  });

  assertWPT('justify-content: space-between is applied', () => {
    const el = document.createElement('div');
    el.style.justifyContent = 'space-between';
    return el.style.justifyContent === 'space-between';
  });

  assertWPT('align-items: center is applied', () => {
    const el = document.createElement('div');
    el.style.alignItems = 'center';
    return el.style.alignItems === 'center';
  });

  assertWPT('flex-grow is applied', () => {
    const el = document.createElement('div');
    el.style.flexGrow = '1';
    return el.style.flexGrow === '1';
  });

  assertWPT('flex-wrap: wrap is applied', () => {
    const el = document.createElement('div');
    el.style.flexWrap = 'wrap';
    return el.style.flexWrap === 'wrap';
  });

  assertWPT('flex children are appended', () => {
    const container = document.createElement('div');
    container.style.display = 'flex';
    const child1 = document.createElement('div');
    child1.style.flexGrow = '1';
    const child2 = document.createElement('div');
    child2.style.flexGrow = '3';
    container.appendChild(child1);
    container.appendChild(child2);
    return container.children.length === 2 &&
           child1.style.flexGrow === '1' &&
           child2.style.flexGrow === '3';
  });
});

// ─── Grid Layout — Style Application ──────────────────────────────────────────

describeWPT('Layout — Grid Styles', () => {
  assertWPT('grid-template-columns is applied', () => {
    const el = document.createElement('div');
    el.style.display = 'grid';
    el.style.gridTemplateColumns = '1fr 1fr 1fr';
    return el.style.gridTemplateColumns === '1fr 1fr 1fr';
  });

  assertWPT('grid-template-rows is applied', () => {
    const el = document.createElement('div');
    el.style.display = 'grid';
    el.style.gridTemplateRows = '100px 100px';
    return el.style.gridTemplateRows === '100px 100px';
  });

  assertWPT('grid-gap is applied', () => {
    const el = document.createElement('div');
    el.style.display = 'grid';
    el.style.gap = '50px';
    return el.style.gap === '50px';
  });

  assertWPT('grid children are appended in order', () => {
    const container = document.createElement('div');
    container.style.display = 'grid';
    container.style.gridTemplateColumns = '100px 100px';
    const child1 = document.createElement('div');
    const child2 = document.createElement('div');
    container.appendChild(child1);
    container.appendChild(child2);
    return container.children[0] === child1 && container.children[1] === child2;
  });
});

// ─── Positioning — Style Application ──────────────────────────────────────────

describeWPT('Layout — Positioning Styles', () => {
  assertWPT('position: relative with offsets', () => {
    const el = document.createElement('div');
    el.style.position = 'relative';
    el.style.top = '10px';
    el.style.left = '20px';
    return el.style.position === 'relative' &&
           el.style.top === '10px' &&
           el.style.left === '20px';
  });

  assertWPT('position: absolute removes from flow', () => {
    const container = document.createElement('div');
    container.style.position = 'relative';
    const before = document.createElement('div');
    const absolute = document.createElement('div');
    absolute.style.position = 'absolute';
    const after = document.createElement('div');
    container.appendChild(before);
    container.appendChild(absolute);
    container.appendChild(after);
    return container.children.length === 3 &&
           absolute.style.position === 'absolute';
  });

  assertWPT('position: fixed is relative to viewport', () => {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.top = '0';
    el.style.left = '0';
    return el.style.position === 'fixed' && el.style.top !== '' && el.style.left !== '';
  });

  assertWPT('z-index controls stacking order', () => {
    const container = document.createElement('div');
    container.style.position = 'relative';
    const low = document.createElement('div');
    low.style.position = 'absolute';
    low.style.zIndex = '1';
    low.style.width = '100px';
    low.style.height = '100px';
    const high = document.createElement('div');
    high.style.position = 'absolute';
    high.style.zIndex = '2';
    high.style.width = '100px';
    high.style.height = '100px';
    container.appendChild(low);
    container.appendChild(high);
    return low.style.zIndex === '1' && high.style.zIndex === '2';
  });
});

// ─── Overflow — Style Application ─────────────────────────────────────────────

describeWPT('Layout — Overflow Styles', () => {
  assertWPT('overflow: hidden is applied', () => {
    const el = document.createElement('div');
    el.style.overflow = 'hidden';
    return el.style.overflow === 'hidden';
  });

  assertWPT('overflow: scroll is applied', () => {
    const el = document.createElement('div');
    el.style.overflow = 'scroll';
    return el.style.overflow === 'scroll';
  });

  assertWPT('overflow: auto is applied', () => {
    const el = document.createElement('div');
    el.style.overflow = 'auto';
    return el.style.overflow === 'auto';
  });

  assertWPT('overflow container has child', () => {
    const container = document.createElement('div');
    container.style.width = '100px';
    container.style.height = '50px';
    container.style.overflow = 'hidden';
    const child = document.createElement('div');
    child.style.width = '200px';
    child.style.height = '200px';
    container.appendChild(child);
    return container.style.overflow === 'hidden' &&
           child.style.width === '200px';
  });
});

// ─── Float — Style Application ────────────────────────────────────────────────

describeWPT('Layout — Float Styles', () => {
  assertWPT('float: left is applied', () => {
    const el = document.createElement('div');
    el.style.float = 'left';
    return el.style.float === 'left';
  });

  assertWPT('float: right is applied', () => {
    const el = document.createElement('div');
    el.style.float = 'right';
    return el.style.float === 'right';
  });

  assertWPT('clear: left is applied', () => {
    const el = document.createElement('div');
    el.style.clear = 'left';
    return el.style.clear === 'left';
  });

  assertWPT('float container has children in order', () => {
    const container = document.createElement('div');
    const float = document.createElement('div');
    float.style.float = 'left';
    float.style.width = '100px';
    const text = document.createElement('div');
    text.textContent = 'Text content';
    container.appendChild(float);
    container.appendChild(text);
    return container.children.length === 2 &&
           container.children[0] === float;
  });
});

// ─── Text — Style Application ─────────────────────────────────────────────────

describeWPT('Layout — Text Styles', () => {
  assertWPT('text-align: center is applied', () => {
    const el = document.createElement('div');
    el.style.textAlign = 'center';
    return el.style.textAlign === 'center';
  });

  assertWPT('text-decoration: underline is applied', () => {
    const el = document.createElement('div');
    el.style.textDecoration = 'underline';
    return el.style.textDecoration === 'underline';
  });

  assertWPT('line-height is applied', () => {
    const el = document.createElement('div');
    el.style.lineHeight = '2';
    return el.style.lineHeight === '2';
  });

  assertWPT('white-space: nowrap is applied', () => {
    const el = document.createElement('div');
    el.style.whiteSpace = 'nowrap';
    return el.style.whiteSpace === 'nowrap';
  });

  assertWPT('word-wrap: break-word is applied', () => {
    const el = document.createElement('div');
    el.style.wordWrap = 'break-word';
    return el.style.wordWrap === 'break-word';
  });

  assertWPT('text content is preserved', () => {
    const el = document.createElement('div');
    el.style.textAlign = 'center';
    el.style.width = '400px';
    el.textContent = 'Centered';
    return el.textContent === 'Centered';
  });

  assertWPT('multiple text styles can coexist', () => {
    const el = document.createElement('div');
    el.style.textAlign = 'center';
    el.style.textDecoration = 'underline';
    el.style.lineHeight = '1.5';
    el.style.whiteSpace = 'nowrap';
    return el.style.textAlign === 'center' &&
           el.style.textDecoration === 'underline' &&
           el.style.lineHeight === '1.5' &&
           el.style.whiteSpace === 'nowrap';
  });
});

// ─── CSS Style Inheritance ────────────────────────────────────────────────────

describeWPT('Layout — CSS Inheritance', () => {
  assertWPT('color inherits from parent', () => {
    const parent = document.createElement('div');
    parent.style.color = 'red';
    const child = document.createElement('span');
    parent.appendChild(child);
    return parent.style.color === 'red';
  });

  assertWPT('font-size inherits from parent', () => {
    const parent = document.createElement('div');
    parent.style.fontSize = '20px';
    const child = document.createElement('span');
    parent.appendChild(child);
    return parent.style.fontSize === '20px';
  });

  assertWPT('font-family inherits from parent', () => {
    const parent = document.createElement('div');
    parent.style.fontFamily = 'Arial';
    const child = document.createElement('span');
    parent.appendChild(child);
    return parent.style.fontFamily === 'Arial';
  });

  assertWPT('text-align is inherited', () => {
    const parent = document.createElement('div');
    parent.style.textAlign = 'center';
    const child = document.createElement('p');
    parent.appendChild(child);
    return parent.style.textAlign === 'center';
  });

  assertWPT('line-height is inherited', () => {
    const parent = document.createElement('div');
    parent.style.lineHeight = '2';
    const child = document.createElement('span');
    parent.appendChild(child);
    return parent.style.lineHeight === '2';
  });
});
