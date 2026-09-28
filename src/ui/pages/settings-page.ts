import type { IDisposable } from '../../app/dependency-container';
import type { IProfileManager } from '../../browser/settings/profiles';

interface SettingDefinition {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly type: 'text' | 'number' | 'boolean' | 'select' | 'range' | 'list';
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

const PROFILE_COLOR_HEX: Record<string, string> = {
  blue: '#3a7afd', red: '#e5484d', green: '#30a46c', yellow: '#f5d90a',
  purple: '#8e4ec6', orange: '#f76b15', pink: '#d6409f', teal: '#12a594',
};

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
      { key: 'httpsOnlyMode', label: 'Always use secure connections', description: 'Upgrade every site to HTTPS before loading it', type: 'boolean', defaultValue: true },
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
    id: 'profiles', title: 'Profiles', icon: '👤',
    settings: [
      { key: 'profileList', label: 'Manage profiles', description: 'Create, switch, and remove browser profiles', type: 'list', defaultValue: [] },
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

  constructor(sections?: readonly SettingsSection[], private readonly profileManager?: IProfileManager) {
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
    this.container.style.cssText = 'display:flex;height:100%;font-family:system-ui,-apple-system,sans-serif;background:var(--bg-body,#0f0f0f);color:var(--text-primary,#e0e0e0);';

    const sidebar = document.createElement('nav');
    sidebar.className = 'settings-sidebar';
    sidebar.style.cssText = 'width:210px;border-right:1px solid var(--border-subtle,rgba(255,255,255,.06));padding:12px 0;overflow-y:auto;flex-shrink:0;background:var(--bg-surface,#161618);';

    for (const section of this.sections) {
      const item = document.createElement('div');
      item.className = `settings-nav-item${section.id === this._activeSection ? ' active' : ''}`;
      item.textContent = `${section.icon}  ${section.title}`;
      item.style.cssText = 'padding:9px 16px;cursor:pointer;font-size:13px;border-left:3px solid transparent;color:var(--text-secondary,#a0a098);transition:all .12s;';
      if (section.id === this._activeSection) {
        item.style.borderLeftColor = 'var(--accent,#7c9cf5)';
        item.style.background = 'var(--bg-overlay,rgba(255,255,255,.04))';
        item.style.color = 'var(--text-primary,#e0e0e0)';
        item.style.fontWeight = '600';
      }
      item.addEventListener('mouseenter', () => {
        if (section.id !== this._activeSection) item.style.background = 'var(--bg-overlay,rgba(255,255,255,.03))';
      });
      item.addEventListener('mouseleave', () => {
        if (section.id !== this._activeSection) item.style.background = 'none';
      });
      item.addEventListener('click', () => {
        this.setActiveSection(section.id);
        this.render();
      });
      sidebar.appendChild(item);
    }
    this.container.appendChild(sidebar);

    const content = document.createElement('div');
    content.className = 'settings-content';
    content.style.cssText = 'flex:1;padding:24px 32px;overflow-y:auto;';
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
    title.textContent = `${section.icon}  ${section.title}`;
    title.style.cssText = 'margin:0 0 20px;font-size:20px;font-weight:600;color:var(--text-primary,#e0e0e0);';
    content.appendChild(title);

    for (const setting of section.settings) {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:12px;padding:12px 14px;border:1px solid var(--border-subtle,rgba(255,255,255,.06));border-radius:var(--radius-md,6px);background:var(--bg-surface,#161618);';

      const label = document.createElement('div');
      label.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:2px;color:var(--text-primary,#e0e0e0);';
      label.textContent = setting.label;
      row.appendChild(label);

      const desc = document.createElement('div');
      desc.style.cssText = 'font-size:11.5px;color:var(--text-tertiary,#6a6a68);margin-bottom:8px;';
      desc.textContent = setting.description;
      row.appendChild(desc);

      const currentValue = this.values.get(setting.key) ?? setting.defaultValue;

      switch (setting.type) {
        case 'text': {
          const input = document.createElement('input');
          input.type = 'text';
          input.value = String(currentValue);
          input.style.cssText = 'width:100%;padding:7px 10px;border:1px solid var(--border-default,rgba(255,255,255,.1));border-radius:var(--radius-sm,4px);font-size:13px;background:var(--bg-elevated,#1c1c1e);color:var(--text-primary,#e0e0e0);outline:none;transition:border .15s;';
          input.addEventListener('focus', () => { input.style.borderColor = 'var(--border-accent,rgba(124,156,245,.4))'; });
          input.addEventListener('blur', () => { input.style.borderColor = 'var(--border-default,rgba(255,255,255,.1))'; });
          input.addEventListener('change', () => this.setSetting(setting.key, input.value));
          row.appendChild(input);
          break;
        }
        case 'boolean': {
          const toggleWrap = document.createElement('div');
          toggleWrap.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;';
          const toggle = document.createElement('div');
          const isOn = currentValue === true;
          toggle.style.cssText = `width:36px;height:20px;border-radius:10px;position:relative;transition:background .2s;cursor:pointer;background:${isOn ? 'var(--toggle-on-bg,#3a7afd)' : 'var(--toggle-off-bg,#555568)'};`;
          const knob = document.createElement('div');
          knob.style.cssText = `width:16px;height:16px;border-radius:50%;background:#fff;position:absolute;top:2px;transition:left .2s;left:${isOn ? '18px' : '2px'};`;
          toggle.appendChild(knob);
          const toggleLabel = document.createElement('span');
          toggleLabel.style.cssText = 'font-size:12px;';
          toggleLabel.textContent = isOn ? 'On' : 'Off';
          toggleLabel.style.color = isOn ? 'var(--toggle-on-bg,#3a7afd)' : 'var(--text-tertiary,#6a6a68)';
          toggleWrap.appendChild(toggle);
          toggleWrap.appendChild(toggleLabel);
          toggleWrap.addEventListener('click', () => {
            const newVal = !(this.values.get(setting.key) ?? setting.defaultValue);
            this.setSetting(setting.key, newVal);
          });
          row.appendChild(toggleWrap);
          break;
        }
        case 'select': {
          const select = document.createElement('select');
          select.style.cssText = 'padding:7px 10px;border:1px solid var(--border-default,rgba(255,255,255,.1));border-radius:var(--radius-sm,4px);font-size:13px;background:var(--bg-elevated,#1c1c1e);color:var(--text-primary,#e0e0e0);outline:none;cursor:pointer;';
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
          rangeContainer.style.cssText = 'display:flex;align-items:center;gap:10px;';
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min = String(setting.min ?? 0);
          slider.max = String(setting.max ?? 100);
          slider.step = String(setting.step ?? 1);
          slider.value = String(currentValue);
          slider.style.cssText = 'flex:1;accent-color:var(--accent,#7c9cf5);';
          slider.addEventListener('input', () => this.setSetting(setting.key, Number(slider.value)));
          rangeContainer.appendChild(slider);
          const valueLabel = document.createElement('span');
          valueLabel.style.cssText = 'font-size:12px;min-width:30px;color:var(--text-secondary,#a0a098);';
          valueLabel.textContent = String(currentValue);
          rangeContainer.appendChild(valueLabel);
          row.appendChild(rangeContainer);
          break;
        }
        case 'list': {
          // Backed live by the ProfileManager, not this.values — a managed
          // collection with its own create/switch/remove actions doesn't fit
          // the flat key->primitive model the other setting types share.
          row.appendChild(this.buildProfileList());
          break;
        }
      }

      content.appendChild(row);
    }

    // Add preview button for the menu section
    if (section.id === 'menu') {
      const previewRow = document.createElement('div');
      previewRow.style.cssText = 'margin-top:20px;padding:16px;border:1px solid var(--border-accent,rgba(124,156,245,.3));border-radius:var(--radius-md,6px);background:var(--accent-dim,rgba(124,156,245,.08));';
      const previewLabel = document.createElement('div');
      previewLabel.style.cssText = 'font-size:13px;color:var(--text-primary,#e0e0e0);margin-bottom:8px;font-weight:600;';
      previewLabel.textContent = '☰  Preview Browser Menu';
      previewRow.appendChild(previewLabel);
      const previewDesc = document.createElement('div');
      previewDesc.style.cssText = 'font-size:11.5px;color:var(--text-tertiary,#6a6a68);margin-bottom:12px;';
      previewDesc.textContent = 'See how the browser dropdown menu looks with your current settings. Click below to open the preview.';
      previewRow.appendChild(previewDesc);
      const previewBtn = document.createElement('button');
      previewBtn.textContent = 'Open Menu Preview';
      previewBtn.style.cssText = 'padding:8px 20px;border:1px solid var(--border-accent,rgba(124,156,245,.4));border-radius:var(--radius-sm,4px);background:var(--accent,#7c9cf5);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;';
      previewBtn.addEventListener('mouseenter', () => { previewBtn.style.background = 'var(--accent-hover,#9bb5ff)'; });
      previewBtn.addEventListener('mouseleave', () => { previewBtn.style.background = 'var(--accent,#7c9cf5)'; });
      previewBtn.addEventListener('click', () => {
        window.open('../ui/browser-menu.html', '_blank', 'width=340,height=700');
      });
      previewRow.appendChild(previewBtn);
      content.appendChild(previewRow);
    }
  }

  private buildProfileList(): HTMLElement {
    const wrap = document.createElement('div');
    const manager = this.profileManager;
    const activeId = manager?.getActiveProfile().id;

    for (const profile of manager?.getProfiles() ?? []) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,.06));';

      const avatar = document.createElement('div');
      avatar.style.cssText = `width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;background:${PROFILE_COLOR_HEX[profile.color]};flex-shrink:0;`;
      avatar.textContent = profile.avatar;
      row.appendChild(avatar);

      const name = document.createElement('div');
      name.style.cssText = 'flex:1;font-size:13px;color:var(--text-primary,#e0e0e0);';
      name.textContent = profile.name;
      row.appendChild(name);

      if (profile.id === activeId) {
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:11px;color:var(--accent,#7c9cf5);border:1px solid var(--border-accent,rgba(124,156,245,.4));border-radius:10px;padding:2px 8px;';
        badge.textContent = 'Active';
        row.appendChild(badge);
      } else {
        const switchBtn = SettingsPage.makeButton('Switch', true);
        switchBtn.addEventListener('click', () => {
          manager?.switchProfile(profile.id);
          this.render();
        });
        row.appendChild(switchBtn);
      }

      const removeBtn = SettingsPage.makeButton('Remove', false);
      removeBtn.addEventListener('click', () => {
        manager?.removeProfile(profile.id);
        this.render();
      });
      row.appendChild(removeBtn);

      wrap.appendChild(row);
    }

    const addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;gap:8px;margin-top:10px;';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'New profile name';
    nameInput.style.cssText = 'flex:1;padding:7px 10px;border:1px solid var(--border-default,rgba(255,255,255,.1));border-radius:var(--radius-sm,4px);font-size:13px;background:var(--bg-elevated,#1c1c1e);color:var(--text-primary,#e0e0e0);outline:none;';
    const createBtn = SettingsPage.makeButton('Create', true);
    const createProfile = (): void => {
      const name = nameInput.value.trim();
      if (!name) return;
      manager?.createProfile(name);
      nameInput.value = '';
      this.render();
    };
    createBtn.addEventListener('click', createProfile);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') createProfile(); });
    addRow.appendChild(nameInput);
    addRow.appendChild(createBtn);
    wrap.appendChild(addRow);

    return wrap;
  }

  private static makeButton(text: string, primary: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = primary
      ? 'padding:5px 12px;border:1px solid var(--border-accent,rgba(124,156,245,.4));border-radius:var(--radius-sm,4px);background:var(--accent,#7c9cf5);color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;'
      : 'padding:5px 12px;border:1px solid var(--border-default,rgba(255,255,255,.1));border-radius:var(--radius-sm,4px);background:transparent;color:var(--text-secondary,#a0a098);font-size:12px;cursor:pointer;font-family:inherit;';
    return btn;
  }

  dispose(): void {
    this.unmount();
    this.values.clear();
    this.bus.length = 0;
  }
}

export { SettingsPage, DEFAULT_SECTIONS };
export type { ISettingsPage, SettingsSection, SettingDefinition, SettingsPageEvent, SettingsPageEventType };
