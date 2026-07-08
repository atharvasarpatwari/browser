import { describe, it, expect } from 'vitest';
import { RuntimeAdapter } from '../src/platform/shared/runtime-adapter';

describe('RuntimeAdapter (happy-dom environment)', () => {
  const adapter = new RuntimeAdapter();

  it('should detect browser + node environment (happy-dom)', () => {
    const info = adapter.getRuntimeInfo();
    // In happy-dom both window and process are available
    expect(info.environment).toBe('electron');
  });

  it('should return a platform string', () => {
    const info = adapter.getRuntimeInfo();
    expect(typeof info.platform).toBe('string');
  });

  it('should return an arch string', () => {
    const info = adapter.getRuntimeInfo();
    expect(typeof info.arch).toBe('string');
  });

  it('should have hasProcess = true', () => {
    const info = adapter.getRuntimeInfo();
    expect(info.hasProcess).toBe(true);
  });

  it('should have hasWindow = true in happy-dom', () => {
    const info = adapter.getRuntimeInfo();
    expect(info.hasWindow).toBe(true);
  });

  it('should return node version', () => {
    const info = adapter.getRuntimeInfo();
    expect(info.nodeVersion).not.toBeNull();
  });

  it('should have undefined electronVersion', () => {
    const info = adapter.getRuntimeInfo();
    expect(info.electronVersion).toBeNull();
  });

  it('should return a language string', () => {
    const info = adapter.getRuntimeInfo();
    expect(typeof info.language).toBe('string');
  });

  it('should return a hardwareConcurrency number', () => {
    const info = adapter.getRuntimeInfo();
    expect(typeof info.hardwareConcurrency).toBe('number');
  });

  it('getFileSystem should return ops with readFile throwing', async () => {
    const fs = adapter.getFileSystem();
    await expect(fs.readFile('/some/path')).rejects.toThrow('File system not available');
  });

  it('getFileSystem should return ops with fileExists returning false', async () => {
    const fs = adapter.getFileSystem();
    await expect(fs.fileExists('/some/path')).resolves.toBe(false);
  });

  it('getClipboard should return ops', async () => {
    const clip = adapter.getClipboard();
    const text = await clip.readText();
    expect(typeof text).toBe('string');
  });

  it('getScreenInfo should return screen dimensions', () => {
    const info = adapter.getScreenInfo();
    expect(info.width).toBeGreaterThan(0);
    expect(info.height).toBeGreaterThan(0);
  });

  it('beep should not throw', () => {
    expect(() => adapter.beep()).not.toThrow();
  });

  it('getenv should return a string for PATH', () => {
    const path = adapter.getenv('PATH');
    expect(typeof path).toBe('string');
  });

  it('getenv should return undefined for a missing variable', () => {
    expect(adapter.getenv('__NOVA_UNDEFINED_ENV_VAR_12345__')).toBeUndefined();
  });

  it('getProcessId should return a number', () => {
    const pid = adapter.getProcessId();
    expect(typeof pid).toBe('number');
    expect(pid).toBeGreaterThan(0);
  });

  it('dispose should not throw', () => {
    expect(() => adapter.dispose()).not.toThrow();
  });
});
