//! Livraison hors-ligne par boîtes aux lettres DHT (SPEC §7, D-016).
//!
//! Quand le destinataire est injoignable, l'expéditeur dépose ses messages en
//! attente dans la DHT sous des clés par expéditeur et par jour :
//! `SHA-256("accord-mb" ‖ dest_node ‖ jour:u64be ‖ sender_node ‖ frag:u32be)`.
//! Chaque dépôt regroupe TOUS les messages en attente pour ce destinataire
//! (un dépôt ultérieur du même jour remplace le précédent — records plus
//! récents du même publieur). Le contenu est signé PUIS scellé : seul le
//! destinataire peut l'ouvrir, et il authentifie l'expéditeur à l'intérieur.
//!
//! Le destinataire interroge, pour chaque contact, toute la fenêtre de vie
//! d'un dépôt ([`poll_days`]) et les fragments croissants ; le fragment 0
//! annonce le total.

use accord_crypto::{node_id_of, sealed, verify_signature, CryptoError, Identity};
use accord_proto::limits::{DHT_MAX_EXPIRY_S, MAX_DHT_VALUE};
use accord_proto::types::{DhtRecord, RecordKind};
use sha2::{Digest, Sha256};

use crate::error::CoreError;

/// Contexte de signature d'une enveloppe de boîte aux lettres.
const SIG_CONTEXT: &[u8] = b"accord-mbx-v1";
/// Version du format d'enveloppe.
const ENVELOPE_VERSION: u8 = 1;
/// En-tête clair d'un fragment : `total_frags:u16be`.
const FRAG_HEADER: usize = 2;
/// Charge utile scellée maximale par fragment DHT.
const FRAG_CHUNK: usize = MAX_DHT_VALUE - FRAG_HEADER;
/// Durée de vie d'un dépôt : le plafond DHT (7 jours), la fenêtre promise
/// par le README. L'ancienne valeur (2 jours) combinée à une sonde limitée à
/// {jour, veille} perdait silencieusement tout message dont le destinataire
/// revenait au-delà de ~36 h.
const DEPOSIT_EXPIRY_S: u32 = DHT_MAX_EXPIRY_S;
/// Fenêtre de sonde côté destinataire : tout jour où un dépôt encore vivant
/// a pu être fait (aujourd'hui + les 7 jours de vie d'un dépôt).
const POLL_WINDOW_DAYS: usize = 8;
/// Nombre maximal de fragments par dépôt (512 KiB scellés, largement au-delà
/// d'une file de messages texte).
pub const MAX_FRAGMENTS: u16 = 64;

/// Jour Unix (nombre de jours depuis l'époque) d'une horloge murale en ms.
pub fn day_of_ms(now_ms: u64) -> u64 {
    now_ms / 86_400_000
}

/// Jours à sonder côté destinataire : toute la fenêtre de vie d'un dépôt,
/// du jour courant au plus ancien jour dont un dépôt peut encore être vivant.
pub fn poll_days(now_ms: u64) -> [u64; POLL_WINDOW_DAYS] {
    let day = day_of_ms(now_ms);
    core::array::from_fn(|i| day.saturating_sub(i as u64))
}

/// Clé DHT d'un fragment de boîte aux lettres (D-016).
pub fn mailbox_key(
    dest_node: &[u8; 32],
    day: u64,
    sender_node: &[u8; 32],
    frag_no: u32,
) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"accord-mb");
    h.update(dest_node);
    h.update(day.to_be_bytes());
    h.update(sender_node);
    h.update(frag_no.to_be_bytes());
    h.finalize().into()
}

/// Regroupe des messages encodés en une charge utile unique
/// (`u32be longueur ‖ octets`, répété).
pub fn bundle(items: &[Vec<u8>]) -> Vec<u8> {
    let total: usize = items.iter().map(|i| 4 + i.len()).sum();
    let mut out = Vec::with_capacity(total);
    for item in items {
        out.extend_from_slice(&(item.len() as u32).to_be_bytes());
        out.extend_from_slice(item);
    }
    out
}

