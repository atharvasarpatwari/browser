import type { ExtensionManifest, ExtensionData, ContentScriptDeclaration, BackgroundDeclaration } from './extension-types';
import { computeExtensionId } from './extension-types';

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateManifest(raw: Record<string, unknown>): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!raw.manifest_version || typeof raw.manifest_version !== 'number') {
    errors.push('manifest_version is required and must be a number');
  } else if (raw.manifest_version !== 2 && raw.manifest_version !== 3) {
    errors.push(`Unsupported manifest_version: ${raw.manifest_version}. Only 2 and 3 are supported.`);
  }

  if (!raw.name || typeof raw.name !== 'string') {
    errors.push('name is required and must be a string');
  }

  if (!raw.version || typeof raw.version !== 'string') {
    errors.push('version is required and must be a string');
  } else if (!/^\d+(\.\d+){0,2}$/.test(raw.version)) {
    errors.push('version must match semver format (e.g. "1.0.0")');
  }

  if (raw.description !== undefined && typeof raw.description !== 'string') {
    warnings.push('description should be a string');
  }

  if (raw.permissions !== undefined) {
    if (!Array.isArray(raw.permissions)) {
      errors.push('permissions must be an array');
    }
  }

  if (raw.host_permissions !== undefined) {
    if (!Array.isArray(raw.host_permissions)) {
      errors.push('host_permissions must be an array');
    } else if (raw.manifest_version === 2) {
      warnings.push('host_permissions is a Manifest V3 field; use permissions for V2');
    }
  }

  if (raw.content_scripts !== undefined) {
    if (!Array.isArray(raw.content_scripts)) {
      errors.push('content_scripts must be an array');
    } else {
      for (let i = 0; i < raw.content_scripts.length; i++) {
        const cs = raw.content_scripts[i] as Record<string, unknown>;
        if (!cs.matches || !Array.isArray(cs.matches) || cs.matches.length === 0) {
          errors.push(`content_scripts[${i}]: matches is required and must be a non-empty array`);
        }
        if (cs.js !== undefined && !Array.isArray(cs.js)) {
          errors.push(`content_scripts[${i}]: js must be an array`);
        }
        if (cs.css !== undefined && !Array.isArray(cs.css)) {
          errors.push(`content_scripts[${i}]: css must be an array`);
        }
        if (!cs.js && !cs.css) {
          warnings.push(`content_scripts[${i}]: has no js or css files`);
        }
      }
    }
  }

  if (raw.background !== undefined) {
    const bg = raw.background as Record<string, unknown>;
    if (typeof bg !== 'object' || bg === null) {
      errors.push('background must be an object');
    } else {
      if (bg.scripts !== undefined && !Array.isArray(bg.scripts)) {
        errors.push('background.scripts must be an array');
      }
      if (bg.service_worker !== undefined && typeof bg.service_worker !== 'string') {
        errors.push('background.service_worker must be a string');
      }
      if (bg.page !== undefined && typeof bg.page !== 'string') {
        errors.push('background.page must be a string');
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function normalizeManifest(raw: Record<string, unknown>): ExtensionManifest {
  const version = String(raw.version ?? '0.0.1');
  const manifest_version = Number(raw.manifest_version ?? 3);

  const permissions = Array.isArray(raw.permissions)
    ? raw.permissions.filter((p): p is string => typeof p === 'string')
    : [];

  const host_permissions = Array.isArray(raw.host_permissions)
    ? raw.host_permissions.filter((p): p is string => typeof p === 'string')
    : [];

  const content_scripts = Array.isArray(raw.content_scripts)
    ? (raw.content_scripts as Record<string, unknown>[]).map(normalizeContentScript).filter((cs): cs is ContentScriptDeclaration => cs !== null)
    : [];

  const background = raw.background
    ? normalizeBackground(raw.background as Record<string, unknown>)
    : undefined;

  const action = raw.action
    ? normalizeAction(raw.action as Record<string, unknown>)
    : undefined;

  const browser_action = raw.browser_action
    ? normalizeAction(raw.browser_action as Record<string, unknown>)
    : undefined;

  return {
    manifest_version,
    name: String(raw.name ?? 'Unnamed Extension'),
    version,
    description: raw.description ? String(raw.description) : undefined,
    author: raw.author ? String(raw.author) : undefined,
    homepage_url: raw.homepage_url ? String(raw.homepage_url) : undefined,
    icons: raw.icons as Record<string, string> | undefined,
    permissions,
    host_permissions,
    optional_permissions: Array.isArray(raw.optional_permissions)
      ? raw.optional_permissions.filter((p): p is string => typeof p === 'string')
      : [],
    content_scripts,
    background,
    action,
    browser_action,
    options_ui: raw.options_ui as { page: string; open_in_tab?: boolean } | undefined,
    default_locale: raw.default_locale ? String(raw.default_locale) : undefined,
    minimum_chrome_version: raw.minimum_chrome_version ? String(raw.minimum_chrome_version) : undefined,
    incognito: raw.incognito as 'spanning' | 'split' | 'not_allowed' | undefined,
    web_accessible_resources: Array.isArray(raw.web_accessible_resources)
      ? raw.web_accessible_resources as Array<{ resources: string[]; matches: string[] }>
      : [],
    externally_connectable: raw.externally_connectable as { ids: string[]; matches: string[] } | undefined,
  };
}

function normalizeContentScript(raw: Record<string, unknown>): ContentScriptDeclaration | null {
  if (!raw.matches || !Array.isArray(raw.matches) || raw.matches.length === 0) return null;
  return {
    matches: raw.matches.filter((m): m is string => typeof m === 'string'),
    excludeMatches: Array.isArray(raw.excludeMatches)
      ? raw.excludeMatches.filter((m): m is string => typeof m === 'string')
      : undefined,
    js: Array.isArray(raw.js) ? raw.js.filter((s): s is string => typeof s === 'string') : undefined,
    css: Array.isArray(raw.css) ? raw.css.filter((s): s is string => typeof s === 'string') : undefined,
    runAt: (raw.run_at ?? raw.runAt ?? 'document_idle') as ContentScriptDeclaration['runAt'],
    allFrames: Boolean(raw.all_frames ?? raw.allFrames),
    matchAboutBlank: Boolean(raw.match_about_blank ?? raw.matchAboutBlank),
  };
}

function normalizeBackground(raw: Record<string, unknown>): BackgroundDeclaration | undefined {
  const service_worker = raw.service_worker ? String(raw.service_worker) : undefined;
  const scripts = Array.isArray(raw.scripts)
    ? raw.scripts.filter((s): s is string => typeof s === 'string')
    : undefined;
  if (!service_worker && !scripts && !raw.page) return undefined;
  return {
    service_worker,
    scripts,
    page: raw.page ? String(raw.page) : undefined,
    persistent: raw.persistent !== undefined ? Boolean(raw.persistent) : undefined,
    type: raw.type === 'module' ? 'module' : undefined,
  };
}

function normalizeAction(raw: Record<string, unknown>): { default_title?: string; default_popup?: string; default_icon?: Record<string, string> } {
  return {
    default_title: raw.default_title ? String(raw.default_title) : undefined,
    default_popup: raw.default_popup ? String(raw.default_popup) : undefined,
    default_icon: raw.default_icon as Record<string, string> | undefined,
  };
}

export function createExtensionFromManifest(raw: Record<string, unknown>, basePath: string): { data: ExtensionData; errors: string[] } {
  const validation = validateManifest(raw);
  if (!validation.valid) {
    return { data: null as unknown as ExtensionData, errors: validation.errors };
  }

  const manifest = normalizeManifest(raw);
  const id = computeExtensionId(manifest.name, manifest.version);

  const data: ExtensionData = {
    id,
    manifest,
    basePath,
    enabled: true,
    installedAt: Date.now(),
  };

  return { data, errors: validation.warnings };
}
