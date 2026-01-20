/**
 * AI Worker Manager
 *
 * Manages the AI decisions web worker and provides an interface
 * for AI systems to offload micro decision computation.
 */

import { Game } from '../core/Game';
import { World } from '../ecs/World';
import { debugAI } from '@/utils/debugLogger';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';

// Types for worker communication
interface UnitSnapshot {
  id: number;
  x: number;
  y: number;
  playerId: string;
  unitId: string;
  state: string;
  health: number;
  maxHealth: number;
  attackDamage: number;
  attackSpeed: number;
  attackRange: number;
  sightRange: number;
  moveSpeed: number;
  isFlying: boolean;
  isWorker: boolean;
  canAttackGround: boolean;
  canAttackAir: boolean;
  targetEntityId: number | null;
  canTransform?: boolean;
  currentModeIsFlying?: boolean;
}

interface BuildingSnapshot {
  id: number;
  x: number;
  y: number;
  playerId: string;
  buildingId: string;
  health: number;
  maxHealth: number;
  width: number;
  height: number;
}

export interface MicroDecision {
  unitId: number;
  action: 'attack' | 'kite' | 'retreat' | 'transform' | 'none';
  targetId?: number;
  targetPosition?: { x: number; y: number };
  targetMode?: string;
  threatScore: number;
}

interface PendingMicroRequest {
  tick: number;
  aiPlayerId: string;
  resolve: (decisions: MicroDecision[]) => void;
}

export class AIWorkerManager {
  private static instance: AIWorkerManager | null = null;

  private worker: Worker | null = null;
  private workerReady: boolean = false;
  private game: Game;
  private world: World | null = null;

  // Track pending micro requests
  private pendingMicroRequests: Map<string, PendingMicroRequest> = new Map();
  private lastMicroResults: Map<string, { tick: number; decisions: MicroDecision[] }> = new Map();

  // Track AI players
  private aiPlayerIds: Set<string> = new Set();

  private constructor(game: Game) {
    this.game = game;
    this.initializeWorker();
  }

  /**
   * Get or create the singleton instance
   */
  public static getInstance(game: Game): AIWorkerManager {
    if (!AIWorkerManager.instance) {
      AIWorkerManager.instance = new AIWorkerManager(game);
    }
    return AIWorkerManager.instance;
  }

  /**
   * Reset the singleton (for testing or reinitialization)
   */
  public static reset(): void {
    if (AIWorkerManager.instance) {
      AIWorkerManager.instance.dispose();
      AIWorkerManager.instance = null;
    }
  }

