import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger, setLogLevel } from '../src/common/logger';

describe('logger', () => {
  afterEach(() => {
    setLogLevel('debug');
    vi.restoreAllMocks();
  });

  it('prefixes messages with the namespace tag', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createLogger('Foo').info('hello', 42);
    expect(spy).toHaveBeenCalledWith('[Foo]', 'hello', 42);
  });

  it('routes debug/warn/error to their console counterparts', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger('Bar');
    log.debug('d'); log.warn('w'); log.error('e');
    expect(debugSpy).toHaveBeenCalledWith('[Bar]', 'd');
    expect(warnSpy).toHaveBeenCalledWith('[Bar]', 'w');
    expect(errorSpy).toHaveBeenCalledWith('[Bar]', 'e');
  });

  it('suppresses levels below the configured minimum', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setLogLevel('warn');
    const log = createLogger('Baz');
    log.debug('should not log');
    log.info('should not log');
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('setLogLevel("silent") suppresses everything including errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setLogLevel('silent');
    createLogger('Quiet').error('nope');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
