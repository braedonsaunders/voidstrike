import { describe, it, beforeEach, expect } from 'vitest';
import { generateLobbyCode, commandIdGenerator } from '@/engine/network/types';

describe('Network Types - Utility Functions', () => {
  describe('commandIdGenerator.generate()', () => {
    beforeEach(() => {
      commandIdGenerator.reset();
    });

    it('generates unique command ids', () => {
      const id1 = commandIdGenerator.generate('player1');
      const id2 = commandIdGenerator.generate('player1');

      expect(id1).not.toBe(id2);
    });

    it('includes player id in command id', () => {
      const id = commandIdGenerator.generate('player1');
      expect(id.startsWith('player1-')).toBe(true);
    });

    it('increments counter for each call within same tick', () => {
      // Format: playerId-tick-sequence
      const id1 = commandIdGenerator.generate('p1');
      const id2 = commandIdGenerator.generate('p1');
      const id3 = commandIdGenerator.generate('p1');

      expect(id1).toBe('p1-0-1');
      expect(id2).toBe('p1-0-2');
      expect(id3).toBe('p1-0-3');
    });

    it('counter is per-player within same tick', () => {
      // Each player has their own sequence counter
      const id1 = commandIdGenerator.generate('player1');
      const id2 = commandIdGenerator.generate('player2');

      expect(id1).toBe('player1-0-1');
      expect(id2).toBe('player2-0-1');
    });

    it('resets sequence when tick changes', () => {
      const id1 = commandIdGenerator.generate('p1');
      expect(id1).toBe('p1-0-1');

      commandIdGenerator.setTick(1);
      const id2 = commandIdGenerator.generate('p1');
      expect(id2).toBe('p1-1-1');

      const id3 = commandIdGenerator.generate('p1');
      expect(id3).toBe('p1-1-2');
    });

  describe('commandIdGenerator.reset()', () => {
    it('resets the counter and tick to 0', () => {
      commandIdGenerator.generate('p1');
      commandIdGenerator.generate('p1');
      commandIdGenerator.setTick(5);
      commandIdGenerator.generate('p1');

      commandIdGenerator.reset();

      const id = commandIdGenerator.generate('p1');
      expect(id).toBe('p1-0-1');
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
