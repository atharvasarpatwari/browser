import { describe, it, expect, vi } from 'vitest';
import {
  DependencyContainer,
  ServiceLifetime,
  ServiceNotFoundError,
  CircularDependencyError,
  DuplicateRegistrationError,
} from '../src/app/dependency-container';

describe('DependencyContainer', () => {
  it('should register and resolve a singleton service', () => {
    const container = new DependencyContainer();
    const factory = vi.fn(() => ({ value: 42 }));
    container.register('test', factory);

    const result1 = container.resolve<{ value: number }>('test');
    const result2 = container.resolve<{ value: number }>('test');

    expect(result1.value).toBe(42);
    expect(result2).toBe(result1);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should create a new instance on every resolve for transient services', () => {
    const container = new DependencyContainer();
    let counter = 0;
    container.register('counter', () => counter++, ServiceLifetime.Transient);

    const a = container.resolve<number>('counter');
    const b = container.resolve<number>('counter');

    expect(a).toBe(0);
    expect(b).toBe(1);
  });

  it('should register a value via registerValue', () => {
    const container = new DependencyContainer();
    const config = { key: 'value' };
    container.registerValue('config', config);

    expect(container.resolve('config')).toBe(config);
  });

  it('should throw DuplicateRegistrationError on duplicate registration', () => {
    const container = new DependencyContainer();
    container.register('svc', () => ({}));
    expect(() => container.register('svc', () => ({}))).toThrow(DuplicateRegistrationError);
  });

  it('should throw DuplicateRegistrationError on duplicate registerValue', () => {
    const container = new DependencyContainer();
    container.registerValue('cfg', { a: 1 });
    expect(() => container.registerValue('cfg', { b: 2 })).toThrow(DuplicateRegistrationError);
  });

  it('should throw ServiceNotFoundError when resolving unregistered token', () => {
    const container = new DependencyContainer();
    expect(() => container.resolve('nonexistent')).toThrow(ServiceNotFoundError);
  });

  it('should throw CircularDependencyError on direct self-reference', () => {
    const container = new DependencyContainer();
    container.register('self', (c) => c.resolve('self'));
    expect(() => container.resolve('self')).toThrow(CircularDependencyError);
  });

  it('should throw CircularDependencyError on indirect cycle', () => {
    const container = new DependencyContainer();
    container.register('a', (c) => c.resolve('b'));
    container.register('b', (c) => c.resolve('c'));
    container.register('c', (c) => c.resolve('a'));
    expect(() => container.resolve('a')).toThrow(CircularDependencyError);
  });

  it('should have method return true/false for registered tokens', () => {
    const container = new DependencyContainer();
    container.register('svc', () => ({}));
    expect(container.has('svc')).toBe(true);
    expect(container.has('missing')).toBe(false);
  });

  it('should dispose singleton instances that implement IDisposable', () => {
    const container = new DependencyContainer();
    const dispose = vi.fn();
    container.registerValue('disposable', { dispose });

    container.resolve<{ dispose: () => void }>('disposable');
    container.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('should clear registry after dispose', () => {
    const container = new DependencyContainer();
    container.register('svc', () => ({}));
    container.resolve('svc');
    container.dispose();
    expect(container.has('svc')).toBe(false);
  });

  it('should support chaining via fluent register API', () => {
    const container = new DependencyContainer();
    container
      .register('a', () => ({}))
      .register('b', () => ({}));
    expect(container.has('a')).toBe(true);
    expect(container.has('b')).toBe(true);
  });

  it('should pass the container as argument to the factory', () => {
    const container = new DependencyContainer();
    const factory = vi.fn((c: unknown) => ({ container: c }));
    container.register('svc', factory);
    const resolved = container.resolve<{ container: unknown }>('svc');
    expect(resolved.container).toBe(container);
    expect(factory).toHaveBeenCalledWith(container);
  });

  it('should unregister a service', () => {
    const container = new DependencyContainer();
    container.register('svc', () => ({}));
    expect(container.has('svc')).toBe(true);
    container.unregister('svc');
    expect(container.has('svc')).toBe(false);
  });

  it('should call dispose on unregistered singleton if disposable', () => {
    const container = new DependencyContainer();
    const dispose = vi.fn();
    container.registerValue('svc', { dispose });
    container.resolve('svc');
    container.unregister('svc');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('should return all registered tokens via registeredTokens', () => {
    const container = new DependencyContainer();
    container.register('a', () => ({}));
    container.register('b', () => ({}));
    const tokens = container.registeredTokens();
    expect(tokens).toContain('a');
    expect(tokens).toContain('b');
  });

  it('should support symbol tokens', () => {
    const container = new DependencyContainer();
    const sym = Symbol('svc');
    container.register(sym, () => 99);
    expect(container.resolve<number>(sym)).toBe(99);
  });
});
