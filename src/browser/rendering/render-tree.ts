import type { DomElement, LayoutBox, TextRun } from './dom-tree';
import type { PaintCommand, PaintCommandType } from './paint-engine';

export type RenderObjectType = 'block' | 'inline' | 'text' | 'image' | 'replaced' | 'svg';

export interface RenderObject {
  readonly id: string;
  readonly nodeType: RenderObjectType;
  readonly element: DomElement | null;
  readonly layoutBox: LayoutBox | null;
  readonly children: RenderObject[];
  readonly textRuns: TextRun[];
  readonly zIndex: number;
  readonly opacity: number;
  readonly isPositioned: boolean;
  readonly createsStackingContext: boolean;
  readonly clipRect: { x: number; y: number; w: number; h: number } | null;
  readonly visible: boolean;
}

export interface PaintLayerInfo {
  readonly id: string;
  readonly zIndex: number;
  readonly opacity: number;
  readonly blendMode: string;
  readonly clipPath: string;
  readonly filter: string;
  readonly mask: string;
  readonly bounds: LayoutBox | null;
  readonly commands: PaintCommand[];
}

let _renderId = 0;
function nextRenderId(): string {
  return `ro-${(++_renderId).toString(36)}`;
}

export function buildRenderObject(element: DomElement): RenderObject {
  const style = element.computedStyle ?? new Map();
  const display = style.get('display') ?? 'inline';
  const position = style.get('position') ?? 'static';
  const isPos = position === 'relative' || position === 'absolute' || position === 'fixed' || position === 'sticky';
  const displayNone = display === 'none';
  const zRaw = style.get('z-index');
  const zIndex = zRaw && zRaw !== 'auto' ? (parseInt(zRaw, 10) || 0) : 0;
  const opacity = parseFloat(style.get('opacity') ?? '1') || 1;
  const lb: LayoutBox | null = (element as { layoutBox?: LayoutBox }).layoutBox ?? null;

  const hasFilter = (style.get('filter') ?? 'none') !== 'none';
  const hasTransform = (style.get('transform') ?? 'none') !== 'none';
  const scCtx = hasFilter || hasTransform || opacity < 1 || position === 'fixed' || position === 'sticky' ||
    (isPos && zRaw !== 'auto' && zRaw !== undefined) ||
    style.get('mix-blend-mode') !== undefined ||
    style.get('isolation') === 'isolate';

  const children: RenderObject[] = [];
  if (!displayNone && element.children) {
    for (const child of element.children) {
      if (child.nodeType === 'element') {
        children.push(buildRenderObject(child as DomElement));
      }
    }
  }

  const overflow = style.get('overflow') ?? style.get('overflow-x') ?? 'visible';
  let clipRect: { x: number; y: number; w: number; h: number } | null = null;
  if (lb && (overflow === 'hidden' || overflow === 'scroll' || overflow === 'auto')) {
    clipRect = {
      x: lb.x + lb.borderLeft,
      y: lb.y + lb.borderTop,
      w: lb.width - lb.borderLeft - lb.borderRight,
      h: lb.height - lb.borderTop - lb.borderBottom,
    };
  }

  return {
    id: nextRenderId(),
    nodeType: display === 'inline' ? 'inline' : 'block',
    element,
    layoutBox: lb,
    children,
    textRuns: lb?.textRuns ?? [],
    zIndex,
    opacity,
    isPositioned: isPos,
    createsStackingContext: scCtx,
    clipRect,
    visible: !displayNone && opacity > 0 && (lb === null || (lb.width > 0 && lb.height > 0)),
  };
}

export function flattenRenderOrder(root: RenderObject, list: RenderObject[] = []): RenderObject[] {
  const addRecursive = (obj: RenderObject) => {
    if (obj.visible) list.push(obj);
    for (const child of obj.children) {
      if (child.createsStackingContext) {
        addRecursive(child);
      } else {
        for (const gc of child.children) addRecursive(gc);
        if (child.visible) list.push(child);
      }
    }
  };
  addRecursive(root);
  return list;
}

export function sortByPaintOrder(objs: RenderObject[]): RenderObject[] {
  return [...objs].sort((a, b) => {
    if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
    return a.opacity !== b.opacity ? a.opacity - b.opacity : 0;
  });
}

export function getStyleValue(style: ReadonlyMap<string, string> | undefined, name: string, fallback = ''): string {
  return style?.get(name) ?? fallback;
}
