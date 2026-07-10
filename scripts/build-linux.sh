#!/usr/bin/env bash
#
# Build local du bundle Linux d'Accord (.deb + AppImage).
#
# À lancer SUR une machine Linux (Debian/Ubuntu). Ne peut PAS être produit
# depuis macOS : Tauri s'appuie ici sur les bibliothèques natives GTK/WebKitGTK,
# non cross-compilables de façon fiable depuis un Mac.
#
# Prérequis :
#   - Node 20+ et npm
#   - Rust stable (rustup) — https://rustup.rs
#   - Paquets système Tauri 2 (Debian/Ubuntu) :
#       sudo apt-get update
#       sudo apt-get install -y \
#         libwebkit2gtk-4.1-dev \
#         build-essential \
#         curl \
#         wget \
#         file \
#         libxdo-dev \
#         libssl-dev \
#         libayatana-appindicator3-dev \
#         librsvg2-dev \
#         patchelf
#     (patchelf est requis pour le bundling AppImage.)
#     Sur Ubuntu < 22.04, WebKitGTK 4.1 peut manquer : préférer Ubuntu 22.04+.
#
set -euo pipefail

# Racine du dépôt (le script vit dans scripts/).
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RACINE"
export PATH="$HOME/.cargo/bin:$PATH"

echo "== Vérification de la plateforme =="
if [[ "$(uname)" != "Linux" ]]; then
  echo "Erreur : ce script doit être exécuté sur Linux." >&2
  exit 1
fi

echo "== Installation des dépendances frontend (si nécessaire) =="
cd "$RACINE/app"
[ -d node_modules ] || npm ci

echo "== Build Tauri =="
npx tauri build

# Emplacement des artefacts : target/release/bundle/{deb,appimage,rpm}
BUNDLE="$RACINE/target/release/bundle"

echo ""
echo "== Artefacts produits =="
if [ -d "$BUNDLE" ]; then
  ls -la "$BUNDLE/deb" 2>/dev/null || true
  ls -la "$BUNDLE/appimage" 2>/dev/null || true
  ls -la "$BUNDLE/rpm" 2>/dev/null || true
  echo ""
  echo "Dossier des bundles : $BUNDLE"
else
  echo "Aucun bundle trouvé sous $BUNDLE — vérifier la sortie du build ci-dessus." >&2
  exit 1
fi
