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
 *   NovaFetchBridge.fetch(id, method, url, headersJson, redirectMode, bodyBase64)
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

  function bytesToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  /**
   * Serializes any fetch body (string, URLSearchParams, FormData, Blob/File,
   * ArrayBuffer, typed array, stream) exactly as the browser would, plus the
   * Content-Type that implies (e.g. FormData's multipart boundary). Resolves
   * null when there is no body. Headers are NOT taken from the Request: it drops
   * forbidden names (Cookie, Referer, ...) that the engine sets itself.
   */
  function serializeBody(url, method, input, init) {
    var source = null;
    if (init && init.body != null) {
      source = new Request(url, { method: method, body: init.body, duplex: 'half' });
    } else if (typeof Request !== 'undefined' && input instanceof Request && input.body) {
      source = input.clone();
    }
    if (!source) return Promise.resolve(null);
    return source.arrayBuffer().then(function (buffer) {
      return { base64: bytesToBase64(buffer), contentType: source.headers.get('content-type') };
    });
  }

  function hasHeader(headers, name) {
    for (var key in headers) {
      if (key.toLowerCase() === name) return true;
    }
    return false;
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
    // 101/103/204/205/304 must have a null body: Response("", {status: 304}) throws.
    var nullBodyStatus = [101, 103, 204, 205, 304].indexOf(payload.status) !== -1;
    if (nullBodyStatus) {
      body = null;
    } else if (payload.bodyBase64) {
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

      serializeBody(url, method, input, init).then(function (body) {
        if (entry.aborted) return;
        if (body && body.contentType && !hasHeader(headers, 'content-type')) {
          headers['Content-Type'] = body.contentType;
        }
        console.log('[nova-bridge] fetch#' + id + ' ' + method + ' ' + url + (body ? ' body=' + body.base64.length + 'b64' : ''));
        window.NovaFetchBridge.fetch(id, method, url, JSON.stringify(headers), redirectMode, body ? body.base64 : null);
      }).catch(function (e) {
        delete pending[id];
        rejectEntry(entry, e);
      });
    });
  };
})();
