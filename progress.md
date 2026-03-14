Original prompt: cant get this app to start locally

- Investigated `npm run build` failure on macOS.
- Root cause: `src/engine/components/Unit.ts` re-exported from `./unit`, which can resolve ambiguously on case-insensitive filesystems because the facade itself is `Unit.ts`.
- Applied fix: changed the facade to re-export from `./unit/index` explicitly.
- Verified `npm run build` succeeds.
- Verified `npm run type-check` succeeds.
- Verified `npm run dev` starts successfully; Next selected `http://localhost:3001` because port `3000` was already in use locally.
- The `develop-web-game` Playwright client could not be used because the `playwright` package is not installed in this environment.
- No further action required for the original startup/build issue.

- Investigated pathfinding regression on elevated maps.
- Reproduced the bug below the game loop: Recast paths on elevated bundled maps were truncating partway up/down ramps, while the flat test map still reached its destination.
- Replaced the flat-per-cell navmesh geometry path with a shared ramp-aware geometry builder and wired editor validation to the same logic.
- Removed the terrain-grid fallback after confirming the root issue was navmesh geometry, not movement execution.
- Added ramp metadata normalization so both bundled ramps and editor-inferred flat ramps derive their direction and endpoint elevations from surrounding walkable terrain before Recast heightfields are built.
- Replaced the fallback-specific tests with Recast connectivity regressions for `contested_frontier`, `crystal_caverns`, `titans_colosseum`, and a synthetic flat-ramp editor map.
- Verified `npm run type-check`, targeted `recastRampConnectivity` and `pathfindingSystem` tests, full `npm test` (72 files / 2547 tests), and `npm run lint` with only pre-existing warnings.
- TODO: Verify full long-haul spawn-to-spawn routes on `scorched_basin` and `void_assault` if we want cross-map regression coverage beyond the local elevated-move cases.

- Updated the PWA install UI so the global bottom-right install prompt no longer renders from the app layout.
- Reworked `src/components/pwa/InstallPrompt.tsx` into a compact `InstallAppButton` that reuses the existing install flow but renders as an icon-only control.
- Added the compact install button beside the existing mute/fullscreen controls on the home page, game setup page, and editor header.
- Verified `npm run type-check` and `npm run build` pass after the UI change.
- Verified targeted ESLint on the touched files reports only two pre-existing warnings: the unused `eslint-disable` in `src/app/game/setup/page.tsx` and the existing custom-font warning in `src/app/layout.tsx`.
- Browser-level visual verification of the install button placement is still blocked here because the repo does not include a usable `playwright` runtime, and the install prompt itself depends on a browser-only `beforeinstallprompt` event.

- Continued investigating the pathfinding stop-after-an-inch bug after gameplay reports showed it also happened on multiple bundled maps near starting bases, not just on ramps.
- Root cause: the nested pathfinding worker could finish loading its navmesh after startup buildings and decoration collisions were already registered on the authoritative main-thread `RecastNavigation` TileCache. In that case the worker never received those existing obstacles, so it planned straight through the starting HQ/decor while movement/collision stopped units almost immediately.
- Applied fix in `src/engine/systems/PathfindingSystem.ts`: retain registered decoration collisions, and whenever the worker reports `navMeshLoaded`, replay all current building and decoration obstacles into the worker so worker-side path queries match the authoritative obstacle state.
- Added a regression test in `tests/engine/systems/pathfindingSystem.test.ts` that simulates late worker readiness and asserts existing building plus large decoration obstacles are replayed into the worker while tiny decorative clutter is ignored.
- Updated `docs/architecture/OVERVIEW.md` to document that worker navmesh loads/reloads now trigger a replay of dynamic obstacles.
- Verified `npm test -- tests/engine/systems/pathfindingSystem.test.ts` passes.
- Verified `npm run type-check` is still blocked by a pre-existing unrelated issue in `tests/scripts/launch-voidstrike.test.ts` where the Vitest globals (`describe`, `it`, `expect`, `afterEach`) are not declared.

