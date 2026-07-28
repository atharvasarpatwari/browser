/**
 * @file native/http-client.ts
 * HTTP client — wraps native or fallback HTTP fetch.
 */

import { httpFetch, httpGet, httpPost, isNativeAvailable } from './index';
import type { HttpRequest, HttpResponse } from './types';

export interface IHttpClient {
  fetch(request: HttpRequest): Promise<HttpResponse>;
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
  post(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse>;
  isNative(): boolean;
}

export class NovaHttpClient implements IHttpClient {
  private defaultHeaders: Record<string, string>;
  private timeoutSecs: number;

  constructor(options?: {
    defaultHeaders?: Record<string, string>;
    timeoutSecs?: number;
  }) {
    this.defaultHeaders = options?.defaultHeaders ?? {
      'User-Agent': 'NovaBrowser/1.0',
      Accept: '*/*',
    };
    this.timeoutSecs = options?.timeoutSecs ?? 30;
  }

  async fetch(request: HttpRequest): Promise<HttpResponse> {
    const mergedHeaders = {
      ...this.defaultHeaders,
      ...request.headers,
    };

    return httpFetch({
      ...request,
      headers: mergedHeaders,
      timeoutSecs: request.timeoutSecs ?? this.timeoutSecs,
    });
  }

  async get(
    url: string,
    headers?: Record<string, string>,
  ): Promise<HttpResponse> {
    return this.fetch({ url, method: 'GET', headers });
  }

  async post(
    url: string,
    body: string,
    headers?: Record<string, string>,
  ): Promise<HttpResponse> {
    return this.fetch({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    });
  }

  isNative(): boolean {
    return isNativeAvailable();
  }
}
