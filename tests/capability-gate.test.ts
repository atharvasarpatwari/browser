import { describe, it, expect, beforeEach } from 'vitest';
import {
  CapabilityGate,
  createCapabilityGate,
  DEFAULT_CHANNEL_MAP,
  DEFAULT_METHOD_MAP,
} from '../src/common/ipc/capability-gate';
import type { GateDecision } from '../src/common/ipc/capability-gate';

// ─────────────────────────────────────────────────────────────────────────────
// BASIC CHANNEL ACCESS
// ─────────────────────────────────────────────────────────────────────────────

describe('CapabilityGate', () => {
  describe('channel access', () => {
    it('allows known channels for sandboxed-content', () => {
      const gate = createCapabilityGate('sandboxed-content');
      const result = gate.checkChannel('dom');
      expect(result.allowed).toBe(true);
    });

    it('denies unknown channels for sandboxed-content', () => {
      const gate = createCapabilityGate('sandboxed-content');
      const result = gate.checkChannel('nonexistent-channel');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Unknown channel');
    });

    it('allows all channels for browser-chrome', () => {
      const gate = createCapabilityGate('browser-chrome');
      expect(gate.checkChannel('process').allowed).toBe(true);
      expect(gate.checkChannel('security').allowed).toBe(true);
      expect(gate.checkChannel('devtools').allowed).toBe(true);
      expect(gate.checkChannel('unknown').allowed).toBe(true);
    });

    it('denies process channel for sandboxed-content', () => {
      const gate = createCapabilityGate('sandboxed-content');
      const result = gate.checkChannel('process');
      expect(result.allowed).toBe(false);
    });

    it('allows dom channel for sandboxed-content', () => {
      const gate = createCapabilityGate('sandboxed-content');
      const result = gate.checkChannel('dom');
      expect(result.allowed).toBe(true);
    });
  });

  describe('web-content privilege level', () => {
    it('allows fetch channel', () => {
      const gate = createCapabilityGate('web-content');
      expect(gate.checkChannel('fetch').allowed).toBe(true);
    });

    it('allows storage channel', () => {
      const gate = createCapabilityGate('web-content');
      expect(gate.checkChannel('storage').allowed).toBe(true);
    });

    it('allows websocket channel', () => {
      const gate = createCapabilityGate('web-content');
      expect(gate.checkChannel('websocket').allowed).toBe(true);
    });

    it('allows workers channel', () => {
      const gate = createCapabilityGate('web-content');
      expect(gate.checkChannel('workers').allowed).toBe(true);
    });

    it('allows navigation channel', () => {
      const gate = createCapabilityGate('web-content');
      expect(gate.checkChannel('navigation').allowed).toBe(true);
    });

    it('denies process channel', () => {
      const gate = createCapabilityGate('web-content');
      expect(gate.checkChannel('process').allowed).toBe(false);
    });

    it('denies devtools channel', () => {
      const gate = createCapabilityGate('web-content');
      expect(gate.checkChannel('devtools').allowed).toBe(false);
    });
  });

  describe('trusted-extension privilege level', () => {
    it('allows dom channel', () => {
      const gate = createCapabilityGate('trusted-extension');
      expect(gate.checkChannel('dom').allowed).toBe(true);
    });

    it('allows fetch channel', () => {
      const gate = createCapabilityGate('trusted-extension');
      expect(gate.checkChannel('fetch').allowed).toBe(true);
    });

    it('allows storage channel', () => {
      const gate = createCapabilityGate('trusted-extension');
      expect(gate.checkChannel('storage').allowed).toBe(true);
    });

    it('denies process channel', () => {
      const gate = createCapabilityGate('trusted-extension');
      expect(gate.checkChannel('process').allowed).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // METHOD-LEVEL ACCESS
  // ─────────────────────────────────────────────────────────────────────────────

  describe('method access', () => {
    it('allows render-page method for web-content', () => {
      const gate = createCapabilityGate('web-content');
      const result = gate.checkMethod('renderer', 'render-page');
      expect(result.allowed).toBe(true);
    });

    it('allows navigate method for web-content', () => {
      const gate = createCapabilityGate('web-content');
      const result = gate.checkMethod('navigation', 'navigate');
      expect(result.allowed).toBe(true);
    });

    it('allows fetch method for web-content', () => {
      const gate = createCapabilityGate('web-content');
      const result = gate.checkMethod('fetch', 'fetch');
      expect(result.allowed).toBe(true);
    });

    it('allows get-item method for web-content', () => {
      const gate = createCapabilityGate('web-content');
      const result = gate.checkMethod('storage', 'get-item');
      expect(result.allowed).toBe(true);
    });

    it('allows set-item method for web-content', () => {
      const gate = createCapabilityGate('web-content');
      const result = gate.checkMethod('storage', 'set-item');
      expect(result.allowed).toBe(true);
    });

    it('allows ws-connect method for web-content', () => {
      const gate = createCapabilityGate('web-content');
      const result = gate.checkMethod('websocket', 'ws-connect');
      expect(result.allowed).toBe(true);
    });

    it('allows worker-create method for web-content', () => {
      const gate = createCapabilityGate('web-content');
      const result = gate.checkMethod('workers', 'worker-create');
      expect(result.allowed).toBe(true);
    });

    it('allows execute-script for web-content', () => {
      const gate = createCapabilityGate('web-content');
      const result = gate.checkMethod('script', 'execute-script');
      expect(result.allowed).toBe(true);
    });

    it('denies spawn-process for web-content', () => {
      const gate = createCapabilityGate('web-content');
      const result = gate.checkMethod('process', 'spawn-process');
      expect(result.allowed).toBe(false);
    });

    it('allows spawn-process for browser-chrome', () => {
      const gate = createCapabilityGate('browser-chrome');
      const result = gate.checkMethod('process', 'spawn-process');
      expect(result.allowed).toBe(true);
    });

    it('denies unknown methods', () => {
      const gate = createCapabilityGate('web-content');
      const result = gate.checkMethod('dom', 'nonexistent-method');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Unknown method');
    });

    it('allows clipboard-read for web-content', () => {
      const gate = createCapabilityGate('web-content');
      expect(gate.checkMethod('clipboard', 'clipboard-read').allowed).toBe(true);
    });

    it('allows notification-show for web-content', () => {
      const gate = createCapabilityGate('web-content');
      expect(gate.checkMethod('notifications', 'notification-show').allowed).toBe(true);
    });

    it('allows geolocation-get for web-content', () => {
      const gate = createCapabilityGate('web-content');
      expect(gate.checkMethod('geolocation', 'geolocation-get').allowed).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // COMBINED CHANNEL + METHOD CHECK
  // ─────────────────────────────────────────────────────────────────────────────

  describe('combined check', () => {
    it('passes when channel and method are both allowed', () => {
      const gate = createCapabilityGate('web-content');
      const result = gate.check('renderer', 'render-page');
      expect(result.allowed).toBe(true);
    });

    it('fails when channel is denied', () => {
      const gate = createCapabilityGate('sandboxed-content');
      const result = gate.check('fetch', 'fetch');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('channel');
    });

    it('fails when method is denied', () => {
      const gate = createCapabilityGate('web-content');
      const result = gate.check('dom', 'spawn-process');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('method');
    });

    it('passes with only channel check', () => {
      const gate = createCapabilityGate('web-content');
      const result = gate.check('dom');
      expect(result.allowed).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // EXTRA CAPABILITIES
  // ─────────────────────────────────────────────────────────────────────────────

  describe('extra capabilities', () => {
    it('allows extra capabilities beyond privilege level', () => {
      const gate = createCapabilityGate('sandboxed-content', {
        extraCapabilities: ['websocket'],
      });
      expect(gate.checkChannel('websocket').allowed).toBe(true);
    });

    it('extra capabilities override defaults', () => {
      const gate = createCapabilityGate('sandboxed-content', {
        extraCapabilities: ['process'],
      });
      expect(gate.checkChannel('process').allowed).toBe(true);
    });

    it('extra method capabilities work', () => {
      const gate = createCapabilityGate('sandboxed-content', {
        extraCapabilities: ['spawn-process'],
      });
      expect(gate.checkMethod('process', 'spawn-process').allowed).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // OVERRIDES
  // ─────────────────────────────────────────────────────────────────────────────

  describe('channel overrides', () => {
    it('custom channel map overrides defaults', () => {
      const gate = createCapabilityGate('sandboxed-content', {
        channelOverrides: new Map([
          ['custom-channel', 'fetch'],
        ]),
      });
      expect(gate.checkChannel('custom-channel').allowed).toBe(true);
    });

    it('custom method map overrides defaults', () => {
      const gate = createCapabilityGate('sandboxed-content', {
        methodOverrides: new Map([
          ['custom-method', 'fetch'],
        ]),
      });
      expect(gate.checkMethod('dom', 'custom-method').allowed).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // DENIAL TRACKING
  // ─────────────────────────────────────────────────────────────────────────────

  describe('denial tracking', () => {
    it('records denials', () => {
      const gate = createCapabilityGate('sandboxed-content');
      gate.checkChannel('process');
      gate.checkChannel('devtools');
      expect(gate.getDenialCount()).toBe(2);
    });

    it('getDenials returns recent denials', () => {
      const gate = createCapabilityGate('sandboxed-content');
      gate.checkChannel('process');
      const denials = gate.getDenials();
      expect(denials.length).toBe(1);
      expect(denials[0].channel).toBe('process');
    });

    it('clearDenials resets count', () => {
      const gate = createCapabilityGate('sandboxed-content');
      gate.checkChannel('process');
      gate.clearDenials();
      expect(gate.getDenialCount()).toBe(0);
    });

    it('limits denial history to 1000', () => {
      const gate = createCapabilityGate('sandboxed-content', { logDenials: false });
      for (let i = 0; i < 1100; i++) {
        gate.checkChannel('nonexistent');
      }
      expect(gate.getDenialCount()).toBe(1000);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVILEGE LEVEL ACCESSOR
  // ─────────────────────────────────────────────────────────────────────────────

  describe('getPrivilegeLevel', () => {
    it('returns the configured privilege level', () => {
      const gate = createCapabilityGate('web-content');
      expect(gate.getPrivilegeLevel()).toBe('web-content');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // DEFAULT MAPS
  // ─────────────────────────────────────────────────────────────────────────────

  describe('default maps', () => {
    it('DEFAULT_CHANNEL_MAP has expected entries', () => {
      expect(DEFAULT_CHANNEL_MAP.has('dom')).toBe(true);
      expect(DEFAULT_CHANNEL_MAP.has('fetch')).toBe(true);
      expect(DEFAULT_CHANNEL_MAP.has('process')).toBe(true);
      expect(DEFAULT_CHANNEL_MAP.has('security')).toBe(true);
    });

    it('DEFAULT_METHOD_MAP has expected entries', () => {
      expect(DEFAULT_METHOD_MAP.has('render-page')).toBe(true);
      expect(DEFAULT_METHOD_MAP.has('fetch')).toBe(true);
      expect(DEFAULT_METHOD_MAP.has('spawn-process')).toBe(true);
      expect(DEFAULT_METHOD_MAP.has('execute-script')).toBe(true);
    });
  });
});
