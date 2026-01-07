import * as Phaser from 'phaser';
import { Game } from '@/engine/core/Game';
import { RTSCamera } from '../systems/RTSCamera';
import { UnitRenderer } from '../renderers/UnitRenderer';
import { BuildingRenderer } from '../renderers/BuildingRenderer';
import { ResourceRenderer } from '../renderers/ResourceRenderer';
import { TerrainRenderer } from '../renderers/TerrainRenderer';
import { FogOfWarRenderer } from '../renderers/FogOfWarRenderer';
import { EffectsRenderer } from '../renderers/EffectsRenderer';
import { SelectionRenderer } from '../renderers/SelectionRenderer';
import { MinimapRenderer } from '../renderers/MinimapRenderer';
import { RallyPointRenderer } from '../renderers/RallyPointRenderer';
import { InputHandler } from '../systems/InputHandler';
import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore } from '@/store/gameSetupStore';
import { spawnInitialEntities } from '@/utils/gameSetup';
import { DEFAULT_MAP, MapData } from '@/data/maps';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Selectable } from '@/engine/components/Selectable';

export class GameScene extends Phaser.Scene {
  // Core game engine (named differently to avoid conflict with Phaser.Scene.game)
  private gameEngine!: Game;
  private mapData: MapData = DEFAULT_MAP;

  // Camera system
  private rtsCamera!: RTSCamera;

  // Renderers
  private terrainRenderer!: TerrainRenderer;
  private unitRenderer!: UnitRenderer;
  private buildingRenderer!: BuildingRenderer;
  private resourceRenderer!: ResourceRenderer;
  private fogOfWarRenderer!: FogOfWarRenderer;
  private effectsRenderer!: EffectsRenderer;
  private selectionRenderer!: SelectionRenderer;
  private minimapRenderer!: MinimapRenderer;
  private rallyPointRenderer!: RallyPointRenderer;

  // Input
  private inputHandler!: InputHandler;

  // State
  private isAttackMove = false;
  private isPatrolMode = false;

