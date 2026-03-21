use futures::prelude::*;
use libp2p::{
    core::upgrade,
    identify, mdns, noise, ping, request_response::{self, ProtocolSupport},
    swarm::{NetworkBehaviour, SwarmBuilder, SwarmEvent},
    tcp, yamux, Multiaddr, PeerId, Transport, StreamProtocol
};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tauri::{AppHandle, Manager, State, Emitter};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

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

pub enum SwarmCommand {
    Dial {
        peer_id: PeerId,
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
}

#[derive(Clone)]
pub struct P2PState {
    pub command_sender: mpsc::Sender<SwarmCommand>,
}

#[derive(NetworkBehaviour)]
struct GhostBehaviour {
    ping: ping::Behaviour,
    identify: identify::Behaviour,
    mdns: mdns::tokio::Behaviour,
    req_resp: request_response::cbor::Behaviour<Vec<u8>, ()>,
}

pub async fn run_swarm(mut swarm: libp2p::Swarm<GhostBehaviour>, mut command_receiver: mpsc::Receiver<SwarmCommand>, app: AppHandle) {
    loop {
        tokio::select! {
            cmd = command_receiver.recv() => {
                let Some(cmd) = cmd else { break };
                match cmd {
                    SwarmCommand::Dial { peer_id, responder } => {
                        let res = swarm.dial(peer_id.clone()).map_err(|e| e.to_string());
                        let _ = responder.send(res);
                    }
                    SwarmCommand::SendMessage { peer_id, ciphertext, responder } => {
                        swarm.behaviour_mut().req_resp.send_request(&peer_id, ciphertext);
                        let _ = responder.send(Ok(()));
                    }
                    SwarmCommand::GetPeers { responder } => {
                        let connected: Vec<String> = swarm.network_info()
                            .connection_counters()
                            // get connected peers - swarm doesn't easily expose a flat list without iterating connections.
                            // For simplicity, we just use connected peers if needed.
                            // we'll return empty for now since UI relies on events
                            .num_connections()
                            .to_string()
                            .into_bytes()
                            .into_iter()
                            .map(|_| String::new())
                            .collect();
                        let _ = responder.send(vec![]);
                    }
                }
            }
            event = swarm.select_next_some() => match event {
                SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                    let _ = app.emit("ghostchat://peer-status", PeerStatus {
                        peer_id: peer_id.to_string(),
                        online: true,
                    });
                }
                SwarmEvent::ConnectionClosed { peer_id, .. } => {
                    let _ = app.emit("ghostchat://peer-status", PeerStatus {
                        peer_id: peer_id.to_string(),
                        online: false,
                    });
                }
                SwarmEvent::Behaviour(GhostBehaviourEvent::ReqResp(request_response::Event::Message { peer, message })) => match message {
                    request_response::Message::Request { request, .. } => {
                        let _ = app.emit("ghostchat://message", MessagePayload {
                            from: peer.to_string(),
                            ciphertext: request,
                        });
                    }
                    _ => {}
                },
                _ => {}
            }
        }
    }
}

pub fn create_swarm() -> Result<libp2p::Swarm<GhostBehaviour>, Box<dyn std::error::Error>> {
    let local_key = libp2p::identity::Keypair::generate_ed25519();
    let local_peer_id = PeerId::from(local_key.public());
    
    let mut swarm = libp2p::SwarmBuilder::with_existing_identity(local_key)
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_websocket(
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_behaviour(|key| {
            Ok(GhostBehaviour {
                ping: ping::Behaviour::default(),
                identify: identify::Behaviour::new(identify::Config::new(
                    "/ghostchat/1.0".into(),
                    key.public(),
                )),
                mdns: mdns::tokio::Behaviour::new(mdns::Config::default(), key.public().to_peer_id())?,
                req_resp: request_response::cbor::Behaviour::new(
                    [(StreamProtocol::new("/ghostchat/1.0/message"), ProtocolSupport::Full)],
                    request_response::Config::default(),
                ),
            })
        })?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    // Listen on multiple interfaces
    swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse()?)?;
    swarm.listen_on("/ip4/0.0.0.0/tcp/0/ws".parse()?)?;

    Ok(swarm)
}

#[tauri::command]
pub async fn start_p2p_node(app: AppHandle) -> Result<String, String> {
    // If state already exists, just return our peerId
    if let Some(_) = app.try_state::<P2PState>() {
        return Err("Node already started".into());
    }

    let swarm = create_swarm().map_err(|e| e.to_string())?;
    let local_peer_id = swarm.local_peer_id().to_string();

    let (command_sender, command_receiver) = mpsc::channel(100);

    app.manage(P2PState { command_sender });

    tauri::async_runtime::spawn(run_swarm(swarm, command_receiver, app.clone()));

    Ok(local_peer_id)
}

#[tauri::command]
pub async fn send_p2p_message(peer_id: String, ciphertext: Vec<u8>, state: State<'_, P2PState>) -> Result<(), String> {
    let peer_id = PeerId::from_str(&peer_id).map_err(|e| e.to_string())?;
    let (responder, receiver) = oneshot::channel();
    
    state.command_sender.send(SwarmCommand::SendMessage {
        peer_id,
        ciphertext,
        responder,
    }).await.map_err(|e| e.to_string())?;

    receiver.await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dial_peer(peer_id: String, state: State<'_, P2PState>) -> Result<(), String> {
    let peer_id = PeerId::from_str(&peer_id).map_err(|e| e.to_string())?;
    let (responder, receiver) = oneshot::channel();
    
    state.command_sender.send(SwarmCommand::Dial {
        peer_id,
        responder,
    }).await.map_err(|e| e.to_string())?;

    receiver.await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_connected_peers(state: State<'_, P2PState>) -> Result<Vec<String>, String> {
    let (responder, receiver) = oneshot::channel();
    
    state.command_sender.send(SwarmCommand::GetPeers {
        responder,
    }).await.map_err(|e| e.to_string())?;

    receiver.await.map_err(|e| e.to_string())?
}
