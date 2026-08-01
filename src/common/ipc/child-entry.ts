/**
 * @file src/common/ipc/child-entry.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHILD PROCESS ENTRY POINT
 * ─────────────────────────────────────────────────────────────────────────────
 * This script is the entry point for renderer processes spawned via
 * child_process.fork(). It:
 *
 *   1. Creates a ChildSideTransport wrapping the child's `process` IPC
 *   2. Sets up a ChannelManager for bidirectional communication
 *   3. Registers a ServiceStub that exposes renderer services
 *   4. Sends a PROCESS_READY message to the parent
 *   5. Keeps the process alive until the parent disconnects
 *
 * Usage:
 *   child_process.fork('child-entry.ts', [], { env: { NOVA_PROCESS_ID: '...' } })
 *
 * The child process receives its process ID via NOVA_PROCESS_ID env var.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { ChildSideTransport } from './child-process-transport';
import { ChannelManager } from './channel';
import { ServiceStub } from './service-proxy';

const PROCESS_ID = process.env.NOVA_PROCESS_ID ?? 'unknown';

async function main(): Promise<void> {
  // Create transport and channel manager
  const transport = new ChildSideTransport({
    localId: PROCESS_ID,
    remoteId: 'main',
  });
  await transport.connect();

  const channelManager = new ChannelManager(transport, PROCESS_ID);
  channelManager.activateAll();

  // Register a basic renderer service stub
  const rendererChannel = channelManager.getChannel('renderer');
  const rendererStub = new ServiceStub(rendererChannel, 'renderer');
  rendererStub.setImplementation({
    ping: () => ({ success: true, value: 'pong' } as any),
    getProcessId: () => ({ success: true, value: PROCESS_ID } as any),
  });
  rendererStub.activate();

  // Send ready signal to parent
  if (process.send) {
    process.send(JSON.stringify({
      type: 'process-ready',
      processId: PROCESS_ID,
      timestamp: Date.now(),
    }));
  }

  // Keep alive until parent disconnects
  process.on('disconnect', () => {
    channelManager.dispose();
    transport.dispose();
    process.exit(0);
  });

  // Handle uncaught errors gracefully
  process.on('uncaughtException', (err) => {
    console.error(`[ChildProcess ${PROCESS_ID}] Uncaught exception:`, err);
    // Send error to parent before exiting
    if (process.send) {
      process.send(JSON.stringify({
        type: 'process-error',
        processId: PROCESS_ID,
        error: err.message,
        timestamp: Date.now(),
      }));
    }
  });
}

main().catch((err) => {
  console.error(`[ChildProcess ${PROCESS_ID}] Failed to start:`, err);
  process.exit(1);
});
