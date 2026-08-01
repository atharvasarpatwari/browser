/**
 * @file src/browser/security/renderer-sandbox.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Defines and enforces the capability set available to renderer processes.
 * A renderer process spawned via child_process.fork() gets:
 *
 *   1. A scrubbed environment (no NODE_OPTIONS, no ELECTRON_RUN_AS_NODE, etc.)
 *   2. A restricted module allowlist (only what's needed for web content)
 *   3. Memory and resource limits via Node.js flags
 *   4. A capability manifest that the child process verifies at startup
 *   5. An IPC-only communication model — no direct fs/net/child_process access
 *
 * Does NOT:
 *   • Enforce IPC-level message gating (capability-gate.ts's job)
 *   • Manage privilege tiers (privilege-levels.ts's job)
 *   • Run inside the renderer process (this runs in the main/browser process)
 *
 * OOP PRINCIPLES
 * ───────────────
 *  Single-Resp.     Only handles renderer capability definition and fork options.
 *  Pure config      Most functions are side-effect-free data transformations.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PrivilegeLevel } from './privilege-levels';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A specific capability a renderer can request. */
type RendererCapability =
  | 'dom'                  /* DOM parsing and manipulation */
  | 'css'                  /* CSS parsing and resolution */
  | 'layout'               /* Layout computation */
  | 'paint'                /* Paint command generation */
  | 'javascript'           /* JS engine execution */
  | 'fetch-proxy'          /* Network via IPC proxy (no direct sockets) */
  | 'storage-proxy'        /* Storage via IPC proxy */
  | 'indexeddb-proxy'      /* IndexedDB via IPC proxy */
  | 'websocket-proxy'      /* WebSocket via IPC proxy */
  | 'worker-proxy'         /* Web Worker via IPC proxy */
  | 'canvas-2d'            /* Canvas 2D rendering */
  | 'image-decode'         /* Image decoding */
  | 'font-metrics'         /* Font metrics measurement */
  | 'clipboard-read-proxy' /* Clipboard read via IPC */
  | 'clipboard-write-proxy'/* Clipboard write via IPC */
  | 'notification-proxy'   /* Notifications via IPC */
  | 'geolocation-proxy'    /* Geolocation via IPC */
  | 'permission-proxy'     /* Permission API via IPC */
  | 'console'              /* Console logging */
  | 'timer'                /* setTimeout/setInterval */
  | 'promise'              /* Promise */
  | 'crypto'               /* SubtleCrypto (Web Crypto API) */
  | 'url'                  /* URL parsing */
  | 'encoding'             /* TextEncoder/TextDecoder */
  | 'abort'                /* AbortController/AbortSignal */
  | 'structured-clone'     /* structuredClone */
  | 'performance'          /* Performance API (timing only) */
  | 'cross-origin-isolation'; /* Cross-origin isolation headers */

/** Configuration for the renderer sandbox. */
interface RendererSandboxConfig {
  /** Whether sandboxing is enabled. If false, renderer gets full Node.js capabilities. */
  readonly enabled: boolean;
  /** The privilege level assigned to this renderer. */
  readonly privilegeLevel: PrivilegeLevel;
  /** Capabilities granted to this renderer. */
  readonly capabilities: readonly RendererCapability[];
  /** Maximum heap size in MB (passed as --max-old-space-size). */
  readonly maxHeapSizeMB: number;
  /** Maximum stack size in KB (passed as --max-stack-size). */
  readonly maxStackSizeKB: number;
  /** Whether to expose gc() to the renderer. */
  readonly exposeGC: boolean;
  /** Modules the renderer is allowed to require/import (empty = none). */
  readonly allowedModules: readonly string[];
  /** Additional Node.js flags for the child process. */
  readonly nodeFlags: readonly string[];
  /** Origin this renderer serves (used for capability resolution). */
  readonly origin: string;
  /** Tab ID this renderer is associated with. */
  readonly tabId: string;
}

/** The capability manifest sent to the child process at startup. */
interface CapabilityManifest {
  readonly processId: string;
  readonly origin: string;
  readonly tabId: string;
  readonly privilegeLevel: PrivilegeLevel;
  readonly capabilities: readonly RendererCapability[];
  readonly allowedModules: readonly string[];
  readonly maxHeapSizeMB: number;
  readonly timestamp: number;
}

