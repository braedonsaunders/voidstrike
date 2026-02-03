import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { AudioManager } from '@/audio/AudioManager';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { useGameSetupStore, isLocalPlayer } from '@/store/gameSetupStore';
import { useUIStore } from '@/store/uiStore';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { VOICE_COOLDOWN_CONFIG } from '@/data/audio.config';
import { SeededRandom } from '@/utils/math';
import * as THREE from 'three';

/**
 * AudioSystem - Fully data-driven audio integration
 *
 * All audio configuration is loaded from JSON config files.
 * Unit-specific sounds are defined in unit definitions (audio.weaponSound, audio.deathSound).
 * Voice lines are referenced via audio.voiceGroupId in unit definitions.
 *
 * No hardcoded sound mappings - everything is configurable via:
 * - public/audio/sounds.config.json
 * - public/audio/voices.config.json
 * - public/audio/music.config.json
 * - src/data/units/*.ts (unit definitions with audio config)
 */
export class AudioSystem extends System {
  public readonly name = 'AudioSystem';
  // Priority is set by SystemRegistry based on dependencies (runs after CombatSystem)
  private camera: THREE.Camera | null = null;
  private initialized = false;
  private currentAmbient: string | null = null;

  // FIX: Use SeededRandom for deterministic voice selection in replays
  // The seed is based on game tick + unit type hash for variety
  private audioRng: SeededRandom = new SeededRandom(12345);

  // Separate cooldowns per action type (values from audio.config.ts)
  private lastVoiceTimes: Record<string, number> = {
    select: 0,
    move: 0,
    attack: 0,
    ready: 0,
  };
  private voiceCooldowns: Record<string, number> = VOICE_COOLDOWN_CONFIG;

  constructor(game: Game) {
    super(game);
  }

  private isSpectator(): boolean {
    return useGameSetupStore.getState().isSpectator();
  }

  /**
   * Get the unit definition for a unit ID
   */
  private getUnitDefinition(unitId: string) {
    return UNIT_DEFINITIONS[unitId];
  }

  /**
   * Get the voice group ID for a unit (from unit definition or falls back to unit ID)
   */
  private getVoiceGroupId(unitId: string): string {
    const def = this.getUnitDefinition(unitId);
    return def?.audio?.voiceGroupId ?? unitId;
  }

  /**
   * Get the weapon sound ID for a unit (from unit definition)
   */
  private getWeaponSound(unitId: string): string | undefined {
    const def = this.getUnitDefinition(unitId);
    return def?.audio?.weaponSound;
  }

  /**
   * Get the death sound ID for a unit (from unit definition)
   */
  private getDeathSound(unitId: string): string | undefined {
    const def = this.getUnitDefinition(unitId);
    return def?.audio?.deathSound;
  }

  public async initialize(camera?: THREE.Camera, biome?: string): Promise<void> {
    if (this.initialized) return;

    this.camera = camera ?? null;
    await AudioManager.initialize(camera);
    this.setupEventListeners();
    this.initialized = true;

    // Sync with UI store settings
    const uiState = useUIStore.getState();
    AudioManager.setCategoryVolume('music', uiState.musicVolume);
    AudioManager.setCategoryVolume('combat', uiState.soundVolume);
    AudioManager.setCategoryVolume('ui', uiState.soundVolume);
    AudioManager.setCategoryVolume('unit', uiState.soundVolume);
    AudioManager.setCategoryVolume('building', uiState.soundVolume);
    AudioManager.setCategoryVolume('ambient', uiState.soundVolume);
    AudioManager.setCategoryVolume('voice', uiState.voicesEnabled ? uiState.voiceVolume : 0);
    AudioManager.setCategoryVolume('alert', uiState.alertsEnabled ? uiState.alertVolume : 0);

    // Initialize MusicPlayer
    await MusicPlayer.initialize();
    MusicPlayer.setVolume(uiState.musicVolume);
    MusicPlayer.setMuted(!uiState.musicEnabled);

    // Preload all sounds from config
    const allSoundIds = AudioManager.getPreloadSoundIds();
    await AudioManager.preload(allSoundIds);

    // Start biome ambient
    if (biome) {
      this.startAmbient(biome);
    }

    // Start gameplay music
    setTimeout(() => {
      this.startGameplayMusic();
    }, 500);
  }

  public async startGameplayMusic(): Promise<void> {
    await MusicPlayer.discoverTracks();

    const uiState = useUIStore.getState();
    if (!uiState.musicEnabled) {
      MusicPlayer.switchToCategory('gameplay');
      return;
    }

    MusicPlayer.play('gameplay');
  }

  public stopGameplayMusic(): void {
    MusicPlayer.stop();
  }

  /**
   * Play victory music (data-driven from config)
   */
  public playVictoryMusic(onComplete?: () => void): void {
    MusicPlayer.playSpecialTrack('victory', onComplete);
  }

