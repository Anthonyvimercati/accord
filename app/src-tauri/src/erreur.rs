//! Erreurs de l'hôte, sérialisées en message lisible pour l'UI.

/// Erreur remontée par les commandes Tauri.
///
/// Sérialisée sous forme de chaîne : `bridge.ts` la reçoit comme message
/// d'erreur de la promesse `invoke` et l'affiche telle quelle.
#[derive(Debug, thiserror::Error)]
pub enum ErreurHote {
    /// Erreur du nœud (coffre, base, réseau, API) — déjà en français.
    #[error("{0}")]
    Noeud(#[from] accord_node::NodeError),
    /// Tâche d'arrière-plan interrompue (jamais attendu en pratique).
    #[error("tâche interrompue : {0}")]
    Tache(String),
}

impl serde::Serialize for ErreurHote {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn erreur_serialisee_en_chaine_lisible() {
        let erreur = ErreurHote::Noeud(accord_node::NodeError::Locked);
        assert_eq!(
            serde_json::to_value(&erreur).unwrap(),
            serde_json::json!("identité verrouillée")
        );
    }
}
