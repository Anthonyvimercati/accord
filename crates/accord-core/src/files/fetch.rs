//! Coordination des téléchargements de fichiers : plusieurs transferts
//! simultanés bornés, sondage du manifest, relances et abandons.
//!
//! Machine à états pure (aucune E/S, horloge injectée) pilotée par la boucle
//! réseau : l'appelant lui transmet les messages FILE entrants, exécute les
//! [`Action`] rendues (demandes à émettre), écrit les blocs drainés sur le
//! disque et persiste la bitmap de reprise. Chaque téléchargement passe par
//! deux phases : attente du manifest (sondé auprès de l'indice puis des pairs
//! connus), puis demandes de blocs fenêtrées via [`Transfer`].

use std::collections::BTreeMap;

use accord_proto::file_msg::Manifest;

use crate::error::CoreError;
use crate::files::transfer::{BlockOutcome, Transfer};

/// Téléchargements simultanés maximum.
pub const MAX_FETCHES_ACTIFS: usize = 4;
/// Période de relance du sondage de manifest.
pub const RELANCE_MANIFEST_MS: u64 = 2_000;
/// Sans progression pendant ce délai, les demandes en vol sont libérées
/// (pertes réseau probables) et réassignées.
pub const RELANCE_BLOCS_MS: u64 = 5_000;
/// Sans progression pendant ce délai, le téléchargement est abandonné.
pub const ABANDON_MS: u64 = 30_000;
/// Si AUCUNE demande n'a pu partir depuis ce délai (pair injoignable : ni
/// adresse ni circuit), le téléchargement est abandonné rapidement — la place
/// est libérée sans attendre [`ABANDON_MS`], l'intention persistée sera
/// ré-adoptée après backoff ([`relance_apres_abandon_ms`]).
pub const ABANDON_SANS_EMISSION_MS: u64 = 8_000;
/// Sources sondées ou actives au plus par téléchargement.
pub const MAX_SOURCES: usize = 8;
/// Échelle de ré-adoption d'une intention après abandon : 1, 2, 5 puis
/// 15 minutes.
pub const RELANCES_ABANDON_MS: [u64; 4] = [60_000, 120_000, 300_000, 900_000];
/// Une fois l'échelle épuisée, relance toutes les 30 minutes (indéfiniment :
/// l'intention n'est soldée qu'à la complétion ou sur annulation explicite).
pub const RELANCE_ABANDON_PLATEAU_MS: u64 = 1_800_000;
/// Index sentinelle d'un `NotFound` répondant à `GetManifest` (les index de
/// blocs réels, données et parité, sont très en deçà : ≤ 8192 + parité).
pub const INDEX_MANIFESTE: u32 = u32::MAX;

/// Délai avant la prochaine ré-adoption d'une intention après son
/// `tentatives`-ième abandon (1-indexé) : suit [`RELANCES_ABANDON_MS`] puis
/// plafonne à [`RELANCE_ABANDON_PLATEAU_MS`]. Pure, testable.
pub fn relance_apres_abandon_ms(tentatives: u32) -> u64 {
    RELANCES_ABANDON_MS
        .get((tentatives.max(1) - 1) as usize)
        .copied()
        .unwrap_or(RELANCE_ABANDON_PLATEAU_MS)
}
/// Granularité d'émission de la progression : 1/20 = tous les 5 %.
const PAS_EMISSION: usize = 20;

/// Demande à émettre vers un pair.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Demander le manifest d'un fichier.
    GetManifest {
        /// Pair sondé.
        to: [u8; 32],
        /// Racine Merkle du fichier.
        root: [u8; 32],
    },
    /// Demander un bloc (données ou parité).
    GetBlock {
        /// Source assignée.
        to: [u8; 32],
        /// Racine Merkle du fichier.
        root: [u8; 32],
        /// Index du bloc.
        index: u32,
    },
}

/// Progression d'un téléchargement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    /// Blocs de données détenus.
    pub done: usize,
    /// Blocs de données totaux (0 tant que le manifest est inconnu).
    pub total: usize,
    /// Tous les blocs sont détenus et vérifiés.
    pub complete: bool,
}

/// Phase d'un téléchargement.
#[derive(Debug)]
enum Phase {
    /// Manifest inconnu : sondage périodique des sources candidates.
    Manifeste,
    /// Manifest vérifié : demandes de blocs fenêtrées (boxé : le transfert
    /// porte le manifest complet, bien plus grand que l'autre variante).
    Blocs(Box<Transfer>),
}

