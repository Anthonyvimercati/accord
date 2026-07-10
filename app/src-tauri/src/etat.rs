//! État partagé de l'hôte : répertoire de profil et nœud en cours d'exécution.

use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use accord_node::{Paths, RunningNode};
use serde::Serialize;

/// Statut du coffre d'identité, tel qu'attendu par `bridge.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum StatutCoffre {
    /// Aucune identité sur disque : l'UI propose création ou restauration.
    #[serde(rename = "absent")]
    Absent,
    /// Un coffre existe : l'UI demande la phrase de passe.
    #[serde(rename = "locked")]
    Verrouille,
}

/// Session de l'API locale à transmettre à l'UI (contrat `SessionInfo`).
#[derive(Debug, Serialize)]
pub struct InfoSession {
    /// Port TCP de l'API WebSocket locale.
    pub port: u16,
    /// Jeton d'authentification de l'API.
    pub token: String,
}

/// Résultat de la création d'identité (contrat `CreatedIdentity`).
#[derive(Debug, Serialize)]
pub struct IdentiteCreee {
    /// Session du nœud fraîchement démarré.
    pub session: InfoSession,
    /// Phrase de récupération de 12 mots — affichée une seule fois.
    pub recovery_phrase: String,
}

/// Statut du coffre pour un profil donné (logique pure, testable sans Tauri).
pub fn statut_du_coffre(chemins: &Paths) -> StatutCoffre {
    if chemins.has_identity() {
        StatutCoffre::Verrouille
    } else {
        StatutCoffre::Absent
    }
}

/// État partagé géré par Tauri : profil sur disque et nœud courant.
pub struct EtatHote {
    /// Répertoire du profil (coffre d'identité + base chiffrée).
    profil: PathBuf,
    /// Nœud en cours d'exécution, s'il y en a un.
    noeud: Mutex<Option<RunningNode>>,
}

impl EtatHote {
    /// Construit l'état pour un répertoire de profil.
    pub fn new(profil: PathBuf) -> Self {
        Self {
            profil,
            noeud: Mutex::new(None),
        }
    }

    /// Chemins du profil (coffre + base).
    pub fn chemins(&self) -> Paths {
        Paths::new(&self.profil)
    }

    /// Statut actuel du coffre d'identité.
    pub fn statut_coffre(&self) -> StatutCoffre {
        statut_du_coffre(&self.chemins())
    }

    /// Arrête et libère le nœud courant, s'il existe.
    pub fn arreter_noeud(&self) {
        let pris = self
            .noeud
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(noeud) = pris {
            noeud.shutdown();
        }
    }

    /// Installe un nœud fraîchement démarré et rend sa session pour l'UI.
    /// Si un nœud tournait encore (course improbable), il est arrêté.
    pub fn installer_noeud(&self, noeud: RunningNode) -> InfoSession {
        let info = InfoSession {
            port: noeud.api_addr().port(),
            token: noeud.token.expose().to_owned(),
        };
        let remplace = self
            .noeud
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .replace(noeud);
        if let Some(ancien) = remplace {
            ancien.shutdown();
        }
        info
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Difficulté PoW réduite pour des tests rapides.
    const POW_TEST: u32 = 1;

    #[test]
    fn statut_absent_sans_coffre_puis_verrouille_apres_creation() {
        let dossier = tempfile::tempdir().unwrap();
        let chemins = Paths::new(dossier.path());
        assert_eq!(statut_du_coffre(&chemins), StatutCoffre::Absent);

        accord_node::identity::create(&chemins, "phrase-de-passe", POW_TEST).unwrap();
        assert_eq!(statut_du_coffre(&chemins), StatutCoffre::Verrouille);
    }

    #[test]
    fn statut_coffre_serialise_selon_le_contrat_du_pont() {
        // `bridge.ts` attend exactement 'absent' | 'locked'.
        assert_eq!(
            serde_json::to_value(StatutCoffre::Absent).unwrap(),
            serde_json::json!("absent")
        );
        assert_eq!(
            serde_json::to_value(StatutCoffre::Verrouille).unwrap(),
            serde_json::json!("locked")
        );
    }

    #[test]
    fn lock_without_running_node_is_idempotent_and_keeps_vault_locked() {
        // The `lock` command boils down to `arreter_noeud` + `statut_coffre`:
        // with no node running it must be a harmless no-op, and the vault on
        // disk must still report `locked` so the UI lands on the unlock
        // screen exactly like a fresh launch.
        let dossier = tempfile::tempdir().unwrap();
        accord_node::identity::create(&Paths::new(dossier.path()), "phrase-de-passe", POW_TEST)
            .unwrap();
        let etat = EtatHote::new(dossier.path().to_path_buf());

        etat.arreter_noeud();
        etat.arreter_noeud();

        assert_eq!(etat.statut_coffre(), StatutCoffre::Verrouille);
    }

    #[test]
    fn identite_creee_serialise_selon_le_contrat_du_pont() {
        // `bridge.ts` attend { session: { port, token }, recovery_phrase }.
        let cree = IdentiteCreee {
            session: InfoSession {
                port: 4242,
                token: "jeton".into(),
            },
            recovery_phrase: "douze mots".into(),
        };
        let json = serde_json::to_value(&cree).unwrap();
        assert_eq!(json["session"]["port"], 4242);
        assert_eq!(json["session"]["token"], "jeton");
        assert_eq!(json["recovery_phrase"], "douze mots");
    }
}