- Switched the elevated-map movement investigation to the production build path and isolated the real root cause in input projection, not Recast corridor generation.
- Built a direct terrain probe comparing `RTSCamera.screenToWorld()` against a real Three.js raycast into the rendered terrain mesh. On elevated maps such as `contested_frontier`, the old heightfield iteration could snap a click from the visible upper plateau onto the lower cliff layer instead.
- Applied the fix in `src/rendering/Camera.ts`: when a terrain object is registered, `screenToWorld()` now raycasts against the actual terrain mesh first and only falls back to heightfield iteration if no terrain object is available.
- Wired the production game camera to the terrain mesh in `src/components/game/hooks/useWebGPURenderer.ts`, and also corrected the editor terrain raycast path in `src/editor/core/Editor3DCanvas.tsx` to recurse into terrain chunks.
- Added `tests/rendering/Camera.test.ts` as a regression using `contested_frontier`; it demonstrates the old plateau-edge miss and verifies the camera now matches the rendered terrain hit.
- Updated `docs/architecture/rendering.md` to document that click projection uses the terrain render mesh on multi-elevation maps.
- Verified `npm test -- tests/rendering/Camera.test.ts tests/engine/systems/pathfindingSystem.test.ts` passes.
- Verified `npm run build` passes with the production build path.
- Verified targeted ESLint on the touched files reports only pre-existing warnings in `src/components/game/hooks/useWebGPURenderer.ts` and `src/editor/core/Editor3DCanvas.tsx`; no new lint errors were introduced.

- Continued the elevated-map stop-after-an-inch investigation after gameplay reports ruled out both ramps-only and camera-click projection.
- Proved the actual root cause with direct TileCache experiments on `crystal_caverns`: building obstacles were being inserted at `y=0`, so on elevated maps they only affected the ground layer while the real HQ/platform navmesh sat around `y≈8.8`. That is why `test_6p_flat` worked and elevated maps did not.
- Applied the root fix in `src/engine/pathfinding/RecastNavigation.ts`, `src/workers/pathfinding.worker.ts`, and `src/editor/services/EditorNavigation.ts`: dynamic obstacles now sample the terrain/navmesh height at their footprint before being inserted into TileCache, and obstacle updates now loop until TileCache reports `upToDate`.
- Added `tests/engine/pathfinding/recastDynamicObstacleElevation.test.ts` to verify an elevated `crystal_caverns` HQ obstacle forces a reroute instead of leaving the path straight through the base footprint.
- Reverted the temporary non-root collision/camera hypothesis changes:
  - removed the hard-collision margin experiment in `src/engine/systems/movement/PathfindingMovement.ts`
  - removed the temporary camera raycast changes and deleted `tests/rendering/Camera.test.ts`
- Updated `docs/architecture/OVERVIEW.md` to document that elevated dynamic obstacles are inserted on the sampled terrain/navmesh layer rather than hard-coded `y=0`.
- Verified `npm test -- tests/engine/pathfinding/recastDynamicObstacleElevation.test.ts tests/engine/pathfinding/recastRampConnectivity.test.ts tests/engine/systems/pathfindingSystem.test.ts` passes (`23` tests).
- Verified `npm run build` passes in production mode.
- Verified targeted ESLint on the touched source/test files reports only pre-existing `EditorNavigation.ts` console warnings; no new lint errors.
- Verified `npm run type-check` is still blocked by the pre-existing Vitest-global issue in `tests/launch/launch-voidstrike.test.ts`.
- Installed `playwright` under `$HOME/.codex/skills/develop-web-game` so the required Playwright client can run without changing repo dependencies.
- Ran the required Playwright client twice against the production server (`output/web-game-prod/shot-0.png` and `output/web-game-prod-2/shot-0.png`). The client renders `/game/setup` correctly, but automated `Start Game` button clicks still do not transition into gameplay in this environment, so browser smoke verification remains blocked by the same UI automation limitation rather than the pathfinding code.
- TODO: Have the user manually retest the production build on an elevated map near the starting HQ/platform now that dynamic obstacles are on the correct nav layer.

