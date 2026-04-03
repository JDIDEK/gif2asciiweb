# GIF2ASCII - GIF/Image to Colored ASCII

GIF2ASCII converts images and GIFs into colored ASCII art, provides real-time browser preview, and supports GIF export.

This project combines:
- a React + TypeScript frontend (Vite)
- a Rust engine compiled to WebAssembly

## Table of Contents

- [Overview](#overview)
- [Quick Start (Recommended)](#quick-start-recommended)
- [How to Use](#how-to-use)
- [Docker Development (Hot Reload)](#docker-development-hot-reload)
- [Useful Docker Commands](#useful-docker-commands)
- [Local Development (Optional)](#local-development-optional)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

## Overview

Goal: allow any user to run the app with minimal setup.

Recommended mode:
- Docker only
- no local Rust, Bun, or Node installation required

## Quick Start (Recommended)

Requirements:
- Docker Desktop (Windows/macOS) or Docker Engine (Linux)
- Docker Compose

From the project root:

```bash
docker compose build --no-cache
docker compose up -d
```

Open:

- http://localhost:8080

Stop:

```bash
docker compose down
```

## How to Use

1. Open the app in your browser.
2. Upload an image or GIF.
3. Adjust ASCII settings (density, rendering options, etc.).
4. Preview the output in real time.
5. Export as GIF.

## Docker Development (Hot Reload)

This mode runs Vite in a dev container with live reload on file changes.

Requirements:
- Docker Desktop / Docker Engine

Start dev mode:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Open:

- http://localhost:5173

Stop:

```bash
docker compose -f docker-compose.dev.yml down
```

Notes:
- The container builds `wasm-core/pkg` at startup, then starts Vite.
- Frontend file edits are reloaded automatically.

## Useful Docker Commands

Start in detached mode:

```bash
docker compose up -d
```

View logs:

```bash
docker compose logs -f
```

Rebuild from scratch:

```bash
docker compose build --no-cache
```

Restart:

```bash
docker compose down
docker compose up -d
```

Remove containers, networks, and local images created by compose:

```bash
docker compose down --rmi local
```

## Local Development (Optional)

You can also run without Docker, but local tooling is required.

### Frontend

```bash
cd frontend
bun install
bun run dev
```

Production frontend build:

```bash
cd frontend
bun run build
```

### WASM Engine (Rust)

```bash
cd wasm-core
cargo check
wasm-pack build --target web --out-dir pkg
```

## Project Structure

```text
.
|- frontend/      # React + TypeScript + Vite UI
|- wasm-core/     # Rust engine compiled to WebAssembly
|- Dockerfile     # Multi-stage build (Rust -> Bun -> Node -> Nginx)
|- docker-compose.yml
`- nginx.conf
```

## Troubleshooting

### 1) docker command not found

Symptom:
- docker: command not found

Fix:
- install Docker Desktop / Docker Engine
- on WSL2, enable WSL integration in Docker Desktop

### 2) First Docker build takes a long time

This is expected:
- first build installs dependencies and compiles Rust/WASM
- next builds reuse Docker cache

### 3) Port 8080 is already in use

Option A:
- stop the process using port 8080

Option B:
- change port mapping in docker-compose.yml (example: 8081:80)

### 4) App does not load after updates

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

## FAQ

### Do I need Rust installed on Windows to run this project?

No, not in Docker mode.
The Dockerfile compiles Rust/WASM inside the image.

### Do I need Bun or Node installed locally?

No, not in Docker mode.
Everything is handled by the Docker build stages.
