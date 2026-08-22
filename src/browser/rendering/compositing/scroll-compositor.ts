import type { CompositingLayer } from './compositing-layer';
import { type DOMMatrix4x4, identity4x4, translate3D, multiply4x4 } from '../transform-parser';

export interface ScrollableContainer {
  readonly id: string;
  elementId: string;
  scrollX: number;
  scrollY: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  overflowX: 'visible' | 'hidden' | 'scroll' | 'auto';
  overflowY: 'visible' | 'hidden' | 'scroll' | 'auto';
  onScroll: ((x: number, y: number) => void) | null;
}

export const DEFAULT_CONTAINER: ScrollableContainer = {
  id: 'viewport',
  elementId: 'viewport',
  scrollX: 0,
  scrollY: 0,
  scrollWidth: 1920,
  scrollHeight: 1080,
  clientWidth: 1920,
  clientHeight: 1080,
  overflowX: 'visible',
  overflowY: 'visible',
  onScroll: null,
};

export function createScrollableContainer(
  id: string,
  elementId: string,
  scrollWidth: number,
  scrollHeight: number,
  clientWidth: number,
  clientHeight: number,
  overflowX: 'visible' | 'hidden' | 'scroll' | 'auto' = 'auto',
  overflowY: 'visible' | 'hidden' | 'scroll' | 'auto' = 'auto',
): ScrollableContainer {
  return {
    id,
    elementId,
    scrollX: 0,
    scrollY: 0,
    scrollWidth,
    scrollHeight,
    clientWidth,
    clientHeight,
    overflowX,
    overflowY,
    onScroll: null,
  };
}

export function clampScroll(container: ScrollableContainer, x: number, y: number): { x: number; y: number } {
  const maxX = Math.max(0, container.scrollWidth - container.clientWidth);
  const maxY = Math.max(0, container.scrollHeight - container.clientHeight);
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  };
}

export function scrollTo(container: ScrollableContainer, x: number, y: number): void {
  const clamped = clampScroll(container, x, y);
  if (clamped.x !== container.scrollX || clamped.y !== container.scrollY) {
    container.scrollX = clamped.x;
    container.scrollY = clamped.y;
    if (container.onScroll) {
      container.onScroll(clamped.x, clamped.y);
    }
  }
}

export function scrollBy(container: ScrollableContainer, dx: number, dy: number): void {
  scrollTo(container, container.scrollX + dx, container.scrollY + dy);
}

export function getScrollTransform(container: ScrollableContainer): DOMMatrix4x4 {
  return translate3D(-container.scrollX, -container.scrollY, 0);
}

export function getMaxScrollX(container: ScrollableContainer): number {
  return Math.max(0, container.scrollWidth - container.clientWidth);
}

export function getMaxScrollY(container: ScrollableContainer): number {
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

export function isScrollable(container: ScrollableContainer): boolean {
  return container.overflowX === 'scroll' || container.overflowX === 'auto' ||
    container.overflowY === 'scroll' || container.overflowY === 'auto';
}

export class ScrollCompositor {
  private _containers = new Map<string, ScrollableContainer>();
  private _layerContainerMap = new Map<string, string>();
  private _onScrollCallbacks = new Map<string, (x: number, y: number) => void>();

  registerContainer(container: ScrollableContainer): void {
    this._containers.set(container.id, container);
  }

  unregisterContainer(containerId: string): void {
    this._containers.delete(containerId);
    for (const [layerId, cId] of this._layerContainerMap) {
      if (cId === containerId) this._layerContainerMap.delete(layerId);
    }
  }

  getContainer(containerId: string): ScrollableContainer | undefined {
    return this._containers.get(containerId);
  }

  getContainers(): readonly ScrollableContainer[] {
    return [...this._containers.values()];
  }

  assignLayerToContainer(layerId: string, containerId: string): void {
    this._layerContainerMap.set(layerId, containerId);
  }

  unassignLayer(layerId: string): void {
    this._layerContainerMap.delete(layerId);
  }

  getContainerForLayer(layerId: string): ScrollableContainer | undefined {
    const cId = this._layerContainerMap.get(layerId);
    return cId ? this._containers.get(cId) : undefined;
  }

  getContainerByElementId(elementId: string): ScrollableContainer | undefined {
    for (const container of this._containers.values()) {
      if (container.elementId === elementId) return container;
    }
    return undefined;
  }

  applyScrollOffset(layer: CompositingLayer, existingTransform: DOMMatrix4x4 | null): DOMMatrix4x4 {
    const container = this.getContainerForLayer(layer.id);
    if (!container) return existingTransform ?? identity4x4();

    const scrollTransform = getScrollTransform(container);
    if (!existingTransform || isIdentity(existingTransform)) {
      return scrollTransform;
    }
    return multiply4x4(existingTransform, scrollTransform);
  }

  onScroll(containerId: string, callback: (x: number, y: number) => void): void {
    const container = this._containers.get(containerId);
    if (container) {
      container.onScroll = callback;
    }
    this._onScrollCallbacks.set(containerId, callback);
  }

  clear(): void {
    this._containers.clear();
    this._layerContainerMap.clear();
    this._onScrollCallbacks.clear();
  }

  scrollLayerIntoView(layerId: string, extraX: number = 0, extraY: number = 0): void {
    for (const [lid, cId] of this._layerContainerMap) {
      if (lid === layerId) {
        const container = this._containers.get(cId);
        if (!container) return;
        const containerForView = this._containers.get(container.elementId) ?? this._containers.get('viewport');
        if (containerForView) {
          scrollTo(containerForView, extraX, extraY);
        }
        return;
      }
    }
  }

  dispose(): void {
    this.clear();
  }
}

function isIdentity(m: DOMMatrix4x4): boolean {
  return m.m11 === 1 && m.m12 === 0 && m.m13 === 0 && m.m14 === 0 &&
    m.m21 === 0 && m.m22 === 1 && m.m23 === 0 && m.m24 === 0 &&
    m.m31 === 0 && m.m32 === 0 && m.m33 === 1 && m.m34 === 0 &&
    m.m41 === 0 && m.m42 === 0 && m.m43 === 0 && m.m44 === 1;
}
