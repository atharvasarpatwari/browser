import type { IDisposable } from '../../app/dependency-container';
import type { HtmlDocument, HtmlElement, HtmlNode, NodeType } from '../rendering/html-parser';
import type { IJsRuntimeBridge } from './js-runtime-bridge';

type DomEventType =
  | 'click' | 'dblclick' | 'mousedown' | 'mouseup' | 'mousemove'
  | 'keydown' | 'keyup' | 'keypress'
  | 'focus' | 'blur' | 'change' | 'input' | 'submit'
  | 'scroll' | 'resize' | 'load' | 'error' | 'unload';

interface DomEvent {
  readonly type: DomEventType;
  readonly target: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly timestamp: number;
  readonly data: Readonly<Record<string, unknown>>;
}

interface DomEventListener {
  readonly type: DomEventType;
  readonly elementId: string;
  readonly callback: string;
  readonly capture: boolean;
  readonly once: boolean;
}

interface IDomBindings extends IDisposable {
  attachToDocument(document: HtmlDocument, runtime: IJsRuntimeBridge): void;
  detachDocument(): void;
  getElementById(id: string): HtmlElement | null;
  getElementsByTagName(tagName: string): readonly HtmlElement[];
  getElementAttribute(elementId: string, attr: string): string | null;
  setElementAttribute(elementId: string, attr: string, value: string): void;
  addEventListener(elementId: string, type: DomEventType, callback: string, options?: AddEventListenerOptions): void;
  removeEventListener(elementId: string, type: DomEventType, callback: string): void;
  dispatchEvent(event: DomEvent): boolean;
  getAttachedDocument(): HtmlDocument | null;
}

interface AddEventListenerOptions {
  readonly capture?: boolean;
  readonly once?: boolean;
}

let _domIdSeq = 0;
function nextDomElementId(): string {
  return `el-${(++_domIdSeq).toString(36)}`;
}

class DomBindings implements IDomBindings {
  private document: HtmlDocument | null = null;
  private runtime: IJsRuntimeBridge | null = null;
  private readonly elementMap = new Map<string, HtmlElement>();
  private readonly eventListeners = new Map<string, DomEventListener[]>();
  private readonly elementIdAttr = new Map<string, Map<string, string>>();

  attachToDocument(doc: HtmlDocument, runtime: IJsRuntimeBridge): void {
    this.document = doc;
    this.runtime = runtime;
    this.elementMap.clear();
    this.indexElements(doc);

    runtime.setGlobalProperty('document', this.createDocumentProxy());
    runtime.setGlobalProperty('getElementById', (id: string) => this.getElementById(id));
    runtime.setGlobalProperty('addEventListener', (type: string, callback: string) => {
      this.addEventListener('window', type as DomEventType, callback);
    });
  }

  detachDocument(): void {
    this.document = null;
    this.runtime = null;
    this.elementMap.clear();
    this.eventListeners.clear();
    this.elementIdAttr.clear();
  }

  getElementById(id: string): HtmlElement | null {
    for (const el of this.elementMap.values()) {
      if (el.attributes.get('id') === id) return el;
    }
    return null;
  }

  getElementsByTagName(tagName: string): readonly HtmlElement[] {
    const lower = tagName.toLowerCase();
    return [...this.elementMap.values()].filter(el => el.tagName === lower);
  }

  getElementAttribute(elementId: string, attr: string): string | null {
    const attrs = this.elementIdAttr.get(elementId);
    return attrs?.get(attr) ?? null;
  }

  setElementAttribute(elementId: string, attr: string, value: string): void {
    let attrs = this.elementIdAttr.get(elementId);
    if (!attrs) {
      attrs = new Map();
      this.elementIdAttr.set(elementId, attrs);
    }
    attrs.set(attr, value);
  }

  addEventListener(elementId: string, type: DomEventType, callback: string, options?: AddEventListenerOptions): void {
    if (!this.eventListeners.has(elementId)) {
      this.eventListeners.set(elementId, []);
    }
    this.eventListeners.get(elementId)!.push({
      type,
      elementId,
      callback,
      capture: options?.capture ?? false,
      once: options?.once ?? false,
    });
  }

  removeEventListener(elementId: string, type: DomEventType, callback: string): void {
    const listeners = this.eventListeners.get(elementId);
    if (!listeners) return;

    const filtered = listeners.filter(
      l => !(l.type === type && l.callback === callback),
    );

    if (filtered.length > 0) {
      this.eventListeners.set(elementId, filtered);
    } else {
      this.eventListeners.delete(elementId);
    }
  }

  dispatchEvent(event: DomEvent): boolean {
    const listeners = this.eventListeners.get(event.target);
    if (!listeners) return true;

    let prevented = false;
    const relevant = listeners.filter(l => l.type === event.type);

    for (const listener of relevant) {
      try {
        if (this.runtime) {
          const callback = this.runtime.getGlobalProperty(listener.callback);
          if (typeof callback === 'function') {
            const result = (callback as (e: unknown) => boolean | void)(event);
            if (result === false) prevented = true;
          }
        }
      } catch (err) {
        console.error(`[DomBindings] Event handler "${listener.callback}" threw:`, err);
      }

      if (listener.once) {
        this.removeEventListener(event.target, event.type, listener.callback);
      }
    }

    return !prevented;
  }

  getAttachedDocument(): HtmlDocument | null {
    return this.document;
  }

  private indexElements(node: HtmlDocument | HtmlNode, parentId?: string): void {
    if (node.nodeType === 'element' as NodeType) {
      const el = node as HtmlElement;
      const id = nextDomElementId();
      this.elementMap.set(id, el);
      this.elementIdAttr.set(id, new Map(el.attributes));

      for (const child of el.children) {
        this.indexElements(child, id);
      }
    }
  }

  private createDocumentProxy(): Record<string, unknown> {
    return {
      getElementById: (id: string) => this.getElementById(id),
      getElementsByTagName: (tag: string) => this.getElementsByTagName(tag),
      addEventListener: (type: string, cb: string) =>
        this.addEventListener('document', type as DomEventType, cb),
      createElement: (tag: string) => ({
        tagName: tag,
        attributes: new Map<string, string>(),
        children: [],
        setAttribute: (attr: string, value: string) => {},
        appendChild: () => {},
      }),
    };
  }

  dispose(): void {
    this.detachDocument();
  }
}

export { DomBindings };
export type { IDomBindings, DomEvent, DomEventType, DomEventListener };
