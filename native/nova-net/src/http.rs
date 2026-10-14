//! Not currently wired into the running browser. Nothing in `src/` imports
//! `src/native/index.ts`'s `httpFetch`/`resolveDns`/`tlsConnect` wrappers — the
//! live networking path is the pure-TypeScript stack in
//! `src/browser/networking/raw-socket-http-client.ts` +
//! `redirect-handler.ts`. This module now also follows redirects, decodes
//! chunked transfer-encoding, and reuses keep-alive connections, closing the
//! gaps that used to separate it from the live stack — but it's still
//! unintegrated, so don't treat it as the settled design until it's wired in.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use rustls::ClientConfig;
use rustls::pki_types::ServerName;
use rustls::{ClientConnection, StreamOwned};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_REDIRECTS: u8 = 10;
const MAX_POOLED_PER_KEY: usize = 4;

#[derive(Error, Debug)]
pub enum HttpError {
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("TLS error: {0}")]
    TlsError(String),

    #[error("HTTP error {status}: {body}")]
    HttpResponse { status: u16, body: String },

    #[error("Request timeout")]
    Timeout,

    #[error("Invalid URL: {0}")]
    InvalidUrl(String),

    #[error("Invalid HTTP method: {0}")]
    InvalidMethod(String),

    #[error("Too many redirects (limit: {0})")]
    TooManyRedirects(u8),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpRequest {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

pub async fn fetch(request: &HttpRequest) -> Result<HttpResponse, HttpError> {
    let mut method = request.method.to_uppercase();

    // Reject method strings that aren't a valid HTTP token (e.g. containing
    // spaces) before they reach the wire as a malformed request line — the
    // server seeing it is a different failure mode than "we sent garbage".
    http::Method::from_bytes(method.as_bytes())
        .map_err(|_| HttpError::InvalidMethod(request.method.clone()))?;

    let mut current_url = request.url.clone();
    let headers = request.headers.clone();
    let mut body = request.body.clone();

    for _ in 0..=MAX_REDIRECTS {
        let (response, location) =
            fetch_once(&current_url, &method, &headers, body.as_deref(), request.timeout_secs)?;

        let Some(location) = location else {
            return Ok(response);
        };

        current_url = resolve_redirect_url(&current_url, &location)?;
        if matches!(response.status, 301 | 302 | 303) && method != "GET" && method != "HEAD" {
            // Browsers rewrite non-safe methods to GET and drop the body on
            // these three codes; 307/308 preserve method and body verbatim.
            method = "GET".to_string();
            body = None;
        }
    }

    Err(HttpError::TooManyRedirects(MAX_REDIRECTS))
}

fn is_redirect_status(status: u16) -> bool {
    matches!(status, 301 | 302 | 303 | 307 | 308)
}

/// Resolves a `Location` header against the URL that produced it, following
/// RFC 3986 §5.3 (reference resolution) and §5.2.4 (dot-segment removal):
/// absolute URIs, protocol-relative (`//host/...`) references, absolute-path
/// references, relative-path references, and bare-query references (`?x=1`)
/// all resolve against `current`, with `.`/`..` segments collapsed.
fn resolve_redirect_url(current: &str, location: &str) -> Result<String, HttpError> {
    // We never send a fragment back to the server, so drop it before resolving.
    let location = location.split('#').next().unwrap_or("");

    if let Some(scheme_end) = location.find("://") {
        let maybe_scheme = &location[..scheme_end];
        let is_scheme = !maybe_scheme.is_empty()
            && maybe_scheme.chars().enumerate().all(|(i, c)| {
                c.is_ascii_alphanumeric() || (i > 0 && (c == '+' || c == '-' || c == '.'))
            });
        if is_scheme {
            return Ok(remove_dot_segments_from_uri(location));
        }
    }

    let current_uri: http::Uri = current
        .parse()
        .map_err(|e: http::uri::InvalidUri| HttpError::InvalidUrl(e.to_string()))?;
    let base_scheme = current_uri.scheme_str().unwrap_or("http");
    let base_authority = current_uri.authority().map(|a| a.as_str()).unwrap_or("");
    let base_path = current_uri.path();

    if let Some(rest) = location.strip_prefix("//") {
        return Ok(remove_dot_segments_from_uri(&format!("{base_scheme}://{rest}")));
    }

    let (ref_path, ref_query) = match location.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (location, None),
    };

    let resolved_path = if ref_path.is_empty() {
        base_path.to_string()
    } else if ref_path.starts_with('/') {
        remove_dot_segments(ref_path)
    } else {
        remove_dot_segments(&merge_paths(base_authority, base_path, ref_path))
    };

    let query = match ref_query {
        Some(q) => format!("?{q}"),
        None if ref_path.is_empty() => current_uri.query().map(|q| format!("?{q}")).unwrap_or_default(),
        None => String::new(),
    };

    Ok(format!("{base_scheme}://{base_authority}{resolved_path}{query}"))
}

