export interface SourceFile {
  id: string;
  url: string;
  content: string;
  mimeType: string;
  lineCount: number;
}

export interface Breakpoint {
  id: string;
  sourceId: string;
  line: number;
  column: number;
  enabled: boolean;
  condition?: string;
  hitCount: number;
}

export interface CallFrame {
  name: string;
  sourceId: string;
  line: number;
  column: number;
  scope: VariableScope[];
}

export interface VariableScope {
  name: string;
  type: 'local' | 'closure' | 'global' | 'block';
  variables: Array<{ name: string; value: string }>;
}

export type SourceEventType =
  | 'sourceAdded' | 'sourceRemoved'
  | 'breakpointChanged' | 'breakpointHit'
  | 'paused' | 'resumed'
  | 'cleared';

export interface SourceEvent {
  kind: SourceEventType;
  source?: SourceFile;
  breakpoint?: Breakpoint;
  callFrame?: CallFrame;
}

export type SourceEventHandler = (event: SourceEvent) => void;

export class SourcesDebugger {
  private sources = new Map<string, SourceFile>();
  private breakpoints = new Map<string, Breakpoint>();
  private handlers = new Set<SourceEventHandler>();
  private pausedState = false;
  private currentCallStack: CallFrame[] = [];
  private bpCounter = 0;

  addSource(url: string, content: string, mimeType = 'text/javascript'): SourceFile {
    const id = `src-${this.sources.size + 1}`;
    const file: SourceFile = { id, url, content, mimeType, lineCount: content.split('\n').length };
    this.sources.set(id, file);
    this.emit({ kind: 'sourceAdded', source: file });
    return file;
  }

  removeSource(id: string): void {
    const src = this.sources.get(id);
    if (!src) return;
    this.sources.delete(id);
    for (const [bpId, bp] of this.breakpoints) {
      if (bp.sourceId === id) this.breakpoints.delete(bpId);
    }
    this.emit({ kind: 'sourceRemoved', source: src });
  }

  getSources(): SourceFile[] { return [...this.sources.values()]; }

  getSource(id: string): SourceFile | undefined { return this.sources.get(id); }

  addBreakpoint(sourceId: string, line: number, column = 0, condition?: string): Breakpoint {
    this.bpCounter++;
    const bp: Breakpoint = {
      id: `bp-${this.bpCounter}`,
      sourceId, line, column, enabled: true, condition, hitCount: 0,
    };
    this.breakpoints.set(bp.id, bp);
    this.emit({ kind: 'breakpointChanged', breakpoint: bp });
    return bp;
  }

  removeBreakpoint(id: string): void {
    const bp = this.breakpoints.get(id);
    if (!bp) return;
    this.breakpoints.delete(id);
    this.emit({ kind: 'breakpointChanged', breakpoint: { ...bp, enabled: false } });
  }

  toggleBreakpoint(id: string): void {
    const bp = this.breakpoints.get(id);
    if (!bp) return;
    bp.enabled = !bp.enabled;
    this.emit({ kind: 'breakpointChanged', breakpoint: bp });
  }

  getBreakpoints(): Breakpoint[] { return [...this.breakpoints.values()]; }

  getBreakpointsForSource(sourceId: string): Breakpoint[] {
    return this.getBreakpoints().filter(b => b.sourceId === sourceId);
  }

  hitBreakpoint(bpId: string): void {
    const bp = this.breakpoints.get(bpId);
    if (!bp || !bp.enabled) return;
    bp.hitCount++;
    this.emit({ kind: 'breakpointHit', breakpoint: bp });
  }

  pause(callStack: CallFrame[]): void {
    this.pausedState = true;
    this.currentCallStack = callStack;
    this.emit({ kind: 'paused', callFrame: callStack[0] });
  }

  resume(): void {
    this.pausedState = false;
    this.currentCallStack = [];
    this.emit({ kind: 'resumed' });
  }

  isPaused(): boolean { return this.pausedState; }

  getCallStack(): CallFrame[] { return [...this.currentCallStack]; }

  search(query: string, inSourceId?: string): Array<{ sourceId: string; line: number; text: string }> {
    const results: Array<{ sourceId: string; line: number; text: string }> = [];
    const q = query.toLowerCase();
    for (const src of this.sources.values()) {
      if (inSourceId && src.id !== inSourceId) continue;
      const lines = src.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          results.push({ sourceId: src.id, line: i + 1, text: lines[i].trim() });
        }
      }
    }
    return results;
  }

  clear(): void {
    this.sources.clear();
    this.breakpoints.clear();
    this.currentCallStack = [];
    this.pausedState = false;
    this.bpCounter = 0;
    this.emit({ kind: 'cleared' });
  }

  onEvent(handler: SourceEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  dispose(): void {
    this.clear();
    this.handlers.clear();
  }

  private emit(event: SourceEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { }
    }
  }
}
