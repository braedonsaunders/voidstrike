import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Building } from '../components/Building';
import { Ability } from '../components/Ability';
import { Resource } from '../components/Resource';
import { debugInitialization } from '@/utils/debugLogger';

export interface SavedEntity {
  id: number;
  components: Record<string, unknown>;
}

export interface SavedGameState {
  version: string;
  timestamp: number;
  gameTime: number;
  currentTick: number;
  mapWidth: number;
  mapHeight: number;
  players: SavedPlayerState[];
  entities: SavedEntity[];
  fogOfWar: Record<string, number[][]>;
}

export interface SavedPlayerState {
  playerId: string;
  resources: {
    minerals: number;
    vespene: number;
    supply: number;
    maxSupply: number;
  };
  upgrades: string[];
  controlGroups: Record<number, number[]>;
}

const SAVE_VERSION = '1.0.0';
const AUTO_SAVE_INTERVAL = 60000; // 1 minute
const MAX_SAVE_SLOTS = 10;

export class SaveLoadSystem extends System {
  public readonly name = 'SaveLoadSystem';
  public priority = 250; // Run very late

  private lastAutoSave: number = 0;
  private autoSaveEnabled: boolean = true;

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('save:game', (data: { slot?: number; name?: string }) => {
      this.saveGame(data.slot || 0, data.name);
    });

    this.game.eventBus.on('load:game', (data: { slot?: number }) => {
      this.loadGame(data.slot || 0);
    });

    this.game.eventBus.on('save:quicksave', () => {
      this.quickSave();
    });

