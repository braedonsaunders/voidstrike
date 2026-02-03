/**
 * Main Thread Event Handler
 *
 * Handles game events from the GameWorker on the main thread.
 * Responsible for:
 * - Audio playback (Web Audio API requires main thread)
 * - Visual effects triggering (BattleEffectsRenderer)
 * - UI notifications and alerts
 *
 * This bridges the gap between the worker (where game logic runs)
 * and the main thread (where audio/rendering happens).
 */

import * as THREE from 'three';
import { AudioManager } from '@/audio/AudioManager';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { useUIStore } from '@/store/uiStore';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { VOICE_COOLDOWN_CONFIG } from '@/data/audio.config';
import { SeededRandom } from '@/utils/math';
import type {
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
} from './types';
import type { WorkerBridge } from './WorkerBridge';

// ============================================================================
// MAIN THREAD EVENT HANDLER
// ============================================================================

export class MainThreadEventHandler {
  private bridge: WorkerBridge;
  private localPlayerId: string;
  private battleEffectsCallback: ((event: GameEvent) => void) | null = null;

  // Audio state
  private audioRng: SeededRandom;
  private lastVoiceTimes: Record<string, number> = {
    select: 0,
    move: 0,
    attack: 0,
    ready: 0,
  };
  private voiceCooldowns: Record<string, number> = VOICE_COOLDOWN_CONFIG;

  // Cleanup functions for event subscriptions
  private cleanupFns: Array<() => void> = [];

  // Reusable vector for 3D audio positions
  private tempVec3 = new THREE.Vector3();

  constructor(bridge: WorkerBridge, localPlayerId: string = 'player1') {
    this.bridge = bridge;
    this.localPlayerId = localPlayerId;
    this.audioRng = new SeededRandom(Date.now());
    this.setupEventListeners();
  }

  /**
   * Set callback for battle effects (BattleEffectsRenderer)
   */
  public setBattleEffectsCallback(callback: (event: GameEvent) => void): void {
    this.battleEffectsCallback = callback;
  }

  private setupEventListeners(): void {
    const eventBus = this.bridge.eventBus;

    // Combat events -> Audio + Effects
    this.cleanupFns.push(
      eventBus.on<CombatAttackEvent>('combat:attack', (event) => {
        this.handleCombatAttack(event);
        this.battleEffectsCallback?.(event);
      })
    );

    // Projectile events -> Effects
    this.cleanupFns.push(
      eventBus.on<ProjectileSpawnEvent>('projectile:spawned', (event) => {
        this.battleEffectsCallback?.(event);
      })
    );

    this.cleanupFns.push(
      eventBus.on<ProjectileImpactEvent>('projectile:impact', (event) => {
        this.handleProjectileImpact(event);
        this.battleEffectsCallback?.(event);
      })
    );

    // Unit events -> Audio + Effects
    this.cleanupFns.push(
      eventBus.on<UnitDiedEvent>('unit:died', (event) => {
        this.handleUnitDied(event);
        this.battleEffectsCallback?.(event);
      })
    );

    this.cleanupFns.push(
      eventBus.on<UnitTrainedEvent>('unit:trained', (event) => {
        this.handleUnitTrained(event);
      })
    );

    // Building events -> Audio + Effects
    this.cleanupFns.push(
      eventBus.on<BuildingDestroyedEvent>('building:destroyed', (event) => {
        this.handleBuildingDestroyed(event);
        this.battleEffectsCallback?.(event);
      })
    );

    this.cleanupFns.push(
      eventBus.on<BuildingCompleteEvent>('building:complete', (event) => {
        this.handleBuildingComplete(event);
      })
    );

    // Upgrade events -> Audio
    this.cleanupFns.push(
      eventBus.on<UpgradeCompleteEvent>('upgrade:complete', (event) => {
        this.handleUpgradeComplete(event);
      })
    );

    // Ability events -> Audio + Effects
    this.cleanupFns.push(
      eventBus.on<AbilityUsedEvent>('ability:used', (event) => {
        this.handleAbilityUsed(event);
        this.battleEffectsCallback?.(event);
      })
    );

    // Selection events -> Audio
    this.cleanupFns.push(
      eventBus.on<SelectionChangedEvent>('selection:changed', (event) => {
        this.handleSelectionChanged(event);
      })
    );

    // Alert events -> Audio + UI
    this.cleanupFns.push(
      eventBus.on<AlertEvent>('alert', (event) => {
        this.handleAlert(event);
      })
    );
  }

