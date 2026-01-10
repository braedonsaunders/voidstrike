import { debugAudio } from '@/utils/debugLogger';

export type MusicCategory = 'menu' | 'gameplay';

export interface MusicTrack {
  name: string;
  url: string;
}

interface MusicDiscoveryResponse {
  menu: MusicTrack[];
  gameplay: MusicTrack[];
}

/**
 * MusicPlayer - Handles dynamic music loading and random playback
 *
 * Features:
 * - Discovers MP3 files from /audio/music/menu and /audio/music/gameplay folders
 * - Shuffles and plays tracks randomly within each category
 * - Supports crossfading between tracks (using setInterval, NOT requestAnimationFrame)
 * - Integrates with AudioManager volume system
 */
class MusicPlayerClass {
  private currentAudio: HTMLAudioElement | null = null;
  private fadingOutAudio: HTMLAudioElement | null = null;
  private crossfadeInterval: ReturnType<typeof setInterval> | null = null;

  private menuTracks: MusicTrack[] = [];
  private gameplayTracks: MusicTrack[] = [];
  private shuffledQueue: MusicTrack[] = [];
  private currentCategory: MusicCategory | null = null;
  private currentTrackIndex = 0;

  private volume = 0.25;
  private muted = false;
  private isPlaying = false;
  private isLoading = false; // Prevent multiple simultaneous loads
  private initialized = false;
  private tracksDiscovered = false;
  private currentTrackName: string | null = null;
  private consecutiveFailures = 0;
  private maxConsecutiveFailures = 3; // Stop trying after 3 failures
  private audioElementsToIgnore: Set<HTMLAudioElement> = new Set(); // Track cleaned up elements

  private crossfadeDuration = 1500; // 1.5 seconds crossfade
  private crossfadeUpdateInterval = 100; // Update every 100ms (10 updates/sec)

  /**
   * Initialize the music player
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    debugAudio.log('MusicPlayer initialized');
  }

  /**
   * Discover available music tracks from the server
   */
  public async discoverTracks(): Promise<void> {
    if (this.tracksDiscovered) return;

    try {
      const response = await fetch('/api/music');
      if (!response.ok) {
        throw new Error(`Failed to fetch music tracks: ${response.status}`);
      }

      const data: MusicDiscoveryResponse = await response.json();
      this.menuTracks = data.menu || [];
      this.gameplayTracks = data.gameplay || [];
      this.tracksDiscovered = true;

      debugAudio.log(`Discovered ${this.menuTracks.length} menu tracks and ${this.gameplayTracks.length} gameplay tracks`);
    } catch (error) {
      debugAudio.warn('Failed to discover music tracks:', error);
      // Try again on next play attempt
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
  private prepareCategoryQueue(category: MusicCategory): void {
    const tracks = category === 'menu' ? this.menuTracks : this.gameplayTracks;
    this.shuffledQueue = this.shuffle(tracks);
    this.currentTrackIndex = 0;
    this.currentCategory = category;
    debugAudio.log(`Prepared ${category} queue with ${this.shuffledQueue.length} tracks`);
  }

  /**
   * Get the next track from the queue, reshuffling if needed
   */
  private getNextTrack(): MusicTrack | null {
    if (this.shuffledQueue.length === 0) return null;

    // If we've played all tracks, reshuffle
    if (this.currentTrackIndex >= this.shuffledQueue.length) {
      this.shuffledQueue = this.shuffle(this.shuffledQueue);
      this.currentTrackIndex = 0;
      debugAudio.log('Reshuffled music queue');
    }

    return this.shuffledQueue[this.currentTrackIndex++];
  }

  /**
   * Play music for a specific category
   */
  public async play(category: MusicCategory): Promise<void> {
    // Reset failure counter when explicitly starting playback
    this.consecutiveFailures = 0;

    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.tracksDiscovered) {
      await this.discoverTracks();
    }

    // Check if there are any tracks for this category
    const availableTracks = category === 'menu' ? this.menuTracks : this.gameplayTracks;
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
    // Prevent multiple simultaneous loads
    if (this.isLoading) {
      debugAudio.log('Already loading a track, skipping');
      return;
    }

    // Check for too many consecutive failures (no actual files)
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      debugAudio.warn('Too many consecutive failures, stopping music attempts');
      this.isPlaying = false;
      return;
    }

    this.isLoading = true;
    debugAudio.log(`Playing track: ${track.name}`);
    this.currentTrackName = track.name;

    // Create new audio element
    const audio = new Audio(track.url);
    audio.volume = this.muted ? 0 : this.volume;
    audio.loop = false;

    // Set up track ended handler to play next
    audio.addEventListener('ended', () => {
      // Ignore events from cleaned up audio elements
      if (this.audioElementsToIgnore.has(audio)) {
        return;
      }
      this.consecutiveFailures = 0; // Reset on successful play
      this.onTrackEnded();
    });

    // Handle load errors - but don't create infinite loop
    audio.addEventListener('error', () => {
      // Ignore events from cleaned up audio elements
      if (this.audioElementsToIgnore.has(audio)) {
        return;
      }
      debugAudio.warn(`Failed to load track ${track.name}`);
      this.consecutiveFailures++;
      this.isLoading = false;

      // Only try next if we haven't hit the limit
      if (this.consecutiveFailures < this.maxConsecutiveFailures) {
        // Add delay before trying next to prevent CPU spin
        setTimeout(() => this.onTrackEnded(), 500);
      } else {
        debugAudio.warn('Max failures reached, stopping music');
        this.isPlaying = false;
      }
    });

    // Crossfade if there's a current track playing
    if (this.currentAudio && this.isPlaying) {
      // Note: isLoading will be reset in crossfade completion
      this.crossfade(this.currentAudio, audio);
    } else {
      // Just play the new track
      try {
        await audio.play();
        this.currentAudio = audio;
        this.isPlaying = true;
        this.consecutiveFailures = 0; // Reset on success
      } catch (error) {
        debugAudio.warn('Failed to play track:', error);
        this.consecutiveFailures++;
      }
      this.isLoading = false;
    }
  }

