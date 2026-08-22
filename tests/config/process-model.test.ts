import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_PROCESS_MODEL,
  PER_TAB_PROCESS_MODEL,
  PER_DOMAIN_PROCESS_MODEL,
  validateProcessModelConfig,
  getProcessModelFromEnvironment,
} from '@/app/config/process-model';
import type { ProcessModelConfig } from '@/app/config/process-model';

describe('ProcessModelConfig', () => {
  describe('DEFAULT_PROCESS_MODEL', () => {
    it('should have single-process mode', () => {
      expect(DEFAULT_PROCESS_MODEL.isolationMode).toBe('none');
      expect(DEFAULT_PROCESS_MODEL.enableRendererIsolation).toBe(false);
    });

    it('should have reasonable defaults', () => {
      expect(DEFAULT_PROCESS_MODEL.maxRendererProcesses).toBe(0);
      expect(DEFAULT_PROCESS_MODEL.enableGpuAcceleration).toBe(true);
      expect(DEFAULT_PROCESS_MODEL.enableWebWorkers).toBe(true);
      expect(DEFAULT_PROCESS_MODEL.enableProcessRestart).toBe(true);
      expect(DEFAULT_PROCESS_MODEL.maxRestartAttempts).toBe(3);
      expect(DEFAULT_PROCESS_MODEL.rendererStartupTimeoutMs).toBe(10_000);
      expect(DEFAULT_PROCESS_MODEL.rendererMemoryLimitBytes).toBe(0);
      expect(DEFAULT_PROCESS_MODEL.enablePriorityManagement).toBe(true);
    });
  });

  describe('PER_TAB_PROCESS_MODEL', () => {
    it('should have per-tab isolation', () => {
      expect(PER_TAB_PROCESS_MODEL.isolationMode).toBe('per-tab');
      expect(PER_TAB_PROCESS_MODEL.enableRendererIsolation).toBe(true);
    });

    it('should have reasonable defaults', () => {
      expect(PER_TAB_PROCESS_MODEL.maxRendererProcesses).toBe(20);
      expect(PER_TAB_PROCESS_MODEL.enableGpuAcceleration).toBe(true);
      expect(PER_TAB_PROCESS_MODEL.enableWebWorkers).toBe(true);
      expect(PER_TAB_PROCESS_MODEL.enableProcessRestart).toBe(true);
      expect(PER_TAB_PROCESS_MODEL.maxRestartAttempts).toBe(3);
      expect(PER_TAB_PROCESS_MODEL.rendererStartupTimeoutMs).toBe(10_000);
      expect(PER_TAB_PROCESS_MODEL.rendererMemoryLimitBytes).toBe(512 * 1024 * 1024); // 512MB
    });
  });

  describe('PER_DOMAIN_PROCESS_MODEL', () => {
    it('should have per-domain isolation', () => {
      expect(PER_DOMAIN_PROCESS_MODEL.isolationMode).toBe('per-domain');
      expect(PER_DOMAIN_PROCESS_MODEL.enableRendererIsolation).toBe(true);
    });

    it('should have reasonable defaults', () => {
      expect(PER_DOMAIN_PROCESS_MODEL.maxRendererProcesses).toBe(50);
      expect(PER_DOMAIN_PROCESS_MODEL.enableGpuAcceleration).toBe(true);
      expect(PER_DOMAIN_PROCESS_MODEL.enableWebWorkers).toBe(true);
      expect(PER_DOMAIN_PROCESS_MODEL.enableProcessRestart).toBe(true);
      expect(PER_DOMAIN_PROCESS_MODEL.maxRestartAttempts).toBe(3);
      expect(PER_DOMAIN_PROCESS_MODEL.rendererStartupTimeoutMs).toBe(10_000);
      expect(PER_DOMAIN_PROCESS_MODEL.rendererMemoryLimitBytes).toBe(256 * 1024 * 1024); // 256MB
    });
  });
});

describe('validateProcessModelConfig', () => {
  it('should return no errors for valid config', () => {
    const errors = validateProcessModelConfig(DEFAULT_PROCESS_MODEL);
    expect(errors).toHaveLength(0);
  });

  it('should error when isolationMode is missing', () => {
    const config = { ...DEFAULT_PROCESS_MODEL, isolationMode: undefined as any };
    const errors = validateProcessModelConfig(config);
    expect(errors).toContain('isolationMode is required');
  });

  it('should error when maxRendererProcesses is negative', () => {
    const config = { ...DEFAULT_PROCESS_MODEL, maxRendererProcesses: -1 };
    const errors = validateProcessModelConfig(config);
    expect(errors).toContain('maxRendererProcesses must be >= 0');
  });

  it('should error when rendererStartupTimeoutMs is too low', () => {
    const config = { ...DEFAULT_PROCESS_MODEL, rendererStartupTimeoutMs: 500 };
    const errors = validateProcessModelConfig(config);
    expect(errors).toContain('rendererStartupTimeoutMs must be >= 1000');
  });

  it('should error when maxRestartAttempts is negative', () => {
    const config = { ...DEFAULT_PROCESS_MODEL, maxRestartAttempts: -1 };
    const errors = validateProcessModelConfig(config);
    expect(errors).toContain('maxRestartAttempts must be >= 0');
  });

  it('should return multiple errors for multiple issues', () => {
    const config = {
      ...DEFAULT_PROCESS_MODEL,
      isolationMode: undefined as any,
      maxRendererProcesses: -1,
      rendererStartupTimeoutMs: 500,
    };
    const errors = validateProcessModelConfig(config);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('getProcessModelFromEnvironment', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return default model when env var is not set', () => {
    delete process.env['NOVA_PROCESS_ISOLATION'];
    const model = getProcessModelFromEnvironment();
    expect(model).toEqual(DEFAULT_PROCESS_MODEL);
  });

  it('should return per-tab model when env var is "per-tab"', () => {
    process.env['NOVA_PROCESS_ISOLATION'] = 'per-tab';
    const model = getProcessModelFromEnvironment();
    expect(model).toEqual(PER_TAB_PROCESS_MODEL);
  });

  it('should return per-domain model when env var is "per-domain"', () => {
    process.env['NOVA_PROCESS_ISOLATION'] = 'per-domain';
    const model = getProcessModelFromEnvironment();
    expect(model).toEqual(PER_DOMAIN_PROCESS_MODEL);
  });

  it('should return default model when env var is "none"', () => {
    process.env['NOVA_PROCESS_ISOLATION'] = 'none';
    const model = getProcessModelFromEnvironment();
    expect(model).toEqual(DEFAULT_PROCESS_MODEL);
  });

  it('should return default model for unknown values', () => {
    process.env['NOVA_PROCESS_ISOLATION'] = 'unknown';
    const model = getProcessModelFromEnvironment();
    expect(model).toEqual(DEFAULT_PROCESS_MODEL);
  });
});
