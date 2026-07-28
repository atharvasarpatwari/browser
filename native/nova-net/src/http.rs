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
    let url: http::Uri = request
        .url
        .parse()
        .map_err(|e: http::uri::InvalidUri| HttpError::InvalidUrl(e.to_string()))?;

    let host = url
        .host()
        .ok_or_else(|| HttpError::InvalidUrl("no host".to_string()))?
        .to_string();

    let port = url.port_u16().unwrap_or(443);

    let path = url
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");

    let method = request
        .method
        .to_uppercase();

    let mut root_store = rustls::RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

    let tls_config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();

    let server_name = ServerName::try_from(host.clone()).map_err(|e: rustls::pki_types::InvalidServerErrorName| {
        HttpError::TlsError(e.to_string())
    })?;

    let tcp = TcpStream::connect(format!("{host}:{port}")).map_err(|e| {
        HttpError::ConnectionFailed(e.to_string())
    })?;
    tcp.set_read_timeout(Some(Duration::from_secs(
        request.timeout_secs.unwrap_or(30),
    )))?;

    let conn = ClientConnection::new(tls_config.into(), server_name).map_err(|e| {
        HttpError::TlsError(e.to_string())
    })?;

    let mut stream = StreamOwned::new(conn, tcp);

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

    stream
        .write_all(req_str.as_bytes())
        .map_err(HttpError::Io)?;

    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(HttpError::Io)?;

    let (status, status_text, headers, body) = parse_http_response(&response)?;

    Ok(HttpResponse {
        status,
        status_text,
        headers,
        body,
    })
}

fn parse_http_response(response: &str) -> Result<(u16, String, HashMap<String, String>, Option<String>), HttpError> {
    let mut lines = response.lines();

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
    let mut body_start = 0;

    for line in lines {
        if line.is_empty() {
            body_start += line.len() + 1;
            break;
        }
        body_start += line.len() + 1;

        if let Some((key, value)) = line.split_once(':') {
            headers.insert(
                key.trim().to_lowercase(),
                value.trim().to_string(),
            );
        }
    }

    let body = if body_start < response.len() {
        Some(response[body_start..].to_string())
    } else {
        None
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
        let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\nHello World";
        let (status, status_text, headers, body) = parse_http_response(response).unwrap();
        assert_eq!(status, 200);
        assert_eq!(status_text, "OK");
        assert_eq!(headers.get("content-type").unwrap(), "text/html");
        assert_eq!(body.unwrap(), "Hello World");
    }

    #[test]
    fn test_parse_http_response_no_body() {
        let response = "HTTP/1.1 204 No Content\r\n\r\n";
        let (status, status_text, headers, body) = parse_http_response(response).unwrap();
        assert_eq!(status, 204);
        assert!(body.is_none());
    }

    #[tokio::test]
    async fn test_fetch_invalid_url() {
        let result = fetch_simple("not-a-url", "GET", None, None).await;
        assert!(result.is_err());
    }
}
