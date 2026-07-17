//! Sauvegarde complète d'un profil : export/import d'une archive
//! `.accordbackup` (zip).
//!
//! L'archive contient les fichiers du répertoire de profil TELS QUELS :
//! coffre d'identité scellé (Argon2id), base SQLCipher, blobs. Rien n'est
//! déchiffré ici — la phrase de passe n'entre jamais dans ce module — donc
//! l'archive est exactement aussi protégée que le profil sur disque : sans la
//! phrase de passe, ni l'identité ni la base ne s'ouvrent.
//!
//! Invariants :
//! - **nœud arrêté** : l'appelant garantit qu'aucun nœud n'utilise le profil
//!   pendant l'export (base fermée) — la copie fichier est alors le chemin le
//!   plus sûr, sans page SQLite en vol (l'hôte Tauri arrête le nœud avant
//!   d'appeler ici, voir `backup_export` côté `commandes.rs`) ;
//! - **export atomique** : l'archive est écrite dans un fichier temporaire du
//!   même répertoire puis renommée — aucune archive tronquée n'est jamais
//!   visible au chemin final ;
//! - **import sûr** : chemins absolus et composants `..` rejetés (zip-slip),
//!   destination vide exigée, coffre d'identité exigé dans l'archive (on ne
//!   crée jamais un profil importé indéverrouillable) ; en cas d'échec
//!   partiel, la destination — vide à l'entrée par contrat — est nettoyée
//!   (best-effort) pour ne jamais laisser un demi-profil sur disque.

use std::fs::File;
use std::io::{BufReader, BufWriter, Write};
use std::path::{Component, Path, PathBuf};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::NodeError;
use crate::identity::Paths;

/// Convertit une erreur zip en erreur de nœud (E/S locale).
fn erreur_zip(e: zip::result::ZipError) -> NodeError {
    NodeError::Io(std::io::Error::other(e))
}

