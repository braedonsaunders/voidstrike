# Performance Optimization Analysis

**Generated:** 2026-01-18
**Codebase Version:** Based on current architecture analysis

---

## Executive Summary

30 suggestions analyzed → **15 unique optimizations** after deduplication.
8 are **validated and recommended**, 4 are **conditionally recommended**, 3 are **not recommended**.

---

## Deduplication Results

| Merged Suggestion | Original Sources |
|-------------------|------------------|
| GPU-Driven Indirect Draw | List1 #2, List2 #1, List3 #1 |
| GPU Compute Vision/Fog | List1 #9, List2 #3, List3 #5 |
| Rollback Netcode | List1 #7, List2 #8, List3 #3 |
| Temporal Upscaling | List1 #5, List2 #2, List3 #7 |
| WASM SIMD Batching | List2 #5, List3 #8 |
| Merkle Tree Checksums | List2 #4, List3 #4 |
| Delta State Compression | List1 #3, List2 #9 |
| Improved Spatial Queries | List1 #6, List3 #9 |
| ECS/Archetype Optimization | List1 #1, List2 #7, List2 #10 |

---

## Validated & Ranked Optimizations

### Ranking Criteria

| Metric | Description |
|--------|-------------|
| **Impact** | Performance gain (1-5, 5=highest) |
| **Complexity** | Implementation difficulty (1-5, 5=hardest) |
| **Lines** | Estimated new code lines |
| **Risk** | Chance of bugs/regressions (1-5, 5=riskiest) |
| **Score** | Impact × 2 - Complexity - Risk (higher = better) |

---

## Tier 1: High Impact, Low Risk (Implement First)

### 1. GPU Compute Vision/Fog of War
**Score: 7** | Impact: 5 | Complexity: 2 | Lines: ~300 | Risk: 2

**Current State:**
- `VisionSystem.ts` + `vision.worker.ts`
- Grid-based, 10-tick update interval (500ms)
- Web Worker with Uint8Array transfer

**Proposed Change:**
- WebGPU compute shader for vision raycasting
- All units processed in parallel on GPU
- Output directly to texture for fog rendering

**Validation:** ✅ VALIDATED
- WebGPU infrastructure already exists
- Vision is embarrassingly parallel
- No game logic dependencies on intermediate state

**Why Highest Priority:**
- Current 10-tick interval feels sluggish
- GPU can process 1000+ vision casters per frame
- Enables per-pixel fog instead of grid-based
- Infrastructure (WebGPU, compute shaders) already proven

```
ROI: Very High
Bottleneck: Vision worker is rate-limited to 2Hz
Solution: GPU parallelism → 60Hz possible
```

---

### 2. Merkle Tree State Checksums
**Score: 6** | Impact: 4 | Complexity: 2 | Lines: ~200 | Risk: 2

**Current State:**
- `ChecksumSystem.ts`: Simple XOR hash of positions + health
- Full state dump on desync (10 states kept)
- O(n) comparison when desyncs occur

**Proposed Change:**
- Hierarchical Merkle tree over archetypes
- Binary search to find exact divergence point
- O(log n) desync detection

**Validation:** ✅ VALIDATED
- Pure CPU change, no rendering impact
- Existing checksum infrastructure easy to extend
- Critical for multiplayer debugging

**Why High Priority:**
- Desync debugging is currently painful
- Low implementation risk
- Multiplicative benefit as entity counts grow

---

### 3. Temporal Reprojection for Effects
**Score: 5** | Impact: 4 | Complexity: 3 | Lines: ~400 | Risk: 2

**Current State:**
- `PostProcessing.ts`: GTAO, SSR at render resolution
- Per-instance velocity already implemented for TRAA
- FSR 1.0 EASU for upscaling

**Proposed Change:**
- Run GTAO/SSR at 1/4 resolution
- Reproject using existing velocity buffer
- Composite with current frame

**Validation:** ✅ VALIDATED
- Velocity buffer infrastructure EXISTS (this is rare in browser games)
- TRAA already uses temporal accumulation
- 16x performance gain for expensive effects

**Why High Priority:**
- You already have 90% of the infrastructure
- Quarter-res GTAO + reprojection looks nearly identical
- Post-processing is significant GPU cost

---

### 4. Hierarchical Interest Management
**Score: 5** | Impact: 4 | Complexity: 2 | Lines: ~250 | Risk: 3

**Current State:**
- All entities simulated equally every tick
- No LOD for simulation (only rendering)
- Full AI/movement/combat updates for off-screen units

**Proposed Change:**
- Define interest regions around camera/player units
- Off-screen entities: reduced tick rate (every 4-8 ticks)
- Far entities: coarse movement, no micro AI

**Validation:** ✅ VALIDATED
- Systems already have tick-based update intervals
- VisionSystem already tracks visibility
- Low risk - graceful degradation

**Why High Priority:**
- 200 units visible, 800 total = 4x reduction in simulation work
- Complements existing visibility system
- Players can't perceive off-screen micro differences

---

## Tier 2: High Impact, Medium Complexity

