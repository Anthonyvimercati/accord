#!/usr/bin/env bash
#
# Produit une archive propre du code source d'Accord, prête à partager.
#
# Stratégie :
#   - dépôt git -> `git archive` de HEAD (ne prend que les fichiers suivis,
#     donc exclut d'office target/, node_modules/, dist/, .git/, etc.) ;
#   - repli hors git -> `tar` en excluant explicitement les dossiers lourds.
#
# Usage :
#   ./scripts/preparer-code-source.sh [DOSSIER_SORTIE]
# DOSSIER_SORTIE par défaut : dist/code-source
#
set -euo pipefail

# Racine du dépôt (le script vit dans scripts/).
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RACINE"

# Dossier de sortie (argument optionnel).
SORTIE="${1:-$RACINE/dist/code-source}"
mkdir -p "$SORTIE"

# Version lue depuis la config Tauri (repli sur "0.0.0" si introuvable).
VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$RACINE/app/src-tauri/tauri.conf.json" | head -n1)"
VERSION="${VERSION:-0.0.0}"

ARCHIVE="$SORTIE/accord-source-$VERSION.tar.gz"

echo "== Création de l'archive du code source =="
echo "Version : $VERSION"
echo "Cible   : $ARCHIVE"

if git -C "$RACINE" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Méthode : git archive (fichiers suivis de HEAD)"
  # Préfixe de dossier dans l'archive : accord-<version>/
  git -C "$RACINE" archive --format=tar.gz \
    --prefix="accord-$VERSION/" \
    -o "$ARCHIVE" HEAD
else
  echo "Méthode : tar avec exclusions (dépôt non git)"
  tar --exclude='./target' \
      --exclude='./app/dist' \
      --exclude='./dist' \
      --exclude='*/node_modules' \
      --exclude='./.git' \
      --exclude='*.log' \
      --exclude='.DS_Store' \
      -czf "$ARCHIVE" -C "$RACINE" .
fi

echo ""
echo "== Archive produite =="
# Taille lisible par un humain (repli si -h non supporté).
TAILLE="$(du -h "$ARCHIVE" 2>/dev/null | cut -f1)"
echo "Fichier : $ARCHIVE"
echo "Taille  : ${TAILLE:-inconnue}"
