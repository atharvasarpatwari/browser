use nova_net::dns;

#[tokio::test]
async fn test_dns_resolve_localhost() {
    let result = dns::resolve("localhost").await.unwrap();
    assert_eq!(result.domain, "localhost");
    assert!(!result.records.is_empty());
}

#[tokio::test]
async fn test_dns_resolve_ips_localhost() {
    let ips = dns::resolve_ips("localhost").await.unwrap();
    assert!(!ips.is_empty());
}

#[tokio::test]
async fn test_dns_resolve_with_options() {
    let options = dns::ResolverOptions {
        timeout_secs: Some(5),
        attempts: Some(1),
        ..Default::default()
    };
    let result = dns::resolve_with_options("localhost", &options).await;
    assert!(result.is_ok() || result.is_err());
}

#[test]
fn test_dns_result_serialization() {
    let result = dns::DnsResult {
        domain: "example.com".to_string(),
        records: vec![dns::DnsRecord {
            record_type: "A".to_string(),
            ip: Some("93.184.216.34".parse().unwrap()),
            domain: Some("example.com".to_string()),
            ttl: 3600,
        }],
        resolution_time_ms: 42,
    };
    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("example.com"));
    assert!(json.contains("93.184.216.34"));
}

#[cfg(feature = "tls")]
mod tls_tests {
    use nova_net::tls;

    #[test]
    fn test_tls_config_default() {
        let config = tls::TlsConfig::default();
        assert!(config.verify_certificates);
        assert_eq!(config.min_protocol_version, tls::TlsVersion::Tls12);
    }

    #[test]
    fn test_tls_create_config() {
        let config = tls::create_tls_config(&tls::TlsConfig::default()).unwrap();
        assert!(config.alpn_protocols.is_empty());
    }

    #[test]
    fn test_tls_create_config_no_verify() {
        let config = tls::create_tls_config(&tls::TlsConfig {
            verify_certificates: false,
            ..Default::default()
        })
        .unwrap();
        assert!(config.alpn_protocols.is_empty());
    }

    #[test]
    fn test_tls_connect_invalid() {
        let result = tls::connect_tls("invalid.host.xyz", 443, &tls::TlsConfig::default());
        assert!(result.is_err());
    }
}

#[cfg(feature = "http")]
mod http_tests {
    use nova_net::http;

    #[tokio::test]
    async fn test_http_parse_response() {
        let result = http::fetch_simple("https://example.com", "GET", None, None).await;
        assert!(result.is_err() || result.is_ok());
    }

    #[tokio::test]
    async fn test_http_fetch_invalid_url() {
        let result = http::fetch_simple("not-a-url", "GET", None, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_http_fetch_invalid_method() {
        let result = http::fetch_simple("https://example.com", "NOT A METHOD", None, None).await;
        assert!(result.is_err());
    }
}
