import * as THREE from 'three';
import { debugAudio } from '@/utils/debugLogger';
import { audioConfig, SoundPriorityName } from './audioConfig';

export type SoundCategory = 'ui' | 'combat' | 'unit' | 'building' | 'ambient' | 'music' | 'voice' | 'alert';

/**
 * Priority levels for voice stealing (higher = more important)
 * Values loaded from sounds.config.json
 */
export enum SoundPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

export interface SoundConfig {
  id: string;
  url: string;
  category: SoundCategory;
  volume?: number;
  loop?: boolean;
  spatial?: boolean;
  maxInstances?: number;
  cooldown?: number;
  priority?: SoundPriority;
  maxDistance?: number;
  clusterRadius?: number;
}

interface PooledAudioSource {
  audio: THREE.PositionalAudio;
  inUse: boolean;
  soundId: string | null;
  priority: SoundPriority;
  startTime: number;
  position: THREE.Vector3;
  fadeOutStart: number | null;
}

interface SoundInstance {
  audio: THREE.Audio | HTMLAudioElement;
  startTime: number;
  priority: SoundPriority;
}

// Configuration constants
const POOL_SIZE = 96;
const MAX_CONCURRENT_SOUNDS = 64;
const FADE_OUT_DURATION = 100;
const CLUSTER_TIME_WINDOW = 50;

/**
 * AudioManager - Fully data-driven sound effects system
 *
 * All sound definitions are loaded from public/audio/sounds.config.json.
 * Voice lines are loaded from public/audio/voices.config.json.
 *
 * To add new sounds:
 * 1. Drop audio files in the appropriate folder
 * 2. Add entries to sounds.config.json
 * 3. No code changes required
 */
class AudioManagerClass {
  private audioContext: AudioContext | null = null;
  private listener: THREE.AudioListener | null = null;
  private listenerPosition: THREE.Vector3 = new THREE.Vector3();
  private loadedBuffers: Map<string, AudioBuffer> = new Map();

  // Audio source pool for spatial sounds
  private audioPool: PooledAudioSource[] = [];
  private poolInitialized = false;

  // Active 2D sound instances
  private activeInstances: Map<string, SoundInstance[]> = new Map();

  // Cooldown and clustering tracking
  private lastPlayTimes: Map<string, number> = new Map();
  private spatialClusters: Map<string, { position: THREE.Vector3; time: number }[]> = new Map();

  // Current sound count for global budget
  private activeSoundCount = 0;

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

  // Cached sound configs loaded from JSON
  private soundConfigs: Map<string, SoundConfig> = new Map();
  private configLoaded = false;

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Load sound configurations from JSON files
   */
  public async loadConfig(): Promise<void> {
    if (this.configLoaded) return;

    await audioConfig.load();

    // Build sound configs from the loaded JSON
    const soundsConfig = audioConfig.getSounds();
    this.soundConfigs.clear();

    for (const [category, categorySounds] of Object.entries(soundsConfig.sounds)) {
      for (const [soundId, soundDef] of Object.entries(categorySounds)) {
        const priorityValue = soundDef.priority
          ? audioConfig.getPriorityValue(soundDef.priority)
          : audioConfig.getPriorityValue(soundsConfig.defaults.priority);

        this.soundConfigs.set(soundId, {
          id: soundId,
          url: soundDef.url,
          category: category as SoundCategory,
          volume: soundDef.volume ?? soundsConfig.defaults.volume,
          loop: soundDef.loop ?? soundsConfig.defaults.loop,
          spatial: soundDef.spatial ?? soundsConfig.defaults.spatial,
          maxInstances: soundDef.maxInstances ?? soundsConfig.defaults.maxInstances,
          cooldown: soundDef.cooldown ?? soundsConfig.defaults.cooldown,
          priority: priorityValue,
          maxDistance: soundDef.maxDistance ?? soundsConfig.defaults.maxDistance,
          clusterRadius: soundDef.clusterRadius ?? soundsConfig.defaults.clusterRadius,
        });
      }
    }

    // Also load voice sounds from voices.config.json
    const voicesConfig = audioConfig.getVoices();
    const voicePriority = audioConfig.getPriorityValue(voicesConfig.defaults.priority);
    const voiceVolume = voicesConfig.defaults.volume;

    for (const [groupId, group] of Object.entries(voicesConfig.voiceGroups)) {
      // Add select voices
      group.select.forEach((file, index) => {
        const id = `voice_${groupId}_select_${index + 1}`;
        this.soundConfigs.set(id, {
          id,
          url: `${group.basePath}/${file}`,
          category: 'voice',
          volume: voiceVolume,
          priority: voicePriority,
        });
      });

      // Add move voices
      group.move.forEach((file, index) => {
        const id = `voice_${groupId}_move_${index + 1}`;
        this.soundConfigs.set(id, {
          id,
          url: `${group.basePath}/${file}`,
          category: 'voice',
          volume: voiceVolume,
          priority: voicePriority,
        });
      });

      // Add attack voices
      group.attack.forEach((file, index) => {
        const id = `voice_${groupId}_attack_${index + 1}`;
        this.soundConfigs.set(id, {
          id,
          url: `${group.basePath}/${file}`,
          category: 'voice',
          volume: voiceVolume,
          priority: voicePriority,
        });
      });

      // Add ready voice
      if (group.ready) {
        const id = `voice_${groupId}_ready`;
        this.soundConfigs.set(id, {
          id,
          url: `${group.basePath}/${group.ready}`,
          category: 'voice',
          volume: voiceVolume + 0.1, // Ready voices slightly louder
          priority: voicePriority,
        });
      }
    }

    this.configLoaded = true;
    debugAudio.log(`AudioManager loaded ${this.soundConfigs.size} sound configs`);
  }

