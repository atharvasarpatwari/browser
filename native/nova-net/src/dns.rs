use std::net::{IpAddr, SocketAddr};

use hickory_resolver::config::*;
use hickory_resolver::TokioAsyncResolver;
use hickory_proto::rr::RecordType;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DnsError {
    #[error("DNS resolution failed for {domain}: {reason}")]
    ResolutionFailed { domain: String, reason: String },

    #[error("No records found for {domain} (type={record_type})")]
    NoRecords { domain: String, record_type: String },

    #[error("Invalid domain name: {0}")]
    InvalidDomain(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsRecord {
    pub record_type: String,
    pub ip: Option<IpAddr>,
    pub domain: Option<String>,
    pub ttl: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsResult {
    pub domain: String,
    pub records: Vec<DnsRecord>,
    pub resolution_time_ms: u64,
}

pub async fn resolve(domain: &str) -> Result<DnsResult, DnsError> {
    resolve_with_options(domain, &ResolverOptions::default()).await
}

pub async fn resolve_with_options(
    domain: &str,
    options: &ResolverOptions,
    ) -> Result<DnsResult, DnsError> {
    let start = std::time::Instant::now();

    let mut config = ResolverConfig::new();

    if let Some(ref servers) = options.nameservers {
        for addr in servers {
            config.add_name_server(NameServerConfig::new(SocketAddr::new(*addr, 53), Protocol::Udp));
        }
    } else {
        config = ResolverConfig::default();
    }

    let mut opts = ResolverOpts::default();
    opts.timeout = std::time::Duration::from_secs(options.timeout_secs.unwrap_or(5));
    opts.attempts = options.attempts.unwrap_or(3) as usize;

    let resolver = TokioAsyncResolver::tokio(config, opts);

    let lookup = resolver
        .lookup(domain, RecordType::A)
        .await
        .map_err(|e| DnsError::ResolutionFailed {
            domain: domain.to_string(),
            reason: e.to_string(),
        })?;

    let records: Vec<DnsRecord> = lookup
        .iter()
        .map(|r| {
            let record_type = match r {
                hickory_proto::rr::RData::A(_) => "A",
                hickory_proto::rr::RData::AAAA(_) => "AAAA",
                hickory_proto::rr::RData::CNAME(_) => "CNAME",
                hickory_proto::rr::RData::MX(_) => "MX",
                hickory_proto::rr::RData::TXT(_) => "TXT",
                _ => "OTHER",
            };
            DnsRecord {
                record_type: record_type.to_string(),
                ip: r.ip_addr(),
                domain: r
                    .as_aname()
                    .map(|n| n.to_string()),
                ttl: 0,
            }
        })
        .collect();

    if records.is_empty() {
        return Err(DnsError::NoRecords {
            domain: domain.to_string(),
            record_type: "A".to_string(),
        });
    }

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(DnsResult {
        domain: domain.to_string(),
        records,
        resolution_time_ms: elapsed,
    })
}

pub async fn resolve_ips(domain: &str) -> Result<Vec<IpAddr>, DnsError> {
    let result = resolve(domain).await?;
    Ok(result.records.into_iter().filter_map(|r| r.ip).collect())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ResolverOptions {
    pub nameservers: Option<Vec<IpAddr>>,
    pub timeout_secs: Option<u64>,
    pub attempts: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_resolve_localhost() {
        let result = resolve("localhost").await.unwrap();
        assert!(!result.records.is_empty());
        assert_eq!(result.domain, "localhost");
    }

    #[tokio::test]
    async fn test_resolve_ips() {
        let ips = resolve_ips("localhost").await.unwrap();
        assert!(!ips.is_empty());
        assert!(ips.contains(&IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1))));
    }

    #[tokio::test]
    async fn test_resolve_invalid() {
        let result = resolve("this-domain-does-not-exist-12345.invalid").await;
        assert!(result.is_err());
    }
}
