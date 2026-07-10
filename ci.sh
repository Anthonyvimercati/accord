#!/usr/bin/env bash
# CI locale Accord — le dépôt n'est jamais laissé dans un état où ce script échoue.
# Couvre tout le projet : workspace Rust (crates/* + app/src-tauri) puis frontend app/.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"

step() { printf '\n\033[1;34m== %s ==\033[0m\n' "$1"; }

# --- Rust (workspace complet, hôte Tauri inclus) ---

step "Rust: cargo fmt --all --check"
cargo fmt --all --check

step "Rust: cargo clippy --workspace --all-targets -D warnings"
cargo clippy --workspace --all-targets -- -D warnings

step "Rust: cargo test --workspace"
cargo test --workspace --quiet

# --- Frontend (app/) ---

if [ -d app ] && [ -f app/package.json ]; then
  step "UI: install (si nécessaire)"
  (cd app && [ -d node_modules ] || npm ci --no-audit --no-fund)

  step "UI: typecheck (tsc --noEmit)"
  (cd app && npx tsc --noEmit)

  step "UI: eslint"
  (cd app && npm run lint --silent)

  step "UI: prettier --check"
  (cd app && npx prettier --check src)

  step "UI: tests (vitest run)"
  (cd app && npm test --silent)

  step "UI: build de production"
  (cd app && npm run build --silent)
fi

printf '\n\033[1;32mCI OK\033[0m\n'
