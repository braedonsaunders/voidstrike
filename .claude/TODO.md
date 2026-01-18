# VOIDSTRIKE - Development Roadmap

## Current Priority: SC2 Parity (Single-Player)

> See **ROADMAP_SC2_PARITY.md** for comprehensive feature breakdown

---

## Web Worker Performance Optimization (January 2026) ✓

### Vision System Worker
- [x] **vision.worker.ts** - Off-thread fog of war calculation
- [x] **VisionSystem integration** - Uses worker when available, main thread fallback
- [x] **TypedArray transfer** - Uint8Array vision maps for efficient serialization
- [x] **Watch tower support** - Tower control and vision grant computed in worker
- [x] **Version tracking** - Stale results discarded, dirty checking for renderers

### AI Decisions Worker
- [x] **ai-decisions.worker.ts** - Off-thread micro decision-making
- [x] **AIWorkerManager** - Singleton manager for worker lifecycle
- [x] **Threat assessment** - Distance, DPS, priority-based threat scoring
- [x] **Kite decisions** - Ranged units kite away from close enemies
- [x] **Retreat decisions** - Low health units retreat to base
- [x] **Transform decisions** - Valkyrie-like units switch modes based on nearby threats
- [x] **Focus fire** - Target switching for low-health enemies
- [x] **AIMicroSystem integration** - Non-blocking request/response pattern

### Performance Gains (Estimated)
- Vision worker: ~5-8ms saved per update (every 10 ticks)
- AI worker: ~8-15ms saved per update (every 8 ticks)
- Combined: 25-40ms main thread savings per tick in large games

---

## Multiplayer Security & Sync Fixes (January 2026) ✓

### Critical Security Fixes
- [x] **Command authorization check** - Game.ts now validates entity ownership before processing commands
- [x] **Checksum network transmission** - ChecksumSystem events now wired to sendMultiplayerMessage()
- [x] **Stale command desync detection** - Stale commands now trigger desync instead of silent drop

### Determinism Fixes
- [x] **fpMul overflow fix** - FixedPoint.ts uses BigInt for overflow-safe 64-bit multiplication
- [x] **Deterministic sqrt** - deterministicDistance() uses integer sqrt instead of Math.sqrt
- [x] **AI-aware ProductionSystem** - ProductionSystem checks if owner is AI, skips client store

### Resilience Improvements
- [x] **Command buffer early warning** - multiplayerStore warns at 80% capacity, triggers network pause
- [x] **Crowd agent limit warning** - MovementSystem logs warning when agent add fails
- [x] **Deterministic audio** - AudioSystem uses SeededRandom instead of Math.random()

---

## Simulation-Based AI Economy (January 2026) ✓

### SC2-Style Worker Economy
- [x] **Removed passive AI income** - AI no longer gets fake income from worker count
- [x] **Real worker gathering** - AI workers now actually gather resources and return them to base
- [x] **Resource crediting via events** - ResourceSystem credits AI via `aiSystem.creditResources()`
- [x] **Mining speed multiplier** - Higher difficulty AI gets faster mining (1.25x very_hard, 1.5x insane)
- [x] **Worker death tracking** - AI detects worker deaths and calculates replacement priority
- [x] **Emergency worker production** - New macro rule with priority 120 when workerReplacementPriority >= 0.5
- [x] **Worker auto-reassignment** - Workers automatically find new resources when their patch depletes
- [x] **Resource depletion tracking** - AI tracks depleted patches near bases for expansion decisions
- [x] **Depletion-based expansion** - New macro rule triggers expansion when 3+ patches deplete

### Economy Metrics System
- [x] **AIEconomySystem** - New system tracking income rate, worker efficiency, saturation
- [x] **Income per minute calculation** - Rolling window tracks minerals/vespene per minute
- [x] **Debug logging** - Periodic economy metrics output for debugging
- [x] **Event-based tracking** - Listens to `resource:delivered` events

### Configuration Updates
- [x] **DifficultySettings.miningSpeedMultiplier** - Replaced resourceMultiplier (passive) with miningSpeedMultiplier (active)
- [x] **Removed workerIncomePerTick** - Economy config no longer has passive income fields
- [x] **New condition types** - Added `workerReplacementPriority`, `depletedPatchesNearBases` to macro rules

---

## Selection System Improvements (January 2026) ✓

### Screen-Space Selection
- [x] **Screen-space box selection** - Selection done in screen coordinates for perspective-accurate selection
- [x] **Screen-space click selection** - Click detection uses screen coordinates for flying units
- [x] **Selection radius buffer** - Uses circle-rectangle intersection so partial overlaps count as selected
- [x] **Visual height support** - Flying units/buildings selectable at their visual position (8 units above ground)
- [x] **Visual scale support** - Larger units (>300 HP) get 50% bigger hitboxes for easier selection
- [x] **Dynamic flying detection** - visualHeight updates when units transform or buildings lift off/land

### Improved Accuracy
- [x] **Terrain convergence** - Increased from 3 to 6 iterations with early termination
- [x] **Minimum drag threshold** - 10px minimum for box selection, smaller drags become clicks
- [x] **Priority-based selection** - Units selected over buildings when both in selection box

---

## WebGPU Renderer Migration (January 2026) ✓

### Three.js r182 Upgrade
- [x] Upgraded Three.js from r160 to r182 (latest stable)
- [x] Updated TSL imports to new `three/webgpu` and `three/tsl` paths
- [x] Fixed breaking API changes (BufferSource types)

### WebGPU Feature Parity
- [x] Ported GameOverlayManager to WebGPUGameCanvas (terrain, elevation, threat overlays)
- [x] Ported CommandQueueRenderer to WebGPUGameCanvas (shift-click waypoint visualization)
- [x] Added keyboard handlers for repair mode ('R') and overlay cycling ('O')
- [x] Added graphics settings reactivity (exposure, post-processing)
- [x] Added control group support with double-tap camera centering

### Codebase Cleanup
- [x] Deleted legacy GameCanvas.tsx (original WebGL-only)
- [x] Deleted HybridGameCanvas.tsx (replaced by WebGPUGameCanvas)
- [x] Deleted VoidstrikePostProcessing.ts (replaced by TSL RenderPipeline)
- [x] Deleted VoidstrikeSelectionSystem.ts (replaced by TSL SelectionSystem)
- [x] Deleted VoidstrikeParticleSystem.ts (replaced by TSL GPUParticleSystem)
- [x] Updated /app/game/page.tsx to use WebGPUGameCanvas as primary

### TSL Visual Systems
- [x] SelectionSystem (TSL) - Team-colored selection rings with animations
- [x] GPUParticleSystem (TSL) - GPU-instanced particles via EffectEmitter
- [x] RenderPipeline (TSL) - Post-processing (bloom, SSAO, FXAA, vignette)
- [x] ProceduralTerrainMaterial (TSL) - Unused but available
- [x] TextureTerrainMaterial (TSL) - Unused but available

---

## SC2-Level Visual Overhaul (January 2026) ✓

### Cinematic Homescreen (January 2026) ✓
- [x] **HomeBackground.tsx** - Cinematic Three.js animated background for homepage
- [x] **Void Nebula Shader** - Procedural shader with fBM noise, mouse reactivity
- [x] **Star Field System** - 3000+ animated stars with twinkling
- [x] **Asteroid Field** - Floating deformed asteroids with rotation
- [x] **Energy Stream Particles** - 5 particle streams flowing toward center
- [x] **Post-Processing** - Bloom, chromatic aberration, vignette
- [x] **Cinematic Camera** - Mouse-following with breathing motion parallax
- [x] **Glassmorphism UI** - Redesigned homepage with translucent cards, animated counters
- [x] **Faction Showcases** - Interactive faction cards with hover effects, stats display

### Hybrid Architecture
- [x] **Three.js + Phaser 4 hybrid** - 3D world with 2D overlay system
- [x] **HybridGameCanvas** - Main component combining both engines
- [x] **OverlayScene** - Phaser 4 scene for tactical view and screen effects

