import type { IDisposable } from '../../app/dependency-container';

type SVGElementKind = 'svg' | 'g' | 'rect' | 'circle' | 'ellipse' | 'line' | 'polyline' | 'polygon' | 'path' | 'text' | 'tspan' | 'defs' | 'use' | 'image' | 'clipPath' | 'mask' | 'linearGradient' | 'radialGradient' | 'stop' | 'filter' | 'feGaussianBlur';

interface SVGElement {
  readonly kind: SVGElementKind;
  readonly children: SVGElement[];
  attributes: Map<string, string>;
  parent: SVGElement | null;
  append(child: SVGElement): void;
  remove(child: SVGElement): void;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | undefined;
  getBBox(): { x: number; y: number; width: number; height: number };
}

interface ISVGDocument extends IDisposable {
  readonly root: SVGElement;
  readonly width: number;
  readonly height: number;
  viewBox: { x: number; y: number; width: number; height: number } | null;
  createElement(kind: SVGElementKind, attrs?: Record<string, string>): SVGElement;
  createText(content: string): SVGTextData;
  render(): string;
  onEvent(handler: SVGEventHandler): () => void;
}

interface SVGTextData {
  readonly content: string;
}

interface SVGEvent {
  readonly kind: SVGEventKind;
  readonly data?: Record<string, unknown>;
}

type SVGEventKind = 'load' | 'error' | 'render';

type SVGEventHandler = (event: SVGEvent) => void;

function createSVGElement(kind: SVGElementKind, attrs: Record<string, string> = {}): SVGElement {
  const children: SVGElement[] = [];
  const attributes = new Map(Object.entries(attrs));
  const parent: SVGElement | null = null;

  const self: SVGElement = {
    kind,
    children,
    attributes,
    parent,
    append(child: SVGElement) {
      child.parent = self;
      children.push(child);
    },
    remove(child: SVGElement) {
      const idx = children.indexOf(child);
      if (idx >= 0) {
        child.parent = null;
        children.splice(idx, 1);
      }
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    getAttribute(name: string) {
      return attributes.get(name);
    },
    getBBox() {
      const x = parseFloat(attributes.get('x') ?? '0');
      const y = parseFloat(attributes.get('y') ?? '0');
      const w = parseFloat(attributes.get('width') ?? attributes.get('r') ?? '100');
      const h = parseFloat(attributes.get('height') ?? attributes.get('r') ?? '100');
      return { x, y, width: w || 100, height: h || 100 };
    },
  };
  return self;
}

function elementToSVGString(el: SVGElement, indent = ''): string {
  const attrs: string[] = [];
  for (const [k, v] of el.attributes) {
    attrs.push(`${k}="${v.replace(/"/g, '&quot;')}"`);
  }
  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  if (el.children.length === 0) {
    return `${indent}<${el.kind}${attrStr} />`;
  }
  const inner = el.children.map(c => elementToSVGString(c, indent + '  ')).join('\n');
  return `${indent}<${el.kind}${attrStr}>\n${inner}\n${indent}</${el.kind}>`;
}

class SVGDocument implements ISVGDocument {
  private _handlers = new Set<SVGEventHandler>();
  readonly root: SVGElement;
  private _viewBox: { x: number; y: number; width: number; height: number } | null = null;

  constructor(width = 800, height = 600) {
    this.root = createSVGElement('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      width: String(width),
      height: String(height),
    });
    this._viewBox = { x: 0, y: 0, width, height };
  }

  get width(): number {
    return parseInt(this.root.getAttribute('width') ?? '800', 10);
  }

  get height(): number {
    return parseInt(this.root.getAttribute('height') ?? '600', 10);
  }

  get viewBox() { return this._viewBox; }

  set viewBox(vb: { x: number; y: number; width: number; height: number } | null) {
    this._viewBox = vb;
    if (vb) {
      this.root.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
    } else {
      this.root.attributes.delete('viewBox');
    }
  }

  createElement(kind: SVGElementKind, attrs: Record<string, string> = {}): SVGElement {
    return createSVGElement(kind, attrs);
  }

  createText(content: string): SVGTextData {
    return { content };
  }

  render(): string {
    const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
    return header + elementToSVGString(this.root);
  }

  onEvent(handler: SVGEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  private emit(event: SVGEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    while (this.root.children.length > 0) {
      this.root.children.pop();
    }
  }
}

export { SVGDocument, createSVGElement, elementToSVGString };
export type { ISVGDocument, SVGElement, SVGElementKind, SVGEvent, SVGEventKind, SVGEventHandler, SVGTextData };
