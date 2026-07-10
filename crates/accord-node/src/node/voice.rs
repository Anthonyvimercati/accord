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
}

/// Clé de métadonnée du périphérique d'entrée audio choisi (D-029).
const META_VOICE_INPUT: &str = "voice.input_device";
/// Clé de métadonnée du périphérique de sortie audio choisi (D-029).
const META_VOICE_OUTPUT: &str = "voice.output_device";
/// Longueur maximale d'un nom de périphérique audio (caractères).
const DEVICE_NAME_MAX_CHARS: usize = 256;

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
