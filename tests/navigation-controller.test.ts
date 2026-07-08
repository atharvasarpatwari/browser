import { describe, it, expect, vi } from 'vitest';
import {
  NavigationController,
  NavigationStack,
  NavigationEventBus,
  NavigationState,
  NavigationType,
  NavigationBlockedError,
} from '../src/browser/navigation/navigation-controller';
import { UrlParser } from '../src/browser/navigation/url-parser';

describe('NavigationStack', () => {
  it('should start empty', () => {
    const stack = new NavigationStack();
    expect(stack.current()).toBeNull();
    expect(stack.length).toBe(0);
    expect(stack.canBack()).toBe(false);
    expect(stack.canForward()).toBe(false);
  });

  it('should push entries', () => {
    const stack = new NavigationStack();
    const e1 = makeEntry('https://example.com', NavigationType.Push);
    const e2 = makeEntry('https://example.com/page2', NavigationType.Push);

    stack.push(e1);
    expect(stack.current()!.url).toBe('https://example.com');
    expect(stack.canBack()).toBe(false);
    expect(stack.length).toBe(1);

    stack.push(e2);
    expect(stack.current()!.url).toBe('https://example.com/page2');
    expect(stack.canBack()).toBe(true);
    expect(stack.length).toBe(2);
  });

  it('should step back and forward', () => {
    const stack = new NavigationStack();
    stack.push(makeEntry('https://example.com/a', NavigationType.Push));
    stack.push(makeEntry('https://example.com/b', NavigationType.Push));
    stack.push(makeEntry('https://example.com/c', NavigationType.Push));

    expect(stack.current()!.url).toBe('https://example.com/c');

    const back1 = stack.stepBack();
    expect(back1!.url).toBe('https://example.com/b');
    expect(stack.canBack()).toBe(true);
    expect(stack.canForward()).toBe(true);

    const back2 = stack.stepBack();
    expect(back2!.url).toBe('https://example.com/a');
    expect(stack.canBack()).toBe(false);
    expect(stack.canForward()).toBe(true);

    const forward = stack.stepForward();
    expect(forward!.url).toBe('https://example.com/b');
    expect(stack.canBack()).toBe(true);
    expect(stack.canForward()).toBe(true);
  });

  it('stepBack should return null at beginning', () => {
    const stack = new NavigationStack();
    stack.push(makeEntry('https://example.com', NavigationType.Push));
    expect(stack.stepBack()).toBeNull();
  });

  it('stepForward should return null at end', () => {
    const stack = new NavigationStack();
    stack.push(makeEntry('https://example.com', NavigationType.Push));
    expect(stack.stepForward()).toBeNull();
  });

  it('push should discard forward entries', () => {
    const stack = new NavigationStack();
    stack.push(makeEntry('https://example.com/a', NavigationType.Push));
    stack.push(makeEntry('https://example.com/b', NavigationType.Push));
    stack.push(makeEntry('https://example.com/c', NavigationType.Push));

    stack.stepBack(); // now at b
    stack.stepBack(); // now at a

    // Push from middle — discards b and c
    stack.push(makeEntry('https://example.com/d', NavigationType.Push));
    expect(stack.length).toBe(2);
    expect(stack.current()!.url).toBe('https://example.com/d');
    expect(stack.canForward()).toBe(false);
  });

  it('replace should overwrite current entry', () => {
    const stack = new NavigationStack();
    stack.push(makeEntry('https://example.com/a', NavigationType.Push));
    stack.replace(makeEntry('https://example.com/b', NavigationType.Replace));

    expect(stack.length).toBe(1);
    expect(stack.current()!.url).toBe('https://example.com/b');
  });

  it('replace should push if no current entry', () => {
    const stack = new NavigationStack();
    stack.replace(makeEntry('https://example.com/first', NavigationType.Replace));
    expect(stack.length).toBe(1);
    expect(stack.current()!.url).toBe('https://example.com/first');
  });

  it('should enforce max size', () => {
    const stack = new NavigationStack(3);
    stack.push(makeEntry('https://example.com/1', NavigationType.Push));
    stack.push(makeEntry('https://example.com/2', NavigationType.Push));
    stack.push(makeEntry('https://example.com/3', NavigationType.Push));
    stack.push(makeEntry('https://example.com/4', NavigationType.Push));

    expect(stack.length).toBe(3);
    expect(stack.current()!.url).toBe('https://example.com/4');
  });

  it('snapshot should return a frozen copy', () => {
    const stack = new NavigationStack();
    stack.push(makeEntry('https://example.com', NavigationType.Push));
    const snap = stack.snapshot();
    expect(snap).toHaveLength(1);
    expect(Object.isFrozen(snap)).toBe(true);
  });
});

