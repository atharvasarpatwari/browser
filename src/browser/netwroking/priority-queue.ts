// ─────────────────────────────────────────────────────────────────────────────
// PRIORITY QUEUE — Generic binary min-heap
// ─────────────────────────────────────────────────────────────────────────────

interface PriorityQueueEntry<T> {
  readonly item: T;
  readonly priority: number;
  readonly insertionOrder: number;
}

class PriorityQueue<T> {
  private heap: PriorityQueueEntry<T>[] = [];
  private counter = 0;

  get size(): number {
    return this.heap.length;
  }

  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  enqueue(item: T, priority: number): void {
    const entry: PriorityQueueEntry<T> = { item, priority, insertionOrder: this.counter++ };
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
  }

  peek(): T | undefined {
    return this.heap[0]?.item;
  }

  dequeue(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top.item;
  }

  drain(): T[] {
    const result: T[] = [];
    while (this.heap.length > 0) {
      result.push(this.dequeue()!);
    }
    return result;
  }

  remove(predicate: (item: T) => boolean): T[] {
    const removed: T[] = [];
    const retained: PriorityQueueEntry<T>[] = [];
    for (const entry of this.heap) {
      if (predicate(entry.item)) {
        removed.push(entry.item);
      } else {
        retained.push(entry);
      }
    }
    if (removed.length > 0) {
      this.heap = retained;
      this.rebuildHeap();
    }
    return removed;
  }

  filter(predicate: (item: T) => boolean): T[] {
    return this.heap.filter(e => predicate(e.item)).map(e => e.item);
  }

  clear(): void {
    this.heap.length = 0;
  }

  toArray(): T[] {
    return [...this.heap].sort((a, b) => a.priority - b.priority || a.insertionOrder - b.insertionOrder).map(e => e.item);
  }

  // ── Heap internals ─────────────────────────────────────────────────────────

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.isHigherPriority(idx, parent)) {
        this.swap(idx, parent);
        idx = parent;
      } else {
        break;
      }
    }
  }

  private sinkDown(idx: number): void {
    const n = this.heap.length;
    while (true) {
      let best = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      if (left < n && this.isHigherPriority(left, best)) best = left;
      if (right < n && this.isHigherPriority(right, best)) best = right;
      if (best !== idx) {
        this.swap(idx, best);
        idx = best;
      } else {
        break;
      }
    }
  }

  private isHigherPriority(a: number, b: number): boolean {
    const ea = this.heap[a]!;
    const eb = this.heap[b]!;
    return ea.priority < eb.priority || (ea.priority === eb.priority && ea.insertionOrder < eb.insertionOrder);
  }

  private swap(a: number, b: number): void {
    const tmp = this.heap[a]!;
    this.heap[a] = this.heap[b]!;
    this.heap[b] = tmp;
  }

  private rebuildHeap(): void {
    for (let i = (this.heap.length >> 1) - 1; i >= 0; i--) {
      this.sinkDown(i);
    }
  }
}

export { PriorityQueue };
