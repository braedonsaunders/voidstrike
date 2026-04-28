<div align="center">

<img src="docs/voidstrike-social.png" alt="VOIDSTRIKE" width="900" />

**The browser RTS that makes people ask how this is running in a tab.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r182-black?logo=three.js)](https://threejs.org/)
[![WebGPU](https://img.shields.io/badge/WebGPU-First-green)](https://www.w3.org/TR/webgpu/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Quick Start](#quick-start) · [Technical Achievements](#technical-achievements)

</div>

<p align="center">
  <a href="https://github.com/braedonsaunders/codeflow"><img src=".github/codeflow-card.svg" alt="VOIDSTRIKE codebase stats — powered by codeflow" width="100%" /></a>
</p>

VOIDSTRIKE is a browser-native sci-fi RTS built to feel bigger than the browser it runs in. It is chasing the feeling of a full desktop strategy game: heavy atmosphere, big 3D battles, strong visual identity, and real systems depth instead of a stripped-down web prototype.

<img src="docs/screenshot1.png" alt="" width="900" />

<img src="docs/screenshot2.png" alt="" width="900" />

## Quick Start

- `git clone https://github.com/braedonsaunders/voidstrike.git`
- `cd voidstrike`
- Launch locally with `launch/launch-voidstrike.command` on macOS, `launch/launch-voidstrike.bat` on Windows, or `launch/launch-voidstrike.desktop` on Linux.
- For development, run `npm install` and then `npm run dev`.
- The launcher is the easiest local path; it installs dependencies if needed, builds the game, starts the production server, and opens the browser.

<img src="docs/screenshot4.png" alt="" width="900" />

## Technical Achievements

- **Worker-first RTS runtime.** VOIDSTRIKE runs its authoritative ECS simulation in a dedicated game worker and distributes pathfinding, vision, AI decisions, overlay timing, and countdown logic across additional workers.
- **Background-safe fixed-step simulation.** Worker-driven fixed-timestep loops preserve RTS timing when tabs lose foreground priority.
- **Deterministic simulation discipline.** Quantized math, deterministic ordering, integer square roots, and multiplayer-safe system design are integrated directly into gameplay code paths.
- **Lockstep multiplayer runtime.** Input barriers, adaptive command delay, heartbeat flow control, ownership validation, sync requests, and command buffering are part of the live runtime.
- **Per-tick desync forensics.** VOIDSTRIKE computes state checksums every few ticks and uses Merkle-tree divergence search to localize mismatches in O(log n).
- **Serverless P2P multiplayer with authenticated commands.** The networking stack uses WebRTC data channels with Nostr-backed lobby signaling, and multiplayer inputs are cryptographically signed and verified.
- **Live network adaptation and recovery.** RTT, jitter, and packet loss are measured continuously, command delay adapts to network conditions, and reconnection/resync flows are built into the multiplayer layer.
- **WebGPU-first renderer with WebGL2 fallback.** The renderer targets Three.js r182 + TSL on WebGPU and ships a WebGL2 fallback path.
- **Advanced browser post-processing stack.** GTAO, SSR, SSGI, volumetric fog, RTS fog of war, bloom, TRAA, ACES color grading, FSR upscaling, and RCAS sharpening are integrated into the render pipeline.
- **Custom rendering infrastructure for instancing and temporal stability.** VOIDSTRIKE implements per-instance motion vectors for `InstancedMesh`, dual-pipeline TAA/upscaling, and device-lost recovery and fallback handling.
- **GPU-driven battlefield visibility.** Vision and fog-of-war computation run through GPU compute with storage textures and no CPU readback.
- **Battlefield-scale rendering systems.** The project includes instanced units, instanced buildings, instanced effects, GPU/CPU culling paths, LOD management, instanced selection rings, pooled lights, and GPU-instanced particle systems for large combat scenes.
- **Industry-grade navigation and movement work inside the browser.** VOIDSTRIKE uses Recast Navigation in WASM with dynamic obstacles, separate land and water navmeshes, elevated-map-aware path queries, formations, crowd steering, flocking, and WebAssembly SIMD boids acceleration.
- **Hybrid 3D + 2D presentation stack.** The runtime combines WebGPU 3D rendering with a Phaser overlay for tactical indicators, damage numbers, alerts, and screen effects.
- **Integrated content and debugging tools.** The codebase includes a reusable 3D map editor, navmesh/connectivity validation, LLM-assisted map generation, a battle simulator, debugging overlays, performance instrumentation, and asset/LOD workflows.
