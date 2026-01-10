import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { AudioManager, UNIT_VOICES, BIOME_AMBIENT } from '@/audio/AudioManager';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { useGameSetupStore, isLocalPlayer } from '@/store/gameSetupStore';
import { useUIStore } from '@/store/uiStore';
import * as THREE from 'three';

export class AudioSystem extends System {
  public priority = 100; // Run after other systems
  private camera: THREE.Camera | null = null;
  private initialized = false;
  private currentAmbient: string | null = null;
  private lastVoiceTime = 0;
  private voiceCooldown = 300; // ms between voice lines

  constructor(game: Game) {
    super(game);
  }

  // Check if we're in spectator mode (no human player)
  private isSpectator(): boolean {
    return useGameSetupStore.getState().isSpectator();
  }

  // Call this after camera is created (camera is optional for 2D audio only)
  public async initialize(camera?: THREE.Camera, biome?: string): Promise<void> {
    if (this.initialized) return;

    this.camera = camera ?? null;
    AudioManager.initialize(camera);
    this.setupEventListeners();
    this.initialized = true;

    // Initialize and sync with UI store settings
    const uiState = useUIStore.getState();
    AudioManager.setCategoryVolume('music', uiState.musicVolume);
    AudioManager.setCategoryVolume('combat', uiState.soundVolume);
    AudioManager.setCategoryVolume('ui', uiState.soundVolume);
    AudioManager.setCategoryVolume('unit', uiState.soundVolume);
    AudioManager.setCategoryVolume('building', uiState.soundVolume);
    AudioManager.setCategoryVolume('ambient', uiState.soundVolume);
    AudioManager.setCategoryVolume('voice', uiState.soundVolume);
    AudioManager.setCategoryVolume('alert', uiState.soundVolume);

    // Initialize MusicPlayer with settings from store
    await MusicPlayer.initialize();
    MusicPlayer.setVolume(uiState.musicVolume);
    MusicPlayer.setMuted(!uiState.musicEnabled);

    // Preload common sounds
    AudioManager.preload([
      // UI
      'ui_click',
      'ui_error',
      'ui_select',
      'ui_research_complete',
      'ui_building_complete',
      'ui_notification',
      // Alerts
      'alert_under_attack',
      'alert_unit_lost',
      'alert_building_lost',
      'alert_supply_blocked',
      // Combat
      'attack_rifle',
      'attack_cannon',
      'attack_flamethrower',
      'hit_impact',
      'unit_death',
      'unit_death_mech',
      'unit_death_bio',
      'explosion_small',
      'explosion_large',
      // Unit commands
      'unit_move',
      'unit_attack',
      'unit_ready',
      // Building
      'building_place',
      'production_start',
    ]);

    // Start biome-specific ambient sound
    if (biome) {
      this.startAmbient(biome);
    }

    // Start gameplay music
    this.startGameplayMusic();
  }

  // Start gameplay music (discovers and plays random tracks from gameplay folder)
  public async startGameplayMusic(): Promise<void> {
    const uiState = useUIStore.getState();
    if (!uiState.musicEnabled) return;

    await MusicPlayer.discoverTracks();
    MusicPlayer.play('gameplay');
  }

  // Stop gameplay music
  public stopGameplayMusic(): void {
    MusicPlayer.stop();
  }

  // Start ambient sound for a biome
  public startAmbient(biome: string): void {
    // Stop current ambient if different
    if (this.currentAmbient && this.currentAmbient !== biome) {
      const currentSound = BIOME_AMBIENT[this.currentAmbient];
      if (currentSound) {
        AudioManager.stop(currentSound);
      }
    }

    const ambientSound = BIOME_AMBIENT[biome];
    if (ambientSound) {
      this.currentAmbient = biome;
      AudioManager.play(ambientSound);
    }
  }

  // Play a random voice line for a unit type
  private playVoice(unitId: string, action: 'select' | 'move' | 'attack' | 'ready'): void {
    const now = Date.now();
    if (now - this.lastVoiceTime < this.voiceCooldown) return;

    const voices = UNIT_VOICES[unitId];
    if (!voices) return;

    let soundIds: string[];
    if (action === 'ready' && voices.ready) {
      soundIds = [voices.ready];
    } else if (action === 'ready') {
      return; // No ready sound for this unit
    } else {
      soundIds = voices[action];
    }

    if (soundIds.length === 0) return;

    const soundId = soundIds[Math.floor(Math.random() * soundIds.length)];
    AudioManager.play(soundId);
    this.lastVoiceTime = now;
  }

  // Get the first unit type from a selection for voice lines
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
    // Selection events - play unit voice on select (only for human player)
    this.game.eventBus.on('selection:changed', (data: { entityIds: number[] }) => {
      // Skip selection sounds in spectator mode
      if (this.isSpectator()) return;

      AudioManager.play('ui_select');

      // Play unit voice line
      if (data && data.entityIds && data.entityIds.length > 0) {
        const unitType = this.getFirstUnitType(data.entityIds);
        if (unitType) {
          this.playVoice(unitType, 'select');
        }
      }
    });