### SC2-Level Rendering Systems
- [x] **SC2SelectionSystem** - Animated glowing selection rings with GLSL shaders
- [x] **SC2ParticleSystem** - GPU-instanced particles (muzzle flashes, explosions, debris)
- [x] **SC2PostProcessing** - Bloom, vignette, color grading, ACES tone mapping (fixed black screen bug)
- [x] **SC2TerrainShader** - Multi-layer procedural texturing with PBR-like lighting

### Visual Features
- [x] Team-colored pulsing selection rings with shimmer animation
- [x] Tactical overlay mode (toggle with backtick key)
- [x] Combat intensity screen effects (border glow, damage vignette)
- [x] Alert system with animated banners
- [x] Off-screen attack warning indicators
- [x] Screen shake on damage

---

## Critical Performance Fixes (January 2026)

### Fixed Issues (Round 1)
- [x] **Shadow mapping disabled** - 2048x2048 PCFSoftShadowMap causing <1 FPS on M1
- [x] **FogOfWar throttled** - Reduced from 60 FPS to 10 FPS updates
- [x] **Minimap throttled** - Reduced from 60 FPS to 15 FPS rendering
- [x] **React re-renders reduced** - SelectionPanel/ProductionQueue from 10 FPS to 4-5 FPS
- [x] **Renderer optimized** - Disabled antialiasing, capped pixel ratio to 1.5

### Fixed Issues (Round 2 - Deep Dive)
- [x] **Resource PointLights removed** - CRITICAL: 20+ PointLights were killing the GPU
- [x] **BuildingRenderer traverse() optimized** - Only traverse() on state change, not every frame
- [x] **Damage number spam limited** - Max 15 active, reduced duration to 0.7s
- [x] **Resource rotation removed** - Static rotation instead of animating every frame

### Fixed Issues (Round 3 - January 2026)
- [x] **Post-processing disabled by default** - Heavy render passes causing FPS drops
- [x] **Zustand store updates throttled** - From 60Hz to 10Hz to reduce React re-renders
- [x] **Vibrant terrain colors** - Increased saturation and reduced vertex color influence
- [x] **Building terrain positioning** - Buildings sometimes rendered underground. Added fallback height calculation when terrain not initialized.
- [x] **Enhanced terrain generation** - Implemented proper Perlin/Simplex noise, fBM, ridged noise, and Voronoi patterns for natural-looking terrain with THREE.Terrain-style algorithms.

---

## Critical Bug Fixes (January 2026)

