//! Méthodes `voice.*` : contrat gelé des salons vocaux (D-025) et
//! périphériques audio (D-029).

use serde_json::{json, Value};

use crate::error::NodeError;
use crate::hex;
use crate::voice::VoiceStatus;

use super::helpers::{param_device, param_id16};
use super::NodeService;

impl NodeService {
    /// Méthodes `voice.*` : contrat gelé des salons vocaux (D-025).
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
            "voice.status" => {
                let status = voice.status().await?;
                Ok(json!({ "active": status.as_ref().map(voice_status_json) }))
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

/// Rend l'état du salon vocal actif pour `voice.status` (contrat gelé).
fn voice_status_json(status: &VoiceStatus) -> Value {
    json!({
        "group_id": hex::encode(&status.group_id),
        "channel_id": hex::encode(&status.channel_id),
        "muted": status.muted,
        "participants": status.participants.iter().map(|p| json!({
            "pubkey": hex::encode(&p.pubkey),
            "speaking": p.speaking,
        })).collect::<Vec<_>>(),
    })
}