/// État d'un téléchargement coordonné.
#[derive(Debug)]
struct Fetch {
    /// Pair source probable (expéditeur du message portant la référence).
    hint: Option<[u8; 32]>,
    /// Sources signalées (`Have`) avant l'arrivée du manifest.
    candidats: Vec<[u8; 32]>,
    /// Pairs ayant répondu `NotFound` au sondage de manifest.
    refus_manifeste: Vec<[u8; 32]>,
    phase: Phase,
    /// Dernière progression réelle (bloc accepté, manifest attaché).
    dernier_progres_ms: u64,
    /// Dernière relance (sondage de manifest ou libération des fenêtres).
    derniere_relance_ms: u64,
    /// Dernier pas de progression émis (granularité [`PAS_EMISSION`]).
    dernier_pas_emis: usize,
    /// Première passe dont AUCUNE demande n'a pu partir (pair injoignable),
    /// réarmée dès qu'une émission réussit. Déclenche l'abandon rapide
    /// ([`ABANDON_SANS_EMISSION_MS`]).
    echec_emission_ms: Option<u64>,
}

/// Coordinateur des téléchargements actifs.
#[derive(Debug, Default)]
pub struct Coordinator {
    fetches: BTreeMap<[u8; 32], Fetch>,
}

impl Coordinator {
    /// Coordinateur vide.
    pub fn new() -> Self {
        Self::default()
    }

    /// Vrai si un téléchargement est en cours pour cette racine.
    pub fn est_actif(&self, root: &[u8; 32]) -> bool {
        self.fetches.contains_key(root)
    }

    /// Nombre de téléchargements en cours.
    pub fn actifs(&self) -> usize {
        self.fetches.len()
    }

    /// Démarre un téléchargement. Rend `false` s'il est déjà en cours ou si
    /// la borne [`MAX_FETCHES_ACTIFS`] est atteinte (l'intention persistée
    /// sera reprise plus tard).
    pub fn begin(&mut self, root: [u8; 32], hint: Option<[u8; 32]>, now_ms: u64) -> bool {
        if self.fetches.contains_key(&root) || self.fetches.len() >= MAX_FETCHES_ACTIFS {
            return false;
        }
        self.fetches.insert(
            root,
            Fetch {
                hint,
                candidats: Vec::new(),
                refus_manifeste: Vec::new(),
                phase: Phase::Manifeste,
                dernier_progres_ms: now_ms,
                derniere_relance_ms: 0,
                dernier_pas_emis: 0,
                echec_emission_ms: None,
            },
        );
        true
    }

    /// Signale l'issue des émissions d'une passe pour une racine : `envoyees`
    /// demandes réellement parties sur `tentees`. Si aucune n'a pu partir
    /// (pair sans adresse ni circuit), le téléchargement sera abandonné
    /// rapidement ([`ABANDON_SANS_EMISSION_MS`]) au lieu d'attendre
    /// [`ABANDON_MS`] pour des réponses qui ne viendront jamais ; la première
    /// émission réussie réarme ce suivi.
    pub fn note_emission(&mut self, root: &[u8; 32], envoyees: usize, tentees: usize, now_ms: u64) {
        let Some(f) = self.fetches.get_mut(root) else {
            return;
        };
        if envoyees > 0 {
            f.echec_emission_ms = None;
        } else if tentees > 0 && f.echec_emission_ms.is_none() {
            f.echec_emission_ms = Some(now_ms);
        }
    }

    /// Attache un manifest vérifié à un téléchargement en attente (reçu d'un
    /// pair ou relu de la base pour une reprise). `bitmap` : blocs déjà sur
    /// disque ; une bitmap inutilisable est ignorée (reprise à zéro). Rend
    /// `true` si le manifest vient d'être attaché, `false` si la racine est
    /// inconnue ou déjà en phase blocs ; `Err` si le manifest est invalide.
    pub fn attach_manifest(
        &mut self,
        manifest: Manifest,
        bitmap: Option<&[u8]>,
        from: Option<[u8; 32]>,
        now_ms: u64,
    ) -> Result<bool, CoreError> {
        let root = manifest.merkle_root;
        let Some(f) = self.fetches.get_mut(&root) else {
            return Ok(false);
        };
        if matches!(f.phase, Phase::Blocs(_)) {
            return Ok(false);
        }
        let mut transfer = match bitmap {
            Some(b) => {
                Transfer::resume(manifest.clone(), b).or_else(|_| Transfer::new(manifest))?
            }
            None => Transfer::new(manifest)?,
        };
        for src in f.hint.iter().chain(f.candidats.iter()).chain(from.iter()) {
            transfer.add_source(*src);
        }
        f.phase = Phase::Blocs(Box::new(transfer));
        f.dernier_progres_ms = now_ms;
        Ok(true)
    }

