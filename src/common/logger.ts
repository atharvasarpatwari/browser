// Centralized logging: one choke point instead of scattered console.* calls,
// so log level and (eventually) a sink other than the console can be changed
// in one place. Namespace tags match the existing `[ModuleName] message`
// convention already used across the codebase — createLogger('Foo') gives you
// that tag for free instead of typing it into every call.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

function defaultLevel(): LogLevel {
  const env = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;
  return env === 'production' ? 'info' : 'debug';
}

let minLevel: LogLevel = defaultLevel();

/** Override the minimum level that gets logged (e.g. 'silent' in tests). */
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(minLevel);
}

/** Create a namespaced logger, e.g. `const log = createLogger('BrowserEngine')`. */
export function createLogger(namespace: string): Logger {
  const tag = `[${namespace}]`;
  return {
    debug: (...args) => { if (shouldLog('debug')) console.debug(tag, ...args); },
    info: (...args) => { if (shouldLog('info')) console.log(tag, ...args); },
    warn: (...args) => { if (shouldLog('warn')) console.warn(tag, ...args); },
    error: (...args) => { if (shouldLog('error')) console.error(tag, ...args); },
  };
}
