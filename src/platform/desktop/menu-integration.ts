import type { IDisposable } from '../../app/dependency-container';

type MenuItemRole =
  | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
  | 'reload' | 'forceReload' | 'toggleDevTools'
  | 'zoomIn' | 'zoomOut' | 'resetZoom'
  | 'toggleFullscreen' | 'minimize' | 'close'
  | 'quit' | 'hide' | 'hideOthers' | 'unhide'
  | 'about' | 'services' | 'startSpeaking' | 'stopSpeaking';

type MenuItemType = 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';

interface MenuAccelerator {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly meta?: boolean;
}

interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly type: MenuItemType;
  readonly role: MenuItemRole | null;
  readonly accelerator: MenuAccelerator | null;
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly checked: boolean;
  readonly submenu: readonly MenuItem[];
  readonly click: (() => void) | null;
}

interface MenuTemplate {
  readonly id: string;
  readonly label: string;
  readonly items: readonly MenuItem[];
}

type MenuBarPosition = 'file' | 'edit' | 'view' | 'history' | 'bookmarks' | 'tools' | 'help';

interface MenuBarDefinition {
  readonly [position: string]: MenuTemplate;
}

type MenuEventType = 'menuItemClicked' | 'menuOpened' | 'menuClosed';

interface MenuEvent {
  readonly kind: MenuEventType;
  readonly menuId: string;
  readonly itemId?: string;
}

interface IMenuIntegration extends IDisposable {
  readonly menus: ReadonlyMap<string, MenuTemplate>;
  registerMenu(position: MenuBarPosition, template: MenuTemplate): void;
  unregisterMenu(position: MenuBarPosition): boolean;
  getMenu(position: MenuBarPosition): MenuTemplate | null;
  setMenuItemEnabled(menuId: string, itemId: string, enabled: boolean): boolean;
  setMenuItemChecked(menuId: string, itemId: string, checked: boolean): boolean;
  setMenuItemVisible(menuId: string, itemId: string, visible: boolean): boolean;
  buildNativeMenu(): MenuBarDefinition;
  on(type: MenuEventType, handler: (event: MenuEvent) => void): void;
  off(type: MenuEventType, handler: (event: MenuEvent) => void): void;
}

let _menuItemSeq = 0;
function nextMenuItemId(): string {
  return `mi-${(++_menuItemSeq).toString(36)}`;
}

function createMenuItem(options: {
  label: string;
  type?: MenuItemType;
  role?: MenuItemRole;
  accelerator?: MenuAccelerator;
  enabled?: boolean;
  visible?: boolean;
  checked?: boolean;
  submenu?: readonly MenuItem[];
  click?: (() => void) | null;
}): MenuItem {
  return {
    id: nextMenuItemId(),
    label: options.label,
    type: options.type ?? 'normal',
    role: options.role ?? null,
    accelerator: options.accelerator ?? null,
    enabled: options.enabled ?? true,
    visible: options.visible ?? true,
    checked: options.checked ?? false,
    submenu: options.submenu ?? [],
    click: options.click ?? null,
  };
}

interface MenuItemRecord {
  item: MenuItem;
  parentMenuId: string;
}

class MenuIntegration implements IMenuIntegration {
  readonly menus = new Map<string, MenuTemplate>();
  private readonly items = new Map<string, MenuItemRecord>();
  private readonly eventListeners = new Map<MenuEventType, Set<(e: MenuEvent) => void>>();

  get menus_(): ReadonlyMap<string, MenuTemplate> {
    return this.menus;
  }

  registerMenu(position: MenuBarPosition, template: MenuTemplate): void {
    this.menus.set(position, template);
    this.indexItems(template.id, template.items);
  }

  unregisterMenu(position: MenuBarPosition): boolean {
    const menu = this.menus.get(position);
    if (!menu) return false;
    this.removeItems(menu.items);
    return this.menus.delete(position);
  }

  getMenu(position: MenuBarPosition): MenuTemplate | null {
    return this.menus.get(position) ?? null;
  }

  setMenuItemEnabled(menuId: string, itemId: string, enabled: boolean): boolean {
    const record = this.items.get(itemId);
    if (!record) return false;
    record.item = { ...record.item, enabled };
    return true;
  }

  setMenuItemChecked(menuId: string, itemId: string, checked: boolean): boolean {
    const record = this.items.get(itemId);
    if (!record) return false;
    record.item = { ...record.item, checked };
    return true;
  }

  setMenuItemVisible(menuId: string, itemId: string, visible: boolean): boolean {
    const record = this.items.get(itemId);
    if (!record) return false;
    record.item = { ...record.item, visible };
    return true;
  }

  buildNativeMenu(): MenuBarDefinition {
    const result: Record<string, MenuTemplate> = {};
    for (const [position, template] of this.menus) {
      result[position] = template;
    }
    return result as MenuBarDefinition;
  }

  on(type: MenuEventType, handler: (event: MenuEvent) => void): void {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, new Set());
    this.eventListeners.get(type)!.add(handler);
  }

  off(type: MenuEventType, handler: (event: MenuEvent) => void): void {
    this.eventListeners.get(type)?.delete(handler);
  }

  private emit(event: MenuEvent): void {
    const handlers = this.eventListeners.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[MenuIntegration] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  private indexItems(menuId: string, items: readonly MenuItem[]): void {
    for (const item of items) {
      this.items.set(item.id, { item, parentMenuId: menuId });
      if (item.submenu.length > 0) {
        this.indexItems(menuId, item.submenu);
      }
    }
  }

  private removeItems(items: readonly MenuItem[]): void {
    for (const item of items) {
      this.items.delete(item.id);
      if (item.submenu.length > 0) {
        this.removeItems(item.submenu);
      }
    }
  }

  dispose(): void {
    this.menus.clear();
    this.items.clear();
    this.eventListeners.clear();
  }
}

export { MenuIntegration, createMenuItem };
export type { IMenuIntegration, MenuItem, MenuTemplate, MenuBarPosition, MenuAccelerator, MenuItemRole, MenuItemType, MenuBarDefinition, MenuEventType, MenuEvent };
