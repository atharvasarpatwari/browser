/**
 * @file native/index.ts
 * Native module loader — loads the compiled Rust N-API bindings.
 *
 * Falls back to pure-TypeScript implementations when the native
 * module is not available (e.g., web build, missing compilation).
 */

import type {
  NovaNativeBindings,
  DnsResult,
  DnsRecord,
  TlsConfig,
  TlsInfo,
  HttpRequest,
  HttpResponse,
} from './types';

let _native: NovaNativeBindings | null = null;
let _loadAttempted = false;

function getPlatformDir(): string {
  const platform = process.platform;
  const arch = process.arch;

  const platformMap: Record<string, string> = {
    win32: 'win32-x64',
    linux: 'linux-x64',
    darwin: arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64',
  };

  const archMap: Record<string, string> = {
    x64: 'x64',
    arm64: 'arm64',
  };

  const plat = platformMap[platform] ?? 'linux-x64';
  const a = archMap[arch] ?? 'x64';

  return `${plat}-${a}`;
}

function loadNative(): NovaNativeBindings | null {
  if (_loadAttempted) return _native;
  _loadAttempted = true;

  try {
    const { createRequire } = require('module') as typeof import('module');
    const requireFn = createRequire(import.meta.url);

    const platformDir = getPlatformDir();
    const bindingPath = `../../native/dist/${platformDir}/nova_bindings.node`;

    _native = requireFn(bindingPath) as NovaNativeBindings;
    console.log(`[nova-native] loaded native bindings from ${bindingPath}`);
    return _native;
  } catch (err) {
    _native = null;
    console.log(`[nova-native] native bindings unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export function isNativeAvailable(): boolean {
  return loadNative() !== null;
}

export function getNativeBindings(): NovaNativeBindings | null {
  return loadNative();
}

/**
 * Checks that a specific export exists on the loaded native module, not just
 * that the module loaded at all. A build compiled with a narrower Cargo
 * feature set (e.g. `--features dns` only) still loads successfully but
 * doesn't export `tlsConnect`/`httpFetch`/etc. — calling those directly on
 * `native` would throw "not a function" from inside what looks like the
 * "native available" branch. Checking per-function lets a partial build
 * degrade to the JS fallback one function at a time instead of crashing.
 */
function nativeFn<K extends keyof NovaNativeBindings>(
  native: NovaNativeBindings | null,
  name: K,
): NovaNativeBindings[K] | null {
  if (native && typeof native[name] === 'function') return native[name];
  if (native) console.log(`[nova-native] loaded, but ${String(name)} is not exported (partial build) — using JS fallback for this call`);
  return null;
}

export async function resolveDns(domain: string): Promise<DnsResult> {
  const fn = nativeFn(loadNative(), 'resolveDns');
  if (fn) return fn(domain);
  return fallbackResolveDns(domain);
}

export async function resolveDnsIps(domain: string): Promise<string[]> {
  const fn = nativeFn(loadNative(), 'resolveDnsIps');
  if (fn) return fn(domain);
  return fallbackResolveDnsIps(domain);
}

export function tlsConnect(host: string, port: number, config?: TlsConfig): TlsInfo {
  const fn = nativeFn(loadNative(), 'tlsConnect');
  if (fn) return fn(host, port, config);
  return fallbackTlsConnect(host, port, config);
}

export async function httpFetch(request: HttpRequest): Promise<HttpResponse> {
  const fn = nativeFn(loadNative(), 'httpFetch');
  if (fn) return fn(request);
  return fallbackHttpFetch(request);
}

export async function httpGet(
  url: string,
  headers?: Record<string, string>,
): Promise<HttpResponse> {
  const fn = nativeFn(loadNative(), 'httpGet');
  if (fn) return fn(url, headers);
  return fallbackHttpFetch({ url, method: 'GET', headers });
}

export async function httpPost(
  url: string,
  body: string,
  headers?: Record<string, string>,
): Promise<HttpResponse> {
  const fn = nativeFn(loadNative(), 'httpPost');
  if (fn) return fn(url, body, headers);
  return fallbackHttpFetch({ url, method: 'POST', headers, body });
}

// ─── Fallback implementations ────────────────────────────────────────────────

async function fallbackResolveDns(domain: string): Promise<DnsResult> {
  const { lookup } = require('dns') as typeof import('dns');
  const { promisify } = require('util') as typeof import('util');
  const lookupAsync = promisify(lookup);

  const start = Date.now();
  const result = await lookupAsync(domain, { all: true });
  const elapsed = Date.now() - start;

  const records: DnsRecord[] = result.map(
    (r: { address: string; family: number }) => ({
      recordType: r.family === 4 ? 'A' : 'AAAA',
      ip: r.address,
      domain,
      ttl: 0,
    }),
  );

  return { domain, records, resolutionTimeMs: elapsed };
}

async function fallbackResolveDnsIps(domain: string): Promise<string[]> {
  const result = await fallbackResolveDns(domain);
  return result.records
    .map((r) => r.ip)
    .filter((ip): ip is string => ip !== null);
}

function fallbackTlsConnect(
  host: string,
  port: number,
  _config?: TlsConfig,
): TlsInfo {
  return {
    protocolVersion: 'TLSv1.2+ (Node.js)',
    cipherSuite: 'default',
  };
}

async function fallbackHttpFetch(request: HttpRequest): Promise<HttpResponse> {
  const { request: httpRequest } = require('https') as typeof import('https');
  const { request: httpRequestHttp } = require('http') as typeof import('http');

  return new Promise((resolve, reject) => {
    const url = new URL(request.url);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? httpRequest : httpRequestHttp;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: request.method,
      headers: request.headers || {},
      timeout: (request.timeoutSecs || 30) * 1000,
    };

    const req = mod(options, (res: any) => {
      let body = '';
      res.on('data', (chunk: any) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          statusText: res.statusMessage || '',
          headers: res.headers as Record<string, string>,
          body: body || null,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (request.body) {
      req.write(request.body);
    }
    req.end();
  });
}