    // Command events - play unit voice on move/attack (only for human player)
    this.game.eventBus.on('command:move', (data: { entityIds: number[] }) => {
      // Skip command sounds in spectator mode
      if (this.isSpectator()) return;

      if (data.entityIds.length > 0) {
        AudioManager.play('unit_move');

        // Play unit voice line
        const unitType = this.getFirstUnitType(data.entityIds);
        if (unitType) {
          this.playVoice(unitType, 'move');
        }
      }
    });

    this.game.eventBus.on('command:attack', (data: { entityIds: number[] }) => {
      // Skip command sounds in spectator mode
      if (this.isSpectator()) return;

      if (data.entityIds.length > 0) {
        AudioManager.play('unit_attack');

        // Play unit voice line
        const unitType = this.getFirstUnitType(data.entityIds);
        if (unitType) {
          this.playVoice(unitType, 'attack');
        }
      }
    });

    // Combat events - play weapon sounds based on unit type
    this.game.eventBus.on('combat:attack', (data: {
      attackerId: number;
      targetId: number;
      damage: number;
    }) => {
      const attacker = this.world.getEntity(data.attackerId);
      if (attacker) {
        const transform = attacker.get<Transform>('Transform');
        const unit = attacker.get<Unit>('Unit');
        if (transform) {
          const pos = new THREE.Vector3(transform.x, 0, transform.y);

          // Choose weapon sound based on unit type
          let weaponSound = 'attack_rifle';
          if (unit) {
            if (unit.unitId === 'devastator') {
              weaponSound = 'attack_cannon';
            } else if (unit.unitId === 'scorcher') {
              weaponSound = 'attack_flamethrower';
            } else if (unit.unitId === 'breacher') {
              weaponSound = 'attack_cannon';
            }
          }

          AudioManager.playAt(weaponSound, pos);
        }
      }
    });

    this.game.eventBus.on('combat:hit', (data: {
      targetId: number;
      damage: number
    }) => {
      const target = this.world.getEntity(data.targetId);
      if (target) {
        const transform = target.get<Transform>('Transform');
        if (transform) {
          const pos = new THREE.Vector3(transform.x, 0, transform.y);
          AudioManager.playAt('hit_impact', pos);
        }
      }
    });

    // Unit/building destroyed - play death sounds and alerts
    this.game.eventBus.on('unit:destroyed', (data: {
      entityId: number;
      x: number;
      y: number;
      unitId?: string;
      playerId?: string;
    }) => {
      const pos = new THREE.Vector3(data.x, 0, data.y);

      // Choose death sound based on unit type
      let deathSound = 'unit_death';
      if (data.unitId === 'devastator' || data.unitId === 'scorcher') {
        deathSound = 'unit_death_mech';
        AudioManager.playAt('explosion_small', pos);
      }
      AudioManager.playAt(deathSound, pos);

      // Play alert for local player's units
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

      // Play alert for local player's buildings
      if (data.playerId && isLocalPlayer(data.playerId)) {
        AudioManager.play('alert_building_lost');
      }
    });

    // Under attack alert
    this.game.eventBus.on('alert:underAttack', (data: {
      x: number;
      y: number;
      playerId?: string;
    }) => {
      if (data.playerId && isLocalPlayer(data.playerId)) {
        AudioManager.play('alert_under_attack');
      }
    });

    // Supply blocked alert (only for human player)
    this.game.eventBus.on('alert:supplyBlocked', () => {
      // Skip in spectator mode
      if (this.isSpectator()) return;
      AudioManager.play('alert_supply_blocked');
    });

    // Production events (only for local player)
    this.game.eventBus.on('production:started', (data: { playerId?: string }) => {
      // Only play for local player's production, not AI
      if (data?.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;
      AudioManager.play('production_start');
    });

    this.game.eventBus.on('production:complete', (data: { unitId?: string; playerId?: string }) => {
      // Only play for local player's production, not AI
      if (data?.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;

      AudioManager.play('unit_ready');

      // Play unit-specific ready voice
      if (data && data.unitId) {
        this.playVoice(data.unitId, 'ready');
      }
    });

    // Building events (only for local player)
    this.game.eventBus.on('building:place', (data: { playerId?: string }) => {
      // Only play for local player's buildings, not AI
      if (data?.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;
      AudioManager.play('building_place');
    });

    this.game.eventBus.on('building:complete', (data: { playerId?: string }) => {
      // Only play sound for local player's buildings, not AI
      if (data?.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;
      AudioManager.play('ui_building_complete');
    });

    // Research events (only for local player)
    this.game.eventBus.on('research:started', (data: { playerId?: string }) => {
      // Only play for local player's research, not AI
      if (data?.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;
      AudioManager.play('production_start');
    });

    this.game.eventBus.on('research:complete', (data: { playerId?: string }) => {
      // Only play for local player's research, not AI
      if (data?.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;
      AudioManager.play('ui_research_complete');
    });

    // UI error events (only for human player)
    this.game.eventBus.on('ui:error', () => {
      // Skip in spectator mode
      if (this.isSpectator()) return;
      AudioManager.play('ui_error');
    });

    // UI click (can be called from UI components - only for human player)
    this.game.eventBus.on('ui:click', () => {
      // Skip in spectator mode
      if (this.isSpectator()) return;
      AudioManager.play('ui_click');
    });
  }

  public update(_deltaTime: number): void {
    // Audio system is event-driven, no per-frame updates needed
    // Could add ambient sound management here if needed
  }

  // Expose AudioManager methods
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
