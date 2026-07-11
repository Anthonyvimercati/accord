//! Icône de barre des menus/systray.
//!
//! Pas de tray créée automatiquement au démarrage de l'hôte : la préférence
//! « Garder Accord dans la barre des menus/systray » vit côté UI
//! (`localStorage`, voir `stores/ui.ts`), donc seule la webview la connaît au
//! lancement. C'est elle qui appelle [`tray_set_enabled`] une fois montée
//! (valeur persistée) puis à chaque bascule de l'interrupteur — l'icône
//! apparaît/disparaît en direct, jamais de redémarrage requis. Évite aussi un
//! icône qui clignote au lancement le temps que la préférence soit lue quand
//! elle est désactivée.
//!
//! L'icône elle-même est enregistrée par Tauri sous [`TRAY_ID`] : la création
//! et la suppression passent par `AppHandle::tray_by_id`/`remove_tray_by_id`
//! (état interne à Tauri), pas par un `Mutex` maison — `tray_set_enabled` est
//! ainsi idempotent sans état supplémentaire à synchroniser.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::erreur::ErreurHote;

/// Identifiant stable de l'icône de tray (recherche/suppression ultérieure).
const TRAY_ID: &str = "accord-tray";
const MENU_ID_OUVRIR: &str = "accord-tray-ouvrir";
const MENU_ID_QUITTER: &str = "accord-tray-quitter";

/// Affiche et donne le focus à la fenêtre principale (« Ouvrir Accord »),
/// en la sortant d'un éventuel état minimisé/masqué au passage.
fn montrer_fenetre(app: &AppHandle) {
    let Some(fenetre) = app.get_webview_window("main") else {
        return;
    };
    let _ = fenetre.unminimize();
    let _ = fenetre.show();
    let _ = fenetre.set_focus();
}

/// Bascule la visibilité de la fenêtre principale (clic gauche sur l'icône) :
/// la masque si elle est visible, sinon la ramène au premier plan.
fn basculer_fenetre(app: &AppHandle) {
    let Some(fenetre) = app.get_webview_window("main") else {
        return;
    };
    // Repli sur « visible » en cas d'erreur de plateforme : on préfère
    // risquer un clic sans effet plutôt que de masquer une fenêtre qu'on
    // n'arrive plus ensuite à retrouver.
    if fenetre.is_visible().unwrap_or(true) {
        let _ = fenetre.hide();
    } else {
        let _ = fenetre.unminimize();
        let _ = fenetre.show();
        let _ = fenetre.set_focus();
    }
}

/// Construit et enregistre l'icône de tray sous [`TRAY_ID`] : menu (« Ouvrir
/// Accord », « Quitter »), clic gauche = bascule d'affichage. Réutilise
/// l'icône de l'application (déjà déclarée dans `tauri.conf.json` →
/// `bundle.icon`) : pas d'asset supplémentaire à embarquer.
fn construire_tray(app: &AppHandle) -> tauri::Result<()> {
    let ouvrir = MenuItem::with_id(app, MENU_ID_OUVRIR, "Ouvrir Accord", true, None::<&str>)?;
    let quitter = MenuItem::with_id(app, MENU_ID_QUITTER, "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&ouvrir, &quitter])?;

    let icone = app
        .default_window_icon()
        .ok_or_else(|| {
            tauri::Error::AssetNotFound("icône par défaut de la fenêtre introuvable".into())
        })?
        .clone();

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icone)
        .menu(&menu)
        .tooltip("Accord")
        // Comportement par défaut de Tauri (affiche le menu au clic gauche
        // aussi) désactivé : le clic gauche doit uniquement basculer la
        // fenêtre (clic droit ouvre toujours le menu). Sans effet sur Linux
        // (non pris en charge par la plateforme, voir docs Tauri).
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_ID_OUVRIR => montrer_fenetre(app),
            MENU_ID_QUITTER => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                basculer_fenetre(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Crée ou détruit l'icône de tray selon `enabled` (commande appelée par la
/// UI au montage puis à chaque bascule du réglage « Garder dans la barre des
/// menus/systray »). Idempotent : rappeler avec le même état ne fait rien.
#[tauri::command]
pub fn tray_set_enabled(app: AppHandle, enabled: bool) -> Result<(), ErreurHote> {
    let deja_presente = app.tray_by_id(TRAY_ID).is_some();
    match (enabled, deja_presente) {
        (true, false) => construire_tray(&app).map_err(|e| ErreurHote::Tache(e.to_string())),
        (false, true) => {
            // Retire l'icône de l'état interne de Tauri et la laisse tomber
            // immédiatement : c'est ce `drop` de la dernière référence qui la
            // fait disparaître du système (voir doc `AppHandle::remove_tray_by_id`).
            let _ = app.remove_tray_by_id(TRAY_ID);
            Ok(())
        }
        _ => Ok(()),
    }
}
