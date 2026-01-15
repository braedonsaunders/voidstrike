import { debugAudio } from '@/utils/debugLogger';
import { audioConfig, MusicCategoryConfig } from './audioConfig';

export interface MusicTrack {
  name: string;
  url: string;
}

interface MusicDiscoveryResponse {
  categories: Record<string, MusicTrack[]>;
}

/**
 * MusicPlayer - Fully data-driven music playback system
 *
 * All configuration is loaded from public/audio/music.config.json:
 * - Music categories (menu, gameplay, etc.)
 * - Special tracks (victory, defeat, etc.)
 * - Playback settings (volume, crossfade, etc.)
 *
 * To add new music:
 * 1. Drop MP3 files in the appropriate folder (e.g., /public/audio/music/gameplay/)
 * 2. Add new categories by editing music.config.json
 * 3. No code changes required
 */
class MusicPlayerClass {
  private currentAudio: HTMLAudioElement | null = null;
  private fadingOutAudio: HTMLAudioElement | null = null;
  private crossfadeInterval: ReturnType<typeof setInterval> | null = null;

  // Tracks organized by category (loaded from API)
  private tracksByCategory: Record<string, MusicTrack[]> = {};
  private shuffledQueue: MusicTrack[] = [];
  private currentCategory: string | null = null;
  private currentTrackIndex = 0;

  private volume = 0.25;
  private muted = false;
  private isPlaying = false;
  private isLoading = false;
  private initialized = false;
  private tracksDiscovered = false;
  private currentTrackName: string | null = null;
  private consecutiveFailures = 0;
  private audioElementsToIgnore: Set<HTMLAudioElement> = new Set();

  private crossfadeDuration = 1500;
  private crossfadeUpdateInterval = 100;
  private maxConsecutiveFailures = 3;
  private pendingCategory: string | null = null;
  private userInteractionListenerAdded = false;

  /**
   * Initialize the music player
   * Loads configuration from JSON files
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load audio config
    await audioConfig.load();

    // Apply defaults from config
    const musicConfig = audioConfig.getMusic();
    this.volume = musicConfig.defaults.volume;
    this.crossfadeDuration = musicConfig.defaults.crossfadeDuration;
    this.maxConsecutiveFailures = musicConfig.defaults.maxConsecutiveFailures;

    this.initialized = true;
    debugAudio.log('MusicPlayer initialized from config');
  }

  /**
   * Set up a one-time listener for user interaction to resume blocked audio
   */
  private setupUserInteractionListener(): void {
    if (this.userInteractionListenerAdded || typeof window === 'undefined') return;

    const handleUserInteraction = () => {
      if (this.pendingCategory) {
        debugAudio.log(`User interaction detected, starting ${this.pendingCategory} music`);
        const category = this.pendingCategory;
        this.pendingCategory = null;
        this.play(category);
      }
      window.removeEventListener('click', handleUserInteraction);
      window.removeEventListener('keydown', handleUserInteraction);
      window.removeEventListener('touchstart', handleUserInteraction);
      this.userInteractionListenerAdded = false;
    };

    window.addEventListener('click', handleUserInteraction, { once: true });
    window.addEventListener('keydown', handleUserInteraction, { once: true });
    window.addEventListener('touchstart', handleUserInteraction, { once: true });
    this.userInteractionListenerAdded = true;
    debugAudio.log('Waiting for user interaction to start music (browser autoplay policy)');
  }

  /**
   * Discover available music tracks from the server
   * The API reads from music.config.json to know which folders to scan
   */
  public async discoverTracks(): Promise<void> {
    if (this.tracksDiscovered) return;

    try {
      const response = await fetch('/api/music');
      if (!response.ok) {
        throw new Error(`Failed to fetch music tracks: ${response.status}`);
      }

      const data: MusicDiscoveryResponse = await response.json();
      this.tracksByCategory = data.categories || {};
      this.tracksDiscovered = true;

      // Log discovered tracks
      for (const [category, tracks] of Object.entries(this.tracksByCategory)) {
        debugAudio.log(`Discovered ${tracks.length} ${category} tracks`);
      }
    } catch (error) {
      debugAudio.warn('Failed to discover music tracks:', error);
      this.tracksDiscovered = false;
    }
  }

