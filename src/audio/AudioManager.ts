import * as THREE from 'three';

export type SoundCategory = 'ui' | 'combat' | 'unit' | 'building' | 'ambient' | 'music';

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

  // Combat Sounds
  attack_rifle: { id: 'attack_rifle', url: '/audio/combat/rifle.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 10, cooldown: 50 },
  attack_cannon: { id: 'attack_cannon', url: '/audio/combat/cannon.mp3', category: 'combat', volume: 0.6, spatial: true, maxInstances: 5, cooldown: 100 },
  attack_laser: { id: 'attack_laser', url: '/audio/combat/laser.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 8, cooldown: 80 },
  explosion_small: { id: 'explosion_small', url: '/audio/combat/explosion_small.mp3', category: 'combat', volume: 0.6, spatial: true, maxInstances: 5 },
  explosion_large: { id: 'explosion_large', url: '/audio/combat/explosion_large.mp3', category: 'combat', volume: 0.8, spatial: true, maxInstances: 3 },
  hit_impact: { id: 'hit_impact', url: '/audio/combat/hit.mp3', category: 'combat', volume: 0.4, spatial: true, maxInstances: 15, cooldown: 30 },
  unit_death: { id: 'unit_death', url: '/audio/combat/death.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 5 },

  // Unit Sounds
  unit_move: { id: 'unit_move', url: '/audio/unit/move.mp3', category: 'unit', volume: 0.3, cooldown: 500 },
  unit_attack: { id: 'unit_attack', url: '/audio/unit/attack.mp3', category: 'unit', volume: 0.3, cooldown: 500 },
  unit_ready: { id: 'unit_ready', url: '/audio/unit/ready.mp3', category: 'unit', volume: 0.5 },
  worker_mining: { id: 'worker_mining', url: '/audio/unit/mining.mp3', category: 'unit', volume: 0.3, spatial: true, loop: true },
  worker_building: { id: 'worker_building', url: '/audio/unit/building.mp3', category: 'unit', volume: 0.3, spatial: true, loop: true },

  // Building Sounds
  building_place: { id: 'building_place', url: '/audio/building/place.mp3', category: 'building', volume: 0.5 },
  building_construct: { id: 'building_construct', url: '/audio/building/construct.mp3', category: 'building', volume: 0.4, spatial: true, loop: true },
  production_start: { id: 'production_start', url: '/audio/building/production.mp3', category: 'building', volume: 0.4 },

  // Ambient Sounds
  ambient_wind: { id: 'ambient_wind', url: '/audio/ambient/wind.mp3', category: 'ambient', volume: 0.2, loop: true },
  ambient_nature: { id: 'ambient_nature', url: '/audio/ambient/nature.mp3', category: 'ambient', volume: 0.15, loop: true },

  // Music
  music_menu: { id: 'music_menu', url: '/audio/music/menu.mp3', category: 'music', volume: 0.3, loop: true },
  music_battle: { id: 'music_battle', url: '/audio/music/battle.mp3', category: 'music', volume: 0.25, loop: true },
  music_peace: { id: 'music_peace', url: '/audio/music/peace.mp3', category: 'music', volume: 0.2, loop: true },
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
  };

  private masterVolume = 1;
  private muted = false;

  // Initialize with Three.js scene
  public initialize(camera: THREE.Camera): void {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.audioContext = this.listener.context;

    // Resume audio context on user interaction
    if (this.audioContext.state === 'suspended') {
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
        console.warn(`Unknown sound: ${soundId}`);
        return;
      }

      try {
        const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
          audioLoader.load(config.url, resolve, undefined, reject);
        });
        this.loadedBuffers.set(soundId, buffer);
      } catch (error) {
        // Sound file not found - create silent placeholder
        console.warn(`Failed to load sound: ${config.url}`);
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
