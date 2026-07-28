use std::sync::Arc;

use rustls::client::ClientConfig;
use rustls::pki_types::{ServerName, InvalidServerErrorName};
use rustls::{ClientConnection, StreamOwned, RootCertStore};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum TlsError {
    #[error("TLS connection failed to {host}: {reason}")]
    ConnectionFailed { host: String, reason: String },

    #[error("Certificate verification failed: {0}")]
    CertVerificationFailed(String),

    #[error("Invalid server name: {0}")]
    InvalidServerName(String),

    #[error("TLS handshake timeout")]
    Timeout,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone)]
pub struct TlsConfig {
    pub verify_certificates: bool,
    pub min_protocol_version: TlsVersion,
}

impl Default for TlsConfig {
    fn default() -> Self {
        Self {
            verify_certificates: true,
            min_protocol_version: TlsVersion::Tls12,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TlsVersion {
    Tls12,
    Tls13,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsInfo {
    pub protocol_version: String,
    pub cipher_suite: String,
    pub peer_certificates: Vec<CertInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertInfo {
    pub subject: String,
    pub issuer: String,
    pub not_before: String,
    pub not_after: String,
    pub serial_number: String,
    pub fingerprint_sha256: String,
}

pub struct TlsConnection {
    pub info: TlsInfo,
    pub stream: Option<StreamOwned<ClientConnection, std::net::TcpStream>>,
}

pub fn create_tls_config(options: &TlsConfig) -> Result<Arc<ClientConfig>, TlsError> {
    let mut root_store = RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

    let mut config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();

    if !options.verify_certificates {
        config
            .dangerous()
            .set_certificate_verifier(Arc::new(NoVerifier));
    }

    match options.min_protocol_version {
        TlsVersion::Tls12 => {}
        TlsVersion::Tls13 => {
            config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
        }
    }

    Ok(Arc::new(config))
}

pub fn connect_tls(
    host: &str,
    port: u16,
    config: &TlsConfig,
) -> Result<TlsConnection, TlsError> {
    let tcp = std::net::TcpStream::connect(format!("{host}:{port}")).map_err(|e| {
        TlsError::ConnectionFailed {
            host: host.to_string(),
            reason: e.to_string(),
        }
    })?;

    tcp.set_read_timeout(Some(std::time::Duration::from_secs(10)))
        .map_err(TlsError::Io)?;

    let tls_config = create_tls_config(config)?;

    let server_name = ServerName::try_from(host.to_string()).map_err(|e: InvalidServerErrorName| {
        TlsError::InvalidServerName(e.to_string())
    })?;

    let conn = ClientConnection::new(tls_config, server_name).map_err(|e| {
        TlsError::ConnectionFailed {
            host: host.to_string(),
            reason: e.to_string(),
        }
    })?;

    let stream = StreamOwned::new(conn, tcp);

    let info = TlsInfo {
        protocol_version: "TLSv1.2+".to_string(),
        cipher_suite: "unknown".to_string(),
        peer_certificates: Vec::new(),
    };

    Ok(TlsConnection {
        info,
        stream: Some(stream),
    })
}

#[derive(Debug)]
struct NoVerifier;

impl rustls::client::danger::ServerCertVerifier for NoVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::RSA_PKCS1_SHA384,
            rustls::SignatureScheme::RSA_PKCS1_SHA512,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::ED25519,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_tls_config_default() {
        let config = create_tls_config(&TlsConfig::default()).unwrap();
        assert!(config.alpn_protocols.is_empty());
    }

    #[test]
    fn test_create_tls_config_no_verify() {
        let config = create_tls_config(&TlsConfig {
            verify_certificates: false,
            ..Default::default()
        })
        .unwrap();
        assert!(config.alpn_protocols.is_empty());
    }

    #[test]
    fn test_tls_connect_invalid_host() {
        let result = connect_tls("invalid.host.xyz", 443, &TlsConfig::default());
        assert!(result.is_err());
    }
}
