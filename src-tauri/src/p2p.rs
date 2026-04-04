use futures::prelude::*;
use libp2p::{
    dcutr, identify, kad, mdns, noise, ping, relay, rendezvous,
    request_response::{self, ProtocolSupport},
    swarm::{NetworkBehaviour, SwarmEvent},
    tcp, yamux, Multiaddr, PeerId, StreamProtocol,
};
use std::collections::HashSet;
use std::str::FromStr;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tauri::{AppHandle, Manager, State, Emitter};
use serde::Serialize;

// ─── Event Payloads ──────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct MessagePayload {
    pub from: String,
    pub ciphertext: Vec<u8>,
}

#[derive(Clone, Serialize)]
pub struct PeerStatus {
    pub peer_id: String,
    pub online: bool,
}

// ─── Swarm Commands ──────────────────────────────────────────

pub enum SwarmCommand {
    Dial {
        peer_id: PeerId,
        multiaddr: Option<Multiaddr>,
        responder: oneshot::Sender<Result<(), String>>,
    },
    SendMessage {
        peer_id: PeerId,
        ciphertext: Vec<u8>,
        responder: oneshot::Sender<Result<(), String>>,
    },
    GetPeers {
        responder: oneshot::Sender<Vec<String>>,
    },
    GetListenAddrs {
        responder: oneshot::Sender<Vec<String>>,
    },
    DiscoverPeers {
        peer_id: PeerId,
        responder: oneshot::Sender<Result<(), String>>,
    },
    DhtPut {
        key: Vec<u8>,
        value: Vec<u8>,
        responder: oneshot::Sender<Result<(), String>>,
    },
    DhtGet {
        key: Vec<u8>,
        responder: oneshot::Sender<Result<Vec<u8>, String>>,
    },
}

enum DhtResponder {
    Put(oneshot::Sender<Result<(), String>>),
    Get(oneshot::Sender<Result<Vec<u8>, String>>),
}

use std::sync::Mutex;

pub struct P2PState {
    pub command_sender: Mutex<Option<mpsc::Sender<SwarmCommand>>>,
    pub local_peer_id: Mutex<String>,
}

// ─── Network Behaviour ──────────────────────────────────────

#[derive(NetworkBehaviour)]
struct GhostBehaviour {
    ping: ping::Behaviour,
    identify: identify::Behaviour,
    mdns: mdns::tokio::Behaviour,
    req_resp: request_response::cbor::Behaviour<Vec<u8>, Vec<u8>>,
    relay_client: relay::client::Behaviour,
    dcutr: dcutr::Behaviour,
    kad: kad::Behaviour<kad::store::MemoryStore>,
    rendezvous: rendezvous::client::Behaviour,
}

// ─── Swarm Event Loop ───────────────────────────────────────

