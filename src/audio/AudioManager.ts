import * as THREE from 'three';
import { debugAudio } from '@/utils/debugLogger';

export type SoundCategory = 'ui' | 'combat' | 'unit' | 'building' | 'ambient' | 'music' | 'voice' | 'alert';

export interface SoundConfig {
  id: string;
  url: string;
  category: SoundCategory;
  volume?: number;
  loop?: boolean;
  spatial?: boolean;
  maxInstances?: number;
  cooldown?: number; // ms between plays of same sound
}

interface SoundInstance {
  audio: HTMLAudioElement | THREE.Audio | THREE.PositionalAudio;
  startTime: number;
  source?: THREE.PositionalAudio;
}

// Sound definitions
export const SOUNDS: Record<string, SoundConfig> = {
  // UI Sounds
  ui_click: { id: 'ui_click', url: '/audio/ui/click.mp3', category: 'ui', volume: 0.5 },
  ui_error: { id: 'ui_error', url: '/audio/ui/error.mp3', category: 'ui', volume: 0.6 },
  ui_select: { id: 'ui_select', url: '/audio/ui/select.mp3', category: 'ui', volume: 0.4 },
  ui_research_complete: { id: 'ui_research_complete', url: '/audio/ui/research.mp3', category: 'ui', volume: 0.7 },
  ui_building_complete: { id: 'ui_building_complete', url: '/audio/ui/building_complete.mp3', category: 'ui', volume: 0.7 },
  ui_notification: { id: 'ui_notification', url: '/audio/ui/notification.mp3', category: 'ui', volume: 0.6 },

  // Alert Sounds
  alert_under_attack: { id: 'alert_under_attack', url: '/audio/alert/under_attack.mp3', category: 'alert', volume: 0.8, cooldown: 5000 },
  alert_unit_lost: { id: 'alert_unit_lost', url: '/audio/alert/unit_lost.mp3', category: 'alert', volume: 0.7, cooldown: 2000 },
  alert_building_lost: { id: 'alert_building_lost', url: '/audio/alert/building_lost.mp3', category: 'alert', volume: 0.8, cooldown: 3000 },
  alert_minerals_depleted: { id: 'alert_minerals_depleted', url: '/audio/alert/minerals_depleted.mp3', category: 'alert', volume: 0.6 },
  alert_supply_blocked: { id: 'alert_supply_blocked', url: '/audio/alert/supply_blocked.mp3', category: 'alert', volume: 0.7, cooldown: 3000 },

  // Combat Sounds - Weapons
  attack_rifle: { id: 'attack_rifle', url: '/audio/combat/rifle.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 10, cooldown: 50 },
  attack_cannon: { id: 'attack_cannon', url: '/audio/combat/cannon.mp3', category: 'combat', volume: 0.6, spatial: true, maxInstances: 5, cooldown: 100 },
  attack_laser: { id: 'attack_laser', url: '/audio/combat/laser.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 8, cooldown: 80 },
  attack_missile: { id: 'attack_missile', url: '/audio/combat/missile.mp3', category: 'combat', volume: 0.6, spatial: true, maxInstances: 4, cooldown: 200 },
  attack_flamethrower: { id: 'attack_flamethrower', url: '/audio/combat/flamethrower.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 3, cooldown: 100 },

  // Combat Sounds - Impacts
  hit_impact: { id: 'hit_impact', url: '/audio/combat/hit.mp3', category: 'combat', volume: 0.4, spatial: true, maxInstances: 15, cooldown: 30 },
  hit_armor: { id: 'hit_armor', url: '/audio/combat/hit_armor.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 10, cooldown: 50 },
  hit_shield: { id: 'hit_shield', url: '/audio/combat/hit_shield.mp3', category: 'combat', volume: 0.4, spatial: true, maxInstances: 8, cooldown: 40 },

  // Combat Sounds - Explosions
  explosion_small: { id: 'explosion_small', url: '/audio/combat/explosion_small.mp3', category: 'combat', volume: 0.6, spatial: true, maxInstances: 5 },
  explosion_large: { id: 'explosion_large', url: '/audio/combat/explosion_large.mp3', category: 'combat', volume: 0.8, spatial: true, maxInstances: 3 },
  explosion_building: { id: 'explosion_building', url: '/audio/combat/explosion_building.mp3', category: 'combat', volume: 0.9, spatial: true, maxInstances: 2 },

  // Combat Sounds - Deaths
  unit_death: { id: 'unit_death', url: '/audio/combat/death.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 5 },
  unit_death_mech: { id: 'unit_death_mech', url: '/audio/combat/death_mech.mp3', category: 'combat', volume: 0.6, spatial: true, maxInstances: 3 },
  unit_death_bio: { id: 'unit_death_bio', url: '/audio/combat/death_bio.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 5 },

  // Unit Command Sounds (generic)
  unit_move: { id: 'unit_move', url: '/audio/unit/move.mp3', category: 'unit', volume: 0.3, cooldown: 500 },
  unit_attack: { id: 'unit_attack', url: '/audio/unit/attack.mp3', category: 'unit', volume: 0.3, cooldown: 500 },
  unit_ready: { id: 'unit_ready', url: '/audio/unit/ready.mp3', category: 'unit', volume: 0.5 },
  worker_mining: { id: 'worker_mining', url: '/audio/unit/mining.mp3', category: 'unit', volume: 0.3, spatial: true, loop: true },
  worker_building: { id: 'worker_building', url: '/audio/unit/building.mp3', category: 'unit', volume: 0.3, spatial: true, loop: true },

  // Unit Voice Lines - SCV (Worker)
  voice_scv_select_1: { id: 'voice_scv_select_1', url: '/audio/voice/scv/select1.mp3', category: 'voice', volume: 0.6 },
  voice_scv_select_2: { id: 'voice_scv_select_2', url: '/audio/voice/scv/select2.mp3', category: 'voice', volume: 0.6 },
  voice_scv_select_3: { id: 'voice_scv_select_3', url: '/audio/voice/scv/select3.mp3', category: 'voice', volume: 0.6 },
  voice_scv_move_1: { id: 'voice_scv_move_1', url: '/audio/voice/scv/move1.mp3', category: 'voice', volume: 0.6 },
  voice_scv_move_2: { id: 'voice_scv_move_2', url: '/audio/voice/scv/move2.mp3', category: 'voice', volume: 0.6 },
  voice_scv_attack_1: { id: 'voice_scv_attack_1', url: '/audio/voice/scv/attack1.mp3', category: 'voice', volume: 0.6 },

  // Unit Voice Lines - Marine
  voice_marine_select_1: { id: 'voice_marine_select_1', url: '/audio/voice/marine/select1.mp3', category: 'voice', volume: 0.6 },
  voice_marine_select_2: { id: 'voice_marine_select_2', url: '/audio/voice/marine/select2.mp3', category: 'voice', volume: 0.6 },
  voice_marine_select_3: { id: 'voice_marine_select_3', url: '/audio/voice/marine/select3.mp3', category: 'voice', volume: 0.6 },
  voice_marine_move_1: { id: 'voice_marine_move_1', url: '/audio/voice/marine/move1.mp3', category: 'voice', volume: 0.6 },
  voice_marine_move_2: { id: 'voice_marine_move_2', url: '/audio/voice/marine/move2.mp3', category: 'voice', volume: 0.6 },
  voice_marine_attack_1: { id: 'voice_marine_attack_1', url: '/audio/voice/marine/attack1.mp3', category: 'voice', volume: 0.6 },
  voice_marine_attack_2: { id: 'voice_marine_attack_2', url: '/audio/voice/marine/attack2.mp3', category: 'voice', volume: 0.6 },
  voice_marine_ready: { id: 'voice_marine_ready', url: '/audio/voice/marine/ready.mp3', category: 'voice', volume: 0.7 },

  // Unit Voice Lines - Marauder
  voice_marauder_select_1: { id: 'voice_marauder_select_1', url: '/audio/voice/marauder/select1.mp3', category: 'voice', volume: 0.6 },
  voice_marauder_select_2: { id: 'voice_marauder_select_2', url: '/audio/voice/marauder/select2.mp3', category: 'voice', volume: 0.6 },
  voice_marauder_move_1: { id: 'voice_marauder_move_1', url: '/audio/voice/marauder/move1.mp3', category: 'voice', volume: 0.6 },
  voice_marauder_move_2: { id: 'voice_marauder_move_2', url: '/audio/voice/marauder/move2.mp3', category: 'voice', volume: 0.6 },
  voice_marauder_attack_1: { id: 'voice_marauder_attack_1', url: '/audio/voice/marauder/attack1.mp3', category: 'voice', volume: 0.6 },
  voice_marauder_ready: { id: 'voice_marauder_ready', url: '/audio/voice/marauder/ready.mp3', category: 'voice', volume: 0.7 },

  // Unit Voice Lines - Hellion
  voice_hellion_select_1: { id: 'voice_hellion_select_1', url: '/audio/voice/hellion/select1.mp3', category: 'voice', volume: 0.6 },
  voice_hellion_select_2: { id: 'voice_hellion_select_2', url: '/audio/voice/hellion/select2.mp3', category: 'voice', volume: 0.6 },
  voice_hellion_move_1: { id: 'voice_hellion_move_1', url: '/audio/voice/hellion/move1.mp3', category: 'voice', volume: 0.6 },
  voice_hellion_attack_1: { id: 'voice_hellion_attack_1', url: '/audio/voice/hellion/attack1.mp3', category: 'voice', volume: 0.6 },
  voice_hellion_ready: { id: 'voice_hellion_ready', url: '/audio/voice/hellion/ready.mp3', category: 'voice', volume: 0.7 },

  // Unit Voice Lines - Siege Tank
  voice_tank_select_1: { id: 'voice_tank_select_1', url: '/audio/voice/tank/select1.mp3', category: 'voice', volume: 0.6 },
  voice_tank_select_2: { id: 'voice_tank_select_2', url: '/audio/voice/tank/select2.mp3', category: 'voice', volume: 0.6 },
  voice_tank_move_1: { id: 'voice_tank_move_1', url: '/audio/voice/tank/move1.mp3', category: 'voice', volume: 0.6 },
  voice_tank_attack_1: { id: 'voice_tank_attack_1', url: '/audio/voice/tank/attack1.mp3', category: 'voice', volume: 0.6 },
  voice_tank_ready: { id: 'voice_tank_ready', url: '/audio/voice/tank/ready.mp3', category: 'voice', volume: 0.7 },

  // Unit Voice Lines - Medic
  voice_medic_select_1: { id: 'voice_medic_select_1', url: '/audio/voice/medic/select1.mp3', category: 'voice', volume: 0.6 },
  voice_medic_select_2: { id: 'voice_medic_select_2', url: '/audio/voice/medic/select2.mp3', category: 'voice', volume: 0.6 },
  voice_medic_move_1: { id: 'voice_medic_move_1', url: '/audio/voice/medic/move1.mp3', category: 'voice', volume: 0.6 },
  voice_medic_ready: { id: 'voice_medic_ready', url: '/audio/voice/medic/ready.mp3', category: 'voice', volume: 0.7 },

  // Building Sounds
  building_place: { id: 'building_place', url: '/audio/building/place.mp3', category: 'building', volume: 0.5 },
  building_construct: { id: 'building_construct', url: '/audio/building/construct.mp3', category: 'building', volume: 0.4, spatial: true, loop: true },
  production_start: { id: 'production_start', url: '/audio/building/production.mp3', category: 'building', volume: 0.4 },
  building_powerup: { id: 'building_powerup', url: '/audio/building/powerup.mp3', category: 'building', volume: 0.5 },
  building_powerdown: { id: 'building_powerdown', url: '/audio/building/powerdown.mp3', category: 'building', volume: 0.5 },

  // Ambient Sounds - Biome specific
  ambient_wind: { id: 'ambient_wind', url: '/audio/ambient/wind.mp3', category: 'ambient', volume: 0.2, loop: true },
  ambient_nature: { id: 'ambient_nature', url: '/audio/ambient/nature.mp3', category: 'ambient', volume: 0.15, loop: true },
  ambient_desert: { id: 'ambient_desert', url: '/audio/ambient/desert.mp3', category: 'ambient', volume: 0.15, loop: true },
  ambient_frozen: { id: 'ambient_frozen', url: '/audio/ambient/frozen.mp3', category: 'ambient', volume: 0.2, loop: true },
  ambient_volcanic: { id: 'ambient_volcanic', url: '/audio/ambient/volcanic.mp3', category: 'ambient', volume: 0.2, loop: true },
  ambient_void: { id: 'ambient_void', url: '/audio/ambient/void.mp3', category: 'ambient', volume: 0.15, loop: true },
  ambient_jungle: { id: 'ambient_jungle', url: '/audio/ambient/jungle.mp3', category: 'ambient', volume: 0.2, loop: true },
  ambient_battle: { id: 'ambient_battle', url: '/audio/ambient/battle.mp3', category: 'ambient', volume: 0.1, loop: true },

  // Music
  music_menu: { id: 'music_menu', url: '/audio/music/menu.mp3', category: 'music', volume: 0.3, loop: true },
  music_battle: { id: 'music_battle', url: '/audio/music/battle.mp3', category: 'music', volume: 0.25, loop: true },
  music_peace: { id: 'music_peace', url: '/audio/music/peace.mp3', category: 'music', volume: 0.2, loop: true },
  music_victory: { id: 'music_victory', url: '/audio/music/victory.mp3', category: 'music', volume: 0.4 },
  music_defeat: { id: 'music_defeat', url: '/audio/music/defeat.mp3', category: 'music', volume: 0.4 },
};

// Unit voice mapping - maps unit IDs to their voice sound IDs
export const UNIT_VOICES: Record<string, {
  select: string[];
  move: string[];
  attack: string[];
  ready?: string;
}> = {
  scv: {
    select: ['voice_scv_select_1', 'voice_scv_select_2', 'voice_scv_select_3'],
    move: ['voice_scv_move_1', 'voice_scv_move_2'],
    attack: ['voice_scv_attack_1'],
  },
  marine: {
    select: ['voice_marine_select_1', 'voice_marine_select_2', 'voice_marine_select_3'],
    move: ['voice_marine_move_1', 'voice_marine_move_2'],
    attack: ['voice_marine_attack_1', 'voice_marine_attack_2'],
    ready: 'voice_marine_ready',
  },
  marauder: {
    select: ['voice_marauder_select_1', 'voice_marauder_select_2'],
    move: ['voice_marauder_move_1', 'voice_marauder_move_2'],
    attack: ['voice_marauder_attack_1'],
    ready: 'voice_marauder_ready',
  },
  hellion: {
    select: ['voice_hellion_select_1', 'voice_hellion_select_2'],
    move: ['voice_hellion_move_1'],
    attack: ['voice_hellion_attack_1'],
    ready: 'voice_hellion_ready',
  },
  siege_tank: {
    select: ['voice_tank_select_1', 'voice_tank_select_2'],
    move: ['voice_tank_move_1'],
    attack: ['voice_tank_attack_1'],
    ready: 'voice_tank_ready',
  },
  medic: {
    select: ['voice_medic_select_1', 'voice_medic_select_2'],
    move: ['voice_medic_move_1'],
    attack: [],
    ready: 'voice_medic_ready',
  },
};

// Biome to ambient sound mapping
export const BIOME_AMBIENT: Record<string, string> = {
  grassland: 'ambient_nature',
  desert: 'ambient_desert',
  frozen: 'ambient_frozen',
  volcanic: 'ambient_volcanic',
  void: 'ambient_void',
  jungle: 'ambient_jungle',
};

class AudioManagerClass {
  private audioContext: AudioContext | null = null;
  private listener: THREE.AudioListener | null = null;
  private loadedBuffers: Map<string, AudioBuffer> = new Map();
  private activeInstances: Map<string, SoundInstance[]> = new Map();
  private lastPlayTimes: Map<string, number> = new Map();

  // Volume controls per category
  private categoryVolumes: Record<SoundCategory, number> = {
    ui: 1,
    combat: 1,
    unit: 1,
    building: 1,
    ambient: 1,
    music: 0.5,
    voice: 1,
    alert: 1,
  };

  private masterVolume = 1;
  private muted = false;

  // Initialize with optional Three.js camera (for positional audio)
  // If no camera provided, uses 2D audio only
  public initialize(camera?: THREE.Camera): void {
    if (camera) {
      this.listener = new THREE.AudioListener();
      camera.add(this.listener);
      this.audioContext = this.listener.context;
    } else {
      // Create audio context without THREE.js for 2D audio only
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }

    // Resume audio context on user interaction
    if (this.audioContext && this.audioContext.state === 'suspended') {
      const resumeAudio = () => {
        this.audioContext?.resume();
        document.removeEventListener('click', resumeAudio);
        document.removeEventListener('keydown', resumeAudio);
      };
      document.addEventListener('click', resumeAudio);
      document.addEventListener('keydown', resumeAudio);
    }
  }

  // Preload sounds
  public async preload(soundIds: string[]): Promise<void> {
    const audioLoader = new THREE.AudioLoader();

    const loadPromises = soundIds.map(async (soundId) => {
      const config = SOUNDS[soundId];
      if (!config) {
        debugAudio.warn(`Unknown sound: ${soundId}`);
        return;
      }

      try {
        const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
          audioLoader.load(config.url, resolve, undefined, reject);
        });
        this.loadedBuffers.set(soundId, buffer);
      } catch (error) {
        // Sound file not found - create silent placeholder
        debugAudio.warn(`Failed to load sound: ${config.url}`);
      }
    });

    await Promise.all(loadPromises);
  }

  // Play a 2D (non-spatial) sound
  public play(soundId: string, volumeMultiplier = 1): void {
    if (this.muted) return;

    const config = SOUNDS[soundId];
    if (!config) return;

    // Check cooldown
    if (config.cooldown) {
      const lastPlay = this.lastPlayTimes.get(soundId) || 0;
      if (Date.now() - lastPlay < config.cooldown) return;
      this.lastPlayTimes.set(soundId, Date.now());
    }

    // Check max instances
    const instances = this.activeInstances.get(soundId) || [];
    if (config.maxInstances && instances.length >= config.maxInstances) {
      // Remove oldest instance
      const oldest = instances.shift();
      if (oldest?.audio instanceof HTMLAudioElement) {
        oldest.audio.pause();
      }
    }

    const buffer = this.loadedBuffers.get(soundId);

    // Use Three.js Audio for loaded buffers
    if (buffer && this.listener) {
      const sound = new THREE.Audio(this.listener);
      sound.setBuffer(buffer);
      sound.setVolume(this.getEffectiveVolume(config) * volumeMultiplier);
      sound.setLoop(config.loop || false);
      sound.play();

      const instance: SoundInstance = {
        audio: sound,
        startTime: Date.now(),
      };

      instances.push(instance);
      this.activeInstances.set(soundId, instances);

      // Remove instance when done (for non-looping sounds)
      if (!config.loop) {
        sound.onEnded = () => {
          const idx = instances.indexOf(instance);
          if (idx !== -1) instances.splice(idx, 1);
        };
      }
    } else {
      // Fallback to HTMLAudioElement if buffer not loaded
      this.playFallback(soundId, config, volumeMultiplier);
    }
  }

  // Play a 3D spatial sound at a position
  public playAt(soundId: string, position: THREE.Vector3, volumeMultiplier = 1): void {
    if (this.muted || !this.listener) return;

    const config = SOUNDS[soundId];
    if (!config || !config.spatial) {
      // Play as 2D if not spatial
      this.play(soundId, volumeMultiplier);
      return;
    }

    // Check cooldown
    if (config.cooldown) {
      const lastPlay = this.lastPlayTimes.get(soundId) || 0;
      if (Date.now() - lastPlay < config.cooldown) return;
      this.lastPlayTimes.set(soundId, Date.now());
    }

    const buffer = this.loadedBuffers.get(soundId);
    if (!buffer) {
      // No buffer - play as 2D fallback
      this.play(soundId, volumeMultiplier);
      return;
    }

    // Check max instances
    const instances = this.activeInstances.get(soundId) || [];
    if (config.maxInstances && instances.length >= config.maxInstances) {
      const oldest = instances.shift();
      if (oldest?.source) {
        oldest.source.stop();
      }
    }

    const sound = new THREE.PositionalAudio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(this.getEffectiveVolume(config) * volumeMultiplier);
    sound.setRefDistance(20);
    sound.setMaxDistance(100);
    sound.setDistanceModel('exponential');
    sound.setRolloffFactor(1);
    sound.setLoop(config.loop || false);
    sound.position.copy(position);
    sound.play();

    const instance: SoundInstance = {
      audio: sound,
      startTime: Date.now(),
      source: sound,
    };

    instances.push(instance);
    this.activeInstances.set(soundId, instances);

    if (!config.loop) {
      sound.onEnded = () => {
        const idx = instances.indexOf(instance);
        if (idx !== -1) instances.splice(idx, 1);
      };
    }
  }

  // Stop a specific sound
  public stop(soundId: string): void {
    const instances = this.activeInstances.get(soundId) || [];
    for (const instance of instances) {
      if (instance.audio instanceof THREE.Audio) {
        instance.audio.stop();
      } else if (instance.audio instanceof HTMLAudioElement) {
        instance.audio.pause();
        instance.audio.currentTime = 0;
      }
    }
    this.activeInstances.delete(soundId);
  }

  // Stop all sounds in a category
  public stopCategory(category: SoundCategory): void {
    for (const [soundId, config] of Object.entries(SOUNDS)) {
      if (config.category === category) {
        this.stop(soundId);
      }
    }
  }

  // Stop all sounds
  public stopAll(): void {
    for (const soundId of this.activeInstances.keys()) {
      this.stop(soundId);
    }
  }

  // Volume controls
  public setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.updateAllVolumes();
  }

  public setCategoryVolume(category: SoundCategory, volume: number): void {
    this.categoryVolumes[category] = Math.max(0, Math.min(1, volume));
    this.updateAllVolumes();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.stopAll();
    }
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public getCategoryVolume(category: SoundCategory): number {
    return this.categoryVolumes[category];
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private getEffectiveVolume(config: SoundConfig): number {
    return (config.volume || 1) * this.categoryVolumes[config.category] * this.masterVolume;
  }

  private updateAllVolumes(): void {
    for (const [soundId, instances] of this.activeInstances) {
      const config = SOUNDS[soundId];
      if (!config) continue;

      const volume = this.getEffectiveVolume(config);
      for (const instance of instances) {
        if (instance.audio instanceof THREE.Audio) {
          instance.audio.setVolume(volume);
        } else if (instance.audio instanceof HTMLAudioElement) {
          instance.audio.volume = volume;
        }
      }
    }
  }

  private playFallback(soundId: string, config: SoundConfig, volumeMultiplier: number): void {
    // Create a placeholder sound effect using Web Audio API
    if (!this.audioContext) return;

    const instances = this.activeInstances.get(soundId) || [];

    // Create a simple beep as placeholder
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    // Different sounds for different categories
    const frequency = config.category === 'combat' ? 200 : config.category === 'ui' ? 800 : 400;
    oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    oscillator.type = 'sine';

    const volume = this.getEffectiveVolume(config) * volumeMultiplier * 0.1;
    gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

    oscillator.start();
    oscillator.stop(this.audioContext.currentTime + 0.1);
  }

  // Cleanup
  public dispose(): void {
    this.stopAll();
    this.loadedBuffers.clear();
    this.activeInstances.clear();
    if (this.listener) {
      this.listener.parent?.remove(this.listener);
      this.listener = null;
    }
  }
}

// Export singleton
export const AudioManager = new AudioManagerClass();
