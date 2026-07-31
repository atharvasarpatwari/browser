/**
 * Process model configuration for browser/renderer separation.
 * 
 * This module defines how the browser manages its processes:
 * - Single-process mode: Everything runs in one process (default)
 * - Multi-process mode: Browser and renderer processes are separated
 * 
 * Multi-process mode provides better security and stability but uses
 * more memory and has higher IPC overhead.
 */

/**
 * Process isolation modes.
 */
export type ProcessIsolationMode = 
  | 'none'      // Single process (default)
  | 'per-tab'   // Each tab gets its own renderer process
  | 'per-domain'; // Tabs from different domains get separate processes

/**
 * Process model configuration.
 */
export interface ProcessModelConfig {
  /** The isolation mode to use. */
  readonly isolationMode: ProcessIsolationMode;
  
  /** Whether to enable renderer process isolation. */
  readonly enableRendererIsolation: boolean;
  
  /** Maximum number of renderer processes (0 = unlimited). */
  readonly maxRendererProcesses: number;
  
  /** Whether to enable GPU acceleration in renderer processes. */
  readonly enableGpuAcceleration: boolean;
  
  /** Whether to enable Web Worker support in renderer processes. */
  readonly enableWebWorkers: boolean;
  
  /** Whether to enable process restart on crash. */
  readonly enableProcessRestart: boolean;
  
  /** Maximum number of restart attempts before tab is killed. */
  readonly maxRestartAttempts: number;
  
  /** Timeout (ms) for renderer process startup. */
  readonly rendererStartupTimeoutMs: number;
  
  /** Memory limit (bytes) for renderer processes (0 = unlimited). */
  readonly rendererMemoryLimitBytes: number;
  
  /** Whether to enable process priority management. */
  readonly enablePriorityManagement: boolean;
  
  /** Base directory for renderer entry scripts. */
  readonly rendererEntryPath: string;
}

/**
 * Default process model configuration (single-process mode).
 */
export const DEFAULT_PROCESS_MODEL: ProcessModelConfig = {
  isolationMode: 'none',
  enableRendererIsolation: false,
  maxRendererProcesses: 0,
  enableGpuAcceleration: true,
  enableWebWorkers: true,
  enableProcessRestart: true,
  maxRestartAttempts: 3,
  rendererStartupTimeoutMs: 10_000,
  rendererMemoryLimitBytes: 0,
  enablePriorityManagement: true,
  rendererEntryPath: 'src/process/renderer-entry.ts',
};

/**
 * Multi-process configuration for per-tab isolation.
 */
export const PER_TAB_PROCESS_MODEL: ProcessModelConfig = {
  isolationMode: 'per-tab',
  enableRendererIsolation: true,
  maxRendererProcesses: 20,
  enableGpuAcceleration: true,
  enableWebWorkers: true,
  enableProcessRestart: true,
  maxRestartAttempts: 3,
  rendererStartupTimeoutMs: 10_000,
  rendererMemoryLimitBytes: 512 * 1024 * 1024, // 512MB
  enablePriorityManagement: true,
  rendererEntryPath: 'src/process/renderer-entry.ts',
};

/**
 * Multi-process configuration for per-domain isolation.
 */
export const PER_DOMAIN_PROCESS_MODEL: ProcessModelConfig = {
  isolationMode: 'per-domain',
  enableRendererIsolation: true,
  maxRendererProcesses: 50,
  enableGpuAcceleration: true,
  enableWebWorkers: true,
  enableProcessRestart: true,
  maxRestartAttempts: 3,
  rendererStartupTimeoutMs: 10_000,
  rendererMemoryLimitBytes: 256 * 1024 * 1024, // 256MB
  enablePriorityManagement: true,
  rendererEntryPath: 'src/process/renderer-entry.ts',
};

/**
 * Validates a process model configuration.
 */
export function validateProcessModelConfig(config: ProcessModelConfig): string[] {
  const errors: string[] = [];
  
  if (!config.isolationMode) {
    errors.push('isolationMode is required');
  }
  
  if (config.maxRendererProcesses < 0) {
    errors.push('maxRendererProcesses must be >= 0');
  }
  
  if (config.rendererStartupTimeoutMs < 1000) {
    errors.push('rendererStartupTimeoutMs must be >= 1000');
  }
  
  if (config.maxRestartAttempts < 0) {
    errors.push('maxRestartAttempts must be >= 0');
  }
  
  return errors;
}

/**
 * Gets the process model configuration based on environment.
 */
export function getProcessModelFromEnvironment(): ProcessModelConfig {
  const isolationMode = process.env['NOVA_PROCESS_ISOLATION'] as ProcessIsolationMode | undefined;
  
  switch (isolationMode) {
    case 'per-tab':
      return PER_TAB_PROCESS_MODEL;
    case 'per-domain':
      return PER_DOMAIN_PROCESS_MODEL;
    case 'none':
    case undefined:
    default:
      return DEFAULT_PROCESS_MODEL;
  }
}
