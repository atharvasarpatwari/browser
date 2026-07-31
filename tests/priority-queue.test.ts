import { describe, it, expect, beforeEach } from 'vitest';
import { PriorityQueue } from '../src/browser/networking/priority-queue';

describe('PriorityQueue', () => {
  let pq: PriorityQueue<string>;

  beforeEach(() => {
    pq = new PriorityQueue();
  });

  it('should enqueue and dequeue in priority order', () => {
    pq.enqueue('low', 3);
    pq.enqueue('high', 1);
    pq.enqueue('medium', 2);
    expect(pq.dequeue()).toBe('high');
    expect(pq.dequeue()).toBe('medium');
    expect(pq.dequeue()).toBe('low');
  });

  it('should use insertion order for equal priorities', () => {
    pq.enqueue('first', 1);
    pq.enqueue('second', 1);
    pq.enqueue('third', 1);
    expect(pq.dequeue()).toBe('first');
    expect(pq.dequeue()).toBe('second');
    expect(pq.dequeue()).toBe('third');
  });

  it('should return undefined when empty', () => {
    expect(pq.dequeue()).toBeUndefined();
    expect(pq.peek()).toBeUndefined();
  });

  it('should peek without removing', () => {
    pq.enqueue('item', 1);
    expect(pq.peek()).toBe('item');
    expect(pq.size).toBe(1);
  });

  it('should track size and isEmpty', () => {
    expect(pq.size).toBe(0);
    expect(pq.isEmpty).toBe(true);
    pq.enqueue('a', 1);
    expect(pq.size).toBe(1);
    expect(pq.isEmpty).toBe(false);
  });

  it('should drain all items in order', () => {
    pq.enqueue('c', 3);
    pq.enqueue('a', 1);
    pq.enqueue('b', 2);
    const items = pq.drain();
    expect(items).toEqual(['a', 'b', 'c']);
    expect(pq.isEmpty).toBe(true);
  });

  it('should remove items matching predicate', () => {
    pq.enqueue('keep-a', 1);
    pq.enqueue('remove-b', 2);
    pq.enqueue('keep-c', 3);
    pq.enqueue('remove-d', 4);
    const removed = pq.remove(item => item.includes('remove'));
    expect(removed).toEqual(['remove-b', 'remove-d']);
    expect(pq.size).toBe(2);
  });

  it('should filter items', () => {
    pq.enqueue('a-1', 1);
    pq.enqueue('b-2', 2);
    pq.enqueue('a-3', 3);
    const filtered = pq.filter(item => item.startsWith('a'));
    expect(filtered).toEqual(['a-1', 'a-3']);
  });

  it('should clear all items', () => {
    pq.enqueue('a', 1);
    pq.enqueue('b', 2);
    pq.clear();
    expect(pq.isEmpty).toBe(true);
  });

  it('should return sorted array via toArray', () => {
    pq.enqueue('c', 3);
    pq.enqueue('a', 1);
    pq.enqueue('b', 2);
    const arr = pq.toArray();
    expect(arr).toEqual(['a', 'b', 'c']);
  });

  it('should handle large number of items correctly', () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    // Enqueue in reverse priority (highest first = lowest priority number last)
    for (const v of values) {
      pq.enqueue(String(v), v);
    }
    // Should dequeue in ascending order
    for (let i = 0; i < 100; i++) {
      expect(pq.dequeue()).toBe(String(i));
    }
  });

  it('should handle single element', () => {
    pq.enqueue('only', 1);
    expect(pq.dequeue()).toBe('only');
    expect(pq.isEmpty).toBe(true);
  });
});
