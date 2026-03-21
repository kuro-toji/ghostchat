use libp2p::{identify, mdns, noise, ping, request_response, tcp, yamux, kad, dcutr, relay, webrtc, Multiaddr, PeerId};

pub fn check_webrtc(keypair: libp2p::identity::Keypair) {
    let local_peer_id = PeerId::from(keypair.public());
    let (relay_transport, relay_client) = relay::client::new(local_peer_id);
    let webrtc_transport = webrtc::tokio::Transport::new(
        keypair.clone(),
        webrtc::tokio::Certificate::generate(&mut rand::thread_rng()).expect("Failed to generate cert"),
    );

    let mut builder = libp2p::SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        ).unwrap()
        .with_other_transport(|_key| relay_transport).unwrap()
        .with_other_transport(|_key| webrtc_transport).unwrap()
        .with_dns().unwrap()
        .with_behaviour(|key: &libp2p::identity::Keypair| {
            let mut k = kad::Behaviour::new(local_peer_id, kad::store::MemoryStore::new(local_peer_id));
            k.set_mode(Some(kad::Mode::Server));
            Ok(k)
        }).unwrap();
}
