//! Recherche locale aveugle (SPEC §9).
//!
//! L'index ne contient jamais de texte : chaque mot est réduit à
//! `HMAC-SHA-256(clé_de_recherche, mot_normalisé)`. La clé de recherche est
//! dérivée de la graine d'identité ([`accord_crypto::derive_search_key`]) et
//! ne quitte jamais l'appareil — même un vol de la base ne révèle pas le
//! vocabulaire sans elle. Une requête est l'intersection des messages
//! contenant tous les mots demandés.

use std::collections::BTreeSet;

use hmac::digest::KeyInit;
use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::db::Db;
use crate::error::CoreError;

/// Longueur minimale d'un mot indexé (élimine le bruit).
const MIN_TOKEN_CHARS: usize = 2;
/// Longueur maximale d'un mot indexé.
const MAX_TOKEN_CHARS: usize = 64;
/// Nombre maximal de mots indexés par message.
const MAX_TOKENS_PER_MSG: usize = 128;

/// Normalise et découpe un texte en mots uniques triés.
///
/// Minuscule Unicode, découpe sur tout caractère non alphanumérique ; les
/// mots trop courts ou trop longs sont écartés.
pub fn tokenize(text: &str) -> Vec<String> {
    let lowered = text.to_lowercase();
    let set: BTreeSet<String> = lowered
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| {
            let n = w.chars().count();
            (MIN_TOKEN_CHARS..=MAX_TOKEN_CHARS).contains(&n)
        })
        .map(str::to_string)
        .collect();
    set.into_iter().take(MAX_TOKENS_PER_MSG).collect()
}

/// HMAC d'un mot normalisé sous la clé de recherche locale.
fn token_hmac(search_key: &[u8; 32], token: &str) -> [u8; 32] {
    // HMAC complète les clés courtes par des zéros jusqu'à la taille de bloc
    // (64 octets pour SHA-256) : ce constructeur infaillible est strictement
    // équivalent à `new_from_slice(search_key)`.
    let mut padded = [0u8; 64];
    padded[..32].copy_from_slice(search_key);
    let mut mac = <Hmac<Sha256> as KeyInit>::new(&padded.into());
    mac.update(token.as_bytes());
    mac.finalize().into_bytes().into()
}

/// Jetons HMAC d'un texte (indexation comme requête).
pub fn hashed_tokens(search_key: &[u8; 32], text: &str) -> Vec<[u8; 32]> {
    tokenize(text)
        .iter()
        .map(|t| token_hmac(search_key, t))
        .collect()
}

/// Indexe le texte d'un message. Sans effet si aucun mot exploitable.
pub fn index_message(
    db: &Db,
    search_key: &[u8; 32],
    msg_id: &[u8; 16],
    text: &str,
) -> Result<(), CoreError> {
    let tokens = hashed_tokens(search_key, text);
    if tokens.is_empty() {
        return Ok(());
    }
    db.index_tokens(msg_id, &tokens)
}

/// Réindexe un message après édition (l'ancien vocabulaire est effacé).
pub fn reindex_message(
    db: &Db,
    search_key: &[u8; 32],
    msg_id: &[u8; 16],
    new_text: &str,
) -> Result<(), CoreError> {
    db.unindex_msg(msg_id)?;
    index_message(db, search_key, msg_id, new_text)
}

/// Messages contenant tous les mots de `query` (intersection).
pub fn search(db: &Db, search_key: &[u8; 32], query: &str) -> Result<Vec<[u8; 16]>, CoreError> {
    let tokens = hashed_tokens(search_key, query);
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    db.search_tokens(&tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_normalizes_dedups_and_filters() {
        let tokens = tokenize("Bonjour, BONJOUR le Monde ! x 2026");
        assert_eq!(tokens, vec!["2026", "bonjour", "le", "monde"]);
    }

    #[test]
    fn index_and_search_intersection() {
        let db = Db::open_in_memory(&[4u8; 32]).unwrap();
        let key = [9u8; 32];
        index_message(&db, &key, &[1; 16], "rendez-vous demain au parc").unwrap();
        index_message(&db, &key, &[2; 16], "le parc est fermé demain").unwrap();
        index_message(&db, &key, &[3; 16], "réunion demain matin").unwrap();

        let both = search(&db, &key, "demain parc").unwrap();
        assert_eq!(both.len(), 2);
        assert!(both.contains(&[1; 16]) && both.contains(&[2; 16]));

        assert!(search(&db, &key, "demain inexistant").unwrap().is_empty());
        assert!(search(&db, &key, "!!!").unwrap().is_empty());
    }

    #[test]
    fn index_stores_no_plaintext_tokens() {
        let db = Db::open_in_memory(&[4u8; 32]).unwrap();
        let key = [9u8; 32];
        index_message(&db, &key, &[1; 16], "confidentiel").unwrap();
        // Le HMAC du mot n'est pas le mot : une autre clé ne trouve rien.
        assert!(search(&db, &[8u8; 32], "confidentiel").unwrap().is_empty());
        assert_eq!(search(&db, &key, "confidentiel").unwrap(), vec![[1; 16]]);
    }

    #[test]
    fn reindex_replaces_vocabulary() {
        let db = Db::open_in_memory(&[4u8; 32]).unwrap();
        let key = [9u8; 32];
        index_message(&db, &key, &[1; 16], "ancien contenu").unwrap();
        reindex_message(&db, &key, &[1; 16], "nouveau texte").unwrap();
        assert!(search(&db, &key, "ancien").unwrap().is_empty());
        assert_eq!(search(&db, &key, "nouveau").unwrap(), vec![[1; 16]]);
    }
}
