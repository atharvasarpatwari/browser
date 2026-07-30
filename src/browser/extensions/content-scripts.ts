import type { ContentScriptDeclaration, ContentScriptPattern } from './extension-types';

export interface RegisteredContentScript {
  id: string;
  extensionId: string;
  declaration: ContentScriptDeclaration;
  jsCode?: string[];
  cssCode?: string[];
}

export type ContentScriptEventType = 'scriptInjected' | 'registered' | 'unregistered';

export interface ContentScriptEvent {
  kind: ContentScriptEventType;
  extensionId: string;
  scriptId: string;
  tabId?: number;
  url?: string;
}

export type ContentScriptEventHandler = (event: ContentScriptEvent) => void;

export class ContentScriptsManager {
  private scripts = new Map<string, RegisteredContentScript>();
  private handlers = new Set<ContentScriptEventHandler>();
  private counter = 0;

  register(
    extensionId: string,
    declaration: ContentScriptDeclaration,
    jsCode?: string[],
    cssCode?: string[],
  ): RegisteredContentScript {
    this.counter++;
    const id = `cs-${this.counter}`;
    const script: RegisteredContentScript = { id, extensionId, declaration, jsCode, cssCode };
    this.scripts.set(id, script);
    this.emit({ kind: 'registered', extensionId, scriptId: id });
    return script;
  }

  unregister(scriptId: string): boolean {
    const script = this.scripts.get(scriptId);
    if (!script) return false;
    this.scripts.delete(scriptId);
    this.emit({ kind: 'unregistered', extensionId: script.extensionId, scriptId });
    return true;
  }

  unregisterAllForExtension(extensionId: string): void {
    for (const [id, script] of this.scripts) {
      if (script.extensionId === extensionId) {
        this.scripts.delete(id);
        this.emit({ kind: 'unregistered', extensionId, scriptId: id });
      }
    }
  }

  getScriptsForExtension(extensionId: string): RegisteredContentScript[] {
    return [...this.scripts.values()].filter(s => s.extensionId === extensionId);
  }

  getScript(id: string): RegisteredContentScript | undefined {
    return this.scripts.get(id);
  }

  getAllScripts(): RegisteredContentScript[] {
    return [...this.scripts.values()];
  }

  matchesUrl(script: RegisteredContentScript, url: string): boolean {
    for (const pattern of script.declaration.matches) {
      if (matchUrlPattern(pattern, url)) {
        const excluded = script.declaration.excludeMatches?.some(em => matchUrlPattern(em, url)) ?? false;
        if (!excluded) return true;
      }
    }
    return false;
  }

  findMatchingScripts(url: string): RegisteredContentScript[] {
    return this.getAllScripts().filter(s => this.matchesUrl(s, url));
  }

  getJSForScripts(url: string, extensionIds?: string[]): Array<{ extensionId: string; scriptId: string; code: string[] }> {
    const matching = this.findMatchingScripts(url);
    return matching
      .filter(s => !extensionIds || extensionIds.includes(s.extensionId))
      .filter(s => s.jsCode && s.jsCode.length > 0)
      .map(s => ({ extensionId: s.extensionId, scriptId: s.id, code: s.jsCode! }));
  }

  getCSSForScripts(url: string, extensionIds?: string[]): Array<{ extensionId: string; scriptId: string; code: string[] }> {
    const matching = this.findMatchingScripts(url);
    return matching
      .filter(s => !extensionIds || extensionIds.includes(s.extensionId))
      .filter(s => s.cssCode && s.cssCode.length > 0)
      .map(s => ({ extensionId: s.extensionId, scriptId: s.id, code: s.cssCode! }));
  }

  onEvent(handler: ContentScriptEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  clear(): void {
    this.scripts.clear();
    this.counter = 0;
  }

  dispose(): void {
    this.clear();
    this.handlers.clear();
  }

  private emit(event: ContentScriptEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { }
    }
  }
}

export function matchUrlPattern(pattern: string, url: string): boolean {
  if (pattern === '<all_urls>') return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://') || url.startsWith('ws://') || url.startsWith('wss://');

  const matchProtocol = /^(\*|https?|wss?|file|ftp):\/\//.exec(pattern);
  if (!matchProtocol) return false;

  const proto = matchProtocol[1];
  const urlProto = /^([^:]+):/.exec(url)?.[1] ?? '';

  if (proto !== '*' && proto !== urlProto) return false;

  const patternRest = pattern.slice(matchProtocol[0].length);
  const urlRest = url.slice(urlProto.length + 3);

  return matchGlobPattern(patternRest, urlRest);
}

function matchGlobPattern(pattern: string, value: string): boolean {
  const regexStr = '^' + pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  + '$';
  return new RegExp(regexStr).test(value);
}
