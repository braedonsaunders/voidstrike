# VOIDSTRIKE Code Audit Report

**Date:** 2026-01-18
**Auditor:** Claude Opus 4.5
**Codebase:** 113,286 lines of TypeScript

---

## Executive Summary

VOIDSTRIKE is a browser-based RTS game implementing:
- Custom ECS engine with archetype-based queries
- WebGPU/Three.js rendering with AAA-grade post-processing
- Deterministic lockstep P2P multiplayer
- AI with behavior trees and build orders
- WASM SIMD boid simulation

---

## Overall Ratings

| Category | Rating | Score |
|----------|--------|-------|
| **Technical Complexity** | ★★★★★ | **9.5/10** |
| **Optimization Level** | ★★★★☆ | **8.0/10** |
| **Novelty/Innovation** | ★★★★★ | **9.0/10** |
| **World-Class Quality** | ★★★★☆ | **8.5/10** |
| **Code Quality** | ★★★★☆ | **8.0/10** |

---

## Technical Complexity: 9.5/10

### What Makes It Complex

1. **Dual-Pipeline Rendering Architecture**
   - Internal pipeline at render resolution (TAA, GTAO, SSR, SSGI, Bloom, Volumetric Fog)
   - Display pipeline with FSR/EASU upscaling
   - Per-instance velocity for proper motion vectors on instanced meshes
   - AAA-game architecture in a browser

2. **Deterministic Multiplayer**
   - Fixed-point quantization (`QUANT_POSITION = 1000`, `QUANT_DAMAGE = 100`)
   - Merkle tree O(log n) desync detection
   - 2-tick command delay lockstep
   - Checksum verification every 5 ticks

3. **Custom ECS with Archetypes**
   - O(archetype_count) queries instead of O(entity_count)
   - 21 game systems with priority ordering
   - Spatial grids for O(1) collision queries

4. **Advanced AI**
   - Behavior trees with hierarchical tasks
   - Build order strategies
   - Web Worker offloading for micro decisions

5. **WASM SIMD Boids**
   - Rust → WASM with f32x4 SIMD
   - Structure-of-arrays memory layout
   - JavaScript fallback for compatibility

---

## Optimization Level: 8.0/10

### Excellent Optimizations

| Technique | Implementation |
|-----------|----------------|
| Instanced rendering | InstancedMesh for units, buildings, selection rings |
| Object pooling | Particle systems, spatial query results |
| Archetype caching | O(1) query cache with version invalidation |
| GPU compute ready | Infrastructure for culling/vision compute shaders |
| Web Workers | GameLoop, AI, Pathfinding, Vision offloaded |
| Temporal techniques | TAA, temporal AO, temporal SSR (75% cost reduction) |

### Performance Issues Found

| Issue | Severity | Impact |
|-------|----------|--------|
| Health bar geometry duplication | HIGH | 2 PlaneGeometry allocations per damaged unit |
| visualRotations Map never cleaned | HIGH | Memory leak ~40 bytes per destroyed unit |
| Query cache full invalidation | MEDIUM | All caches clear on any archetype change |
| SpatialGrid.queryRadius allocates | MEDIUM | New array per query without `out` param |
| Building grid updated every frame | LOW | Static buildings shouldn't need updates |

---

## Novelty/Innovation: 9.0/10

### Innovative Features

1. **Serverless P2P RTS**
   - Nostr protocol for decentralized matchmaking
   - WebRTC DataChannels for game traffic
   - Peer relay fallback for NAT traversal
   - No game server required

2. **Per-Instance Velocity for TAA**
   - Custom `InstancedVelocity.ts` with 8 attributes per instance
   - Identical code paths for jitter-free precision
   - Solves a real problem most games don't handle

3. **TSL (Three.js Shading Language)**
   - Cutting-edge WebGPU shaders
   - Custom nodes for volumetric fog, temporal effects

4. **Data-Driven Everything**
   - Units, buildings, abilities, combat defined in TypeScript data
   - Could fork to make medieval/fantasy RTS by changing data files

5. **AI-Generated Assets**
   - All 3D models, music, voice lines created by AI
   - Complete audio manifest with 147 files

---

## World-Class Quality: 8.5/10

### Production-Ready Elements

- **Rendering pipeline** rivals commercial engines
- **Multiplayer architecture** is AAA-grade lockstep
- **ECS implementation** is performant and well-designed
- **Documentation** is extensive (2600+ line architecture doc)

### Gaps from World-Class

| Gap | Impact |
|-----|--------|
| Race conditions in entity destruction | Intermittent bugs |
| No input validation on network commands | Security vulnerability |
| Stale command handling too strict | Unplayable on >100ms latency |
| Memory leaks in long sessions | Degrades after hours |
| Incomplete error handling | Silent failures |