  /**
   * Play defeat music (data-driven from config)
   */
  public playDefeatMusic(onComplete?: () => void): void {
    MusicPlayer.playSpecialTrack('defeat', onComplete);
  }

  public startAmbient(biome: string): void {
    const biomeAmbient = AudioManager.getBiomeAmbient();

    if (this.currentAmbient && this.currentAmbient !== biome) {
      const currentSound = biomeAmbient[this.currentAmbient];
      if (currentSound) {
        AudioManager.stop(currentSound);
      }
    }

    const ambientSound = biomeAmbient[biome];
    if (ambientSound) {
      this.currentAmbient = biome;
      AudioManager.play(ambientSound);
    }
  }

  /**
   * Play a random voice line for a unit (data-driven)
   */
  private playVoice(unitId: string, action: 'select' | 'move' | 'attack' | 'ready'): void {
    const now = Date.now();
    const lastTime = this.lastVoiceTimes[action] || 0;
    const cooldown = this.voiceCooldowns[action] || 0;

    if (now - lastTime < cooldown) return;

    const voiceGroupId = this.getVoiceGroupId(unitId);
    const voices = AudioManager.getVoiceLines(voiceGroupId);

    let soundIds: string[];
    if (action === 'ready' && voices.ready) {
      soundIds = [voices.ready];
    } else if (action === 'ready') {
      return;
    } else {
      soundIds = voices[action];
    }

    if (soundIds.length === 0) return;

    // FIX: Use SeededRandom for deterministic voice selection in replays
    // Reseed with game tick + a hash of action for variety while maintaining determinism
    const tick = this.game.getCurrentTick();
    const actionHash = action.charCodeAt(0) + (unitId?.charCodeAt(0) || 0) * 256;
    this.audioRng.reseed(tick * 1000 + actionHash);
    const soundId = soundIds[Math.floor(this.audioRng.next() * soundIds.length)];
    AudioManager.play(soundId);
    this.lastVoiceTimes[action] = now;
  }

  private getFirstUnitType(entityIds: number[]): string | null {
    for (const id of entityIds) {
      const entity = this.world.getEntity(id);
      if (entity) {
        const unit = entity.get<Unit>('Unit');
        if (unit) {
          return unit.unitId;
        }
      }
    }
    return null;
  }