  /**
   * Get a sound config by ID
   */
  public getSoundConfig(soundId: string): SoundConfig | undefined {
    return this.soundConfigs.get(soundId);
  }

  /**
   * Get voice line IDs for a unit
   */
  public getVoiceLines(voiceGroupId: string): {
    select: string[];
    move: string[];
    attack: string[];
    ready?: string;
  } {
    const select: string[] = [];
    const move: string[] = [];
    const attack: string[] = [];
    let ready: string | undefined;

    // Find all voice lines for this group
    for (const [id] of this.soundConfigs) {
      if (id.startsWith(`voice_${voiceGroupId}_select_`)) {
        select.push(id);
      } else if (id.startsWith(`voice_${voiceGroupId}_move_`)) {
        move.push(id);
      } else if (id.startsWith(`voice_${voiceGroupId}_attack_`)) {
        attack.push(id);
      } else if (id === `voice_${voiceGroupId}_ready`) {
        ready = id;
      }
    }

    return { select, move, attack, ready };
  }

  /**
   * Get biome ambient sound mapping from config
   */
  public getBiomeAmbient(): Record<string, string> {
    if (!this.configLoaded) return {};
    return audioConfig.getBiomeAmbient();
  }

  public async initialize(camera?: THREE.Camera): Promise<void> {
    // Load config first
    await this.loadConfig();

    if (camera) {
      this.listener = new THREE.AudioListener();
      camera.add(this.listener);
      this.audioContext = this.listener.context;
      this.initializePool();
    } else {
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

    debugAudio.log(`AudioManager initialized with pool size: ${POOL_SIZE}, max concurrent: ${MAX_CONCURRENT_SOUNDS}`);
  }

  /**
   * Initialize the audio source pool for spatial sounds
   */
  private initializePool(): void {
    if (!this.listener || this.poolInitialized) return;

    for (let i = 0; i < POOL_SIZE; i++) {
      const audio = new THREE.PositionalAudio(this.listener);
      audio.setRefDistance(20);
      audio.setMaxDistance(200);
      audio.setDistanceModel('exponential');
      audio.setRolloffFactor(1.5);

      this.audioPool.push({
        audio,
        inUse: false,
        soundId: null,
        priority: SoundPriority.LOW,
        startTime: 0,
        position: new THREE.Vector3(),
        fadeOutStart: null,
      });
    }

    this.poolInitialized = true;
    debugAudio.log(`Audio pool initialized with ${POOL_SIZE} sources`);
  }

  /**
   * Update listener position for distance culling (call each frame)
   */
  public updateListenerPosition(position: THREE.Vector3): void {
    this.listenerPosition.copy(position);
  }

  // ============================================================================
  // PRELOADING
  // ============================================================================

  public async preload(soundIds: string[]): Promise<void> {
    const audioLoader = new THREE.AudioLoader();

    const loadPromises = soundIds.map(async (soundId) => {
      const config = this.soundConfigs.get(soundId);
      if (!config) {
        debugAudio.warn(`Unknown sound: ${soundId}`);
        return;
      }

      try {
        const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
          audioLoader.load(config.url, resolve, undefined, reject);
        });
        this.loadedBuffers.set(soundId, buffer);
      } catch {
        debugAudio.warn(`Failed to load sound: ${config.url}`);
      }
    });