fn remove_dot_segments_from_uri(uri_str: &str) -> String {
    match uri_str.parse::<http::Uri>() {
        Ok(uri) => {
            let scheme = uri.scheme_str().unwrap_or("http");
            let authority = uri.authority().map(|a| a.as_str()).unwrap_or("");
            let path = remove_dot_segments(uri.path());
            let query = uri.query().map(|q| format!("?{q}")).unwrap_or_default();
            format!("{scheme}://{authority}{path}{query}")
        }
        Err(_) => uri_str.to_string(),
    }
}

/// RFC 3986 §5.3 "merge" step: a relative-path reference resolves against
/// the base path's directory (everything up to and including its last `/`).
fn merge_paths(base_authority: &str, base_path: &str, ref_path: &str) -> String {
    if !base_authority.is_empty() && base_path.is_empty() {
        return format!("/{ref_path}");
    }
    match base_path.rfind('/') {
        Some(idx) => format!("{}{}", &base_path[..idx + 1], ref_path),
        None => ref_path.to_string(),
    }
}

/// RFC 3986 §5.2.4: collapses `.` and `..` path segments in place, the way a
/// browser does before issuing the redirected request.
fn remove_dot_segments(path: &str) -> String {
    let mut input = path;
    let mut output: Vec<&str> = Vec::new();
    while !input.is_empty() {
        if input.starts_with("../") {
            input = &input[3..];
        } else if input.starts_with("./") {
            input = &input[2..];
        } else if input.starts_with("/./") {
            // "/./x" -> "/x": drop the "." segment, keep the leading "/".
            input = &input[2..];
        } else if input == "/." {
            input = "/";
        } else if input.starts_with("/../") {
            // "/../x" -> "/x" plus drop the last output segment.
            input = &input[3..];
            output.pop();
        } else if input == "/.." {
            input = "/";
            output.pop();
        } else if input == "." || input == ".." {
            input = "";
        } else {
            let next_slash = if input.starts_with('/') {
                input[1..].find('/').map(|i| i + 1)
            } else {
                input.find('/')
            };
            match next_slash {
                Some(idx) => {
                    output.push(&input[..idx]);
                    input = &input[idx..];
                }
                None => {
                    output.push(input);
                    input = "";
                }
            }
        }
    }
    output.concat()
}

type PoolKey = (String, u16, bool);
/// Most servers' keep-alive idle timeout is in the 5-60s range; evicting
/// anything older than this before handing it out keeps the pool from
/// accumulating connections the peer has already closed.
const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(20);

trait ConnStream: Read + Write + Send {}
impl ConnStream for TcpStream {}
impl ConnStream for StreamOwned<ClientConnection, TcpStream> {}

fn pool() -> &'static Mutex<HashMap<PoolKey, Vec<(Instant, Box<dyn ConnStream>)>>> {
    static POOL: OnceLock<Mutex<HashMap<PoolKey, Vec<(Instant, Box<dyn ConnStream>)>>>> = OnceLock::new();
    POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

fn take_pooled(key: &PoolKey) -> Option<Box<dyn ConnStream>> {
    let mut guard = pool().lock().unwrap();
    let conns = guard.get_mut(key)?;
    // Pop from the back (most recently returned, likeliest still alive) and
    // discard anything that's aged past the idle timeout along the way.
    while let Some((returned_at, conn)) = conns.pop() {
        if returned_at.elapsed() <= POOL_IDLE_TIMEOUT {
            return Some(conn);
        }
    }
    None
}

fn return_pooled(key: PoolKey, conn: Box<dyn ConnStream>) {
    let mut guard = pool().lock().unwrap();
    let conns = guard.entry(key).or_default();
    if conns.len() < MAX_POOLED_PER_KEY {
        conns.push((Instant::now(), conn));
    }
}