  // ============================================================================
  // AUDIO HANDLERS
  // ============================================================================

  private handleCombatAttack(event: CombatAttackEvent): void {
    // Play weapon sound based on attacker type
    const unitDef = UNIT_DEFINITIONS[event.attackerType];
    const weaponSound = unitDef?.audio?.weaponSound;

    if (weaponSound) {
      const position = event.attackerPos;
      this.tempVec3.set(position.x, 0, position.y);
      AudioManager.playAt(weaponSound, this.tempVec3, 0.6);
    }
  }

  private handleProjectileImpact(event: ProjectileImpactEvent): void {
    // Play impact sound based on damage type
    let impactSound = 'impact_default';
    switch (event.damageType) {
      case 'explosive':
        impactSound = event.splashRadius > 0 ? 'explosion_large' : 'explosion_small';
        break;
      case 'psionic':
        impactSound = 'impact_psionic';
        break;
      case 'torpedo':
        impactSound = 'explosion_underwater';
        break;
    }

    this.tempVec3.set(event.position.x, event.position.y, event.position.z);
    AudioManager.playAt(impactSound, this.tempVec3, 0.5);
  }

  private handleUnitDied(event: UnitDiedEvent): void {
    // Play death sound
    const unitDef = UNIT_DEFINITIONS[event.unitType];
    const deathSound = unitDef?.audio?.deathSound ?? 'unit_death';

    this.tempVec3.set(event.position.x, 0, event.position.y);
    AudioManager.playAt(deathSound, this.tempVec3, 0.7);
  }

  private handleUnitTrained(event: UnitTrainedEvent): void {
    // Only play for local player
    if (event.playerId !== this.localPlayerId) return;

    // Play ready voice line
    this.playVoiceLine(event.unitType, 'ready');

    // Play unit ready UI sound
    AudioManager.play('ui_unit_ready', 0.5);
  }

  private handleBuildingDestroyed(event: BuildingDestroyedEvent): void {
    // Play destruction sound
    this.tempVec3.set(event.position.x, 0, event.position.y);
    AudioManager.playAt('building_destroyed', this.tempVec3, 0.8);
  }

  private handleBuildingComplete(event: BuildingCompleteEvent): void {
    // Only play for local player
    if (event.playerId !== this.localPlayerId) return;

    // Play completion sound
    AudioManager.play('building_complete', 0.6);

    // Announce for important buildings
    if (['headquarters', 'infantry_bay', 'vehicle_bay', 'tech_lab'].includes(event.buildingType)) {
      AudioManager.play('announcement_construction_complete', 0.7);
    }
  }

  private handleUpgradeComplete(event: UpgradeCompleteEvent): void {
    // Only play for local player
    if (event.playerId !== this.localPlayerId) return;

    AudioManager.play('upgrade_complete', 0.6);
    AudioManager.play('announcement_upgrade_complete', 0.7);
  }

  private handleAbilityUsed(event: AbilityUsedEvent): void {
    // Play ability sound
    const abilitySound = `ability_${event.abilityId}`;
    this.tempVec3.set(event.position.x, 0, event.position.y);
    AudioManager.playAt(abilitySound, this.tempVec3, 0.7);
  }

