export type ExtensionHostPermission = string;

export interface ContentScriptPattern {
  matches: string[];
  excludeMatches?: string[];
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export interface ContentScriptDeclaration {
  js?: string[];
  css?: string[];
  runAt?: 'document_start' | 'document_end' | 'document_idle';
  allFrames?: boolean;
  matchAboutBlank?: boolean;
  matches: string[];
  excludeMatches?: string[];
}

export interface BackgroundDeclaration {
  service_worker?: string;
  scripts?: string[];
  page?: string;
  persistent?: boolean;
  type?: 'classic' | 'module';
}

export interface ExtensionActionDeclaration {
  default_title?: string;
  default_popup?: string;
  default_icon?: Record<string, string>;
}

export interface ExtensionManifest {
  manifest_version: number;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage_url?: string;
  icons?: Record<string, string>;
  permissions?: ExtensionHostPermission[];
  host_permissions?: string[];
  optional_permissions?: string[];
  content_scripts?: ContentScriptDeclaration[];
  background?: BackgroundDeclaration;
  action?: ExtensionActionDeclaration;
  browser_action?: ExtensionActionDeclaration;
  options_ui?: {
    page: string;
    open_in_tab?: boolean;
  };
  default_locale?: string;
  minimum_chrome_version?: string;
  incognito?: 'spanning' | 'split' | 'not_allowed';
  web_accessible_resources?: Array<{ resources: string[]; matches: string[] }>;
  externally_connectable?: { ids: string[]; matches: string[] };
}

export interface ExtensionData {
  id: string;
  manifest: ExtensionManifest;
  basePath: string;
  enabled: boolean;
  installedAt: number;
  updateUrl?: string;
}

export type ExtensionEventType =
  | 'installed' | 'uninstalled' | 'enabled' | 'disabled'
  | 'updated' | 'loadError';

export interface ExtensionEvent {
  kind: ExtensionEventType;
  extensionId: string;
  error?: string;
}

export interface MessageSender {
  tabId?: number;
  frameId?: number;
  id?: string;
  url?: string;
  origin?: string;
  documentId?: string;
}

export interface MessageResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type ExtensionEventHandler = (event: ExtensionEvent) => void;

export function computeExtensionId(name: string, version: string): string {
  let hash = 0;
  const str = `${name}@${version}`;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `ext-${Math.abs(hash).toString(36)}`;
}
