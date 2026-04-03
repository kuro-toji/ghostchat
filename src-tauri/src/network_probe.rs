use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum NatType {
    Open,
    FullCone,
    Symmetric,
    Restricted,
    Unknown,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NetworkCapabilities {
    pub nat_type: NatType,
    pub external_ip: Option<String>,
    pub ipv6_capable: bool,
}

pub async fn probe_network() -> NetworkCapabilities {
    // In a real implementation, we would use the `stun` crate to query STUN servers.
    // For now, we'll return a mock capability response indicating a Restricted NAT.
    NetworkCapabilities {
        nat_type: NatType::Restricted,
        external_ip: Some("203.0.113.1".to_string()),
        ipv6_capable: false,
    }
}
