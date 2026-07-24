import { fork, type ChildProcess } from 'node:child_process';
import type { ITransport } from './transport';

/**
 * Child process IPC transport using Node.js child_process.fork().
 * 
 * This transport wraps the Node.js IPC channel to enable communication
 * between parent and child processes. It implements the ITransport interface
 * so it can be used with the existing ChannelManager and ProcessManager.
 * 
 * Key behaviors:
 * - Uses Node.js IPC for reliable message passing
 * - Handles serialization/deserialization through the IPC channel
 * - Manages process lifecycle and cleanup
 * - Supports both request-response and fire-and-forget patterns
 */
export class ChildProcessTransport implements ITransport {
  private process: ChildProcess | null = null;
  private readonly listeners = new Set<(data: unknown) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private disposed = false;

  /**
   * Fork a child process and attach the transport.
   * @param modulePath Path to the module to fork
   * @param args Arguments to pass to the child process
   * @param options Fork options (e.g., execArgv for TypeScript)
   * @returns A new ChildProcessTransport connected to the child
   */
  static fork(
    modulePath: string,
    args: string[] = [],
    options: Record<string, unknown> = {}
  ): ChildProcessTransport {
    const transport = new ChildProcessTransport();
    transport.process = fork(modulePath, args, {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      ...options,
    });
    transport.attachListeners();
    return transport;
  }

  /**
   * Attach to an existing child process's IPC channel.
   * @param process The child process to attach to
   */
  attach(process: ChildProcess): void {
    if (this.process) {
      throw new Error('Already attached to a process');
    }
    this.process = process;
    this.attachListeners();
  }

  private attachListeners(): void {
    if (!this.process?.channel) {
      throw new Error('No IPC channel available');
    }

    this.process.on('message', (message: unknown) => {
      if (this.disposed) return;
      for (const listener of this.listeners) {
        try {
          listener(message);
        } catch {
          // Listener errors are swallowed to prevent one listener from breaking others
        }
      }
    });

    this.process.on('error', (error: Error) => {
      if (this.disposed) return;
      for (const listener of this.errorListeners) {
        try {
          listener(error);
        } catch {
          // Listener errors are swallowed
        }
      }
    });

    this.process.on('exit', (code, signal) => {
      if (this.disposed) return;
      const error = new Error(
        `Child process exited with code ${code} and signal ${signal}`
      );
      for (const listener of this.errorListeners) {
        try {
          listener(error);
        } catch {
          // Listener errors are swallowed
        }
      }
    });
  }

  send(data: unknown): void {
    if (this.disposed) {
      throw new Error('Transport is disposed');
    }
    if (!this.process?.channel) {
      throw new Error('No IPC channel available');
    }
    this.process.send(data);
  }

  onMessage(handler: (data: unknown) => void): void {
    this.listeners.add(handler);
  }

  offMessage(handler: (data: unknown) => void): void {
    this.listeners.delete(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorListeners.add(handler);
  }

  offError(handler: (error: Error) => void): void {
    this.errorListeners.delete(handler);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.errorListeners.clear();
    
    if (this.process) {
      // Try to disconnect gracefully
      try {
        this.process.disconnect();
      } catch {
        // Disconnect may fail if process already exited
      }
      this.process = null;
    }
  }

  get isAlive(): boolean {
    return !this.disposed && this.process !== null && this.process.connected === true;
  }
}
