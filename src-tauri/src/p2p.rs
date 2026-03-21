use futures::prelude::*;
use libp2p::{
    dcutr, identify, kad, mdns, noise, ping, relay,
    request_response::{self, ProtocolSupport},
    swarm::{NetworkBehaviour, SwarmEvent},
    tcp, webrtc, yamux, Multiaddr, PeerId, StreamProtocol,
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
}

#[derive(Clone)]
pub struct P2PState {
    pub command_sender: mpsc::Sender<SwarmCommand>,
    pub local_peer_id: String,
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
}

// ─── Swarm Event Loop ───────────────────────────────────────

pub async fn run_swarm(
    mut swarm: libp2p::Swarm<GhostBehaviour>,
    mut command_receiver: mpsc::Receiver<SwarmCommand>,
    app: AppHandle,
) {
    let mut connected_peers: HashSet<String> = HashSet::new();

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
                }
            }
            event = swarm.select_next_some() => match event {
                SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                    connected_peers.insert(peer_id.to_string());
                    let _ = app.emit("ghostchat://peer-status", PeerStatus {
                        peer_id: peer_id.to_string(),
                        online: true,
                    });
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
                SwarmEvent::Behaviour(GhostBehaviourEvent::Kad(kad::Event::OutboundQueryProgressed { result, .. })) => {
                    if let kad::QueryResult::GetClosestPeers(Ok(ok)) = result {
                        for peer in ok.peers {
                            // Dial the discovered peer if we aren't already connected
                            let _ = swarm.dial(peer);
                        }
                    }
                }
                SwarmEvent::Behaviour(GhostBehaviourEvent::Dcutr(event)) => {
                    println!("👻 DCuTR Holepunch event: {:?}", event);
                }
                SwarmEvent::Behaviour(GhostBehaviourEvent::RelayClient(event)) => {
                    println!("👻 Relay Client event: {:?}", event);
                }
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
) -> Result<libp2p::Swarm<GhostBehaviour>, Box<dyn std::error::Error>> {
    let local_peer_id = PeerId::from(keypair.public());

    let (relay_transport, relay_client) = relay::client::new(local_peer_id);
    
    let webrtc_transport = webrtc::tokio::Transport::new(
        keypair.clone(),
        webrtc::tokio::Certificate::generate(&mut rand::thread_rng())?,
    );

    let mut swarm = libp2p::SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_other_transport(|_key| relay_transport)?
        .with_other_transport(|_key| webrtc_transport)?
        .with_dns()?
        .with_behaviour(|key: &libp2p::identity::Keypair| {
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
            })
        })?
        .with_swarm_config(|c: libp2p::swarm::Config| c.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    // Listen on TCP and WebRTC UDP so peers can hole-punch
    swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse()?)?;
    swarm.listen_on("/ip4/0.0.0.0/udp/0/webrtc-direct".parse()?)?;

    // Add bootstrap nodes to routing table
    let bootnodes = [
        ("QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN", "/dnsaddr/bootstrap.libp2p.io"),
        ("QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXBPxS8GWxghW", "/dnsaddr/bootstrap.libp2p.io"),
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
pub async fn start_p2p_node(app: AppHandle, identity_key_hex: String) -> Result<String, String> {
    if let Some(state) = app.try_state::<P2PState>() {
        return Ok(state.local_peer_id.clone());
    }

    // Decode the Ed25519 private key from the frontend
    let key_bytes = hex::decode(&identity_key_hex).map_err(|e| e.to_string())?;
    let secret_key = libp2p::identity::ed25519::SecretKey::try_from_bytes(&mut key_bytes.clone())
        .map_err(|e| e.to_string())?;
    let ed_keypair = libp2p::identity::ed25519::Keypair::from(secret_key);
    let keypair = libp2p::identity::Keypair::from(ed_keypair);

    let swarm = create_swarm(keypair).map_err(|e| e.to_string())?;
    let local_peer_id = swarm.local_peer_id().to_string();

    let (command_sender, command_receiver) = mpsc::channel(100);
    app.manage(P2PState { 
        command_sender,
        local_peer_id: local_peer_id.clone(),
    });

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

    state
        .command_sender
        .send(SwarmCommand::SendMessage {
            peer_id,
            ciphertext,
            responder,
        })
        .await
        .map_err(|e| e.to_string())?;

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

    state
        .command_sender
        .send(SwarmCommand::Dial {
            peer_id,
            multiaddr,
            responder,
        })
        .await
        .map_err(|e| e.to_string())?;

    receiver.await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_connected_peers(state: State<'_, P2PState>) -> Result<Vec<String>, String> {
    let (responder, receiver) = oneshot::channel();

    state
        .command_sender
        .send(SwarmCommand::GetPeers { responder })
        .await
        .map_err(|e| e.to_string())?;

    receiver.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_listen_addrs(state: State<'_, P2PState>) -> Result<Vec<String>, String> {
    let (responder, receiver) = oneshot::channel();
    state
        .command_sender
        .send(SwarmCommand::GetListenAddrs { responder })
        .await
        .map_err(|e| e.to_string())?;

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
pub async fn stop_p2p_node(app: AppHandle) -> Result<(), String> {
    app.unmanage::<P2PState>();
    Ok(())
}