  /**
   * Shuffle an array using Fisher-Yates algorithm
   */
  private shuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Get the tracks for a category and create a shuffled queue
   */
  private prepareCategoryQueue(category: string): void {
    const tracks = this.tracksByCategory[category] || [];
    const categoryConfig = audioConfig.getMusicCategory(category);

    if (categoryConfig?.shuffle) {
      this.shuffledQueue = this.shuffle(tracks);
    } else {
      this.shuffledQueue = [...tracks];
    }

    this.currentTrackIndex = 0;
    this.currentCategory = category;
    debugAudio.log(`Prepared ${category} queue with ${this.shuffledQueue.length} tracks`);
  }

  /**
   * Get the next track from the queue, reshuffling if needed
   */
  private getNextTrack(): MusicTrack | null {
    if (this.shuffledQueue.length === 0) return null;

    const categoryConfig = this.currentCategory ? audioConfig.getMusicCategory(this.currentCategory) : null;

    // If we've played all tracks
    if (this.currentTrackIndex >= this.shuffledQueue.length) {
      if (categoryConfig?.loop) {
        // Reshuffle if shuffle is enabled
        if (categoryConfig.shuffle) {
          this.shuffledQueue = this.shuffle(this.shuffledQueue);
        }
        this.currentTrackIndex = 0;
        debugAudio.log('Reshuffled music queue');
      } else {
        return null; // Don't loop
      }
    }

    return this.shuffledQueue[this.currentTrackIndex++];
  }

  /**
   * Play music for a specific category
   */
  public async play(category: string): Promise<void> {
    this.consecutiveFailures = 0;

    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.tracksDiscovered) {
      await this.discoverTracks();
    }

    // Check if this is a valid category
    const categoryConfig = audioConfig.getMusicCategory(category);
    if (!categoryConfig) {
      debugAudio.warn(`Unknown music category: ${category}`);
      return;
    }

    // Check if there are any tracks for this category
    const availableTracks = this.tracksByCategory[category] || [];
    if (availableTracks.length === 0) {
      debugAudio.warn(`No ${category} music tracks available - skipping music playback`);
      return;
    }

    // If switching categories, prepare new queue
    if (category !== this.currentCategory) {
      this.prepareCategoryQueue(category);
    }

    // Get next track
    const track = this.getNextTrack();
    if (!track) {
      debugAudio.warn(`No ${category} music tracks in queue`);
      return;
    }

