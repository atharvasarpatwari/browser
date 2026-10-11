import type { DomDocument, DomElement, DomNode, TextRun } from '../rendering/dom-tree';
import type { FindBlock, FindRun, FindTextSource } from './find-in-page';

/**
 * The layout engine emits one run per word and one per space, so a run's advance width is the
 * distance to the next run on the same baseline; the last run on a line falls back to the
 * engine's estimate.
 */
function toFindRuns(runs: readonly TextRun[]): FindRun[] {
  return runs.map((r, i) => {
    const next = runs[i + 1];
    const sameLine = next !== undefined && Math.abs(next.y - r.y) < r.fontSize * 0.5 && next.x > r.x;
    // The width layout gave the run, when it recorded one; otherwise the distance to the next run on the line.
    const width = r.width ?? (sameLine ? next.x - r.x : undefined);
    return { text: r.text, x: r.x, y: r.y, fontSize: r.fontSize, ...(width !== undefined ? { width } : {}) };
  });
}

/** Text runs of every laid-out box, in document order (iterative: safe on very deep DOMs). */
function collectBlocks(root: DomNode): FindBlock[] {
  const blocks: FindBlock[] = [];
  const stack: DomNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.nodeType === 'element') {
      const runs = (node as DomElement).layoutBox?.textRuns;
      if (runs && runs.length > 0) blocks.push({ runs: toFindRuns(runs) });
    }
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
  return blocks;
}

/** Find-in-page text source backed by the current page's laid-out DOM (re-read on every search). */
function createDomFindSource(getDocument: () => DomDocument | null): FindTextSource {
  return {
    getBlocks() {
      const doc = getDocument();
      return doc ? collectBlocks(doc) : [];
    },
  };
}

export { createDomFindSource, collectBlocks };