/// Sépare une charge utile en messages encodés.
pub fn unbundle(bytes: &[u8]) -> Result<Vec<Vec<u8>>, CoreError> {
    let mut items = Vec::new();
    let mut at = 0usize;
    while at < bytes.len() {
        if bytes.len() - at < 4 {
            return Err(CoreError::Invalid("lot de boîte aux lettres tronqué"));
        }
        let mut len4 = [0u8; 4];
        len4.copy_from_slice(&bytes[at..at + 4]);
        let len = u32::from_be_bytes(len4) as usize;
        at += 4;
        if bytes.len() - at < len {
            return Err(CoreError::Invalid("élément de lot tronqué"));
        }
        items.push(bytes[at..at + len].to_vec());
        at += len;
    }
    Ok(items)
}

/// Signe puis scelle une charge utile pour `dest_pubkey`.
///
/// Enveloppe claire (avant scellement) :
/// `version(1) ‖ sender_pubkey(32) ‖ sig(64) ‖ payload`, où `sig` couvre
/// `"accord-mbx-v1" ‖ dest_node ‖ payload` — l'enveloppe ne peut pas être
/// redirigée vers un autre destinataire.
pub fn seal_envelope(
    sender: &Identity,
    dest_pubkey: &[u8; 32],
    payload: &[u8],
) -> Result<Vec<u8>, CoreError> {
    let dest_node = node_id_of(dest_pubkey).0;
    let mut signed = Vec::with_capacity(SIG_CONTEXT.len() + 32 + payload.len());
    signed.extend_from_slice(SIG_CONTEXT);
    signed.extend_from_slice(&dest_node);
    signed.extend_from_slice(payload);
    let sig = sender.sign(&signed);

    let mut envelope = Vec::with_capacity(1 + 32 + 64 + payload.len());
    envelope.push(ENVELOPE_VERSION);
    envelope.extend_from_slice(&sender.public_key());
    envelope.extend_from_slice(&sig);
    envelope.extend_from_slice(payload);
    Ok(sealed::seal(dest_pubkey, &envelope)?)
}

/// Ouvre une enveloppe scellée et authentifie l'expéditeur. Rend
/// `(clé publique de l'expéditeur, charge utile)`.
pub fn open_envelope(
    dest: &Identity,
    sealed_bytes: &[u8],
) -> Result<([u8; 32], Vec<u8>), CoreError> {
    let envelope = sealed::open(dest, sealed_bytes)?;
    if envelope.len() < 1 + 32 + 64 || envelope[0] != ENVELOPE_VERSION {
        return Err(CoreError::Invalid(
            "enveloppe de boîte aux lettres invalide",
        ));
    }
    let mut sender_pubkey = [0u8; 32];
    sender_pubkey.copy_from_slice(&envelope[1..33]);
    let mut sig = [0u8; 64];
    sig.copy_from_slice(&envelope[33..97]);
    let payload = &envelope[97..];

    let mut signed = Vec::with_capacity(SIG_CONTEXT.len() + 32 + payload.len());
    signed.extend_from_slice(SIG_CONTEXT);
    signed.extend_from_slice(&dest.node_id().0);
    signed.extend_from_slice(payload);
    verify_signature(&sender_pubkey, &signed, &sig)?;
    Ok((sender_pubkey, payload.to_vec()))
}

