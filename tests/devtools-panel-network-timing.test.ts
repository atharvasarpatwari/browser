import { describe, it, expect, beforeEach } from 'vitest';
import { DevToolsPanel, type DevToolsNetworkEntry } from '../src/ui/components/devtools-panel/devtools-panel';

describe('DevToolsPanel — Network tab timing breakdown', () => {
  let panel: DevToolsPanel;
  let container: HTMLElement;

  beforeEach(() => {
    panel = new DevToolsPanel();
    container = document.createElement('div');
    panel.attach(container);
  });

  const baseEntry: DevToolsNetworkEntry = {
    url: 'https://example.com/style.css',
    kind: 'stylesheet',
    statusCode: 200,
    durationMs: 30,
    fromCache: false,
    error: null,
  };

  it('adds no timing sub-row when the entry has no timing data', () => {
    panel.addNetworkEntry(baseEntry);
    expect(container.querySelector('[data-nova-timing-row]')).toBeNull();
  });

  it('adds a hidden timing sub-row when the entry has a real breakdown', () => {
    panel.addNetworkEntry({
      ...baseEntry,
      timing: { dnsMs: 5, connectMs: 3, tlsMs: 4, ttfbMs: 8, downloadMs: 10, totalMs: 30 },
    });

    const timingRow = container.querySelector('[data-nova-timing-row]') as HTMLElement | null;
    expect(timingRow).not.toBeNull();
    expect(timingRow!.hidden).toBe(true);
    expect(timingRow!.textContent).toContain('DNS');
    expect(timingRow!.textContent).toContain('Total: 30.0ms');
  });

  it('toggles the timing sub-row open and closed when its entry row is clicked', () => {
    panel.addNetworkEntry({
      ...baseEntry,
      timing: { dnsMs: 5, connectMs: 3, tlsMs: 4, ttfbMs: 8, downloadMs: 10, totalMs: 30 },
    });

    const timingRow = container.querySelector('[data-nova-timing-row]') as HTMLElement;
    const entryRow = timingRow.previousElementSibling as HTMLElement;

    expect(timingRow.hidden).toBe(true);
    entryRow.click();
    expect(timingRow.hidden).toBe(false);
    entryRow.click();
    expect(timingRow.hidden).toBe(true);
  });

  it('treats an all-null timing object the same as no timing at all', () => {
    panel.addNetworkEntry({
      ...baseEntry,
      timing: { dnsMs: null, connectMs: null, tlsMs: null, ttfbMs: null, downloadMs: null, totalMs: null },
    });
    expect(container.querySelector('[data-nova-timing-row]')).toBeNull();
  });
});
