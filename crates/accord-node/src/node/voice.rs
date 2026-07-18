//! Voix : périphériques audio persistés (D-029, bloc `impl Node` du domaine
//! `voice.*` — le moteur temps réel vit dans [`crate::voice`]).

use accord_core::db::Db;

use crate::error::NodeError;

use super::Node;

impl Node {
    /// Choix de périphériques audio persisté : `(entrée, sortie)`, `None` =
    /// périphérique par défaut du système. Même motif que le pseudo (D-027) :
    /// table `meta` de la base SQLCipher, pas de migration de schéma.
    pub fn voice_devices_config(&self) -> Result<(Option<String>, Option<String>), NodeError> {
        self.with_db(|db| {
            Ok((
                read_device_meta(db, META_VOICE_INPUT)?,
                read_device_meta(db, META_VOICE_OUTPUT)?,
            ))
        })
    }

    /// Persiste le choix de périphériques audio. Champ externe `None` =
    /// inchangé ; `Some(None)` = retour au périphérique par défaut ;
    /// `Some(Some(nom))` = nom `cpal` exact (validé : non vide, ≤ 256
    /// caractères, sans caractère de contrôle).
    pub fn set_voice_devices_config(
        &self,
        input: Option<Option<&str>>,
        output: Option<Option<&str>>,
    ) -> Result<(), NodeError> {
        // Tout valider avant d'écrire quoi que ce soit.
        for name in [input.flatten(), output.flatten()].into_iter().flatten() {
            validate_device_name(name)?;
        }
        self.with_db(|db| {
            if let Some(choice) = input {
                write_device_meta(db, META_VOICE_INPUT, choice)?;
            }
            if let Some(choice) = output {
                write_device_meta(db, META_VOICE_OUTPUT, choice)?;
            }
            Ok(())
        })
    }

    /// Persisted master output volume in percent (0..=200, default 100).
    /// Same `meta`-table pattern as the audio devices (D-029): no schema
    /// migration.
    pub fn voice_master_volume(&self) -> Result<u16, NodeError> {
        self.with_db(|db| read_volume_meta(db, META_VOICE_MASTER_VOLUME))
    }

    /// Persists the master output volume (percent, validated 0..=200).
    pub fn set_voice_master_volume(&self, volume: u16) -> Result<(), NodeError> {
        validate_volume(volume)?;
        self.with_db(|db| {
            db.set_meta(META_VOICE_MASTER_VOLUME, volume.to_string().as_bytes())?;
            Ok(())
        })
    }

    /// Persisted output volume of one peer in percent (0..=200, default 100),
    /// keyed by the peer's public key.
    pub fn voice_peer_volume(&self, pubkey: &[u8; 32]) -> Result<u16, NodeError> {
        let key = peer_volume_key(pubkey);
        self.with_db(|db| read_volume_meta(db, &key))
    }

    /// Persists the output volume of one peer (percent, validated 0..=200).
    pub fn set_voice_peer_volume(&self, pubkey: &[u8; 32], volume: u16) -> Result<(), NodeError> {
        validate_volume(volume)?;
        let key = peer_volume_key(pubkey);
        self.with_db(|db| {
            db.set_meta(&key, volume.to_string().as_bytes())?;
            Ok(())
        })
    }

    /// Persisted capture DSP flags `(noise suppression, AGC, echo cancel)` —
    /// noise suppression and AGC default to `false` (the UI decides its own
    /// policy), echo cancellation defaults to `true` (D-051 : sans elle, les
    /// interlocuteurs s'entendent en double dès que le haut-parleur joue) ;
    /// same `meta`-table pattern as the audio devices (no schema migration).
    /// A corrupt value falls back to the default rather than making voice
    /// unusable.
    pub fn voice_dsp_config(&self) -> Result<(bool, bool, bool), NodeError> {
        self.with_db(|db| {
            Ok((
                read_flag_meta(db, META_VOICE_DSP_NS)?,
                read_flag_meta(db, META_VOICE_DSP_AGC)?,
                read_flag_meta_or(db, META_VOICE_DSP_EC, true)?,
            ))
        })
    }

    /// Persists the capture DSP flags (`None` = unchanged).
    pub fn set_voice_dsp_config(
        &self,
        noise_suppression: Option<bool>,
        agc: Option<bool>,
        echo_cancel: Option<bool>,
    ) -> Result<(), NodeError> {
        self.with_db(|db| {
            if let Some(enabled) = noise_suppression {
                db.set_meta(META_VOICE_DSP_NS, flag_bytes(enabled))?;
            }
            if let Some(enabled) = agc {
                db.set_meta(META_VOICE_DSP_AGC, flag_bytes(enabled))?;
            }
            if let Some(enabled) = echo_cancel {
                db.set_meta(META_VOICE_DSP_EC, flag_bytes(enabled))?;
            }
            Ok(())
        })
    }
}

/// Clé de métadonnée du périphérique d'entrée audio choisi (D-029).
const META_VOICE_INPUT: &str = "voice.input_device";
/// Clé de métadonnée du périphérique de sortie audio choisi (D-029).
const META_VOICE_OUTPUT: &str = "voice.output_device";
/// Meta key of the persisted master output volume (percent).
const META_VOICE_MASTER_VOLUME: &str = "voice.volume.master";
/// Longueur maximale d'un nom de périphérique audio (caractères).
const DEVICE_NAME_MAX_CHARS: usize = 256;