  private handleSelectionChanged(event: SelectionChangedEvent): void {
    // Only play for local player
    if (event.playerId !== this.localPlayerId) return;

    if (event.entityIds.length === 0) return;

    // Play selection sound
    if (event.primaryType) {
      this.playVoiceLine(event.primaryType, 'select');
    }
  }

  private handleAlert(event: AlertEvent): void {
    // Only play for local player
    if (event.playerId !== this.localPlayerId) return;

    const uiState = useUIStore.getState();
    if (!uiState.alertsEnabled) return;

    switch (event.alertType) {
      case 'under_attack':
        AudioManager.play('alert_under_attack', uiState.alertVolume);
        break;
      case 'unit_ready':
        AudioManager.play('alert_unit_ready', uiState.alertVolume * 0.8);
        break;
      case 'research_complete':
        AudioManager.play('alert_research_complete', uiState.alertVolume);
        break;
      case 'resources_low':
        AudioManager.play('alert_resources_low', uiState.alertVolume * 0.7);
        break;
      case 'base_destroyed':
        AudioManager.play('alert_base_destroyed', uiState.alertVolume);
        break;
    }
  }

  // ============================================================================
  // VOICE LINES
  // ============================================================================

  private getVoiceGroupId(unitId: string): string {
    const def = UNIT_DEFINITIONS[unitId];
    return def?.audio?.voiceGroupId ?? unitId;
  }

  private playVoiceLine(unitType: string, action: 'select' | 'move' | 'attack' | 'ready'): void {
    const uiState = useUIStore.getState();
    if (!uiState.voicesEnabled) return;

    const now = performance.now();
    const cooldown = this.voiceCooldowns[action] ?? 1000;
    const lastTime = this.lastVoiceTimes[action] ?? 0;

    if (now - lastTime < cooldown) return;

    this.lastVoiceTimes[action] = now;

    const voiceGroupId = this.getVoiceGroupId(unitType);
    const voiceId = `voice_${voiceGroupId}_${action}`;

    // Use random variation
    const variation = Math.floor(this.audioRng.next() * 3) + 1;
    const voiceIdWithVariation = `${voiceId}_${variation}`;

    AudioManager.play(voiceIdWithVariation, uiState.voiceVolume);
  }

  // ============================================================================
  // AUDIO INITIALIZATION
  // ============================================================================

  private audioInitialized = false;

  /**
   * Initialize the audio system with camera for spatial audio and sync UI store settings.
   * Must be called after renderer setup when camera is available.
   */
  public async initializeAudio(camera?: THREE.Camera, biome?: string): Promise<void> {
    if (this.audioInitialized) return;

    // Initialize AudioManager with camera for spatial audio
    await AudioManager.initialize(camera);

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

    // Set master mute state
    AudioManager.setMuted(!uiState.soundEnabled);

    // Initialize MusicPlayer with settings
    await MusicPlayer.initialize();
    MusicPlayer.setVolume(uiState.musicVolume);
    MusicPlayer.setMuted(!uiState.musicEnabled);

    // Preload all sounds from config
    const allSoundIds = AudioManager.getPreloadSoundIds();
    await AudioManager.preload(allSoundIds);

    // Start biome ambient if provided
    if (biome) {
      const biomeAmbient = AudioManager.getBiomeAmbient();
      const ambientSound = biomeAmbient[biome];
      if (ambientSound) {
        AudioManager.play(ambientSound);
      }
    }

    this.audioInitialized = true;
  }

  // ============================================================================
  // MUSIC CONTROL
  // ============================================================================

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

  public playVictoryMusic(onComplete?: () => void): void {
    MusicPlayer.playSpecialTrack('victory', onComplete);
  }

  public playDefeatMusic(onComplete?: () => void): void {
    MusicPlayer.playSpecialTrack('defeat', onComplete);
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  public dispose(): void {
    // Unsubscribe from all events
    for (const cleanup of this.cleanupFns) {
      cleanup();
    }
    this.cleanupFns = [];

    this.battleEffectsCallback = null;
  }
}
