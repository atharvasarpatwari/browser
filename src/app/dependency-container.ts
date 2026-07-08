/**
 * @file dependency-container.ts
 * @layer App Bootstrap — Session 1 / File 1
 *
 * Inversion-of-Control container.  Services are registered once and resolved
 * on demand.  Two lifetimes are supported:
 *
 *   • Singleton  — created on first resolve, then reused for the process lifetime.
 *   • Transient  — a new instance is created on every resolve call.
 *
 * OOP principles applied
 * ─────────────────────
 *   Abstraction      — callers depend on IServiceContainer, not the concrete class.
 *   Encapsulation    — the descriptor map and resolution stack are private.
 *   Single-Resp.     — this module only manages service wiring.
 *   Open/Closed      — new lifetime strategies can be added without changing
 *                      the container's public interface.
 *   Dependency-Inv.  — every consumer receives its dependency through the
 *                      container rather than instantiating it directly.
 */

// ── Service token ────────────────────────────────────────────────────────────

/** A unique key used to identify a service registration. */
type ServiceToken = string | symbol;

// ── Lifetime ─────────────────────────────────────────────────────────────────

/** Controls how long a resolved service instance lives. */
enum ServiceLifetime {
  /** One instance shared across the entire application. */
  Singleton = 'singleton',
  /** A fresh instance created on every call to resolve(). */
  Transient = 'transient',
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * A function that creates a service.
 * Receives the container so it can resolve its own dependencies.
 */
type ServiceFactory<T> = (container: IServiceContainer) => T;

// ── Descriptor ───────────────────────────────────────────────────────────────

/**
 * Internal record that describes how a service is created and cached.
 * The `instance` field is populated lazily for singletons.
 */
interface ServiceDescriptor<T> {
  readonly token: ServiceToken;
  readonly lifetime: ServiceLifetime;
  readonly factory: ServiceFactory<T>;
  instance?: T;
}

// ── Disposable ───────────────────────────────────────────────────────────────

/** Optional interface for services that need deterministic cleanup. */
interface IDisposable {
  dispose(): void;
}

function isDisposable(value: unknown): value is IDisposable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as IDisposable).dispose === 'function'
  );
}

// ── Public container interface ───────────────────────────────────────────────

interface IServiceContainer {
  /**
   * Register a service using a factory function.
   * @param token    Unique identifier for the service.
   * @param factory  Function that constructs the service.
   * @param lifetime Defaults to Singleton.
   * @returns `this` for fluent chaining.
   */
  register<T>(
    token: ServiceToken,
    factory: ServiceFactory<T>,
    lifetime?: ServiceLifetime,
  ): this;

  /**
   * Register an already-constructed value as a singleton.
   * Useful for configuration objects or third-party instances.
   */
  registerValue<T>(token: ServiceToken, value: T): this;

  /**
   * Resolve a service by token.
   * @throws {ServiceNotFoundError}    if no matching registration exists.
   * @throws {CircularDependencyError} if a cycle is detected during resolution.
   */
  resolve<T>(token: ServiceToken): T;

  /** Returns true if a service with `token` has been registered. */
  has(token: ServiceToken): boolean;

  /** Calls dispose() on every singleton that implements IDisposable, then clears all registrations. */
  dispose(): void;
}

// ── Errors ───────────────────────────────────────────────────────────────────

class ServiceNotFoundError extends Error {
  readonly token: ServiceToken;

  constructor(token: ServiceToken) {
    super(`No service registered for token: ${String(token)}`);
    this.name = 'ServiceNotFoundError';
    this.token = token;
  }
}

class CircularDependencyError extends Error {
  readonly chain: ServiceToken[];

  constructor(token: ServiceToken, chain: ServiceToken[]) {
    const formatted = [...chain, token].map(String).join(' → ');
    super(`Circular dependency detected: ${formatted}`);
    this.name = 'CircularDependencyError';
    this.chain = chain;
  }
}

class DuplicateRegistrationError extends Error {
  constructor(token: ServiceToken) {
    super(
      `Service "${String(token)}" is already registered. ` +
      `Call unregister() first if you intend to replace it.`,
    );
    this.name = 'DuplicateRegistrationError';
  }
}

