/**
 * nova-bridge.js — Android host shim for the Nova engine.
 *
 * The Nova engine runs entirely in JS inside a WebView served from the
 * appassets.androidplatform.net origin (WebViewAssetLoader).  That origin
 * cannot `fetch()` arbitrary http(s) URLs because of CORS, so we intercept
 * `window.fetch` and route every http(s) request through the native
 * `NovaFetchBridge` (@JavascriptInterface), which performs the real HTTP
 * exchange via HttpURLConnection (no CORS, manual redirects so RequestManager
 * keeps its redirect-safety enforcement).
 *
 * The shim must load BEFORE the engine's bundled module script.  It is
 * injected into dist/index.html by android/scripts/copy-web.mjs.
 *
 * Contract with NovaFetchBridge (Kotlin):
 *   NovaFetchBridge.fetch(id, method, url, headersJson, redirectMode, bodyText)
 *   NovaFetchBridge.abort(id)
 *   window.__novaFetchResolve(id, payload)  // invoked from Kotlin via
 *     // evaluateJavascript; payload = { status, statusText, headers{},
 *     //   bodyText?, bodyBase64?, finalUrl?, error? }
 */
(function () {
  if (window.__novaBridgeInstalled) return;
  window.__novaBridgeInstalled = true;

  var realFetch = window.fetch.bind(window);
  var pending = Object.create(null);
  var seq = 0;

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function headersToObject(headers) {
    var out = {};
    if (!headers) return out;
    if (typeof headers.forEach === 'function') {
      headers.forEach(function (value, key) { out[key] = value; });
    } else if (typeof headers === 'object') {
      for (var key in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, key)) out[key] = headers[key];
      }
    }
    return out;
  }

  function bodyToString(body) {
    if (body == null) return null;
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    return null;
  }

  function rejectEntry(entry, error) {
    if (entry.rejected) return;
    entry.rejected = true;
    entry.reject(error);
  }

  window.__novaFetchResolve = function (id, payload) {
    var entry = pending[id];
    if (!entry) return;
    delete pending[id];

    if (payload.error) {
      console.log('[nova-bridge] resolve#' + id + ' ERROR ' + payload.error);
      rejectEntry(entry, new TypeError(payload.error));
      return;
    }
    if (entry.aborted) {
      console.log('[nova-bridge] resolve#' + id + ' ABORTED');
      rejectEntry(entry, new DOMException('Aborted', 'AbortError'));
      return;
    }
    if (entry.redirectMode === 'error' && payload.status >= 300 && payload.status < 400) {
      console.log('[nova-bridge] resolve#' + id + ' REDIRECT-mode-error status=' + payload.status);
      rejectEntry(entry, new TypeError('Failed to fetch: redirect mode "error"'));
      return;
    }

    var headers = new Headers();
    var h = payload.headers || {};
    for (var k in h) {
      if (Object.prototype.hasOwnProperty.call(h, k)) headers.set(k, h[k]);
    }

    var body = null;
    if (payload.bodyBase64) {
      body = base64ToBytes(payload.bodyBase64);
    } else if (payload.bodyText !== undefined && payload.bodyText !== null) {
      body = payload.bodyText;
    }

    var response;
    try {
      response = new Response(body, {
        status: payload.status,
        statusText: payload.statusText || '',
        headers: headers,
      });
    } catch (e) {
      console.log('[nova-bridge] resolve#' + id + ' Response-ctor FAILED: ' + e.message);
      rejectEntry(entry, e);
      return;
    }
    if (payload.finalUrl) {
      Object.defineProperty(response, 'url', { value: payload.finalUrl, configurable: true });
    }
    console.log('[nova-bridge] resolve#' + id + ' status=' + payload.status +
      ' textLen=' + (typeof payload.bodyText === 'string' ? payload.bodyText.length : 0) +
      ' b64Len=' + (typeof payload.bodyBase64 === 'string' ? payload.bodyBase64.length : 0));
    entry.resolve(response);
  };

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input && input.url;
    if (typeof url !== 'string' || !/^https?:/i.test(url)) {
      return realFetch(input, init);
    }

    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var headers = headersToObject((init && init.headers) || (input && input.headers));
    var redirectMode = (init && init.redirect) || (input && input.redirect) || 'follow';
    var body = bodyToString((init && init.body) || (input && input.body));
    var signal = (init && init.signal) || (input && input.signal);

    var id = String(++seq);

    return new Promise(function (resolve, reject) {
      var entry = { resolve: resolve, reject: reject, signal: signal, aborted: false, rejected: false, redirectMode: redirectMode };
      pending[id] = entry;

      if (signal) {
        if (signal.aborted) {
          entry.aborted = true;
          delete pending[id];
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', function () {
          entry.aborted = true;
          delete pending[id];
          try { window.NovaFetchBridge.abort(id); } catch (e) {}
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }

      try {
        console.log('[nova-bridge] fetch#' + id + ' ' + method + ' ' + url);
        window.NovaFetchBridge.fetch(id, method, url, JSON.stringify(headers), redirectMode, body);
      } catch (e) {
        delete pending[id];
        reject(e);
      }
    });
  };
})();
