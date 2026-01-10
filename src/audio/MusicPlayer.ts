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
 * - Supports crossfading between tracks
 * - Integrates with AudioManager volume system
 */
class MusicPlayerClass {
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private nextAudio: HTMLAudioElement | null = null;

  private menuTracks: MusicTrack[] = [];
  private gameplayTracks: MusicTrack[] = [];
  private shuffledQueue: MusicTrack[] = [];
  private currentCategory: MusicCategory | null = null;
  private currentTrackIndex = 0;

  private volume = 0.5;
  private muted = false;
  private isPlaying = false;
  private initialized = false;
  private tracksDiscovered = false;
  private currentTrackName: string | null = null;

  private crossfadeDuration = 2000; // 2 seconds crossfade

  /**
   * Initialize the music player
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
      this.gainNode.gain.value = this.volume;

      this.initialized = true;
      debugAudio.log('MusicPlayer initialized');
    } catch (error) {
      debugAudio.warn('Failed to initialize MusicPlayer:', error);
    }
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
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.tracksDiscovered) {
      await this.discoverTracks();
    }

    // Resume audio context if suspended
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }

    // If switching categories, prepare new queue
    if (category !== this.currentCategory) {
      this.prepareCategoryQueue(category);
    }

    // Get next track
    const track = this.getNextTrack();
    if (!track) {
      debugAudio.warn(`No ${category} music tracks available`);
      return;
    }

    await this.playTrack(track);
  }

  /**
   * Play a specific track
   */
  private async playTrack(track: MusicTrack): Promise<void> {
    debugAudio.log(`Playing track: ${track.name}`);
    this.currentTrackName = track.name;

    // Create new audio element
    const audio = new Audio(track.url);
    audio.volume = this.muted ? 0 : this.volume;
    audio.loop = false;

    // Set up track ended handler to play next
    audio.addEventListener('ended', () => {
      this.onTrackEnded();
    });

    // Handle load errors
    audio.addEventListener('error', (e) => {
      debugAudio.warn(`Failed to load track ${track.name}:`, e);
      // Try next track
      this.onTrackEnded();
    });

    // Crossfade if there's a current track playing
    if (this.currentAudio && this.isPlaying) {
      await this.crossfade(this.currentAudio, audio);
    } else {
      // Just play the new track
      try {
        await audio.play();
        this.currentAudio = audio;
        this.isPlaying = true;
      } catch (error) {
        debugAudio.warn('Failed to play track:', error);
      }
    }
  }

  /**
   * Crossfade between two audio elements
   */
  private async crossfade(from: HTMLAudioElement, to: HTMLAudioElement): Promise<void> {
    const startTime = Date.now();
    const startVolume = from.volume;
    const targetVolume = this.muted ? 0 : this.volume;

    // Start new track at 0 volume
    to.volume = 0;

    try {
      await to.play();
    } catch (error) {
      debugAudio.warn('Failed to start crossfade:', error);
      return;
    }

    // Animate crossfade
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / this.crossfadeDuration, 1);

      from.volume = startVolume * (1 - progress);
      to.volume = targetVolume * progress;

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Crossfade complete
        from.pause();
        from.src = '';
        this.currentAudio = to;
      }
    };

    requestAnimationFrame(animate);
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
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
    if (this.nextAudio) {
      this.nextAudio.pause();
      this.nextAudio.src = '';
      this.nextAudio = null;
    }
    this.isPlaying = false;
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
    if (this.currentCategory) {
      const track = this.getNextTrack();
      if (track) {
        this.playTrack(track);
      }
    }
  }

  /**
   * Set music volume (0-1)
   */
  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.currentAudio && !this.muted) {
      this.currentAudio.volume = this.volume;
    }
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
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
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.gainNode = null;
    this.initialized = false;
    this.tracksDiscovered = false;
    debugAudio.log('MusicPlayer disposed');
  }
}

// Export singleton
export const MusicPlayer = new MusicPlayerClass();
