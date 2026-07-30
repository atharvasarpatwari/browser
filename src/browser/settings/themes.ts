/**
 * @file src/browser/settings/themes.ts
 *
 * Theme engine — dark/light/custom themes with CSS variable injection,
 * per-profile theme storage, and system theme detection.
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark' | 'system' | 'custom';

export interface ThemeColors {
  readonly bgBody: string;
  readonly bgSurface: string;
  readonly bgElevated: string;
  readonly bgOverlay: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textTertiary: string;
  readonly accent: string;
  readonly accentHover: string;
  readonly accentDim: string;
  readonly borderSubtle: string;
  readonly borderDefault: string;
  readonly borderAccent: string;
  readonly toggleOnBg: string;
  readonly toggleOffBg: string;
  readonly shadowSm: string;
  readonly shadowMd: string;
  readonly shadowLg: string;
  readonly radiusSm: string;
  readonly radiusMd: string;
  readonly radiusLg: string;
}

export interface ThemeDefinition {
  readonly id: string;
  readonly name: string;
  readonly mode: 'light' | 'dark';
  readonly colors: ThemeColors;
  readonly author?: string;
  readonly isBuiltIn: boolean;
}

export interface ThemeConfig {
  /** Active theme mode */
  mode: ThemeMode;
  /** Active custom theme ID (if mode is 'custom') */
  customThemeId: string;
  /** Follow system preference */
  followSystem: boolean;
  /** Enabled accent color */
  accentColor: string;
}

export type ThemeEventType = 'themeChanged' | 'modeChanged' | 'customThemeAdded' | 'customThemeRemoved';

export interface ThemeEvent {
  readonly kind: ThemeEventType;
  readonly themeId?: string;
  readonly mode?: ThemeMode;
}

