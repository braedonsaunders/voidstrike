/**
 * Game Worker Module
 *
 * Provides a worker-based game engine for:
 * 1. Anti-throttling: Game logic continues at full speed when tab is inactive
 * 2. Performance: Game logic runs on a separate thread from rendering
 *
 * Architecture:
 * - GameWorker.ts: Web Worker running all game logic (ECS, systems, AI)
 * - WorkerBridge.ts: Main thread interface for communication
 * - MainThreadEventHandler.ts: Handles audio and effects on main thread
 * - RenderStateAdapter.ts: Adapts RenderState for renderer consumption
 * - types.ts: Shared types for worker/main thread communication
 *
 * Usage:
 * ```typescript
 * import { createWorkerBridge, MainThreadEventHandler } from '@/engine/workers';
 *
 * const bridge = await createWorkerBridge({
 *   config: gameConfig,
 *   playerId: 'player1',
 *   onRenderState: (state) => updateRenderers(state),
 *   onGameEvent: (event) => console.log(event),
 * });
 *
 * const eventHandler = new MainThreadEventHandler(bridge);
 *
 * bridge.start();
 * ```
 */

// Types
export type {
  RenderState,
  UnitRenderState,
  BuildingRenderState,
  ResourceRenderState,
  ProjectileRenderState,
  GameEvent,
  CombatAttackEvent,
  ProjectileSpawnEvent,
  ProjectileImpactEvent,
  UnitDiedEvent,
  BuildingDestroyedEvent,
  UnitTrainedEvent,
  BuildingCompleteEvent,
  UpgradeCompleteEvent,
  AbilityUsedEvent,
  SelectionChangedEvent,
  AlertEvent,
  MainToWorkerMessage,
  WorkerToMainMessage,
  GameCommand,
} from './types';

// Worker Bridge
export {
  WorkerBridge,
  getWorkerBridge,
  createWorkerBridge,
  type WorkerBridgeConfig,
} from './WorkerBridge';

// Event Handler
export { MainThreadEventHandler } from './MainThreadEventHandler';

// Render State Adapter
export { RenderStateWorldAdapter } from './RenderStateAdapter';

// Type helpers
export {
  TRANSFORM_FLOATS_PER_ENTITY,
  packTransforms,
  unpackTransform,
} from './types';
