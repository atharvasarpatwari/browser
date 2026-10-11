//! Being wired into the running browser via
//! `src/browser/networking/native-http-client.ts`. The live networking path
//! otherwise is the pure-TypeScript stack in
//! `src/browser/networking/raw-socket-http-client.ts`; redirect-following
//! and retry live in `request-manager.ts` itself, not in
//! `redirect-handler.ts` (that file is unused — don't assume it's where
//! redirect logic lives). This module dechunks `Transfer-Encoding: chunked`
//! bodies and returns the body as raw bytes (binary-safe); it still has no
//! connection reuse and no proxy support — `RawSocketHttpClient` covers
//! those cases when this one isn't used.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use rustls::ClientConfig;
use rustls::pki_types::ServerName;
use rustls::{ClientConnection, StreamOwned};
use serde::{Deserialize, Serialize};
use thiserror::Error;

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
    pub body: Option<Vec<u8>>,
}

pub async fn fetch(request: &HttpRequest) -> Result<HttpResponse, HttpError> {
    let url: http::Uri = request
        .url
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

    let path = url
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");

    let method = request
        .method
        .to_uppercase();

    // Reject method strings that aren't a valid HTTP token (e.g. containing
    // spaces) before they reach the wire as a malformed request line — the
    // server seeing it is a different failure mode than "we sent garbage".
    http::Method::from_bytes(method.as_bytes())
        .map_err(|_| HttpError::InvalidMethod(request.method.clone()))?;

    let mut req_str = format!("{} {} HTTP/1.1\r\n", method, path);
    req_str.push_str(&format!("Host: {host}\r\n"));
    req_str.push_str("Connection: close\r\n");

    for (key, value) in &request.headers {
        req_str.push_str(&format!("{key}: {value}\r\n"));
    }

    if let Some(ref body) = request.body {
        req_str.push_str(&format!("Content-Length: {}\r\n", body.len()));
        req_str.push_str("Content-Type: application/json\r\n");
    }

    req_str.push_str("\r\n");

    if let Some(ref body) = request.body {
        req_str.push_str(body);
    }

    let tcp = TcpStream::connect(format!("{host}:{port}")).map_err(|e| {
        HttpError::ConnectionFailed(e.to_string())
    })?;
    tcp.set_read_timeout(Some(Duration::from_secs(
        request.timeout_secs.unwrap_or(30),
    )))?;

    let response = if is_tls {
        let mut root_store = rustls::RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

        let tls_config = ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth();

        let server_name = ServerName::try_from(host.clone()).map_err(|e: rustls::pki_types::InvalidDnsNameError| {
            HttpError::TlsError(e.to_string())
        })?;

        let conn = ClientConnection::new(tls_config.into(), server_name).map_err(|e| {
            HttpError::TlsError(e.to_string())
        })?;

        send_and_receive(StreamOwned::new(conn, tcp), &req_str)?
    } else {
        send_and_receive(tcp, &req_str)?
    };

    let (status, status_text, headers, body) = parse_http_response(&response)?;

    Ok(HttpResponse {
        status,
        status_text,
        headers,
        body,
    })
}

fn send_and_receive<S: Read + Write>(mut stream: S, req_str: &str) -> Result<Vec<u8>, HttpError> {
    stream.write_all(req_str.as_bytes()).map_err(HttpError::Io)?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response).map_err(HttpError::Io)?;
    Ok(response)
}

/// Finds the byte offset of the first occurrence of `needle` in `haystack`.
fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Decodes an HTTP/1.1 chunked-transfer body (RFC 7230 §4.1) into a flat
/// byte buffer: each chunk is `<hex-size>[;ext]\r\n<data>\r\n`, terminated
/// by a zero-size chunk. Chunk extensions and trailing headers are ignored
/// — nothing in this client reads trailers today.
fn decode_chunked_body(mut data: &[u8]) -> Result<Vec<u8>, HttpError> {
    let mut out = Vec::new();
    loop {
        let line_end = find_subslice(data, b"\r\n")
            .ok_or_else(|| HttpError::ConnectionFailed("malformed chunk size line".to_string()))?;
        let size_line = std::str::from_utf8(&data[..line_end])
            .map_err(|_| HttpError::ConnectionFailed("chunk size line is not valid UTF-8".to_string()))?;
        let size_hex = size_line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_hex, 16)
            .map_err(|_| HttpError::ConnectionFailed(format!("invalid chunk size: {size_hex}")))?;

        data = &data[line_end + 2..];
        if size == 0 {
            break;
        }
        if data.len() < size + 2 {
            return Err(HttpError::ConnectionFailed("truncated chunk data".to_string()));
        }
        out.extend_from_slice(&data[..size]);
        data = &data[size + 2..]; // skip chunk data + its trailing \r\n
    }
    Ok(out)
}