    /// Manifest d'un téléchargement en phase blocs.
    pub fn manifest(&self, root: &[u8; 32]) -> Option<&Manifest> {
        match &self.fetches.get(root)?.phase {
            Phase::Blocs(t) => Some(t.manifest()),
            Phase::Manifeste => None,
        }
    }

    /// Déclare une source pour un téléchargement (réponse `Have`, indice).
    pub fn add_source(&mut self, root: &[u8; 32], source: [u8; 32]) {
        let Some(f) = self.fetches.get_mut(root) else {
            return;
        };
        match &mut f.phase {
            Phase::Blocs(t) => t.add_source(source),
            Phase::Manifeste => {
                if !f.candidats.contains(&source) && f.candidats.len() < MAX_SOURCES {
                    f.candidats.push(source);
                }
            }
        }
    }

    /// Réception d'un bloc. Rend son issue, ou `None` si la racine n'est pas
    /// en phase blocs. Les blocs vérifiés restent en file interne jusqu'au
    /// drainage ([`Coordinator::drain`]) — appeler [`Coordinator::try_repair`]
    /// avant de drainer pour que la réparation voie les blocs en file.
    pub fn on_block(
        &mut self,
        from: &[u8; 32],
        root: &[u8; 32],
        index: u32,
        data: Vec<u8>,
        now_ms: u64,
    ) -> Option<BlockOutcome> {
        let f = self.fetches.get_mut(root)?;
        let Phase::Blocs(t) = &mut f.phase else {
            return None;
        };
        let outcome = t.on_block(from, index, data);
        if matches!(outcome, BlockOutcome::Verified | BlockOutcome::ParityStored) {
            f.dernier_progres_ms = now_ms;
        }
        Some(outcome)
    }

    /// Un pair ne détient pas ce qu'on lui demandait : bloc (réassigné à une
    /// autre source) ou manifest ([`INDEX_MANIFESTE`], pair écarté du sondage).
    pub fn on_not_found(&mut self, from: &[u8; 32], root: &[u8; 32], index: u32) {
        let Some(f) = self.fetches.get_mut(root) else {
            return;
        };
        match &mut f.phase {
            Phase::Manifeste if index == INDEX_MANIFESTE => {
                if !f.refus_manifeste.contains(from) {
                    f.refus_manifeste.push(*from);
                }
            }
            Phase::Blocs(t) => t.on_not_found(from, index),
            Phase::Manifeste => {}
        }
    }

    /// Tente la réparation Reed-Solomon avec la parité reçue ; `disk_block`
    /// relit les blocs déjà drainés sur disque. Les blocs réparés rejoignent
    /// la file interne (drainés ensuite comme les autres).
    pub fn try_repair(
        &mut self,
        root: &[u8; 32],
        disk_block: impl FnMut(u32) -> Option<Vec<u8>>,
    ) -> Result<Vec<u32>, CoreError> {
        match self.fetches.get_mut(root).map(|f| &mut f.phase) {
            Some(Phase::Blocs(t)) => t.try_repair(disk_block),
            _ => Ok(Vec::new()),
        }
    }

    /// Draine les blocs vérifiés en attente d'écriture disque.
    pub fn drain(&mut self, root: &[u8; 32]) -> Vec<(u32, Vec<u8>)> {
        let Some(f) = self.fetches.get_mut(root) else {
            return Vec::new();
        };
        let Phase::Blocs(t) = &mut f.phase else {
            return Vec::new();
        };
        t.pending_blocks()
            .into_iter()
            .filter_map(|i| t.take_block(i).map(|d| (i, d)))
            .collect()
    }

    /// Progression courante (`total` nul tant que le manifest est inconnu).
    pub fn progress(&self, root: &[u8; 32]) -> Option<Progress> {
        Some(match &self.fetches.get(root)?.phase {
            Phase::Manifeste => Progress {
                done: 0,
                total: 0,
                complete: false,
            },
            Phase::Blocs(t) => {
                let (done, total) = t.progress();
                Progress {
                    done,
                    total,
                    complete: t.is_complete(),
                }
            }
        })
    }

