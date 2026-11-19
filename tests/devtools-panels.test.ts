import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PerformanceProfiler } from '../src/browser/devtools/performance-panel';
import { MemoryProfiler } from '../src/browser/devtools/memory-panel';
import { SourcesDebugger } from '../src/browser/devtools/sources-panel';
import { StorageInspector } from '../src/browser/devtools/storage-panel';
import { SecurityPanel } from '../src/browser/devtools/security-panel';
import { AccessibilityPanel } from '../src/browser/devtools/accessibility-panel';
import { DevTools } from '../src/browser/devtools/devtools-facade';
import type { A11yDomNode } from '../src/browser/accessibility/screen-reader';

// ══════════════════════════════════════════════════════════════════════════
// 4. PERFORMANCE PROFILER
// ══════════════════════════════════════════════════════════════════════════

describe('PerformanceProfiler', () => {
  let pp: PerformanceProfiler;
  beforeEach(() => { pp = new PerformanceProfiler(); });
  afterEach(() => { pp.dispose(); });

  it('starts with no snapshots', () => {
    expect(pp.getSnapshots()).toHaveLength(0);
  });

  it('starts not recording', () => {
    expect(pp.isRecording()).toBe(false);
  });

  it('addSnapshot adds a snapshot', () => {
    const handler = vi.fn();
    pp.onEvent(handler);
    pp.addSnapshot({ cpuPercent: 45, fps: 30 });
    expect(pp.getSnapshots()).toHaveLength(1);
    expect(pp.getSnapshots()[0].cpuPercent).toBe(45);
    expect(pp.getSnapshots()[0].fps).toBe(30);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'snapshotAdded' }));
  });

  it('startRecording emits recordingStateChanged', () => {
    const handler = vi.fn();
    pp.onEvent(handler);
    pp.startRecording(100);
    expect(pp.isRecording()).toBe(true);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'recordingStateChanged', recording: true }));
    pp.stopRecording();
  });

  it('stopRecording emits recordingStateChanged', () => {
    pp.startRecording(100);
    const handler = vi.fn();
    pp.onEvent(handler);
    pp.stopRecording();
    expect(pp.isRecording()).toBe(false);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'recordingStateChanged', recording: false }));
  });

  it('clear stops recording and removes snapshots', () => {
    pp.addSnapshot();
    pp.startRecording(100);
    const handler = vi.fn();
    pp.onEvent(handler);
    pp.clear();
    expect(pp.getSnapshots()).toHaveLength(0);
    expect(pp.isRecording()).toBe(false);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cleared' }));
  });

  it('exportTimeline returns structured data', () => {
    pp.addSnapshot({ cpuPercent: 10 });
    pp.addSnapshot({ cpuPercent: 20 });
    const timeline = pp.exportTimeline();
    expect(timeline).toHaveProperty('version', '1.0');
    expect(timeline).toHaveProperty('tool', 'NovaBrowser Performance');
    expect((timeline as any).snapshots).toHaveLength(2);
  });

  it('onEvent returns unsubscribe function', () => {
    const handler = vi.fn();
    const unsub = pp.onEvent(handler);
    pp.addSnapshot();
    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
    pp.addSnapshot();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dispose cleans up', () => {
    pp.addSnapshot();
    pp.startRecording(100);
    pp.dispose();
    expect(pp.isRecording()).toBe(false);
    expect(pp.getSnapshots()).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. MEMORY PROFILER
// ══════════════════════════════════════════════════════════════════════════

describe('MemoryProfiler', () => {
  let mp: MemoryProfiler;
  beforeEach(() => { mp = new MemoryProfiler(); });
  afterEach(() => { mp.dispose(); });

  it('starts with no snapshots', () => {
    expect(mp.getSnapshots()).toHaveLength(0);
  });

  it('takeSnapshot creates a snapshot with defaults', () => {
    const snap = mp.takeSnapshot();
    expect(snap.id).toMatch(/^heap-/);
    expect(typeof snap.timestamp).toBe('number');
    expect(snap.totalHeapSize).toBe(0);
  });

  it('takeSnapshot emits snapshotAdded', () => {
    const handler = vi.fn();
    mp.onEvent(handler);
    mp.takeSnapshot({ usedHeapSize: 1024 });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'snapshotAdded' }));
  });

  it('recordGCEvent creates and emits gc event', () => {
    const handler = vi.fn();
    mp.onEvent(handler);
    mp.recordGCEvent({ durationMs: 10, freedBytes: 2048, type: 'major' });
    expect(mp.getGCEvents()).toHaveLength(1);
    expect(mp.getGCEvents()[0].freedBytes).toBe(2048);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'gcEvent' }));
  });

  it('getSnapshot returns by id', () => {
    const s1 = mp.takeSnapshot({ usedHeapSize: 100 });
    const s2 = mp.takeSnapshot({ usedHeapSize: 200 });
    expect(mp.getSnapshot(s1.id)?.usedHeapSize).toBe(100);
    expect(mp.getSnapshot(s2.id)?.usedHeapSize).toBe(200);
    expect(mp.getSnapshot('nonexistent')).toBeUndefined();
  });

  it('compareSnapshots returns delta', () => {
    const s1 = mp.takeSnapshot({ totalHeapSize: 1000, usedHeapSize: 500, nodeCount: 10 });
    const s2 = mp.takeSnapshot({ totalHeapSize: 2000, usedHeapSize: 800, nodeCount: 15 });
    const delta = mp.compareSnapshots(s1.id, s2.id);
    expect(delta).toEqual({ deltaTotal: 1000, deltaUsed: 300, deltaNodes: 5 });
  });

  it('compareSnapshots returns null for invalid ids', () => {
    expect(mp.compareSnapshots('none', 'nope')).toBeNull();
  });

  it('getAllocatedBytes returns 0 with <2 snapshots', () => {
    expect(mp.getAllocatedBytes()).toBe(0);
    mp.takeSnapshot({ usedHeapSize: 100 });
    expect(mp.getAllocatedBytes()).toBe(0);
    mp.takeSnapshot({ usedHeapSize: 300 });
    expect(mp.getAllocatedBytes()).toBe(200);
  });

  it('clear removes all data', () => {
    mp.takeSnapshot();
    mp.recordGCEvent();
    mp.clear();
    expect(mp.getSnapshots()).toHaveLength(0);
    expect(mp.getGCEvents()).toHaveLength(0);
  });

  it('dispose cleans up', () => {
    mp.takeSnapshot();
    mp.dispose();
    expect(mp.getSnapshots()).toHaveLength(0);
  });

  it('onEvent unsubscribe works', () => {
    const h = vi.fn();
    const unsub = mp.onEvent(h);
    mp.takeSnapshot();
    expect(h).toHaveBeenCalledTimes(1);
    unsub();
    mp.takeSnapshot();
    expect(h).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. SOURCES DEBUGGER
// ══════════════════════════════════════════════════════════════════════════

describe('SourcesDebugger', () => {
  let sd: SourcesDebugger;
  beforeEach(() => { sd = new SourcesDebugger(); });
  afterEach(() => { sd.dispose(); });

  it('addSource creates a source file', () => {
    const src = sd.addSource('http://example.com/app.js', 'const x = 1;');
    expect(src.url).toBe('http://example.com/app.js');
    expect(src.lineCount).toBe(1);
    expect(sd.getSources()).toHaveLength(1);
  });

  it('addSource emits sourceAdded', () => {
    const handler = vi.fn();
    sd.onEvent(handler);
    sd.addSource('http://example.com/test.js', 'hello');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sourceAdded' }));
  });

  it('removeSource deletes source and its breakpoints', () => {
    const src = sd.addSource('http://example.com/a.js', 'code');
    sd.addBreakpoint(src.id, 1);
    sd.removeSource(src.id);
    expect(sd.getSources()).toHaveLength(0);
    expect(sd.getBreakpoints()).toHaveLength(0);
  });

  it('getSource returns by id', () => {
    const src = sd.addSource('http://example.com/b.js', 'x');
    expect(sd.getSource(src.id)?.url).toBe('http://example.com/b.js');
    expect(sd.getSource('nope')).toBeUndefined();
  });

  it('addBreakpoint creates an enabled breakpoint', () => {
    const src = sd.addSource('http://example.com/c.js', 'line1\nline2');
    const bp = sd.addBreakpoint(src.id, 2);
    expect(bp.line).toBe(2);
    expect(bp.enabled).toBe(true);
    expect(bp.hitCount).toBe(0);
    expect(sd.getBreakpoints()).toHaveLength(1);
  });

  it('addBreakpoint emits breakpointChanged', () => {
    const handler = vi.fn();
    sd.onEvent(handler);
    const src = sd.addSource('http://example.com/d.js', 'x');
    sd.addBreakpoint(src.id, 1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'breakpointChanged' }));
  });

  it('removeBreakpoint removes and emits', () => {
    const src = sd.addSource('http://example.com/e.js', 'x');
    const bp = sd.addBreakpoint(src.id, 1);
    const handler = vi.fn();
    sd.onEvent(handler);
    sd.removeBreakpoint(bp.id);
    expect(sd.getBreakpoints()).toHaveLength(0);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'breakpointChanged' }));
  });

  it('toggleBreakpoint toggles enabled', () => {
    const src = sd.addSource('http://example.com/f.js', 'x');
    const bp = sd.addBreakpoint(src.id, 1);
    expect(bp.enabled).toBe(true);
    sd.toggleBreakpoint(bp.id);
    expect(bp.enabled).toBe(false);
    sd.toggleBreakpoint(bp.id);
    expect(bp.enabled).toBe(true);
  });

  it('getBreakpointsForSource filters by source', () => {
    const s1 = sd.addSource('http://example.com/g.js', 'x');
    const s2 = sd.addSource('http://example.com/h.js', 'y');
    sd.addBreakpoint(s1.id, 1);
    sd.addBreakpoint(s2.id, 2);
    sd.addBreakpoint(s1.id, 3);
    expect(sd.getBreakpointsForSource(s1.id)).toHaveLength(2);
    expect(sd.getBreakpointsForSource(s2.id)).toHaveLength(1);
  });

  it('hitBreakpoint increments count and emits', () => {
    const src = sd.addSource('http://example.com/i.js', 'x');
    const bp = sd.addBreakpoint(src.id, 1);
    const handler = vi.fn();
    sd.onEvent(handler);
    sd.hitBreakpoint(bp.id);
    expect(bp.hitCount).toBe(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'breakpointHit' }));
  });

  it('hitBreakpoint ignores disabled breakpoint', () => {
    const src = sd.addSource('http://example.com/j.js', 'x');
    const bp = sd.addBreakpoint(src.id, 1);
    sd.toggleBreakpoint(bp.id);
    sd.hitBreakpoint(bp.id);
    expect(bp.hitCount).toBe(0);
  });

  it('pause sets state and emits', () => {
    const handler = vi.fn();
    sd.onEvent(handler);
    sd.pause([{ name: 'test', sourceId: 's1', line: 5, column: 0, scope: [] }]);
    expect(sd.isPaused()).toBe(true);
    expect(sd.getCallStack()).toHaveLength(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'paused' }));
  });

  it('resume clears state and emits', () => {
    sd.pause([{ name: 'test', sourceId: 's1', line: 1, column: 0, scope: [] }]);
    const handler = vi.fn();
    sd.onEvent(handler);
    sd.resume();
    expect(sd.isPaused()).toBe(false);
    expect(sd.getCallStack()).toHaveLength(0);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resumed' }));
  });

  it('search finds text in sources', () => {
    sd.addSource('http://example.com/a.js', 'function hello() { return 1; }');
    sd.addSource('http://example.com/b.js', 'const world = 2;');
    expect(sd.search('hello')).toHaveLength(1);
    expect(sd.search('world')).toHaveLength(1);
    expect(sd.search('notfound')).toHaveLength(0);
  });

  it('search filters by source', () => {
    const src = sd.addSource('http://example.com/a.js', 'function test() { }');
    sd.addSource('http://example.com/b.js', 'test something else');
    expect(sd.search('test', src.id)).toHaveLength(1);
  });

  it('clear removes everything', () => {
    sd.addSource('http://example.com/a.js', 'x');
    sd.addBreakpoint('src-1', 1);
    sd.clear();
    expect(sd.getSources()).toHaveLength(0);
    expect(sd.getBreakpoints()).toHaveLength(0);
    expect(sd.isPaused()).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 7. STORAGE INSPECTOR
// ══════════════════════════════════════════════════════════════════════════

describe('StorageInspector', () => {
  let si: StorageInspector;
  beforeEach(() => { si = new StorageInspector(); });
  afterEach(() => { si.dispose(); });

  it('starts with no origins', () => {
    expect(si.getOrigins()).toHaveLength(0);
  });

  it('addOrigin creates origin', () => {
    const handler = vi.fn();
    si.onEvent(handler);
    si.addOrigin('https://example.com');
    expect(si.getOrigins()).toHaveLength(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'originAdded', origin: 'https://example.com' }));
  });

  it('addOrigin is idempotent', () => {
    si.addOrigin('https://example.com');
    si.addOrigin('https://example.com');
    expect(si.getOrigins()).toHaveLength(1);
  });

  it('removeOrigin removes and emits', () => {
    si.addOrigin('https://example.com');
    const handler = vi.fn();
    si.onEvent(handler);
    si.removeOrigin('https://example.com');
    expect(si.getOrigins()).toHaveLength(0);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'originRemoved' }));
  });

  it('getOrigin returns by origin', () => {
    expect(si.getOrigin('https://x.com')).toBeUndefined();
    si.addOrigin('https://x.com');
    expect(si.getOrigin('https://x.com')).toBeDefined();
  });

  it('setLocalStorageItem adds entry', () => {
    const handler = vi.fn();
    si.onEvent(handler);
    si.setLocalStorageItem('https://example.com', 'key1', 'value1');
    const origin = si.getOrigin('https://example.com')!;
    expect(origin.localStorage).toHaveLength(1);
    expect(origin.localStorage[0].key).toBe('key1');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'entryUpdated', store: 'localStorage' }));
  });

  it('setLocalStorageItem updates existing entry', () => {
    si.setLocalStorageItem('https://example.com', 'key1', 'old');
    si.setLocalStorageItem('https://example.com', 'key1', 'new');
    const origin = si.getOrigin('https://example.com')!;
    expect(origin.localStorage).toHaveLength(1);
    expect(origin.localStorage[0].value).toBe('new');
  });

  it('removeLocalStorageItem removes entry', () => {
    si.setLocalStorageItem('https://example.com', 'key1', 'v1');
    si.setLocalStorageItem('https://example.com', 'key2', 'v2');
    si.removeLocalStorageItem('https://example.com', 'key1');
    const origin = si.getOrigin('https://example.com')!;
    expect(origin.localStorage).toHaveLength(1);
    expect(origin.localStorage[0].key).toBe('key2');
  });

  it('setSessionStorageItem adds entry', () => {
    si.setSessionStorageItem('https://example.com', 'skey', 'svalue');
    expect(si.getOrigin('https://example.com')!.sessionStorage).toHaveLength(1);
  });

  it('removeSessionStorageItem removes entry', () => {
    si.setSessionStorageItem('https://example.com', 'skey', 'sv');
    si.removeSessionStorageItem('https://example.com', 'skey');
    expect(si.getOrigin('https://example.com')!.sessionStorage).toHaveLength(0);
  });

  it('addCookie adds cookie', () => {
    si.addCookie('https://example.com', { name: 'session', value: 'abc123', domain: '.example.com', path: '/', expires: null, secure: true, httpOnly: true, sameSite: 'lax' });
    expect(si.getOrigin('https://example.com')!.cookies).toHaveLength(1);
  });

  it('removeCookie removes cookie', () => {
    si.addCookie('https://example.com', { name: 'c1', value: 'v1', domain: '.ex.com', path: '/', expires: null, secure: false, httpOnly: false, sameSite: 'lax' });
    si.removeCookie('https://example.com', 'c1');
    expect(si.getOrigin('https://example.com')!.cookies).toHaveLength(0);
  });

  it('addDatabase registers database', () => {
    si.addDatabase('https://example.com', { name: 'mydb', version: 1, objectStores: ['users', 'posts'] });
    expect(si.getOrigin('https://example.com')!.databases).toHaveLength(1);
    expect(si.getOrigin('https://example.com')!.databases[0].name).toBe('mydb');
  });

  it('addDatabase updates existing', () => {
    si.addDatabase('https://example.com', { name: 'mydb', version: 1, objectStores: ['users'] });
    si.addDatabase('https://example.com', { name: 'mydb', version: 2, objectStores: ['users', 'posts'] });
    expect(si.getOrigin('https://example.com')!.databases[0].version).toBe(2);
  });

  it('clearOrigin empties all stores for origin', () => {
    si.setLocalStorageItem('https://example.com', 'k', 'v');
    si.clearOrigin('https://example.com');
    const origin = si.getOrigin('https://example.com')!;
    expect(origin.localStorage).toHaveLength(0);
    expect(origin.sessionStorage).toHaveLength(0);
    expect(origin.cookies).toHaveLength(0);
    expect(origin.databases).toHaveLength(0);
  });

  it('clear removes all origins', () => {
    si.addOrigin('https://a.com');
    si.addOrigin('https://b.com');
    si.clear();
    expect(si.getOrigins()).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 8. SECURITY PANEL
// ══════════════════════════════════════════════════════════════════════════

describe('SecurityPanel', () => {
  let sp: SecurityPanel;
  beforeEach(() => { sp = new SecurityPanel(); });
  afterEach(() => { sp.dispose(); });

  it('starts with unknown summary', () => {
    expect(sp.getSummary()).toBe('unknown');
  });

  it('setCertificate stores and emits', () => {
    const handler = vi.fn();
    sp.onEvent(handler);
    sp.setCertificate({ issuer: 'CA', subject: 'example.com', validFrom: '2024-01-01', validTo: '2025-01-01', fingerprint: 'AB:CD', serialNumber: '12345', isSelfSigned: false });
    expect(sp.getCertificate()?.issuer).toBe('CA');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'certificateUpdated' }));
  });

  it('addCSPViolation creates and emits', () => {
    const handler = vi.fn();
    sp.onEvent(handler);
    sp.addCSPViolation({ blockedUri: 'http://evil.com', violatedDirective: 'script-src', sourceFile: 'page.html', lineNumber: 10, disposition: 'enforce' });
    expect(sp.getCSPViolations()).toHaveLength(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cspViolation' }));
  });

  it('addCORSIssue creates and emits', () => {
    const handler = vi.fn();
    sp.onEvent(handler);
    sp.addCORSIssue({ url: 'http://api.example.com', reason: 'No Access-Control-Allow-Origin', method: 'GET', blocked: true });
    expect(sp.getCORSIssues()).toHaveLength(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'corsIssue' }));
  });

  it('addMixedContent adds warning and sets summary', () => {
    sp.addMixedContent({ initiatorUrl: 'https://example.com', targetUrl: 'http://insecure.com', type: 'active' });
    expect(sp.getMixedContentWarnings()).toHaveLength(1);
    expect(sp.getSummary()).toBe('mixed');
  });

  it('setSummary overrides summary and emits', () => {
    const handler = vi.fn();
    sp.onEvent(handler);
    sp.setSummary('secure');
    expect(sp.getSummary()).toBe('secure');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'summaryChanged' }));
  });

  it('getSecurityReport returns aggregate', () => {
    sp.setCertificate({ issuer: 'CA', subject: 'x', validFrom: '', validTo: '', fingerprint: '', serialNumber: '', isSelfSigned: false });
    sp.addCSPViolation({ blockedUri: 'u', violatedDirective: 's', sourceFile: 'f', lineNumber: 1, disposition: 'enforce' });
    const report = sp.getSecurityReport();
    expect(report.certificate).not.toBeNull();
    expect(report.cspCount).toBe(1);
    expect(report.corsCount).toBe(0);
    expect(report.mixedCount).toBe(0);
  });

  it('clear removes all data', () => {
    sp.addCSPViolation({ blockedUri: 'u', violatedDirective: 's', sourceFile: 'f', lineNumber: 1, disposition: 'enforce' });
    sp.addCORSIssue({ url: 'u', reason: 'r', method: 'GET', blocked: false });
    sp.clear();
    expect(sp.getCSPViolations()).toHaveLength(0);
    expect(sp.getCORSIssues()).toHaveLength(0);
    expect(sp.getCertificate()).toBeNull();
  });

  it('onEvent unsubscribe works', () => {
    const h = vi.fn();
    sp.addMixedContent({ initiatorUrl: 'https://a.com', targetUrl: 'http://b.com', type: 'passive' });
    expect(h).toHaveBeenCalledTimes(0);
    const unsub = sp.onEvent(h);
    sp.addCSPViolation({ blockedUri: 'u', violatedDirective: 's', sourceFile: 'f', lineNumber: 1, disposition: 'enforce' });
    expect(h).toHaveBeenCalledTimes(1);
    unsub();
    sp.addCSPViolation({ blockedUri: 'u', violatedDirective: 's', sourceFile: 'f', lineNumber: 2, disposition: 'report' });
    expect(h).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 9. ACCESSIBILITY PANEL
// ══════════════════════════════════════════════════════════════════════════

function a11yEl(
  tagName: string,
  attrs: Record<string, string> = {},
  children: A11yDomNode[] = [],
  domId = `id-${tagName}-${Math.random().toString(36).slice(2, 6)}`,
): A11yDomNode {
  return {
    domId,
    nodeType: 'element',
    parent: null,
    tagName,
    attributes: new Map(Object.entries(attrs)),
    children,
  } as unknown as A11yDomNode;
}

function a11yText(text: string, domId = `txt-${Math.random().toString(36).slice(2, 6)}`): A11yDomNode {
  return { domId, nodeType: 'text', parent: null, children: [] };
}

describe('AccessibilityPanel', () => {
  let ap: AccessibilityPanel;
  beforeEach(() => { ap = new AccessibilityPanel(); });
  afterEach(() => { ap.dispose(); });

  it('starts with no tree', () => {
    expect(ap.getTree()).toBeNull();
  });

  it('buildTree creates an accessible tree', () => {
    const btn = a11yEl('button', { 'aria-label': 'Submit' });
    ap.buildTree(btn);
    expect(ap.getTree()).not.toBeNull();
    expect(ap.getTree()!.name).toBe('Submit');
  });

  it('buildTree emits treeRebuilt', () => {
    const handler = vi.fn();
    ap.onEvent(handler);
    ap.buildTree(a11yEl('div'));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'treeRebuilt' }));
  });

  it('selectNode sets selection and emits', () => {
    const handler = vi.fn();
    ap.onEvent(handler);
    ap.selectNode('btn-1');
    expect(ap.getSelectedNodeId()).toBe('btn-1');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'nodeSelected', nodeId: 'btn-1' }));
  });

  it('selectNode with null clears selection', () => {
    ap.selectNode('btn-1');
    ap.selectNode(null);
    expect(ap.getSelectedNodeId()).toBeNull();
  });

  it('runAudit finds missing alt on img', () => {
    const img = a11yEl('img', { src: 'photo.jpg' });
    const issues = ap.runAudit(img);
    expect(issues.some(i => i.type === 'error' && i.message.includes('alt'))).toBe(true);
  });

  it('runAudit passes img with alt', () => {
    const img = a11yEl('img', { src: 'photo.jpg', alt: 'A photo' });
    const issues = ap.runAudit(img);
    expect(issues.some(i => i.message.includes('alt'))).toBe(false);
  });

  it('runAudit finds missing label on input', () => {
    const input = a11yEl('input', { type: 'text' });
    const issues = ap.runAudit(input);
    expect(issues.some(i => i.message.includes('label'))).toBe(true);
  });

  it('runAudit passes input with aria-label', () => {
    const input = a11yEl('input', { type: 'text', 'aria-label': 'Name' });
    const issues = ap.runAudit(input);
    expect(issues.some(i => i.message.includes('label'))).toBe(false);
  });

  it('runAudit finds focusable-disabled', () => {
    const el = a11yEl('div', { 'aria-disabled': 'true', tabindex: '0' });
    const issues = ap.runAudit(el);
    expect(issues.some(i => i.type === 'warning' && i.message.includes('focusable'))).toBe(true);
  });

  it('runAudit emits auditComplete', () => {
    const handler = vi.fn();
    ap.onEvent(handler);
    ap.runAudit(a11yEl('img', { src: 'x.jpg' }));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'auditComplete' }));
  });

  it('getAuditResults returns last results', () => {
    ap.runAudit(a11yEl('img', { src: 'x.jpg' }));
    expect(ap.getAuditResults().length).toBeGreaterThan(0);
  });

  it('clear resets all state', () => {
    ap.buildTree(a11yEl('div'));
    ap.selectNode('x');
    ap.clear();
    expect(ap.getTree()).toBeNull();
    expect(ap.getSelectedNodeId()).toBeNull();
    expect(ap.getAuditResults()).toHaveLength(0);
  });

  it('dispose cleans up', () => {
    ap.buildTree(a11yEl('div'));
    ap.dispose();
    expect(ap.getTree()).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// DEVTOOLS FACADE — 9-panel integration
// ══════════════════════════════════════════════════════════════════════════

describe('DevTools facade (9 panels)', () => {
  let dt: DevTools;
  beforeEach(() => {
    dt = new DevTools(() => null);
  });
  afterEach(() => { dt.dispose(); });

  it('creates all 9 panels', () => {
    expect(dt.console).toBeDefined();
    expect(dt.network).toBeDefined();
    expect(dt.inspector).toBeDefined();
    expect(dt.performance).toBeDefined();
    expect(dt.memory).toBeDefined();
    expect(dt.sources).toBeDefined();
    expect(dt.storage).toBeDefined();
    expect(dt.security).toBeDefined();
    expect(dt.accessibility).toBeDefined();
  });

  it('starts closed with default panel', () => {
    expect(dt.isOpen()).toBe(false);
    expect(dt.getPanel()).toBe('elements');
  });

  it('open emits openChanged and panelChanged', () => {
    const openHandler = vi.fn();
    const panelHandler = vi.fn();
    dt.onOpenChanged(openHandler);
    dt.onPanelChanged(panelHandler);
    dt.open('memory');
    expect(dt.isOpen()).toBe(true);
    expect(dt.getPanel()).toBe('memory');
    expect(openHandler).toHaveBeenCalledWith(true);
    expect(panelHandler).toHaveBeenCalledWith('memory');
  });

  it('close emits openChanged(false)', () => {
    dt.open();
    const handler = vi.fn();
    dt.onOpenChanged(handler);
    dt.close();
    expect(dt.isOpen()).toBe(false);
    expect(handler).toHaveBeenCalledWith(false);
  });

  it('toggle opens when closed, closes when open', () => {
    expect(dt.isOpen()).toBe(false);
    dt.toggle();
    expect(dt.isOpen()).toBe(true);
    dt.toggle();
    expect(dt.isOpen()).toBe(false);
  });

  it('setPanel changes panel without opening', () => {
    dt.setPanel('security');
    expect(dt.getPanel()).toBe('security');
    expect(dt.isOpen()).toBe(false);
  });

  it('setPanel emits panelChanged', () => {
    const handler = vi.fn();
    dt.onPanelChanged(handler);
    dt.setPanel('storage');
    expect(handler).toHaveBeenCalledWith('storage');
  });

  it('open defaults to current panel', () => {
    dt.setPanel('performance');
    dt.open();
    expect(dt.getPanel()).toBe('performance');
  });

  it('all 9 panel names are valid via setPanel', () => {
    const names: Array<Parameters<typeof dt.setPanel>[0]> = [
      'elements', 'console', 'network',
      'performance', 'memory', 'sources',
      'storage', 'security', 'accessibility',
    ];
    for (const name of names) {
      dt.setPanel(name);
      expect(dt.getPanel()).toBe(name);
    }
  });

  it('dispose cleans up all panels', () => {
    dt.performance.addSnapshot();
    dt.memory.takeSnapshot();
    dt.sources.addSource('http://x.com', 'code');
    dt.storage.addOrigin('https://x.com');
    dt.security.addCSPViolation({ blockedUri: 'u', violatedDirective: 's', sourceFile: 'f', lineNumber: 1, disposition: 'enforce' });
    dt.accessibility.buildTree(a11yEl('div'));
    dt.dispose();
    expect(dt.performance.getSnapshots()).toHaveLength(0);
    expect(dt.memory.getSnapshots()).toHaveLength(0);
    expect(dt.sources.getSources()).toHaveLength(0);
    expect(dt.storage.getOrigins()).toHaveLength(0);
    expect(dt.security.getCSPViolations()).toHaveLength(0);
    expect(dt.accessibility.getTree()).toBeNull();
  });
});
