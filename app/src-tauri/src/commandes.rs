//! Commandes Tauri : contrat exact attendu par `app/src/lib/bridge.ts`.
//!
//! Les commandes de cycle de vie (création, restauration, déverrouillage)
//! effectuent un travail CPU lourd (PoW d'identité, Argon2id) : elles sont
//! asynchrones et délèguent ce travail à un fil bloquant pour ne jamais
//! geler le fil principal de la fenêtre.

use accord_node::{identity, NodeConfig, Unlocked};
use tauri::State;

use crate::erreur::ErreurHote;
use crate::etat::{EtatHote, IdentiteCreee, InfoSession, StatutCoffre};

/// Difficulté PoW des identités (SPEC §2.2).
const POW_BITS: u32 = accord_proto::limits::IDENTITY_POW_BITS;

/// Statut du coffre d'identité : `'absent'` ou `'locked'`.
#[tauri::command]
pub fn vault_status(etat: State<'_, EtatHote>) -> StatutCoffre {
    etat.statut_coffre()
}

/// Crée une identité neuve (PoW + scellement), démarre le nœud et rend la
/// session ainsi que la phrase de récupération à faire noter.
#[tauri::command]
pub async fn create_identity(
    etat: State<'_, EtatHote>,
    passphrase: String,
) -> Result<IdentiteCreee, ErreurHote> {
    let chemins = etat.chemins();
    let (deverrouille, phrase) =
        en_arriere_plan(move || identity::create_with_phrase(&chemins, &passphrase, POW_BITS))
            .await?;
    let session = demarrer(&etat, deverrouille).await?;
    Ok(IdentiteCreee {
        session,
        recovery_phrase: (*phrase).clone(),
    })
}

/// Restaure une identité depuis sa phrase de récupération, la scelle sous la
/// nouvelle phrase de passe locale, puis démarre le nœud.
#[tauri::command]
pub async fn restore_identity(
    etat: State<'_, EtatHote>,
    phrase: String,
    passphrase: String,
) -> Result<InfoSession, ErreurHote> {
    let chemins = etat.chemins();
    let deverrouille = en_arriere_plan(move || {
        identity::restore_from_phrase(&chemins, &phrase, &passphrase, POW_BITS)
    })
    .await?;
    demarrer(&etat, deverrouille).await
}

/// Déverrouille le coffre existant puis démarre le nœud.
#[tauri::command]
pub async fn unlock(
    etat: State<'_, EtatHote>,
    passphrase: String,
) -> Result<InfoSession, ErreurHote> {
    let chemins = etat.chemins();
    let deverrouille = en_arriere_plan(move || identity::unlock(&chemins, &passphrase)).await?;
    demarrer(&etat, deverrouille).await
}

/// Locks the vault without quitting the app: the exact inverse of `unlock`.
///
/// Stops the running node (network, API, database) and drops it; the
/// in-memory secrets (`Unlocked` seed, SQLCipher key) are `Zeroizing` and are
/// wiped on that drop. Returns the fresh vault status so the UI lands on the
/// same screen as a cold start (`"locked"`, or `"absent"` if the vault file
/// disappeared meanwhile). Async so the WebView thread never blocks on the
/// node shutdown; infallible in practice but typed as `Result` because async
/// Tauri commands borrowing `State` require it.
#[tauri::command]
pub async fn lock(etat: State<'_, EtatHote>) -> Result<StatutCoffre, ErreurHote> {
    etat.arreter_noeud();
    Ok(etat.statut_coffre())
}

/// Exécute un travail CPU lourd hors du fil principal.
async fn en_arriere_plan<T, F>(travail: F) -> Result<T, ErreurHote>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, accord_node::NodeError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(travail)
        .await
        .map_err(|e| ErreurHote::Tache(e.to_string()))?
        .map_err(ErreurHote::from)
}

/// Arrête l'éventuel nœud courant puis en démarre un neuf sur le profil :
/// API locale sur port éphémère, mais UDP P2P sur port stable (B2) — le port
/// `0` de `p2p_addr` déclenche la stratégie de port stable (port retenu au
/// précédent lancement, sinon 48016 et plage de repli), pour qu'un ami puisse
/// joindre une adresse `ip:port` prévisible.
async fn demarrer(etat: &EtatHote, deverrouille: Unlocked) -> Result<InfoSession, ErreurHote> {
    etat.arreter_noeud();
    // `NodeConfig::default()` fixe déjà `p2p_addr = 0.0.0.0:0`, c'est-à-dire la
    // stratégie de port stable (et non un port réellement aléatoire).
    let config = NodeConfig {
        paths: etat.chemins(),
        ..NodeConfig::default()
    };
    let noeud = accord_node::run(deverrouille, config).await?;
    Ok(etat.installer_noeud(noeud))
}