/** The scrubbed environment for the child process. */
interface ScrubbedEnvironment {
  [key: string]: string | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Environment variables to REMOVE from the child process. */
const ENV_BLACKLIST = [
  'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'ELECTRON_ENABLE_LOGGING',
  'ELECTRON_ENABLE_STACK_DUMPING',
  'GOOGLE_API_KEY',
  'GOOGLE_DEFAULT_CLIENT_ID',
  'GOOGLE_DEFAULT_CLIENT_SECRET',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_TENANT_ID',
  'GITHUB_TOKEN',
  'NPM_TOKEN',
  'DATABASE_URL',
  'REDIS_URL',
  'MONGODB_URI',
  'POSTGRES_PASSWORD',
  'MYSQL_PASSWORD',
  'JWT_SECRET',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'PRIVATE_KEY',
  'API_KEY',
  'SECRET_KEY',
  'NOVA_SANDBOX_CONFIG',  // Will be set fresh
  'NOVA_CAPABILITIES',    // Will be set fresh
];

/** Node.js flags that are dangerous in a sandboxed renderer. */
const FORBIDDEN_NODE_FLAGS = [
  '--inspect',
  '--inspect-brk',
  '--inspect-port',
  '--debug',
  '--debug-brk',
  '--require',
  '--import',
  '--eval',
  '-e',
  '--print',
  '-p',
  '--interactive',
  '--repl',
  '--cpu-prof',
  '--heap-prof',
  '--report-on-signal',
  '--diagnostic-report-on-signal',
  '--abort-on-uncaught-exception',
];

/** Modules that are NEVER allowed in sandboxed renderers. */
const NEVER_ALLOWED_MODULES = [
  'child_process',
  'cluster',
  'fs',
  'fs/promises',
  'net',
  'dgram',
  'dns',
  'http',
  'https',
  'http2',
  'tls',
  'readline',
  'repl',
  'v8',
  'vm',      // Our own JS engine handles this
  'worker_threads',
  'perf_hooks',
  'async_hooks',
  'diagnostics_channel',
  'trace_events',
  'node:child_process',
  'node:cluster',
  'node:fs',
  'node:fs/promises',
  'node:net',
  'node:dgram',
  'node:dns',
  'node:http',
  'node:https',
  'node:http2',
  'node:tls',
  'node:readline',
  'node:repl',
  'node:v8',
  'node:vm',
  'node:worker_threads',
  'node:perf_hooks',
  'node:async_hooks',
  'node:diagnostics_channel',
  'node:trace_events',
];

/** Modules that are always allowed (needed for basic operation). */
const ALWAYS_ALLOWED_MODULES = [
  'events',
  'path',
  'util',
  'url',
  'string_decoder',
  'buffer',
  'stream',
  'assert',
  'querystring',
  'crypto',
  'os',
  'node:events',
  'node:path',
  'node:util',
  'node:url',
  'node:string_decoder',
  'node:buffer',
  'node:stream',
  'node:assert',
  'node:querystring',
  'node:crypto',
  'node:os',
];

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT CAPABILITY SETS PER PRIVILEGE LEVEL
// ─────────────────────────────────────────────────────────────────────────────

const SANDBOXED_CONTENT_CAPABILITIES: readonly RendererCapability[] = [
  'dom', 'css', 'layout', 'paint', 'javascript', 'console', 'timer',
  'promise', 'crypto', 'url', 'encoding', 'abort', 'structured-clone',
  'performance', 'canvas-2d', 'image-decode', 'font-metrics',
];

const WEB_CONTENT_CAPABILITIES: readonly RendererCapability[] = [
  ...SANDBOXED_CONTENT_CAPABILITIES,
  'fetch-proxy', 'storage-proxy', 'indexeddb-proxy', 'websocket-proxy',
  'worker-proxy', 'clipboard-read-proxy', 'clipboard-write-proxy',
  'notification-proxy', 'permission-proxy', 'geolocation-proxy',
  'cross-origin-isolation',
];

const TRUSTED_EXTENSION_CAPABILITIES: readonly RendererCapability[] = [
  ...WEB_CONTENT_CAPABILITIES,
];

const BROWSER_CHROME_CAPABILITIES: readonly RendererCapability[] = [
  'dom', 'css', 'layout', 'paint', 'javascript',
  'fetch-proxy', 'storage-proxy', 'indexeddb-proxy', 'websocket-proxy',
  'worker-proxy', 'clipboard-read-proxy', 'clipboard-write-proxy',
  'notification-proxy', 'permission-proxy', 'geolocation-proxy',
  'canvas-2d', 'image-decode', 'font-metrics',
  'console', 'timer', 'promise', 'crypto', 'url', 'encoding',
  'abort', 'structured-clone', 'performance', 'cross-origin-isolation',
];

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT SCRUBBING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a scrubbed copy of process.env safe for a sandboxed renderer.
 * Removes sensitive vars, blacklisted vars, and anything that could escape.
 */
function createScrubbedEnvironment(
  capabilityManifest: CapabilityManifest,
): ScrubbedEnvironment {
  const scrubbed: ScrubbedEnvironment = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (ENV_BLACKLIST.includes(key)) continue;
    // Remove any env var that looks like a secret
    if (/^(.*SECRET|.*KEY|.*PASSWORD|.*TOKEN|.*CREDENTIAL|.*AUTH)$/i.test(key)) continue;
    scrubbed[key] = value;
  }

