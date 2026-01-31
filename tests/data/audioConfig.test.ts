import { describe, it, expect } from 'vitest';
import {
  VOICE_COOLDOWN_SELECT,
  VOICE_COOLDOWN_MOVE,
  VOICE_COOLDOWN_ATTACK,
  VOICE_COOLDOWN_READY,
  COMMAND_DEBOUNCE_WINDOW,
  VOICE_COOLDOWN_CONFIG,
  COMMAND_AUDIO_CONFIG,
} from '@/data/audio.config';

describe('Audio Configuration', () => {
  describe('voiceline cooldowns', () => {
    it('defines selection cooldown', () => {
      expect(VOICE_COOLDOWN_SELECT).toBeGreaterThan(0);
      expect(typeof VOICE_COOLDOWN_SELECT).toBe('number');
    });

    it('defines move command cooldown', () => {
      expect(VOICE_COOLDOWN_MOVE).toBeGreaterThan(0);
      expect(typeof VOICE_COOLDOWN_MOVE).toBe('number');
    });

    it('defines attack command cooldown', () => {
      expect(VOICE_COOLDOWN_ATTACK).toBeGreaterThan(0);
      expect(typeof VOICE_COOLDOWN_ATTACK).toBe('number');
    });

    it('defines ready cooldown (can be zero)', () => {
      expect(VOICE_COOLDOWN_READY).toBeGreaterThanOrEqual(0);
      expect(typeof VOICE_COOLDOWN_READY).toBe('number');
    });

    it('ready cooldown is zero for immediate announcement', () => {
      expect(VOICE_COOLDOWN_READY).toBe(0);
    });

    it('command cooldowns are longer than selection', () => {
      expect(VOICE_COOLDOWN_MOVE).toBeGreaterThanOrEqual(VOICE_COOLDOWN_SELECT);
      expect(VOICE_COOLDOWN_ATTACK).toBeGreaterThanOrEqual(VOICE_COOLDOWN_SELECT);
    });

    it('move and attack cooldowns match (consistent behavior)', () => {
      expect(VOICE_COOLDOWN_MOVE).toBe(VOICE_COOLDOWN_ATTACK);
    });

    it('cooldowns are in reasonable millisecond range', () => {
      expect(VOICE_COOLDOWN_SELECT).toBeLessThan(10000);
      expect(VOICE_COOLDOWN_MOVE).toBeLessThan(10000);
      expect(VOICE_COOLDOWN_ATTACK).toBeLessThan(10000);
    });
  });

  describe('command debounce', () => {
    it('defines debounce window', () => {
      expect(COMMAND_DEBOUNCE_WINDOW).toBeGreaterThan(0);
      expect(typeof COMMAND_DEBOUNCE_WINDOW).toBe('number');
    });

    it('debounce is shorter than cooldowns', () => {
      expect(COMMAND_DEBOUNCE_WINDOW).toBeLessThan(VOICE_COOLDOWN_SELECT);
      expect(COMMAND_DEBOUNCE_WINDOW).toBeLessThan(VOICE_COOLDOWN_MOVE);
    });

    it('debounce allows rapid command grouping', () => {
      // Should be short enough to feel responsive
      expect(COMMAND_DEBOUNCE_WINDOW).toBeLessThan(500);
    });
  });

  describe('VOICE_COOLDOWN_CONFIG', () => {
    it('contains all cooldown properties', () => {
      expect(VOICE_COOLDOWN_CONFIG).toHaveProperty('select', VOICE_COOLDOWN_SELECT);
      expect(VOICE_COOLDOWN_CONFIG).toHaveProperty('move', VOICE_COOLDOWN_MOVE);
      expect(VOICE_COOLDOWN_CONFIG).toHaveProperty('attack', VOICE_COOLDOWN_ATTACK);
      expect(VOICE_COOLDOWN_CONFIG).toHaveProperty('ready', VOICE_COOLDOWN_READY);
    });

    it('values match individual constants', () => {
      expect(VOICE_COOLDOWN_CONFIG.select).toBe(VOICE_COOLDOWN_SELECT);
      expect(VOICE_COOLDOWN_CONFIG.move).toBe(VOICE_COOLDOWN_MOVE);
      expect(VOICE_COOLDOWN_CONFIG.attack).toBe(VOICE_COOLDOWN_ATTACK);
      expect(VOICE_COOLDOWN_CONFIG.ready).toBe(VOICE_COOLDOWN_READY);
    });
  });

  describe('COMMAND_AUDIO_CONFIG', () => {
    it('contains debounce window', () => {
      expect(COMMAND_AUDIO_CONFIG).toHaveProperty('debounceWindow', COMMAND_DEBOUNCE_WINDOW);
    });

    it('value matches individual constant', () => {
      expect(COMMAND_AUDIO_CONFIG.debounceWindow).toBe(COMMAND_DEBOUNCE_WINDOW);
    });
  });

  describe('RTS-style rate limiting', () => {
    it('selection cooldown prevents spam', () => {
      // 2 seconds is reasonable for selection spam prevention
      expect(VOICE_COOLDOWN_SELECT).toBeGreaterThanOrEqual(1000);
      expect(VOICE_COOLDOWN_SELECT).toBeLessThanOrEqual(5000);
    });

    it('command cooldowns prevent acknowledgement spam', () => {
      // 2-3 seconds for command acknowledgements
      expect(VOICE_COOLDOWN_MOVE).toBeGreaterThanOrEqual(1500);
      expect(VOICE_COOLDOWN_ATTACK).toBeGreaterThanOrEqual(1500);
    });

    it('unit ready has no cooldown for individual announcements', () => {
      // Each unit produced should announce itself
      expect(VOICE_COOLDOWN_READY).toBe(0);
    });
  });
});