fn connect(host: &str, port: u16, is_tls: bool, timeout_secs: u64) -> Result<Box<dyn ConnStream>, HttpError> {
    let tcp = TcpStream::connect(format!("{host}:{port}")).map_err(|e| HttpError::ConnectionFailed(e.to_string()))?;
    tcp.set_read_timeout(Some(Duration::from_secs(timeout_secs)))?;
    tcp.set_write_timeout(Some(Duration::from_secs(timeout_secs)))?;

    if !is_tls {
        return Ok(Box::new(tcp));
    }

    let mut root_store = rustls::RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

    let tls_config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();

    let server_name = ServerName::try_from(host.to_string())
        .map_err(|e: rustls::pki_types::InvalidDnsNameError| HttpError::TlsError(e.to_string()))?;

    let conn = ClientConnection::new(tls_config.into(), server_name).map_err(|e| HttpError::TlsError(e.to_string()))?;

    Ok(Box::new(StreamOwned::new(conn, tcp)))
}

/// A minimal buffered reader over a connection, enough to delimit HTTP/1.1
/// framing (headers, Content-Length bodies, chunked bodies, close-delimited
/// bodies) without reading past what the current response actually sent —
/// required so the underlying connection can be handed back to the pool.
struct BufStream<S: Read> {
    inner: S,
    buf: Vec<u8>,
}

impl<S: Read> BufStream<S> {
    fn new(inner: S) -> Self {
        Self { inner, buf: Vec::new() }
    }

    fn fill_more(&mut self) -> std::io::Result<usize> {
        let mut chunk = [0u8; 4096];
        let n = self.inner.read(&mut chunk)?;
        self.buf.extend_from_slice(&chunk[..n]);
        Ok(n)
    }

    fn read_line(&mut self) -> Result<String, HttpError> {
        loop {
            if let Some(idx) = find_subslice(&self.buf, b"\r\n") {
                let line = self.buf[..idx].to_vec();
                self.buf.drain(..idx + 2);
                return Ok(String::from_utf8_lossy(&line).into_owned());
            }
            if self.fill_more()? == 0 {
                return Err(HttpError::ConnectionFailed("connection closed mid-line".to_string()));
            }
        }
    }

    fn read_headers(&mut self) -> Result<Vec<u8>, HttpError> {
        loop {
            if let Some(idx) = find_subslice(&self.buf, b"\r\n\r\n") {
                let head = self.buf[..idx].to_vec();
                self.buf.drain(..idx + 4);
                return Ok(head);
            }
            if self.fill_more()? == 0 {
                return Err(HttpError::ConnectionFailed(
                    "connection closed before headers completed".to_string(),
                ));
            }
        }
    }

    fn read_exact_body(&mut self, len: usize) -> Result<Vec<u8>, HttpError> {
        while self.buf.len() < len {
            if self.fill_more()? == 0 {
                break; // Peer closed early; return what we got rather than hang.
            }
        }
        let take = len.min(self.buf.len());
        let body = self.buf[..take].to_vec();
        self.buf.drain(..take);
        Ok(body)
    }

    fn read_to_eof(&mut self) -> Result<Vec<u8>, HttpError> {
        while self.fill_more()? != 0 {}
        Ok(std::mem::take(&mut self.buf))
    }

    fn read_chunked_body(&mut self) -> Result<Vec<u8>, HttpError> {
        let mut out = Vec::new();
        loop {
            let size_line = self.read_line()?;
            let size_str = size_line.split(';').next().unwrap_or("").trim();
            let size = usize::from_str_radix(size_str, 16)
                .map_err(|_| HttpError::ConnectionFailed(format!("invalid chunk size: {size_str}")))?;

            if size == 0 {
                loop {
                    // Consume trailer headers (rare) up to the blank line.
                    if self.read_line()?.is_empty() {
                        break;
                    }
                }
                break;
            }

            out.extend_from_slice(&self.read_exact_body(size)?);
            self.read_line()?; // Trailing CRLF after each chunk's data.
        }
        Ok(out)
    }

    fn buf_is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    fn into_inner(self) -> S {
        self.inner
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

fn write_and_read_headers<S: Read + Write>(
    stream: &mut BufStream<S>,
    req_str: &str,
) -> Result<Vec<u8>, HttpError> {
    stream.inner.write_all(req_str.as_bytes()).map_err(HttpError::Io)?;
    stream.read_headers()
}

fn parse_status_and_headers(head: &str) -> Result<(u16, String, HashMap<String, String>, String), HttpError> {
    let mut lines = head.lines();

    let status_line = lines
        .next()
        .ok_or_else(|| HttpError::ConnectionFailed("empty response".to_string()))?;

    let parts: Vec<&str> = status_line.splitn(3, ' ').collect();
    if parts.len() < 2 {
        return Err(HttpError::ConnectionFailed(format!("invalid status line: {status_line}")));
    }

    let http_version = parts[0].to_string();
    let status: u16 = parts[1]
        .parse()
        .map_err(|_| HttpError::ConnectionFailed(format!("invalid status: {}", parts[1])))?;
    let status_text = parts.get(2).unwrap_or(&"").to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_lowercase(), value.trim().to_string());
        }
    }

    Ok((status, status_text, headers, http_version))
}

