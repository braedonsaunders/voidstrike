import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
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

      assert.notStrictEqual(id1, id2);
    });

    it('includes player id in command id', () => {
      const id = generateCommandId('player1');
      assert.ok(id.startsWith('player1-'));
    });

    it('increments counter for each call', () => {
      const id1 = generateCommandId('p1');
      const id2 = generateCommandId('p1');
      const id3 = generateCommandId('p1');

      assert.strictEqual(id1, 'p1-1');
      assert.strictEqual(id2, 'p1-2');
      assert.strictEqual(id3, 'p1-3');
    });

    it('uses default player id when not provided', () => {
      const id = generateCommandId();
      assert.ok(id.startsWith('local-'));
    });

    it('counter is shared across different player ids', () => {
      const id1 = generateCommandId('player1');
      const id2 = generateCommandId('player2');

      assert.strictEqual(id1, 'player1-1');
      assert.strictEqual(id2, 'player2-2');
    });
  });

  describe('resetCommandIdCounter()', () => {
    it('resets the counter to 0', () => {
      generateCommandId('p1');
      generateCommandId('p1');
      generateCommandId('p1');

      resetCommandIdCounter();

      const id = generateCommandId('p1');
      assert.strictEqual(id, 'p1-1');
    });
  });

  describe('generateLobbyCode()', () => {
    it('generates a 6 character code', () => {
      const code = generateLobbyCode();
      assert.strictEqual(code.length, 6);
    });

    it('only uses allowed characters (no confusing chars)', () => {
      // Run multiple times to increase confidence
      for (let i = 0; i < 100; i++) {
        const code = generateLobbyCode();

        // Should not contain I, O, 0, 1 (the actually excluded characters)
        // Note: L is NOT excluded in this implementation
        assert.ok(!code.includes('I'), `Code ${code} contains I`);
        assert.ok(!code.includes('O'), `Code ${code} contains O`);
        assert.ok(!code.includes('0'), `Code ${code} contains 0`);
        assert.ok(!code.includes('1'), `Code ${code} contains 1`);

        // Should only contain allowed alphanumeric (A-Z except I,O, and 2-9)
        assert.ok(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/.test(code), `Code ${code} has invalid characters`);
      }
    });

    it('generates different codes (probabilistic)', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 100; i++) {
        codes.add(generateLobbyCode());
      }

      // With 32^6 = ~1 billion possibilities, 100 codes should all be unique
      assert.strictEqual(codes.size, 100);
    });
  });
});
