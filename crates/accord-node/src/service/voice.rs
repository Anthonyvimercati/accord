//! Méthodes `voice.*` (contrat gelé des salons vocaux D-025, périphériques
//! audio D-029, DSP de capture) et `calls.*` (appels 1-à-1, voir
//! docs/VOICE_CALLS.md).

use serde_json::{json, Value};

use crate::error::NodeError;
use crate::hex;
use crate::voice::VoiceStatus;

use super::helpers::{param_device, param_id16, param_pubkey};
use super::NodeService;

impl NodeService {
    /// Méthodes `voice.*` et `calls.*` (moteur voix requis).
    pub(super) async fn call_voice(
        &self,
        method: &str,
        params: &Value,
    ) -> Result<Value, NodeError> {
        let voice = self
            .voice
            .as_ref()
            .ok_or(NodeError::NotFound("sous-système voix indisponible"))?;
        match method {
            "calls.start" => {
                let peer = param_pubkey(params, "peer")?;
                let call_id = voice.call_start(peer).await?;
                Ok(json!({ "call_id": hex::encode(&call_id) }))
            }
            "calls.accept" => {
                let call_id = param_id16(params, "call_id")?;
                voice.call_accept(call_id).await?;
                Ok(json!({ "ok": true }))
            }
            "calls.decline" => {
                let call_id = param_id16(params, "call_id")?;
                voice.call_decline(call_id).await?;
                Ok(json!({ "ok": true }))
            }
            "calls.hangup" => {
                voice.call_hangup().await?;
                Ok(json!({ "ok": true }))
            }
            "calls.status" => {
                let snapshot = voice.call_status().await?;
                Ok(json!({
                    "state": snapshot.phase.as_str(),
                    "peer": snapshot.peer.map(|p| hex::encode(&p)),
                    "call_id": snapshot.call_id.map(|c| hex::encode(&c)),
                    "since_ms": snapshot.since_ms,
                }))
            }
            "voice.set_noise_suppression" => {
                let enabled = params
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .ok_or(NodeError::Invalid("enabled booléen requis"))?;
                voice.set_dsp(Some(enabled), None).await?;
                Ok(json!({}))
            }
            "voice.set_agc" => {
                let enabled = params
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .ok_or(NodeError::Invalid("enabled booléen requis"))?;
                voice.set_dsp(None, Some(enabled)).await?;
                Ok(json!({}))
            }
            "voice.join" => {
                let group_id = param_id16(params, "group_id")?;
                let channel_id = param_id16(params, "channel_id")?;
                let participants = voice.join(group_id, channel_id).await?;
                Ok(json!({
                    "participants": participants
                        .iter()
                        .map(|pk| hex::encode(pk))
                        .collect::<Vec<_>>(),
                }))
            }
            "voice.leave" => {
                voice.leave().await?;
                Ok(json!({}))
            }
            "voice.mute" => {
                let muted = params
                    .get("muted")
                    .and_then(Value::as_bool)
                    .ok_or(NodeError::Invalid("muted booléen requis"))?;
                voice.set_muted(muted).await?;
                Ok(json!({}))
            }
            "voice.deafen" => {
                let on = params
                    .get("on")
                    .and_then(Value::as_bool)
                    .ok_or(NodeError::Invalid("on booléen requis"))?;
                voice.set_deafened(on).await?;
                Ok(json!({}))
            }
            "voice.set_volume" => {
                // `peer` absent = master output volume.
                let peer = match params.get("peer") {
                    None | Some(Value::Null) => None,
                    Some(_) => Some(param_pubkey(params, "peer")?),
                };
                let volume = params
                    .get("volume")
                    .and_then(Value::as_u64)
                    .ok_or(NodeError::Invalid("volume entier requis"))?;
                let volume = u16::try_from(volume)
                    .map_err(|_| NodeError::Invalid("volume hors bornes (0 à 200)"))?;
                voice.set_volume(peer, volume).await?;
                Ok(json!({}))
            }
            "voice.status" => {
                let status = voice.status().await?;
                let master_volume = voice.master_volume().await?;
                let (noise_suppression, agc) = voice.dsp_config().await?;
                Ok(json!({
                    "active": status.as_ref().map(voice_status_json),
                    "master_volume": master_volume,
                    "dsp": {
                        "noise_suppression": noise_suppression,
                        "agc": agc,
                    },
                }))
            }
            "voice.devices" => {
                let devices = voice.devices().await?;
                Ok(json!({
                    "inputs": devices.inputs,
                    "outputs": devices.outputs,
                    "selected_input": devices.selected_input,
                    "selected_output": devices.selected_output,
                }))
            }
            "voice.set_devices" => {
                let input = param_device(params, "input")?;
                let output = param_device(params, "output")?;
                voice.set_devices(input, output).await?;
                Ok(json!({}))
            }
            "voice.mic_test" => {
                let enabled = params
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .ok_or(NodeError::Invalid("enabled booléen requis"))?;
                voice.mic_test(enabled).await?;
                Ok(json!({}))
            }
            _ => Err(NodeError::Invalid("méthode inconnue")),
        }
    }
}

/// Rend l'état du salon vocal actif pour `voice.status` (contrat gelé,
/// étendu de façon additive : deafen, volumes, appels 1-à-1, modération
/// vocale et priorité d'orateur).
fn voice_status_json(status: &VoiceStatus) -> Value {
    json!({
        "group_id": hex::encode(&status.group_id),
        "channel_id": hex::encode(&status.channel_id),
        "is_call": status.is_call,
        "muted": status.muted,
        "deafened": status.deafened,
        "participants": status.participants.iter().map(|p| json!({
            "pubkey": hex::encode(&p.pubkey),
            "speaking": p.speaking,
            "muted": p.muted,
            "deafened": p.deafened,
            "volume": p.volume,
            "server_muted": p.server_muted,
            "server_deafened": p.server_deafened,
            "priority_speaker": p.priority_speaker,
        })).collect::<Vec<_>>(),
    })
}
