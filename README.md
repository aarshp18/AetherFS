# AetherFS

A lightweight, asynchronous workspace bridge and file-streaming daemon written in Rust, paired with a modern Progressive Web App (PWA) client.

> **Status:** First alpha (`v0.1-alpha`) is ready to use, though still in active development.

---

## Overview

Modern multi-device setups often span disparate operating systems with asymmetrical storage and background processing capabilities:
- **Workstations:** Linux and Windows dual-boot environments with high storage and compute capacity.
- **Mobile Nodes:** Android and iPadOS devices with sandboxed filesystems and aggressive background process termination.

AetherFS bridges this divide by decoupling local storage from device-specific vendor silos. Rather than syncing gigabytes of data indiscriminately across constrained mobile storage, AetherFS provides an on-demand, streaming file explorer and shared workspace interface over secure peer-to-peer networks (e.g., Tailscale).

---

## Architecture

- **Daemon (`/daemon`):** A lightweight background daemon written in Rust (`tokio` + `axum`). It manages safe filesystem indexing, directory traversal validation, and chunked byte streaming.
- **Client (`/web`):** A responsive, mobile-first Progressive Web App (PWA) providing a virtualized file browser, document previewer, and bidirectional clipboard sync across mobile and desktop browsers.

---

## Features (Planned & Roadmap)

- [x] **Project Scaffolding:** Workspace layout and dependency setup.
- [x] **Milestone 1:** Headless read-only streaming daemon with path canonicalization security.
- [x] **Milestone 2:** Real-time directory watching (`notify`) and WebSocket event streaming.
- [x] **Milestone 3:** Progressive Web App (PWA) with on-demand previews and virtualized file tree.
- [x] **Milestone 4:** Resilient chunked uploads and cross-device clipboard buffer.

---

## Security Model

AetherFS is built to expose designated local directories without risking the host system:
- **Path Traversal Protection:** All client-provided relative paths are normalized and verified via `canonicalize()` to ensure they remain strictly within the root directory bounds.
- **Symlink Jail:** Symbolic links attempting to resolve outside the designated workspace root are rejected with `403 Forbidden`.
- **Token-Based Auth:** Header-based bearer authentication for all REST and WebSocket interactions.

---

## Getting Started

### Prerequisites

- [Rust & Cargo](https://rustup.rs/) (edition 2021+)
- [Node.js & npm](https://nodejs.org/) (v18+)

### Running the Daemon

Because the repository uses a Cargo workspace, you can run all Cargo commands directly from the project root (`AetherFS/`):

```bash
# Clone the repository
git clone https://github.com/aarshp18/AetherFS.git
cd AetherFS

# Run the test suite
cargo test

# Start the daemon (binds to 0.0.0.0:8080 by default)
cargo run -- --root ~

# Or run in release mode for faster file streaming & uploads
cargo run --release -- --root ~
```

> **Tip:** Pass `--token <your-secret>` to enable Bearer token authentication, or `--bind 127.0.0.1:8080` to restrict access to localhost only.

### Running the Web UI

```bash
cd web

# Install dependencies (first time or after dependency updates)
npm install

# Option 1: Development server with hot-reload (accessible at http://<host-ip>:3000)
npm run dev -- --host 0.0.0.0

# Option 2: Production PWA build & preview (accessible at http://<host-ip>:4173)
npm run build && npm run preview -- --host 0.0.0.0
```

> **Accessing from another device:** Open `http://<host-ip>:4173` (when using `preview`) or `http://<host-ip>:3000` (when using `dev`) in your mobile/tablet browser over LAN or Tailscale. The UI will automatically connect to the daemon on port `8080`.