### Gameplay Bugs Fixed
- [x] **AI unit ownership bug** - Units from AI buildings were assigned to player1 (hardcoded)
- [x] **Orbital Command model not updating** - BuildingRenderer didn't detect buildingId changes
- [x] **Workers going to enemy base** - Drop-off didn't check ownership or include upgraded bases
- [x] **Duplicate start buttons** - Moved start button to bottom of setup page
- [x] **AI spending player minerals** - BuildingPlacementSystem was deducting from player store for AI buildings
- [x] **Minimap camera position not updating** - Fixed store subscription and dependency array
- [x] **SC2TerrainShader not compiling** - Replaced dynamic fbm loop with fixed-octave versions for WebGL
- [x] **AI workers stuck at CC** - Drop-off distance was 3 units but CC center is 2.5 from edge, increased to 5
- [x] **AI deposits to player store** - ResourceSystem now only credits player1 store, AI tracks internally
- [x] **SC2-style mineral arcs** - Minerals now form tight arcs facing CC, ~7 units away (was 15-20)
- [x] **Worker mineral splitting** - Workers auto-spread across mineral patches, prefer <2 gatherers
- [x] **SC2-style flat terrain** - Buildable areas now perfectly flat, only cliffs have height variation
- [x] **Building placement grid** - Green/red tile visualization when placing buildings
- [x] **Phaser overlay integration** - Fixed event mismatches, added production/research/building alerts
- [x] **Combat feedback** - Player damage vignette, unit death effects, enhanced combat border
- [x] **Resource warnings** - "NOT ENOUGH MINERALS/VESPENE", "SUPPLY BLOCKED" alerts
- [x] **Ability splashes** - Major ability notifications (Stim Pack, Yamato Cannon)
- [x] **Rally point visibility** - Rally points now properly show when production buildings are selected
- [x] **Rally point right-click** - Right-clicking with building selected sets rally point
- [x] **Building placement elevation** - Placement grid follows terrain height on elevated areas
- [x] **Minimap fog of war** - Enemy units/buildings no longer visible through fog of war
- [x] **3D model integration** - AssetManager wired to load decoration models (trees, rocks, Xel'Naga tower)

### Unit Collision Fixes
- [x] **Worker physics push collision bug** - Workers (fabricators) were avoiding each other when gathering minerals due to physics push force not exempting worker-to-worker interactions. Separation force already exempted workers, but physics push did not. Fixed by adding worker exemption to `calculatePhysicsPush` in MovementSystem.

### Audio System Fixes
- [x] **"Not enough resources" alert audio fix** - Audio was not playing for resource insufficiency alerts. Systems were emitting `'ui:error'` events but AudioSystem was listening for `'alert:notEnoughMinerals'` and `'alert:notEnoughVespene'`. Fixed by updating ProductionSystem, BuildingPlacementSystem, ResearchSystem, and WallSystem to emit the correct alert events alongside the visual warning events.
- [x] **Music toggle persistence** - Music on/off state (and all audio settings) now persists across page reloads via localStorage. Added `saveAudioSettings()` and `loadAudioSettings()` functions to uiStore.ts that save/restore musicEnabled, soundEnabled, volumes, and granular audio settings.

### Phaser4 Overlay Fixes
- [x] **Team marker/selection ring positioning bug** - Ground rings appeared way above the map in battle simulator because InstancedMesh rotation was transforming instance matrix coordinates (Y/Z swap). Fixed by applying rotation per-instance via quaternion instead of on mesh parent.
- [x] **Damage number player colors** - Damage numbers now use the unit owner's player color with brightness gradient (lighter for low damage, darker for high damage). Also reduced font size from 18px to 12px for cleaner appearance.

### Building System Fixes
- [x] **Building construction completion bug** - Buildings would stay translucent, construction particles wouldn't disappear, buildings could resize incorrectly. Fixed material array handling and construction effect cleanup when switching to instanced rendering.
- [x] **Instanced rendering scale bug** - Buildings using instanced rendering appeared extremely small because the geometry was used without the model's normalization scale. Fixed by tracking and applying modelScale to instance matrices.
- [x] **Layer-by-layer construction reveal** - Replaced opacity-only animation with clipping plane reveal. Buildings now reveal from bottom to top with construction particles at the build height.
- [x] **Supply depot/refinery heights** - Fixed target heights (supply_depot: 0.9→1.8, refinery: 2.0→2.5) to match procedural versions and prevent buildings from appearing half in the ground.
- [x] **Orphaned blueprint defeat bug** - Players could avoid defeat by having building blueprints (waiting_for_worker state) even with no complete buildings. Fixed by: (1) Victory condition now only counts complete buildings, not blueprints. (2) Blueprints are automatically cancelled and resources refunded when the assigned worker is reassigned to another task.
- [x] **Building completion health bug** - Buildings completed at low health and on fire because ProductionSystem was also calling updateConstruction() without updating health, racing with BuildingPlacementSystem. Fixed by removing duplicate construction handling from ProductionSystem.

### Resource Rendering Fixes (January 2026)
- [x] **Debug logging for resource rendering** - Added comprehensive logging to trace mineral/vespene spawning and instanced mesh creation
- [x] **Resource geometry validation** - Added safety check for models with < 3 vertices, fallback to procedural geometry
- [x] **yOffset/baseScale clamping** - Prevent resources from rendering underground or at invisible scales due to bad model transforms
- [x] **Natural expansion minerals not visible** - Fixed by clamping baseScale to >= 0.1. The minerals.glb model normalization was causing baseScale to be ~0.02, making minerals invisible.
- [x] **Watch tower vision ring artifacts** - Removed decorative vision range rings from MapDecorations that were causing "eye-shaped shadow" visual artifacts on maps with multiple watch towers.

### SCV Repair System Fixes (January 2026)
- [x] **Right-click repair on buildings** - SCVs can now right-click on friendly damaged buildings/mechanical units to repair them. Previously only move command was issued.
- [x] **Repair visual feedback** - Green pulsing selection ring flash appears on target when repair command is issued.
- [x] **Autocast repair toggle** - Added autocastRepair property to workers. When enabled, idle SCVs automatically repair nearby damaged buildings/mechanical units within 8 range.

### Pathfinding System Overhaul (January 2026)
- [x] **MovementSystem path requests** - Fixed critical bug where move commands didn't request paths from PathfindingSystem, causing units to walk directly into obstacles
- [x] **Path smoothing line-of-sight validation** - Replaced direction-based smoothing with Bresenham's line algorithm to verify waypoints don't skip through obstacles
- [x] **Stuck detection improvements** - Reduced stuck detection from 10 to 6 ticks, added cooldown to prevent path request spam, skip repath when near destination
- [x] **HierarchicalAStar waypoint pathing** - Fixed refineAbstractPath to actually use sector entrances instead of falling back to full A* for all long paths
- [x] **Terrain feature integration** - Updated loadTerrainData to use TERRAIN_FEATURE_CONFIG for proper walkability and movement cost calculations
- [x] **Proactive path fallback** - Units with targets but no paths now automatically request paths for distances > 3 units
- [x] **Patrol and queue path requests** - Added path requests for patrol commands and shift-click queued commands
- [x] **Path request spam prevention** - Added 500ms cooldown per unit to prevent flooding pathfinding system when no path can be found
- [x] **Alternate path fallback** - When path not found, now tries nearby walkable cells for both start and end positions to escape stuck situations

### Recast Navigation WASM Integration (January 2026)
- [x] **recast-navigation-js integration** - Replaced custom A*/HPA* with industry-standard WASM pathfinding (same core as Unity/Unreal/Godot)
- [x] **NavMesh generation from terrain** - Generates TileCache-based navmesh from walkable terrain geometry
- [x] **NavMeshQuery pathfinding** - O(1) path lookups with automatic height tolerance (halfExtents: {x: 2, y: 10, z: 2})
- [x] **DetourCrowd collision avoidance** - Built-in RVO/ORCA for unit collision avoidance (currently disabled while debugging)
- [x] **Dynamic obstacle support** - Buildings added as box obstacles via TileCache
- [x] **Decoration obstacles** - Rocks and large decorations block pathfinding via TileCache cylinder obstacles
- [x] **Point snapping to navmesh** - Start/end points snapped to valid navmesh polygons before path computation
- [x] **Graceful fallback** - When navmesh path fails for short distances (< 30 units), allows direct movement
- [x] **Building collision prevention** - Units no longer get stuck on building edges:
  - Reduced NavMesh cell size from 0.5 to 0.25 for 2x precision around obstacles
  - Building obstacles expanded by small precision buffer (0.1)
  - NavMesh walkableRadius (0.6) provides primary clearance - obstacle expansion is minimal to avoid compounding
  - Three-tier building avoidance (hard, soft, predictive) with reduced margins
  - Path smoothing with direct walkability checks
  - Agent-specific path queries based on unit collision radius
- [x] **Building gap navigation fix** - Units can now navigate through gaps between buildings:
  - Fixed compounding margins where walkableRadius + obstacle expansion + avoidance margins were stacking
  - Reduced obstacle expansion from (agentRadius + 0.1) to just 0.1 since walkableRadius handles clearance
  - Reduced MovementSystem avoidance margins (0.6→0.3 hard, 1.5→0.8 soft) since navmesh provides primary avoidance
- [ ] **Debug navmesh visualization** - Visual overlay to verify navmesh coverage
- [x] **Fix crowd velocity returning near-zero** - Root cause was twofold: (1) Crowd agent maxSpeed was set to unit.currentSpeed (accelerating speed) instead of unit.maxSpeed, artificially capping velocity. (2) Crowd agent maxAcceleration was set to maxSpeed × 1.5 (~4.2) while SC2-style ground units expect instant acceleration (1000). Fixed by always using unit.maxSpeed for crowd and setting maxAcceleration to 100.0 for near-instant acceleration.
- [x] **SC2-style hybrid steering** - Major overhaul of unit collision avoidance to match SC2's approach:
  - **Disabled DetourCrowd RVO obstacle avoidance** - Crowd now only provides path corridor direction, not local avoidance (eliminates jitter from RVO oscillation)
  - **Physics pushing between units** - Units push each other with soft forces instead of avoiding, creating natural flow (PHYSICS_PUSH_STRENGTH=8.0)
  - **Velocity smoothing** - 3-frame velocity history blending prevents jitter (VELOCITY_SMOOTHING_FACTOR=0.3)
  - **Direction commitment** - Resists sudden direction reversals to prevent reciprocal dance
  - **Reduced building avoidance margins** - Trust navmesh more (0.3→0.1 hard, 0.8→0.3 soft)
  - **Stuck detection with nudge** - If unit hasn't moved for 12 frames, apply deterministic random nudge

### Map Editor Ramp Tool Fix (January 2026)
- [x] **Ramp traversal fix** - Units couldn't traverse ramps created in the map editor. Root cause: `paintRamp()` in TerrainBrush.ts only set elevation and walkable, but didn't mark cells with `terrain: 'ramp'`. Pathfinding system expects `terrain === 'ramp'` for ramp geometry. Fixed by: (1) Adding `isRamp` field to EditorCell interface, (2) Setting `isRamp: true` in paintRamp(), (3) Converting `isRamp` cells to `terrain: 'ramp'` in editorFormatToMapData(), (4) Preserving ramp status when loading maps via mapDataToEditorFormat().
- [x] **Ramp entrance walkability fix** - Units got stuck at the TOP entrance of ramps. Root cause: `RAMP_ZONE_RADIUS` in Terrain.ts was set to 3, but cells at ramp entrances need to be within the ramp zone to avoid being marked as cliff edges. Increased `RAMP_ZONE_RADIUS` from 3 to 5 to ensure ramp entrance cells on plateaus use smooth heightMap values for continuous navmesh geometry.
- [x] **Navmesh walkableClimb fix** - Units couldn't traverse ramps because `walkableClimb` in RecastNavigation.ts was set to 0.3, which is too restrictive for typical ramp gradients. A ramp with 100 elevation change over 8 cells has ~0.5 height units per cell, exceeding the 0.3 limit. Increased `walkableClimb` from 0.3 to 0.8 to allow ramp traversal while still blocking cliff jumps (which are 3.2+ units). Added diagnostic logging in Terrain.ts to warn when height steps exceed walkableClimb.
- [x] **Ramp exit cell protection fix** - Units had trouble pathfinding DOWN ramps. Root cause: Cells at ramp exits were incorrectly marked as cliff edges, causing quantized flat heights instead of smooth heightMap values. This created navmesh discontinuities at ramp exits. Fixed by: (1) Increasing `RAMP_ZONE_RADIUS` from 5 to 8. (2) Adding `adjacentToRampZone` set to track and protect cells touching ramp zones. (3) Skipping adjacent-to-ramp cells in cliff edge detection and expansion. (4) Using smooth heightMap values for vertices near ramp areas.

### SC2-Style Platform Terrain Tools (January 2026)
- [x] **Platform material on cliff sides** - Unwalkable cells adjacent to platforms now render with platform material instead of natural rock, giving platforms proper geometric depth with consistent material on all sides.
- [x] **Guardrails at platform edges** - Platforms have guardrails at edges except at ramp entrances where units need to pass.
- [x] **Structured platform ramp tool** - New `platform_ramp` tool (Shift+R) creates uniform machined ramps with perfectly straight edges. Features:
  - 45-degree angle snapping for consistent ramp directions
  - Rectangular shape with uniform width and precise boundaries
  - Automatic elevation detection from adjacent platforms
  - Quantized elevation levels for clean platform-to-ramp transitions
  - Aligns perfectly with platform edges for SC2-style geometric terrain

### Terrain Generation Improvements (January 2026)
- [x] **Slope-based texture blending** - Fixed terrain sampleTerrain() to use average elevation instead of MAX, which was flattening cliffs and preventing proper texture blending
- [x] **Pre-calculated slope attribute** - Added aSlope vertex attribute calculated before geometry smoothing for accurate cliff detection regardless of mesh smoothing
- [x] **TSL material slope integration** - Updated TerrainMaterial.ts to use both vertex slope attribute and geometry normals for robust slope detection (max of both)
- [x] **Reduced geometry smoothing** - Changed from 5 to 2 smoothing iterations to preserve cliff geometry while maintaining natural-looking terrain
- [x] **Terrain connectivity validation** - Added validateMapConnectivity() to verify all spawn points, expansions, and watch towers are reachable
- [x] **Auto-fix connectivity** - Added autoFixConnectivity() to carve corridors between disconnected regions, ensuring all locations are navigable
- [x] **Flood fill pathfinding verification** - Added flood fill algorithm to detect separate walkable regions and identify unreachable locations
- [x] **Ramp texture fix** - Ramps now use flat ground texture (grass/snow) instead of dirt, matching walkable paths visually
- [x] **Ramp walkability fix** - Comprehensive fix for ramp entry/exit zones:
  - Expanded `isAdjacentToRamp` check radius from 1 to 3 cells to handle wider ramps
  - Added early ramp proximity check to `isCliffEdgeCell` (5-cell radius) to prevent ground cells at ramp ends from being incorrectly flattened as cliff edges
  - This ensures cells near ramps use heightmap values for smooth height transitions instead of being treated as cliff edges, guaranteeing ramps are fully walkable at both upper and lower ends

### Minimap Targeting (January 2026) ✓
- [x] **SC2-style minimap command targeting** - Press A (attack), M (move), or P (patrol) then click minimap to issue commands
- [x] **Unified command target mode** - Shared state between canvas and minimap via `commandTargetMode` in gameStore
- [x] **Visual feedback** - Minimap border changes color when in targeting mode (red=attack, blue=move, yellow=patrol)
- [x] **Shift-click queuing** - Hold shift to queue commands without exiting targeting mode

### Camera & Input Fixes (January 2026)
- [x] **WASD keys removed from camera** - WASD was conflicting with shortcuts (A=attack move, S=stop, etc.). Camera now uses arrow keys only for keyboard panning.

### UI Improvements
- [x] **Options menu** - Replaced Menu button with dropdown (Controls, Tech Tree, Exit to Menu)
- [x] **Increased building avoidance** - Units now properly avoid walking through buildings
- [x] **Game overlay rendering fix** - Fixed overlays rendering below terrain:
  - Increased terrain-following geometry height offset from 0.15 to 0.5 units
  - Added polygonOffset (-1, -1) to all overlay materials to prevent z-fighting
  - Increased overlay renderOrder values from 90/91 to 100/101
  - This ensures terrain, elevation, and threat overlays render visibly above the terrain mesh
- [x] **Epic Three.js Loading Screen** - Complete redesign using Three.js WebGL renderer with:
  - Full 3D scene matching HomeBackground quality (4000 twinkling stars, 12 orbiting asteroids)
  - Central wormhole vortex effect with spiral arms and pulsing rings
  - 5 rotating energy rings that intensify with loading progress
  - 300 converging energy particles that accelerate as loading completes
  - Procedural nebula shader with wormhole distortion that responds to progress
  - Post-processing pipeline (bloom, chromatic aberration, scanlines, vignette)
  - Mouse-reactive camera with breathing motion parallax
  - Progress-reactive visuals (effects intensify as loading approaches 100%)
  - Sleek UI with gradient title, stage indicators (CORE/RENDER/WORLD/UNITS/SYNC), glowing progress bar

### Worker Resource Delivery Fixes
- [x] **Workers stuck at mineral delivery** - Workers would get stuck oscillating near the base when trying to deliver resources. Root cause: MovementSystem cleared targetX/targetY when gathering workers arrived at ANY target (including the base edge), but the drop-off range (halfWidth + 2.5) wasn't large enough to account for the arrival threshold (0.8 units). Workers could stop at halfWidth + 2.8 from base center, outside the drop-off range. Fixed by: (1) MovementSystem now only clears targets for gathering workers NOT carrying resources. (2) Increased drop-off range from halfWidth + 2.5 to halfWidth + 3.5 to ensure workers within arrival threshold can still deposit.
- [x] **AI economy stalled at 0 minerals** - AI couldn't build anything because workers weren't delivering resources due to the above bug. With the fix, AI workers now properly deliver minerals to base.

### AI & Combat Fixes
- [x] **Attack range uses actual model bounding box** - Attack range calculations now use actual Three.js bounding box dimensions from loaded models instead of scale approximations. This is the industry-standard approach used in AAA games like SC2. AssetManager stores model dimensions after normalization, and CombatSystem/MovementSystem use cached getModelVisualRadius() for edge-to-edge distance calculations.
- [x] **Laser projectile rendering** - Fixed invisible laser beams by replacing THREE.Line (linewidth doesn't work in WebGL/WebGPU) with CylinderGeometry mesh with glow effect.
- [x] **Idle unit auto-attack responsiveness** - Idle units now immediately attack enemies within attack range (no throttle delay). Uses dedicated `findImmediateAttackTarget()` for instant response when enemies enter attack range, while throttled sight-range search remains for longer-range target acquisition.
- [x] **VisionSystem multi-player support** - Changed from hardcoded ['player1', 'ai'] to dynamic player registration, enabling proper 4-AI spectator games.
- [x] **Building fog of war fix** - VisionSystem was using hardcoded sightRange=9 for all buildings instead of each building's configured sightRange from its definition. Now correctly uses building.sightRange.
- [x] **Flying building fog of war fix** - Buildings in flying state (lifting, flying, landing) now maintain vision. VisionSystem uses `building.isOperational()` instead of checking only for 'complete' state.
- [x] **HQ building sight range tripled** - headquarters, orbital_station, and bastion now have sightRange=33 (up from 11) for larger vision radius around main bases.
- [x] **AI attack persistence** - AI now stays in attacking state until all enemies are eliminated, preventing premature retreat when taking losses.
- [x] **AI proximity-based targeting** - Fixed FFA games where all AI targeted the same enemy. Now each AI targets their CLOSEST enemy (with priority for nearly-defeated enemies with ≤2 buildings).
- [x] **Units clipping into buildings** - Fixed bug where attacking units would get stuck inside target buildings. Added escape logic to force movement out before stopping to attack.
- [x] **AI units clipping through enemy CC** - Fixed attack targeting to position units at building EDGE instead of center, preventing units from clipping through enemy command centers.
- [x] **AI expansion support** - AI now builds expansion command centers at resource clusters without nearby bases, enabling multi-base strategies.
- [x] **AI repair functionality** - Workers automatically repair damaged buildings (<90% health) and mechanical units. Prioritizes critically damaged buildings first.
- [x] **Building destruction bug** - Fixed buildings with 0 health (on fire) not being destroyed. Added floating-point safety check for death detection.
- [x] **SC2-style AI expansion timing** - AI now expands more aggressively based on difficulty: Easy (2 bases max), Medium (3), Hard (4), Very Hard (5), Insane (6). Expansion triggers based on worker saturation and cooldowns similar to SC2 AI.
- [x] **AI tech unit production** - AI now builds tech labs and produces advanced units (devastator, colossus, breacher, operative, specter, valkyrie). Build orders updated to include research modules. Tech unit production probability significantly increased.
- [x] **Player1 AI spectator fix** - Fixed bug where player1 as AI was treated as human player due to ID-based check instead of type-based check. This could cause AI player1 to not function correctly.
- [x] **Player status panel ordering** - Fixed player list ordering in spectator mode to sort by player ID (Player 1, Player 2, etc.) instead of array insertion order.
- [x] **AI units not attacking** - Fixed multiple bugs preventing AI units from attacking:
  - **Root cause**: AI was sending ATTACK commands with `targetPosition` (attack-move) instead of `targetEntityId` (direct attack), relying on broken auto-acquire
  - **Fix**: AI now uses `findNearestEnemyEntity()` to find specific targets and sends direct ATTACK commands with `targetEntityId`, same as player right-click attacks
  - Also fixed: EnhancedAISystem gives orders to 'moving' units, AIMicroSystem preserves targets during kiting, CombatSystem handles edge cases
- [x] **AI vespene extractor expansion** - AI now builds extractors on ALL available vespene geysers near any base (main and expansions), not just the first one
- [x] **AI vespene worker overloading** - Fixed workers being over-assigned to refineries by tracking workers moving to resources (gatherTargetId) in addition to registered gatherers
- [x] **AI expansion improvements** - Multiple fixes to ensure AI expands:
  - Lowered mineral cluster detection threshold from 4 to 2 for smaller maps
  - Added time-based fallback expansion (after ~100 seconds) even without full army
  - Worker gathering now considers all bases (main + expansions) for minerals
- [x] **AI Lifter not attacking** - Excluded non-combat units (attackDamage=0) like Lifter and Overseer from attack army

### Fixed Issues (Round 4 - FPS Optimization - January 2026)
- [x] **Console.log removed from MovementSystem** - Debug logging in hot paths was allocating strings every frame for every moving unit
- [x] **Math.sqrt optimized in MovementSystem** - Using squared distance comparisons first, only computing sqrt when needed for normalization
- [x] **Camera raycaster cached** - screenToWorld() was allocating new Raycaster, Vector2, Vector3, Plane on every call. Now reuses instance properties.
- [x] **WallSystem gate proximity optimized** - Changed from O(gates × units) to spatial grid query O(gates × nearby_units)
- [x] **WallSystem repair drone optimized** - Changed from iterating all walls to spatial grid query
- [x] **World.ts query cache key optimized** - Reusing sort buffer instead of allocating new array via slice() on every cache miss
- [x] **SelectionPanel wrapped with React.memo** - Prevents re-renders when parent changes but selection hasn't
- [x] **MultiSelectEntityIcon component extracted** - Memoized component for multi-select grid to prevent re-renders
- [x] **useGameStore selector function** - Using `(state) => state.selectedUnits` instead of object destructuring to minimize re-renders

### Fixed Issues (Round 5 - FPS Deep Optimization - January 2026)
- [x] **ParticleSystem Vector3.clone() eliminated** - Hot loop was creating 5000+ Vector3 allocations per frame. Now reuses temp vector.
- [x] **Pathfinding Grid string keys replaced** - Changed from string keys (`${x},${y}`) to numeric keys (`y * cols + x`), eliminating GC pressure from string allocations
- [x] **Pathfinding Grid query Set reuse** - Query results now reuse a single Set instead of allocating new Set per query
- [x] **VisionSystem O(n²) watch tower loop fixed** - Changed from iterating all units × all towers to spatial grid queries per tower
- [x] **VisionSystem sqrt in reveal loop eliminated** - Using squared distance comparison instead of Math.sqrt() in nested reveal area loop
- [x] **WallPlacementPreview material cloning eliminated** - Was cloning materials per segment per frame during wall placement. Now reuses pre-created materials.
- [x] **WallPlacementPreview wireframe geometry reuse** - EdgesGeometry and LineBasicMaterial now shared across all wall segments
- [x] **AIMicroSystem threat sort replaced with single-pass max** - Changed from O(n log n) full array sort to O(n) single-pass max tracking for threat assessment

### Fixed Issues (Round 6 - Additional FPS Optimizations - January 2026)
- [x] **MovementSystem double building queries combined** - calculateBuildingAvoidanceForce and resolveHardBuildingCollision now share cached spatial grid query results via getCachedBuildingQuery()
- [x] **CombatSystem event payload pooling** - combat:attack, combat:splash, combat:miss, player:damage, alert:underAttack events now use pooled static objects instead of allocating per event
- [x] **PathfindingSystem priority queue** - Replaced O(n log n) array sort with O(log n) binary max-heap for path request prioritization. Built-in duplicate removal via entityIndex Map.
- [x] **BuildingRenderer traverse() caching** - Pre-cached mesh children during mesh creation (cachedMeshChildren), replacing 5 traverse() calls in construction animation with direct array iteration
- [x] **CommandCard React memoization** - Wrapped with memo(), using individual selector functions for Zustand state to minimize re-renders

### Fixed Issues (Round 7 - System Update Throttling - January 2026)
- [x] **VisionSystem update interval increased** - Changed from 3 ticks (150ms) to 10 ticks (500ms), reducing vision recalculation overhead by 3x
- [x] **MovementSystem separation throttle increased** - Changed from 3 ticks to 5 ticks, reducing separation force recalculations by 40%
- [x] **MovementSystem dropOffBuildings static array** - Made array a frozen static constant to eliminate ~200 array allocations per frame in large battles
- [x] **AIMicroSystem update interval increased** - Changed from 5 ticks (250ms) to 8 ticks (400ms), reducing AI behavior tree evaluations by 37%
- [x] **SeededRandom reuse in EnhancedAISystem** - Added reseed() method and reuse existing instance instead of allocating new SeededRandom every frame
- [x] **EffectsRenderer pool size increased** - Doubled effect pool from 50 to 100 to reduce fallback material cloning in large battles
- [x] **EffectsRenderer temp Vector3 pool** - Added reusable Vector3 objects for attack effect creation to reduce GC pressure
- [x] **React memo() added to UI components** - Wrapped HUD, GraphicsOptionsPanel, DebugMenuPanel, PlayerStatusPanel in memo() to prevent unnecessary re-renders

### Fixed Issues (Round 8 - Draw Call & Algorithm Optimization - January 2026)
- [x] **InstancedTrees true instancing** - Converted from individual meshes (400+ draw calls) to InstancedMesh batched by model type (2-6 draw calls). 98% reduction in tree draw calls.
- [x] **InstancedRocks true instancing** - Converted from individual meshes (300+ draw calls) to InstancedMesh batched by model type (3 draw calls). 99% reduction in rock draw calls.
- [x] **MovementSystem formation buffer pooling** - Pre-allocated 256-position formation buffer to eliminate per-move-command array allocations
- [x] **EffectsRenderer damage number sprite pool** - Pool of 20 pre-created sprites with textures to eliminate canvas/texture allocation per damage number
- [x] **EnhancedAI findAvailableWorker optimization** - Changed from triple-pass O(3n) to single-pass O(n) with priority tracking
- [x] **EnhancedAI extractor-geyser O(n²) → O(n+m)** - Built Map<extractorId, resource> for O(1) lookup instead of nested loops
- [x] **EnhancedAI mineral sorting moved outside loop** - Sort once before worker assignment loop instead of every iteration

### Fixed Issues (Round 9 - Graphics Settings Optimization - January 2026)
- [x] **Smart shadow casting** - Decorations split into playable area (cast shadows) vs border (no shadows). Trees and rocks in the outer 15 cells don't cast shadows. This maintains shadow quality in gameplay areas while reducing shadow casters from 700+ to ~100-200. Major FPS improvement.
- [x] **IBL disabled on decorations** - Set envMapIntensity=0 on decoration materials to avoid expensive cubemap lookups. 5-10fps improvement when Environment IBL enabled.

### Fixed Issues (Round 10 - Background Tab Immunity - January 2026)
- [x] **Phaser overlay background tab immunity** - Created phaserLoopWorker.ts to drive Phaser scene updates when tab is inactive. Web Workers aren't throttled by browsers, so the overlay (damage numbers, screen effects, alerts) stays synchronized with game state. Uses document.hidden to detect background state and manually steps Phaser's scene system via scene.sys.step(). Matches the existing GameLoop worker pattern.

### Fixed Issues (Round 11 - UI Polling & Memory Leak Fixes - January 2026)
- [x] **HomeBackground memory leak** - Added proper disposal for star field, asteroids, energy streams, nebula geometries/materials, and EffectComposer passes on unmount
- [x] **LoadingScreen memory leak** - Added proper disposal for Three.js resources and RAF cleanup for brightness/fade animations
- [x] **Public lobby duplicate subscriptions** - Added guard to close existing subscriptions before creating new ones in startBrowsing()
- [x] **WebRTC ICE handler improvements** - Added onicegatheringstatechange handler and proper cleanup in useP2P and useMultiplayer hooks
- [x] **IdleWorkerButton optimization** - Changed from 500ms polling to event-driven updates (unit:spawned, unit:died) with tick-based caching and 1s fallback polling
- [x] **PlayerStatusPanel optimization** - Changed from 1s double entity scan to event-driven updates with tick-based caching and 2s fallback polling
- [x] **DesyncDetection cleanup batching** - Changed from per-command O(n) cleanup to periodic cleanup every 100 ticks (~5 seconds)

### Remaining Optimizations
- [ ] Web Worker for AI calculations

### Future Performance Optimizations (Validated)
> See **docs/PERFORMANCE_ANALYSIS.md** for detailed analysis and ranking

**Tier 1 (Implement First):**
- [ ] GPU Compute Vision/Fog of War - WebGPU compute shader for 60Hz vision
- [ ] Merkle Tree State Checksums - O(log n) desync detection
- [ ] Temporal Reprojection for GTAO/SSR - Leverage existing velocity buffer
- [ ] Hierarchical Interest Management - Reduced tick rate for off-screen entities

**Tier 2 (Scaling):**
- [ ] WASM SIMD for Boids/Movement - 4-8x throughput for flocking
- [ ] GPU-Driven Indirect Draw - Eliminate CPU-GPU sync for 500+ units
- [ ] Flow Field Pathfinding - GPU compute for same-destination commands

---

## Phase 1: Foundation (COMPLETE ✓)

### Core Engine
- [x] Project setup (Next.js 14, TypeScript, Three.js)
- [x] Game state management (Zustand)
- [x] Entity Component System architecture
- [x] Game loop with fixed timestep
- [x] Save/Load game state

### Rendering
- [x] Three.js scene setup
- [x] Terrain rendering with heightmap + procedural details
- [x] Camera controls (pan, zoom, rotate, edge scroll)
- [x] Unit rendering with instancing
- [x] Building rendering
- [x] Selection indicators
- [x] Fog of war shader
- [x] Combat effects (projectiles, hits)
- [x] 3D Asset System (procedural + GLTF loader)

### Input & Selection
- [x] Mouse input handling
- [x] Box selection
- [x] Control groups (Ctrl+1-9)
- [x] Right-click commands
- [x] Keyboard shortcuts
- [x] Minimap interaction

### Pathfinding
- [x] A* algorithm implementation
- [x] Web Worker offloading
- [x] Spatial grid for collision

### Units & Buildings
- [x] Unit data definitions
- [x] Building data definitions
- [x] Unit spawning system
- [x] Building placement with validation
- [x] Construction progress
- [x] Production queues
- [x] Rally points

### Resources
- [x] Resource node system
- [x] Worker gathering mechanics
- [x] Resource storage/tracking
- [x] Supply/population system (UI + tracking)
- [x] SC2-style worker saturation display (X/Y labels above resources)

---

## Phase 1.5: SC2 Feel (COMPLETE ✓)

### Unit Movement & Micro
- [x] Unit avoidance/steering (Boids-like)
- [x] Unit acceleration/deceleration
- [x] Shift-click command queuing (move, attack, attack-move, patrol, gather)
- [x] Command queue visual waypoint indicators (green lines/markers)
- [x] Shift-click building placement queuing with visual path lines
- [x] Patrol command (P key)

### Camera & Controls
- [x] Camera location hotkeys (F5-F8)
- [x] Tab to cycle subgroups
- [x] Double-tap control group to center camera

### Alerts & Feedback
- [x] Under attack alerts
- [x] Minimap ping on attack
- [x] Idle worker button (F1)

### Production & Macro
- [x] Select all of type (Ctrl+click)
- [x] Shared production queue UI
- [x] Building dependencies (tech requirements)

### Combat Feel
- [x] Smart targeting (priority system)
- [x] Area of effect damage (splash)
- [x] Focus fire indicator

---

## Phase 1.6: Maps & Environment (COMPLETE ✓)

### Map Visual Quality
- [x] Biome system (6 biomes)
- [x] PBR terrain materials
- [x] Instanced grass/ground detail
- [x] Enhanced decorations (trees, rocks, crystals)
- [x] Water/lava animated planes
- [x] Particle effects (snow, dust, ash, spores)
- [x] Environment manager
- [x] Map border fog (SC2-style smoky fog effect around map edges)

### JSON-Based Map System (January 2026) ✓
- [x] **JSON map format** - Compact storage with compressed terrain (elevation array, type string, sparse features)
- [x] **Map serialization** - MapData → JSON conversion with terrain compression
- [x] **Map deserialization** - JSON → MapData with terrain decompression
- [x] **All 6 maps converted** - Crystal Caverns, Void Assault, Scorched Basin, Contested Frontier, Titans Colosseum, Battle Arena
- [x] **Editor export** - Export button in Map Editor with Copy to Clipboard and Download options
- [x] **Build-time bundling** - JSON files imported directly for tree-shaking and bundling

### Map Editor Validation (January 2026) ✓
- [x] **Full connectivity validation** - Validates main bases reach each other, naturals reachable, no isolated islands
- [x] **Validation UI panel** - Complete UI with status banner, statistics, error/warning display with suggested fixes
- [x] **Connectivity statistics** - Shows node count, island count, connected/blocked pairs
- [x] **Issue display** - Errors and warnings with affected nodes and suggested fixes (e.g., add ramp)
- [x] **Auto-fix functionality** - Button to automatically add ramps to fix connectivity issues
- [x] **Real-time feedback** - Loading state during validation, immediate result display
- [x] **Centralized pathfinding config** - `src/data/pathfinding.config.ts` is single source of truth for:
  - Recast Navigation navmesh parameters (walkableClimb, walkableSlopeAngle, etc.)
  - Editor validation thresholds (WALKABLE_CLIMB_ELEVATION)
  - Terrain generation constants (CLIFF_WALL_THRESHOLD_ELEVATION)
  - Changing config updates both game pathfinding AND validation automatically

### Pre-Game Setup
- [x] Game options menu
- [x] Map preview
- [x] Game settings (resources, speed, AI)
- [ ] Procedural map generator

### UX
- [x] Keyboard shortcuts help (?)
- [x] Controls hint in HUD

---

## Phase 1.7: Enhanced Terrain System (COMPLETE ✓)

### 256-Level Elevation System (SC2 Parity)
- [x] Expanded elevation from 3 levels (0-2) to 256 levels (0-255)
- [x] Gameplay zones (low: 0-85, mid: 86-170, high: 171-255)
- [x] Smooth elevation gradients for natural terrain
- [x] High-ground advantage combat integration

### Terrain Features
- [x] TerrainFeature type system (water, forest, mud, road, void, cliff)
- [x] Feature configurations (walkable, buildable, speed modifier, vision blocking)
- [x] Terrain color tinting for feature rendering
- [x] Flying unit feature bypass

### Movement & Pathfinding Integration
- [x] Terrain speed modifiers in MovementSystem
- [x] Pathfinding cost modifiers in AStar.ts
- [x] Feature-aware walkability checks in Terrain.ts

### Map Helper Functions
- [x] createForestCorridor() - Forest paths with clear center
- [x] createRiver() - Water barriers with optional bridges
- [x] createLake() - Circular water bodies with shallow edges
- [x] createVoidChasm() - Impassable void areas
- [x] createRoad() - Fast movement corridors
- [x] createMudArea() - Slow movement zones
- [x] scatterForests() - Procedural forest placement
- [x] fillFeatureRect/Circle() - General feature painting

### All Maps Redesigned
- [x] Crystal Caverns - Frozen lakes, ice corridors, icy slow zones
- [x] Void Assault - Void chasms, alien forests, energy pools
- [x] Scorched Basin - Lava lakes, scorched forests, sand slow zones
- [x] Contested Frontier - Rivers with bridges, dense jungle, mud pits
- [x] Titan's Colosseum - Lava moats, volcanic pits, highway system

---

## Phase 2: Combat & Abilities (COMPLETE ✓)

### Combat System
- [x] Attack command implementation
- [x] Damage calculation (4 types, 4 armor types)
- [x] High ground advantage (30% miss)
- [x] Unit death and cleanup
- [x] Attack animations
- [x] Projectile system

### Abilities
- [x] Ability system framework
- [x] Cooldown management
- [x] Active ability targeting
- [x] Passive ability effects
- [x] Ability auto-cast toggle

### Tech Tree
- [x] Research system
- [x] Upgrade effects
- [x] Tech requirements

### UI
- [x] Command card (abilities/actions)
- [x] Production panel
- [x] Tech tree viewer
- [x] Unit info tooltips
- [x] Damage numbers
- [ ] Unit wireframes in selection panel

### Audio Framework
- [x] Sound effect system (Howler.js)
- [x] Spatial audio positioning
- [x] Audio asset documentation

---

## Phase 2.5: Advanced Unit Mechanics (COMPLETE ✓)

### Transform Mechanics
- [x] Siege Tank (Tank ↔ Siege mode)
- [x] Hellion ↔ Hellbat
- [x] Viking/Valkyrie (Fighter ↔ Assault mode)
  - Fighter Mode: Flying, attacks air only (anti-air specialist)
  - Assault Mode: Ground, attacks ground only (like SC2 Viking)
  - AI transform intelligence: Auto-transforms based on nearby enemy composition

### Cloak & Detection
- [x] Cloak implementation (Ghost, Banshee)
- [x] Detection (Missile Turret, Sensor Tower, Raven, Scanner Sweep)

### Transport & Bunker
- [x] Medivac load/unload (8 capacity)
- [x] Bunker system (4 infantry, fire from inside)

### Healing & Repair
- [x] SCV repair (buildings, mechanical)
- [x] Medivac heal (biological)

### Building Features
- [x] Lift-off/Landing (CC, Barracks, Factory, Starport)
- [x] Addons (Tech Lab, Reactor)
- [x] Addon swap mechanics
- [x] Supply Depot lowering

---

## Phase 3: AI System (COMPLETE ✓)

### AI Behaviors
- [x] 5 difficulty levels (Easy → Insane)
- [x] Build order system
- [x] Scouting behavior
- [x] Multi-pronged attacks
- [x] Harassment tactics
- [x] Worker management
- [x] Defense coordination
- [x] SC2-style optimal worker saturation targeting (gas first, then minerals)

### Game State
- [x] Victory/defeat conditions
- [x] Player statistics (units, resources, APM)

---

## Phase 4: Remaining Dominion Polish (IN PROGRESS)

### Fortification System (January 2026) ✓
- [x] **Wall building definitions** - Wall segment (1x1, 25 minerals), Wall gate (2x1, 75 minerals)
- [x] **Wall component** - Connections, gate state machine, turret mounting, upgrades
- [x] **WallSystem** - Auto-connecting walls, gate mechanics, shield regen, repair drones
- [x] **Line placement mode** - Click+drag to draw wall lines (horizontal, vertical, diagonal)
- [x] **WallPlacementPreview** - Real-time preview with cost display, valid/invalid highlighting
- [x] **Gate mechanics** - Open/Close/Auto/Lock states, auto-opens for friendly units
- [x] **Wall upgrades** - Reinforced (+400 HP), Shielded (+200 shield), Weapon (auto-turret), Repair Drone
- [x] **Turret mounting** - Defense Turrets can mount on wall segments for +1 range
- [x] **CommandCard integration** - Build Walls menu (W), gate commands (O/L/A), upgrade buttons
- [x] **Smart worker assignment** - Workers assigned to nearest segments (not round-robin) for efficient construction
- [x] **AoE wall construction** - Workers contribute to ALL wall segments within 3 units (not just their assigned one)
- [x] **Auto-continue construction** - Workers automatically move to next unfinished segment after completing one
- [x] **Wall line tracking** - Wall segments placed together are tracked as a "wall line" for intelligent worker behavior

### Missing Abilities
- [ ] Auto Turret (Raven)
- [ ] Interference Matrix (Raven)
- [ ] Anti-Armor Missile (Raven)
- [ ] Afterburners (Medivac)
- [ ] KD8 Charge (Reaper)
- [ ] High Impact Payload toggle (Thor)

### Missing Features
- [ ] Salvage bunker (return 75%)
- [x] Cancel construction (return 75%) - Demolish button added to buildings under construction
- [x] Demolish complete buildings (return 50%) - Salvage button added to complete buildings
- [ ] Building burning (low HP damage)
- [ ] Neosteel Frame research (+2 bunker)
- [ ] Building Auto-Repair research

### Production Queue Improvements (January 2026)
- [x] Unlimited production queue (no size limit)
- [x] Supply only allocated for currently producing unit (not entire queue)
- [x] Queue reorder functionality (move items up/down with ▲▼ buttons)
- [x] Fixed tech-gated units (Devastator, Colossus) requiring tech lab
- [x] Supply-blocked production pauses until supply available
- [x] Distributed production across multiple selected buildings (shortest queue first)
- [x] Multi-select production queue display (shows all selected buildings' queues)

### Flying Building Improvements (January 2026)
- [x] Fixed landing warp - buildings now fly to landing position before landing animation
- [x] Smooth accel/decel for lift-off and landing animations
- [x] Thruster effects on all flyable buildings (headquarters, orbital_station, infantry_bay, forge, hangar)
- [x] Engine exhaust and smoke trail effects during flight

### Building Placement SC2 Polish (January 2026)
- [x] Fixed green/blue preview offset - Grid tiles now properly centered on building footprint
- [x] Fixed blueprint persistence bug - Preview clears on invalid placement without shift key
- [x] SC2-style worker construction - Workers wander inside building footprint during active construction
- [x] Scaffolding visibility fix - Yellow scaffolding only visible during ACTIVE construction (not paused/waiting)
- [x] Scaffolding cleanup on instancing - All construction effects (scaffold, dust, blueprint) now cleaned up when building switches to instanced rendering

### Addon System Implementation (January 2026)
- [x] Production Module (Reactor) button added to CommandCard UI
- [x] Addons now build over time instead of instantly (18s for Tech Lab, 36s for Reactor)
- [x] Addons auto-construct without workers (SC2 style)
- [x] Reactor double-production implemented - Halved build time for reactor-eligible units
- [x] Tech Lab unlocks advanced units (breacher, operative, devastator, colossus, etc.)

### Visual Polish
- [ ] Unit wireframes (damage state)
- [x] Building placement ghost - SC2-style grid + ghost preview when placing
- [x] Ground click visual feedback - Phaser 2D overlay indicators for move/attack commands:
  - Move commands: Green expanding ring with inward-pointing chevrons and center dot
  - Attack-move commands: Red expanding ring with X crosshair pattern
  - Events: `command:moveGround` and `command:attackGround` emitted from input handlers
- [x] Production progress bar - Fixed visibility and positioning for buildings producing units
- [x] Enhanced damage numbers - Glow effects, pop-in animation, horizontal drift, color-coded by damage
- [x] Premium text alerts - Orbitron font, glow bloom, underline accents, slide animations
- [x] World-class victory/defeat screen - Animated radial glow burst, decorative lines, title glow bloom, staggered reveal
- [ ] Stim Pack visual effect (red tint)
- [ ] Siege Mode transform animation
- [ ] Cloak shimmer effect
- [ ] Nuke targeting laser
- [ ] Death animations

---

## Phase 5: Audio Content (TODO)

### Weapon Sounds
- [ ] Gauss rifle (Marine)
- [ ] Punisher grenades (Marauder)
- [ ] Flamethrower (Hellion)
- [ ] Arclite cannon (Siege Tank)
- [ ] Laser batteries (Battlecruiser)

### Voice Lines
- [ ] Unit acknowledgments (5+ per unit)
- [ ] Attack confirmations
- [ ] Advisor lines ("Under attack", "Research complete")

### Music
- [ ] Menu theme
- [ ] Gameplay ambient
- [ ] Victory/defeat themes

---

## Phase 6: Second Faction - Synthesis (TODO)

### Core Mechanics
- [ ] Shield system (regen, EMP interaction)
- [ ] Pylon power fields
- [ ] Warp-in mechanic
- [ ] Chrono Boost

### Units (14)
- [ ] Probe, Zealot, Stalker, Sentry, Adept
- [ ] High Templar, Dark Templar, Archon
- [ ] Immortal, Colossus
- [ ] Phoenix, Void Ray, Oracle, Carrier

### Buildings (13)
- [ ] Nexus, Pylon, Gateway/Warp Gate
- [ ] Forge, Cybernetics Core
- [ ] Twilight Council, Templar Archives, Dark Shrine
- [ ] Robotics Facility, Robotics Bay
- [ ] Stargate, Fleet Beacon
- [ ] Photon Cannon

### Research (30+)
- [ ] Weapons/Armor/Shields upgrades
- [ ] Unit-specific abilities (Charge, Blink, Storm, etc.)

---

## Phase 7: Quality of Life (TODO)

### Tutorial System
- [ ] Basic controls tutorial
- [ ] Economy tutorial
- [ ] Combat tutorial
- [ ] Advanced tutorial

### Settings
- [ ] Custom hotkeys
- [ ] Graphics settings (quality presets)
- [x] Audio settings (volume sliders, music player, SFX controls)
- [x] Strategic overlays (terrain, elevation, threat range) with options menu UI
- [ ] Gameplay settings

### Skirmish Options
- [ ] Multiple AI opponents
- [ ] Team games (2v2, 3v3)
- [ ] Custom game options

### Map Generator
- [ ] Procedural generation
- [ ] Seed system

---

## Phase 8: Replay System (TODO)

- [ ] Command recording
- [ ] Playback controls
- [ ] Speed adjustment
- [ ] Analysis features (graphs, timeline)

---

## Phase 9: Third Faction - Swarm (TODO)

### Core Mechanics
- [ ] Creep system
- [ ] Larva/inject system
- [ ] Morph mechanics
- [ ] Burrow
- [ ] Regeneration

### Units (14)
- [ ] Drone, Zergling, Baneling, Roach, Ravager
- [ ] Hydralisk, Lurker, Queen
- [ ] Mutalisk, Corruptor, Brood Lord
- [ ] Infestor, Swarm Host, Ultralisk, Viper

### Buildings (17)
- [ ] Hatchery/Lair/Hive, Spawning Pool
- [ ] Baneling Nest, Roach Warren, Hydralisk Den, Lurker Den
- [ ] Infestation Pit, Ultralisk Cavern
- [ ] Spire, Greater Spire, Evolution Chamber
- [ ] Extractor, Spine/Spore Crawler, Nydus Network

---

## Future: Multiplayer - P2P Architecture (NEW DIRECTION)

> See **P2P_ARCHITECTURE.md** for comprehensive design document

### Current Multiplayer Status (Supabase-Based)

**✅ Infrastructure Complete:**
- [x] WebRTC P2P full mesh topology (`PeerConnection.ts`, `PeerManager.ts`)
- [x] Supabase signaling for WebRTC handshake (`SignalingService.ts`)
- [x] Lobby CRUD with Supabase Postgres (`lobbyService.ts`)
- [x] Game message protocol (16 types defined in `types.ts`)
- [x] Checksum system for desync detection (`ChecksumSystem.ts`)
- [x] Desync debugging infrastructure (`DesyncDetection.ts`)
- [x] Latency measurement and connection quality
- [x] **Guest stays in lobby fix** - Start button now validates WebRTC connection state before allowing game start. sendGameStart() returns count of guests notified for feedback.
- [x] **Lobby join error handling fix** - When joining a full lobby, error message now displays in modal, and Join button stays visible for retry. Fixed `isHost` not resetting on join failure.
- [x] **Multiplayer message format compatibility** - Game.ts now handles both message formats (payload-based and commandType/data-based) for proper command sync between players.
- [x] **Building commands multiplayer sync** - Added LIFTOFF, LAND, RALLY, GATHER command types to GameCommand. Converted all building command emissions to use `game.issueCommand()` for proper multiplayer synchronization.
- [x] **Nostr rate-limit error handling** - Silently ignore rate-limit errors from Nostr relays during event publishing to prevent uncaught promise errors.

**✅ Critical Multiplayer Bug Fixes (January 2026):**
- [x] **Command lockstep synchronization** - Commands now scheduled for future tick execution (COMMAND_DELAY_TICKS=2) ensuring both players execute at same game tick
- [x] **RTCDataChannel ordered mode** - Changed from `ordered: false` to `ordered: true` to prevent command reordering
- [x] **Deterministic worker wandering** - Replaced Math.random() with SeededRandom in BuildingPlacementSystem for multiplayer sync
- [x] **Double game start race fix** - Added mutex flag to prevent race condition between setTimeout and event listener
- [x] **Command buffer overflow handling** - Buffer overflow now triggers desync state instead of silently dropping commands
- [x] **terrainGrid bounds checking** - Added null checks to prevent crash on empty terrain
- [x] **World.getEntity() destroyed filter** - Now returns undefined for destroyed entities
- [x] **canUpgradeTo null check** - Added optional chaining to prevent null access
- [x] **Pending desync check logging** - Added warnings when checksums can't be verified
- [x] **Render loop performance** - Cached sorted entity lists in UnitRenderer and BuildingRenderer to avoid O(n log n) sort every frame
- [x] **Event listener cleanup** - Game.stop() now clears all event listeners to prevent memory leaks and duplicate handlers

**⚠️ Game Integration Incomplete:**
- [x] Wire lockstep tick synchronization to game loop
- [x] Broadcast player commands over network (via issueCommand)
- [ ] Input buffering / lag compensation
- [ ] Reconnection recovery logic

### NEW: Serverless P2P Architecture

**Goal**: Download game → Play with anyone → No servers needed

**Phase 1: Connection Codes (Priority: HIGH)**
- [ ] SDP offer compression and encoding
- [ ] Connection code generation (VOID-XXXX-XXXX format)
- [ ] QR code generation for mobile
- [ ] Code entry UI and validation
- [ ] Direct P2P connection via codes

**Phase 2: LAN Discovery (Priority: LOW - Requires Electron/Tauri)**
- [ ] mDNS/Bonjour for LAN discovery
- [ ] Local games browser UI

**Phase 3: Nostr Global Discovery (Priority: HIGH) - 99% Reliable**
- [ ] NostrMatchmaking class implementation
- [ ] Ephemeral keypair generation
- [ ] Game seek event publishing (kind: 20420)
- [ ] WebRTC offer/answer exchange via Nostr
- [ ] Skill-based matchmaking filters
- [ ] "Find Match" UI with status
- [ ] Relay health monitoring

**Phase 4: Peer Relay Network (Priority: LOW)**
- [ ] Relay message protocol
- [ ] Relay path discovery
- [ ] End-to-end encryption for relayed data

**Phase 5: Decentralized Identity (Priority: LOW)**
- [ ] Ed25519 key generation
- [ ] Signed match results
- [ ] Local stats storage
- [ ] Peer stat verification

---

## Current Sprint Focus

**Sprint 1: Dominion Polish**
1. [ ] Implement remaining Raven abilities
2. [ ] Add unit wireframes to selection panel
3. [ ] Building placement ghost preview
4. [ ] Generate weapon sound effects

**Sprint 2: Visual Effects**
1. [ ] Ability visual effects (Siege, Cloak, Nuke)
2. [ ] Death animations
3. [ ] Muzzle flashes
4. [ ] Complete audio generation

---

## Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Core Engine | 100% | Production-ready |
| Dominion Units | 95% | Missing some abilities |
| Dominion Buildings | 100% | All 16 complete |
| Combat System | 100% | All damage/armor types |
| AI System | 100% | 5 difficulty levels |
| UI/HUD | 95% | Missing wireframes |
| Audio | Framework only | Needs actual assets |
| Synthesis Faction | 0% | Not started |
| Swarm Faction | 0% | Not started |
| Multiplayer | 60% | Infra complete, game integration needed |
| P2P Architecture | 0% | Design complete, implementation pending |
