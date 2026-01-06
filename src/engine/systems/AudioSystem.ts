import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Transform } from '../components/Transform';
import { AudioManager } from '@/audio/AudioManager';
import * as THREE from 'three';

export class AudioSystem extends System {
  public priority = 100; // Run after other systems
  private camera: THREE.Camera | null = null;
  private initialized = false;

  constructor(game: Game) {
    super(game);
  }

  // Call this after camera is created
  public initialize(camera: THREE.Camera): void {
    if (this.initialized) return;

    this.camera = camera;
    AudioManager.initialize(camera);
    this.setupEventListeners();
    this.initialized = true;

    // Preload common sounds
    AudioManager.preload([
      'ui_click',
      'ui_error',
      'ui_select',
      'ui_research_complete',
      'ui_building_complete',
      'attack_rifle',
      'hit_impact',
      'unit_death',
      'unit_move',
      'unit_attack',
      'unit_ready',
      'building_place',
      'production_start',
    ]);
  }

  private setupEventListeners(): void {
    // Selection events
    this.game.eventBus.on('selection:changed', () => {
      AudioManager.play('ui_select');
    });

    // Command events
    this.game.eventBus.on('command:move', (data: { entityIds: number[] }) => {
      if (data.entityIds.length > 0) {
        AudioManager.play('unit_move');
      }
    });

    this.game.eventBus.on('command:attack', (data: { entityIds: number[] }) => {
      if (data.entityIds.length > 0) {
        AudioManager.play('unit_attack');
      }
    });

    // Combat events
    this.game.eventBus.on('combat:attack', (data: {
      attackerId: number;
      targetId: number;
      damage: number;
    }) => {
      const attacker = this.world.getEntity(data.attackerId);
      if (attacker) {
        const transform = attacker.get<Transform>('Transform');
        if (transform) {
          const pos = new THREE.Vector3(transform.x, 0, transform.y);
          AudioManager.playAt('attack_rifle', pos);
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

    this.game.eventBus.on('unit:destroyed', (data: {
      entityId: number;
      x: number;
      y: number;
    }) => {
      const pos = new THREE.Vector3(data.x, 0, data.y);
      AudioManager.playAt('unit_death', pos);
    });

    // Production events
    this.game.eventBus.on('production:started', () => {
      AudioManager.play('production_start');
    });

    this.game.eventBus.on('production:complete', () => {
      AudioManager.play('unit_ready');
    });

    // Building events
    this.game.eventBus.on('building:place', () => {
      AudioManager.play('building_place');
    });

    this.game.eventBus.on('building:complete', () => {
      AudioManager.play('ui_building_complete');
    });

    // Research events
    this.game.eventBus.on('research:started', () => {
      AudioManager.play('production_start');
    });

    this.game.eventBus.on('research:complete', () => {
      AudioManager.play('ui_research_complete');
    });

    // UI error events
    this.game.eventBus.on('ui:error', () => {
      AudioManager.play('ui_error');
    });

    // UI click (can be called from UI components)
    this.game.eventBus.on('ui:click', () => {
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
    AudioManager.dispose();
  }
}
