#!/usr/bin/env bash
#
# Build local du bundle macOS d'Accord (DMG + application .app).
#
# À lancer SUR macOS. Produit par défaut un binaire UNIVERSEL
# (Apple Silicon aarch64 + Intel x86_64), identique à celui du workflow CI.
#
# Prérequis :
#   - macOS (Xcode Command Line Tools : `xcode-select --install`)
#   - Node 20+ et npm
#   - Rust stable (rustup) — https://rustup.rs
#
# La cible x86_64-apple-darwin est ajoutée automatiquement plus bas pour
# permettre le binaire universel ; sinon, forcer un build natif seul avec :
#   ACCORD_CIBLE=aarch64-apple-darwin ./scripts/build-macos.sh
#
set -euo pipefail

# Racine du dépôt (le script vit dans scripts/).
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RACINE"
export PATH="$HOME/.cargo/bin:$PATH"

# Cible de compilation : universelle par défaut.
CIBLE="${ACCORD_CIBLE:-universal-apple-darwin}"

echo "== Vérification de la plateforme =="
if [[ "$(uname)" != "Darwin" ]]; then
  echo "Erreur : ce script doit être exécuté sur macOS." >&2
  exit 1
fi

echo "== Ajout des cibles Rust (binaire universel) =="
# Ces cibles sont nécessaires pour un binaire universel ; l'ajout est idempotent.
rustup target add aarch64-apple-darwin x86_64-apple-darwin

echo "== Installation des dépendances frontend (si nécessaire) =="
cd "$RACINE/app"
[ -d node_modules ] || npm ci

echo "== Build Tauri (cible : $CIBLE) =="
# CI=true évite l'échec cosmétique du DMG (script AppleScript de mise en page de
# la fenêtre du DMG, qui échoue notamment sans session graphique interactive).
CI=true npx tauri build --target "$CIBLE"

# Emplacement des artefacts : target/<cible>/release/bundle/{dmg,macos}
BUNDLE="$RACINE/target/$CIBLE/release/bundle"

echo ""
echo "== Artefacts produits =="
if [ -d "$BUNDLE" ]; then
  ls -la "$BUNDLE/dmg" 2>/dev/null || true
  ls -la "$BUNDLE/macos" 2>/dev/null || true
  echo ""
  echo "Dossier des bundles : $BUNDLE"
else
  echo "Aucun bundle trouvé sous $BUNDLE — vérifier la sortie du build ci-dessus." >&2
  exit 1
fi