    /// Bitmap de reprise courante (phase blocs uniquement).
    pub fn bitmap(&self, root: &[u8; 32]) -> Option<Vec<u8>> {
        match &self.fetches.get(root)?.phase {
            Phase::Blocs(t) => Some(t.bitmap()),
            Phase::Manifeste => None,
        }
    }

    /// Progression à émettre vers l'UI si le pas de 5 % a changé (ou si le
    /// téléchargement vient de se terminer), `None` sinon.
    pub fn should_emit(&mut self, root: &[u8; 32]) -> Option<Progress> {
        let progress = self.progress(root)?;
        let f = self.fetches.get_mut(root)?;
        if progress.total == 0 {
            return None;
        }
        let pas = progress.done * PAS_EMISSION / progress.total;
        if progress.complete || pas > f.dernier_pas_emis {
            f.dernier_pas_emis = pas;
            return Some(progress);
        }
        None
    }

    /// Demandes de blocs immédiatement assignables pour une racine (après
    /// réception d'un manifest, d'un bloc, d'un refus ou d'un `Have`).
    pub fn requests_for(&mut self, root: &[u8; 32]) -> Vec<Action> {
        let Some(f) = self.fetches.get_mut(root) else {
            return Vec::new();
        };
        let Phase::Blocs(t) = &mut f.phase else {
            return Vec::new();
        };
        t.next_requests()
            .into_iter()
            .map(|(to, index)| Action::GetBlock {
                to,
                root: *root,
                index,
            })
            .collect()
    }

    /// Termine (ou abandonne) un téléchargement : l'état interne est jeté.
    pub fn finish(&mut self, root: &[u8; 32]) {
        self.fetches.remove(root);
    }

