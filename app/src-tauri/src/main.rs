//! Point d'entrée de l'hôte de bureau Accord.

// Pas de console parasite en production sous Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

fn main() -> ExitCode {
    accord_app::executer()
}
