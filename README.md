# AetherFS

A lightweight, asynchronous workspace bridge and file-streaming daemon written in Rust, paired with a modern Progressive Web App (PWA) client.

> **Status:** Active development (v0.1-alpha). Architecture and API specifications are in progress.

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
- [ ] **Milestone 1:** Headless read-only streaming daemon with path canonicalization security.
- [ ] **Milestone 2:** Real-time directory watching (`notify`) and WebSocket event streaming.
- [ ] **Milestone 3:** Progressive Web App (PWA) with on-demand previews and virtualized file tree.
- [ ] **Milestone 4:** Resilient chunked uploads and cross-device clipboard buffer.

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

### Running the Daemon (Local Dev)

```bash
# Clone the repository
git clone [https://github.com/](https://github.com/)<your-username>/aetherfs.git
cd aetherfs/daemon

# Run the test suite
cargo test

# Start the daemon on localhost
cargo run -- --bind 127.0.0.1:8080 --root ./test_workspace