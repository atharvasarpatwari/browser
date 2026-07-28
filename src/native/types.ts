/**
 * @file native/types.ts
 * TypeScript types matching the N-API bindings.
 */

export interface DnsRecord {
  recordType: string;
  ip: string | null;
  domain: string | null;
  ttl: number;
}

export interface DnsResult {
  domain: string;
  records: DnsRecord[];
  resolutionTimeMs: number;
}

export interface TlsConfig {
  verifyCertificates?: boolean;
}

export interface TlsInfo {
  protocolVersion: string;
  cipherSuite: string;
}

export interface HttpRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutSecs?: number;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface NovaNativeBindings {
  resolveDns(domain: string): Promise<DnsResult>;
  resolveDnsIps(domain: string): Promise<string[]>;
  tlsConnect(host: string, port: number, config?: TlsConfig): TlsInfo;
  tlsCreateConfig(verifyCertificates?: boolean): string;
  httpFetch(request: HttpRequest): Promise<HttpResponse>;
  httpGet(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
  httpPost(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse>;
}
