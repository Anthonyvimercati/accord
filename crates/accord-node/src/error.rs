//! Erreurs typées de l'assemblage du nœud.

/// Erreur du nœud (assemblage, cycle de vie, E/S locales).
#[derive(Debug, thiserror::Error)]
pub enum NodeError {
    /// Erreur de la logique applicative.
    #[error("cœur : {0}")]
    Core(#[from] accord_core::CoreError),
    /// Erreur cryptographique (coffre, identité).
    #[error("cryptographie : {0}")]
    Crypto(#[from] accord_crypto::CryptoError),
    /// Erreur de transport réseau.
    #[error("transport : {0}")]
    Transport(#[from] accord_transport::TransportError),
    /// Erreur d'entrées/sorties locales.
    #[error("e/s : {0}")]
    Io(#[from] std::io::Error),
    /// Aucune identité déverrouillée.
    #[error("identité verrouillée")]
    Locked,
    /// Une identité existe déjà (création refusée).
    #[error("une identité existe déjà")]
    AlreadyExists,
    /// Entrée invalide reçue par l'API.
    #[error("entrée invalide : {0}")]
    Invalid(&'static str),
    /// Entité introuvable.
    #[error("introuvable : {0}")]
    NotFound(&'static str),
    /// Erreur du matériel audio (périphériques, capture — D-029). Message
    /// transmis tel quel à l'UI, sans donnée sensible.
    #[error("{0}")]
    Audio(String),
    /// Fonctionnalité au contrat figé mais pas encore implémentée (sa vague
    /// de développement fournira le corps).
    #[error("non implémenté : {0}")]
    NonImplemente(&'static str),
}
