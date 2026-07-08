import type { IDisposable } from '../../app/dependency-container';

interface SettingDefinition {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly type: 'text' | 'number' | 'boolean' | 'select' | 'range';
  readonly defaultValue: unknown;
  readonly options?: readonly { readonly label: string; readonly value: string }[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

interface SettingsSection {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  readonly settings: readonly SettingDefinition[];
}

type SettingsPageEventType = 'settingChanged' | 'sectionChanged';

interface SettingsPageEvent {
  readonly kind: SettingsPageEventType;
  readonly key?: string;
  readonly value?: unknown;
}

interface SettingChangedEvent extends SettingsPageEvent {
  readonly kind: 'settingChanged';
  readonly key: string;
  readonly value: unknown;
}

interface ISettingsPage extends IDisposable {
  readonly sections: readonly SettingsSection[];
  readonly isMounted: boolean;
  mount(container: HTMLElement): void;
  unmount(): void;
  getSetting(key: string): unknown;
  setSetting(key: string, value: unknown): void;
  resetToDefaults(): void;
  getActiveSection(): string;
  setActiveSection(sectionId: string): void;
  on(type: SettingsPageEventType, handler: (event: SettingsPageEvent) => void): void;
  off(type: SettingsPageEventType, handler: (event: SettingsPageEvent) => void): void;
}

type SettingsPageEventHandler = (event: SettingsPageEvent) => void;

const DEFAULT_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'general', title: 'General', icon: '⚙',
    settings: [
      { key: 'homePage', label: 'Home page', description: 'Page shown on new tab', type: 'text', defaultValue: 'about:blank' },
      { key: 'defaultSearchEngine', label: 'Search engine', description: 'Default search provider', type: 'select', defaultValue: 'google', options: [{ label: 'Google', value: 'google' }, { label: 'Bing', value: 'bing' }, { label: 'DuckDuckGo', value: 'duckduckgo' }] },
      { key: 'restoreSession', label: 'Restore last session', description: 'Reopen tabs from last session on startup', type: 'boolean', defaultValue: true },
    ],
  },
  {
    id: 'privacy', title: 'Privacy & Security', icon: '🔒',
    settings: [
      { key: 'enableCsp', label: 'Content Security Policy', description: 'Enforce CSP headers', type: 'boolean', defaultValue: true },
      { key: 'blockPopups', label: 'Block pop-ups', description: 'Block automatic pop-up windows', type: 'boolean', defaultValue: true },
      { key: 'enableSafeBrowsing', label: 'Safe Browsing', description: 'Warn about dangerous sites', type: 'boolean', defaultValue: true },
      { key: 'doNotTrack', label: 'Send Do Not Track', description: 'Request sites not to track you', type: 'boolean', defaultValue: false },
    ],
  },
  {
    id: 'appearance', title: 'Appearance', icon: '🎨',
    settings: [
      { key: 'theme', label: 'Theme', description: 'Browser color theme', type: 'select', defaultValue: 'system', options: [{ label: 'System', value: 'system' }, { label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }] },
      { key: 'fontSize', label: 'Font size', description: 'Default page font size', type: 'range', defaultValue: 16, min: 10, max: 32, step: 1 },
      { key: 'zoomLevel', label: 'Zoom level', description: 'Default page zoom', type: 'select', defaultValue: '100', options: [{ label: '75%', value: '75' }, { label: '100%', value: '100' }, { label: '125%', value: '125' }, { label: '150%', value: '150' }] },
    ],
  },
  {
    id: 'downloads', title: 'Downloads', icon: '📥',
    settings: [
      { key: 'downloadPath', label: 'Download location', description: 'Where to save downloaded files', type: 'text', defaultValue: './downloads' },
      { key: 'askDownloadLocation', label: 'Ask where to save', description: 'Prompt for location before each download', type: 'boolean', defaultValue: true },
    ],
  },
  {
    id: 'shortcuts', title: 'Shortcuts', icon: '⌨',
    settings: [
      { key: 'enableKeyboardShortcuts', label: 'Enable keyboard shortcuts', description: 'Use keyboard shortcuts for navigation', type: 'boolean', defaultValue: true },
    ],
  },
];

class SettingsPage implements ISettingsPage {
  private readonly bus: SettingsPageEventHandler[] = [];
  private values = new Map<string, unknown>();
  private container: HTMLElement | null = null;
  private _activeSection = 'general';
  private _mounted = false;

  readonly sections: readonly SettingsSection[];

  constructor(sections?: readonly SettingsSection[]) {
    this.sections = sections ?? DEFAULT_SECTIONS;
    for (const section of this.sections) {
      for (const setting of section.settings) {
        this.values.set(setting.key, setting.defaultValue);
      }
    }
  }

  get isMounted(): boolean { return this._mounted; }

