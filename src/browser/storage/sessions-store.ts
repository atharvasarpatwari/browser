import type { IDisposable } from '../../app/dependency-container';
import type { NavigationEntry } from '../navigation/navigation-controller';

interface SessionData {
  readonly id: string;
  readonly windows: SessionWindowData[];
  readonly lastUpdated: number;
  readonly version: string;
}

interface SessionWindowData {
  readonly windowId: string;
  readonly tabs: SessionTabData[];
  readonly isActive: boolean;
}

interface SessionTabData {
  readonly tabId: string;
  readonly url: string;
  readonly title: string;
  readonly history: readonly NavigationEntry[];
  readonly cursor: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly pinned: boolean;
  readonly muted: boolean;
  readonly groupId: string | null;
}

interface ISessionsStore extends IDisposable {
  save(session: SessionData): Promise<void>;
  load(sessionId: string): Promise<SessionData | null>;
  list(): Promise<SessionData[]>;
  delete(sessionId: string): Promise<boolean>;
  getCurrentSessionId(): string | null;
  setCurrentSessionId(id: string | null): void;
  readonly count: number;
}

const DEFAULT_VERSION = '1.0.0';

class InMemorySessionsStore implements ISessionsStore {
  private readonly sessions = new Map<string, SessionData>();
  private currentSessionId: string | null = null;

  async save(session: SessionData): Promise<void> {
    const data: SessionData = {
      ...session,
      lastUpdated: Date.now(),
      version: session.version || DEFAULT_VERSION,
    };
    this.sessions.set(session.id, data);
  }

  async load(sessionId: string): Promise<SessionData | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async list(): Promise<SessionData[]> {
    return [...this.sessions.values()]
      .sort((a, b) => b.lastUpdated - a.lastUpdated);
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.sessions.delete(sessionId);
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  setCurrentSessionId(id: string | null): void {
    this.currentSessionId = id;
  }

  get count(): number {
    return this.sessions.size;
  }

  dispose(): void {
    this.sessions.clear();
    this.currentSessionId = null;
  }
}

export { InMemorySessionsStore, DEFAULT_VERSION };
export type { ISessionsStore, SessionData, SessionWindowData, SessionTabData };
