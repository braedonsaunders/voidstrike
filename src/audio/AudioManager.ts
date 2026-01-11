import * as THREE from 'three';
import { debugAudio } from '@/utils/debugLogger';

export type SoundCategory = 'ui' | 'combat' | 'unit' | 'building' | 'ambient' | 'music' | 'voice' | 'alert';

// Priority levels for voice stealing (higher = more important)
export enum SoundPriority {
  LOW = 0,        // Ambient, minor impacts
  NORMAL = 1,     // Standard combat sounds
  HIGH = 2,       // Explosions, deaths
  CRITICAL = 3,   // Alerts, UI, important events
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
  maxDistance?: number;  // Distance beyond which sound won't play
  clusterRadius?: number; // Radius for spatial clustering
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

// ============================================================================
// SOUND DEFINITIONS
// ============================================================================

export const SOUNDS: Record<string, SoundConfig> = {
  // UI Sounds (Critical priority - always play)
  ui_click: { id: 'ui_click', url: '/audio/ui/click.mp3', category: 'ui', volume: 0.5, priority: SoundPriority.CRITICAL },
  ui_error: { id: 'ui_error', url: '/audio/ui/error.mp3', category: 'ui', volume: 0.6, priority: SoundPriority.CRITICAL },
  ui_select: { id: 'ui_select', url: '/audio/ui/select.mp3', category: 'ui', volume: 0.4, priority: SoundPriority.CRITICAL },
  ui_notification: { id: 'ui_notification', url: '/audio/ui/notification.mp3', category: 'ui', volume: 0.6, priority: SoundPriority.CRITICAL },

  // Alert Sounds (Critical priority - always play)
  alert_under_attack: { id: 'alert_under_attack', url: '/audio/alert/under_attack.mp3', category: 'alert', volume: 0.8, cooldown: 5000, priority: SoundPriority.CRITICAL },
  alert_additional_population_required: { id: 'alert_additional_population_required', url: '/audio/alert/additional_population_required.mp3', category: 'alert', volume: 0.7, cooldown: 3000, priority: SoundPriority.CRITICAL },
  alert_not_enough_minerals: { id: 'alert_not_enough_minerals', url: '/audio/alert/not_enough_minerals.mp3', category: 'alert', volume: 0.7, cooldown: 1000, priority: SoundPriority.CRITICAL },
  alert_not_enough_vespene: { id: 'alert_not_enough_vespene', url: '/audio/alert/not_enough_vespene.mp3', category: 'alert', volume: 0.7, cooldown: 1000, priority: SoundPriority.CRITICAL },
  alert_minerals_depleted: { id: 'alert_minerals_depleted', url: '/audio/alert/minerals_depleted.mp3', category: 'alert', volume: 0.6, priority: SoundPriority.CRITICAL },
  alert_building_complete: { id: 'alert_building_complete', url: '/audio/alert/building_complete.mp3', category: 'alert', volume: 0.7, priority: SoundPriority.CRITICAL },
  alert_research_complete: { id: 'alert_research_complete', url: '/audio/alert/research_complete.mp3', category: 'alert', volume: 0.7, priority: SoundPriority.CRITICAL },
  alert_upgrade_complete: { id: 'alert_upgrade_complete', url: '/audio/alert/upgrade_complete.mp3', category: 'alert', volume: 0.7, priority: SoundPriority.CRITICAL },

  // Combat Sounds - Weapons (Normal priority, spatial with clustering)
  attack_rifle: { id: 'attack_rifle', url: '/audio/combat/rifle.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 20, cooldown: 30, priority: SoundPriority.NORMAL, maxDistance: 150, clusterRadius: 8 },
  attack_cannon: { id: 'attack_cannon', url: '/audio/combat/cannon.mp3', category: 'combat', volume: 0.6, spatial: true, maxInstances: 10, cooldown: 80, priority: SoundPriority.HIGH, maxDistance: 200, clusterRadius: 12 },
  attack_laser: { id: 'attack_laser', url: '/audio/combat/laser.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 15, cooldown: 50, priority: SoundPriority.NORMAL, maxDistance: 150, clusterRadius: 8 },
  attack_missile: { id: 'attack_missile', url: '/audio/combat/missile.mp3', category: 'combat', volume: 0.6, spatial: true, maxInstances: 8, cooldown: 150, priority: SoundPriority.HIGH, maxDistance: 180, clusterRadius: 10 },
  attack_flamethrower: { id: 'attack_flamethrower', url: '/audio/combat/flamethrower.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 6, cooldown: 80, priority: SoundPriority.NORMAL, maxDistance: 120, clusterRadius: 6 },

  // Combat Sounds - Impacts (Low priority, high clustering)
  hit_impact: { id: 'hit_impact', url: '/audio/combat/hit.mp3', category: 'combat', volume: 0.4, spatial: true, maxInstances: 25, cooldown: 20, priority: SoundPriority.LOW, maxDistance: 100, clusterRadius: 10 },
  hit_armor: { id: 'hit_armor', url: '/audio/combat/hit_armor.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 20, cooldown: 30, priority: SoundPriority.LOW, maxDistance: 100, clusterRadius: 10 },
  hit_shield: { id: 'hit_shield', url: '/audio/combat/hit_shield.mp3', category: 'combat', volume: 0.4, spatial: true, maxInstances: 15, cooldown: 30, priority: SoundPriority.LOW, maxDistance: 100, clusterRadius: 10 },

  // Combat Sounds - Explosions (High priority)
  explosion_small: { id: 'explosion_small', url: '/audio/combat/explosion_small.mp3', category: 'combat', volume: 0.6, spatial: true, maxInstances: 10, priority: SoundPriority.HIGH, maxDistance: 180 },
  explosion_large: { id: 'explosion_large', url: '/audio/combat/explosion_large.mp3', category: 'combat', volume: 0.8, spatial: true, maxInstances: 6, priority: SoundPriority.HIGH, maxDistance: 250 },
  explosion_building: { id: 'explosion_building', url: '/audio/combat/explosion_building.mp3', category: 'combat', volume: 0.9, spatial: true, maxInstances: 4, priority: SoundPriority.HIGH, maxDistance: 300 },

  // Combat Sounds - Deaths (Normal priority)
  unit_death: { id: 'unit_death', url: '/audio/combat/death.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 10, priority: SoundPriority.NORMAL, maxDistance: 120, clusterRadius: 15 },
  unit_death_mech: { id: 'unit_death_mech', url: '/audio/combat/death_mech.mp3', category: 'combat', volume: 0.6, spatial: true, maxInstances: 6, priority: SoundPriority.HIGH, maxDistance: 150 },
  unit_death_bio: { id: 'unit_death_bio', url: '/audio/combat/death_bio.mp3', category: 'combat', volume: 0.5, spatial: true, maxInstances: 10, priority: SoundPriority.NORMAL, maxDistance: 120, clusterRadius: 15 },

  // Unit Command Sounds (High priority - player feedback)
  unit_move: { id: 'unit_move', url: '/audio/unit/move.mp3', category: 'unit', volume: 0.3, cooldown: 300, priority: SoundPriority.HIGH },
  unit_attack: { id: 'unit_attack', url: '/audio/unit/attack.mp3', category: 'unit', volume: 0.3, cooldown: 300, priority: SoundPriority.HIGH },
  unit_ready: { id: 'unit_ready', url: '/audio/unit/ready.mp3', category: 'unit', volume: 0.5, priority: SoundPriority.HIGH },
  worker_mining: { id: 'worker_mining', url: '/audio/unit/mining.mp3', category: 'unit', volume: 0.3, spatial: true, loop: true, priority: SoundPriority.LOW, maxDistance: 80 },
  worker_building: { id: 'worker_building', url: '/audio/unit/building.mp3', category: 'unit', volume: 0.3, spatial: true, loop: true, priority: SoundPriority.LOW, maxDistance: 80 },

  // Unit Voice Lines - SCV (Worker)
  voice_scv_select_1: { id: 'voice_scv_select_1', url: '/audio/voice/scv/select1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_scv_select_2: { id: 'voice_scv_select_2', url: '/audio/voice/scv/select2.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_scv_select_3: { id: 'voice_scv_select_3', url: '/audio/voice/scv/select3.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_scv_move_1: { id: 'voice_scv_move_1', url: '/audio/voice/scv/move1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_scv_move_2: { id: 'voice_scv_move_2', url: '/audio/voice/scv/move2.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_scv_attack_1: { id: 'voice_scv_attack_1', url: '/audio/voice/scv/attack1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },

  // Unit Voice Lines - Marine
  voice_marine_select_1: { id: 'voice_marine_select_1', url: '/audio/voice/marine/select1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_marine_select_2: { id: 'voice_marine_select_2', url: '/audio/voice/marine/select2.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_marine_select_3: { id: 'voice_marine_select_3', url: '/audio/voice/marine/select3.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_marine_move_1: { id: 'voice_marine_move_1', url: '/audio/voice/marine/move1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_marine_move_2: { id: 'voice_marine_move_2', url: '/audio/voice/marine/move2.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_marine_attack_1: { id: 'voice_marine_attack_1', url: '/audio/voice/marine/attack1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_marine_attack_2: { id: 'voice_marine_attack_2', url: '/audio/voice/marine/attack2.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_marine_ready: { id: 'voice_marine_ready', url: '/audio/voice/marine/ready.mp3', category: 'voice', volume: 0.7, priority: SoundPriority.HIGH },

  // Unit Voice Lines - Marauder
  voice_marauder_select_1: { id: 'voice_marauder_select_1', url: '/audio/voice/marauder/select1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_marauder_select_2: { id: 'voice_marauder_select_2', url: '/audio/voice/marauder/select2.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_marauder_move_1: { id: 'voice_marauder_move_1', url: '/audio/voice/marauder/move1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_marauder_move_2: { id: 'voice_marauder_move_2', url: '/audio/voice/marauder/move2.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_marauder_attack_1: { id: 'voice_marauder_attack_1', url: '/audio/voice/marauder/attack1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_marauder_ready: { id: 'voice_marauder_ready', url: '/audio/voice/marauder/ready.mp3', category: 'voice', volume: 0.7, priority: SoundPriority.HIGH },

  // Unit Voice Lines - Hellion
  voice_hellion_select_1: { id: 'voice_hellion_select_1', url: '/audio/voice/hellion/select1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_hellion_select_2: { id: 'voice_hellion_select_2', url: '/audio/voice/hellion/select2.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_hellion_move_1: { id: 'voice_hellion_move_1', url: '/audio/voice/hellion/move1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_hellion_attack_1: { id: 'voice_hellion_attack_1', url: '/audio/voice/hellion/attack1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_hellion_ready: { id: 'voice_hellion_ready', url: '/audio/voice/hellion/ready.mp3', category: 'voice', volume: 0.7, priority: SoundPriority.HIGH },

  // Unit Voice Lines - Siege Tank
  voice_tank_select_1: { id: 'voice_tank_select_1', url: '/audio/voice/tank/select1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_tank_select_2: { id: 'voice_tank_select_2', url: '/audio/voice/tank/select2.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_tank_move_1: { id: 'voice_tank_move_1', url: '/audio/voice/tank/move1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_tank_attack_1: { id: 'voice_tank_attack_1', url: '/audio/voice/tank/attack1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_tank_ready: { id: 'voice_tank_ready', url: '/audio/voice/tank/ready.mp3', category: 'voice', volume: 0.7, priority: SoundPriority.HIGH },

  // Unit Voice Lines - Medic
  voice_medic_select_1: { id: 'voice_medic_select_1', url: '/audio/voice/medic/select1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_medic_select_2: { id: 'voice_medic_select_2', url: '/audio/voice/medic/select2.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_medic_move_1: { id: 'voice_medic_move_1', url: '/audio/voice/medic/move1.mp3', category: 'voice', volume: 0.6, priority: SoundPriority.HIGH },
  voice_medic_ready: { id: 'voice_medic_ready', url: '/audio/voice/medic/ready.mp3', category: 'voice', volume: 0.7, priority: SoundPriority.HIGH },

  // Building Sounds
  building_place: { id: 'building_place', url: '/audio/building/place.mp3', category: 'building', volume: 0.5, priority: SoundPriority.HIGH },
  building_construct: { id: 'building_construct', url: '/audio/building/construct.mp3', category: 'building', volume: 0.4, spatial: true, loop: true, priority: SoundPriority.LOW, maxDistance: 100 },
  production_start: { id: 'production_start', url: '/audio/building/production.mp3', category: 'building', volume: 0.4, priority: SoundPriority.NORMAL },
  building_powerup: { id: 'building_powerup', url: '/audio/building/powerup.mp3', category: 'building', volume: 0.5, priority: SoundPriority.NORMAL },
  building_powerdown: { id: 'building_powerdown', url: '/audio/building/powerdown.mp3', category: 'building', volume: 0.5, priority: SoundPriority.NORMAL },

  // Ambient Sounds - Biome specific
  ambient_wind: { id: 'ambient_wind', url: '/audio/ambient/wind.mp3', category: 'ambient', volume: 0.2, loop: true, priority: SoundPriority.LOW },
  ambient_nature: { id: 'ambient_nature', url: '/audio/ambient/nature.mp3', category: 'ambient', volume: 0.15, loop: true, priority: SoundPriority.LOW },
  ambient_desert: { id: 'ambient_desert', url: '/audio/ambient/desert.mp3', category: 'ambient', volume: 0.15, loop: true, priority: SoundPriority.LOW },
  ambient_frozen: { id: 'ambient_frozen', url: '/audio/ambient/frozen.mp3', category: 'ambient', volume: 0.2, loop: true, priority: SoundPriority.LOW },
  ambient_volcanic: { id: 'ambient_volcanic', url: '/audio/ambient/volcanic.mp3', category: 'ambient', volume: 0.2, loop: true, priority: SoundPriority.LOW },
  ambient_void: { id: 'ambient_void', url: '/audio/ambient/void.mp3', category: 'ambient', volume: 0.15, loop: true, priority: SoundPriority.LOW },
  ambient_jungle: { id: 'ambient_jungle', url: '/audio/ambient/jungle.mp3', category: 'ambient', volume: 0.2, loop: true, priority: SoundPriority.LOW },
  ambient_battle: { id: 'ambient_battle', url: '/audio/ambient/battle.mp3', category: 'ambient', volume: 0.1, loop: true, priority: SoundPriority.LOW },

  // Music
  music_menu: { id: 'music_menu', url: '/audio/music/menu.mp3', category: 'music', volume: 0.3, loop: true, priority: SoundPriority.NORMAL },
  music_battle: { id: 'music_battle', url: '/audio/music/battle.mp3', category: 'music', volume: 0.25, loop: true, priority: SoundPriority.NORMAL },
  music_peace: { id: 'music_peace', url: '/audio/music/peace.mp3', category: 'music', volume: 0.2, loop: true, priority: SoundPriority.NORMAL },
  music_victory: { id: 'music_victory', url: '/audio/music/victory.mp3', category: 'music', volume: 0.4, priority: SoundPriority.CRITICAL },
  music_defeat: { id: 'music_defeat', url: '/audio/music/defeat.mp3', category: 'music', volume: 0.4, priority: SoundPriority.CRITICAL },
};

// Unit voice mapping
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

// ============================================================================
// WORLD-CLASS AUDIO MANAGER
// ============================================================================

// Configuration constants
const POOL_SIZE = 96;              // Preallocated positional audio sources
const MAX_CONCURRENT_SOUNDS = 64;  // Global voice budget
const FADE_OUT_DURATION = 100;     // ms for smooth voice stealing
const CLUSTER_TIME_WINDOW = 50;    // ms window for spatial clustering

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

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  public initialize(camera?: THREE.Camera): void {
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
      } catch {
        debugAudio.warn(`Failed to load sound: ${config.url}`);
      }
    });

    await Promise.all(loadPromises);
    debugAudio.log(`Preloaded ${this.loadedBuffers.size} sounds`);
  }

  // ============================================================================
  // 2D SOUND PLAYBACK
  // ============================================================================

  public play(soundId: string, volumeMultiplier = 1): void {
    if (this.muted) return;

    const config = SOUNDS[soundId];
    if (!config) return;

    // Check cooldown
    if (!this.checkCooldown(soundId, config)) return;

    // Check global budget (except for critical sounds)
    if (config.priority !== SoundPriority.CRITICAL && this.activeSoundCount >= MAX_CONCURRENT_SOUNDS) {
      // Try to steal a lower priority sound
      if (!this.stealLowestPrioritySound(config.priority ?? SoundPriority.NORMAL)) {
        return; // Couldn't steal, don't play
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
      this.playFallback(soundId, config, volumeMultiplier);
    }
  }

  // ============================================================================
  // 3D SPATIAL SOUND PLAYBACK
  // ============================================================================

  public playAt(soundId: string, position: THREE.Vector3, volumeMultiplier = 1): void {
    if (this.muted || !this.listener) return;

    const config = SOUNDS[soundId];
    if (!config || !config.spatial) {
      this.play(soundId, volumeMultiplier);
      return;
    }

    // Distance culling
    const distance = position.distanceTo(this.listenerPosition);
    const maxDistance = config.maxDistance ?? 200;
    if (distance > maxDistance) {
      return; // Too far to hear
    }

    // Check cooldown
    if (!this.checkCooldown(soundId, config)) return;

    // Spatial clustering - check if similar sound played nearby recently
    if (config.clusterRadius && this.isClusteredSound(soundId, position, config.clusterRadius)) {
      return; // Already a similar sound playing nearby
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

    // Get a pooled audio source
    const pooledSource = this.acquirePooledSource(soundId, config.priority ?? SoundPriority.NORMAL, position);
    if (!pooledSource) {
      return; // No available sources
    }

    // Configure and play
    const sound = pooledSource.audio;
    sound.setBuffer(buffer);

    // Volume attenuation based on distance
    const distanceFactor = 1 - Math.min(distance / maxDistance, 1);
    const attenuatedVolume = this.getEffectiveVolume(config) * volumeMultiplier * (0.3 + 0.7 * distanceFactor);
    sound.setVolume(attenuatedVolume);

    sound.setLoop(config.loop || false);
    sound.position.copy(position);
    sound.play();

    this.activeSoundCount++;

    // Record cluster position
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

  /**
   * Acquire a pooled audio source, potentially stealing from lower priority sounds
   */
  private acquirePooledSource(soundId: string, priority: SoundPriority, position: THREE.Vector3): PooledAudioSource | null {
    // First, try to find a free source
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

    // No free sources - try voice stealing
    let lowestPrioritySource: PooledAudioSource | null = null;
    let lowestPriority = priority;
    let oldestTime = Date.now();

    for (const source of this.audioPool) {
      // Skip if currently fading out
      if (source.fadeOutStart !== null) continue;

      // Find lowest priority, oldest sound
      if (source.priority < lowestPriority ||
          (source.priority === lowestPriority && source.startTime < oldestTime)) {
        lowestPriority = source.priority;
        oldestTime = source.startTime;
        lowestPrioritySource = source;
      }
    }

    if (lowestPrioritySource && lowestPriority < priority) {
      // Steal this source with fadeout
      this.fadeOutAndSteal(lowestPrioritySource, soundId, priority, position);
      return lowestPrioritySource;
    }

    return null; // Couldn't acquire a source
  }

  /**
   * Fade out a sound and prepare it for reuse
   */
  private fadeOutAndSteal(source: PooledAudioSource, newSoundId: string, newPriority: SoundPriority, newPosition: THREE.Vector3): void {
    source.fadeOutStart = Date.now();
    const originalVolume = source.audio.getVolume();

    // Quick fade out
    const fadeInterval = setInterval(() => {
      const elapsed = Date.now() - (source.fadeOutStart ?? 0);
      const progress = Math.min(elapsed / FADE_OUT_DURATION, 1);

      source.audio.setVolume(originalVolume * (1 - progress));

      if (progress >= 1) {
        clearInterval(fadeInterval);
        source.audio.stop();
        source.audio.setVolume(originalVolume);

        // Reassign to new sound
        source.soundId = newSoundId;
        source.priority = newPriority;
        source.position.copy(newPosition);
        source.startTime = Date.now();
        source.fadeOutStart = null;
      }
    }, 16); // ~60fps
  }

  /**
   * Release a pooled audio source back to the pool
   */
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

  /**
   * Check if a similar sound was played nearby recently
   */
  private isClusteredSound(soundId: string, position: THREE.Vector3, radius: number): boolean {
    const clusters = this.spatialClusters.get(soundId);
    if (!clusters) return false;

    const now = Date.now();

    // Clean old clusters and check for nearby sounds
    const validClusters = clusters.filter(c => now - c.time < CLUSTER_TIME_WINDOW);
    this.spatialClusters.set(soundId, validClusters);

    for (const cluster of validClusters) {
      if (position.distanceTo(cluster.position) < radius) {
        return true; // Found a nearby recent sound
      }
    }

    return false;
  }

  /**
   * Record a sound position for clustering
   */
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

    // Limit cluster history size
    if (clusters.length > 50) {
      clusters.shift();
    }
  }

  // ============================================================================
  // VOICE STEALING & BUDGET MANAGEMENT
  // ============================================================================

  /**
   * Try to steal a lower priority sound to make room
   */
  private stealLowestPrioritySound(requiredPriority: SoundPriority): boolean {
    // Check 2D sounds first
    for (const [soundId, instances] of this.activeInstances) {
      const config = SOUNDS[soundId];
      if (!config) continue;

      const instancePriority = config.priority ?? SoundPriority.NORMAL;
      if (instancePriority < requiredPriority && instances.length > 0) {
        this.stopOldestInstance(soundId, instances);
        return true;
      }
    }

    // Check pooled spatial sounds
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
    // Stop 2D instances
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

    // Stop pooled instances
    for (const source of this.audioPool) {
      if (source.inUse && source.soundId === soundId) {
        this.releasePooledSource(source);
        this.activeSoundCount--;
      }
    }
  }

  public stopCategory(category: SoundCategory): void {
    for (const [soundId, config] of Object.entries(SOUNDS)) {
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
    if (!this.audioContext) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    const frequency = config.category === 'combat' ? 200 : config.category === 'ui' ? 800 : 400;
    oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    oscillator.type = 'sine';

    const volume = this.getEffectiveVolume(config) * volumeMultiplier * 0.1;
    gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

    oscillator.start();
    oscillator.stop(this.audioContext.currentTime + 0.1);
  }

  // ============================================================================
  // STATISTICS (for debugging)
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
