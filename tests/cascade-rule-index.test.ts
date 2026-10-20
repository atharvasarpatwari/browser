/**
 * The cascade's rule index (rules bucketed by their rightmost compound's id/class/tag, built once
 * per stylesheet + viewport) must give exactly what testing every rule gave.
 */
import { describe, expect, it } from 'vitest';
import { CssParser } from '../src/browser/rendering/css5/parser';
import { computeComputedStyles } from '../src/browser/rendering/css5/cascade';
import type { StyleableElement } from '../src/browser/rendering/css5/cascade';

function tree(): { root: StyleableElement; el: StyleableElement } {
  const root: StyleableElement = { tagName: 'div', attributes: new Map([['class', 'Wrap']]), parent: null, children: [] };
  const el: StyleableElement = { tagName: 'P', attributes: new Map([['id', 'x'], ['class', 'Note big'], ['data-k', 'v']]), parent: root, children: [] };
  root.children.push(el);
  return { root, el };
}
const styles = (css: string, width = 800) => {
  const { el } = tree();
  return computeComputedStyles(el, new CssParser().parseStylesheet(css), { width, height: 600 });
};

describe('cascade rule index', () => {
  it('matches classes case-insensitively, tags in any case, and ids', () => {
    const s = styles('.note { color: red } p.BIG { margin-top: 3px } #x { padding-left: 4px }');
    expect(s.get('color')).toBe('#ff0000');
    expect(s.get('margin-top')).toBe('3px');
    expect(s.get('padding-left')).toBe('4px');
  });

  it('keeps rules with no plain key (:is(), attributes, *) and source order across buckets', () => {
    const s = styles(':is(p) { color: blue } [data-k="v"] { margin-top: 1px } * { padding-left: 2px } .note { color: green } p { color: black }');
    expect(s.get('margin-top')).toBe('1px');
    expect(s.get('padding-left')).toBe('2px');
    expect(s.get('color')).toBe('#008000'); // .note (0,1,0) beats p and :is(p) (0,0,1), whatever bucket each is in
  });

  it('re-evaluates @media when the viewport changes, and never mixes up two stylesheets', () => {
    const css = '@media (max-width: 500px) { .note { color: red } } .note { margin-top: 1px }';
    const sheet = new CssParser().parseStylesheet(css);
    const { el } = tree();
    expect(computeComputedStyles(el, sheet, { width: 400, height: 600 }).get('color')).toBe('#ff0000');
    expect(computeComputedStyles(el, sheet, { width: 900, height: 600 }).get('color')).not.toBe('#ff0000');
    expect(styles('.note { color: purple }').get('color')).toBe('#800080');
  });
});
