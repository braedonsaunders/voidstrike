'use client';

import { useEffect, useState, useCallback } from 'react';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { useUIStore } from '@/store/uiStore';
import AssetManager from '@/assets/AssetManager';

/**
 * Hook to manage music and fullscreen state for game setup page.
 * Handles hydration-safe state, music initialization, and asset preloading.
 */
export function useGameSetupMusic() {
  const [hasMounted, setHasMounted] = useState(false);

  const musicEnabledStore = useUIStore((state) => state.musicEnabled);
  const musicVolume = useUIStore((state) => state.musicVolume);
  const toggleMusic = useUIStore((state) => state.toggleMusic);
  const isFullscreenStore = useUIStore((state) => state.isFullscreen);
  const toggleFullscreen = useUIStore((state) => state.toggleFullscreen);
  const setFullscreen = useUIStore((state) => state.setFullscreen);

  // Use default values during SSR/hydration to avoid mismatch, then sync after mount
  const musicEnabled = hasMounted ? musicEnabledStore : true;
  const isFullscreen = hasMounted ? isFullscreenStore : false;

  // Mark as mounted after hydration
  useEffect(() => {
    setHasMounted(true);
  }, []);

  const handleMusicToggle = useCallback(() => {
    toggleMusic();
    const newEnabled = !musicEnabledStore;
    MusicPlayer.setMuted(!newEnabled);
    if (!newEnabled) {
      MusicPlayer.pause();
    } else {
      MusicPlayer.resume();
    }
  }, [toggleMusic, musicEnabledStore]);

  // Continue menu music (or start if navigated directly here)
  // Also start preloading 3D assets in background while player is in lobby
  // Use musicEnabledStore directly (not SSR-safe wrapper) since this only runs client-side
  useEffect(() => {
    const continueMenuMusic = async () => {
      await MusicPlayer.initialize();
      MusicPlayer.setVolume(musicVolume);
      MusicPlayer.setMuted(!musicEnabledStore);
      await MusicPlayer.discoverTracks();
      // Only start if not already playing menu music
      if (musicEnabledStore && MusicPlayer.getCurrentCategory() !== 'menu') {
        MusicPlayer.play('menu');
      }
    };

    continueMenuMusic();

    // Start preloading 3D assets in the background while player configures game
    // This significantly reduces loading time when game starts
    if (!AssetManager.isPreloadingStarted()) {
      AssetManager.startPreloading();
    }
    // Don't stop on unmount - music stops when game starts
  }, [musicEnabledStore, musicVolume]);

  // Sync volume/muted state - use store value directly since MusicPlayer only runs client-side
  useEffect(() => {
    MusicPlayer.setVolume(musicVolume);
    MusicPlayer.setMuted(!musicEnabledStore);
    // If muted, ensure music is paused (not just volume 0) - fixes reload state sync
    if (!musicEnabledStore) {
      MusicPlayer.pause();
    }
  }, [musicVolume, musicEnabledStore]);

  // Sync fullscreen state with browser
  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    setFullscreen(!!document.fullscreenElement);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [setFullscreen]);

  return {
    musicEnabled,
    isFullscreen,
    handleMusicToggle,
    toggleFullscreen,
  };
}