### 5. WASM SIMD for Boids/Movement
**Score: 4** | Impact: 4 | Complexity: 3 | Lines: ~500 | Risk: 3

**Current State:**
- `MovementSystem.ts`: 2,149 lines of JavaScript
- Boids forces: separation, cohesion, alignment, arrival
- Per-unit iteration in JS

**Proposed Change:**
- SoA layout for positions/velocities
- WASM module with f32x4 SIMD operations
- 4-8 units processed per instruction

**Validation:** ✅ VALIDATED
- MovementSystem is CPU-bound for large battles
- WASM SIMD well-supported in modern browsers
- Recast already proves WASM integration works

**Considerations:**
- Requires SoA refactor (positions contiguous in memory)
- Need to maintain JS fallback
- 4-8x throughput for bulk updates

---

### 6. GPU-Driven Indirect Draw
**Score: 4** | Impact: 5 | Complexity: 4 | Lines: ~600 | Risk: 3

**Current State:**
- `UnitRenderer.ts`: CPU sets instance matrices
- LOD selection on CPU
- Instanced draw calls per unit type

**Proposed Change:**
- GPU storage buffer for all transforms
- Compute shader: frustum culling + LOD selection
- Write DrawIndirect commands directly
- Single drawIndirect regardless of unit count

**Validation:** ✅ VALIDATED
- WebGPU infrastructure exists
- Instancing infrastructure exists
- Eliminates CPU-GPU sync bottleneck

**Why Not Tier 1:**
- More complex Three.js integration
- Current instancing works well up to ~500 units
- Higher implementation risk

---

### 7. Flow Field Pathfinding (GPU Compute)
**Score: 3** | Impact: 4 | Complexity: 4 | Lines: ~700 | Risk: 3

**Current State:**
- `PathfindingSystem.ts`: Recast Navigation WASM
- Per-unit path queries
- 16 paths/frame cap

**Proposed Change:**
- Compute shader builds flow field for destination
- All units sample field (O(1) per unit)
- Complementary to Recast for large groups

**Validation:** ✅ VALIDATED
- Perfect for "all units to same destination" commands
- GPU parallelism for field generation
- Supreme Commander proved this scales

**Considerations:**
- Keep Recast for individual paths
- Flow fields for 10+ units to same destination
- Hybrid approach recommended

---

### 8. Improved Spatial Queries (BVH or Hierarchical Grid)
**Score: 3** | Impact: 3 | Complexity: 3 | Lines: ~400 | Risk: 3

**Current State:**
- `SpatialGrid.ts`: 10x10 cell grid
- O(1) average for cell lookup
- Distance post-filter

**Proposed Change:**
- Cache-coherent BVH with Morton coding OR
- Hierarchical grid with temporal coherence
- SIMD-friendly traversal

**Validation:** ✅ VALIDATED
- Current grid works but doesn't scale past 500+ units
- BVH better for variable-density distributions
- Temporal coherence: most entities don't move

**Why Tier 2:**
- Current grid is "good enough" for now
- Benefits mainly at scale

---

## Tier 3: Conditionally Recommended

### 9. Delta-Compressed State Storage
**Score: 2** | Impact: 3 | Complexity: 3 | Lines: ~350 | Risk: 4

**Current State:**
- Full state snapshots for checksum
- Commands stored in replay

**Proposed Change:**
- Keyframe every N ticks
- Delta encoding for transforms, health
- Video-codec-inspired compression

**Validation:** ⚠️ CONDITIONAL
- Benefits replay file size significantly
- Risk: Complexity in reconstruction
- Recommend AFTER Merkle trees implemented

---

### 10. Speculative Archetype Transitions
**Score: 2** | Impact: 3 | Complexity: 3 | Lines: ~200 | Risk: 4

**Current State:**
- Archetype transitions immediate
- Query cache invalidated on change

**Proposed Change:**
- Defer transitions to frame end
- Batch all moves
- Single bulk memcpy

**Validation:** ⚠️ CONDITIONAL
- Benefits visible only with mass entity changes
- 100 units dying same frame = noticeable win
- Risk: Ordering dependencies in systems

---

### 11. Predictive Pathfinding
**Score: 2** | Impact: 3 | Complexity: 3 | Lines: ~300 | Risk: 4

**Current State:**
- Paths computed on command
- 16 paths/frame via worker

**Proposed Change:**
- Track selection + cursor position
- Pre-compute paths to likely destinations
- Instant response when command issued

**Validation:** ⚠️ CONDITIONAL
- Speculative execution adds complexity
- Benefits mainly for competitive play
- Consider AFTER flow fields implemented

---

### 12. Rollback Netcode (GGPO-style)
**Score: 1** | Impact: 4 | Complexity: 5 | Lines: ~1500 | Risk: 5

**Current State:**
- Lockstep planned (not yet wired)
- Deterministic systems exist

**Proposed Change:**
- Speculative execution up to N frames
- Rollback on remote input arrival
- Input delay masking

**Validation:** ⚠️ CONDITIONAL - DEFER
- RTS scale makes this extremely hard (1000+ entities)
- Fighting games roll back ~10 objects, RTS rolls back 1000
- Recommend: Implement basic lockstep first, THEN consider rollback

