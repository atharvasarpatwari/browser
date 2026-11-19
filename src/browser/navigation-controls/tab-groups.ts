import type { IDisposable } from '../../app/dependency-container';

interface TabGroup {
  readonly id: string;
  name: string;
  color: string;
  collapsed: boolean;
  tabIds: string[];
  readonly createdAt: number;
}

interface ITabGroupManager extends IDisposable {
  createGroup(name: string, color?: string): TabGroup;
  removeGroup(id: string): boolean;
  renameGroup(id: string, name: string): boolean;
  setGroupColor(id: string, color: string): boolean;
  setGroupCollapsed(id: string, collapsed: boolean): boolean;
  getGroup(id: string): TabGroup | null;
  getAllGroups(): TabGroup[];
  addTabToGroup(groupId: string, tabId: string): boolean;
  removeTabFromGroup(tabId: string): boolean;
  getGroupForTab(tabId: string): TabGroup | null;
  onEvent(handler: TabGroupEventHandler): () => void;
  get size(): number;
}

type TabGroupEventKind = 'created' | 'removed' | 'renamed' | 'colorChanged' | 'collapsedChanged' | 'tabAdded' | 'tabRemoved';
interface TabGroupEvent {
  readonly kind: TabGroupEventKind;
  readonly group: TabGroup;
  readonly tabId?: string;
}

type TabGroupEventHandler = (event: TabGroupEvent) => void;

const GROUP_COLORS = ['#4285f4', '#ea4335', '#fbbc04', '#34a853', '#ff6d01', '#46bdc6', '#7b1fa2', '#e91e63'];

function generateId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `grp-${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

class TabGroupManager implements ITabGroupManager {
  private groups = new Map<string, TabGroup>();
  private tabToGroup = new Map<string, string>();
  private handlers = new Set<TabGroupEventHandler>();

  get size(): number { return this.groups.size; }

  createGroup(name: string, color?: string): TabGroup {
    const id = generateId();
    const group: TabGroup = {
      id,
      name,
      color: color ?? GROUP_COLORS[this.groups.size % GROUP_COLORS.length],
      collapsed: false,
      tabIds: [],
      createdAt: Date.now(),
    };
    this.groups.set(id, group);
    this.emit({ kind: 'created', group: { ...group } });
    return { ...group };
  }

  removeGroup(id: string): boolean {
    const group = this.groups.get(id);
    if (!group) return false;
    for (const tabId of group.tabIds) {
      this.tabToGroup.delete(tabId);
    }
    this.groups.delete(id);
    this.emit({ kind: 'removed', group: { ...group } });
    return true;
  }

  renameGroup(id: string, name: string): boolean {
    const group = this.groups.get(id);
    if (!group) return false;
    group.name = name;
    this.emit({ kind: 'renamed', group: { ...group } });
    return true;
  }

  setGroupColor(id: string, color: string): boolean {
    const group = this.groups.get(id);
    if (!group) return false;
    group.color = color;
    this.emit({ kind: 'colorChanged', group: { ...group } });
    return true;
  }

  setGroupCollapsed(id: string, collapsed: boolean): boolean {
    const group = this.groups.get(id);
    if (!group) return false;
    group.collapsed = collapsed;
    this.emit({ kind: 'collapsedChanged', group: { ...group } });
    return true;
  }

  getGroup(id: string): TabGroup | null {
    const g = this.groups.get(id);
    return g ? { ...g } : null;
  }

  getAllGroups(): TabGroup[] {
    return [...this.groups.values()].map(g => ({ ...g }));
  }

  addTabToGroup(groupId: string, tabId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;
    const existingGroupId = this.tabToGroup.get(tabId);
    if (existingGroupId && existingGroupId !== groupId) {
      const oldGroup = this.groups.get(existingGroupId);
      if (oldGroup) {
        oldGroup.tabIds = oldGroup.tabIds.filter(id => id !== tabId);
      }
    }
    if (!group.tabIds.includes(tabId)) {
      group.tabIds.push(tabId);
    }
    this.tabToGroup.set(tabId, groupId);
    this.emit({ kind: 'tabAdded', group: { ...group }, tabId });
    return true;
  }

  removeTabFromGroup(tabId: string): boolean {
    const groupId = this.tabToGroup.get(tabId);
    if (!groupId) return false;
    const group = this.groups.get(groupId);
    if (group) {
      group.tabIds = group.tabIds.filter(id => id !== tabId);
      this.emit({ kind: 'tabRemoved', group: { ...group }, tabId });
    }
    this.tabToGroup.delete(tabId);
    return true;
  }

  getGroupForTab(tabId: string): TabGroup | null {
    const groupId = this.tabToGroup.get(tabId);
    if (!groupId) return null;
    return this.getGroup(groupId);
  }

  onEvent(handler: TabGroupEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: TabGroupEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.groups.clear();
    this.tabToGroup.clear();
    this.handlers.clear();
  }
}

export { TabGroupManager, GROUP_COLORS, generateId };
export type { ITabGroupManager, TabGroup, TabGroupEvent, TabGroupEventKind, TabGroupEventHandler };