  private setupEventListeners(): void {
    // Selection events
    this.game.eventBus.on('selection:changed', (data: { selectedIds: number[] }) => {
      if (this.isSpectator()) return;

      AudioManager.play('ui_select');

      if (data && data.selectedIds && data.selectedIds.length > 0) {
        const unitType = this.getFirstUnitType(data.selectedIds);
        if (unitType) {
          this.playVoice(unitType, 'select');
        }
      }
    });

    // Command events
    this.game.eventBus.on('command:move', (data: { entityIds: number[]; playerId?: string }) => {
      if (this.isSpectator()) return;
      if (!data.playerId || !isLocalPlayer(data.playerId)) return;

      if (data.entityIds.length > 0) {
        AudioManager.play('unit_move');

        const unitType = this.getFirstUnitType(data.entityIds);
        if (unitType) {
          this.playVoice(unitType, 'move');
        }
      }
    });

    this.game.eventBus.on('command:attack', (data: { entityIds: number[]; playerId?: string }) => {
      if (this.isSpectator()) return;
      if (!data.playerId || !isLocalPlayer(data.playerId)) return;

      if (data.entityIds.length > 0) {
        AudioManager.play('unit_attack');

        const unitType = this.getFirstUnitType(data.entityIds);
        if (unitType) {
          this.playVoice(unitType, 'attack');
        }
      }
    });

    // Combat events - data-driven weapon sounds
    this.game.eventBus.on('combat:attack', (data: {
      attackerId: number;
      targetId: number;
      damage: number;
    }) => {
      const attacker = this.world.getEntity(data.attackerId);
      if (attacker) {
        const transform = attacker.get<Transform>('Transform');
        const unit = attacker.get<Unit>('Unit');
        if (transform && unit) {
          const pos = new THREE.Vector3(transform.x, 0, transform.y);

          // Get weapon sound from unit definition (data-driven)
          const weaponSound = this.getWeaponSound(unit.unitId);
          if (weaponSound) {
            AudioManager.playAt(weaponSound, pos);
          }
        }
      }
    });

    this.game.eventBus.on('combat:hit', (data: {
      targetId?: number;
      damage?: number;
      position?: { x: number; y: number };
    }) => {
      if (data.position) {
        const pos = new THREE.Vector3(data.position.x, 0, data.position.y);
        AudioManager.playAt('hit_impact', pos);
      } else if (data.targetId !== undefined) {
        const target = this.world.getEntity(data.targetId);
        if (target) {
          const transform = target.get<Transform>('Transform');
          if (transform) {
            const pos = new THREE.Vector3(transform.x, 0, transform.y);
            AudioManager.playAt('hit_impact', pos);
          }
        }
      }
    });

    this.game.eventBus.on('combat:splash', (data: {
      position: { x: number; y: number };
      damage: number;
    }) => {
      const pos = new THREE.Vector3(data.position.x, 0, data.position.y);
      const explosionSound = data.damage >= 30 ? 'explosion_medium' : 'explosion_small';
      AudioManager.playAt(explosionSound, pos);
    });

    // Unit/building destroyed - data-driven death sounds
    this.game.eventBus.on('unit:destroyed', (data: {
      entityId: number;
      x: number;
      y: number;
      unitId?: string;
      playerId?: string;
    }) => {
      const pos = new THREE.Vector3(data.x, 0, data.y);

      // Get death sound from unit definition (data-driven)
      if (data.unitId) {
        const deathSound = this.getDeathSound(data.unitId);
        if (deathSound) {
          AudioManager.playAt(deathSound, pos);

          // Add explosion for mech deaths
          const def = this.getUnitDefinition(data.unitId);
          if (def?.isMechanical) {
            AudioManager.playAt('explosion_small', pos);
          }
        }
      }

      if (data.playerId && isLocalPlayer(data.playerId)) {
        AudioManager.play('alert_unit_lost');
      }
    });

    this.game.eventBus.on('building:destroyed', (data: {
      entityId: number;
      x: number;
      y: number;
      playerId?: string;
    }) => {
      const pos = new THREE.Vector3(data.x, 0, data.y);
      AudioManager.playAt('explosion_building', pos);

      if (data.playerId && isLocalPlayer(data.playerId)) {
        AudioManager.play('alert_building_lost');
      }
    });

    // Alert events
    this.game.eventBus.on('alert:underAttack', (data: {
      x: number;
      y: number;
      playerId?: string;
    }) => {
      if (data.playerId && isLocalPlayer(data.playerId)) {
        AudioManager.play('alert_under_attack');
      }
    });

    this.game.eventBus.on('alert:supplyBlocked', () => {
      if (this.isSpectator()) return;
      AudioManager.play('alert_additional_population_required');
    });

    this.game.eventBus.on('alert:notEnoughMinerals', () => {
      if (this.isSpectator()) return;
      AudioManager.play('alert_not_enough_minerals');
    });

    this.game.eventBus.on('alert:notEnoughPlasma', () => {
      if (this.isSpectator()) return;
      AudioManager.play('alert_not_enough_plasma');
    });

    this.game.eventBus.on('alert:mineralsDepleted', (data: { playerId?: string }) => {
      if (data?.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;
      AudioManager.play('alert_minerals_depleted');
    });

    // Production events
    this.game.eventBus.on('production:started', (data: { playerId?: string }) => {
      if (data?.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;
      AudioManager.play('production_start');
    });

    this.game.eventBus.on('production:complete', (data: { unitType?: string; playerId?: string }) => {
      if (data?.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;

      AudioManager.play('unit_ready');

      if (data && data.unitType) {
        this.playVoice(data.unitType, 'ready');
      }
    });

    // Building events
    this.game.eventBus.on('building:place', (data: { playerId?: string }) => {
      if (data?.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;
      AudioManager.play('building_place');
    });

    this.game.eventBus.on('building:complete', (data: { playerId?: string }) => {
      if (data?.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;
      AudioManager.play('alert_building_complete');
    });

    // Research events
    this.game.eventBus.on('research:started', (data: { playerId?: string }) => {
      if (data?.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;
      AudioManager.play('production_start');
    });

    this.game.eventBus.on('research:complete', (data: { playerId?: string }) => {
      if (data?.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;
      AudioManager.play('alert_research_complete');
    });

    this.game.eventBus.on('upgrade:complete', (data: { playerId?: string }) => {
      if (data?.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;
      AudioManager.play('alert_upgrade_complete');
    });

    // UI events
    this.game.eventBus.on('ui:error', () => {
      if (this.isSpectator()) return;
      AudioManager.play('ui_error');
    });

    this.game.eventBus.on('ui:click', () => {
      if (this.isSpectator()) return;
      AudioManager.play('ui_click');
    });

    // Game end events - play victory/defeat music
    this.game.eventBus.on('game:victory', () => {
      this.playVictoryMusic();
    });

    this.game.eventBus.on('game:defeat', () => {
      this.playDefeatMusic();
    });
  }

  public update(_deltaTime: number): void {
    if (this.camera) {
      AudioManager.updateListenerPosition(this.camera.position);
    }
  }

  public play(soundId: string, volumeMultiplier?: number): void {
    AudioManager.play(soundId, volumeMultiplier);
  }

  public playAt(soundId: string, position: THREE.Vector3, volumeMultiplier?: number): void {
    AudioManager.playAt(soundId, position, volumeMultiplier);
  }

  public setMasterVolume(volume: number): void {
    AudioManager.setMasterVolume(volume);
  }

  public setMuted(muted: boolean): void {
    AudioManager.setMuted(muted);
  }

  public dispose(): void {
    MusicPlayer.dispose();
    AudioManager.dispose();
  }
}
