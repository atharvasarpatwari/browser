import { describe, it, expect, beforeEach } from 'vitest';
import { DevToolsPanel } from '../src/ui/components/devtools-panel/devtools-panel';
import type { IDomTree, DomDocument, DomElement } from '../src/browser/rendering/dom-tree';

function makeElement(tagName: string, attributes: Record<string, string> = {}, children: DomElement[] = []): DomElement {
  const el = {
    domId: `el-${tagName}-${Math.random()}`,
    nodeType: 'element' as const,
    tagName,
    attributes: new Map(Object.entries(attributes)),
    parent: null,
    children,
  } as unknown as DomElement;
  for (const child of children) (child as { parent: unknown }).parent = el;
  return el;
}

function makeDocTree(rootChildren: DomElement[]): IDomTree {
  const doc = {
    domId: 'doc-1',
    nodeType: 'document' as const,
    parent: null,
    children: rootChildren,
  } as unknown as DomDocument;
  for (const child of rootChildren) (child as { parent: unknown }).parent = doc;
  return { getDocument: () => doc } as unknown as IDomTree;
}

function findTabButton(container: HTMLElement, label: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label);
  if (!btn) throw new Error(`no button labeled "${label}"`);
  return btn as HTMLButtonElement;
}

describe('DevToolsPanel — Accessibility tab', () => {
  let panel: DevToolsPanel;
  let container: HTMLElement;

  beforeEach(() => {
    panel = new DevToolsPanel();
    container = document.createElement('div');
    panel.attach(container);
  });

  it('renders a missing-alt issue for an <img> with no alt/aria-label', () => {
    const img = makeElement('img', { src: 'x.png' });
    panel.setDomTreeProvider(() => makeDocTree([img]));

    findTabButton(container, 'Accessibility').click();

    expect(container.textContent).toContain('ERROR');
    expect(container.textContent).toContain('<img>');
    expect(container.textContent).toContain('Image without alt text');
  });

  it('renders "No accessibility issues found." for a clean tree', () => {
    const div = makeElement('div', { id: 'main' });
    panel.setDomTreeProvider(() => makeDocTree([div]));

    findTabButton(container, 'Accessibility').click();

    expect(container.textContent).toContain('No accessibility issues found.');
  });

  it('renders "(no page loaded)" when no DOM tree provider is set', () => {
    findTabButton(container, 'Accessibility').click();

    expect(container.textContent).toContain('(no page loaded)');
  });

  it('Refresh re-runs the audit while the Accessibility tab is active', () => {
    let tree: IDomTree = makeDocTree([makeElement('div')]);
    panel.setDomTreeProvider(() => tree);
    findTabButton(container, 'Accessibility').click();
    expect(container.textContent).toContain('No accessibility issues found.');

    tree = makeDocTree([makeElement('img', { src: 'x.png' })]);
    findTabButton(container, 'Refresh').click();

    expect(container.textContent).toContain('Image without alt text');
  });

  it('Clear re-runs the audit (not the Elements tree) while the Accessibility tab is active', () => {
    const img = makeElement('img', { src: 'x.png' });
    panel.setDomTreeProvider(() => makeDocTree([img]));
    findTabButton(container, 'Accessibility').click();

    findTabButton(container, 'Clear').click();

    expect(container.textContent).toContain('Image without alt text');
  });
});