pub async fn run_swarm(
    mut swarm: libp2p::Swarm<GhostBehaviour>,
    mut command_receiver: mpsc::Receiver<SwarmCommand>,
    app: AppHandle,
) {
    let mut connected_peers: HashSet<String> = HashSet::new();
    let mut dht_queries: std::collections::HashMap<kad::QueryId, DhtResponder> = std::collections::HashMap::new();
    let rendezvous_server_peer_id = PeerId::from_str("QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt").unwrap();

    loop {
        tokio::select! {
            cmd = command_receiver.recv() => {
                let Some(cmd) = cmd else { break };
                match cmd {
                    SwarmCommand::Dial { peer_id, multiaddr, responder } => {
                        let res = if let Some(addr) = multiaddr {
                            let opts = libp2p::swarm::dial_opts::DialOpts::peer_id(peer_id)
                                .addresses(vec![addr])
                                .build();
                            swarm.dial(opts).map_err(|e| e.to_string())
                        } else {
                            match swarm.dial(peer_id) {
                                Ok(_) => Ok(()),
                                Err(libp2p::swarm::DialError::NoAddresses) => {
                                    // Fix 4: Trigger Kademlia DHT lookup to find the peer's addresses
                                    println!("👻 No addresses for {peer_id}, triggering DHT lookup...");
                                    swarm.behaviour_mut().kad.get_closest_peers(peer_id);
                                    Err("No addresses found locally. DHT lookup started.".to_string())
                                }
                                Err(e) => Err(e.to_string()),
                            }
                        };
                        let _ = responder.send(res);
                    }
                    SwarmCommand::SendMessage { peer_id, ciphertext, responder } => {
                        swarm.behaviour_mut().req_resp.send_request(&peer_id, ciphertext);
                        let _ = responder.send(Ok(()));
                    }
                    SwarmCommand::GetPeers { responder } => {
                        let peers: Vec<String> = connected_peers.iter().cloned().collect();
                        let _ = responder.send(peers);
                    }
                    SwarmCommand::GetListenAddrs { responder } => {
                        let addrs: Vec<String> = swarm.listeners()
                            .map(|a| a.to_string())
                            .collect();
                        let _ = responder.send(addrs);
                    }
                    SwarmCommand::DiscoverPeers { peer_id: _, responder } => {
                        let ns = rendezvous::Namespace::from_static("ghostchat");
                        swarm.behaviour_mut().rendezvous.discover(
                            Some(ns),
                            None,
                            None,
                            rendezvous_server_peer_id,
                        );
                        let _ = responder.send(Ok(()));
                    }
                    SwarmCommand::DhtPut { key, value, responder } => {
                        let record = libp2p::kad::Record {
                            key: libp2p::kad::RecordKey::new(&key),
                            value,
                            publisher: None,
                            expires: None,
                        };
                        match swarm.behaviour_mut().kad.put_record(record, libp2p::kad::Quorum::One) {
                            Ok(query_id) => { dht_queries.insert(query_id, DhtResponder::Put(responder)); }
                            Err(e) => { let _ = responder.send(Err(e.to_string())); }
                        }
                    }
                    SwarmCommand::DhtGet { key, responder } => {
                        let query_id = swarm.behaviour_mut().kad.get_record(libp2p::kad::RecordKey::new(&key));
                        dht_queries.insert(query_id, DhtResponder::Get(responder));
                    }
                }
            }
            event = swarm.select_next_some() => match event {
                SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                    connected_peers.insert(peer_id.to_string());
                    let _ = app.emit("ghostchat://peer-status", PeerStatus {
                        peer_id: peer_id.to_string(),
                        online: true,
                    });

                    // 6. Register if it's the rendezvous server
                    if peer_id == rendezvous_server_peer_id {
                        if let Err(e) = swarm.behaviour_mut().rendezvous.register(
                            rendezvous::Namespace::from_static("ghostchat"),
                            rendezvous_server_peer_id,
                            None,
                        ) {
                            println!("👻 Failed to register with rendezvous server: {:?}", e);
                        } else {
                            println!("👻 Sent rendezvous registration to {:?}", peer_id);
                        }
                    }
                }
                SwarmEvent::ConnectionClosed { peer_id, .. } => {
                    connected_peers.remove(&peer_id.to_string());
                    let _ = app.emit("ghostchat://peer-status", PeerStatus {
                        peer_id: peer_id.to_string(),
                        online: false,
                    });
                }
                SwarmEvent::Behaviour(GhostBehaviourEvent::ReqResp(
                    request_response::Event::Message { peer, message, .. }
                )) => {
                    if let request_response::Message::Request { request, channel, .. } = message {
                        let _ = app.emit("ghostchat://message", MessagePayload {
                            from: peer.to_string(),
                            ciphertext: request,
                        });
                        let _ = swarm.behaviour_mut().req_resp.send_response(channel, vec![]);
                    }
                }
                SwarmEvent::Behaviour(GhostBehaviourEvent::Mdns(mdns::Event::Discovered(peers))) => {
                    for (peer_id, addr) in peers {
                        swarm.add_peer_address(peer_id, addr);
                    }
                }
                SwarmEvent::Behaviour(GhostBehaviourEvent::Identify(identify::Event::Received { peer_id, info, .. })) => {
                    for addr in &info.listen_addrs {
                        swarm.add_peer_address(peer_id, addr.clone());
                    }
                    let addrs: Vec<String> = info.listen_addrs.iter().map(|a| a.to_string()).collect();
                    let _ = app.emit("ghostchat://peer-identified", serde_json::json!({
                        "peer_id": peer_id.to_string(),
                        "addrs": addrs
                    }));
                }
                SwarmEvent::Behaviour(GhostBehaviourEvent::Kad(kad::Event::OutboundQueryProgressed { id, result, .. })) => {
                    match result {
                        kad::QueryResult::GetClosestPeers(Ok(ok)) => {
                            for peer in ok.peers {
                                // Dial the discovered peer if we aren't already connected
                                let _ = swarm.dial(peer.peer_id);
                            }
                        }
                        kad::QueryResult::GetRecord(res) => {
                            if let Some(DhtResponder::Get(responder)) = dht_queries.remove(&id) {
                                match res {
                                    Ok(kad::GetRecordOk::FoundRecord(record)) => {
                                        let _ = responder.send(Ok(record.record.value));
                                    }
                                    Ok(kad::GetRecordOk::FinishedWithNoAdditionalRecord { .. }) => {
                                        let _ = responder.send(Err("NotFound".into()));
                                    }
                                    Err(e) => { let _ = responder.send(Err(e.to_string())); }
                                }
                            }
                        }
                        kad::QueryResult::PutRecord(res) => {
                            if let Some(DhtResponder::Put(responder)) = dht_queries.remove(&id) {
                                match res {
                                    Ok(_) => { let _ = responder.send(Ok(())); }
                                    Err(e) => { let _ = responder.send(Err(e.to_string())); }
                                }
                            }
                        }
                        _ => {}
                    }
                }
                SwarmEvent::Behaviour(GhostBehaviourEvent::Kad(event)) => {
                    println!("👻 Kad event: {:?}", event);
                }
                SwarmEvent::Behaviour(GhostBehaviourEvent::Dcutr(event)) => {
                    println!("👻 DCuTR Holepunch event: {:?}", event);
                }
                SwarmEvent::Behaviour(GhostBehaviourEvent::RelayClient(event)) => {
                    println!("👻 Relay Client event: {:?}", event);
                }
                SwarmEvent::Behaviour(GhostBehaviourEvent::Rendezvous(event)) => match event {
                    rendezvous::client::Event::Registered { namespace, ttl, rendezvous_node } => {
                        println!("👻 Registered with rendezvous server {:?} in namespace {:?} for {}s", rendezvous_node, namespace, ttl);
                    }
                    rendezvous::client::Event::RegisterFailed { rendezvous_node, namespace, error } => {
                        println!("👻 Rendezvous register failed {:?} {:?} {:?}", rendezvous_node, namespace, error);
                    }
                    rendezvous::client::Event::Discovered { registrations, .. } => {
                        for reg in registrations {
                            println!("👻 Rendezvous discovered peer {:?}", reg.record.peer_id());
                            for addr in reg.record.addresses() {
                                swarm.add_peer_address(reg.record.peer_id(), addr.clone());
                            }
                            let _ = swarm.dial(reg.record.peer_id());
                        }
                    }
                    rendezvous::client::Event::DiscoverFailed { rendezvous_node, namespace, error } => {
                        println!("👻 Rendezvous discover failed {:?} {:?} {:?}", rendezvous_node, namespace, error);
                    }
                    rendezvous::client::Event::Expired { peer } => {
                        println!("👻 Rendezvous peer expired {:?}", peer);
                    }
                },
                SwarmEvent::NewListenAddr { address, .. } => {
                    println!("👻 Listening on {address}");
                }
                _ => {}
            }
        }
    }
}