  // Set sandbox-specific variables
  scrubbed['NOVA_SANDBOX_ENABLED'] = '1';
  scrubbed['NOVA_SANDBOX_LEVEL'] = capabilityManifest.privilegeLevel;
  scrubbed['NOVA_SANDBOX_ORIGIN'] = capabilityManifest.origin;
  scrubbed['NOVA_SANDBOX_TAB_ID'] = capabilityManifest.tabId;
  scrubbed['NOVA_SANDBOX_CAPABILITIES'] = JSON.stringify(capabilityManifest.capabilities);
  scrubbed['NOVA_SANDBOX_ALLOWED_MODULES'] = JSON.stringify(capabilityManifest.allowedModules);
  scrubbed['NOVA_PROCESS_ID'] = capabilityManifest.processId;

  return scrubbed;
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE.JS FLAG GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate safe Node.js flags for the sandboxed renderer.
 */
function createSandboxNodeFlags(config: RendererSandboxConfig): string[] {
  const flags: string[] = [];

  // Memory limit
  flags.push(`--max-old-space-size=${config.maxHeapSizeMB}`);

  // Stack size
  flags.push(`--max-stack-size=${config.maxStackSizeKB}`);

  // Disable exposing GC unless explicitly allowed
  if (!config.exposeGC) {
    flags.push('--expose-gc=false');
  }

  // Add user-specified flags (after filtering forbidden ones)
  for (const flag of config.nodeFlags) {
    if (!FORBIDDEN_NODE_FLAGS.some(f => flag.startsWith(f))) {
      flags.push(flag);
    }
  }

  return flags;
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPABILITY MANIFEST CREATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a capability manifest for a new renderer process.
 */
function createCapabilityManifest(
  processId: string,
  config: RendererSandboxConfig,
): CapabilityManifest {
  return {
    processId,
    origin: config.origin,
    tabId: config.tabId,
    privilegeLevel: config.privilegeLevel,
    capabilities: [...config.capabilities],
    allowedModules: [...ALWAYS_ALLOWED_MODULES, ...config.allowedModules],
    maxHeapSizeMB: config.maxHeapSizeMB,
    timestamp: Date.now(),
  };
}

/**
 * Check if a module is allowed for a given capability manifest.
 */
function isModuleAllowed(
  manifest: CapabilityManifest,
  moduleName: string,
): boolean {
  // Normalize bare specifiers
  const normalized = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;

  // Never allowed
  if (NEVER_ALLOWED_MODULES.includes(moduleName) || NEVER_ALLOWED_MODULES.includes(normalized)) {
    return false;
  }

  // Always allowed
  if (manifest.allowedModules.includes(moduleName) || manifest.allowedModules.includes(normalized)) {
    return true;
  }

  return false;
}

/**
 * Check if a capability is available in a manifest.
 */
function hasCapability(
  manifest: CapabilityManifest,
  capability: RendererCapability,
): boolean {
  return manifest.capabilities.includes(capability);
}

// ─────────────────────────────────────────────────────────────────────────────
// FORK OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the full fork options for a sandboxed renderer process.
 * Combines scrubbed environment, safe flags, and stdio configuration.
 */
function createSandboxForkOptions(
  processId: string,
  config: RendererSandboxConfig,
): {
  env: ScrubbedEnvironment;
  execArgv: string[];
  stdio: string[];
  silent: boolean;
} {
  const manifest = createCapabilityManifest(processId, config);

  return {
    env: createScrubbedEnvironment(manifest) as ScrubbedEnvironment,
    execArgv: createSandboxNodeFlags(config),
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    silent: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRESET CONFIGURATIONS
// ─────────────────────────────────────────────────────────────────────────────

/** Default config for sandboxed web content (iframes, third-party). */
function createSandboxedContentConfig(origin: string, tabId: string): RendererSandboxConfig {
  return {
    enabled: true,
    privilegeLevel: 'sandboxed-content',
    capabilities: [...SANDBOXED_CONTENT_CAPABILITIES],
    maxHeapSizeMB: 128,
    maxStackSizeKB: 512,
    exposeGC: false,
    allowedModules: [],
    nodeFlags: [],
    origin,
    tabId,
  };
}

/** Default config for regular web content. */
function createWebContentConfig(origin: string, tabId: string): RendererSandboxConfig {
  return {
    enabled: true,
    privilegeLevel: 'web-content',
    capabilities: [...WEB_CONTENT_CAPABILITIES],
    maxHeapSizeMB: 256,
    maxStackSizeKB: 1024,
    exposeGC: false,
    allowedModules: [],
    nodeFlags: [],
    origin,
    tabId,
  };
}

/** Default config for trusted extensions. */
function createTrustedExtensionConfig(origin: string, tabId: string): RendererSandboxConfig {
  return {
    enabled: true,
    privilegeLevel: 'trusted-extension',
    capabilities: [...TRUSTED_EXTENSION_CAPABILITIES],
    maxHeapSizeMB: 512,
    maxStackSizeKB: 2048,
    exposeGC: false,
    allowedModules: [],
    nodeFlags: [],
    origin,
    tabId,
  };
}

/** Config for browser chrome (full trust, no sandboxing). */
function createBrowserChromeConfig(): RendererSandboxConfig {
  return {
    enabled: false,
    privilegeLevel: 'browser-chrome',
    capabilities: [...BROWSER_CHROME_CAPABILITIES],
    maxHeapSizeMB: 512,
    maxStackSizeKB: 2048,
    exposeGC: true,
    allowedModules: ['*'],
    nodeFlags: [],
    origin: 'nova://browser',
    tabId: 'chrome',
  };
}

/** Default sandbox config — web content level. */
const DEFAULT_SANDBOX_CONFIG: RendererSandboxConfig = {
  enabled: true,
  privilegeLevel: 'web-content',
  capabilities: [...WEB_CONTENT_CAPABILITIES],
  maxHeapSizeMB: 256,
  maxStackSizeKB: 1024,
  exposeGC: false,
  allowedModules: [],
  nodeFlags: [],
  origin: 'about:blank',
  tabId: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  createScrubbedEnvironment,
  createSandboxNodeFlags,
  createCapabilityManifest,
  createSandboxForkOptions,
  isModuleAllowed,
  hasCapability,
  createSandboxedContentConfig,
  createWebContentConfig,
  createTrustedExtensionConfig,
  createBrowserChromeConfig,
  DEFAULT_SANDBOX_CONFIG,
  ENV_BLACKLIST,
  FORBIDDEN_NODE_FLAGS,
  NEVER_ALLOWED_MODULES,
  ALWAYS_ALLOWED_MODULES,
  SANDBOXED_CONTENT_CAPABILITIES,
  WEB_CONTENT_CAPABILITIES,
};

export type {
  RendererCapability,
  RendererSandboxConfig,
  CapabilityManifest,
  ScrubbedEnvironment,
};
