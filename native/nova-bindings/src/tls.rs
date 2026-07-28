use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct NapiTlsConfig {
    pub verify_certificates: Option<bool>,
}

#[napi(object)]
pub struct NapiTlsInfo {
    pub protocol_version: String,
    pub cipher_suite: String,
}

#[napi]
pub fn tls_connect(host: String, port: u32, config: Option<NapiTlsConfig>) -> Result<NapiTlsInfo> {
    let tls_config = nova_net::tls::TlsConfig {
        verify_certificates: config
            .as_ref()
            .and_then(|c| c.verify_certificates)
            .unwrap_or(true),
        ..Default::default()
    };

    let connection = nova_net::tls::connect_tls(&host, port as u16, &tls_config)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(NapiTlsInfo {
        protocol_version: connection.info.protocol_version,
        cipher_suite: connection.info.cipher_suite,
    })
}

#[napi]
pub fn tls_create_config(verify_certificates: Option<bool>) -> Result<String> {
    let config = nova_net::tls::TlsConfig {
        verify_certificates: verify_certificates.unwrap_or(true),
        ..Default::default()
    };

    serde_json::to_string(&config).map_err(|e| Error::from_reason(e.to_string()))
}
