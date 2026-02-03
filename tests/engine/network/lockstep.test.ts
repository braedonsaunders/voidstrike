/**
 * Lockstep System Integration Tests
 *
 * Tests the deterministic lockstep synchronization mechanism for multiplayer games:
 * - Command queuing for future ticks
 * - Lockstep barrier waiting for all players
 * - Tick advancement only when all commands received
 * - Timeout handling for missing commands
 * - Command ordering (deterministic sort by playerId, type, entityIds)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CommandQueue, type GameCommand } from '@/engine/core/GameCommand';

// Helper to create test commands
function createCommand(overrides: Partial<GameCommand> = {}): GameCommand {
  return {
    tick: 100,
    playerId: 'player1',
    type: 'MOVE',
    entityIds: [1],
    targetPosition: { x: 10, y: 20 },
    ...overrides,
  };
}

describe('Lockstep System', () => {
  describe('CommandQueue', () => {
    let queue: CommandQueue;

    beforeEach(() => {
      queue = new CommandQueue({ commandDelayTicks: 4 });
    });

    describe('Command queuing for future ticks', () => {
      it('enqueues commands for their specified tick', () => {
        const cmd = createCommand({ tick: 105 });
        queue.enqueue(cmd);

        const commands = queue.getCommandsForTick(105);
        expect(commands).toHaveLength(1);
        expect(commands[0]).toBe(cmd);
      });

      it('queues multiple commands for the same tick', () => {
        const cmd1 = createCommand({ tick: 100, playerId: 'player1' });
        const cmd2 = createCommand({ tick: 100, playerId: 'player2' });
        const cmd3 = createCommand({ tick: 100, playerId: 'player1', type: 'ATTACK' });

        queue.enqueue(cmd1);
        queue.enqueue(cmd2);
        queue.enqueue(cmd3);

        const commands = queue.getCommandsForTick(100);
        expect(commands).toHaveLength(3);
      });

      it('returns empty array for tick with no commands', () => {
        const commands = queue.getCommandsForTick(999);
        expect(commands).toEqual([]);
      });

      it('calculates execution tick using command delay', () => {
        const currentTick = 50;
        const executionTick = queue.getExecutionTick(currentTick);
        expect(executionTick).toBe(54); // 50 + 4 delay ticks
      });

      it('separates commands by tick', () => {
        const cmd1 = createCommand({ tick: 100 });
        const cmd2 = createCommand({ tick: 101 });
        const cmd3 = createCommand({ tick: 100 });

        queue.enqueue(cmd1);
        queue.enqueue(cmd2);
        queue.enqueue(cmd3);

        expect(queue.getCommandsForTick(100)).toHaveLength(2);
        expect(queue.getCommandsForTick(101)).toHaveLength(1);
      });
    });

    describe('Command ordering (deterministic sort)', () => {
      it('sorts commands by playerId first', () => {
        const cmdB = createCommand({ tick: 100, playerId: 'player2' });
        const cmdA = createCommand({ tick: 100, playerId: 'player1' });
        const cmdC = createCommand({ tick: 100, playerId: 'player3' });

        queue.enqueue(cmdB);
        queue.enqueue(cmdC);
        queue.enqueue(cmdA);

        const commands = queue.getCommandsForTick(100);
        expect(commands[0].playerId).toBe('player1');
        expect(commands[1].playerId).toBe('player2');
        expect(commands[2].playerId).toBe('player3');
      });

      it('sorts by type when playerIds match', () => {
        const cmdAttack = createCommand({ tick: 100, playerId: 'player1', type: 'ATTACK' });
        const cmdMove = createCommand({ tick: 100, playerId: 'player1', type: 'MOVE' });
        const cmdBuild = createCommand({ tick: 100, playerId: 'player1', type: 'BUILD' });

        queue.enqueue(cmdMove);
        queue.enqueue(cmdAttack);
        queue.enqueue(cmdBuild);

        const commands = queue.getCommandsForTick(100);
        // Sorted alphabetically: ATTACK, BUILD, MOVE
        expect(commands[0].type).toBe('ATTACK');
        expect(commands[1].type).toBe('BUILD');
        expect(commands[2].type).toBe('MOVE');
      });

      it('sorts by entityIds when playerId and type match', () => {
        const cmd1 = createCommand({
          tick: 100,
          playerId: 'player1',
          type: 'MOVE',
          entityIds: [10],
        });
        const cmd2 = createCommand({
          tick: 100,
          playerId: 'player1',
          type: 'MOVE',
          entityIds: [5],
        });
        const cmd3 = createCommand({
          tick: 100,
          playerId: 'player1',
          type: 'MOVE',
          entityIds: [15],
        });

        queue.enqueue(cmd1);
        queue.enqueue(cmd3);
        queue.enqueue(cmd2);

        const commands = queue.getCommandsForTick(100);
        expect(commands[0].entityIds[0]).toBe(5);
        expect(commands[1].entityIds[0]).toBe(10);
        expect(commands[2].entityIds[0]).toBe(15);
      });

      it('handles empty entityIds array gracefully', () => {
        const cmd1 = createCommand({
          tick: 100,
          playerId: 'player1',
          type: 'BUILD',
          entityIds: [],
        });
        const cmd2 = createCommand({
          tick: 100,
          playerId: 'player1',
          type: 'BUILD',
          entityIds: [5],
        });

        queue.enqueue(cmd1);
        queue.enqueue(cmd2);

        const commands = queue.getCommandsForTick(100);
        // Empty array should sort before non-empty (0 < 5)
        expect(commands[0].entityIds).toEqual([]);
        expect(commands[1].entityIds[0]).toBe(5);
      });

      it('produces consistent ordering across multiple calls', () => {
        const cmds = [
          createCommand({ tick: 100, playerId: 'player2', type: 'MOVE', entityIds: [1] }),
          createCommand({ tick: 100, playerId: 'player1', type: 'ATTACK', entityIds: [3] }),
          createCommand({ tick: 100, playerId: 'player1', type: 'MOVE', entityIds: [2] }),
          createCommand({ tick: 100, playerId: 'player2', type: 'ATTACK', entityIds: [1] }),
        ];

        cmds.forEach((cmd) => queue.enqueue(cmd));

        // Get commands multiple times to verify determinism
        const result1 = queue
          .getCommandsForTick(100)
          .map((c) => `${c.playerId}-${c.type}-${c.entityIds[0]}`);
        const result2 = queue
          .getCommandsForTick(100)
          .map((c) => `${c.playerId}-${c.type}-${c.entityIds[0]}`);

        expect(result1).toEqual(result2);
        expect(result1).toEqual([
          'player1-ATTACK-3',
          'player1-MOVE-2',
          'player2-ATTACK-1',
          'player2-MOVE-1',
        ]);
      });
    });

    describe('Tick management', () => {
      it('clears commands after processing a tick', () => {
        const cmd = createCommand({ tick: 100 });
        queue.enqueue(cmd);

        expect(queue.getCommandsForTick(100)).toHaveLength(1);

        queue.clearTick(100);

        expect(queue.getCommandsForTick(100)).toHaveLength(0);
      });

      it('identifies stale ticks', () => {
        queue.enqueue(createCommand({ tick: 95 }));
        queue.enqueue(createCommand({ tick: 97 }));
        queue.enqueue(createCommand({ tick: 100 }));
        queue.enqueue(createCommand({ tick: 105 }));

        const staleTicks = queue.getStaleTicks(100);

        expect(staleTicks).toContain(95);
        expect(staleTicks).toContain(97);
        expect(staleTicks).not.toContain(100);
        expect(staleTicks).not.toContain(105);
      });

      it('clears all commands', () => {
        queue.enqueue(createCommand({ tick: 100 }));
        queue.enqueue(createCommand({ tick: 101 }));
        queue.enqueue(createCommand({ tick: 102 }));

        expect(queue.size).toBe(3);

        queue.clear();

        expect(queue.size).toBe(0);
        expect(queue.getCommandsForTick(100)).toEqual([]);
        expect(queue.getCommandsForTick(101)).toEqual([]);
        expect(queue.getCommandsForTick(102)).toEqual([]);
      });

      it('reports queue size correctly', () => {
        expect(queue.size).toBe(0);

        queue.enqueue(createCommand({ tick: 100 }));
        expect(queue.size).toBe(1);

        queue.enqueue(createCommand({ tick: 100 })); // Same tick
        expect(queue.size).toBe(1); // Still 1 tick

        queue.enqueue(createCommand({ tick: 101 })); // New tick
        expect(queue.size).toBe(2);
      });
    });
  });

  describe('Lockstep Barrier Simulation', () => {
    // Simulates the lockstep barrier behavior from Game.ts
    interface LockstepState {
      currentTick: number;
      tickCommandReceipts: Map<number, Set<string>>;
      expectedPlayers: string[];
    }

    function createLockstepState(players: string[]): LockstepState {
      return {
        currentTick: 0,
        tickCommandReceipts: new Map(),
        expectedPlayers: players,
      };
    }

    function recordReceipt(state: LockstepState, tick: number, playerId: string): void {
      if (!state.tickCommandReceipts.has(tick)) {
        state.tickCommandReceipts.set(tick, new Set());
      }
      state.tickCommandReceipts.get(tick)!.add(playerId);
    }

    function hasAllCommandsForTick(state: LockstepState, tick: number): boolean {
      const receipts = state.tickCommandReceipts.get(tick);
      if (!receipts) return false;

      for (const playerId of state.expectedPlayers) {
        if (!receipts.has(playerId)) {
          return false;
        }
      }
      return true;
    }

    it('waits for all players before advancing tick', () => {
      const state = createLockstepState(['player1', 'player2']);

      // Only player1 sends command for tick 1
      recordReceipt(state, 1, 'player1');
      expect(hasAllCommandsForTick(state, 1)).toBe(false);

      // Player2 sends command for tick 1
      recordReceipt(state, 1, 'player2');
      expect(hasAllCommandsForTick(state, 1)).toBe(true);
    });

    it('tracks receipts per-tick independently', () => {
      const state = createLockstepState(['player1', 'player2']);

      // Complete tick 1
      recordReceipt(state, 1, 'player1');
      recordReceipt(state, 1, 'player2');
      expect(hasAllCommandsForTick(state, 1)).toBe(true);

      // Tick 2 is not yet complete
      recordReceipt(state, 2, 'player1');
      expect(hasAllCommandsForTick(state, 2)).toBe(false);
    });

    it('handles 8-player games', () => {
      const players = [
        'player1',
        'player2',
        'player3',
        'player4',
        'player5',
        'player6',
        'player7',
        'player8',
      ];
      const state = createLockstepState(players);

      // First 7 players send commands
      for (let i = 0; i < 7; i++) {
        recordReceipt(state, 1, players[i]);
        expect(hasAllCommandsForTick(state, 1)).toBe(false);
      }

      // Last player sends command
      recordReceipt(state, 1, 'player8');
      expect(hasAllCommandsForTick(state, 1)).toBe(true);
    });

    it('allows multiple commands from same player for same tick', () => {
      const state = createLockstepState(['player1', 'player2']);

      // Player1 sends multiple commands (only counts as one receipt)
      recordReceipt(state, 1, 'player1');
      recordReceipt(state, 1, 'player1');
      recordReceipt(state, 1, 'player1');

      expect(hasAllCommandsForTick(state, 1)).toBe(false); // Still waiting for player2
    });
  });

  describe('Lockstep Timeout Simulation', () => {
    let state: {
      tickWaitStart: Map<number, number>;
      currentTick: number;
    };

    const TIMEOUT_TICKS = 10;

    beforeEach(() => {
      vi.useFakeTimers();
      state = {
        tickWaitStart: new Map(),
        currentTick: 0,
      };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function startWaitingForTick(tick: number): void {
      if (!state.tickWaitStart.has(tick)) {
        state.tickWaitStart.set(tick, state.currentTick);
      }
    }

    function hasTimedOut(tick: number): boolean {
      const waitStart = state.tickWaitStart.get(tick);
      if (waitStart === undefined) return false;
      return state.currentTick - waitStart >= TIMEOUT_TICKS;
    }

    it('tracks when waiting started for a tick', () => {
      state.currentTick = 50;
      startWaitingForTick(51);

      expect(state.tickWaitStart.get(51)).toBe(50);
    });

    it('does not overwrite wait start time on subsequent calls', () => {
      state.currentTick = 50;
      startWaitingForTick(51);

      state.currentTick = 55;
      startWaitingForTick(51); // Called again

      expect(state.tickWaitStart.get(51)).toBe(50); // Still 50, not 55
    });

    it('detects timeout after configured ticks', () => {
      state.currentTick = 50;
      startWaitingForTick(51);
      expect(hasTimedOut(51)).toBe(false);

      // Advance 9 ticks (not yet timeout)
      state.currentTick = 59;
      expect(hasTimedOut(51)).toBe(false);

      // Advance to 10 ticks (timeout)
      state.currentTick = 60;
      expect(hasTimedOut(51)).toBe(true);
    });

    it('returns false for ticks not being waited for', () => {
      expect(hasTimedOut(999)).toBe(false);
    });
  });

  describe('Heartbeat Commands', () => {
    let queue: CommandQueue;
    let sentCommandForTick: Set<number>;

    beforeEach(() => {
      queue = new CommandQueue({ commandDelayTicks: 4 });
      sentCommandForTick = new Set();
    });

    function sendHeartbeatForTick(tick: number, playerId: string): GameCommand | null {
      if (sentCommandForTick.has(tick)) {
        return null; // Already sent a command for this tick
      }

      const heartbeat: GameCommand = {
        tick,
        playerId,
        type: 'HEARTBEAT',
        entityIds: [],
      };

      queue.enqueue(heartbeat);
      sentCommandForTick.add(tick);
      return heartbeat;
    }

    it('creates heartbeat command for tick with no other commands', () => {
      const heartbeat = sendHeartbeatForTick(100, 'player1');

      expect(heartbeat).not.toBeNull();
      expect(heartbeat!.type).toBe('HEARTBEAT');
      expect(heartbeat!.tick).toBe(100);
      expect(heartbeat!.playerId).toBe('player1');
      expect(heartbeat!.entityIds).toEqual([]);
    });

    it('does not send duplicate heartbeats for same tick', () => {
      const first = sendHeartbeatForTick(100, 'player1');
      const second = sendHeartbeatForTick(100, 'player1');

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('sends heartbeats for different ticks', () => {
      const hb1 = sendHeartbeatForTick(100, 'player1');
      const hb2 = sendHeartbeatForTick(101, 'player1');
      const hb3 = sendHeartbeatForTick(102, 'player1');

      expect(hb1).not.toBeNull();
      expect(hb2).not.toBeNull();
      expect(hb3).not.toBeNull();

      expect(queue.getCommandsForTick(100)).toHaveLength(1);
      expect(queue.getCommandsForTick(101)).toHaveLength(1);
      expect(queue.getCommandsForTick(102)).toHaveLength(1);
    });

    it('heartbeat sorts correctly among other commands', () => {
      // Heartbeat has type 'HEARTBEAT' which sorts after 'ATTACK' but before 'MOVE'
      queue.enqueue(createCommand({ tick: 100, playerId: 'player1', type: 'MOVE' }));
      queue.enqueue(
        createCommand({ tick: 100, playerId: 'player1', type: 'HEARTBEAT', entityIds: [] })
      );
      queue.enqueue(createCommand({ tick: 100, playerId: 'player1', type: 'ATTACK' }));

      const commands = queue.getCommandsForTick(100);
      expect(commands[0].type).toBe('ATTACK');
      expect(commands[1].type).toBe('HEARTBEAT');
      expect(commands[2].type).toBe('MOVE');
    });
  });

  describe('Command Delay Window', () => {
    it('ensures commands are scheduled for future ticks', () => {
      const queue = new CommandQueue({ commandDelayTicks: 4 });
      const currentTick = 100;

      const executionTick = queue.getExecutionTick(currentTick);

      expect(executionTick).toBeGreaterThan(currentTick);
      expect(executionTick).toBe(104);
    });

    it('works with different delay values', () => {
      const queue2 = new CommandQueue({ commandDelayTicks: 2 });
      const queue6 = new CommandQueue({ commandDelayTicks: 6 });
      const queue10 = new CommandQueue({ commandDelayTicks: 10 });

      const currentTick = 100;

      expect(queue2.getExecutionTick(currentTick)).toBe(102);
      expect(queue6.getExecutionTick(currentTick)).toBe(106);
      expect(queue10.getExecutionTick(currentTick)).toBe(110);
    });
  });

  describe('Multi-Player Command Integration', () => {
    let queue: CommandQueue;

    beforeEach(() => {
      queue = new CommandQueue({ commandDelayTicks: 4 });
    });

    it('handles interleaved commands from multiple players', () => {
      // Simulate real-world scenario: commands arrive out of order
      const commands = [
        createCommand({ tick: 100, playerId: 'player2', type: 'ATTACK', entityIds: [5] }),
        createCommand({ tick: 100, playerId: 'player1', type: 'MOVE', entityIds: [1] }),
        createCommand({ tick: 101, playerId: 'player1', type: 'BUILD', entityIds: [] }),
        createCommand({ tick: 100, playerId: 'player3', type: 'TRAIN', entityIds: [10] }),
        createCommand({ tick: 101, playerId: 'player2', type: 'HEARTBEAT', entityIds: [] }),
        createCommand({ tick: 100, playerId: 'player1', type: 'ATTACK', entityIds: [2] }),
      ];

      commands.forEach((cmd) => queue.enqueue(cmd));

      // Tick 100 commands sorted deterministically
      const tick100 = queue.getCommandsForTick(100);
      expect(tick100).toHaveLength(4);
      expect(tick100.map((c) => `${c.playerId}-${c.type}`)).toEqual([
        'player1-ATTACK',
        'player1-MOVE',
        'player2-ATTACK',
        'player3-TRAIN',
      ]);

      // Tick 101 commands sorted deterministically
      const tick101 = queue.getCommandsForTick(101);
      expect(tick101).toHaveLength(2);
      expect(tick101.map((c) => `${c.playerId}-${c.type}`)).toEqual([
        'player1-BUILD',
        'player2-HEARTBEAT',
      ]);
    });

    it('processes ticks in order after clearing', () => {
      queue.enqueue(createCommand({ tick: 100, playerId: 'player1' }));
      queue.enqueue(createCommand({ tick: 101, playerId: 'player1' }));
      queue.enqueue(createCommand({ tick: 102, playerId: 'player1' }));

      // Process tick 100
      const cmds100 = queue.getCommandsForTick(100);
      expect(cmds100).toHaveLength(1);
      queue.clearTick(100);

      // Process tick 101
      const cmds101 = queue.getCommandsForTick(101);
      expect(cmds101).toHaveLength(1);
      queue.clearTick(101);

      // Process tick 102
      const cmds102 = queue.getCommandsForTick(102);
      expect(cmds102).toHaveLength(1);
      queue.clearTick(102);

      expect(queue.size).toBe(0);
    });
  });
});