describe('NavigationEventBus', () => {
  it('should emit to registered handlers', () => {
    const bus = new NavigationEventBus();
    const handler = vi.fn();
    bus.on('navigationStarted', handler);
    bus.emit({ kind: 'navigationStarted', request: { url: 'https://example.com', type: NavigationType.Push, userInitiated: true }, parsedUrl: null as any });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should not call handlers for other event types', () => {
    const bus = new NavigationEventBus();
    const handler = vi.fn();
    bus.on('navigationCommitted', handler);
    bus.emit({ kind: 'navigationStarted', request: { url: '', type: NavigationType.Push, userInitiated: true }, parsedUrl: null as any });
    expect(handler).not.toHaveBeenCalled();
  });

  it('off should remove a handler', () => {
    const bus = new NavigationEventBus();
    const handler = vi.fn();
    bus.on('navigationStarted', handler);
    bus.off('navigationStarted', handler);
    bus.emit({ kind: 'navigationStarted', request: { url: '', type: NavigationType.Push, userInitiated: true }, parsedUrl: null as any });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should not throw when emitting with no handlers', () => {
    const bus = new NavigationEventBus();
    expect(() => bus.emit({ kind: 'navigationStarted', request: { url: '', type: NavigationType.Push, userInitiated: true }, parsedUrl: null as any })).not.toThrow();
  });

  it('dispose should clear all channels', () => {
    const bus = new NavigationEventBus();
    const handler = vi.fn();
    bus.on('navigationCompleted', handler);
    bus.dispose();
    bus.emit({ kind: 'navigationCompleted', entry: null as any, elapsedMs: 0 });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('NavigationController', () => {
  const parser = new UrlParser();

  it('should start in Idle state', () => {
    const ctrl = new NavigationController(parser);
    expect(ctrl.state).toBe(NavigationState.Idle);
    expect(ctrl.getCurrentEntry()).toBeNull();
    expect(ctrl.historyLength).toBe(0);
  });

  it('navigate should succeed for a valid URL', async () => {
    const ctrl = new NavigationController(parser);
    const result = await ctrl.navigate('https://example.com');

    expect(result.success).toBe(true);
    expect(result.state).toBe(NavigationState.Complete);
    expect(result.entry).toBeDefined();
    expect(result.entry!.url).toBe('https://example.com/');
  });

  it('navigate should fail for blocked protocol', async () => {
    const ctrl = new NavigationController(parser);
    const result = await ctrl.navigate('javascript:alert(1)');

    expect(result.success).toBe(false);
    expect(result.state).toBe(NavigationState.Error);
    expect(result.error).toBeDefined();
  });

  it('navigate should fail for empty input', async () => {
    const ctrl = new NavigationController(parser);
    const result = await ctrl.navigate('');

    expect(result.success).toBe(false);
    expect(result.state).toBe(NavigationState.Error);
  });

  it('back should navigate backwards', async () => {
    const ctrl = new NavigationController(parser);
    await ctrl.navigate('https://example.com/first');
    await ctrl.navigate('https://example.com/second');

    const result = ctrl.back();
    expect(result.success).toBe(true);
    expect(result.entry!.url).toBe('https://example.com/first');
    expect(ctrl.canGoBack()).toBe(false);
    expect(ctrl.canGoForward()).toBe(true);
  });

  it('forward should navigate forward', async () => {
    const ctrl = new NavigationController(parser);
    await ctrl.navigate('https://example.com/first');
    await ctrl.navigate('https://example.com/second');
    ctrl.back();

    const result = ctrl.forward();
    expect(result.success).toBe(true);
    expect(result.entry!.url).toBe('https://example.com/second');
    expect(ctrl.canGoBack()).toBe(true);
    expect(ctrl.canGoForward()).toBe(false);
  });

  it('back should fail when at start', async () => {
    const ctrl = new NavigationController(parser);
    await ctrl.navigate('https://example.com');

    const result = ctrl.back();
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('forward should fail when at end', async () => {
    const ctrl = new NavigationController(parser);
    await ctrl.navigate('https://example.com');

    const result = ctrl.forward();
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('reload should start loading current entry', async () => {
    const ctrl = new NavigationController(parser);
    await ctrl.navigate('https://example.com');

    const result = ctrl.reload();
    expect(result.success).toBe(true);
    expect(result.entry!.url).toBe('https://example.com/');
  });

  it('reload should fail when no current entry', () => {
    const ctrl = new NavigationController(parser);
    const result = ctrl.reload();
    expect(result.success).toBe(false);
    expect(result.state).toBe(NavigationState.Error);
    expect(result.error).toBeDefined();
  });

  it('replace should navigate without creating new history entry', async () => {
    const ctrl = new NavigationController(parser);
    await ctrl.navigate('https://example.com/first');
    await ctrl.replace('https://example.com/second');

    expect(ctrl.historyLength).toBe(1);
    expect(ctrl.getCurrentEntry()!.url).toBe('https://example.com/second');
  });

  it('stop should transition to Stopped state', async () => {
    const ctrl = new NavigationController(parser);
    const handler = vi.fn();
    ctrl.on('navigationStopped', handler);

    ctrl.stop();
    expect(ctrl.state).toBe(NavigationState.Stopped);
    expect(handler).toHaveBeenCalled();
  });

  it('should emit navigation events in order', async () => {
    const ctrl = new NavigationController(parser);
    const events: string[] = [];
    ctrl.on('navigationStarted', () => events.push('started'));
    ctrl.on('navigationCommitted', () => events.push('committed'));
    ctrl.on('navigationCompleted', () => events.push('completed'));

    await ctrl.navigate('https://example.com');
    expect(events).toEqual(['started', 'committed', 'completed']);
  });

  it('should emit canGoBackChanged and canGoForwardChanged', async () => {
    const ctrl = new NavigationController(parser);
    const backChanges: boolean[] = [];
    const forwardChanges: boolean[] = [];
    ctrl.on('canGoBackChanged', e => backChanges.push(e.value));
    ctrl.on('canGoForwardChanged', e => forwardChanges.push(e.value));

    await ctrl.navigate('https://example.com/1');
    await ctrl.navigate('https://example.com/2');

    // After second push: canGoBack went from false → true
    expect(backChanges).toContain(true);

    ctrl.back();
    // After back: canGoForward went from false → true
    expect(forwardChanges).toContain(true);
  });

  it('hash-only change should emit hashChanged event', async () => {
    const ctrl = new NavigationController(parser);
    await ctrl.navigate('https://example.com/page');
    const handler = vi.fn();
    ctrl.on('hashChanged', handler);

    const result = await ctrl.navigate('https://example.com/page#section');
    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'hashChanged', hash: '#section' })
    );
  });

  it('should run guard chain and block when guard rejects', async () => {
    const ctrl = new NavigationController(parser);
    ctrl.addGuard({
      name: 'BlockAll',
      canNavigate: async () => false,
      blockedReason: () => 'Blocked for testing',
    });

    const result = await ctrl.navigate('https://example.com');
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(NavigationBlockedError);
    expect((result.error as NavigationBlockedError).guardName).toBe('BlockAll');
  });

  it('should pass allowed guards', async () => {
    const ctrl = new NavigationController(parser);
    const guard = {
      name: 'PassAll',
      canNavigate: async () => true,
    };
    ctrl.addGuard(guard);

    const result = await ctrl.navigate('https://example.com');
    expect(result.success).toBe(true);
  });

  it('should treat a guard that throws as blocked', async () => {
    const ctrl = new NavigationController(parser);
    ctrl.addGuard({
      name: 'ThrowingGuard',
      canNavigate: async () => { throw new Error('Guard crashed'); },
    });

    const result = await ctrl.navigate('https://example.com');
    expect(result.success).toBe(false);
  });

  it('addGuard should not add duplicate guards', () => {
    const ctrl = new NavigationController(parser);
    const guard = { name: 'Dup', canNavigate: async () => true };
    ctrl.addGuard(guard);
    ctrl.addGuard(guard);
    // should have only one instance
  });

  it('removeGuard should remove a guard', async () => {
    const ctrl = new NavigationController(parser);
    const guard = {
      name: 'RemoveMe',
      canNavigate: async () => false,
    };
    ctrl.addGuard(guard);
    ctrl.removeGuard(guard);

    const result = await ctrl.navigate('https://example.com');
    expect(result.success).toBe(true);
  });

  it('should emit navigationFailed when guard blocks', async () => {
    const ctrl = new NavigationController(parser);
    const handler = vi.fn();
    ctrl.on('navigationFailed', handler);
    ctrl.addGuard({
      name: 'Blocker',
      canNavigate: async () => false,
    });

    await ctrl.navigate('https://example.com');
    expect(handler).toHaveBeenCalled();
  });

  it('navigateTo with Push type should create a new entry', async () => {
    const ctrl = new NavigationController(parser);
    const result = await ctrl.navigateTo({
      url: 'https://example.com',
      type: NavigationType.Push,
      userInitiated: true,
    });
    expect(result.success).toBe(true);
    expect(result.entry!.type).toBe(NavigationType.Push);
  });

  it('navigateTo with Reload type should replace current entry', async () => {
    const ctrl = new NavigationController(parser);
    await ctrl.navigate('https://example.com/1');
    const result = await ctrl.navigateTo({
      url: 'https://example.com/2',
      type: NavigationType.Reload,
      userInitiated: true,
    });
    expect(result.success).toBe(true);
    expect(ctrl.historyLength).toBe(1);
    expect(ctrl.getCurrentEntry()!.url).toBe('https://example.com/2');
  });

  it('getCurrentEntry should return null before any navigation', () => {
    const ctrl = new NavigationController(parser);
    expect(ctrl.getCurrentEntry()).toBeNull();
  });
});

function makeEntry(url: string, type: NavigationType) {
  return {
    id: `nav-test-${Date.now()}`,
    url,
    title: 'Test',
    timestamp: Date.now(),
    type,
    scrollX: 0,
    scrollY: 0,
    parsedUrl: new UrlParser().parse(url),
  };
}
