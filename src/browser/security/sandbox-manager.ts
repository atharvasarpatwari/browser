import type { IDisposable } from '../../app/dependency-container';

interface SandboxPermissions {
  readonly allowScripts: boolean;
  readonly allowForms: boolean;
  readonly allowModals: boolean;
  readonly allowPopups: boolean;
  readonly allowSameOrigin: boolean;
  readonly allowTopNavigation: boolean;
  readonly allowPointerLock: boolean;
  readonly allowOrientationLock: boolean;
  readonly allowPresentation: boolean;
}

interface SandboxConfig {
  readonly enabled: boolean;
  readonly defaultPermissions: SandboxPermissions;
  readonly trustedOrigins: readonly string[];
  readonly permissionOverrides: ReadonlyMap<string, Partial<SandboxPermissions>>;
}

const DEFAULT_SANDBOX_PERMISSIONS: SandboxPermissions = {
  allowScripts: true,
  allowForms: true,
  allowModals: false,
  allowPopups: false,
  allowSameOrigin: true,
  allowTopNavigation: false,
  allowPointerLock: false,
  allowOrientationLock: false,
  allowPresentation: false,
};

const FULL_TRUST_PERMISSIONS: SandboxPermissions = {
  allowScripts: true,
  allowForms: true,
  allowModals: true,
  allowPopups: true,
  allowSameOrigin: true,
  allowTopNavigation: true,
  allowPointerLock: true,
  allowOrientationLock: true,
  allowPresentation: true,
};

interface ISandboxManager extends IDisposable {
  getPermissionsForOrigin(origin: string): SandboxPermissions;
  isSandboxed(origin: string): boolean;
  setTrustedOrigin(origin: string): void;
  removeTrustedOrigin(origin: string): void;
  setPermissionOverride(origin: string, permissions: Partial<SandboxPermissions>): void;
  removePermissionOverride(origin: string): void;
  getConfig(): SandboxConfig;
  updateConfig(config: Partial<SandboxConfig>): void;
}

class SandboxManager implements ISandboxManager {
  private config: SandboxConfig;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = {
      enabled: true,
      defaultPermissions: { ...DEFAULT_SANDBOX_PERMISSIONS },
      trustedOrigins: [],
      permissionOverrides: new Map(),
      ...config,
    };
  }

  getPermissionsForOrigin(origin: string): SandboxPermissions {
    if (!this.config.enabled) return { ...FULL_TRUST_PERMISSIONS };

    if (this.config.trustedOrigins.includes(origin)) {
      return { ...FULL_TRUST_PERMISSIONS };
    }

    const override = this.config.permissionOverrides.get(origin);
    if (override) {
      return { ...this.config.defaultPermissions, ...override };
    }

    return { ...this.config.defaultPermissions };
  }

  isSandboxed(origin: string): boolean {
    if (!this.config.enabled) return false;
    return !this.config.trustedOrigins.includes(origin);
  }

  setTrustedOrigin(origin: string): void {
    if (!this.config.trustedOrigins.includes(origin)) {
      this.config = {
        ...this.config,
        trustedOrigins: [...this.config.trustedOrigins, origin],
      };
    }
  }

  removeTrustedOrigin(origin: string): void {
    this.config = {
      ...this.config,
      trustedOrigins: this.config.trustedOrigins.filter(o => o !== origin),
    };
  }

  setPermissionOverride(origin: string, permissions: Partial<SandboxPermissions>): void {
    const overrides = new Map(this.config.permissionOverrides);
    overrides.set(origin, permissions);
    this.config = { ...this.config, permissionOverrides: overrides };
  }

  removePermissionOverride(origin: string): void {
    const overrides = new Map(this.config.permissionOverrides);
    overrides.delete(origin);
    this.config = { ...this.config, permissionOverrides: overrides };
  }

  getConfig(): SandboxConfig {
    return {
      ...this.config,
      permissionOverrides: new Map(this.config.permissionOverrides),
    };
  }

  updateConfig(config: Partial<SandboxConfig>): void {
    if (config.enabled !== undefined) {
      this.config = { ...this.config, enabled: config.enabled };
    }
    if (config.defaultPermissions !== undefined) {
      this.config = { ...this.config, defaultPermissions: config.defaultPermissions };
    }
    if (config.trustedOrigins !== undefined) {
      this.config = { ...this.config, trustedOrigins: [...config.trustedOrigins] };
    }
    if (config.permissionOverrides !== undefined) {
      this.config = { ...this.config, permissionOverrides: new Map(config.permissionOverrides) };
    }
  }

  dispose(): void {
    // ReadonlyMap cannot be cleared; the config will be garbage collected.
  }
}

export { SandboxManager, DEFAULT_SANDBOX_PERMISSIONS, FULL_TRUST_PERMISSIONS };
export type { ISandboxManager, SandboxPermissions, SandboxConfig };