  /**
   * Crossfade between two audio elements using setInterval (NOT requestAnimationFrame)
   * This prevents interference with the game's render loop
   */
  private crossfade(from: HTMLAudioElement, to: HTMLAudioElement): void {
    // Clean up any existing crossfade first
    this.cleanupCrossfade();

    // Double-check isLoading is still true (should be, but just in case)
    if (!this.isLoading) {
      debugAudio.warn('crossfade called but isLoading is false - aborting');
      return;
    }

    const startTime = Date.now();
    const startVolume = from.volume;
    const targetVolume = this.muted ? 0 : this.volume;

    // Start new track at 0 volume
    to.volume = 0;

    // Store the fading out audio for cleanup
    this.fadingOutAudio = from;

    to.play().then(() => {
      // Use setInterval instead of requestAnimationFrame to avoid interfering with game loop
      this.crossfadeInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / this.crossfadeDuration, 1);

        // Update volumes
        if (this.fadingOutAudio) {
          this.fadingOutAudio.volume = startVolume * (1 - progress);
        }
        to.volume = targetVolume * progress;

        if (progress >= 1) {
          // Crossfade complete
          this.cleanupCrossfade();
          this.currentAudio = to;
          this.isLoading = false; // Reset loading flag now that crossfade is done
          this.consecutiveFailures = 0; // Reset on successful play
        }
      }, this.crossfadeUpdateInterval);
    }).catch((error) => {
      debugAudio.warn('Failed to start crossfade:', error);
      this.cleanupCrossfade();
      this.isLoading = false; // Reset loading flag on failure
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
      // Mark this element to be ignored so its events don't trigger actions
      this.audioElementsToIgnore.add(this.fadingOutAudio);
      this.fadingOutAudio.pause();
      this.fadingOutAudio.src = '';
      this.fadingOutAudio = null;

      // Clean up old ignored elements to prevent memory leak (keep max 10)
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
      // No more tracks, stop
      this.isPlaying = false;
    }
  }

  /**
   * Stop music playback
   */
  public stop(): void {
    this.cleanupCrossfade();
    if (this.currentAudio) {
      // Mark this element to be ignored so its events don't trigger actions
      this.audioElementsToIgnore.add(this.currentAudio);
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
    this.isPlaying = false;
    this.isLoading = false;
    this.consecutiveFailures = 0;
    this.currentTrackName = null;
    this.currentCategory = null;
    debugAudio.log('Music stopped');
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
    // Don't skip if already loading or no category
    if (this.isLoading) {
      debugAudio.log('Skip ignored: already loading');
      return;
    }

    if (!this.currentCategory) {
      debugAudio.log('Skip ignored: no current category');
      return;
    }

    // Don't skip if we've hit max failures (no files)
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      debugAudio.log('Skip ignored: max failures reached');
      return;
    }

    // Don't skip if a crossfade is in progress
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
   * Play a one-shot music track (like victory/defeat music)
   * This stops any current music and plays the specified track once
   */
  public async playOneShot(url: string, onComplete?: () => void): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Stop current music with crossfade
    this.cleanupCrossfade();

    const audio = new Audio(url);
    audio.volume = this.muted ? 0 : this.volume;
    audio.loop = false;

    // Set up completion handler
    audio.addEventListener('ended', () => {
      this.currentAudio = null;
      this.isPlaying = false;
      this.currentTrackName = null;
      onComplete?.();
    });

    // Handle load errors
    audio.addEventListener('error', (e) => {
      debugAudio.warn(`Failed to load one-shot track: ${url}`, e);
      onComplete?.();
    });

    // Crossfade if there's current music playing
    if (this.currentAudio && this.isPlaying) {
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

    // Clear category since this is a one-shot
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
  public getCurrentCategory(): MusicCategory | null {
    return this.currentCategory;
  }

  /**
   * Get available track counts
   */
  public getTrackCounts(): { menu: number; gameplay: number } {
    return {
      menu: this.menuTracks.length,
      gameplay: this.gameplayTracks.length,
    };
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    this.stop();
    this.initialized = false;
    this.tracksDiscovered = false;
    debugAudio.log('MusicPlayer disposed');
  }
}

// Export singleton
export const MusicPlayer = new MusicPlayerClass();