  mount(container: HTMLElement): void {
    this.container = container;
    this.container.className = 'settings-page';
    this.container.style.cssText = 'display:flex;height:100%;font-family:sans-serif;';

    const sidebar = document.createElement('nav');
    sidebar.className = 'settings-sidebar';
    sidebar.style.cssText = 'width:200px;border-right:1px solid #ddd;padding:16px 0;overflow-y:auto;flex-shrink:0;';

    for (const section of this.sections) {
      const item = document.createElement('div');
      item.className = `settings-nav-item${section.id === this._activeSection ? ' active' : ''}`;
      item.textContent = `${section.icon} ${section.title}`;
      item.style.cssText = 'padding:8px 16px;cursor:pointer;font-size:13px;border-left:3px solid transparent;';
      if (section.id === this._activeSection) {
        item.style.borderLeftColor = '#1a73e8';
        item.style.background = '#e8f0fe';
        item.style.fontWeight = 'bold';
      }
      item.addEventListener('click', () => {
        this.setActiveSection(section.id);
        this.render();
      });
      sidebar.appendChild(item);
    }
    this.container.appendChild(sidebar);

    const content = document.createElement('div');
    content.className = 'settings-content';
    content.style.cssText = 'flex:1;padding:24px;overflow-y:auto;';
    this.container.appendChild(content);

    this._mounted = true;
    this.render();
  }

  unmount(): void {
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this._mounted = false;
  }

  getSetting(key: string): unknown {
    return this.values.get(key);
  }

  setSetting(key: string, value: unknown): void {
    this.values.set(key, value);
    this.emit({ kind: 'settingChanged', key, value });
    this.render();
  }

  resetToDefaults(): void {
    for (const section of this.sections) {
      for (const setting of section.settings) {
        this.values.set(setting.key, setting.defaultValue);
      }
    }
    this.render();
  }

  getActiveSection(): string { return this._activeSection; }

  setActiveSection(sectionId: string): void {
    this._activeSection = sectionId;
  }

  on(type: SettingsPageEventType, handler: (event: SettingsPageEvent) => void): void {
    this.bus.push(handler);
  }

  off(type: SettingsPageEventType, handler: (event: SettingsPageEvent) => void): void {
    const idx = this.bus.indexOf(handler);
    if (idx !== -1) this.bus.splice(idx, 1);
  }

  private emit(event: SettingsPageEvent): void {
    for (const h of this.bus) {
      try { h(event); } catch (err) {
        console.error(`[SettingsPage] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  private render(): void {
    if (!this.container) return;

    const content = this.container.querySelector('.settings-content');
    if (!content) return;

    const section = this.sections.find(s => s.id === this._activeSection);
    if (!section) return;

    content.innerHTML = '';

    const title = document.createElement('h2');
    title.textContent = `${section.icon} ${section.title}`;
    title.style.cssText = 'margin:0 0 16px;font-size:20px;';
    content.appendChild(title);

    for (const setting of section.settings) {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:16px;padding:12px;border:1px solid #eee;border-radius:6px;';

      const label = document.createElement('div');
      label.style.cssText = 'font-weight:bold;font-size:14px;margin-bottom:2px;';
      label.textContent = setting.label;
      row.appendChild(label);

      const desc = document.createElement('div');
      desc.style.cssText = 'font-size:12px;color:#666;margin-bottom:8px;';
      desc.textContent = setting.description;
      row.appendChild(desc);

      const currentValue = this.values.get(setting.key) ?? setting.defaultValue;

      switch (setting.type) {
        case 'text': {
          const input = document.createElement('input');
          input.type = 'text';
          input.value = String(currentValue);
          input.style.cssText = 'width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:13px;';
          input.addEventListener('change', () => this.setSetting(setting.key, input.value));
          row.appendChild(input);
          break;
        }
        case 'boolean': {
          const toggle = document.createElement('input');
          toggle.type = 'checkbox';
          toggle.checked = currentValue === true;
          toggle.addEventListener('change', () => this.setSetting(setting.key, toggle.checked));
          row.appendChild(toggle);
          const toggleLabel = document.createElement('span');
          toggleLabel.style.cssText = 'margin-left:8px;font-size:13px;';
          toggleLabel.textContent = currentValue ? 'Enabled' : 'Disabled';
          row.appendChild(toggleLabel);
          break;
        }
        case 'select': {
          const select = document.createElement('select');
          select.style.cssText = 'padding:6px;border:1px solid #ccc;border-radius:4px;font-size:13px;';
          for (const opt of setting.options ?? []) {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            option.selected = opt.value === currentValue;
            select.appendChild(option);
          }
          select.addEventListener('change', () => this.setSetting(setting.key, select.value));
          row.appendChild(select);
          break;
        }
        case 'range': {
          const rangeContainer = document.createElement('div');
          rangeContainer.style.cssText = 'display:flex;align-items:center;gap:8px;';
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min = String(setting.min ?? 0);
          slider.max = String(setting.max ?? 100);
          slider.step = String(setting.step ?? 1);
          slider.value = String(currentValue);
          slider.addEventListener('input', () => this.setSetting(setting.key, Number(slider.value)));
          rangeContainer.appendChild(slider);
          const valueLabel = document.createElement('span');
          valueLabel.style.cssText = 'font-size:13px;min-width:30px;';
          valueLabel.textContent = String(currentValue);
          rangeContainer.appendChild(valueLabel);
          row.appendChild(rangeContainer);
          break;
        }
      }

      content.appendChild(row);
    }
  }

  dispose(): void {
    this.unmount();
    this.values.clear();
    this.bus.length = 0;
  }
}

export { SettingsPage, DEFAULT_SECTIONS };
export type { ISettingsPage, SettingsSection, SettingDefinition, SettingsPageEvent, SettingsPageEventType };