    await this.playTrack(track);
  }

  /**
   * Play a specific track
   */
  private async playTrack(track: MusicTrack): Promise<void> {
    if (this.isLoading) {
      debugAudio.log('Already loading a track, skipping');
      return;
    }

    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      debugAudio.warn('Too many consecutive failures, stopping music attempts');
      this.isPlaying = false;
      return;
    }

    this.isLoading = true;
    debugAudio.log(`Playing track: ${track.name}`);
    this.currentTrackName = track.name;

    const audio = new Audio(track.url);
    audio.volume = this.muted ? 0 : this.volume;
    audio.loop = false;

    audio.addEventListener('ended', () => {
      if (this.audioElementsToIgnore.has(audio)) {
        return;
      }
      this.consecutiveFailures = 0;
      this.onTrackEnded();
    });

    audio.addEventListener('error', () => {
      if (this.audioElementsToIgnore.has(audio)) {
        return;
      }
      debugAudio.warn(`Failed to load track ${track.name}`);
      this.consecutiveFailures++;
      this.isLoading = false;

      if (this.consecutiveFailures < this.maxConsecutiveFailures) {
        setTimeout(() => this.onTrackEnded(), 500);
      } else {
        debugAudio.warn('Max failures reached, stopping music');
        this.isPlaying = false;
      }
    });

    if (this.currentAudio && this.isPlaying) {
      this.crossfade(this.currentAudio, audio);
    } else {
      try {
        await audio.play();
        this.currentAudio = audio;
        this.isPlaying = true;
        this.consecutiveFailures = 0;
      } catch (error) {
        if (error instanceof Error && error.name === 'NotAllowedError') {
          debugAudio.log('Autoplay blocked by browser policy');
          this.pendingCategory = this.currentCategory;
          this.setupUserInteractionListener();
        } else {
          debugAudio.warn('Failed to play track:', error);
          this.consecutiveFailures++;
        }
      }
      this.isLoading = false;
    }
  }

  /**
   * Crossfade between two audio elements
   */
  private crossfade(from: HTMLAudioElement, to: HTMLAudioElement): void {
    this.cleanupCrossfade();

    if (!this.isLoading) {
      debugAudio.warn('crossfade called but isLoading is false - aborting');
      return;
    }

    const categoryConfig = this.currentCategory ? audioConfig.getMusicCategory(this.currentCategory) : null;
    const fadeDuration = categoryConfig?.crossfadeDuration ?? this.crossfadeDuration;

    const startTime = Date.now();
    const startVolume = from.volume;
    const targetVolume = this.muted ? 0 : this.volume;

    to.volume = 0;
    this.fadingOutAudio = from;

    to.play().then(() => {
      this.crossfadeInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / fadeDuration, 1);

        if (this.fadingOutAudio) {
          this.fadingOutAudio.volume = startVolume * (1 - progress);
        }
        to.volume = targetVolume * progress;

        if (progress >= 1) {
          this.cleanupCrossfade();
          this.currentAudio = to;
          this.isLoading = false;
          this.consecutiveFailures = 0;
        }
      }, this.crossfadeUpdateInterval);
    }).catch((error) => {
      debugAudio.warn('Failed to start crossfade:', error);
      this.cleanupCrossfade();
      this.isLoading = false;
      this.consecutiveFailures++;
    });
  }

  /**
   * Clean up crossfade resources
   */
  private cleanupCrossfade(): void {
    if (this.crossfadeInterval) {
      clearInterval(this.crossfadeInterval);
      this.crossfadeInterval = null;
    }
    if (this.fadingOutAudio) {
      this.audioElementsToIgnore.add(this.fadingOutAudio);
      this.fadingOutAudio.pause();
      this.fadingOutAudio.src = '';
      this.fadingOutAudio = null;

      if (this.audioElementsToIgnore.size > 10) {
        const firstElement = this.audioElementsToIgnore.values().next().value;
        if (firstElement) {
          this.audioElementsToIgnore.delete(firstElement);
        }
      }
    }
  }

  /**
   * Handle track ending - play next track
   */
  private onTrackEnded(): void {
    if (!this.isPlaying || !this.currentCategory) return;

    const track = this.getNextTrack();
    if (track) {
      this.playTrack(track);
    } else {
      this.isPlaying = false;
    }
  }

  /**
   * Stop music playback
   */
  public stop(): void {
    this.cleanupCrossfade();
    if (this.currentAudio) {
      this.audioElementsToIgnore.add(this.currentAudio);
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
    this.isPlaying = false;
    this.isLoading = false;
    this.consecutiveFailures = 0;
    this.currentTrackName = null;
    this.pendingCategory = null;
    debugAudio.log('Music stopped (queue preserved)');
  }

  /**
   * Stop music playback and reset the queue
   */
  public stopAndReset(): void {
    this.stop();
    this.currentCategory = null;
    this.shuffledQueue = [];
    this.currentTrackIndex = 0;
    debugAudio.log('Music stopped and queue reset');
  }

  /**
   * Pause music playback
   */
  public pause(): void {
    if (this.currentAudio && this.isPlaying) {
      this.currentAudio.pause();
      this.isPlaying = false;
      debugAudio.log('Music paused');
    }
  }

  /**
   * Resume music playback
   */
  public resume(): void {
    if (this.currentAudio && !this.isPlaying) {
      this.currentAudio.play().catch((error) => {
        debugAudio.warn('Failed to resume music:', error);
      });
      this.isPlaying = true;
      debugAudio.log('Music resumed');
    }
  }

  /**
   * Skip to next track
   */
  public skip(): void {
    if (this.isLoading) {
      debugAudio.log('Skip ignored: already loading');
      return;
    }

    if (!this.currentCategory) {
      debugAudio.log('Skip ignored: no current category');
      return;
    }

    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      debugAudio.log('Skip ignored: max failures reached');
      return;
    }

    if (this.crossfadeInterval) {
      debugAudio.log('Skip ignored: crossfade in progress');
      return;
    }

    const track = this.getNextTrack();
    if (track) {
      debugAudio.log(`Skipping to: ${track.name}`);
      this.playTrack(track);
    }
  }

  /**
   * Play a special track (victory, defeat, etc.) from config
   */
  public async playSpecialTrack(trackId: string, onComplete?: () => void): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const trackConfig = audioConfig.getSpecialTrack(trackId);
    if (!trackConfig) {
      debugAudio.warn(`Unknown special track: ${trackId}`);
      onComplete?.();
      return;
    }

    await this.playOneShot(trackConfig.url, trackConfig.volume, trackConfig.loop, onComplete);
  }

  /**
   * Play a one-shot music track
   */
  public async playOneShot(url: string, volumeOverride?: number, loop?: boolean, onComplete?: () => void): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    this.cleanupCrossfade();

    const audio = new Audio(url);
    const trackVolume = volumeOverride ?? 1.0;
    audio.volume = this.muted ? 0 : this.volume * trackVolume;
    audio.loop = loop ?? false;

    audio.addEventListener('ended', () => {
      this.currentAudio = null;
      this.isPlaying = false;
      this.currentTrackName = null;
      onComplete?.();
    });

    audio.addEventListener('error', (e) => {
      debugAudio.warn(`Failed to load one-shot track: ${url}`, e);
      onComplete?.();
    });

    if (this.currentAudio && this.isPlaying) {
      this.isLoading = true;
      this.crossfade(this.currentAudio, audio);
    } else {
      try {
        await audio.play();
        this.currentAudio = audio;
        this.isPlaying = true;
      } catch (error) {
        debugAudio.warn('Failed to play one-shot track:', error);
        onComplete?.();
      }
    }

    this.currentCategory = null;
    this.currentTrackName = url.split('/').pop() || 'one-shot';
    debugAudio.log(`Playing one-shot track: ${this.currentTrackName}`);
  }

  /**
   * Set music volume (0-1)
   */
  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.currentAudio && !this.muted) {
      this.currentAudio.volume = this.volume;
    }
    debugAudio.log(`Music volume set to ${(this.volume * 100).toFixed(0)}%`);
  }

  /**
   * Get current volume
   */
  public getVolume(): number {
    return this.volume;
  }

  /**
   * Set muted state
   */
  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.currentAudio) {
      this.currentAudio.volume = muted ? 0 : this.volume;
    }
    debugAudio.log(`Music ${muted ? 'muted' : 'unmuted'}`);
  }

  /**
   * Check if muted
   */
  public isMuted(): boolean {
    return this.muted;
  }

  /**
   * Check if playing
   */
  public isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Get current track name
   */
  public getCurrentTrackName(): string | null {
    return this.currentTrackName;
  }

  /**
   * Get current category
   */
  public getCurrentCategory(): string | null {
    return this.currentCategory;
  }

  /**
   * Get available categories from config
   */
  public getAvailableCategories(): string[] {
    return audioConfig.getMusicCategories();
  }

  /**
   * Switch to a new category without starting playback
   */
  public switchToCategory(category: string): void {
    this.cleanupCrossfade();
    if (this.currentAudio) {
      this.audioElementsToIgnore.add(this.currentAudio);
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
    this.isPlaying = false;
    this.isLoading = false;
    this.currentTrackName = null;

    this.prepareCategoryQueue(category);
    debugAudio.log(`Switched to ${category} category (not playing)`);
  }

  /**
   * Start playing or resume
   */
  public startOrResume(): void {
    if (this.currentAudio && !this.isPlaying) {
      this.currentAudio.play().catch((error) => {
        debugAudio.warn('Failed to resume music:', error);
      });
      this.isPlaying = true;
      debugAudio.log('Music resumed');
    } else if (!this.currentAudio && this.currentCategory) {
      debugAudio.log(`Starting fresh playback for ${this.currentCategory} category`);
      this.play(this.currentCategory);
    } else if (!this.currentAudio) {
      debugAudio.log('No music to resume and no category set');
    }
  }

  /**
   * Get available track counts per category
   */
  public getTrackCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [category, tracks] of Object.entries(this.tracksByCategory)) {
      counts[category] = tracks.length;
    }
    return counts;
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    this.stop();
    this.initialized = false;
    this.tracksDiscovered = false;
    this.userInteractionListenerAdded = false;
    this.tracksByCategory = {};
    debugAudio.log('MusicPlayer disposed');
  }
}

// Export singleton
export const MusicPlayer = new MusicPlayerClass();
