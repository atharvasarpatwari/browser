import type { IDisposable } from '../../app/dependency-container';

interface ISettingsStore extends IDisposable {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  keys(): string[];
  entries(): [string, unknown][];
  load(): void;
  save(): void;
  reset(): void;
  readonly size: number;
}

const STORAGE_KEY = 'nova-settings';

class SettingsStore implements ISettingsStore {
  private data = new Map<string, unknown>();
  private storage: Storage | null;

  constructor(storage?: Storage) {
    this.storage = storage ?? null;
    this.load();
  }

  get size(): number { return this.data.size; }

  get(key: string): unknown {
    return this.data.get(key);
  }

  set(key: string, value: unknown): void {
    this.data.set(key, value);
    this.save();
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  delete(key: string): void {
    this.data.delete(key);
    this.save();
  }

  clear(): void {
    this.data.clear();
    this.save();
  }

  keys(): string[] {
    return [...this.data.keys()];
  }

  entries(): [string, unknown][] {
    return [...this.data.entries()];
  }

  load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: Record<string, unknown> = JSON.parse(raw);
        for (const [k, v] of Object.entries(parsed)) {
          this.data.set(k, v);
        }
      }
    } catch {
      // Corrupted storage — start fresh.
      this.data.clear();
    }
  }

  save(): void {
    if (!this.storage) return;
    try {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of this.data) {
        obj[k] = v;
      }
      this.storage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // Storage full or unavailable — swallow.
    }
  }

  reset(): void {
    this.data.clear();
    this.save();
  }

  dispose(): void {
    this.data.clear();
  }
}

export { SettingsStore, STORAGE_KEY };
export type { ISettingsStore };