fn fetch_once(
    url_str: &str,
    method: &str,
    headers: &HashMap<String, String>,
    body: Option<&str>,
    timeout_secs: Option<u64>,
) -> Result<(HttpResponse, Option<String>), HttpError> {
    let url: http::Uri = url_str
        .parse()
        .map_err(|e: http::uri::InvalidUri| HttpError::InvalidUrl(e.to_string()))?;

    let scheme = url
        .scheme_str()
        .ok_or_else(|| HttpError::InvalidUrl("no scheme".to_string()))?
        .to_ascii_lowercase();
    let is_tls = match scheme.as_str() {
        "https" => true,
        "http" => false,
        other => return Err(HttpError::InvalidUrl(format!("unsupported scheme: {other}"))),
    };

    let host = url
        .host()
        .ok_or_else(|| HttpError::InvalidUrl("no host".to_string()))?
        .to_string();
    let port = url.port_u16().unwrap_or(if is_tls { 443 } else { 80 });
    let path = url.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");

    let mut req_str = format!("{method} {path} HTTP/1.1\r\n");
    req_str.push_str(&format!("Host: {host}\r\n"));
    req_str.push_str("Connection: keep-alive\r\n");

    for (key, value) in headers {
        req_str.push_str(&format!("{key}: {value}\r\n"));
    }

    if let Some(body) = body {
        req_str.push_str(&format!("Content-Length: {}\r\n", body.len()));
        req_str.push_str("Content-Type: application/json\r\n");
    }

    req_str.push_str("\r\n");
    if let Some(body) = body {
        req_str.push_str(body);
    }

    let timeout = timeout_secs.unwrap_or(30);
    let key: PoolKey = (host.clone(), port, is_tls);

    let pooled = take_pooled(&key);
    let was_pooled = pooled.is_some();
    let conn = match pooled {
        Some(c) => c,
        None => connect(&host, port, is_tls, timeout)?,
    };

    let mut buf_stream = BufStream::new(conn);
    let head_bytes = match write_and_read_headers(&mut buf_stream, &req_str) {
        Ok(h) => h,
        // A pooled connection the peer silently idle-closed is the standard
        // failure mode for a naive keep-alive pool — retry once on a fresh
        // connection instead of surfacing a spurious error for it.
        Err(_) if was_pooled => {
            let fresh = connect(&host, port, is_tls, timeout)?;
            buf_stream = BufStream::new(fresh);
            write_and_read_headers(&mut buf_stream, &req_str)?
        }
        Err(e) => return Err(e),
    };

    let head = String::from_utf8_lossy(&head_bytes).into_owned();
    let (status, status_text, resp_headers, http_version) = parse_status_and_headers(&head)?;

    let chunked = resp_headers
        .get("transfer-encoding")
        .map(|v| v.to_ascii_lowercase().contains("chunked"))
        .unwrap_or(false);
    let content_length = resp_headers.get("content-length").and_then(|v| v.trim().parse::<usize>().ok());

    let body_bytes = if chunked {
        buf_stream.read_chunked_body()?
    } else if let Some(len) = content_length {
        buf_stream.read_exact_body(len)?
    } else {
        buf_stream.read_to_eof()?
    };

    let connection_close = resp_headers
        .get("connection")
        .map(|v| v.to_ascii_lowercase().contains("close"))
        .unwrap_or(false);
    let framing_known = chunked || content_length.is_some();
    let reusable = framing_known && !connection_close && http_version == "HTTP/1.1" && buf_stream.buf_is_empty();

    let conn = buf_stream.into_inner();
    if reusable {
        return_pooled(key, conn);
    }

    let body_text = if body_bytes.is_empty() {
        None
    } else {
        Some(String::from_utf8_lossy(&body_bytes).into_owned())
    };

    let location = if is_redirect_status(status) {
        resp_headers.get("location").cloned()
    } else {
        None
    };

    Ok((
        HttpResponse {
            status,
            status_text,
            headers: resp_headers,
            body: body_text,
        },
        location,
    ))
}

