<div align="center">

# VOIDSTRIKE

**Browser-native RTS. 100,000+ lines of TypeScript. Written entirely by AI.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r182-black?logo=three.js)](https://threejs.org/)
[![WebGPU](https://img.shields.io/badge/WebGPU-First-green)](https://www.w3.org/TR/webgpu/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Play](#quick-start) · [Technical Architecture](#technical-architecture) · [Extractable Libraries](#extractable-libraries) · [For Players](#for-rts-players)

</div>

---

## ⚠️ Work in Progress

- **Other factions/races** — Additional playable factions beyond Dominion
- **Naval combat** — Water-based units and naval warfare mechanics
- **Ramp pathfinding issues** — Units get stuck on terrain transitions
- **Multiplayer testing** — Stress testing P2P netcode at scale

---

## The Experiment

Can AI produce production-quality game code? Not a prototype or tech demo - an actual shippable codebase with deterministic netcode, custom shaders, and real game design.

| Component | Source |
|-----------|--------|
| **Engine & Game Logic** | Claude (Anthropic) |
| **Shaders & Rendering** | Claude |
| **Networking** | Claude |
| **3D Models** | Meshy AI |
| **Music** | Suno |
| **Sound Effects & Voice** | ElevenLabs |

No human-written code. MIT licensed. Study it, fork it, extract pieces for your own projects.

---

## Technical Architecture

Browser games typically compromise on one or more axes: graphics fidelity, networking architecture, or simulation determinism. This project attempts to avoid those tradeoffs. Here's what's under the hood.

### Serverless P2P Multiplayer

No game servers. No matchmaking backend. No infrastructure costs. Players connect directly via WebRTC, with signaling handled through the [Nostr protocol](https://nostr.com/) - a decentralized network with hundreds of public relays and zero single point of failure.

```
Host creates lobby → 4-character code published to Nostr relays
Guest enters code  → Nostr locates lobby, facilitates WebRTC handshake
Connection made    → Direct peer-to-peer, Nostr disconnected
```

If Nostr becomes unavailable, players can fall back to manual connection code exchange. The game continues to function regardless of external infrastructure.

**Implementation:** `src/engine/network/p2p/NostrMatchmaking.ts`, `ConnectionCode.ts`

---

### Deterministic Lockstep with Fixed-Point Arithmetic

Multiplayer RTS requires identical simulation across all clients. The challenge: IEEE 754 floating-point arithmetic isn't guaranteed to produce identical results across different CPUs, browsers, or optimization levels. The differences are small, but they accumulate.

The solution is Q16.16 fixed-point arithmetic for all gameplay-critical calculations:

```typescript
// src/utils/FixedPoint.ts
export const FP_SHIFT = 16;
export const FP_SCALE = 1 << FP_SHIFT; // 65536

export function fpMul(a: number, b: number): number {
  // Use BigInt for 64-bit intermediate precision
  const aBig = BigInt(a);
  const bBig = BigInt(b);
  return Number((aBig * bBig) >> BigInt(FP_SHIFT)) | 0;
}
```

When desyncs do occur, Merkle tree comparison identifies the divergent entities in O(log n) time rather than requiring a full state diff.

**Implementation:** `src/utils/FixedPoint.ts`, `src/engine/network/MerkleTree.ts`

---

### Archetype-Based ECS with Composition-Aware Caching

Most Entity Component System implementations rebuild query caches every frame. This implementation only invalidates when an entity's component composition actually changes:

```typescript
// Entities grouped by component signature (archetype)
// "Health,Transform,Unit,Velocity" → Set<EntityId> containing 200 units
// "Building,Health,Selectable"     → Set<EntityId> containing 50 buildings

getEntitiesWith(Transform, Unit) {
  // Cache invalidates on composition change, not every tick
  if (this.queryCacheVersion === this.archetypeCacheVersion) {
    return this.queryCache.get(key); // O(1)
  }
  // Rebuild: iterate archetypes, not entities
}
```

For typical entity distributions (500 entities across 10 archetypes), this provides roughly 50x improvement over naive set intersection.

**Implementation:** `src/engine/ecs/World.ts` (~350 lines, zero dependencies)

---

### Background Tab Timing

Browsers throttle `requestAnimationFrame` to approximately 1Hz when a tab is backgrounded. In a multiplayer context, this causes the backgrounded player to fall behind on simulation ticks, leading to desync.

Web Workers are not subject to the same throttling:

```typescript
// src/engine/core/GameLoop.ts
const workerCode = `
  setInterval(() => {
    self.postMessage({ type: 'tick', time: performance.now() });
  }, ${tickMs});
`;
this.worker = new Worker(URL.createObjectURL(new Blob([workerCode])));
```

The game maintains its 20Hz tick rate even when minimized or in a background tab.

**Implementation:** `src/engine/core/GameLoop.ts` (~180 lines)

---

### Per-Instance Velocity for Temporal Anti-Aliasing

Three.js provides a built-in `VelocityNode` for motion vector generation, but it operates at the object level. When using `InstancedMesh` to batch hundreds of units into a single draw call, the velocity node sees one stationary object - every instance reports zero motion.

The result: temporal anti-aliasing produces ghosting artifacts on all moving units, as the TAA algorithm incorrectly assumes static geometry.

The fix stores both current and previous frame transformation matrices as per-instance vertex attributes:

```typescript
// 8 vec4 attributes per instance (4 for current matrix, 4 for previous)
const currInstanceMatrix = mat4(
  attribute('currInstanceMatrix0'),
  attribute('currInstanceMatrix1'),
  attribute('currInstanceMatrix2'),
  attribute('currInstanceMatrix3')
);
const prevInstanceMatrix = mat4(
  attribute('prevInstanceMatrix0'),
  // ...
);
// Velocity = project(current) - project(previous)
```

A subtle issue: floating-point precision differences between the code paths that compute current vs. previous positions caused micro-jitter. Using identical attribute reads for both matrices eliminated the problem.

**Implementation:** `src/rendering/tsl/InstancedVelocity.ts` (~280 lines)

---

### Dual-Pipeline Resolution Scaling

Combining temporal anti-aliasing with resolution upscaling is architecturally tricky. Depth-dependent post-processing effects (GTAO, SSR) require matching depth buffer dimensions. Attempting to mix render targets at different resolutions triggers WebGPU validation errors.

The solution: two completely separate post-processing pipelines.

```
INTERNAL PIPELINE @ Render Resolution (e.g., 1440p)
├── Scene Pass (with MRT: color, normals, velocity)
├── GTAO (ambient occlusion)
├── SSR (screen-space reflections)
├── Bloom
├── Volumetric Fog
├── Color Grading
└── TAA → outputs to texture

DISPLAY PIPELINE @ Native Resolution (e.g., 2160p)
└── FSR EASU (edge-adaptive upscaling) → canvas
```

All depth-dependent effects execute at render resolution. Upscaling happens in a separate pass with no depth buffer involvement.

**Implementation:** `src/rendering/tsl/PostProcessing.ts`, `src/rendering/tsl/effects/EffectPasses.ts`

---

### AAA-Style Fog of War

Not a simple darkness overlay. The full implementation includes:

- Gaussian blur on visibility edges (eliminates blocky cell boundaries)
- Explored but non-visible areas rendered desaturated with cool color shift
- Animated procedural cloud layer over unexplored regions
- GPU compute shader for vision calculation (supports 1000+ vision sources at 60fps)
- Temporal smoothing for visibility state transitions

```
VisionCompute (GPU) → StorageTexture (R=explored, G=visible, A=smoothed)
                              ↓
              FogOfWarPass (post-processing)
              ├── Sample vision texture
              ├── Apply desaturation + color shift to explored areas
              ├── Blend cloud noise over unexplored
              └── Output modified scene color
```

**Implementation:** `src/rendering/compute/VisionCompute.ts`, `src/rendering/tsl/effects/EffectPasses.ts`

---

## Extractable Libraries

These modules have minimal coupling and could be extracted as standalone packages:

| Module | Size | Dependencies | Purpose |
|--------|------|--------------|---------|
| **Archetype ECS** | ~350 lines | None | Fast queries with composition-based cache invalidation |
| **Fixed-Point Math** | ~300 lines | None | Q16.16 deterministic arithmetic for netcode |
| **EventBus** | ~110 lines | None | Typed pub/sub with O(1) unsubscribe via swap-and-pop |
| **Game Loop** | ~180 lines | None | Worker-based timing, survives background tabs |
| **Behavior Trees** | ~300 lines | None | Async-compatible BT implementation for game AI |
| **Nostr Matchmaking** | ~450 lines | nostr-tools | Decentralized lobby system over Nostr protocol |
| **Connection Codes** | ~450 lines | pako | Encode WebRTC SDP as shareable codes |
| **Instanced Velocity** | ~280 lines | Three.js | Per-instance motion vectors for TAA |
| **Merkle Sync** | ~200 lines | None | O(log n) state divergence detection |

---

## For RTS Players

### Factions

| Faction | Theme | Playstyle |
|---------|-------|-----------|
| **Dominion** | Military industrial complex | Defensive, siege-oriented |
| **Synthesis** | Transcendent AI collective | Shield-based, psionic abilities |
| **Swarm** | Adaptive biological horror | Cheap units, overwhelming numbers |

**Dominion** builds bunkers, sieges tanks, and turtles until ready to push with superior firepower.

**Synthesis** warps in units instantly, relies on regenerating shields, and deploys devastating psionic abilities.

**Swarm** spreads creep across the map, morphs cheap units into specialized forms, and wins through attrition.

### Why Play This

- **Zero installation.** Runs in browser. Click and play.
- **Real graphics pipeline.** GTAO, SSR, volumetric fog, temporal AA. Not a 2D sprite game.
- **Peer-to-peer.** No central servers means the game can't be "sunset."
- **Deterministic replays.** Every match can be rewatched or shared.
- **Tiered AI.** Five difficulty levels, from beginner-friendly to competitive practice.

### Controls

| Input | Action |
|-------|--------|
| Left click | Select |
| Right click | Move / Attack / Interact |
| Shift + click | Queue commands |
| Ctrl + 1-9 | Create control group |
| 1-9 | Select control group |
| A + click | Attack-move |
| H | Hold position |
| P | Patrol |

---

## Quick Start

```bash
git clone https://github.com/braedonsaunders/voidstrike.git
cd voidstrike
npm install
npm run dev
```

Open http://localhost:3000. Chrome 113+ recommended for WebGPU; other modern browsers fall back to WebGL2.

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16, React 19 |
| Language | TypeScript 5 (strict mode, no implicit any) |
| Graphics | Three.js r182 (WebGPU primary, WebGL2 fallback) |
| Shaders | TSL (Three.js Shading Language) |
| Pathfinding | recast-navigation (WASM, same library as Unity/Godot/Unreal) |
| State | Zustand |
| Networking | WebRTC + Nostr |
| Styling | Tailwind CSS |

---

## Performance Targets

| Metric | Target | Measured |
|--------|--------|----------|
| Frame rate | 60 FPS | 60 FPS @ 200 units |
| Tick rate | 20 Hz | 20 Hz fixed timestep |
| Memory | < 500 MB | ~300 MB |
| Cold start | < 5s | ~3s |

Key optimizations: instanced rendering, spatial hashing for O(1) range queries, archetype query caching, object pooling, vector pooling to minimize GC pressure.

---

## Project Structure

```
src/
├── engine/               # Reusable game engine
│   ├── ecs/             # Entity-Component-System
│   ├── core/            # Game loop, EventBus, performance monitoring
│   ├── systems/         # Combat, movement, production, AI
│   ├── pathfinding/     # Recast Navigation WASM integration
│   └── network/         # P2P, lockstep, desync detection
│
├── rendering/           # Three.js rendering layer
│   ├── tsl/            # WebGPU shaders, post-processing pipeline
│   ├── compute/        # GPU compute (vision, frustum culling)
│   └── effects/        # Battle effects, particle systems
│
├── data/               # Game content (swap to reskin the game)
│   ├── units/          # Unit definitions per faction
│   ├── buildings/      # Building definitions
│   └── abilities/      # Ability definitions
│
└── components/         # React UI layer
```

The engine (`src/engine/`) is game-agnostic. The content (`src/data/`) defines VOIDSTRIKE specifically. Swap the data layer to build a different RTS.

---

## Documentation

| Document | Contents |
|----------|----------|
| `docs/architecture/OVERVIEW.md` | System architecture, data flow, ECS patterns |
| `docs/architecture/rendering.md` | Graphics pipeline, shader architecture, post-processing |
| `docs/architecture/networking.md` | P2P protocol, determinism requirements, desync handling |
| `docs/design/GAME_DESIGN.md` | Game mechanics, faction design, balance considerations |

---

## Contributing

Areas where contributions would be valuable:

- Test coverage for fixed-point math edge cases
- Additional TSL shader effects
- AI improvements (current implementation is functional but predictable at higher levels)
- Accessibility features

```bash
npm run type-check  # TypeScript validation
npm run lint        # ESLint
npm run dev         # Development server
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

<div align="center">

*Demonstrating that browser games don't require architectural compromise.*

</div>
