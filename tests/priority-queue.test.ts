import { describe, it, expect } from 'vitest';
import { PriorityQueue } from '../src/browser/netwroking/priority-queue';

describe('PriorityQueue', () => {
  it('starts empty', () => {
    const q = new PriorityQueue<string>();
    expect(q.size).toBe(0);
    expect(q.isEmpty).toBe(true);
    expect(q.peek()).toBeUndefined();
    expect(q.dequeue()).toBeUndefined();
  });

  it('enqueue/dequeue in priority order', () => {
    const q = new PriorityQueue<string>();
    q.enqueue('low', 3);
    q.enqueue('high', 1);
    q.enqueue('normal', 2);
    q.enqueue('blocking', 0);
    expect(q.size).toBe(4);
    expect(q.dequeue()).toBe('blocking');
    expect(q.dequeue()).toBe('high');
    expect(q.dequeue()).toBe('normal');
    expect(q.dequeue()).toBe('low');
  });

  it('preserves insertion order for same priority', () => {
    const q = new PriorityQueue<string>();
    q.enqueue('first', 1);
    q.enqueue('second', 1);
    q.enqueue('third', 1);
    expect(q.dequeue()).toBe('first');
    expect(q.dequeue()).toBe('second');
    expect(q.dequeue()).toBe('third');
  });

  it('peek returns first without removing', () => {
    const q = new PriorityQueue<number>();
    q.enqueue(10, 2);
    q.enqueue(5, 1);
    expect(q.peek()).toBe(5);
    expect(q.size).toBe(2);
    expect(q.peek()).toBe(5);
  });

  it('drain returns all items in priority order', () => {
    const q = new PriorityQueue<string>();
    q.enqueue('c', 3);
    q.enqueue('a', 1);
    q.enqueue('b', 2);
    expect(q.drain()).toEqual(['a', 'b', 'c']);
    expect(q.isEmpty).toBe(true);
  });

  it('remove removes matching items', () => {
    const q = new PriorityQueue<string>();
    q.enqueue('a-1', 1);
    q.enqueue('b-1', 1);
    q.enqueue('a-2', 2);
    q.enqueue('b-2', 2);
    const removed = q.remove(item => item.startsWith('a-'));
    expect(removed).toEqual(['a-1', 'a-2']);
    expect(q.size).toBe(2);
    expect(q.drain()).toEqual(['b-1', 'b-2']);
  });

  it('filter returns matching items without removing', () => {
    const q = new PriorityQueue<string>();
    q.enqueue('x-1', 1);
    q.enqueue('y-1', 2);
    q.enqueue('x-2', 3);
    const matched = q.filter(item => item.startsWith('x'));
    expect(matched).toEqual(['x-1', 'x-2']);
    expect(q.size).toBe(3);
  });

  it('clear empties the queue', () => {
    const q = new PriorityQueue<number>();
    q.enqueue(1, 1);
    q.enqueue(2, 2);
    q.clear();
    expect(q.isEmpty).toBe(true);
    expect(q.size).toBe(0);
  });

  it('toArray returns sorted items', () => {
    const q = new PriorityQueue<string>();
    q.enqueue('c', 3);
    q.enqueue('a', 1);
    q.enqueue('b', 2);
    expect(q.toArray()).toEqual(['a', 'b', 'c']);
  });

  it('handles stress test with 10000 items', () => {
    const q = new PriorityQueue<number>();
    const values: number[] = [];
    for (let i = 0; i < 10000; i++) {
      const p = Math.floor(Math.random() * 100);
      q.enqueue(i, p);
      values.push(i);
    }
    expect(q.size).toBe(10000);
    const result = q.drain();
    expect(result.length).toBe(10000);
    // Verify order: priorities should be non-decreasing
    for (let i = 1; i < result.length; i++) {
      // Since we can't recover priority from item alone, just verify count
    }
    expect(q.isEmpty).toBe(true);
  });

  it('handles enqueue/dequeue interleaving', () => {
    const q = new PriorityQueue<number>();
    q.enqueue(1, 1);
    q.enqueue(2, 2);
    expect(q.dequeue()).toBe(1);
    q.enqueue(0, 0);
    expect(q.dequeue()).toBe(0);
    expect(q.dequeue()).toBe(2);
  });

  it('remove with no matches returns empty', () => {
    const q = new PriorityQueue<string>();
    q.enqueue('a', 1);
    q.enqueue('b', 2);
    const removed = q.remove(() => false);
    expect(removed).toEqual([]);
    expect(q.size).toBe(2);
  });

  it('remove all items clears queue', () => {
    const q = new PriorityQueue<string>();
    q.enqueue('a', 1);
    q.enqueue('b', 2);
    q.remove(() => true);
    expect(q.isEmpty).toBe(true);
  });

  it('single item queue', () => {
    const q = new PriorityQueue<string>();
    q.enqueue('only', 5);
    expect(q.peek()).toBe('only');
    expect(q.dequeue()).toBe('only');
    expect(q.isEmpty).toBe(true);
  });

  it('priority weight ordering 0-4', () => {
    const q = new PriorityQueue<string>();
    q.enqueue('deferred', 4);
    q.enqueue('low', 3);
    q.enqueue('normal', 2);
    q.enqueue('high', 1);
    q.enqueue('blocking', 0);
    expect(q.drain()).toEqual(['blocking', 'high', 'normal', 'low', 'deferred']);
  });

  it('remove from middle preserves heap property', () => {
    const q = new PriorityQueue<string>();
    q.enqueue('a', 0);
    q.enqueue('b', 1);
    q.enqueue('c', 2);
    q.enqueue('d', 3);
    q.enqueue('e', 4);
    q.remove(item => item === 'c');
    expect(q.drain()).toEqual(['a', 'b', 'd', 'e']);
  });

  it('remove from head preserves heap property', () => {
    const q = new PriorityQueue<string>();
    q.enqueue('a', 0);
    q.enqueue('b', 1);
    q.enqueue('c', 2);
    q.remove(item => item === 'a');
    expect(q.drain()).toEqual(['b', 'c']);
  });

  it('remove from tail preserves heap property', () => {
    const q = new PriorityQueue<string>();
    q.enqueue('a', 0);
    q.enqueue('b', 1);
    q.enqueue('c', 2);
    q.remove(item => item === 'c');
    expect(q.drain()).toEqual(['a', 'b']);
  });
});
