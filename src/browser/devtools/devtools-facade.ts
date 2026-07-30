import {
  type DOMNodeLike,
  type StyleProvider,
  type BoxModelProvider,
  ConsoleService,
  NetworkMonitor,
  DOMInspector,
} from '../netwroking/devtools';
import { PerformanceProfiler } from './performance-panel';
import { MemoryProfiler } from './memory-panel';
import { SourcesDebugger } from './sources-panel';
import { StorageInspector } from './storage-panel';
import { SecurityPanel } from './security-panel';
import { AccessibilityPanel } from './accessibility-panel';

import { Emitter } from './emitter';

export type DevToolsPanelName =
  | 'elements' | 'console' | 'network'
  | 'performance' | 'memory' | 'sources'
  | 'storage' | 'security' | 'accessibility';

interface DevToolsShellEvents {
  panelChanged: DevToolsPanelName;
  openChanged: boolean;
}

export class DevTools {
  readonly console: ConsoleService;
  readonly network: NetworkMonitor;
  readonly inspector: DOMInspector;
  readonly performance: PerformanceProfiler;
  readonly memory: MemoryProfiler;
  readonly sources: SourcesDebugger;
  readonly storage: StorageInspector;
  readonly security: SecurityPanel;
  readonly accessibility: AccessibilityPanel;

  private isOpenFlag = false;
  private activePanel: DevToolsPanelName = 'elements';
  private shellEvents = new Emitter<DevToolsShellEvents>();
  private restoreConsole: (() => void) | null = null;

  constructor(rootProvider: () => DOMNodeLike | null) {
    this.console = new ConsoleService();
    this.network = new NetworkMonitor();
    this.inspector = new DOMInspector(rootProvider);
    this.performance = new PerformanceProfiler();
    this.memory = new MemoryProfiler();
    this.sources = new SourcesDebugger();
    this.storage = new StorageInspector();
    this.security = new SecurityPanel();
    this.accessibility = new AccessibilityPanel();
  }

  open(panel?: DevToolsPanelName): void {
    this.isOpenFlag = true;
    if (panel) this.activePanel = panel;
    this.shellEvents.emit('openChanged', true);
    this.shellEvents.emit('panelChanged', this.activePanel);
  }

  close(): void {
    this.isOpenFlag = false;
    this.shellEvents.emit('openChanged', false);
  }

  toggle(): void {
    this.isOpenFlag ? this.close() : this.open();
  }

  isOpen(): boolean { return this.isOpenFlag; }

  setPanel(panel: DevToolsPanelName): void {
    this.activePanel = panel;
    this.shellEvents.emit('panelChanged', panel);
  }

  getPanel(): DevToolsPanelName { return this.activePanel; }

  onPanelChanged(listener: (panel: DevToolsPanelName) => void): () => void {
    return this.shellEvents.on('panelChanged', listener);
  }

  onOpenChanged(listener: (isOpen: boolean) => void): () => void {
    return this.shellEvents.on('openChanged', listener);
  }

  enableGlobalConsoleCapture(): void {
    this.restoreConsole?.();
    this.restoreConsole = this.console.patchGlobalConsole();
  }

  disableGlobalConsoleCapture(): void {
    this.restoreConsole?.();
    this.restoreConsole = null;
  }

  dispose(): void {
    this.disableGlobalConsoleCapture();
    this.shellEvents.clear();
    this.performance.dispose();
    this.memory.dispose();
    this.sources.dispose();
    this.storage.dispose();
    this.security.dispose();
    this.accessibility.dispose();
  }
}