/// Exporte le profil `paths` dans l'archive `dest` (créée ou remplacée).
///
/// Copie ATOMIQUE : l'archive est d'abord écrite dans un fichier temporaire
/// frère de `dest` (même système de fichiers), synchronisée sur disque, puis
/// renommée — un échec en cours de route ne laisse jamais d'archive tronquée
/// au chemin final. Exige un coffre d'identité présent : un profil sans coffre
/// n'a rien à sauvegarder (et son import serait refusé de toute façon).
pub fn export_backup(paths: &Paths, dest: &Path) -> Result<(), NodeError> {
    if !paths.has_identity() {
        return Err(NodeError::NotFound("coffre d'identité à sauvegarder"));
    }
    let Some(nom) = dest.file_name() else {
        return Err(NodeError::Invalid("chemin d'archive sans nom de fichier"));
    };
    let mut fichiers = Vec::new();
    let mut repertoires = Vec::new();
    collecter(&paths.root, &paths.root, &mut fichiers, &mut repertoires)?;
    // Ordre déterministe : archives comparables d'un export à l'autre.
    fichiers.sort();
    repertoires.sort();

    if let Some(parent) = dest.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    // Fichier temporaire FRÈRE de la destination : le `rename` final reste sur
    // le même système de fichiers, donc atomique.
    let mut nom_tmp = nom.to_os_string();
    nom_tmp.push(".tmp");
    let tmp = dest.with_file_name(nom_tmp);
    match ecrire_archive(&paths.root, &repertoires, &fichiers, &tmp) {
        Ok(()) => {
            std::fs::rename(&tmp, dest)?;
            Ok(())
        }
        Err(e) => {
            // Jamais de résidu temporaire après un échec (best-effort).
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// Importe l'archive `archive` dans `dest_dir` (créé si absent, VIDE exigé).
///
/// Protection zip-slip : TOUS les noms d'entrée sont validés avant la moindre
/// écriture (une archive malveillante est rejetée en bloc, sans extraction
/// partielle), puis `enclosed_name` re-vérifie chaque entrée à l'extraction
/// (ceinture et bretelles). L'archive doit contenir le coffre d'identité :
/// sans lui, le profil importé serait indéverrouillable et invisible du
/// registre de comptes — refusé, et la destination est nettoyée.
pub fn import_backup(archive: &Path, dest_dir: &Path) -> Result<(), NodeError> {
    if dest_dir.exists() {
        if !dest_dir.is_dir() {
            return Err(NodeError::Invalid(
                "la destination d'import n'est pas un répertoire",
            ));
        }
        if std::fs::read_dir(dest_dir)?.next().is_some() {
            return Err(NodeError::Invalid(
                "répertoire de destination d'import non vide",
            ));
        }
    }
    let mut zip = ZipArchive::new(BufReader::new(File::open(archive)?)).map_err(erreur_zip)?;
    for nom in zip.file_names() {
        if !nom_archive_sur(nom) {
            return Err(NodeError::Invalid(
                "archive de sauvegarde au chemin dangereux (zip-slip)",
            ));
        }
    }
    std::fs::create_dir_all(dest_dir)?;
    let resultat = extraire(&mut zip, dest_dir).and_then(|()| {
        // Une sauvegarde valide contient toujours le coffre (garanti par
        // `export_backup`) : re-vérifié ici avant que l'appelant n'enregistre
        // quoi que ce soit dans le registre de comptes.
        if Paths::new(dest_dir).has_identity() {
            Ok(())
        } else {
            Err(NodeError::Invalid(
                "archive sans coffre d'identité (identity.vault)",
            ))
        }
    });
    if resultat.is_err() {
        // La destination était vide (ou absente) à l'entrée par contrat :
        // tout son contenu vient de cette extraction — nettoyage best-effort.
        let _ = std::fs::remove_dir_all(dest_dir);
    }
    resultat
}

/// Vrai si un nom d'entrée d'archive est sûr : relatif, sans `.` ni `..`,
/// sans racine ni préfixe de lecteur Windows. Fonction pure — testée
/// directement.
fn nom_archive_sur(nom: &str) -> bool {
    if nom.is_empty() || nom.starts_with('/') || nom.starts_with('\\') || nom.contains(':') {
        return false;
    }
    // Les composants vides (séparateur double, `/` final d'un répertoire)
    // sont inoffensifs ; seuls `.` et `..` permettent de sortir du dossier.
    nom.split(['/', '\\']).all(|c| !matches!(c, "." | ".."))
}

/// Collecte récursivement les chemins RELATIFS des fichiers et
/// sous-répertoires du profil. Les répertoires sont listés séparément pour
/// que même les vides survivent au voyage aller-retour.
fn collecter(
    racine: &Path,
    courant: &Path,
    fichiers: &mut Vec<PathBuf>,
    repertoires: &mut Vec<PathBuf>,
) -> Result<(), NodeError> {
    for entree in std::fs::read_dir(courant)? {
        let entree = entree?;
        let chemin = entree.path();
        let genre = entree.file_type()?;
        // Les liens symboliques sont ignorés : un profil n'en contient pas,
        // et les suivre pourrait embarquer des fichiers HORS profil.
        if genre.is_symlink() {
            continue;
        }
        let relatif = chemin
            .strip_prefix(racine)
            .map_err(|_| NodeError::Invalid("chemin hors du répertoire de profil"))?
            .to_path_buf();
        if genre.is_dir() {
            repertoires.push(relatif);
            collecter(racine, &chemin, fichiers, repertoires)?;
        } else {
            fichiers.push(relatif);
        }
    }
    Ok(())
}

/// Écrit l'archive zip sur `sortie` (compression deflate), puis la
/// synchronise sur disque — prérequis du `rename` atomique de l'appelant.
fn ecrire_archive(
    racine: &Path,
    repertoires: &[PathBuf],
    fichiers: &[PathBuf],
    sortie: &Path,
) -> Result<(), NodeError> {
    let fichier = File::create(sortie)?;
    let mut zip = ZipWriter::new(BufWriter::new(fichier));
    let base = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for repertoire in repertoires {
        zip.add_directory(nom_zip(repertoire)?, base)
            .map_err(erreur_zip)?;
    }
    for relatif in fichiers {
        let source = racine.join(relatif);
        zip.start_file(nom_zip(relatif)?, options_de(&source, base)?)
            .map_err(erreur_zip)?;
        let mut lecture = File::open(&source)?;
        std::io::copy(&mut lecture, &mut zip)?;
    }
    let mut tampon = zip.finish().map_err(erreur_zip)?;
    tampon.flush()?;
    tampon.get_ref().sync_all()?;
    Ok(())
}

/// Options d'entrée pour `source` : reporte les permissions Unix — le coffre
/// est en 0600 (voir `identity::write_private`) et doit le rester après
/// import. Sans effet hors Unix.
fn options_de(source: &Path, base: SimpleFileOptions) -> Result<SimpleFileOptions, NodeError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(source)?.permissions().mode();
        Ok(base.unix_permissions(mode))
    }
    #[cfg(not(unix))]
    {
        let _ = source;
        Ok(base)
    }
}

/// Nom d'entrée zip (séparateur `/`) d'un chemin relatif — refuse par
/// construction tout composant non ordinaire (racine, `..`, préfixe).
fn nom_zip(relatif: &Path) -> Result<String, NodeError> {
    let mut morceaux: Vec<&str> = Vec::new();
    for composant in relatif.components() {
        match composant {
            Component::Normal(os) => morceaux.push(os.to_str().ok_or(NodeError::Invalid(
                "nom de fichier non UTF-8 dans le profil",
            ))?),
            _ => return Err(NodeError::Invalid("chemin de profil inattendu")),
        }
    }
    Ok(morceaux.join("/"))
}

/// Extrait toutes les entrées (noms déjà validés) sous `dest_dir`.
fn extraire<R: std::io::Read + std::io::Seek>(
    zip: &mut ZipArchive<R>,
    dest_dir: &Path,
) -> Result<(), NodeError> {
    for index in 0..zip.len() {
        let mut entree = zip.by_index(index).map_err(erreur_zip)?;
        // Ceinture et bretelles : `enclosed_name` refait la vérification
        // zip-slip côté bibliothèque, en plus de `nom_archive_sur`.
        let Some(relatif) = entree.enclosed_name() else {
            return Err(NodeError::Invalid(
                "archive de sauvegarde au chemin dangereux (zip-slip)",
            ));
        };
        let cible = dest_dir.join(relatif);
        if entree.is_dir() {
            std::fs::create_dir_all(&cible)?;
            continue;
        }
        if let Some(parent) = cible.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut sortie = File::create(&cible)?;
        std::io::copy(&mut entree, &mut sortie)?;
        // Reporte les permissions Unix archivées (coffre en 0600).
        #[cfg(unix)]
        if let Some(mode) = entree.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&cible, std::fs::Permissions::from_mode(mode))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Difficulté PoW réduite pour des tests rapides.
    const POW_TEST: u32 = 1;

    /// Prépare un profil plausible : coffre scellé réel, pseudo-base, blob
    /// dans un sous-répertoire et répertoire vide (préservé au roundtrip).
    fn profil_de_test(racine: &Path) -> Paths {
        let paths = Paths::new(racine);
        crate::identity::create(&paths, "phrase-de-passe-test", POW_TEST).unwrap();
        std::fs::write(paths.db(), b"contenu-base-chiffree").unwrap();
        std::fs::create_dir_all(racine.join("blobs/ab")).unwrap();
        std::fs::write(racine.join("blobs/ab/cdef"), b"blob-1").unwrap();
        std::fs::create_dir_all(racine.join("vide")).unwrap();
        paths
    }

    /// Forge une archive contenant exactement les entrées `noms` (contenu
    /// arbitraire) — pour les tests d'archives malveillantes ou invalides.
    fn archive_forgee(chemin: &Path, noms: &[&str]) {
        let mut zip = ZipWriter::new(File::create(chemin).unwrap());
        for nom in noms {
            zip.start_file(*nom, SimpleFileOptions::default()).unwrap();
            zip.write_all(b"contenu").unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn roundtrip_export_puis_import_restitue_le_profil_a_l_identique() {
        // Arrange : un profil complet (coffre réel + base + blob + dossier vide).
        let source = tempfile::tempdir().unwrap();
        let paths = profil_de_test(source.path());
        let sortie = tempfile::tempdir().unwrap();
        let archive = sortie.path().join("compte.accordbackup");

        // Act : export puis import dans une destination neuve.
        export_backup(&paths, &archive).unwrap();
        let dest = sortie.path().join("importe");
        import_backup(&archive, &dest).unwrap();

        // Assert : mêmes contenus, arborescence préservée, profil utilisable.
        let importe = Paths::new(&dest);
        assert_eq!(
            std::fs::read(paths.vault()).unwrap(),
            std::fs::read(importe.vault()).unwrap()
        );
        assert_eq!(
            std::fs::read(paths.db()).unwrap(),
            std::fs::read(importe.db()).unwrap()
        );
        assert_eq!(
            std::fs::read(dest.join("blobs/ab/cdef")).unwrap(),
            b"blob-1"
        );
        assert!(dest.join("vide").is_dir(), "répertoire vide préservé");
        // Le profil importé se déverrouille avec la phrase de passe d'ORIGINE.
        assert!(crate::identity::unlock(&importe, "phrase-de-passe-test").is_ok());
        // Aucun résidu temporaire d'export (écriture atomique).
        assert!(!sortie.path().join("compte.accordbackup.tmp").exists());
    }

    #[cfg(unix)]
    #[test]
    fn import_restaure_les_permissions_privees_du_coffre() {
        use std::os::unix::fs::PermissionsExt;

        let source = tempfile::tempdir().unwrap();
        let paths = profil_de_test(source.path());
        let sortie = tempfile::tempdir().unwrap();
        let archive = sortie.path().join("compte.accordbackup");

        export_backup(&paths, &archive).unwrap();
        let dest = sortie.path().join("importe");
        import_backup(&archive, &dest).unwrap();

        // Le coffre reste privé (0600, voir `identity::write_private`).
        let mode = std::fs::metadata(Paths::new(&dest).vault())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn export_refuse_un_profil_sans_coffre() {
        let vide = tempfile::tempdir().unwrap();
        let archive = vide.path().join("x.accordbackup");

        let erreur = export_backup(&Paths::new(vide.path().join("profil-absent")), &archive);

        assert!(matches!(erreur, Err(NodeError::NotFound(_))));
        assert!(!archive.exists(), "aucune archive vide ne doit apparaître");
    }

    #[test]
    fn import_refuse_une_destination_non_vide_sans_y_toucher() {
        // Arrange : une archive valide et une destination déjà occupée.
        let source = tempfile::tempdir().unwrap();
        let paths = profil_de_test(source.path());
        let sortie = tempfile::tempdir().unwrap();
        let archive = sortie.path().join("compte.accordbackup");
        export_backup(&paths, &archive).unwrap();
        let dest = tempfile::tempdir().unwrap();
        std::fs::write(dest.path().join("deja-la.txt"), b"precieux").unwrap();

        // Act
        let erreur = import_backup(&archive, dest.path());

        // Assert : refus net, et le contenu préexistant est INTACT (le
        // nettoyage d'échec ne s'applique qu'à une destination vide).
        assert!(matches!(erreur, Err(NodeError::Invalid(_))));
        assert_eq!(
            std::fs::read(dest.path().join("deja-la.txt")).unwrap(),
            b"precieux"
        );
    }

    #[test]
    fn import_rejette_une_archive_zip_slip_sans_rien_ecrire() {
        // Arrange : archive forgée dont une entrée tente de sortir du dossier.
        let sortie = tempfile::tempdir().unwrap();
        let archive = sortie.path().join("malveillante.accordbackup");
        archive_forgee(&archive, &["identity.vault", "../evasion.txt"]);
        let dest = sortie.path().join("importe");

        // Act
        let erreur = import_backup(&archive, &dest);

        // Assert : rejet en bloc AVANT toute écriture — rien n'a fui hors de
        // la destination, et la destination n'a même pas été créée.
        assert!(matches!(erreur, Err(NodeError::Invalid(_))));
        assert!(!sortie.path().join("evasion.txt").exists());
        assert!(!dest.exists());
    }

    #[test]
    fn import_refuse_une_archive_sans_coffre_et_nettoie_la_destination() {
        let sortie = tempfile::tempdir().unwrap();
        let archive = sortie.path().join("incomplete.accordbackup");
        archive_forgee(&archive, &["notes.txt"]);
        let dest = sortie.path().join("importe");

        let erreur = import_backup(&archive, &dest);

        assert!(matches!(erreur, Err(NodeError::Invalid(_))));
        assert!(!dest.exists(), "le demi-profil extrait doit être nettoyé");
    }

    #[test]
    fn noms_d_archive_surs_et_dangereux() {
        for sur in ["identity.vault", "blobs/ab/cdef", "blobs/"] {
            assert!(nom_archive_sur(sur), "{sur:?} devrait être accepté");
        }
        for dangereux in [
            "../evasion",
            "/absolu",
            "\\absolu",
            "a/../b",
            "..\\evasion",
            "C:\\windows\\pwn",
            "./cache",
            "..",
            "",
        ] {
            assert!(
                !nom_archive_sur(dangereux),
                "{dangereux:?} devrait être rejeté"
            );
        }
    }
}
