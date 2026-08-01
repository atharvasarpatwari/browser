type Listener<T> = (payload: T) => void;

export class Emitter<Events extends object> {
  private listeners = new Map<keyof Events, Set<Listener<any>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return () => this.off(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
