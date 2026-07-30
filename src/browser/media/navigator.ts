import type { IDisposable } from '../../app/dependency-container';

interface INavigatorService extends IDisposable {
  readonly userAgent: string;
  readonly platform: string;
  readonly language: string;
  readonly languages: string[];
  readonly vendor: string;
  readonly cookieEnabled: boolean;
  readonly onLine: boolean;
  readonly hardwareConcurrency: number;
  readonly maxTouchPoints: number;
  readonly appName: string;
  readonly appVersion: string;
  readonly product: string;
  readonly doNotTrack: string | null;
  vibrate(pattern: number | number[]): boolean;
  getBattery(): Promise<BatteryInfo>;
  readonly connection: NetworkConnection | null;
  onEvent(handler: NavigatorEventHandler): () => void;
}

interface BatteryInfo {
  readonly charging: boolean;
  readonly level: number;
  readonly chargingTime: number;
  readonly dischargingTime: number;
}

interface NetworkConnection {
  readonly effectiveType: string;
  readonly downlink: number;
  readonly rtt: number;
  readonly saveData: boolean;
}

interface NavigatorEvent {
  readonly kind: NavigatorEventKind;
  readonly data?: Record<string, unknown>;
}

type NavigatorEventKind = 'online' | 'offline' | 'connection';
type NavigatorEventHandler = (event: NavigatorEvent) => void;

class NavigatorService implements INavigatorService {
  readonly userAgent = 'NovaBrowser/1.0';
  readonly platform = 'Win32';
  readonly language = 'en-US';
  readonly languages = ['en-US', 'en'];
  readonly vendor = '';
  readonly cookieEnabled = true;
  readonly onLine = true;
  readonly hardwareConcurrency = 8;
  readonly maxTouchPoints = 0;
  readonly appName = 'Nova';
  readonly appVersion = '1.0';
  readonly product = 'Gecko';
  readonly doNotTrack: string | null = null;
  readonly connection: NetworkConnection | null = {
    effectiveType: '4g',
    downlink: 10,
    rtt: 50,
    saveData: false,
  };

  private _handlers = new Set<NavigatorEventHandler>();

  vibrate(_pattern: number | number[]): boolean {
    return false;
  }

  async getBattery(): Promise<BatteryInfo> {
    return { charging: true, level: 1, chargingTime: 0, dischargingTime: Infinity };
  }

  setOnline(online: boolean): void {
    if (online !== this.onLine) {
      (this as any).onLine = online;
      this.emit({ kind: online ? 'online' : 'offline' });
    }
  }

  onEvent(handler: NavigatorEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: NavigatorEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
  }
}

export { NavigatorService };
export type { INavigatorService, BatteryInfo, NetworkConnection, NavigatorEvent, NavigatorEventKind, NavigatorEventHandler };