**Why Low Score Despite High Impact:**
- Complexity explosion
- Networking not even wired yet
- Premature optimization

---

## Not Recommended

### 13. JIT-Compiled Game Rules (WASM)
**Score: -1** | Impact: 2 | Complexity: 5 | Lines: ~1000 | Risk: 5

**Validation:** ❌ NOT RECOMMENDED
- Combat is NOT the bottleneck
- Damage calculations are trivial
- Over-engineered for problem that doesn't exist
- Maintenance nightmare

---

### 14. Neural Network Micro Controller
**Score: -2** | Impact: 3 | Complexity: 5 | Lines: ~800+ | Risk: 5

**Validation:** ❌ NOT RECOMMENDED
- ONNX in browser works but is fragile
- Behavior trees already functional
- Model training/maintenance burden
- Debugging ML micro is painful

---

### 15. Visibility Buffer Rendering
**Score: -1** | Impact: 3 | Complexity: 5 | Lines: ~1000 | Risk: 5

**Validation:** ❌ NOT RECOMMENDED
- Three.js doesn't support this natively
- Current forward instancing works well
- Deferred texturing requires custom render pipeline
- Benefits unclear for RTS camera angles

---

## Implementation Roadmap

### Phase 1: Quick Wins (1-2 weeks effort each)
1. **GPU Compute Vision** - Biggest single improvement
2. **Merkle Tree Checksums** - Essential for multiplayer debugging
3. **Temporal Reprojection** - Leverage existing velocity infrastructure

### Phase 2: Scaling Improvements
4. **Hierarchical Interest Management** - Reduce simulation load
5. **WASM SIMD Movement** - Unlock large battles

### Phase 3: Advanced GPU
6. **GPU-Driven Indirect Draw** - When hitting 500+ unit limits
7. **Flow Field Pathfinding** - Complement to Recast

### Phase 4: Future Considerations
8. **Improved Spatial Queries** - When grid becomes bottleneck
9. **Delta Compression** - After Merkle trees stable
10. **Rollback Netcode** - After lockstep working and tested

---

## Validation Summary

| # | Suggestion | Status | Reason |
|---|------------|--------|--------|
| 1 | GPU Compute Vision | ✅ Validated | Infrastructure exists, embarrassingly parallel |
| 2 | Merkle Tree Checksums | ✅ Validated | Low risk, high debugging value |
| 3 | Temporal Reprojection | ✅ Validated | Velocity buffer already exists |
| 4 | Hierarchical Interest | ✅ Validated | Visibility system can drive this |
| 5 | WASM SIMD Movement | ✅ Validated | Recast proves WASM works |
| 6 | GPU Indirect Draw | ✅ Validated | WebGPU ready, higher complexity |
| 7 | Flow Field Pathfinding | ✅ Validated | Proven in other RTS games |
| 8 | Better Spatial Queries | ✅ Validated | Benefits at scale |
| 9 | Delta Compression | ⚠️ Conditional | After Merkle trees |
| 10 | Archetype Batching | ⚠️ Conditional | Benefits with mass changes |
| 11 | Predictive Pathfinding | ⚠️ Conditional | After flow fields |
| 12 | Rollback Netcode | ⚠️ Conditional | After lockstep stable |
| 13 | JIT Game Rules | ❌ Rejected | Over-engineered |
| 14 | Neural Network Micro | ❌ Rejected | Maintenance burden |
| 15 | Visibility Buffer | ❌ Rejected | Three.js incompatible |

---

## Novel Ideas Worth Noting

These suggestions contain genuinely innovative elements:

1. **ML-assisted ECS optimization** (List1 #1) - Novel concept, but overkill for current scale
2. **Warp-cooperative instancing** (List1 #2) - WebGPU enables this, Three.js doesn't expose it yet
3. **Video codec techniques for ECS** (List1 #3) - Interesting cross-domain application
4. **Tile classification for post-processing** (List1 #5) - Adaptive quality per-region is clever

---

## Appendix: Current Architecture Baseline

| System | Current Implementation | Bottleneck |
|--------|----------------------|------------|
| Rendering | Instanced meshes, 100/type, LOD | CPU matrix updates |
| ECS | Archetype + query cache | Component iteration |
| Pathfinding | Recast WASM + worker | 16 paths/frame cap |
| Vision | Web worker, 10-tick interval | 2Hz update rate |
| Spatial | 10x10 grid | O(cells) for large queries |
| Post-proc | Full-res GTAO/SSR | GPU fillrate |
| AI | Behavior trees + worker | Threat assessment |
| Networking | P2P Nostr (not wired) | N/A |

**Key Files Referenced:**
- `src/engine/systems/VisionSystem.ts`
- `src/engine/systems/ChecksumSystem.ts`
- `src/engine/systems/MovementSystem.ts`
- `src/engine/systems/PathfindingSystem.ts`
- `src/engine/core/SpatialGrid.ts`
- `src/rendering/UnitRenderer.ts`
- `src/rendering/tsl/PostProcessing.ts`
- `src/workers/vision.worker.ts`