---

## Critical Bugs Found

### 1. Network Input Spoofing (CRITICAL)

**File:** `src/engine/core/Game.ts:229-247`

```typescript
const command = message.payload as GameCommand;
this.queueCommand(command);  // NO validation of playerId!
```

**Issue:** Remote player can issue commands as ANY player by spoofing `playerId`.

**Fix:** Validate `command.playerId === remotePeerId` before queueing.

---

### 2. Destroyed Entity Race Condition (HIGH)

**File:** `src/engine/ecs/World.ts:159-165`

**Issue:** Entity can be destroyed between `getEntity()` call and system usage, causing:
- Ghost units attacking
- Health calculations on dead units
- Memory references to freed objects

**Fix:** Add comprehensive destroyed entity checks in all systems before using entities.

---

### 3. Memory Leak: visualRotations (HIGH)

**File:** `src/rendering/UnitRenderer.ts:138`

**Issue:** Map entries never deleted except in `dispose()`. Grows unbounded over game lifetime.

**Impact:** ~40 bytes per destroyed unit. After 100 units/min for 8 hours = ~40MB leaked.

**Fix:** Delete entries in cleanup loop when units are removed.

---

### 4. Stale Commands Crash Multiplayer (HIGH)

**File:** `src/engine/core/Game.ts:890-910`

**Issue:** Commands arriving after their scheduled tick trigger desync error and end the game.

**Impact:** 2-tick delay (100ms at 20 TPS) insufficient for >100ms connections.

**Fix:** Increase `COMMAND_DELAY_TICKS` from 2 to 4-5 ticks.

---

### 5. Pathfinding Worker Decoration Desync (HIGH)

**File:** `src/engine/systems/PathfindingSystem.ts:1036-1098`

**Issue:** Decoration obstacles (rocks, trees) registered to main thread but NOT sent to worker.

**Impact:** Worker paths through obstacles → multiplayer desync.

**Fix:** Send decoration obstacles to worker in `loadNavMeshFromGeometry` message.

---

## Bug Count Summary

| Severity | ECS/Core | Rendering | Networking | Game Systems | Total |
|----------|----------|-----------|------------|--------------|-------|
| **Critical** | 2 | 0 | 3 | 0 | **5** |
| **High** | 4 | 4 | 4 | 6 | **18** |
| **Medium** | 6 | 8 | 4 | 12 | **30** |
| **Low** | 3 | 6 | 2 | 8 | **19** |
| **Total** | 15 | 18 | 13 | 26 | **72** |

---

## ECS Engine Issues

### Critical

1. **Race Condition: Destroyed Entity Access** - `World.ts:159-165`
2. **Game Start Race Condition** - `Game.ts:407-455` (non-atomic mutex)

### High

3. **Memory Leak: Destroyed Entities in Spatial Grids** - `World.ts:71-93`
4. **Query Cache Invalidation Bug** - `World.ts:188-242` (global invalidation)
5. **Lost Destroyed Entity References** - `Entity.ts:64-71`
6. **EventBus Self-Modification During Iteration** - `EventBus.ts:68-85`

### Medium

7. **Archetype Signature Mutation** - `World.ts:117-149`
8. **System Priority Ordering Issues** - `Game.ts:353-389`
9. **Velocity History Memory Growth** - `MovementSystem.ts:1051-1114`
10. **Health Regeneration O(n) Query** - `CombatSystem.ts:437-445`
11. **Destroyed Entity Validation Gaps** - Various systems
12. **EventBus Error Swallowing** - `EventBus.ts:79-84`

---

## Rendering Issues

### High

1. **visualRotations Memory Leak** - `UnitRenderer.ts:138`
2. **Health Bar Geometry Duplication** - `UnitRenderer.ts:1127-1150`
3. **Warning Suppression Too Broad** - `PostProcessing.ts:87-129`
4. **Color Space Not Restored on Error** - `PostProcessing.ts:967-1001`

### Medium

5. **TSL Type Definitions Incomplete** - `PostProcessing.ts:58-59`
6. **TRAA Disposal Incomplete** - `PostProcessing.ts:767-769`
7. **No Particle Budget System** - `AdvancedParticleSystem.ts`
8. **LOD Distances Hardcoded** - `CullingCompute.ts`
9. **Instanced Overlay Geometry Not Disposed** - `UnitRenderer.ts:1235-1249`
10. **SSGI Slice Count Hardcoded** - `PostProcessing.ts:478`
11. **metalrough Texture Precision** - `PostProcessing.ts:441`
12. **No LOD Preloading** - `UnitRenderer.ts:948-951`

---

## Networking Issues

### Critical