  /**
   * Initialize the AI decisions worker
   */
  private initializeWorker(): void {
    if (typeof Worker === 'undefined') {
      debugAI.warn('[AIWorkerManager] Web Workers not supported, using main thread fallback');
      return;
    }

    try {
      // Create worker as ES module (required for Next.js 16+ Turbopack)
      this.worker = new Worker(
        new URL('../../workers/ai-decisions.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = (error) => {
        console.error('[AIWorkerManager] Worker error:', error);
        this.workerReady = false;
      };

      // Initialize with default config
      this.worker.postMessage({
        type: 'init',
        config: {},
      });

      debugAI.log('[AIWorkerManager] AI Worker created');
    } catch (error) {
      debugAI.warn('[AIWorkerManager] Failed to create worker:', error);
      this.worker = null;
    }
  }

  /**
   * Handle messages from the worker
   */
  private handleWorkerMessage(event: MessageEvent): void {
    const message = event.data;

    switch (message.type) {
      case 'initialized':
        if (message.success) {
          this.workerReady = true;
          debugAI.log('[AIWorkerManager] Worker initialized');
        } else {
          debugAI.error('[AIWorkerManager] Worker init failed');
        }
        break;

      case 'microResult':
        this.handleMicroResult(message.aiPlayerId, message.decisions, message.tick);
        break;
    }
  }

  /**
   * Handle micro decision results from worker
   */
  private handleMicroResult(aiPlayerId: string, decisions: MicroDecision[], tick: number): void {
    // Store results
    this.lastMicroResults.set(aiPlayerId, { tick, decisions });

    // Resolve pending request
    const pending = this.pendingMicroRequests.get(aiPlayerId);
    if (pending && pending.tick === tick) {
      pending.resolve(decisions);
      this.pendingMicroRequests.delete(aiPlayerId);
    }
  }

  /**
   * Set the world reference (called by AI systems)
   */
  public setWorld(world: World): void {
    this.world = world;
  }

  /**
   * Register an AI player
   */
  public registerAIPlayer(playerId: string): void {
    this.aiPlayerIds.add(playerId);
  }

  /**
   * Check if worker is available
   */
  public isWorkerReady(): boolean {
    return this.worker !== null && this.workerReady;
  }

  /**
   * Request micro decisions for an AI player
   * Returns a promise that resolves with decisions
   */
  public async requestMicroDecisions(aiPlayerId: string): Promise<MicroDecision[] | null> {
    if (!this.world) return null;
    if (!this.isWorkerReady()) return null;

    const currentTick = this.game.getCurrentTick();

    // Check if we already have pending request
    if (this.pendingMicroRequests.has(aiPlayerId)) {
      return null; // Request already in progress
    }

    // Check if we have recent results (within 2 ticks)
    const cached = this.lastMicroResults.get(aiPlayerId);
    if (cached && currentTick - cached.tick < 2) {
      return cached.decisions;
    }

    // Collect unit and building data
    const { aiUnits, enemyUnits, enemyBuildings } = this.collectEntityData(aiPlayerId);

    // Find friendly base position
    const friendlyBasePosition = this.findFriendlyBase(aiPlayerId);

    // Create promise for result
    const resultPromise = new Promise<MicroDecision[]>((resolve) => {
      this.pendingMicroRequests.set(aiPlayerId, {
        tick: currentTick,
        aiPlayerId,
        resolve,
      });
    });

    // Send to worker
    this.worker!.postMessage({
      type: 'evaluateMicro',
      aiPlayerId,
      aiUnits,
      enemyUnits,
      enemyBuildings,
      friendlyBasePosition,
      mapWidth: this.game.config.mapWidth,
      mapHeight: this.game.config.mapHeight,
      tick: currentTick,
    });

    return resultPromise;
  }

  /**
   * Get cached micro decisions (non-blocking)
   */
  public getCachedMicroDecisions(aiPlayerId: string): MicroDecision[] | null {
    const cached = this.lastMicroResults.get(aiPlayerId);
    if (!cached) return null;

    const currentTick = this.game.getCurrentTick();
    // Return cached results if they're recent (within 4 ticks = 200ms at 20 TPS)
    if (currentTick - cached.tick < 4) {
      return cached.decisions;
    }

    return null;
  }

  /**
   * Request micro decisions (fire-and-forget, non-blocking)
   */
  public requestMicroDecisionsAsync(aiPlayerId: string): void {
    if (!this.world) return;
    if (!this.isWorkerReady()) return;

    const currentTick = this.game.getCurrentTick();

    // Check if we already have pending request
    if (this.pendingMicroRequests.has(aiPlayerId)) {
      return; // Request already in progress
    }

    // Check if we have recent results
    const cached = this.lastMicroResults.get(aiPlayerId);
    if (cached && currentTick - cached.tick < 2) {
      return; // Results still fresh
    }

    // Collect entity data
    const { aiUnits, enemyUnits, enemyBuildings } = this.collectEntityData(aiPlayerId);

    // Find friendly base position
    const friendlyBasePosition = this.findFriendlyBase(aiPlayerId);

    // Track pending (with no-op resolve since we're not awaiting)
    this.pendingMicroRequests.set(aiPlayerId, {
      tick: currentTick,
      aiPlayerId,
      resolve: () => {},
    });

    // Send to worker
    this.worker!.postMessage({
      type: 'evaluateMicro',
      aiPlayerId,
      aiUnits,
      enemyUnits,
      enemyBuildings,
      friendlyBasePosition,
      mapWidth: this.game.config.mapWidth,
      mapHeight: this.game.config.mapHeight,
      tick: currentTick,
    });
  }

  /**
   * Collect entity data for worker
   */
  private collectEntityData(aiPlayerId: string): {
    aiUnits: UnitSnapshot[];
    enemyUnits: UnitSnapshot[];
    enemyBuildings: BuildingSnapshot[];
  } {
    const aiUnits: UnitSnapshot[] = [];
    const enemyUnits: UnitSnapshot[] = [];
    const enemyBuildings: BuildingSnapshot[] = [];

    // Collect units
    const units = this.world!.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');
    for (const entity of units) {
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (health.isDead()) continue;

      const snapshot: UnitSnapshot = {
        id: entity.id,
        x: transform.x,
        y: transform.y,
        playerId: selectable.playerId,
        unitId: unit.unitId,
        state: unit.state,
        health: health.current,
        maxHealth: health.max,
        attackDamage: unit.attackDamage,
        attackSpeed: unit.attackSpeed,
        attackRange: unit.attackRange,
        sightRange: unit.sightRange,
        moveSpeed: unit.speed,
        isFlying: unit.isFlying,
        isWorker: unit.isWorker,
        canAttackGround: unit.canAttackGround,
        canAttackAir: unit.canAttackAir,
        targetEntityId: unit.targetEntityId,
        canTransform: unit.canTransform,
        currentModeIsFlying: unit.getCurrentMode()?.isFlying,
      };

      if (selectable.playerId === aiPlayerId) {
        aiUnits.push(snapshot);
      } else {
        enemyUnits.push(snapshot);
      }
    }

    // Collect enemy buildings
    const buildings = this.world!.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');
    for (const entity of buildings) {
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (health.isDead()) continue;
      if (selectable.playerId === aiPlayerId) continue;

      enemyBuildings.push({
        id: entity.id,
        x: transform.x,
        y: transform.y,
        playerId: selectable.playerId,
        buildingId: building.buildingId,
        health: health.current,
        maxHealth: health.max,
        width: building.width,
        height: building.height,
      });
    }

    return { aiUnits, enemyUnits, enemyBuildings };
  }

  /**
   * Find friendly base position
   */
  private findFriendlyBase(playerId: string): { x: number; y: number } | null {
    const buildings = this.world!.getEntitiesWith('Building', 'Transform', 'Selectable');

    for (const entity of buildings) {
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      if (selectable.playerId !== playerId) continue;

      if (building.buildingId === 'headquarters' || building.buildingId === 'orbital_station') {
        return { x: transform.x, y: transform.y };
      }
    }

    return null;
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.workerReady = false;
    this.pendingMicroRequests.clear();
    this.lastMicroResults.clear();
    this.aiPlayerIds.clear();
  }
}
