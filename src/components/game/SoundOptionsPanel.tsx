'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useUIStore } from '@/store/uiStore';
import { AudioManager } from '@/audio/AudioManager';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { setEdgeScrollEnabled } from '@/store/cameraStore';

/**
 * Compact and beautiful sound options panel
 * Features: Volume sliders, now playing display, playback controls
 */
export function SoundOptionsPanel() {
  const showSoundOptions = useUIStore((state) => state.showSoundOptions);
  const toggleSoundOptions = useUIStore((state) => state.toggleSoundOptions);
  const soundEnabled = useUIStore((state) => state.soundEnabled);
  const musicEnabled = useUIStore((state) => state.musicEnabled);
  const soundVolume = useUIStore((state) => state.soundVolume);
  const musicVolume = useUIStore((state) => state.musicVolume);
  const toggleSound = useUIStore((state) => state.toggleSound);
  const toggleMusic = useUIStore((state) => state.toggleMusic);
  const setSoundVolume = useUIStore((state) => state.setSoundVolume);
  const setMusicVolume = useUIStore((state) => state.setMusicVolume);

  const [currentTrack, setCurrentTrack] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const skipCooldownRef = useRef(false);

  // Disable edge scrolling when panel is open
  useEffect(() => {
    if (showSoundOptions) {
      setEdgeScrollEnabled(false);
      return () => {
        setEdgeScrollEnabled(true);
      };
    }
  }, [showSoundOptions]);

  // Update current track name periodically
  useEffect(() => {
    if (!showSoundOptions) return;

    const updateTrackInfo = () => {
      setCurrentTrack(MusicPlayer.getCurrentTrackName());
      setIsPlaying(MusicPlayer.isCurrentlyPlaying());
    };

    updateTrackInfo();
    const interval = setInterval(updateTrackInfo, 500);
    return () => clearInterval(interval);
  }, [showSoundOptions]);

  // Sync volume changes with AudioManager and MusicPlayer
  const handleSoundVolumeChange = useCallback((volume: number) => {
    setSoundVolume(volume);
    // Update all non-music categories
    AudioManager.setCategoryVolume('combat', volume);
    AudioManager.setCategoryVolume('ui', volume);
    AudioManager.setCategoryVolume('unit', volume);
    AudioManager.setCategoryVolume('building', volume);
    AudioManager.setCategoryVolume('ambient', volume);
    AudioManager.setCategoryVolume('voice', volume);
    AudioManager.setCategoryVolume('alert', volume);
  }, [setSoundVolume]);

  const handleMusicVolumeChange = useCallback((volume: number) => {
    setMusicVolume(volume);
    AudioManager.setCategoryVolume('music', volume);
    MusicPlayer.setVolume(volume);
  }, [setMusicVolume]);

  const handleSoundToggle = useCallback(() => {
    toggleSound();
    const newEnabled = !soundEnabled;
    AudioManager.setMuted(!newEnabled);
  }, [toggleSound, soundEnabled]);

  const handleMusicToggle = useCallback(() => {
    toggleMusic();
    const newEnabled = !musicEnabled;
    MusicPlayer.setMuted(!newEnabled);
    if (!newEnabled) {
      MusicPlayer.pause();
    } else {
      // Use startOrResume to handle the case where there's no current audio
      // but a category is set (e.g., when music was disabled before entering a game)
      MusicPlayer.startOrResume();
    }
  }, [toggleMusic, musicEnabled]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      MusicPlayer.pause();
    } else {
      MusicPlayer.resume();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleSkip = useCallback(() => {
    // Prevent rapid-fire skips with a cooldown
    if (skipCooldownRef.current) return;

    skipCooldownRef.current = true;
    MusicPlayer.skip();

    // Update track name after crossfade starts and reset cooldown
    setTimeout(() => {
      setCurrentTrack(MusicPlayer.getCurrentTrackName());
      skipCooldownRef.current = false;
    }, 500);
  }, []);

  if (!showSoundOptions) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: '50px',
        right: '10px',
        backgroundColor: 'rgba(10, 10, 15, 0.95)',
        border: '1px solid #3a3a4a',
        borderRadius: '10px',
        padding: '14px 16px',
        color: '#e0e0e8',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
        zIndex: 1000,
        minWidth: '260px',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
        pointerEvents: 'auto',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '14px',
        paddingBottom: '10px',
        borderBottom: '1px solid #2a2a3a'
      }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#fff' }}>
          Sound Settings
        </h3>
        <button
          onClick={toggleSoundOptions}
          style={{
            background: 'none',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '2px 6px',
            borderRadius: '4px',
            transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
        >
          x
        </button>
      </div>

      {/* Now Playing Section */}
      <div style={{
        backgroundColor: 'rgba(40, 40, 60, 0.5)',
        borderRadius: '8px',
        padding: '10px 12px',
        marginBottom: '14px',
      }}>
        <div style={{
          fontSize: '10px',
          color: '#888',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '6px'
        }}>
          Now Playing
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
        }}>
          <div style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '13px',
            color: currentTrack ? '#fff' : '#666',
            fontWeight: 500,
          }}>
            {currentTrack || 'No music playing'}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {/* Play/Pause Button */}
            <button
              onClick={handlePlayPause}
              disabled={!currentTrack && !isPlaying}
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: musicEnabled ? '#4a6fa5' : '#444',
                color: '#fff',
                cursor: musicEnabled ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                transition: 'background-color 0.2s, transform 0.1s',
                opacity: musicEnabled ? 1 : 0.5,
              }}
              onMouseEnter={(e) => musicEnabled && (e.currentTarget.style.backgroundColor = '#5a7fb5')}
              onMouseLeave={(e) => musicEnabled && (e.currentTarget.style.backgroundColor = '#4a6fa5')}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? '||' : '\u25B6'}
            </button>
            {/* Skip Button */}
            <button
              onClick={handleSkip}
              disabled={!musicEnabled}
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: musicEnabled ? '#3a4a5a' : '#333',
                color: '#fff',
                cursor: musicEnabled ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
                transition: 'background-color 0.2s',
                opacity: musicEnabled ? 1 : 0.5,
              }}
              onMouseEnter={(e) => musicEnabled && (e.currentTarget.style.backgroundColor = '#4a5a6a')}
              onMouseLeave={(e) => musicEnabled && (e.currentTarget.style.backgroundColor = '#3a4a5a')}
              title="Skip"
            >
              {'\u25B6\u25B6'}
            </button>
          </div>
        </div>
      </div>

      {/* Music Volume */}
      <div style={{ marginBottom: '14px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '6px'
        }}>
          <span style={{ fontSize: '12px', color: '#aaa' }}>Music</span>
          <button
            onClick={handleMusicToggle}
            style={{
              padding: '3px 10px',
              backgroundColor: musicEnabled ? 'rgba(80, 160, 80, 0.3)' : 'rgba(160, 80, 80, 0.3)',
              border: `1px solid ${musicEnabled ? '#4a8a4a' : '#8a4a4a'}`,
              borderRadius: '4px',
              color: musicEnabled ? '#8fc88f' : '#c88f8f',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: 500,
              transition: 'all 0.2s',
            }}
          >
            {musicEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={musicVolume}
            onChange={(e) => handleMusicVolumeChange(parseFloat(e.target.value))}
            disabled={!musicEnabled}
            style={{
              flex: 1,
              height: '4px',
              appearance: 'none',
              backgroundColor: '#2a2a3a',
              borderRadius: '2px',
              cursor: musicEnabled ? 'pointer' : 'not-allowed',
              opacity: musicEnabled ? 1 : 0.5,
            }}
          />
          <span style={{
            fontSize: '11px',
            color: '#888',
            minWidth: '35px',
            textAlign: 'right'
          }}>
            {Math.round(musicVolume * 100)}%
          </span>
        </div>
      </div>

      {/* SFX Volume */}
      <div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '6px'
        }}>
          <span style={{ fontSize: '12px', color: '#aaa' }}>Sound Effects</span>
          <button
            onClick={handleSoundToggle}
            style={{
              padding: '3px 10px',
              backgroundColor: soundEnabled ? 'rgba(80, 160, 80, 0.3)' : 'rgba(160, 80, 80, 0.3)',
              border: `1px solid ${soundEnabled ? '#4a8a4a' : '#8a4a4a'}`,
              borderRadius: '4px',
              color: soundEnabled ? '#8fc88f' : '#c88f8f',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: 500,
              transition: 'all 0.2s',
            }}
          >
            {soundEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={soundVolume}
            onChange={(e) => handleSoundVolumeChange(parseFloat(e.target.value))}
            disabled={!soundEnabled}
            style={{
              flex: 1,
              height: '4px',
              appearance: 'none',
              backgroundColor: '#2a2a3a',
              borderRadius: '2px',
              cursor: soundEnabled ? 'pointer' : 'not-allowed',
              opacity: soundEnabled ? 1 : 0.5,
            }}
          />
          <span style={{
            fontSize: '11px',
            color: '#888',
            minWidth: '35px',
            textAlign: 'right'
          }}>
            {Math.round(soundVolume * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
