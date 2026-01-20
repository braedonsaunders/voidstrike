<div align="center">

# VOIDSTRIKE

**Browser RTS. 124K lines of TypeScript. Written by AI.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r182-black?logo=three.js)](https://threejs.org/)
[![WebGPU](https://img.shields.io/badge/WebGPU-First-green)](https://www.w3.org/TR/webgpu/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Play](#quick-start) · [The Interesting Bits](#the-interesting-bits) · [Steal This Code](#steal-this-code) · [For Players](#for-rts-players)

</div>

---

## What Is This

An experiment. Can AI write an actual game? Not a tech demo, not a prototype - a real codebase you could ship.

| Part | Made By |
|------|---------|
| Code (all of it) | Claude |
| 3D models | Meshy AI |
| Music | Suno |
| Sound/voice | ElevenLabs |

No human-written code. MIT license. Take whatever you want.

---

## The Interesting Bits

Browser games usually make tradeoffs. This one tries not to. Here's what might be worth looking at:

### No Servers, Can't Die

There's no game server. No matchmaking backend. Players connect directly over WebRTC, and signaling happens through [Nostr](https://nostr.com/) - the decentralized protocol that Bitcoin people like. Hundreds of public relays, zero cost, nobody can shut it down.

```
Host creates lobby → published to Nostr relays
Guest enters 4-character code → WebRTC handshake over Nostr
Connected → relays disconnected, pure P2P from here
```

If somehow every Nostr relay went offline, players can still swap connection codes manually. The game keeps working.

`src/engine/network/p2p/NostrMatchmaking.ts`

---

### Fixed-Point Math (Because Floats Lie)

Multiplayer RTS needs identical simulation on every machine. Problem: floating-point math isn't deterministic. `0.1 + 0.2` can give different answers on different CPUs. Not often, but often enough to desync a game.

So everything uses Q16.16 fixed-point:

```typescript
// src/utils/FixedPoint.ts
export function fpMul(a: number, b: number): number {
  const aBig = BigInt(a);
  const bBig = BigInt(b);
  return Number((aBig * bBig) >> BigInt(FP_SHIFT)) | 0;
}
```

When players do desync, Merkle trees pinpoint which entity diverged. O(log n) to find the problem instead of diffing 500 units.

`src/utils/FixedPoint.ts`, `src/engine/network/MerkleTree.ts`

---

### ECS That Doesn't Trash Its Cache Every Frame

Most ECS systems rebuild their query caches every tick. This one only invalidates when an entity's component set actually changes:

```typescript
// Entities grouped by signature
// "Health,Transform,Unit,Velocity" → 200 units
// "Building,Health,Selectable" → 50 buildings

getEntitiesWith(Transform, Unit) {
  if (this.queryCacheVersion === this.archetypeCacheVersion) {
    return this.queryCache.get(key); // cache hit
  }
  // rebuild only when composition changed
}
```

~50x faster than naive set intersection for typical entity counts. About 350 lines, no dependencies.

`src/engine/ecs/World.ts`

---

### Background Tabs Don't Break Multiplayer

Browsers throttle `requestAnimationFrame` to 1Hz when a tab is backgrounded. Your opponent keeps playing, you fall behind, desync.

Web Workers don't get throttled:

```typescript
// src/engine/core/GameLoop.ts
const workerCode = `
  setInterval(() => {
    self.postMessage({ type: 'tick' });
  }, ${tickMs});
`;
this.worker = new Worker(URL.createObjectURL(new Blob([workerCode])));
```

Game keeps ticking at 20Hz even when minimized.

---

### Per-Instance Motion Vectors

Three.js's `VelocityNode` tracks per-object motion. But we use `InstancedMesh` to batch hundreds of units into one draw call. The built-in velocity sees one object, stationary. TAA ghosts everything.

Fix: store current and previous frame matrices as vertex attributes per instance.

```typescript
// 8 vec4 attributes: 4 for current matrix, 4 for previous
const currInstanceMatrix = mat4(
  attribute('currInstanceMatrix0'),
  attribute('currInstanceMatrix1'),
  attribute('currInstanceMatrix2'),
  attribute('currInstanceMatrix3')
);
```

Had a fun bug where precision differences between code paths caused jitter. Reading both matrices the exact same way fixed it.

`src/rendering/tsl/InstancedVelocity.ts`

---

### TAA + Upscaling Without Breaking WebGPU

Temporal AA at one resolution, upscaling to another. Sounds simple. Except depth buffers at different resolutions make WebGPU angry.

Two separate pipelines:

```
INTERNAL @ 1440p: Scene → GTAO → SSR → Bloom → TAA
DISPLAY @ 2160p: FSR upscale from internal output
```

Depth-dependent stuff stays at render res. Upscaling happens after, no depth buffer involved.

`src/rendering/tsl/PostProcessing.ts`

---

### SC2-Style Fog of War

Not just darkness. The full thing:
- Gaussian blur on edges (no blocky cells)
- Explored areas go desaturated with blue tint
- Animated clouds over unexplored regions
- GPU compute handles 1000+ vision sources at 60fps
- Smooth transitions, no pop

`src/rendering/compute/VisionCompute.ts`, `src/rendering/tsl/effects/EffectPasses.ts`

---

## Steal This Code

Modules that could be yanked out and used elsewhere:

| What | Size | Deps | Does |
|------|------|------|------|
| Archetype ECS | ~350 lines | none | Fast queries, composition-based invalidation |
| Fixed-Point Math | ~300 lines | none | Deterministic Q16.16 for netcode |
| EventBus | ~110 lines | none | Typed pub/sub, O(1) unsubscribe |
| Game Loop | ~180 lines | none | Worker-based, survives background tabs |
| Behavior Trees | ~300 lines | none | Async-friendly for game AI |
| Nostr Matchmaking | ~450 lines | nostr-tools | Decentralized lobbies |
| Instanced Velocity | ~280 lines | Three.js | Per-instance motion vectors |
| Merkle Sync | ~200 lines | none | O(log n) state diff |

---

## For RTS Players

### Factions

| | | |
|-|-|-|
| **Dominion** | Tanks, bunkers, siege | If you liked Terran or GDI |
| **Synthesis** | Shields, warp-in, psi abilities | Protoss vibes |
| **Swarm** | Creep, morphing, zerg rush | Guess |

### Why Bother

- **No install.** Click link, play.
- **Actual graphics.** GTAO, SSR, volumetric fog, TAA. Not a Flash game.
- **P2P.** No servers to shut down.
- **Replays.** Deterministic sim means every game is replayable.
- **AI that tries.** 5 difficulty tiers, from "my first RTS" to "I play ladder."

### Controls

| | |
|-|-|
| Left click | Select |
| Right click | Move/attack |
| Shift+click | Queue |
| Ctrl+1-9 | Set control group |
| 1-9 | Recall group |
| A+click | Attack-move |
| H | Hold |
| P | Patrol |

---

## Quick Start

```bash
git clone https://github.com/braedonsaunders/voidstrike.git
cd voidstrike
npm install
npm run dev
```

Chrome 113+ for WebGPU, or any modern browser falls back to WebGL2.

---

## Stack

| | |
|-|-|
| Next.js 16 | React 19, TypeScript 5 strict |
| Three.js r182 | WebGPU primary, WebGL2 fallback |
| TSL | Three.js Shading Language for effects |
| recast-navigation | WASM, same pathfinding as Unity/Godot/Unreal |
| Zustand | State |
| Nostr + WebRTC | Networking |

---

## Numbers

| | |
|-|-|
| 60 FPS | @ 200 units |
| 20 Hz | Fixed tick rate |
| ~300 MB | Memory |
| ~3s | Cold start |

Instanced rendering, spatial hashing, object pools, archetype caching.

---

## Layout

```
src/
├── engine/          # The reusable parts
│   ├── ecs/
│   ├── core/
│   ├── systems/
│   ├── pathfinding/
│   └── network/
├── rendering/       # Three.js layer
│   ├── tsl/
│   ├── compute/
│   └── effects/
├── data/            # Game-specific (swap this for a different game)
└── components/      # React UI
```

---

## Docs

| | |
|-|-|
| `docs/architecture/OVERVIEW.md` | How systems connect |
| `docs/architecture/rendering.md` | Shaders, effects, pipelines |
| `docs/architecture/networking.md` | P2P, determinism, desync |
| `docs/design/GAME_DESIGN.md` | Mechanics, balance |

---

## Contributing

Useful things:
- Tests for fixed-point edge cases
- More shader effects
- Smarter AI (current one is okay but predictable)
- Accessibility

```bash
npm run type-check
npm run lint
```

---

## License

MIT. Do whatever.

---

<div align="center">

*Browser games don't have to be bad.*

</div>
