import { describe, it, beforeEach, expect } from 'vitest';
import {
  generateCommandId,
  resetCommandIdCounter,
  generateLobbyCode,
} from '@/engine/network/types';

describe('Network Types - Utility Functions', () => {
  describe('generateCommandId()', () => {
    beforeEach(() => {
      resetCommandIdCounter();
    });

    it('generates unique command ids', () => {
      const id1 = generateCommandId('player1');
      const id2 = generateCommandId('player1');

      expect(id1).not.toBe(id2);
    });

    it('includes player id in command id', () => {
      const id = generateCommandId('player1');
      expect(id.startsWith('player1-')).toBe(true);
    });

    it('increments counter for each call', () => {
      const id1 = generateCommandId('p1');
      const id2 = generateCommandId('p1');
      const id3 = generateCommandId('p1');

      expect(id1).toBe('p1-1');
      expect(id2).toBe('p1-2');
      expect(id3).toBe('p1-3');
    });

    it('uses default player id when not provided', () => {
      const id = generateCommandId();
      expect(id.startsWith('local-')).toBe(true);
    });

    it('counter is shared across different player ids', () => {
      const id1 = generateCommandId('player1');
      const id2 = generateCommandId('player2');

      expect(id1).toBe('player1-1');
      expect(id2).toBe('player2-2');
    });
  });

  describe('resetCommandIdCounter()', () => {
    it('resets the counter to 0', () => {
      generateCommandId('p1');
      generateCommandId('p1');
      generateCommandId('p1');

      resetCommandIdCounter();

      const id = generateCommandId('p1');
      expect(id).toBe('p1-1');
    });
  });

  describe('generateLobbyCode()', () => {
    it('generates a 6 character code', () => {
      const code = generateLobbyCode();
      expect(code.length).toBe(6);
    });

    it('only uses allowed characters (no confusing chars)', () => {
      // Run multiple times to increase confidence
      for (let i = 0; i < 100; i++) {
        const code = generateLobbyCode();

        // Should not contain I, O, 0, 1 (the actually excluded characters)
        // Note: L is NOT excluded in this implementation
        expect(code.includes('I')).toBe(false);
        expect(code.includes('O')).toBe(false);
        expect(code.includes('0')).toBe(false);
        expect(code.includes('1')).toBe(false);

        // Should only contain allowed alphanumeric (A-Z except I,O, and 2-9)
        expect(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/.test(code)).toBe(true);
      }
    });

    it('generates different codes (probabilistic)', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 100; i++) {
        codes.add(generateLobbyCode());
      }

      // With 32^6 = ~1 billion possibilities, 100 codes should all be unique
      expect(codes.size).toBe(100);
    });
  });
});