    /// Passe périodique : sondage des manifests, relances après pertes,
    /// demandes de blocs et abandons. `pairs_connus` : pairs joignables
    /// candidats au sondage. Rend les demandes à émettre et les
    /// téléchargements abandonnés (retirés) avec leur progression finale.
    pub fn tick(
        &mut self,
        now_ms: u64,
        pairs_connus: &[[u8; 32]],
    ) -> (Vec<Action>, Vec<([u8; 32], Progress)>) {
        let mut actions = Vec::new();
        let mut abandons = Vec::new();
        for (root, f) in &mut self.fetches {
            // Abandon rapide : les émissions échouent toutes (pair
            // injoignable), inutile d'occuper une place pendant tout le
            // délai d'abandon — l'intention persistée réessaiera.
            let sans_emission = f
                .echec_emission_ms
                .is_some_and(|t| now_ms.saturating_sub(t) >= ABANDON_SANS_EMISSION_MS);
            if sans_emission || now_ms.saturating_sub(f.dernier_progres_ms) >= ABANDON_MS {
                abandons.push(*root);
                continue;
            }
            match &mut f.phase {
                Phase::Manifeste => {
                    if f.derniere_relance_ms != 0
                        && now_ms.saturating_sub(f.derniere_relance_ms) < RELANCE_MANIFEST_MS
                    {
                        continue;
                    }
                    f.derniere_relance_ms = now_ms;
                    let mut cibles: Vec<[u8; 32]> = Vec::new();
                    for p in f
                        .hint
                        .iter()
                        .chain(f.candidats.iter())
                        .chain(pairs_connus.iter())
                    {
                        if cibles.len() >= MAX_SOURCES {
                            break;
                        }
                        if !cibles.contains(p) && !f.refus_manifeste.contains(p) {
                            cibles.push(*p);
                        }
                    }
                    actions.extend(
                        cibles
                            .into_iter()
                            .map(|to| Action::GetManifest { to, root: *root }),
                    );
                }
                Phase::Blocs(t) => {
                    // Sans source (reprise à froid) : rattache l'indice et
                    // les candidats connus.
                    if t.source_count() == 0 {
                        for p in f.hint.iter().chain(f.candidats.iter()) {
                            t.add_source(*p);
                        }
                    }
                    let repere = f.dernier_progres_ms.max(f.derniere_relance_ms);
                    if now_ms.saturating_sub(repere) >= RELANCE_BLOCS_MS {
                        f.derniere_relance_ms = now_ms;
                        t.release_in_flight();
                        for p in pairs_connus.iter().take(MAX_SOURCES) {
                            t.add_source(*p);
                        }
                    }
                    actions.extend(t.next_requests().into_iter().map(|(to, index)| {
                        Action::GetBlock {
                            to,
                            root: *root,
                            index,
                        }
                    }));
                }
            }
        }
        let mut sortants = Vec::with_capacity(abandons.len());
        for root in abandons {
            let progress = self.progress(&root).unwrap_or(Progress {
                done: 0,
                total: 0,
                complete: false,
            });
            self.fetches.remove(&root);
            sortants.push((root, progress));
        }
        (actions, sortants)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::merkle;
    use accord_crypto::Identity;
    use accord_proto::limits::FILE_BLOCK_SIZE;

    fn fixture(blocks: usize, tail: usize) -> (Manifest, Vec<Vec<u8>>) {
        let publisher = Identity::generate_with_pow_bits(1);
        let mut data = Vec::new();
        for i in 0..blocks {
            let len = if i + 1 == blocks {
                tail
            } else {
                FILE_BLOCK_SIZE
            };
            data.extend(std::iter::repeat_n((i + 1) as u8, len));
        }
        let manifest = merkle::build_manifest(&publisher, &data, "f.bin", "app/bin").unwrap();
        let chunks = data.chunks(FILE_BLOCK_SIZE).map(<[u8]>::to_vec).collect();
        (manifest, chunks)
    }

    const HINT: [u8; 32] = [9u8; 32];

    #[test]
    fn begin_is_bounded_and_rejects_duplicates() {
        let mut c = Coordinator::new();
        assert!(c.begin([1; 32], None, 0));
        assert!(!c.begin([1; 32], None, 0), "doublon accepté");
        for i in 2..=MAX_FETCHES_ACTIFS as u8 {
            assert!(c.begin([i; 32], None, 0));
        }
        assert!(!c.begin([99; 32], None, 0), "borne dépassée");
        assert_eq!(c.actifs(), MAX_FETCHES_ACTIFS);
        c.finish(&[1; 32]);
        assert!(c.begin([99; 32], None, 0));
    }

    #[test]
    fn manifest_probing_targets_hint_then_backs_off_and_retries() {
        let (manifest, _) = fixture(1, 100);
        let root = manifest.merkle_root;
        let mut c = Coordinator::new();
        c.begin(root, Some(HINT), 1_000);
        let pairs = [[7u8; 32]];
        let (actions, _) = c.tick(1_000, &pairs);
        assert_eq!(
            actions,
            vec![
                Action::GetManifest { to: HINT, root },
                Action::GetManifest {
                    to: [7u8; 32],
                    root
                },
            ]
        );
        // Pas de re-sondage avant la période de relance.
        assert!(c.tick(1_100, &pairs).0.is_empty());
        // Après un refus, le pair est écarté du sondage suivant.
        c.on_not_found(&[7u8; 32], &root, INDEX_MANIFESTE);
        let (again, _) = c.tick(1_000 + RELANCE_MANIFEST_MS, &pairs);
        assert_eq!(again, vec![Action::GetManifest { to: HINT, root }]);
    }

    #[test]
    fn full_flow_manifest_blocks_progress_and_completion() {
        let (manifest, blocks) = fixture(2, 300);
        let root = manifest.merkle_root;
        let mut c = Coordinator::new();
        c.begin(root, Some(HINT), 0);
        assert_eq!(
            c.progress(&root),
            Some(Progress {
                done: 0,
                total: 0,
                complete: false
            })
        );
        assert!(c
            .attach_manifest(manifest.clone(), None, Some([7u8; 32]), 10)
            .unwrap());
        // Ré-attachement : sans effet.
        assert!(!c.attach_manifest(manifest, None, None, 10).unwrap());
        // Les demandes couvrent les deux blocs (indice + répondeur comme sources).
        let reqs = c.requests_for(&root);
        let index_demandes: Vec<u32> = reqs
            .iter()
            .filter_map(|a| match a {
                Action::GetBlock { index, .. } => Some(*index),
                Action::GetManifest { .. } => None,
            })
            .collect();
        assert_eq!(index_demandes.len(), 2);
        // Bloc 0 accepté : progression émise (pas de 5 % franchi).
        assert_eq!(
            c.on_block(&HINT, &root, 0, blocks[0].clone(), 20),
            Some(BlockOutcome::Verified)
        );
        assert_eq!(
            c.should_emit(&root),
            Some(Progress {
                done: 1,
                total: 2,
                complete: false
            })
        );
        assert_eq!(c.should_emit(&root), None, "double émission du même pas");
        assert_eq!(c.drain(&root), vec![(0, blocks[0].clone())]);
        // Bloc corrompu rejeté, puis bloc final : complet.
        assert_eq!(
            c.on_block(&HINT, &root, 1, vec![0xFF; 300], 30),
            Some(BlockOutcome::Rejected)
        );
        assert_eq!(
            c.on_block(&HINT, &root, 1, blocks[1].clone(), 40),
            Some(BlockOutcome::Verified)
        );
        let fin = c.should_emit(&root).unwrap();
        assert!(fin.complete);
        assert_eq!((fin.done, fin.total), (2, 2));
        assert_eq!(c.bitmap(&root), Some(vec![0b11]));
        c.finish(&root);
        assert!(!c.est_actif(&root));
    }

    #[test]
    fn resume_bitmap_skips_held_blocks_and_bad_bitmap_restarts() {
        let (manifest, _) = fixture(2, 300);
        let root = manifest.merkle_root;
        let mut c = Coordinator::new();
        c.begin(root, Some(HINT), 0);
        // Bitmap valide : le bloc 0 n'est pas redemandé.
        assert!(c
            .attach_manifest(manifest.clone(), Some(&[0b01]), None, 0)
            .unwrap());
        let index: Vec<u32> = c
            .requests_for(&root)
            .iter()
            .filter_map(|a| match a {
                Action::GetBlock { index, .. } => Some(*index),
                Action::GetManifest { .. } => None,
            })
            .collect();
        assert_eq!(index, vec![1]);
        // Bitmap de taille invalide : reprise à zéro plutôt qu'échec.
        let mut c2 = Coordinator::new();
        c2.begin(root, Some(HINT), 0);
        assert!(c2
            .attach_manifest(manifest, Some(&[0b01, 0xFF, 0xFF]), None, 0)
            .unwrap());
        assert_eq!(
            c2.progress(&root),
            Some(Progress {
                done: 0,
                total: 2,
                complete: false
            })
        );
    }

    #[test]
    fn have_before_manifest_registers_candidate_source() {
        let (manifest, blocks) = fixture(1, 300);
        let root = manifest.merkle_root;
        let autre = [5u8; 32];
        let mut c = Coordinator::new();
        c.begin(root, None, 0);
        c.add_source(&root, autre);
        // Le candidat est sondé pour le manifest…
        let (actions, _) = c.tick(0, &[]);
        assert_eq!(actions, vec![Action::GetManifest { to: autre, root }]);
        // … puis devient source de blocs à l'attachement.
        assert!(c.attach_manifest(manifest, None, None, 0).unwrap());
        assert_eq!(
            c.requests_for(&root),
            vec![Action::GetBlock {
                to: autre,
                root,
                index: 0
            }]
        );
        assert_eq!(
            c.on_block(&autre, &root, 0, blocks[0].clone(), 10),
            Some(BlockOutcome::Verified)
        );
    }

    #[test]
    fn stalled_transfer_releases_window_and_reassigns() {
        let (manifest, _) = fixture(1, 300);
        let root = manifest.merkle_root;
        let mut c = Coordinator::new();
        c.begin(root, Some(HINT), 0);
        assert!(c.attach_manifest(manifest, None, None, 0).unwrap());
        assert_eq!(c.requests_for(&root).len(), 1);
        // La demande se perd : rien avant le délai de relance…
        let (rien, _) = c.tick(RELANCE_BLOCS_MS - 1, &[]);
        assert!(rien.is_empty());
        // … puis la fenêtre est libérée et le bloc redemandé.
        let (relance, _) = c.tick(RELANCE_BLOCS_MS, &[]);
        assert_eq!(
            relance,
            vec![Action::GetBlock {
                to: HINT,
                root,
                index: 0
            }]
        );
    }

    #[test]
    fn abandon_after_timeout_reports_final_progress() {
        let (manifest, blocks) = fixture(2, 300);
        let root = manifest.merkle_root;
        let mut c = Coordinator::new();
        c.begin(root, Some(HINT), 0);
        assert!(c.attach_manifest(manifest, None, None, 0).unwrap());
        c.requests_for(&root);
        c.on_block(&HINT, &root, 0, blocks[0].clone(), 10);
        let (_, abandons) = c.tick(10 + ABANDON_MS, &[]);
        assert_eq!(
            abandons,
            vec![(
                root,
                Progress {
                    done: 1,
                    total: 2,
                    complete: false
                }
            )]
        );
        assert!(!c.est_actif(&root));
    }

    #[test]
    fn echec_total_des_emissions_abandonne_rapidement() {
        let mut c = Coordinator::new();
        let root = [1u8; 32];
        c.begin(root, Some(HINT), 0);
        let (actions, _) = c.tick(0, &[]);
        assert!(!actions.is_empty(), "sondage du manifest attendu");
        // Aucune demande n'a pu partir (pair sans adresse ni circuit).
        c.note_emission(&root, 0, actions.len(), 0);
        // Avant le délai court : toujours actif.
        let (_, abandons) = c.tick(ABANDON_SANS_EMISSION_MS - 1, &[]);
        assert!(abandons.is_empty());
        // Après : abandonné bien avant ABANDON_MS (place libérée).
        let (_, abandons) = c.tick(ABANDON_SANS_EMISSION_MS, &[]);
        assert_eq!(abandons.len(), 1);
        assert!(!c.est_actif(&root));
    }

    #[test]
    fn emission_reussie_rearme_l_abandon_rapide() {
        let mut c = Coordinator::new();
        let root = [1u8; 32];
        c.begin(root, Some(HINT), 0);
        c.note_emission(&root, 0, 1, 0);
        // Une émission finit par partir : le suivi d'échec est réarmé…
        c.note_emission(&root, 1, 1, 4_000);
        let (_, abandons) = c.tick(ABANDON_SANS_EMISSION_MS, &[]);
        assert!(abandons.is_empty(), "abandon rapide malgré une émission");
        // … et seul le délai d'abandon complet s'applique ensuite.
        let (_, abandons) = c.tick(ABANDON_MS, &[]);
        assert_eq!(abandons.len(), 1);
    }

    #[test]
    fn bareme_de_relance_apres_abandon() {
        assert_eq!(relance_apres_abandon_ms(0), 60_000, "dégénéré : minimum");
        assert_eq!(relance_apres_abandon_ms(1), 60_000);
        assert_eq!(relance_apres_abandon_ms(2), 120_000);
        assert_eq!(relance_apres_abandon_ms(3), 300_000);
        assert_eq!(relance_apres_abandon_ms(4), 900_000);
        assert_eq!(relance_apres_abandon_ms(5), RELANCE_ABANDON_PLATEAU_MS);
        assert_eq!(
            relance_apres_abandon_ms(u32::MAX),
            RELANCE_ABANDON_PLATEAU_MS
        );
    }

    #[test]
    fn repair_after_refusal_uses_parity_and_drains_repaired_block() {
        use crate::files::fec;
        let (manifest, blocks) = fixture(3, 400);
        let refs: Vec<&[u8]> = blocks.iter().map(Vec::as_slice).collect();
        let parity = fec::parity_for_group(&refs).unwrap();
        let root = manifest.merkle_root;
        let mut c = Coordinator::new();
        c.begin(root, Some(HINT), 0);
        assert!(c.attach_manifest(manifest, None, None, 0).unwrap());
        c.requests_for(&root);
        c.on_block(&HINT, &root, 0, blocks[0].clone(), 1);
        c.on_block(&HINT, &root, 2, blocks[2].clone(), 2);
        c.on_not_found(&HINT, &root, 1);
        // Le refus déclenche la demande de parité.
        let parite: Vec<u32> = c
            .requests_for(&root)
            .iter()
            .filter_map(|a| match a {
                Action::GetBlock { index, .. } => Some(*index),
                Action::GetManifest { .. } => None,
            })
            .collect();
        assert!(parite.contains(&3));
        assert_eq!(
            c.on_block(&HINT, &root, 3, parity[0].clone(), 3),
            Some(BlockOutcome::ParityStored)
        );
        // Réparation avant drainage : les blocs en file suffisent.
        assert_eq!(c.try_repair(&root, |_| None).unwrap(), vec![1]);
        let drained = c.drain(&root);
        assert_eq!(drained.len(), 3);
        assert!(c.progress(&root).unwrap().complete);
    }
}