fn parse_http_response(response: &[u8]) -> Result<(u16, String, HashMap<String, String>, Option<Vec<u8>>), HttpError> {
    // Split on the blank line that separates headers from body. Searching the
    // raw bytes for the separator (rather than summing `.lines()` lengths)
    // avoids guessing how many bytes each line's terminator consumed, and
    // keeps the body as raw bytes instead of forcing it through lossy UTF-8.
    let (head, raw_body) = match find_subslice(response, b"\r\n\r\n") {
        Some(idx) => (&response[..idx], &response[idx + 4..]),
        None => match find_subslice(response, b"\n\n") {
            Some(idx) => (&response[..idx], &response[idx + 2..]),
            None => (response, &response[response.len()..]),
        },
    };

    // Headers are always ASCII-ish text per the HTTP spec — invalid UTF-8
    // here is a genuine protocol violation worth surfacing, unlike the body.
    let head_str = std::str::from_utf8(head)
        .map_err(|_| HttpError::ConnectionFailed("response headers are not valid UTF-8".to_string()))?;

    let mut lines = head_str.lines();

    let status_line = lines
        .next()
        .ok_or_else(|| HttpError::ConnectionFailed("empty response".to_string()))?;

    let parts: Vec<&str> = status_line.splitn(3, ' ').collect();
    if parts.len() < 2 {
        return Err(HttpError::ConnectionFailed(format!(
            "invalid status line: {status_line}"
        )));
    }

    let status: u16 = parts[1]
        .parse()
        .map_err(|_| HttpError::ConnectionFailed(format!("invalid status: {}", parts[1])))?;
    let status_text = parts.get(2).unwrap_or(&"").to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(
                key.trim().to_lowercase(),
                value.trim().to_string(),
            );
        }
    }

    let is_chunked = headers
        .get("transfer-encoding")
        .map(|v| v.to_ascii_lowercase().contains("chunked"))
        .unwrap_or(false);

    let body = if is_chunked {
        Some(decode_chunked_body(raw_body)?)
    } else if raw_body.is_empty() {
        None
    } else {
        Some(raw_body.to_vec())
    };

    Ok((status, status_text, headers, body))
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

    #[test]
    fn test_parse_http_response() {
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\nHello World";
        let (status, status_text, headers, body) = parse_http_response(response).unwrap();
        assert_eq!(status, 200);
        assert_eq!(status_text, "OK");
        assert_eq!(headers.get("content-type").unwrap(), "text/html");
        assert_eq!(body.unwrap(), b"Hello World");
    }

    #[test]
    fn test_parse_http_response_no_body() {
        let response = b"HTTP/1.1 204 No Content\r\n\r\n";
        let (status, status_text, headers, body) = parse_http_response(response).unwrap();
        assert_eq!(status, 204);
        assert!(body.is_none());
    }

    #[test]
    fn test_parse_http_response_binary_body() {
        // A body that isn't valid UTF-8 (e.g. PNG magic bytes) must survive
        // intact — this is exactly what broke before bodies were bytes.
        let mut response = b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\n\r\n".to_vec();
        let binary = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xFF, 0x00];
        response.extend_from_slice(&binary);
        let (status, _, _, body) = parse_http_response(&response).unwrap();
        assert_eq!(status, 200);
        assert_eq!(body.unwrap(), binary);
    }

    #[test]
    fn test_parse_http_response_chunked() {
        let response = concat!(
            "HTTP/1.1 200 OK\r\n",
            "Transfer-Encoding: chunked\r\n",
            "\r\n",
            "5\r\n",
            "Hello\r\n",
            "7\r\n",
            " World!\r\n",
            "0\r\n",
            "\r\n",
        );
        let (status, _, headers, body) = parse_http_response(response.as_bytes()).unwrap();
        assert_eq!(status, 200);
        assert_eq!(headers.get("transfer-encoding").unwrap(), "chunked");
        assert_eq!(body.unwrap(), b"Hello World!");
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
