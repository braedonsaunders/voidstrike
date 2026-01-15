/**
 * Audio Configuration Loader
 *
 * Loads all audio configuration from JSON files in public/audio/.
 * This makes the audio system fully data-driven - modify JSON files to change
 * sounds, music, and voice lines without touching code.
 */

// ============================================================================
// MUSIC CONFIG TYPES
// ============================================================================

export interface MusicCategoryConfig {
  folder: string;
  description?: string;
  shuffle: boolean;
  loop: boolean;
  crossfadeDuration: number;
}

export interface SpecialTrackConfig {
  url: string;
  description?: string;
  loop: boolean;
  volume: number;
}

export interface MusicConfig {
  categories: Record<string, MusicCategoryConfig>;
  specialTracks: Record<string, SpecialTrackConfig>;
  defaults: {
    volume: number;
    crossfadeDuration: number;
    maxConsecutiveFailures: number;
  };
}

// ============================================================================
// SOUNDS CONFIG TYPES
// ============================================================================

export type SoundPriorityName = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export interface SoundDefinition {
  url: string;
  volume?: number;
  priority?: SoundPriorityName;
  loop?: boolean;
  spatial?: boolean;
  maxInstances?: number;
  cooldown?: number;
  maxDistance?: number;
  clusterRadius?: number;
}

export interface SoundsConfig {
  categories: string[];
  priorities: Record<SoundPriorityName, number>;
  defaults: {
    volume: number;
    priority: SoundPriorityName;
    loop: boolean;
    spatial: boolean;
    maxInstances: number;
    cooldown: number;
    maxDistance: number;
    clusterRadius: number;
  };
  sounds: Record<string, Record<string, SoundDefinition>>;
  biomeAmbient: Record<string, string>;
}

// ============================================================================
// VOICES CONFIG TYPES
// ============================================================================

export interface VoiceGroupConfig {
  basePath: string;
  select: string[];
  move: string[];
  attack: string[];
  ready?: string;
}

export interface VoicesConfig {
  defaults: {
    volume: number;
    priority: SoundPriorityName;
    category: string;
  };
  voiceGroups: Record<string, VoiceGroupConfig>;
}

// ============================================================================
// SINGLETON CONFIG LOADER
// ============================================================================

class AudioConfigLoader {
  private musicConfig: MusicConfig | null = null;
  private soundsConfig: SoundsConfig | null = null;
  private voicesConfig: VoicesConfig | null = null;
  private loadPromise: Promise<void> | null = null;

  /**
   * Load all audio configuration files
   * Safe to call multiple times - will only load once
   */
  public async load(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    const [musicRes, soundsRes, voicesRes] = await Promise.all([
      fetch('/audio/music.config.json'),
      fetch('/audio/sounds.config.json'),
      fetch('/audio/voices.config.json'),
    ]);

    if (!musicRes.ok) {
      throw new Error(`Failed to load music.config.json: ${musicRes.status}`);
    }
    if (!soundsRes.ok) {
      throw new Error(`Failed to load sounds.config.json: ${soundsRes.status}`);
    }
    if (!voicesRes.ok) {
      throw new Error(`Failed to load voices.config.json: ${voicesRes.status}`);
    }

    this.musicConfig = await musicRes.json();
    this.soundsConfig = await soundsRes.json();
    this.voicesConfig = await voicesRes.json();
  }

  /**
   * Check if config has been loaded
   */
  public isLoaded(): boolean {
    return this.musicConfig !== null && this.soundsConfig !== null && this.voicesConfig !== null;
  }

  /**
   * Get music configuration
   */
  public getMusic(): MusicConfig {
    if (!this.musicConfig) {
      throw new Error('Audio config not loaded. Call load() first.');
    }
    return this.musicConfig;
  }

  /**
   * Get sounds configuration
   */
  public getSounds(): SoundsConfig {
    if (!this.soundsConfig) {
      throw new Error('Audio config not loaded. Call load() first.');
    }
    return this.soundsConfig;
  }

  /**
   * Get voices configuration
   */
  public getVoices(): VoicesConfig {
    if (!this.voicesConfig) {
      throw new Error('Audio config not loaded. Call load() first.');
    }
    return this.voicesConfig;
  }

  /**
   * Get the list of music category names from config
   */
  public getMusicCategories(): string[] {
    return Object.keys(this.getMusic().categories);
  }

  /**
   * Get a specific music category config
   */
  public getMusicCategory(category: string): MusicCategoryConfig | undefined {
    return this.getMusic().categories[category];
  }

  /**
   * Get a special track (victory, defeat, etc.)
   */
  public getSpecialTrack(trackId: string): SpecialTrackConfig | undefined {
    return this.getMusic().specialTracks[trackId];
  }

  /**
   * Get all sound IDs as a flat list
   */
  public getAllSoundIds(): string[] {
    const sounds = this.getSounds();
    const ids: string[] = [];
    for (const category of Object.values(sounds.sounds)) {
      ids.push(...Object.keys(category));
    }
    return ids;
  }

  /**
   * Get a sound definition by ID
   */
  public getSound(soundId: string): (SoundDefinition & { id: string; category: string }) | undefined {
    const sounds = this.getSounds();
    for (const [category, categorySounds] of Object.entries(sounds.sounds)) {
      if (soundId in categorySounds) {
        return {
          ...sounds.defaults,
          ...categorySounds[soundId],
          id: soundId,
          category,
        };
      }
    }
    return undefined;
  }

  /**
   * Get a voice group by ID
   */
  public getVoiceGroup(voiceGroupId: string): VoiceGroupConfig | undefined {
    return this.getVoices().voiceGroups[voiceGroupId];
  }

  /**
   * Build full URLs for a voice group's sounds
   */
  public getVoiceUrls(voiceGroupId: string): {
    select: string[];
    move: string[];
    attack: string[];
    ready?: string;
  } | undefined {
    const group = this.getVoiceGroup(voiceGroupId);
    if (!group) return undefined;

    return {
      select: group.select.map(f => `${group.basePath}/${f}`),
      move: group.move.map(f => `${group.basePath}/${f}`),
      attack: group.attack.map(f => `${group.basePath}/${f}`),
      ready: group.ready ? `${group.basePath}/${group.ready}` : undefined,
    };
  }

  /**
   * Get the priority numeric value from name
   */
  public getPriorityValue(priorityName: SoundPriorityName): number {
    return this.getSounds().priorities[priorityName];
  }

  /**
   * Get biome ambient sound mapping
   */
  public getBiomeAmbient(): Record<string, string> {
    return this.getSounds().biomeAmbient;
  }
}

// Export singleton instance
export const audioConfig = new AudioConfigLoader();
