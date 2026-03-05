# AGENTS.md

Ce document décrit les règles de travail pour les agents sur **FIG2TIG**.

## Contexte projet

- Projet hybride: Frontend React/TypeScript + moteur Rust compilé en WebAssembly.
- Objectif produit: convertir images/GIF en ASCII coloré, afficher en temps réel, exporter en GIF.
- Répertoires:
  - `frontend/`: UI React + Vite + Tailwind + canvas 2D.
  - `wasm-core/`: logique de décodage/encodage en Rust.

## Stack et outils

- Frontend: React 19, TypeScript, Vite, Tailwind.
- Backend WASM: Rust edition 2024, `wasm-bindgen`, `serde-wasm-bindgen`, `image`.
- Package manager JS: **bun** (présence de `bun.lock`).
- Build wasm recommandé: `wasm-pack`.

## Commandes standards

### Frontend (`frontend/`)

- Installer les dépendances: `bun install`
- Lancer en dev: `bun run dev`
- Build production: `bun run build`
- Lint: `bun run lint`
- Preview build: `bun run preview`

### WASM (`wasm-core/`)

- Vérifier compilation Rust: `cargo check`
- Tests Rust (si présents): `cargo test`
- Build wasm pour le frontend:
  - `wasm-pack build --target web --out-dir pkg`

## Règles de contribution

- Ne pas utiliser `npm` dans ce repo, utiliser `bun`.
- Garder la compatibilité TypeScript stricte (`bun run build` doit passer).
- Toute modif Rust doit conserver des erreurs explicites via `Result<_, JsError>`.
- Éviter les copies mémoire inutiles sur les gros buffers (`Uint8Array` <-> WASM).
- Préserver la fluidité UI (éviter blocages main thread sur gros exports).
- Conserver les composants React lisibles:
  - logique de rendu canvas isolée dans `AsciiViewer`.
  - orchestration upload/export dans `App.tsx`.

## Perf & mémoire (important)

- Upload: ajouter des garde-fous (taille fichier, dimensions, nombre de frames).
- Export GIF: éviter la stratégie "un unique buffer RGBA géant" quand possible.
- Préférer un pipeline frame-par-frame pour limiter le pic mémoire.
- Si l’export devient lourd, déplacer préparation/encodage dans un Web Worker.

## Sécurité & robustesse

- Toujours valider les entrées utilisateur (type MIME + taille + cohérence dimensions).
- Ne pas panic côté Rust pour des erreurs contrôlables: retourner un `JsError`.
- Éviter les `unwrap()`/`expect()` sur les chemins runtime.

## Définition de terminé (DoD)

- `cargo check` vert dans `wasm-core/`.
- `bun run build` vert dans `frontend/`.
- Aucun warning critique introduit.
- Le flux upload -> preview -> export fonctionne localement.