  // Control group double-tap tracking
  private lastControlGroupTap: { group: number; time: number } | null = null;
  private subgroupIndex = 0;

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    // Load procedural graphics - we'll generate sprites programmatically
    // No external assets needed for initial implementation
  }

  create(): void {
    // Initialize game engine
    this.gameEngine = Game.getInstance({
      mapWidth: this.mapData.width,
      mapHeight: this.mapData.height,
      tickRate: 20,
      isMultiplayer: false,
      playerId: 'player1',
      aiEnabled: true,
    });

    // Get fog of war setting
    const fogOfWarEnabled = useGameSetupStore.getState().fogOfWar;

    // Initialize camera
    const playerSpawn = this.mapData.spawns.find(s => s.playerSlot === 1) || this.mapData.spawns[0];
    this.rtsCamera = new RTSCamera(
      this,
      this.mapData.width,
      this.mapData.height,
      playerSpawn.x,
      playerSpawn.y
    );

    // Initialize renderers in correct z-order (bottom to top)
    this.terrainRenderer = new TerrainRenderer(this, this.mapData);
    this.resourceRenderer = new ResourceRenderer(this, this.gameEngine.world);
    this.buildingRenderer = new BuildingRenderer(this, this.gameEngine.world, this.gameEngine.visionSystem, fogOfWarEnabled);
    this.unitRenderer = new UnitRenderer(this, this.gameEngine.world, this.gameEngine.visionSystem, fogOfWarEnabled);
    this.selectionRenderer = new SelectionRenderer(this, this.gameEngine.world);
    this.effectsRenderer = new EffectsRenderer(this, this.gameEngine.eventBus);
    this.rallyPointRenderer = new RallyPointRenderer(this, this.gameEngine.world, this.gameEngine.eventBus);

    if (fogOfWarEnabled) {
      this.fogOfWarRenderer = new FogOfWarRenderer(
        this,
        this.mapData.width,
        this.mapData.height,
        this.gameEngine.visionSystem
      );
    }

    this.minimapRenderer = new MinimapRenderer(
      this,
      this.mapData,
      this.gameEngine.world,
      this.gameEngine.visionSystem,
      fogOfWarEnabled
    );

    // Initialize input handler
    this.inputHandler = new InputHandler(this, this.gameEngine, this.rtsCamera);

    // Spawn initial entities
    spawnInitialEntities(this.gameEngine, this.mapData);

    // Initialize audio (audio system handles camera internally)
    this.gameEngine.audioSystem.initialize(undefined, this.mapData.biome);

    // Start game
    this.gameEngine.start();

    // Set up event listeners for input modes
    this.setupInputModeListeners();

    // Set up keyboard shortcuts
    this.setupKeyboardShortcuts();
  }

  private setupInputModeListeners(): void {
    // Listen for attack move and patrol mode changes from input handler
    this.inputHandler.on('attack-move-start', () => {
      this.isAttackMove = true;
      this.isPatrolMode = false;
    });

    this.inputHandler.on('attack-move-end', () => {
      this.isAttackMove = false;
    });

    this.inputHandler.on('patrol-start', () => {
      this.isPatrolMode = true;
      this.isAttackMove = false;
    });

    this.inputHandler.on('patrol-end', () => {
      this.isPatrolMode = false;
    });
  }

  private setupKeyboardShortcuts(): void {
    if (!this.input.keyboard) return;

    // F1 - Select idle worker
    this.input.keyboard.on('keydown-F1', (event: KeyboardEvent) => {
      event.preventDefault();
      this.selectIdleWorker();
    });

    // F5-F8 - Camera locations
    ['F5', 'F6', 'F7', 'F8'].forEach(key => {
      this.input.keyboard!.on(`keydown-${key}`, (event: KeyboardEvent) => {
        event.preventDefault();
        if (event.ctrlKey) {
          this.rtsCamera.saveLocation(key);
        } else {
          this.rtsCamera.recallLocation(key);
        }
      });
    });

    // Tab - Cycle subgroups
    this.input.keyboard.on('keydown-TAB', (event: KeyboardEvent) => {
      event.preventDefault();
      this.cycleSubgroups();
    });

    // Control groups (0-9)
    for (let i = 0; i <= 9; i++) {
      const key = i.toString();
      this.input.keyboard.on(`keydown-${key}`, (event: KeyboardEvent) => {
        if (event.ctrlKey) {
          // Set control group
          const selectedUnits = useGameStore.getState().selectedUnits;
          if (selectedUnits.length > 0) {
            this.gameEngine.eventBus.emit('selection:controlGroup:set', {
              group: i,
              entityIds: selectedUnits,
            });
          }
        } else if (!event.altKey) {
          // Get control group (with double-tap detection)
          this.handleControlGroupSelect(i);
        }
      });
    }

    // A - Attack move
    this.input.keyboard.on('keydown-A', () => {
      if (useGameStore.getState().selectedUnits.length > 0) {
        this.isAttackMove = true;
        this.isPatrolMode = false;
        this.inputHandler.setAttackMoveMode(true);
      }
    });

    // P - Patrol
    this.input.keyboard.on('keydown-P', () => {
      if (useGameStore.getState().selectedUnits.length > 0) {
        this.isPatrolMode = true;
        this.isAttackMove = false;
        this.inputHandler.setPatrolMode(true);
      }
    });

    // S - Stop
    this.input.keyboard.on('keydown-S', () => {
      this.gameEngine.processCommand({
        tick: this.gameEngine.getCurrentTick(),
        playerId: 'player1',
        type: 'STOP',
        entityIds: useGameStore.getState().selectedUnits,
      });
    });

    // H - Hold position
    this.input.keyboard.on('keydown-H', () => {
      this.gameEngine.processCommand({
        tick: this.gameEngine.getCurrentTick(),
        playerId: 'player1',
        type: 'HOLD',
        entityIds: useGameStore.getState().selectedUnits,
      });
    });

    // Escape - Cancel
    this.input.keyboard.on('keydown-ESC', () => {
      if (this.isAttackMove) {
        this.isAttackMove = false;
        this.inputHandler.setAttackMoveMode(false);
      } else if (this.isPatrolMode) {
        this.isPatrolMode = false;
        this.inputHandler.setPatrolMode(false);
      } else {
        this.gameEngine.eventBus.emit('selection:clear');
      }
    });

    // R - Rally point
    this.input.keyboard.on('keydown-R', () => {
      const store = useGameStore.getState();
      if (store.selectedUnits.length > 0) {
        store.setRallyPointMode(true);
      }
    });
  }

  private selectIdleWorker(): void {
    const workers = this.gameEngine.world.getEntitiesWith('Unit', 'Transform', 'Selectable');

    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable');

      if (unit.isWorker && unit.state === 'idle' && selectable?.playerId === 'player1') {
        useGameStore.getState().selectUnits([entity.id]);
        this.rtsCamera.setPosition(transform.x, transform.y);
        return;
      }
    }
  }

  private cycleSubgroups(): void {
    const selectedUnits = useGameStore.getState().selectedUnits;
    if (selectedUnits.length === 0) return;

    // Group units by type
    const unitsByType = new Map<string, number[]>();
    for (const id of selectedUnits) {
      const entity = this.gameEngine.world.getEntity(id);
      const unit = entity?.get<Unit>('Unit');
      if (unit) {
        const type = unit.unitId;
        if (!unitsByType.has(type)) {
          unitsByType.set(type, []);
        }
        unitsByType.get(type)!.push(id);
      }
    }

    const types = Array.from(unitsByType.keys());
    if (types.length > 1) {
      this.subgroupIndex = (this.subgroupIndex + 1) % types.length;
      const typeToSelect = types[this.subgroupIndex];
      const unitsOfType = unitsByType.get(typeToSelect) || [];
      useGameStore.getState().selectUnits(unitsOfType);
    }
  }

  private handleControlGroupSelect(group: number): void {
    const now = Date.now();

    // Check for double-tap (within 300ms)
    if (
      this.lastControlGroupTap &&
      this.lastControlGroupTap.group === group &&
      now - this.lastControlGroupTap.time < 300
    ) {
      // Double-tap: center camera on control group
      const groupUnits = useGameStore.getState().getControlGroup(group);
      if (groupUnits.length > 0) {
        let avgX = 0, avgY = 0, count = 0;
        for (const id of groupUnits) {
          const entity = this.gameEngine.world.getEntity(id);
          const transform = entity?.get<Transform>('Transform');
          if (transform) {
            avgX += transform.x;
            avgY += transform.y;
            count++;
          }
        }
        if (count > 0) {
          this.rtsCamera.setPosition(avgX / count, avgY / count);
        }
      }
      this.lastControlGroupTap = null;
    } else {
      // Single tap: select control group
      this.gameEngine.eventBus.emit('selection:controlGroup:get', { group });
      this.lastControlGroupTap = { group, time: now };
    }
  }

  update(time: number, delta: number): void {
    // Update camera
    this.rtsCamera.update(delta);

    // Update renderers
    this.terrainRenderer.update();
    this.resourceRenderer.update();
    this.buildingRenderer.update();
    this.unitRenderer.update();
    this.selectionRenderer.update();
    this.effectsRenderer.update(delta);
    this.rallyPointRenderer.update();

    if (this.fogOfWarRenderer) {
      this.fogOfWarRenderer.update();
    }

    this.minimapRenderer.update();

    // Update input handler
    this.inputHandler.update();

    // Check for pending camera move from minimap
    const pendingMove = useGameStore.getState().pendingCameraMove;
    if (pendingMove) {
      this.rtsCamera.setPosition(pendingMove.x, pendingMove.y);
      useGameStore.getState().clearPendingCameraMove();
    }

    // Update game store with current game time
    useGameStore.getState().setGameTime(this.gameEngine.getGameTime());

    // Update game store camera position
    const pos = this.rtsCamera.getPosition();
    useGameStore.getState().setCamera(pos.x, pos.y, this.rtsCamera.getZoom());
  }

  shutdown(): void {
    // Clean up renderers
    this.terrainRenderer?.destroy();
    this.unitRenderer?.destroy();
    this.buildingRenderer?.destroy();
    this.resourceRenderer?.destroy();
    this.fogOfWarRenderer?.destroy();
    this.effectsRenderer?.destroy();
    this.selectionRenderer?.destroy();
    this.minimapRenderer?.destroy();
    this.rallyPointRenderer?.destroy();
    this.inputHandler?.destroy();

    // Clean up game
    this.gameEngine.audioSystem.dispose();
    Game.resetInstance();
  }
}