    this.game.eventBus.on('load:quickload', () => {
      this.quickLoad();
    });
  }

  public update(deltaTime: number): void {
    if (!this.autoSaveEnabled) return;

    const currentTime = Date.now();
    if (currentTime - this.lastAutoSave >= AUTO_SAVE_INTERVAL) {
      this.lastAutoSave = currentTime;
      this.autoSave();
    }
  }

  public saveGame(slot: number = 0, name?: string): boolean {
    try {
      const saveState = this.serializeGameState();
      const saveKey = `voidstrike_save_${slot}`;
      const saveName = name || `Save ${slot + 1}`;

      const saveData = {
        name: saveName,
        state: saveState,
        savedAt: Date.now(),
      };

      localStorage.setItem(saveKey, JSON.stringify(saveData));

      this.game.eventBus.emit('save:complete', {
        slot,
        name: saveName,
        timestamp: saveData.savedAt,
      });

      return true;
    } catch (error) {
      debugInitialization.error('Failed to save game:', error);
      this.game.eventBus.emit('save:failed', { error: String(error) });
      return false;
    }
  }

  public loadGame(slot: number = 0): boolean {
    try {
      const saveKey = `voidstrike_save_${slot}`;
      const saveDataJson = localStorage.getItem(saveKey);

      if (!saveDataJson) {
        this.game.eventBus.emit('load:failed', { error: 'Save not found' });
        return false;
      }

      const saveData = JSON.parse(saveDataJson);
      this.deserializeGameState(saveData.state);

      this.game.eventBus.emit('load:complete', {
        slot,
        name: saveData.name,
        timestamp: saveData.savedAt,
      });

      return true;
    } catch (error) {
      debugInitialization.error('Failed to load game:', error);
      this.game.eventBus.emit('load:failed', { error: String(error) });
      return false;
    }
  }

  public quickSave(): boolean {
    return this.saveGame(-1, 'Quick Save');
  }

  public quickLoad(): boolean {
    return this.loadGame(-1);
  }

  private autoSave(): void {
    this.saveGame(-2, 'Auto Save');
  }

  public getSaveSlots(): Array<{ slot: number; name: string; savedAt: number } | null> {
    const slots: Array<{ slot: number; name: string; savedAt: number } | null> = [];

    for (let i = 0; i < MAX_SAVE_SLOTS; i++) {
      const saveKey = `voidstrike_save_${i}`;
      const saveDataJson = localStorage.getItem(saveKey);

      if (saveDataJson) {
        try {
          const saveData = JSON.parse(saveDataJson);
          slots.push({
            slot: i,
            name: saveData.name,
            savedAt: saveData.savedAt,
          });
        } catch {
          slots.push(null);
        }
      } else {
        slots.push(null);
      }
    }

    return slots;
  }

  public deleteSave(slot: number): boolean {
    try {
      const saveKey = `voidstrike_save_${slot}`;
      localStorage.removeItem(saveKey);
      return true;
    } catch {
      return false;
    }
  }

  private serializeGameState(): SavedGameState {
    const entities: SavedEntity[] = [];

    // Serialize all entities with their components
    const allEntities = this.world.getEntities();
    for (const entity of allEntities) {
      const savedEntity: SavedEntity = {
        id: entity.id,
        components: {},
      };

      // Serialize Transform
      const transform = entity.get<Transform>('Transform');
      if (transform) {
        savedEntity.components.Transform = {
          x: transform.x,
          y: transform.y,
          z: transform.z,
          rotation: transform.rotation,
        };
      }

      // Serialize Health
      const health = entity.get<Health>('Health');
      if (health) {
        savedEntity.components.Health = {
          current: health.current,
          max: health.max,
          armor: health.armor,
          armorType: health.armorType,
          shield: health.shield,
          maxShield: health.maxShield,
        };
      }

      // Serialize Unit
      const unit = entity.get<Unit>('Unit');
      if (unit) {
        savedEntity.components.Unit = {
          unitId: unit.unitId,
          state: unit.state,
          targetX: unit.targetX,
          targetY: unit.targetY,
          targetEntityId: unit.targetEntityId,
          currentMode: unit.currentMode,
          isCloaked: unit.isCloaked,
          loadedUnits: unit.loadedUnits,
          commandQueue: unit.commandQueue,
        };
      }

      // Serialize Building
      const building = entity.get<Building>('Building');
      if (building) {
        savedEntity.components.Building = {
          buildingId: building.buildingId,
          state: building.state,
          buildProgress: building.buildProgress,
          productionQueue: building.productionQueue,
          currentAddon: building.currentAddon,
          addonEntityId: building.addonEntityId,
          isFlying: building.isFlying,
          isLowered: building.isLowered,
          rallyX: building.rallyX,
          rallyY: building.rallyY,
          rallyTargetId: building.rallyTargetId,
        };
      }

      // Serialize Selectable
      const selectable = entity.get<Selectable>('Selectable');
      if (selectable) {
        savedEntity.components.Selectable = {
          playerId: selectable.playerId,
          isSelected: selectable.isSelected,
        };
      }

      // Serialize Ability
      const ability = entity.get<Ability>('Ability');
      if (ability) {
        const abilities: Record<string, { currentCooldown: number; isActive: boolean }> = {};
        for (const [id, state] of ability.abilities) {
          abilities[id] = {
            currentCooldown: state.currentCooldown,
            isActive: state.isActive,
          };
        }
        savedEntity.components.Ability = {
          energy: ability.energy,
          maxEnergy: ability.maxEnergy,
          abilities,
        };
      }

      // Serialize Resource
      const resource = entity.get<Resource>('Resource');
      if (resource) {
        savedEntity.components.Resource = {
          resourceType: resource.resourceType,
          amount: resource.amount,
          maxAmount: resource.maxAmount,
        };
      }

      entities.push(savedEntity);
    }

    // Get player states
    const players: SavedPlayerState[] = [];

    // Collect player IDs from entities
    const playerIds = new Set<string>();
    for (const entity of allEntities) {
      const selectable = entity.get<Selectable>('Selectable');
      if (selectable) {
        playerIds.add(selectable.playerId);
      }
    }

    for (const playerId of playerIds) {
      // Get resources from event or default
      players.push({
        playerId,
        resources: {
          minerals: 0, // Will be restored from ResourceSystem
          vespene: 0,
          supply: 0,
          maxSupply: 0,
        },
        upgrades: [],
        controlGroups: {},
      });
    }

    return {
      version: SAVE_VERSION,
      timestamp: Date.now(),
      gameTime: this.game.getGameTime(),
      currentTick: this.game.getCurrentTick(),
      mapWidth: this.game.config.mapWidth,
      mapHeight: this.game.config.mapHeight,
      players,
      entities,
      fogOfWar: {},
    };
  }

  private deserializeGameState(state: SavedGameState): void {
    // Version check
    if (state.version !== SAVE_VERSION) {
      debugInitialization.warn(`Save version mismatch: ${state.version} vs ${SAVE_VERSION}`);
    }

    // Clear existing entities
    const allEntities = this.world.getEntities();
    for (const entity of allEntities) {
      this.world.destroyEntity(entity.id);
    }

    // Restore entities
    for (const savedEntity of state.entities) {
      // Create new entity and restore components
      const entity = this.world.createEntity();

      // Restore Transform
      if (savedEntity.components.Transform) {
        const t = savedEntity.components.Transform as {
          x: number;
          y: number;
          z: number;
          rotation: number;
        };
        entity.add(new Transform(t.x, t.y, t.z, t.rotation));
      }

      // Restore Health
      if (savedEntity.components.Health) {
        const h = savedEntity.components.Health as {
          current: number;
          max: number;
          armor: number;
          armorType: string;
          shield: number;
          maxShield: number;
        };
        const health = new Health(h.max, h.armor, h.armorType as 'light' | 'armored' | 'massive' | 'structure');
        health.current = h.current;
        health.shield = h.shield;
        health.maxShield = h.maxShield;
        entity.add(health);
      }

      // Restore Selectable
      if (savedEntity.components.Selectable) {
        const s = savedEntity.components.Selectable as {
          playerId: string;
          isSelected: boolean;
        };
        const selectable = new Selectable(1, 0, s.playerId);
        selectable.isSelected = s.isSelected;
        entity.add(selectable);
      }

      // Other components would be restored similarly
      // This is a simplified implementation - full restoration would require
      // more complex handling of Unit, Building, Ability components
    }

    // Emit state restored event
    this.game.eventBus.emit('game:stateRestored', {
      gameTime: state.gameTime,
      currentTick: state.currentTick,
    });
  }

  public setAutoSaveEnabled(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
  }

  public isAutoSaveEnabled(): boolean {
    return this.autoSaveEnabled;
  }
}