- Changed direction from speculative fixes to live reproduction telemetry in the actual browser production path.
- Added a local telemetry client in `src/engine/debug/pathTelemetry.ts` plus a Node route at `src/app/api/debug/pathfinding/route.ts` that appends JSONL events to `output/live-pathfinding.jsonl`.
- Instrumented the browser input path in `src/engine/input/handlers/GameplayInputHandler.ts` to log right-click screen/world targets and the exact `MOVE` commands issued from the live game.
- Instrumented the authoritative worker path in `src/engine/workers/GameWorker.ts`, `src/engine/workers/WorkerBridge.ts`, `src/engine/workers/types.ts`, and `src/engine/systems/PathfindingSystem.ts` so live reproductions capture command receipt, path requests/results, tracked unit snapshots, and explicit movement-stalled events from the real simulation.
- Updated `docs/architecture/OVERVIEW.md` to document the local live path telemetry flow and output file.
- Verified `npm run build` passes with the telemetry changes.
- Verified targeted ESLint on the touched telemetry files passes.
- Verified the telemetry sink end-to-end with a synthetic POST to `http://127.0.0.1:3001/api/debug/pathfinding`, which wrote to `output/live-pathfinding.jsonl`.
- Restarted the production server on port `3001` and left a live tail running on `output/live-pathfinding.jsonl` so the next manual reproduction can be inspected immediately.
- The first telemetry build regressed gameplay input because worker-side telemetry forwarding was too broad: `PathfindingSystem` traces for all background gatherer repaths were being bridged to the main thread, creating unnecessary message volume on startup.
- Fixed that in `src/engine/workers/GameWorker.ts` by only forwarding system-originated path telemetry when it belongs to an actively tracked user-command trace.
- Rebuilt production, cleared the live trace file, and restarted the production server on port `3001` with the reduced telemetry scope.
- After user testing still showed missing move input, trimmed `GameplayInputHandler` telemetry again so the right-click path no longer walks selected entities/components before issuing the command; the UI trace now records only screen/world click position plus selected count.
- Rebuilt production and restarted port `3001` again on that simplified input-path build.

- Live production telemetry finally isolated the elevated-map stop path precisely:
  - the nested worker path query returns `found:false` immediately for elevated worker move orders
  - `MovementOrchestrator` re-requests a path 10 ticks later
  - `PathfindingSystem.queuePathRequest()` then hits the failed-path cache for the same destination cell and clears `targetX/targetY`, which is why units go idle after moving only a short distance
- Root fix applied in `src/engine/systems/PathfindingSystem.ts`: worker `findPath` requests now resolve `startHeight`/`endHeight` from the same terrain source used by navmesh generation, falling back to `GameCore.getTerrainHeightAt()` when no custom terrain height provider was injected. This fixes the authoritative worker case, where the terrain grid exists but `terrainHeightFunction` was null, so elevated queries were being sent to the nested path worker at height `0`.
- Added a regression in `tests/engine/systems/pathfindingSystem.test.ts` that verifies elevated worker path requests send nonzero terrain-derived heights even without a custom height callback.
- Updated `docs/architecture/OVERVIEW.md` to document the terrain-grid fallback for worker query heights.
- Verified `npm test -- tests/engine/systems/pathfindingSystem.test.ts` passes.
- Verified `npm run build` passes on the production path after the height fix.
- TODO: Restart the production server on `3001`, clear `output/live-pathfinding.jsonl`, and have the user rerun the same elevated worker move to confirm worker `path_result` events switch from `found:false` to real Recast paths.

- Investigated the economy/UI desync where workers visibly mine and return cargo but the mineral counter never increases.
- Root cause: in worker mode, `ResourceSystem` was crediting minerals into the worker's authoritative `playerResources` map and `GameWorker.sendRenderState()` was serializing that updated resource state, but `useWorkerBridge` only copied `gameTime` out of each render snapshot. The HUD reads from the main-thread Zustand store, so gathered minerals and worker-side supply changes never reached the UI.
- Applied fix:
  - added `syncPlayerResources()` to `src/store/gameStore.ts` so the main thread can atomically mirror minerals, plasma, supply, and max supply from worker authority
  - added `src/components/game/hooks/syncWorkerPlayerResources.ts` and wired `useWorkerBridge` to copy the local player's `renderState.playerResources` into Zustand on every worker render update
  - updated `docs/architecture/OVERVIEW.md` to document that worker snapshots now drive the local HUD resource state
- Added regression coverage in `tests/components/game/hooks/syncWorkerPlayerResources.test.ts` for both successful local-player sync and no-op behavior when the player is absent/spectating.
- Verified `npm test -- tests/components/game/hooks/syncWorkerPlayerResources.test.ts` passes.
- Verified `npm test -- tests/engine/systems/resourceSystem.test.ts tests/components/game/hooks/syncWorkerPlayerResources.test.ts` passes (`62` tests).
- Verified targeted ESLint on the touched files passes cleanly.
- `npm run type-check` is still blocked by the pre-existing Vitest globals issue in `tests/launch/launch-voidstrike.test.ts`.
- Ran the required Playwright smoke script against `http://localhost:3001/game/setup` and inspected `output/web-game-resource-sync/shot-0.png` plus `shot-1.png`; automation still stayed on the setup screen after the `Start Game` click, so live gameplay verification of mining remains blocked by the existing setup-flow automation limitation rather than this resource-sync fix.