export type ThemeEventHandler = (event: ThemeEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN THEMES
// ─────────────────────────────────────────────────────────────────────────────

const DARK_COLORS: ThemeColors = {
  bgBody: '#0f0f0f',
  bgSurface: '#161618',
  bgElevated: '#1c1c1e',
  bgOverlay: 'rgba(255,255,255,.04)',
  textPrimary: '#e0e0e0',
  textSecondary: '#a0a098',
  textTertiary: '#6a6a68',
  accent: '#7c9cf5',
  accentHover: '#9bb5ff',
  accentDim: 'rgba(124,156,245,.08)',
  borderSubtle: 'rgba(255,255,255,.06)',
  borderDefault: 'rgba(255,255,255,.1)',
  borderAccent: 'rgba(124,156,245,.4)',
  toggleOnBg: '#3a7afd',
  toggleOffBg: '#555568',
  shadowSm: '0 1px 2px rgba(0,0,0,.3)',
  shadowMd: '0 4px 8px rgba(0,0,0,.4)',
  shadowLg: '0 8px 24px rgba(0,0,0,.5)',
  radiusSm: '4px',
  radiusMd: '6px',
  radiusLg: '10px',
};

const LIGHT_COLORS: ThemeColors = {
  bgBody: '#f5f5f7',
  bgSurface: '#ffffff',
  bgElevated: '#fafafa',
  bgOverlay: 'rgba(0,0,0,.03)',
  textPrimary: '#1d1d1f',
  textSecondary: '#6e6e73',
  textTertiary: '#8e8e93',
  accent: '#0066cc',
  accentHover: '#0077ed',
  accentDim: 'rgba(0,102,204,.08)',
  borderSubtle: 'rgba(0,0,0,.06)',
  borderDefault: 'rgba(0,0,0,.12)',
  borderAccent: 'rgba(0,102,204,.3)',
  toggleOnBg: '#0066cc',
  toggleOffBg: '#c7c7cc',
  shadowSm: '0 1px 2px rgba(0,0,0,.08)',
  shadowMd: '0 4px 8px rgba(0,0,0,.1)',
  shadowLg: '0 8px 24px rgba(0,0,0,.12)',
  radiusSm: '4px',
  radiusMd: '6px',
  radiusLg: '10px',
};

export const BUILT_IN_THEMES: readonly ThemeDefinition[] = [
  { id: 'nova-dark', name: 'Nova Dark', mode: 'dark', colors: DARK_COLORS, author: 'Nova', isBuiltIn: true },
  { id: 'nova-light', name: 'Nova Light', mode: 'light', colors: LIGHT_COLORS, author: 'Nova', isBuiltIn: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM THEME DETECTION
// ─────────────────────────────────────────────────────────────────────────────

export function detectSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS VARIABLE GENERATION
// ─────────────────────────────────────────────────────────────────────────────

export function themeToCSSVariables(colors: ThemeColors): string {
  return [
    `--bg-body:${colors.bgBody}`,
    `--bg-surface:${colors.bgSurface}`,
    `--bg-elevated:${colors.bgElevated}`,
    `--bg-overlay:${colors.bgOverlay}`,
    `--text-primary:${colors.textPrimary}`,
    `--text-secondary:${colors.textSecondary}`,
    `--text-tertiary:${colors.textTertiary}`,
    `--accent:${colors.accent}`,
    `--accent-hover:${colors.accentHover}`,
    `--accent-dim:${colors.accentDim}`,
    `--border-subtle:${colors.borderSubtle}`,
    `--border-default:${colors.borderDefault}`,
    `--border-accent:${colors.borderAccent}`,
    `--toggle-on-bg:${colors.toggleOnBg}`,
    `--toggle-off-bg:${colors.toggleOffBg}`,
    `--shadow-sm:${colors.shadowSm}`,
    `--shadow-md:${colors.shadowMd}`,
    `--shadow-lg:${colors.shadowLg}`,
    `--radius-sm:${colors.radiusSm}`,
    `--radius-md:${colors.radiusMd}`,
    `--radius-lg:${colors.radiusLg}`,
  ].join(';');
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface IThemeManager extends IDisposable {
  /** Get the currently active theme */
  getActiveTheme(): ThemeDefinition;
  /** Get the resolved mode (resolves 'system' to actual mode) */
  getResolvedMode(): 'light' | 'dark';
  /** Set the theme mode */
  setMode(mode: ThemeMode): void;
  /** Get the current mode */
  getMode(): ThemeMode;
  /** Set custom theme by ID */
  setCustomTheme(themeId: string): void;
  /** Get all built-in themes */
  getBuiltInThemes(): readonly ThemeDefinition[];
  /** Get all custom themes */
  getCustomThemes(): readonly ThemeDefinition[];
  /** Get all themes (built-in + custom) */
  getAllThemes(): readonly ThemeDefinition[];
  /** Add a custom theme */
  addCustomTheme(theme: ThemeDefinition): void;
  /** Remove a custom theme */
  removeCustomTheme(themeId: string): boolean;
  /** Get theme by ID */
  getThemeById(id: string): ThemeDefinition | undefined;
  /** Apply theme to document (injects CSS variables) */
  applyTheme(doc?: Document): void;
  /** Get CSS variables string for current theme */
  getCSSVariables(): string;
  /** Set accent color */
  setAccentColor(color: string): void;
  /** Get accent color */
  getAccentColor(): string;
  /** Subscribe to events */
  onEvent(handler: ThemeEventHandler): () => void;
  /** Get config */
  getConfig(): ThemeConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

export class ThemeManager implements IThemeManager {
  private config: ThemeConfig;
  private customThemes = new Map<string, ThemeDefinition>();
  private handlers: ThemeEventHandler[] = [];
  private systemMediaQuery: MediaQueryList | null = null;
  private systemListener: (() => void) | null = null;
  private disposed = false;

  constructor(config?: Partial<ThemeConfig>) {
    this.config = {
      mode: 'system',
      customThemeId: '',
      followSystem: true,
      accentColor: '#7c9cf5',
      ...config,
    };

    if (typeof window !== 'undefined' && window.matchMedia) {
      this.systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.systemListener = () => {
        if (this.config.mode === 'system') {
          this.emit({ kind: 'themeChanged' });
          this.applyTheme();
        }
      };
      this.systemMediaQuery.addEventListener('change', this.systemListener);
    }
  }

  getActiveTheme(): ThemeDefinition {
    const mode = this.getResolvedMode();
    if (this.config.mode === 'custom' && this.config.customThemeId) {
      const custom = this.customThemes.get(this.config.customThemeId);
      if (custom) return custom;
    }
    return BUILT_IN_THEMES.find(t => t.mode === mode) ?? BUILT_IN_THEMES[0]!;
  }

  getResolvedMode(): 'light' | 'dark' {
    if (this.config.mode === 'system') {
      return detectSystemTheme();
    }
    if (this.config.mode === 'custom') {
      const theme = this.customThemes.get(this.config.customThemeId);
      return theme?.mode ?? 'dark';
    }
    return this.config.mode;
  }

  setMode(mode: ThemeMode): void {
    this.config.mode = mode;
    this.emit({ kind: 'modeChanged', mode });
    this.emit({ kind: 'themeChanged' });
    this.applyTheme();
  }

  getMode(): ThemeMode {
    return this.config.mode;
  }

  setCustomTheme(themeId: string): void {
    this.config.customThemeId = themeId;
    this.config.mode = 'custom';
    this.emit({ kind: 'themeChanged', themeId });
    this.applyTheme();
  }

  getBuiltInThemes(): readonly ThemeDefinition[] {
    return BUILT_IN_THEMES;
  }

  getCustomThemes(): readonly ThemeDefinition[] {
    return [...this.customThemes.values()];
  }

  getAllThemes(): readonly ThemeDefinition[] {
    return [...BUILT_IN_THEMES, ...this.customThemes.values()];
  }

  addCustomTheme(theme: ThemeDefinition): void {
    this.customThemes.set(theme.id, theme);
    this.emit({ kind: 'customThemeAdded', themeId: theme.id });
  }

  removeCustomTheme(themeId: string): boolean {
    const deleted = this.customThemes.delete(themeId);
    if (deleted) {
      if (this.config.customThemeId === themeId) {
        this.config.mode = 'system';
        this.config.customThemeId = '';
      }
      this.emit({ kind: 'customThemeRemoved', themeId });
      this.applyTheme();
    }
    return deleted;
  }

  getThemeById(id: string): ThemeDefinition | undefined {
    return BUILT_IN_THEMES.find(t => t.id === id) ?? this.customThemes.get(id);
  }

  applyTheme(doc?: Document): void {
    if (this.disposed) return;
    const d = doc ?? (typeof document !== 'undefined' ? document : null);
    if (!d) return;

    const theme = this.getActiveTheme();
    const vars = themeToCSSVariables(theme.colors);

    let styleEl = d.getElementById('nova-theme-variables') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = d.createElement('style');
      styleEl.id = 'nova-theme-variables';
      d.head?.appendChild(styleEl);
    }
    styleEl.textContent = `:root{${vars};}`;

    d.documentElement.setAttribute('data-theme', theme.mode);
    d.documentElement.setAttribute('data-theme-id', theme.id);
  }

  getCSSVariables(): string {
    return themeToCSSVariables(this.getActiveTheme().colors);
  }

  setAccentColor(color: string): void {
    this.config.accentColor = color;
    const theme = this.getActiveTheme();
    // Create a modified theme with new accent color
    const modified: ThemeDefinition = {
      ...theme,
      colors: { ...theme.colors, accent: color },
    };
    this.emit({ kind: 'themeChanged' });
    this.applyTheme();
  }

  getAccentColor(): string {
    return this.config.accentColor;
  }

  onEvent(handler: ThemeEventHandler): () => void {
    if (this.disposed) return () => {};
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  getConfig(): ThemeConfig {
    return { ...this.config };
  }

  dispose(): void {
    this.disposed = true;
    if (this.systemMediaQuery && this.systemListener) {
      this.systemMediaQuery.removeEventListener('change', this.systemListener);
    }
    this.handlers.length = 0;
  }

  private emit(event: ThemeEvent): void {
    if (this.disposed) return;
    for (const handler of this.handlers) {
      try { handler(event); } catch {}
    }
  }
}

export function createThemeManager(config?: Partial<ThemeConfig>): ThemeManager {
  return new ThemeManager(config);
}