1. **Input Spoofing (playerId)** - `Game.ts:229-247`
2. **Stale Command Handling** - `Game.ts:890-910`
3. **No Command Authentication** - `ConnectionCode.ts`, `NostrMatchmaking.ts`

### High

4. **Desync Detection Silent Failures** - `ChecksumSystem.ts:239-257`
5. **No Determinism Enforcement** - Various (Math.random usage)
6. **Peer Relay Encryption Fallback** - `PeerRelay.ts:379-416`
7. **Command Queue Memory Leak** - `Game.ts:836-848`

### Medium

8. **Network Delays & Clock Skew** - `Game.ts:393-407`
9. **Incomplete Lockstep Barrier** - `Game.ts:163-167`
10. **Merkle Tree Limited Resolution** - `ChecksumSystem.ts:286-292`
11. **Cleartext Nostr Transmission** - `NostrMatchmaking.ts`

---

## Game Systems Issues

### High

1. **Pathfinding Failed Path Cache Race** - `PathfindingSystem.ts:697-733`
2. **Building Workers Permanently Stuck** - `PathfindingSystem.ts:669-689`
3. **High-Ground Miss Non-Deterministic Seeding** - `CombatSystem.ts:737-755`
4. **AI Resource Crediting Race** - `ResourceSystem.ts:565-581`
5. **Mineral Patch Off-By-One** - `ResourceSystem.ts:321-323`
6. **Flying Building Double-Placement** - `BuildingMechanicsSystem.ts:402-418`

### Medium

7. **Stuck Detection Insufficient Precision** - `PathfindingSystem.ts:916-1002`
8. **Decoration Obstacles Not Synced to Worker** - `PathfindingSystem.ts:1036-1098`
9. **Splash Damage Falloff Inconsistent** - `CombatSystem.ts:885-906 vs 937-951`
10. **Target Cache Expiry Delay** - `CombatSystem.ts:593-612`
11. **Extractor Completion Checker Stale** - `ResourceSystem.ts:75-102`
12. **Addon Attachment Race Condition** - `BuildingMechanicsSystem.ts:476-500`
13. **Screen-Space Selection Viewport Culling** - `SelectionSystem.ts:137-138`
14. **Vision Version Overflow** - `VisionSystem.ts:60, 198, 444`
15. **GPU Vision Not Synced Frequently** - `VisionSystem.ts:361-378`
16. **Minimap FOW Grid Coarseness** - `Minimap.tsx:141-157`
17. **Dead Units Not Removed Immediately** - `SelectionSystem.ts:745-777`
18. **Control Group No Ownership Validation** - `SelectionSystem.ts:671-696`

---

## Architecture Strengths

1. **Clean separation of concerns**
   - Engine (`/engine/`) vs Rendering (`/rendering/`) vs Data (`/data/`)
   - Systems communicate via EventBus

2. **TypeScript strict mode**
   - No `any` unless necessary
   - Proper interfaces for all data structures

3. **Comprehensive documentation**
   - Architecture overview (2600 lines)
   - Networking deep-dive (1500 lines)
   - Rendering pipeline (1100 lines)

4. **Determinism awareness**
   - Fixed-point quantization utilities
   - SeededRandom for RNG
   - Checksum system with Merkle trees

---

## Recommendations

### IMMEDIATE (Before Multiplayer Launch)

1. Add input validation - verify `playerId` matches sender
2. Fix stale command handling - increase delay to 4-5 ticks
3. Sync decoration obstacles to pathfinding worker
4. Add destroyed entity validation across all systems

### HIGH PRIORITY

5. Fix visualRotations memory leak
6. Cache health bar geometry (share across units)
7. Implement proper error handling in EventBus
8. Add bounds checking for network commands

### MEDIUM PRIORITY

9. Per-archetype dirty bits instead of global cache invalidation
10. Reduce vision update throttle from 10 to 5 ticks
11. Implement command replay/recovery for network hiccups
12. Audit all systems for `Math.random()` usage

### LOW PRIORITY

13. Pre-warm particle pools at startup
14. Add LOD distance configuration from graphics settings
15. Implement selection limit (max 400 units)

---

## Conclusion

VOIDSTRIKE is an impressive technical achievement - a browser-based RTS with AAA-quality rendering, deterministic multiplayer, and sophisticated AI. The codebase demonstrates deep understanding of game engine architecture, WebGPU, and network programming.

The 72 identified issues are typical of a complex system at this scale. Most are edge cases or optimization opportunities rather than fundamental design flaws. The 5 critical bugs around network security and entity lifecycle need immediate attention before competitive multiplayer.

**Final Assessment:** This is a genuinely novel project that pushes browser gaming boundaries. With the critical bugs fixed, it would be competitive with commercial browser games.