/// Construit les records DHT d'un dépôt complet : les messages en attente
/// sont regroupés, signés-puis-scellés, fragmentés et signés par record.
pub fn deposit_records(
    sender: &Identity,
    dest_pubkey: &[u8; 32],
    pending: &[Vec<u8>],
    now_ms: u64,
) -> Result<Vec<DhtRecord>, CoreError> {
    if pending.is_empty() {
        return Ok(Vec::new());
    }
    let sealed_bytes = seal_envelope(sender, dest_pubkey, &bundle(pending))?;
    let chunks: Vec<&[u8]> = sealed_bytes.chunks(FRAG_CHUNK).collect();
    if chunks.len() > MAX_FRAGMENTS as usize {
        return Err(CoreError::Invalid("dépôt hors-ligne trop volumineux"));
    }
    let total = chunks.len() as u16;
    let dest_node = node_id_of(dest_pubkey).0;
    let sender_node = sender.node_id().0;
    let day = day_of_ms(now_ms);

    let mut records = Vec::with_capacity(chunks.len());
    for (frag_no, chunk) in chunks.iter().enumerate() {
        let mut value = Vec::with_capacity(FRAG_HEADER + chunk.len());
        value.extend_from_slice(&total.to_be_bytes());
        value.extend_from_slice(chunk);
        let mut record = DhtRecord {
            key: mailbox_key(&dest_node, day, &sender_node, frag_no as u32),
            kind: RecordKind::MailboxHint,
            value,
            publisher: sender.public_key(),
            timestamp_ms: now_ms,
            expiry_s: DEPOSIT_EXPIRY_S,
            sig: [0u8; 64],
        };
        record.sig = sender.sign(&record.signable_bytes());
        records.push(record);
    }
    Ok(records)
}

/// Nombre total de fragments annoncé par le fragment 0 d'un dépôt.
pub fn fragment_total(frag0_value: &[u8]) -> Result<u16, CoreError> {
    if frag0_value.len() <= FRAG_HEADER {
        return Err(CoreError::Invalid("fragment de boîte aux lettres vide"));
    }
    Ok(u16::from_be_bytes([frag0_value[0], frag0_value[1]]))
}