    await Promise.all(loadPromises);
    debugAudio.log(`Preloaded ${this.loadedBuffers.size} sounds`);
  }

  /**
   * Get all sound IDs that should be preloaded
   */
  public getPreloadSoundIds(): string[] {
    return Array.from(this.soundConfigs.keys());
  }

  // ============================================================================
  // 2D SOUND PLAYBACK
  // ============================================================================

  public play(soundId: string, volumeMultiplier = 1): void {
    if (this.muted) return;

    const config = this.soundConfigs.get(soundId);
    if (!config) {
      debugAudio.warn(`Unknown sound: ${soundId}`);
      return;
    }

    // Check cooldown
    if (!this.checkCooldown(soundId, config)) return;

    // Check global budget (except for critical sounds)
    if (config.priority !== SoundPriority.CRITICAL && this.activeSoundCount >= MAX_CONCURRENT_SOUNDS) {
      if (!this.stealLowestPrioritySound(config.priority ?? SoundPriority.NORMAL)) {
        return;
      }
    }

    // Check max instances for this sound
    const instances = this.activeInstances.get(soundId) || [];
    if (config.maxInstances && instances.length >= config.maxInstances) {
      this.stopOldestInstance(soundId, instances);
    }

    const buffer = this.loadedBuffers.get(soundId);

    if (buffer && this.listener) {
      const sound = new THREE.Audio(this.listener);
      sound.setBuffer(buffer);
      sound.setVolume(this.getEffectiveVolume(config) * volumeMultiplier);
      sound.setLoop(config.loop || false);
      sound.play();

      const instance: SoundInstance = {
        audio: sound,
        startTime: Date.now(),
        priority: config.priority ?? SoundPriority.NORMAL,
      };

      instances.push(instance);
      this.activeInstances.set(soundId, instances);
      this.activeSoundCount++;

      if (!config.loop) {
        sound.onEnded = () => {
          const idx = instances.indexOf(instance);
          if (idx !== -1) {
            instances.splice(idx, 1);
            this.activeSoundCount--;
          }
        };
      }
    } else {
      // No buffer loaded - play directly from URL
      this.playFromUrl(soundId, config, volumeMultiplier);
    }
  }

  /**
   * Play sound directly from URL (when not preloaded)
   */
  private playFromUrl(soundId: string, config: SoundConfig, volumeMultiplier: number): void {
    const audio = new Audio(config.url);
    audio.volume = this.getEffectiveVolume(config) * volumeMultiplier;
    audio.loop = config.loop || false;

    const instance: SoundInstance = {
      audio,
      startTime: Date.now(),
      priority: config.priority ?? SoundPriority.NORMAL,
    };

    const instances = this.activeInstances.get(soundId) || [];
    instances.push(instance);
    this.activeInstances.set(soundId, instances);
    this.activeSoundCount++;

    audio.play().catch(() => {
      // Silent fail for sounds that can't play
      const idx = instances.indexOf(instance);
      if (idx !== -1) {
        instances.splice(idx, 1);
        this.activeSoundCount--;
      }
    });

    if (!config.loop) {
      audio.addEventListener('ended', () => {
        const idx = instances.indexOf(instance);
        if (idx !== -1) {
          instances.splice(idx, 1);
          this.activeSoundCount--;
        }
      });
    }
  }

  // ============================================================================
  // 3D SPATIAL SOUND PLAYBACK
  // ============================================================================

  public playAt(soundId: string, position: THREE.Vector3, volumeMultiplier = 1): void {
    if (this.muted || !this.listener) return;

    const config = this.soundConfigs.get(soundId);
    if (!config) {
      debugAudio.warn(`Unknown sound: ${soundId}`);
      return;
    }

    if (!config.spatial) {
      this.play(soundId, volumeMultiplier);
      return;
    }

    // Distance culling
    const distance = position.distanceTo(this.listenerPosition);
    const maxDistance = config.maxDistance ?? 200;
    if (distance > maxDistance) {
      return;
    }

    // Check cooldown
    if (!this.checkCooldown(soundId, config)) return;

    // Spatial clustering
    if (config.clusterRadius && this.isClusteredSound(soundId, position, config.clusterRadius)) {
      return;
    }

    // Check global budget
    if (config.priority !== SoundPriority.CRITICAL && this.activeSoundCount >= MAX_CONCURRENT_SOUNDS) {
      if (!this.stealLowestPrioritySound(config.priority ?? SoundPriority.NORMAL)) {
        return;
      }
    }

    const buffer = this.loadedBuffers.get(soundId);
    if (!buffer) {
      this.play(soundId, volumeMultiplier);
      return;
    }

    const pooledSource = this.acquirePooledSource(soundId, config.priority ?? SoundPriority.NORMAL, position);
    if (!pooledSource) {
      return;
    }

    const sound = pooledSource.audio;
    sound.setBuffer(buffer);

    const distanceFactor = 1 - Math.min(distance / maxDistance, 1);
    const attenuatedVolume = this.getEffectiveVolume(config) * volumeMultiplier * (0.3 + 0.7 * distanceFactor);
    sound.setVolume(attenuatedVolume);

    sound.setLoop(config.loop || false);
    sound.position.copy(position);
    sound.play();

    this.activeSoundCount++;

    if (config.clusterRadius) {
      this.recordClusterPosition(soundId, position);
    }

    if (!config.loop) {
      sound.onEnded = () => {
        this.releasePooledSource(pooledSource);
        this.activeSoundCount--;
      };
    }
  }

  // ============================================================================
  // POOL MANAGEMENT
  // ============================================================================

  private acquirePooledSource(soundId: string, priority: SoundPriority, position: THREE.Vector3): PooledAudioSource | null {
    for (const source of this.audioPool) {
      if (!source.inUse) {
        source.inUse = true;
        source.soundId = soundId;
        source.priority = priority;
        source.startTime = Date.now();
        source.position.copy(position);
        source.fadeOutStart = null;
        return source;
      }
    }

    let lowestPrioritySource: PooledAudioSource | null = null;
    let lowestPriority = priority;
    let oldestTime = Date.now();

    for (const source of this.audioPool) {
      if (source.fadeOutStart !== null) continue;

      if (source.priority < lowestPriority ||
          (source.priority === lowestPriority && source.startTime < oldestTime)) {
        lowestPriority = source.priority;
        oldestTime = source.startTime;
        lowestPrioritySource = source;
      }
    }

    if (lowestPrioritySource && lowestPriority < priority) {
      this.fadeOutAndSteal(lowestPrioritySource, soundId, priority, position);
      return lowestPrioritySource;
    }

    return null;
  }

  private fadeOutAndSteal(source: PooledAudioSource, newSoundId: string, newPriority: SoundPriority, newPosition: THREE.Vector3): void {
    source.fadeOutStart = Date.now();
    const originalVolume = source.audio.getVolume();

    const fadeInterval = setInterval(() => {
      const elapsed = Date.now() - (source.fadeOutStart ?? 0);
      const progress = Math.min(elapsed / FADE_OUT_DURATION, 1);

      source.audio.setVolume(originalVolume * (1 - progress));

      if (progress >= 1) {
        clearInterval(fadeInterval);
        source.audio.stop();
        source.audio.setVolume(originalVolume);

        source.soundId = newSoundId;
        source.priority = newPriority;
        source.position.copy(newPosition);
        source.startTime = Date.now();
        source.fadeOutStart = null;
      }
    }, 16);
  }

  private releasePooledSource(source: PooledAudioSource): void {
    source.inUse = false;
    source.soundId = null;
    source.priority = SoundPriority.LOW;
    source.fadeOutStart = null;
    if (source.audio.isPlaying) {
      source.audio.stop();
    }
  }

  // ============================================================================
  // SPATIAL CLUSTERING
  // ============================================================================

  private isClusteredSound(soundId: string, position: THREE.Vector3, radius: number): boolean {
    const clusters = this.spatialClusters.get(soundId);
    if (!clusters) return false;

    const now = Date.now();
    const validClusters = clusters.filter(c => now - c.time < CLUSTER_TIME_WINDOW);
    this.spatialClusters.set(soundId, validClusters);

    for (const cluster of validClusters) {
      if (position.distanceTo(cluster.position) < radius) {
        return true;
      }
    }

    return false;
  }

  private recordClusterPosition(soundId: string, position: THREE.Vector3): void {
    let clusters = this.spatialClusters.get(soundId);
    if (!clusters) {
      clusters = [];
      this.spatialClusters.set(soundId, clusters);
    }

    clusters.push({
      position: position.clone(),
      time: Date.now(),
    });

    if (clusters.length > 50) {
      clusters.shift();
    }
  }

  // ============================================================================
  // VOICE STEALING & BUDGET MANAGEMENT
  // ============================================================================

  private stealLowestPrioritySound(requiredPriority: SoundPriority): boolean {
    for (const [soundId, instances] of this.activeInstances) {
      const config = this.soundConfigs.get(soundId);
      if (!config) continue;

      const instancePriority = config.priority ?? SoundPriority.NORMAL;
      if (instancePriority < requiredPriority && instances.length > 0) {
        this.stopOldestInstance(soundId, instances);
        return true;
      }
    }

    for (const source of this.audioPool) {
      if (source.inUse && source.priority < requiredPriority && source.fadeOutStart === null) {
        this.releasePooledSource(source);
        this.activeSoundCount--;
        return true;
      }
    }

    return false;
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  private checkCooldown(soundId: string, config: SoundConfig): boolean {
    if (!config.cooldown) return true;

    const lastPlay = this.lastPlayTimes.get(soundId) || 0;
    if (Date.now() - lastPlay < config.cooldown) return false;

    this.lastPlayTimes.set(soundId, Date.now());
    return true;
  }

  private stopOldestInstance(soundId: string, instances: SoundInstance[]): void {
    const oldest = instances.shift();
    if (oldest) {
      if (oldest.audio instanceof THREE.Audio) {
        oldest.audio.stop();
      } else if (oldest.audio instanceof HTMLAudioElement) {
        oldest.audio.pause();
        oldest.audio.currentTime = 0;
      }
      this.activeSoundCount--;
    }
  }

  public stop(soundId: string): void {
    const instances = this.activeInstances.get(soundId) || [];
    for (const instance of instances) {
      if (instance.audio instanceof THREE.Audio) {
        instance.audio.stop();
      } else if (instance.audio instanceof HTMLAudioElement) {
        instance.audio.pause();
        instance.audio.currentTime = 0;
      }
      this.activeSoundCount--;
    }
    this.activeInstances.delete(soundId);

    for (const source of this.audioPool) {
      if (source.inUse && source.soundId === soundId) {
        this.releasePooledSource(source);
        this.activeSoundCount--;
      }
    }
  }

  public stopCategory(category: SoundCategory): void {
    for (const [soundId, config] of this.soundConfigs) {
      if (config.category === category) {
        this.stop(soundId);
      }
    }
  }

  public stopAll(): void {
    for (const soundId of this.activeInstances.keys()) {
      this.stop(soundId);
    }
    for (const source of this.audioPool) {
      if (source.inUse) {
        this.releasePooledSource(source);
      }
    }
    this.activeSoundCount = 0;
  }

  // ============================================================================
  // VOLUME CONTROLS
  // ============================================================================

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
      const config = this.soundConfigs.get(soundId);
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

  // ============================================================================
  // STATISTICS
  // ============================================================================

  public getStats(): { activeSounds: number; poolUsed: number; poolTotal: number } {
    let poolUsed = 0;
    for (const source of this.audioPool) {
      if (source.inUse) poolUsed++;
    }

    return {
      activeSounds: this.activeSoundCount,
      poolUsed,
      poolTotal: POOL_SIZE,
    };
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  public dispose(): void {
    this.stopAll();
    this.loadedBuffers.clear();
    this.activeInstances.clear();
    this.spatialClusters.clear();
    this.soundConfigs.clear();
    this.configLoaded = false;

    for (const source of this.audioPool) {
      source.audio.disconnect();
    }
    this.audioPool = [];
    this.poolInitialized = false;

    if (this.listener) {
      this.listener.parent?.remove(this.listener);
      this.listener = null;
    }
  }
}

// Export singleton
export const AudioManager = new AudioManagerClass();