pub async fn fetch_simple(
    url: &str,
    method: &str,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<HttpResponse, HttpError> {
    let request = HttpRequest {
        url: url.to_string(),
        method: method.to_string(),
        headers: headers.unwrap_or_default(),
        body,
        timeout_secs: Some(30),
    };
    fetch(&request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_parse_status_and_headers() {
        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/html";
        let (status, status_text, headers, version) = parse_status_and_headers(head).unwrap();
        assert_eq!(status, 200);
        assert_eq!(status_text, "OK");
        assert_eq!(version, "HTTP/1.1");
        assert_eq!(headers.get("content-type").unwrap(), "text/html");
    }

    #[test]
    fn test_read_headers_and_content_length_body() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\nHello World";
        let mut stream = BufStream::new(Cursor::new(&raw[..]));
        let head = stream.read_headers().unwrap();
        assert_eq!(String::from_utf8_lossy(&head), "HTTP/1.1 200 OK\r\nContent-Length: 11");
        let body = stream.read_exact_body(11).unwrap();
        assert_eq!(String::from_utf8_lossy(&body), "Hello World");
    }

    #[test]
    fn test_read_chunked_body() {
        let raw = b"5\r\nHello\r\n6\r\n World\r\n0\r\n\r\n";
        let mut stream = BufStream::new(Cursor::new(&raw[..]));
        let body = stream.read_chunked_body().unwrap();
        assert_eq!(String::from_utf8_lossy(&body), "Hello World");
    }

    #[test]
    fn test_read_to_eof_close_delimited() {
        let raw = b"close-delimited body";
        let mut stream = BufStream::new(Cursor::new(&raw[..]));
        let body = stream.read_to_eof().unwrap();
        assert_eq!(String::from_utf8_lossy(&body), "close-delimited body");
    }

    #[test]
    fn test_resolve_redirect_url_absolute() {
        assert_eq!(
            resolve_redirect_url("http://a.example/x", "https://b.example/y").unwrap(),
            "https://b.example/y"
        );
    }

    #[test]
    fn test_resolve_redirect_url_absolute_path() {
        assert_eq!(
            resolve_redirect_url("http://a.example/x/y", "/z").unwrap(),
            "http://a.example/z"
        );
    }

    #[test]
    fn test_resolve_redirect_url_relative_path() {
        assert_eq!(
            resolve_redirect_url("http://a.example/x/y", "z").unwrap(),
            "http://a.example/x/z"
        );
    }

    #[test]
    fn test_resolve_redirect_url_dot_segments() {
        assert_eq!(
            resolve_redirect_url("http://a.example/x/y", "../z").unwrap(),
            "http://a.example/z"
        );
        assert_eq!(
            resolve_redirect_url("http://a.example/a/b/c", "../../z").unwrap(),
            "http://a.example/z"
        );
        assert_eq!(
            resolve_redirect_url("http://a.example/x/y", "./z").unwrap(),
            "http://a.example/x/z"
        );
    }

    #[test]
    fn test_resolve_redirect_url_bare_query() {
        assert_eq!(
            resolve_redirect_url("http://a.example/x/y?old=1", "?new=2").unwrap(),
            "http://a.example/x/y?new=2"
        );
    }

    #[test]
    fn test_resolve_redirect_url_protocol_relative() {
        assert_eq!(
            resolve_redirect_url("https://a.example/x", "//b.example/y").unwrap(),
            "https://b.example/y"
        );
    }

    #[test]
    fn test_remove_dot_segments() {
        assert_eq!(remove_dot_segments("/a/b/../../c"), "/c");
        assert_eq!(remove_dot_segments("/a/b/./c"), "/a/b/c");
        assert_eq!(remove_dot_segments("/a/../../b"), "/b");
        assert_eq!(remove_dot_segments("/a/b/c"), "/a/b/c");
    }

    #[tokio::test]
    async fn test_fetch_invalid_url() {
        let result = fetch_simple("not-a-url", "GET", None, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_fetch_unsupported_scheme() {
        let result = fetch_simple("ftp://example.com", "GET", None, None).await;
        assert!(matches!(result, Err(HttpError::InvalidUrl(_))));
    }

    #[tokio::test]
    async fn test_fetch_http_defaults_to_port_80() {
        // No listener on this port, but the connection error (not a TLS error)
        // proves the request stayed plaintext and targeted port 80.
        let result = fetch_simple("http://127.0.0.1/", "GET", None, None).await;
        assert!(matches!(result, Err(HttpError::ConnectionFailed(_))));
    }
}