/// Ré-assemble un dépôt à partir des valeurs de tous ses fragments (dans
/// l'ordre), l'ouvre et rend `(expéditeur, messages encodés)`.
///
/// `expected_sender` est le nœud du contact sondé : un dépôt signé par une
/// autre identité (record usurpé sous la clé d'un contact) est rejeté.
pub fn open_deposit(
    dest: &Identity,
    expected_sender: &[u8; 32],
    fragment_values: &[Vec<u8>],
) -> Result<Vec<Vec<u8>>, CoreError> {
    let first = fragment_values
        .first()
        .ok_or(CoreError::Invalid("dépôt sans fragment"))?;
    let total = fragment_total(first)? as usize;
    if fragment_values.len() != total {
        return Err(CoreError::Invalid("dépôt incomplet"));
    }
    let mut sealed_bytes = Vec::new();
    for value in fragment_values {
        if value.len() <= FRAG_HEADER || fragment_total(value)? as usize != total {
            return Err(CoreError::Invalid("fragments de dépôt incohérents"));
        }
        sealed_bytes.extend_from_slice(&value[FRAG_HEADER..]);
    }
    let (sender_pubkey, payload) = open_envelope(dest, &sealed_bytes)?;
    if node_id_of(&sender_pubkey).0 != *expected_sender {
        return Err(CoreError::Crypto(CryptoError::InvalidSignature));
    }
    unbundle(&payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_roundtrips() {
        let items = vec![b"un".to_vec(), Vec::new(), b"trois".to_vec()];
        assert_eq!(unbundle(&bundle(&items)).unwrap(), items);
        assert!(unbundle(&[0, 0, 0, 9, 1]).is_err());
    }

    #[test]
    fn envelope_signs_then_seals() {
        let alice = Identity::generate_with_pow_bits(1);
        let bob = Identity::generate_with_pow_bits(1);
        let sealed = seal_envelope(&alice, &bob.public_key(), b"en attente").unwrap();
        let (from, payload) = open_envelope(&bob, &sealed).unwrap();
        assert_eq!(from, alice.public_key());
        assert_eq!(payload, b"en attente");
        // Un tiers ne peut pas ouvrir.
        let eve = Identity::generate_with_pow_bits(1);
        assert!(open_envelope(&eve, &sealed).is_err());
    }

    #[test]
    fn envelope_cannot_be_redirected() {
        let alice = Identity::generate_with_pow_bits(1);
        let bob = Identity::generate_with_pow_bits(1);
        let carol = Identity::generate_with_pow_bits(1);
        // Une enveloppe scellée pour Bob, re-scellée telle quelle pour Carol
        // par un attaquant qui aurait le clair : la signature couvre le nœud
        // destinataire, Carol la rejette.
        let dest_node = node_id_of(&bob.public_key()).0;
        let payload = b"redirige-moi";
        let mut signed = Vec::new();
        signed.extend_from_slice(SIG_CONTEXT);
        signed.extend_from_slice(&dest_node);
        signed.extend_from_slice(payload);
        let sig = alice.sign(&signed);
        let mut envelope = vec![ENVELOPE_VERSION];
        envelope.extend_from_slice(&alice.public_key());
        envelope.extend_from_slice(&sig);
        envelope.extend_from_slice(payload);
        let resealed = sealed::seal(&carol.public_key(), &envelope).unwrap();
        assert!(open_envelope(&carol, &resealed).is_err());
    }

    #[test]
    fn deposit_fragments_and_reassembles() {
        let alice = Identity::generate_with_pow_bits(1);
        let bob = Identity::generate_with_pow_bits(1);
        // Charge > 8 KiB pour forcer plusieurs fragments.
        let big = vec![0xAB; 20_000];
        let items = vec![b"petit".to_vec(), big.clone()];
        let records = deposit_records(&alice, &bob.public_key(), &items, 86_400_000 * 3).unwrap();
        assert!(records.len() >= 3);
        // Clés distinctes, jour 3, fragments croissants.
        let sender_node = alice.node_id().0;
        let dest_node = bob.node_id().0;
        for (i, r) in records.iter().enumerate() {
            assert_eq!(r.key, mailbox_key(&dest_node, 3, &sender_node, i as u32));
            assert!(r.value.len() <= MAX_DHT_VALUE);
        }
        let values: Vec<Vec<u8>> = records.iter().map(|r| r.value.clone()).collect();
        assert_eq!(fragment_total(&values[0]).unwrap() as usize, values.len());
        let got = open_deposit(&bob, &sender_node, &values).unwrap();
        assert_eq!(got, items);
    }

    #[test]
    fn deposit_from_unexpected_sender_is_rejected() {
        let alice = Identity::generate_with_pow_bits(1);
        let mallory = Identity::generate_with_pow_bits(1);
        let bob = Identity::generate_with_pow_bits(1);
        let records = deposit_records(&mallory, &bob.public_key(), &[b"faux".to_vec()], 0).unwrap();
        let values: Vec<Vec<u8>> = records.iter().map(|r| r.value.clone()).collect();
        // Bob sonde la boîte d'Alice mais le dépôt vient de Mallory.
        assert!(open_deposit(&bob, &alice.node_id().0, &values).is_err());
    }

    #[test]
    fn incomplete_deposit_is_rejected() {
        let alice = Identity::generate_with_pow_bits(1);
        let bob = Identity::generate_with_pow_bits(1);
        let records = deposit_records(&alice, &bob.public_key(), &[vec![1u8; 20_000]], 0).unwrap();
        let mut values: Vec<Vec<u8>> = records.iter().map(|r| r.value.clone()).collect();
        values.pop();
        assert!(open_deposit(&bob, &alice.node_id().0, &values).is_err());
    }

    #[test]
    fn poll_days_couvre_toute_la_fenetre_de_vie_d_un_depot() {
        assert_eq!(poll_days(86_400_000 * 9 + 12), [9, 8, 7, 6, 5, 4, 3, 2]);
        assert_eq!(poll_days(0), [0; 8]);
        assert_eq!(
            u64::from(DEPOSIT_EXPIRY_S) / 86_400 + 1,
            POLL_WINDOW_DAYS as u64
        );
    }
}