// ── Concrete container ───────────────────────────────────────────────────────

/**
 * Default IServiceContainer implementation.
 *
 * Thread-safety: JavaScript is single-threaded, so no locking is needed.
 * However, the resolution stack guards against synchronous cycles that would
 * otherwise cause infinite recursion.
 */
class DependencyContainer implements IServiceContainer {
  // All registered service descriptors, keyed by token.
  private readonly registry = new Map<ServiceToken, ServiceDescriptor<unknown>>();

  // Tracks the chain of tokens currently being resolved; used for cycle detection.
  private readonly resolutionStack: ServiceToken[] = [];

  // ── Registration ────────────────────────────────────────────────────────────

  register<T>(
    token: ServiceToken,
    factory: ServiceFactory<T>,
    lifetime: ServiceLifetime = ServiceLifetime.Singleton,
  ): this {
    if (this.registry.has(token)) {
      throw new DuplicateRegistrationError(token);
    }

    const descriptor: ServiceDescriptor<T> = { token, lifetime, factory };
    this.registry.set(token, descriptor as ServiceDescriptor<unknown>);
    return this;
  }

  registerValue<T>(token: ServiceToken, value: T): this {
    if (this.registry.has(token)) {
      throw new DuplicateRegistrationError(token);
    }

    const descriptor: ServiceDescriptor<T> = {
      token,
      lifetime: ServiceLifetime.Singleton,
      factory: () => value,
      instance: value,       // already resolved — skip factory on first resolve
    };
    this.registry.set(token, descriptor as ServiceDescriptor<unknown>);
    return this;
  }

  /** Remove a registration.  Useful in tests or plugin scenarios. */
  unregister(token: ServiceToken): this {
    const descriptor = this.registry.get(token);
    if (descriptor?.instance && isDisposable(descriptor.instance)) {
      descriptor.instance.dispose();
    }
    this.registry.delete(token);
    return this;
  }

  // ── Resolution ──────────────────────────────────────────────────────────────

  resolve<T>(token: ServiceToken): T {
    const descriptor = this.registry.get(token) as ServiceDescriptor<T> | undefined;

    if (!descriptor) {
      throw new ServiceNotFoundError(token);
    }

    // Return the cached singleton instance immediately.
    if (
      descriptor.lifetime === ServiceLifetime.Singleton &&
      descriptor.instance !== undefined
    ) {
      return descriptor.instance;
    }

    // Detect circular dependency before entering the factory.
    if (this.resolutionStack.includes(token)) {
      throw new CircularDependencyError(token, [...this.resolutionStack]);
    }

    this.resolutionStack.push(token);
    let instance: T;

    try {
      instance = descriptor.factory(this);
    } finally {
      // Always pop, even if the factory throws, to keep the stack clean.
      this.resolutionStack.pop();
    }

    if (descriptor.lifetime === ServiceLifetime.Singleton) {
      // Cache for future resolves.
      descriptor.instance = instance;
    }

    return instance;
  }

  // ── Introspection ────────────────────────────────────────────────────────────

  has(token: ServiceToken): boolean {
    return this.registry.has(token);
  }

  /** Returns all currently registered tokens — useful for diagnostics. */
  registeredTokens(): ServiceToken[] {
    return [...this.registry.keys()];
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  dispose(): void {
    for (const descriptor of this.registry.values()) {
      if (descriptor.instance && isDisposable(descriptor.instance)) {
        try {
          descriptor.instance.dispose();
        } catch (err) {
          // Swallow individual dispose errors so all services get a chance to clean up.
          console.error(
            `[DependencyContainer] Error disposing "${String(descriptor.token)}":`,
            err,
          );
        }
      }
    }
    this.registry.clear();
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

export {
  DependencyContainer,
  ServiceLifetime,
  ServiceNotFoundError,
  CircularDependencyError,
  DuplicateRegistrationError,
};

export type {
  IServiceContainer,
  IDisposable,
  ServiceDescriptor,
  ServiceFactory,
  ServiceToken,
};