// ─── Swarm Creation ─────────────────────────────────────────

pub fn create_swarm(
    keypair: libp2p::identity::Keypair,
    use_tor: bool,
) -> Result<libp2p::Swarm<GhostBehaviour>, Box<dyn std::error::Error>> {
    let local_peer_id = PeerId::from(keypair.public());

    let mut swarm = libp2p::SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_quic()
        .with_dns()?
        .with_relay_client(
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_behaviour(|key: &libp2p::identity::Keypair, relay_client| {
            let mut kad = kad::Behaviour::new(
                local_peer_id,
                kad::store::MemoryStore::new(local_peer_id),
            );
            kad.set_mode(Some(kad::Mode::Server));

            Ok(GhostBehaviour {
                ping: ping::Behaviour::default(),
                identify: identify::Behaviour::new(identify::Config::new(
                    "/ghostchat/1.0".into(),
                    key.public(),
                )),
                mdns: mdns::tokio::Behaviour::new(
                    mdns::Config::default(),
                    key.public().to_peer_id(),
                )?,
                req_resp: request_response::cbor::Behaviour::new(
                    [(
                        StreamProtocol::new("/ghostchat/1.0/message"),
                        ProtocolSupport::Full,
                    )],
                    request_response::Config::default(),
                ),
                relay_client,
                dcutr: dcutr::Behaviour::new(local_peer_id),
                kad,
                rendezvous: rendezvous::client::Behaviour::new(key.clone()),
            })
        })?
        .with_swarm_config(|c: libp2p::swarm::Config| c.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    // Listen on TCP and WebRTC UDP so peers can hole-punch
    if use_tor {
        println!("👻 Tor mode active! Restricting incoming TCP to 127.0.0.1 for Hidden Service");
        if let Err(e) = swarm.listen_on("/ip4/127.0.0.1/tcp/4001".parse()?) {
            println!("👻 ⚠️ Tor Port Binding Failed: {}", e);
        }
    } else {
        println!("👻 Normal mode active. Listening publicly.");
        if let Err(e) = swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse()?) {
            println!("👻 ⚠️ TCP Listener Binding Failed: {}", e);
        }
        if let Err(e) = swarm.listen_on("/ip4/0.0.0.0/udp/0/quic-v1".parse()?) {
            println!("👻 ⚠️ QUIC Listener Binding Failed: {}", e);
        }
    }

    // Add bootstrap nodes to routing table and relay list
    let bootnodes = [
        ("QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN", "/dnsaddr/bootstrap.libp2p.io"),
        ("QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXBPxS8GWxghW", "/dnsaddr/bootstrap.libp2p.io"),
        ("QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt", "/ip4/147.75.109.213/tcp/4001"),
        // Additional well-known public relays for smart fallback
        ("QmYyQSo1c1Ym7RoBdGpiHJPSFkQzQkS9gY1yZ1HjH9hYzz", "/ip4/139.178.69.155/tcp/4001"), 
        ("QmYyQSo1c1Ym7RoBdGpiHJPSFkQzQkS9gY1yZ1HjH9hYzz", "/ip4/139.178.69.155/udp/4001/quic-v1"),
    ];
    for (peer_str, addr_str) in bootnodes {
        if let (Ok(peer_id), Ok(addr)) = (peer_str.parse::<PeerId>(), addr_str.parse::<Multiaddr>()) {
            swarm.behaviour_mut().kad.add_address(&peer_id, addr);
        }
    }
    // Bootstrap the DHT
    let _ = swarm.behaviour_mut().kad.bootstrap();

    println!("👻 Rust libp2p node created: {local_peer_id}");
    Ok(swarm)
}

// ─── Tauri Commands ─────────────────────────────────────────

#[tauri::command]
pub async fn start_p2p_node(app: AppHandle, identity_key_hex: String, use_tor: bool) -> Result<String, String> {
    if let Some(state) = app.try_state::<P2PState>() {
        let is_running = state.command_sender.lock().unwrap().is_some();
        if is_running {
            return Ok(state.local_peer_id.lock().unwrap().clone());
        }
    }

    // Decode the Ed25519 private key from the frontend
    let key_bytes = hex::decode(&identity_key_hex).map_err(|e| {
        println!("❌ Hex decode error: {}", e);
        e.to_string()
    })?;
    println!("👻 Key bytes length: {}", key_bytes.len());
    
    let mut key_bytes_clone = key_bytes.clone();
    let secret_key = libp2p::identity::ed25519::SecretKey::try_from_bytes(&mut key_bytes_clone)
        .map_err(|e| {
            println!("❌ SecretKey creation error: {}", e);
            e.to_string()
        })?;
    let ed_keypair = libp2p::identity::ed25519::Keypair::from(secret_key);
    let keypair = libp2p::identity::Keypair::from(ed_keypair);

    println!("👻 Keypair created successfully, local peer ID: {:?}", keypair.public());
    
    let swarm = create_swarm(keypair, use_tor).map_err(|e| {
        println!("❌ Swarm creation error: {}", e);
        e.to_string()
    })?;
    let local_peer_id = swarm.local_peer_id().to_string();

    let (command_sender, command_receiver) = mpsc::channel(100);
    
    if let Some(state) = app.try_state::<P2PState>() {
        *state.command_sender.lock().unwrap() = Some(command_sender);
        *state.local_peer_id.lock().unwrap() = local_peer_id.clone();
    } else {
        app.manage(P2PState { 
            command_sender: Mutex::new(Some(command_sender)),
            local_peer_id: Mutex::new(local_peer_id.clone()),
        });
    }

    tauri::async_runtime::spawn(run_swarm(swarm, command_receiver, app.clone()));

    Ok(local_peer_id)
}

#[tauri::command]
pub async fn send_p2p_message(
    peer_id: String,
    ciphertext: Vec<u8>,
    state: State<'_, P2PState>,
) -> Result<(), String> {
    let peer_id = PeerId::from_str(&peer_id).map_err(|e| e.to_string())?;
    let (responder, receiver) = oneshot::channel();

    let sender = state.command_sender.lock().unwrap().clone();
    if let Some(s) = sender {
        s.send(SwarmCommand::SendMessage {
            peer_id,
            ciphertext,
            responder,
        })
        .await
        .map_err(|e| e.to_string())?;
    } else {
        return Err("Node offline".into());
    }

    receiver.await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dial_peer(
    peer_id: String,
    multiaddr: Option<String>,
    state: State<'_, P2PState>,
) -> Result<(), String> {
    let peer_id = PeerId::from_str(&peer_id).map_err(|e| e.to_string())?;
    let multiaddr = multiaddr
        .map(|a| a.parse::<Multiaddr>())
        .transpose()
        .map_err(|e| e.to_string())?;

    let (responder, receiver) = oneshot::channel();

    let sender = state.command_sender.lock().unwrap().clone();
    if let Some(s) = sender {
        s.send(SwarmCommand::Dial {
            peer_id,
            multiaddr,
            responder,
        })
        .await
        .map_err(|e| e.to_string())?;
    } else {
        return Err("Node offline".into());
    }

    receiver.await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_connected_peers(state: State<'_, P2PState>) -> Result<Vec<String>, String> {
    let (responder, receiver) = oneshot::channel();

    let sender = state.command_sender.lock().unwrap().clone();
    if let Some(s) = sender {
        s.send(SwarmCommand::GetPeers { responder })
            .await
            .map_err(|e| e.to_string())?;
    } else {
        return Err("Node offline".into());
    }

    receiver.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_listen_addrs(state: State<'_, P2PState>) -> Result<Vec<String>, String> {
    let (responder, receiver) = oneshot::channel();
    
    let sender = state.command_sender.lock().unwrap().clone();
    if let Some(s) = sender {
        s.send(SwarmCommand::GetListenAddrs { responder })
            .await
            .map_err(|e| e.to_string())?;
    } else {
        return Err("Node offline".into());
    }

    let addrs = receiver.await.map_err(|e| e.to_string())?;
    
    // Resolve 0.0.0.0 to the actual LAN IP for sharing
    let local_ip = local_ip_address::local_ip().unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));
    let mut resolved_addrs = Vec::new();
    
    for addr in addrs {
        if addr.contains("0.0.0.0") {
            resolved_addrs.push(addr.replace("0.0.0.0", &local_ip.to_string()));
        } else if !addr.contains("127.0.0.1") {
            resolved_addrs.push(addr);
        }
    }

    Ok(resolved_addrs)
}

#[tauri::command]
pub async fn stop_p2p_node(state: State<'_, P2PState>) -> Result<(), String> {
    *state.command_sender.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub async fn discover_peers(
    peer_id: String,
    state: State<'_, P2PState>,
) -> Result<(), String> {
    let peer_id = PeerId::from_str(&peer_id).map_err(|e| e.to_string())?;
    let (responder, receiver) = oneshot::channel();

    let sender = state.command_sender.lock().unwrap().clone();
    if let Some(s) = sender {
        s.send(SwarmCommand::DiscoverPeers {
            peer_id,
            responder,
        })
        .await
        .map_err(|e| e.to_string())?;
    } else {
        return Err("Node offline".into());
    }

    receiver.await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dht_put(
    key: Vec<u8>,
    value: Vec<u8>,
    state: State<'_, P2PState>,
) -> Result<(), String> {
    let (responder, receiver) = oneshot::channel();

    let sender = state.command_sender.lock().unwrap().clone();
    if let Some(s) = sender {
        s.send(SwarmCommand::DhtPut { key, value, responder }).await.map_err(|e| e.to_string())?;
    } else {
        return Err("Node offline".into());
    }

    receiver.await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dht_get(
    key: Vec<u8>,
    state: State<'_, P2PState>,
) -> Result<Vec<u8>, String> {
    let (responder, receiver) = oneshot::channel();

    let sender = state.command_sender.lock().unwrap().clone();
    if let Some(s) = sender {
        s.send(SwarmCommand::DhtGet { key, responder }).await.map_err(|e| e.to_string())?;
    } else {
        return Err("Node offline".into());
    }

    receiver.await.map_err(|e| e.to_string())?
}
