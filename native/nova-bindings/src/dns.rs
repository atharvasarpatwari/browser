use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct NapiDnsRecord {
    pub record_type: String,
    pub ip: Option<String>,
    pub domain: Option<String>,
    pub ttl: u32,
}

#[napi(object)]
pub struct NapiDnsResult {
    pub domain: String,
    pub records: Vec<NapiDnsRecord>,
    pub resolution_time_ms: u32,
}

#[napi]
pub async fn resolve_dns(domain: String) -> Result<NapiDnsResult> {
    let result = nova_net::dns::resolve(&domain)
        .await
        .map_err(|e| Error::from_reason(e.to_string()))?;

    let records = result
        .records
        .into_iter()
        .map(|r| NapiDnsRecord {
            record_type: r.record_type,
            ip: r.ip.map(|i| i.to_string()),
            domain: r.domain,
            ttl: r.ttl,
        })
        .collect();

    Ok(NapiDnsResult {
        domain: result.domain,
        records,
        resolution_time_ms: result.resolution_time_ms as u32,
    })
}

#[napi]
pub async fn resolve_dns_ips(domain: String) -> Result<Vec<String>> {
    let ips = nova_net::dns::resolve_ips(&domain)
        .await
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(ips.into_iter().map(|ip| ip.to_string()).collect())
}
