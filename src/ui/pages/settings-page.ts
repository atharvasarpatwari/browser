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
      { key: 'homePage', label: 'Home page', description: 'Page shown on new tab', type: 'text', defaultValue: 'about:newtab' },
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
      { key: 'browserName', label: 'Browser name', description: 'Custom name displayed in window title, new tab, and search footer', type: 'text', defaultValue: 'Nova Browser' },
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
    id: 'ai-research', title: 'AI Research', icon: '🔬',
    settings: [
      { key: 'researchEnabled', label: 'Enable AI Research', description: 'Show research panel in browser', type: 'boolean', defaultValue: true },
      { key: 'anthropicApiKey', label: 'Anthropic API Key', description: 'API key for Claude web search', type: 'text', defaultValue: '' },
      { key: 'researchMaxSearches', label: 'Max searches per query', description: 'Maximum web searches per research session', type: 'range', defaultValue: 10, min: 1, max: 30, step: 1 },
      { key: 'researchModel', label: 'Model', description: 'Claude model for research', type: 'select', defaultValue: 'claude-sonnet-4-5-20250929', options: [{ label: 'Sonnet 4.5', value: 'claude-sonnet-4-5-20250929' }, { label: 'Opus 4', value: 'claude-opus-4-20250514' }] },
    ],
  },
  {
    id: 'shortcuts', title: 'Shortcuts', icon: '⌨',
    settings: [
      { key: 'enableKeyboardShortcuts', label: 'Enable keyboard shortcuts', description: 'Use keyboard shortcuts for navigation', type: 'boolean', defaultValue: true },
    ],
  },
  {
    id: 'menu', title: 'Browser Menu', icon: '☰',
    settings: [
      { key: 'menuShowNewTab', label: 'New tab', description: 'Show "New tab" in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowNewWindow', label: 'New window', description: 'Show "New window" in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowPrivateWindow', label: 'New private window', description: 'Show "New private window" in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowTorWindow', label: 'New private window with Tor', description: 'Show Tor window option in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowLeoAI', label: 'Leo AI', description: 'Show "Leo AI" assistant in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowWallet', label: 'Wallet', description: 'Show "Wallet" in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowVPN', label: 'Brave VPN', description: 'Show "Brave VPN" in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowSidebar', label: 'Sidebar', description: 'Show sidebar toggle in menu', type: 'boolean', defaultValue: true },
      { key: 'menuSidebarAutohide', label: 'Sidebar autohide', description: 'Autohide the sidebar when not in use', type: 'boolean', defaultValue: false },
      { key: 'menuShowPasswords', label: 'Passwords and autofill', description: 'Show passwords section in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowHistory', label: 'History', description: 'Show history in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowBookmarks', label: 'Bookmarks and lists', description: 'Show bookmarks in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowDownloads', label: 'Downloads', description: 'Show downloads in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowExtensions', label: 'Extensions', description: 'Show extensions in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowClearData', label: 'Delete browsing data', description: 'Show "Delete browsing data" in menu', type: 'boolean', defaultValue: true },
      { key: 'menuDefaultZoom', label: 'Default zoom', description: 'Default zoom level for new pages', type: 'select', defaultValue: '100', options: [{ label: '50%', value: '50' }, { label: '75%', value: '75' }, { label: '80%', value: '80' }, { label: '90%', value: '90' }, { label: '100%', value: '100' }, { label: '110%', value: '110' }, { label: '125%', value: '125' }, { label: '150%', value: '150' }, { label: '175%', value: '175' }, { label: '200%', value: '200' }] },
      { key: 'menuShowPrint', label: 'Print', description: 'Show print option in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowFind', label: 'Find and edit', description: 'Show find/edit in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowShare', label: 'Save and share', description: 'Show save/share in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowMoreTools', label: 'More tools', description: 'Show more tools submenu in menu', type: 'boolean', defaultValue: true },
      { key: 'menuShowHelp', label: 'Help', description: 'Show help in menu', type: 'boolean', defaultValue: true },
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
    this.container.className = 'nova-settings';

    const sidebar = document.createElement('nav');
    sidebar.className = 'nova-settings-nav';

    for (const section of this.sections) {
      const item = document.createElement('div');
      item.className = `nova-settings-nav-item${section.id === this._activeSection ? ' active' : ''}`;
      item.textContent = `${section.icon}  ${section.title}`;
      item.addEventListener('click', () => {
        this.setActiveSection(section.id);
        this.render();
      });
      sidebar.appendChild(item);
    }
    this.container.appendChild(sidebar);

    const content = document.createElement('div');
    content.className = 'nova-settings-content';
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

    const content = this.container.querySelector('.nova-settings-content');
    if (!content) return;

    const section = this.sections.find(s => s.id === this._activeSection);
    if (!section) return;

    content.innerHTML = '';

    const sectionEl = document.createElement('div');
    sectionEl.className = 'nova-settings-section';

    const title = document.createElement('h2');
    title.className = 'nova-settings-section-title';
    title.textContent = `${section.icon}  ${section.title}`;
    sectionEl.appendChild(title);

    for (const setting of section.settings) {
      const row = document.createElement('div');
      row.className = 'nova-settings-row';

      const label = document.createElement('div');
      label.className = 'nova-settings-label';
      const labelStrong = document.createElement('strong');
      labelStrong.textContent = setting.label;
      const labelSpan = document.createElement('span');
      labelSpan.textContent = setting.description;
      label.appendChild(labelStrong);
      label.appendChild(labelSpan);
      row.appendChild(label);

      const control = document.createElement('div');
      control.className = 'nova-settings-control';

      const currentValue = this.values.get(setting.key) ?? setting.defaultValue;

      switch (setting.type) {
        case 'text': {
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'nova-input';
          input.value = String(currentValue);
          input.addEventListener('change', () => this.setSetting(setting.key, input.value));
          control.appendChild(input);
          break;
        }
        case 'boolean': {
          const toggle = document.createElement('label');
          toggle.className = 'nova-toggle';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = currentValue === true;
          checkbox.addEventListener('change', () => this.setSetting(setting.key, checkbox.checked));
          toggle.appendChild(checkbox);
          const track = document.createElement('span');
          track.className = 'nova-toggle-track';
          toggle.appendChild(track);
          control.appendChild(toggle);
          break;
        }
        case 'select': {
          const select = document.createElement('select');
          select.className = 'nova-select';
          for (const opt of setting.options ?? []) {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            option.selected = opt.value === currentValue;
            select.appendChild(option);
          }
          select.addEventListener('change', () => this.setSetting(setting.key, select.value));
          control.appendChild(select);
          break;
        }
        case 'range': {
          const rangeContainer = document.createElement('div');
          rangeContainer.style.cssText = 'display:flex;align-items:center;gap:10px;';
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min = String(setting.min ?? 0);
          slider.max = String(setting.max ?? 100);
          slider.step = String(setting.step ?? 1);
          slider.value = String(currentValue);
          slider.style.cssText = 'flex:1;accent-color:var(--accent);';
          slider.addEventListener('input', () => this.setSetting(setting.key, Number(slider.value)));
          rangeContainer.appendChild(slider);
          const valueLabel = document.createElement('span');
          valueLabel.style.cssText = 'font-size:var(--sz-sm);min-width:30px;color:var(--tx-secondary);';
          valueLabel.textContent = String(currentValue);
          rangeContainer.appendChild(valueLabel);
          control.appendChild(rangeContainer);
          break;
        }
      }

      row.appendChild(control);
      sectionEl.appendChild(row);
    }

    // Add preview button for the menu section
    if (section.id === 'menu') {
      const previewRow = document.createElement('div');
      previewRow.style.cssText = 'margin-top:var(--sp-8);padding:var(--sp-8);border:1px solid var(--bd-accent);border-radius:var(--r-4);background:var(--accent-dim);';
      const previewLabel = document.createElement('div');
      previewLabel.style.cssText = 'font-size:var(--sz-base);color:var(--tx-primary);margin-bottom:var(--sp-4);font-weight:var(--w-semi);';
      previewLabel.textContent = '☰  Preview Browser Menu';
      previewRow.appendChild(previewLabel);
      const previewDesc = document.createElement('div');
      previewDesc.style.cssText = 'font-size:var(--sz-xs);color:var(--tx-tertiary);margin-bottom:var(--sp-6);';
      previewDesc.textContent = 'See how the browser dropdown menu looks with your current settings. Click below to open the preview.';
      previewRow.appendChild(previewDesc);
      const previewBtn = document.createElement('button');
      previewBtn.className = 'nova-btn nova-btn-primary';
      previewBtn.textContent = 'Open Menu Preview';
      previewBtn.addEventListener('click', () => {
        window.open('../ui/browser-menu.html', '_blank', 'width=340,height=700');
      });
      previewRow.appendChild(previewBtn);
      sectionEl.appendChild(previewRow);
    }

    content.appendChild(sectionEl);
  }

  dispose(): void {
    this.unmount();
    this.values.clear();
    this.bus.length = 0;
  }
}

export { SettingsPage, DEFAULT_SECTIONS };
export type { ISettingsPage, SettingsSection, SettingDefinition, SettingsPageEvent, SettingsPageEventType };