/// Meta key of the persisted noise-suppression flag.
const META_VOICE_DSP_NS: &str = "voice.dsp.noise_suppression";
/// Meta key of the persisted AGC flag.
const META_VOICE_DSP_AGC: &str = "voice.dsp.agc";
/// Meta key of the persisted echo-cancellation flag (absent ⇒ enabled, D-051).
const META_VOICE_DSP_EC: &str = "voice.dsp.echo_cancel";

/// Meta key of a peer's persisted output volume (percent).
fn peer_volume_key(pubkey: &[u8; 32]) -> String {
    format!("voice.volume.{}", crate::hex::encode(pubkey))
}

/// Wire form of a persisted boolean flag.
fn flag_bytes(enabled: bool) -> &'static [u8] {
    if enabled {
        b"1"
    } else {
        b"0"
    }
}

/// Reads a persisted boolean flag (absent or unreadable ⇒ `false`).
fn read_flag_meta(db: &Db, key: &str) -> Result<bool, NodeError> {
    Ok(db.meta(key)?.as_deref() == Some(b"1"))
}

/// Reads a persisted boolean flag with an explicit default when absent
/// (an explicitly stored `"0"` stays `false`).
fn read_flag_meta_or(db: &Db, key: &str, default: bool) -> Result<bool, NodeError> {
    Ok(match db.meta(key)?.as_deref() {
        Some(b"1") => true,
        Some(_) => false,
        None => default,
    })
}

/// Validates a volume percent (0..=200).
fn validate_volume(volume: u16) -> Result<(), NodeError> {
    if volume > accord_voice::gain::VOLUME_MAX_PCT {
        return Err(NodeError::Invalid("volume hors bornes (0 à 200)"));
    }
    Ok(())
}

/// Reads a persisted volume (absent or unreadable ⇒ default 100 %; a corrupt
/// value must never make voice unusable).
fn read_volume_meta(db: &Db, key: &str) -> Result<u16, NodeError> {
    let Some(bytes) = db.meta(key)? else {
        return Ok(accord_voice::gain::VOLUME_DEFAULT_PCT);
    };
    let parsed = std::str::from_utf8(&bytes)
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .filter(|v| *v <= accord_voice::gain::VOLUME_MAX_PCT);
    Ok(parsed.unwrap_or(accord_voice::gain::VOLUME_DEFAULT_PCT))
}

/// Valide un nom de périphérique audio : non vide, borné, sans caractère de
/// contrôle. Le nom `cpal` est une clé exacte : aucun trim.
fn validate_device_name(name: &str) -> Result<(), NodeError> {
    if name.is_empty() || name.chars().count() > DEVICE_NAME_MAX_CHARS {
        return Err(NodeError::Invalid(
            "nom de périphérique audio : 1 à 256 caractères requis",
        ));
    }
    if name.chars().any(char::is_control) {
        return Err(NodeError::Invalid(
            "nom de périphérique audio : caractères de contrôle interdits",
        ));
    }
    Ok(())
}

/// Lit un choix de périphérique persisté (`None` : jamais défini ou remis au
/// défaut — encodé par une valeur vide).
fn read_device_meta(db: &Db, key: &str) -> Result<Option<String>, NodeError> {
    match db.meta(key)? {
        None => Ok(None),
        Some(bytes) if bytes.is_empty() => Ok(None),
        Some(bytes) => Ok(Some(String::from_utf8(bytes).map_err(|_| {
            NodeError::Invalid("choix de périphérique audio corrompu")
        })?)),
    }
}

/// Écrit un choix de périphérique (`None` = défaut, encodé par une valeur
/// vide : la table `meta` n'a pas de suppression).
fn write_device_meta(db: &Db, key: &str, choice: Option<&str>) -> Result<(), NodeError> {
    db.set_meta(key, choice.unwrap_or_default().as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::node::Node;
    use crate::outbound::OutboundSink;
    use accord_crypto::Identity;

    fn node() -> Node {
        let id = Identity::generate_with_pow_bits(1);
        let db = accord_core::db::Db::open_in_memory(&[1u8; 32]).unwrap();
        Node::new(id, db, OutboundSink::null())
    }

    #[test]
    fn volumes_default_to_hundred_percent() {
        let n = node();
        assert_eq!(n.voice_master_volume().unwrap(), 100);
        assert_eq!(n.voice_peer_volume(&[7u8; 32]).unwrap(), 100);
    }

    #[test]
    fn volumes_persist_per_peer_and_master() {
        let n = node();
        n.set_voice_master_volume(150).unwrap();
        n.set_voice_peer_volume(&[7u8; 32], 0).unwrap();
        n.set_voice_peer_volume(&[8u8; 32], 200).unwrap();
        assert_eq!(n.voice_master_volume().unwrap(), 150);
        assert_eq!(n.voice_peer_volume(&[7u8; 32]).unwrap(), 0);
        assert_eq!(n.voice_peer_volume(&[8u8; 32]).unwrap(), 200);
        // Other peers are untouched.
        assert_eq!(n.voice_peer_volume(&[9u8; 32]).unwrap(), 100);
    }

    #[test]
    fn out_of_range_volume_is_rejected() {
        let n = node();
        assert!(n.set_voice_master_volume(201).is_err());
        assert!(n.set_voice_peer_volume(&[7u8; 32], 999).is_err());
        assert_eq!(n.voice_master_volume().unwrap(), 100);
    }
}
