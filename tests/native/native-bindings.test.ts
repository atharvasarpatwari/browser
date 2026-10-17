import { describe, it, expect } from 'vitest';
import { isNativeAvailable, resolveDns } from '@/native/index';

describe('Native module loader', () => {
  it('should export isNativeAvailable', () => {
    expect(typeof isNativeAvailable).toBe('function');
  });

  it('isNativeAvailable returns boolean', () => {
    const result = isNativeAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('should export resolveDns function', () => {
    expect(typeof resolveDns).toBe('function');
  });
});

describe('TypeScript type exports', () => {
  it('should export all types', async () => {
    const types = await import('../../src/native/types');
    expect(types).toBeDefined();
  });
});
