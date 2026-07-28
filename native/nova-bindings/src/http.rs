use std::collections::HashMap;

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct NapiHttpRequest {
    pub url: String,
    pub method: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub timeout_secs: Option<u32>,
}

#[napi(object)]
pub struct NapiHttpResponse {
    pub status: u32,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

#[napi]
pub async fn http_fetch(request: NapiHttpRequest) -> Result<NapiHttpResponse> {
    let req = nova_net::http::HttpRequest {
        url: request.url,
        method: request.method,
        headers: request.headers.unwrap_or_default(),
        body: request.body,
        timeout_secs: request.timeout_secs.map(|v| v as u64),
    };

    let response = nova_net::http::fetch(&req)
        .await
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(NapiHttpResponse {
        status: response.status as u32,
        status_text: response.status_text,
        headers: response.headers,
        body: response.body,
    })
}

#[napi]
pub async fn http_get(url: String, headers: Option<HashMap<String, String>>) -> Result<NapiHttpResponse> {
    http_fetch(NapiHttpRequest {
        url,
        method: "GET".to_string(),
        headers,
        body: None,
        timeout_secs: Some(30),
    })
    .await
}

#[napi]
pub async fn http_post(
    url: String,
    body: String,
    headers: Option<HashMap<String, String>>,
) -> Result<NapiHttpResponse> {
    http_fetch(NapiHttpRequest {
        url,
        method: "POST".to_string(),
        headers,
        body: Some(body),
        timeout_secs: Some(30),
    })
    .await
}
