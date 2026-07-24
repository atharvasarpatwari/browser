/**
 * @file tests/wpt/wpt-adapter.ts
 *
 * Web Platform Tests (WPT) adapter for Vitest.
 *
 * This module provides utilities to run WPT-style tests in our Vitest
 * environment. It maps WPT test patterns to Vitest assertions.
 *
 * Usage:
 * ```typescript
 * import { describeWPT, assertWPT } from './wpt-adapter';
 *
 * describeWPT('DOM Core', () => {
 *   assertWPT('document.title', () => {
 *     return document.title === '';
 *   });
 * });
 * ```
 */

import { describe, it, expect } from 'vitest';

/**
 * WPT test result status.
 */
type WPTStatus = 'pass' | 'fail' | 'skip' | 'timeout';

/**
 * WPT test result.
 */
interface WPTResult {
  readonly name: string;
  readonly status: WPTStatus;
  readonly message?: string;
  readonly duration: number;
}

/**
 * WPT test suite result.
 */
interface WPTSuiteResult {
  readonly name: string;
  readonly results: WPTResult[];
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly total: number;
}

/**
 * Run a WPT-style test within Vitest.
 *
 * @param name Test name (WPT convention: spec/section/subtest)
 * @param testFn Test function that returns true if the test passes
 * @param options Optional configuration
 */
export function assertWPT(
  name: string,
  testFn: () => boolean | Promise<boolean>,
  options?: {
    skip?: boolean;
    timeout?: number;
  }
): void {
  const testFnWrapped = async () => {
    const result = await testFn();
    expect(result).toBe(true);
  };

  if (options?.skip) {
    it.skip(`${name} [WPT]`, testFnWrapped);
  } else {
    it(`${name} [WPT]`, testFnWrapped);
  }
}

/**
 * Assert that a specific DOM property has the expected value.
 */
export function assertDOMProperty(
  element: Element,
  property: string,
  expected: unknown
): void {
  const actual = (element as any)[property];
  expect(actual).toBe(expected);
}

/**
 * Assert that an element has the expected attribute.
 */
export function assertAttribute(
  element: Element,
  attr: string,
  expected: string | null
): void {
  const actual = element.getAttribute(attr);
  expect(actual).toBe(expected);
}

/**
 * Assert that a style property has the expected computed value.
 */
export function assertComputedStyle(
  element: Element,
  property: string,
  expected: string
): void {
  const computed = window.getComputedStyle(element);
  const actual = computed.getPropertyValue(property);
  expect(actual).toBe(expected);
}

/**
 * Assert that an event is dispatched correctly.
 */
export function assertEventDispatch(
  target: EventTarget,
  eventName: string,
  eventInit?: EventInit
): boolean {
  let dispatched = false;
  const handler = () => { dispatched = true; };
  
  target.addEventListener(eventName, handler, { once: true });
  
  const event = new Event(eventName, eventInit);
  target.dispatchEvent(event);
  
  return dispatched;
}

/**
 * Create a WPT-style test suite.
 */
export function describeWPT(
  name: string,
  fn: () => void
): void {
  describe(`[WPT] ${name}`, fn);
}

/**
 * Skip a WPT test with a reason.
 */
export function skipWPT(name: string, reason: string): void {
  it.skip(`${name} [WPT] — ${reason}`, () => {});
}

/**
 * Run a test that expects a specific error.
 */
export function assertThrows(
  name: string,
  fn: () => void,
  errorType?: Function
): void {
  it(`${name} [WPT]`, () => {
    if (errorType) {
      expect(() => fn()).toThrow(errorType);
    } else {
      expect(() => fn()).toThrow();
    }
  });
}

/**
 * Run an async test that expects a specific error.
 */
export function assertRejects(
  name: string,
  fn: () => Promise<void>,
  errorType?: Function
): void {
  it(`${name} [WPT]`, async () => {
    if (errorType) {
      await expect(fn()).rejects.toThrow(errorType);
    } else {
      await expect(fn()).rejects.toThrow();
    }
  });
}
