/**
 * Command Synchronization Tests
 *
 * Tests the command serialization/deserialization for multiplayer networking:
 * - Command serialization/deserialization roundtrip
 * - All GameCommand fields preserved through JSON encode/decode
 * - Command validation (playerId, tick range)
 * - Entity ownership validation
 * - Heartbeat command handling
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { GameCommand, GameCommandType } from '@/engine/core/GameCommand';
import type { GameMessage, InputMessageData, SyncResponseData } from '@/engine/network/types';

// Helper to create test commands with all possible fields
function createFullCommand(overrides: Partial<GameCommand> = {}): GameCommand {
  return {
    tick: 100,
    playerId: 'player1',
    type: 'MOVE',
    entityIds: [1, 2, 3],
    targetPosition: { x: 100.5, y: 200.75 },
    targetEntityId: 42,
    buildingType: 'barracks',
    unitType: 'marine',
    abilityId: 'stim',
    upgradeId: 'weapon-1',
    targetMode: 'siege',
    transportId: 50,
    bunkerId: 60,
    buildingId: 70,
    queueIndex: 2,
    newQueueIndex: 0,
    autocastEnabled: true,
    wallSegments: [
      { x: 10, y: 20 },
      { x: 11, y: 20 },
    ],
    queue: true,
    ...overrides,
  };
}

// Helper to simulate network serialization
function serializeForNetwork(data: unknown): string {
  return JSON.stringify(data);
}

function deserializeFromNetwork<T>(json: string): T {
  return JSON.parse(json) as T;
}

describe('Command Synchronization', () => {
  describe('Command Serialization/Deserialization Roundtrip', () => {
    it('preserves all GameCommand fields through JSON roundtrip', () => {
      const original = createFullCommand();

      const serialized = serializeForNetwork(original);
      const deserialized = deserializeFromNetwork<GameCommand>(serialized);

      expect(deserialized).toEqual(original);
    });

    it('preserves basic command fields', () => {
      const original: GameCommand = {
        tick: 500,
        playerId: 'player-abc-123',
        type: 'ATTACK',
        entityIds: [10, 20, 30],
      };

      const serialized = serializeForNetwork(original);
      const deserialized = deserializeFromNetwork<GameCommand>(serialized);

      expect(deserialized.tick).toBe(500);
      expect(deserialized.playerId).toBe('player-abc-123');
      expect(deserialized.type).toBe('ATTACK');
      expect(deserialized.entityIds).toEqual([10, 20, 30]);
    });

    it('preserves targetPosition with floating point precision', () => {
      const original: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: [1],
        targetPosition: { x: 123.456789, y: 987.654321 },
      };

      const serialized = serializeForNetwork(original);
      const deserialized = deserializeFromNetwork<GameCommand>(serialized);

      expect(deserialized.targetPosition).toEqual(original.targetPosition);
    });

    it('preserves optional fields when present', () => {
      const original: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'BUILD',
        entityIds: [1],
        buildingType: 'factory',
        targetPosition: { x: 50, y: 50 },
      };

      const serialized = serializeForNetwork(original);
      const deserialized = deserializeFromNetwork<GameCommand>(serialized);

      expect(deserialized.buildingType).toBe('factory');
      expect(deserialized.targetPosition).toEqual({ x: 50, y: 50 });
    });

    it('preserves undefined fields as absent (not null)', () => {
      const original: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'STOP',
        entityIds: [1],
        // targetPosition is undefined
      };

      const serialized = serializeForNetwork(original);
      const deserialized = deserializeFromNetwork<GameCommand>(serialized);

      expect(deserialized.targetPosition).toBeUndefined();
      expect('targetPosition' in deserialized).toBe(false);
    });

    it('preserves wallSegments array', () => {
      const original: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'BUILD_WALL',
        entityIds: [],
        wallSegments: [
          { x: 10, y: 20 },
          { x: 11, y: 20 },
          { x: 12, y: 20 },
          { x: 13, y: 20 },
        ],
      };

      const serialized = serializeForNetwork(original);
      const deserialized = deserializeFromNetwork<GameCommand>(serialized);

      expect(deserialized.wallSegments).toHaveLength(4);
      expect(deserialized.wallSegments).toEqual(original.wallSegments);
    });

    it('preserves boolean fields', () => {
      const originalTrue: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'SET_AUTOCAST',
        entityIds: [1],
        abilityId: 'heal',
        autocastEnabled: true,
      };

      const originalFalse: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'SET_AUTOCAST',
        entityIds: [1],
        abilityId: 'heal',
        autocastEnabled: false,
      };

      const deserializedTrue = deserializeFromNetwork<GameCommand>(
        serializeForNetwork(originalTrue)
      );
      const deserializedFalse = deserializeFromNetwork<GameCommand>(
        serializeForNetwork(originalFalse)
      );

      expect(deserializedTrue.autocastEnabled).toBe(true);
      expect(deserializedFalse.autocastEnabled).toBe(false);
    });

    it('preserves queue modifier flag', () => {
      const withQueue: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: [1],
        queue: true,
      };

      const withoutQueue: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: [1],
        queue: false,
      };

      expect(deserializeFromNetwork<GameCommand>(serializeForNetwork(withQueue)).queue).toBe(true);
      expect(deserializeFromNetwork<GameCommand>(serializeForNetwork(withoutQueue)).queue).toBe(
        false
      );
    });
  });

  describe('All Command Types Serialization', () => {
    const commandTypes: GameCommandType[] = [
      'MOVE',
      'ATTACK',
      'ATTACK_MOVE',
      'BUILD',
      'TRAIN',
      'ABILITY',
      'STOP',
      'HOLD',
      'RESEARCH',
      'TRANSFORM',
      'CLOAK',
      'LOAD',
      'UNLOAD',
      'LOAD_BUNKER',
      'UNLOAD_BUNKER',
      'HEAL',
      'REPAIR',
      'PATROL',
      'DEMOLISH',
      'LIFTOFF',
      'LAND',
      'RALLY',
      'GATHER',
      'CANCEL_PRODUCTION',
      'CANCEL_RESEARCH',
      'CANCEL_BUILDING',
      'QUEUE_REORDER',
      'SUPPLY_DEPOT_LOWER',
      'SUPPLY_DEPOT_RAISE',
      'SET_AUTOCAST',
      'BUILD_WALL',
      'ADDON_LIFT',
      'ADDON_LAND',
      'SUBMERGE',
      'HEARTBEAT',
    ];

    it.each(commandTypes)('serializes %s command type correctly', (commandType) => {
      const original: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: commandType,
        entityIds: [1],
      };

      const serialized = serializeForNetwork(original);
      const deserialized = deserializeFromNetwork<GameCommand>(serialized);

      expect(deserialized.type).toBe(commandType);
    });
  });

  describe('GameMessage Serialization', () => {
    it('serializes input message with commands', () => {
      const commands: GameCommand[] = [
        {
          tick: 100,
          playerId: 'player1',
          type: 'MOVE',
          entityIds: [1],
          targetPosition: { x: 10, y: 20 },
        },
        { tick: 100, playerId: 'player1', type: 'ATTACK', entityIds: [2], targetEntityId: 50 },
      ];

      const message: GameMessage = {
        type: 'input',
        tick: 100,
        senderId: 'player1',
        data: { commands } as InputMessageData,
        timestamp: Date.now(),
        sequence: 1,
      };

      const serialized = serializeForNetwork(message);
      const deserialized = deserializeFromNetwork<GameMessage>(serialized);

      expect(deserialized.type).toBe('input');
      expect(deserialized.tick).toBe(100);
      expect(deserialized.senderId).toBe('player1');

      const inputData = deserialized.data as InputMessageData;
      expect(inputData.commands).toHaveLength(2);
      expect(inputData.commands[0].type).toBe('MOVE');
      expect(inputData.commands[1].type).toBe('ATTACK');
    });

    it('serializes sync-response with command history', () => {
      const syncData: SyncResponseData = {
        currentTick: 200,
        commands: [
          {
            tick: 195,
            commands: [{ tick: 195, playerId: 'player1', type: 'MOVE', entityIds: [1] }],
          },
          {
            tick: 196,
            commands: [
              { tick: 196, playerId: 'player1', type: 'HEARTBEAT', entityIds: [] },
              { tick: 196, playerId: 'player2', type: 'ATTACK', entityIds: [5] },
            ],
          },
        ],
      };

      const message: GameMessage = {
        type: 'sync-response',
        tick: 200,
        senderId: 'player1',
        data: syncData,
        timestamp: Date.now(),
        sequence: 5,
      };

      const serialized = serializeForNetwork(message);
      const deserialized = deserializeFromNetwork<GameMessage>(serialized);

      const data = deserialized.data as SyncResponseData;
      expect(data.currentTick).toBe(200);
      expect(data.commands).toHaveLength(2);
      expect(data.commands[0].tick).toBe(195);
      expect(data.commands[1].commands).toHaveLength(2);
    });
  });

  describe('Command Validation', () => {
    interface ValidationResult {
      valid: boolean;
      error?: string;
    }

    function validateCommand(
      command: GameCommand,
      currentTick: number,
      validPlayerIds: string[],
      maxTickFuture: number = 100
    ): ValidationResult {
      // Validate playerId
      if (!command.playerId || command.playerId.trim() === '') {
        return { valid: false, error: 'Missing playerId' };
      }

      if (!validPlayerIds.includes(command.playerId)) {
        return { valid: false, error: `Invalid playerId: ${command.playerId}` };
      }

      // Validate tick range
      if (command.tick < currentTick) {
        return {
          valid: false,
          error: `Command tick ${command.tick} is in the past (current: ${currentTick})`,
        };
      }

      if (command.tick > currentTick + maxTickFuture) {
        return { valid: false, error: `Command tick ${command.tick} is too far in the future` };
      }

      // Validate type is defined
      if (!command.type) {
        return { valid: false, error: 'Missing command type' };
      }

      // Validate entityIds is an array
      if (!Array.isArray(command.entityIds)) {
        return { valid: false, error: 'entityIds must be an array' };
      }

      return { valid: true };
    }

    it('accepts valid command', () => {
      const cmd: GameCommand = {
        tick: 105,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: [1, 2, 3],
      };

      const result = validateCommand(cmd, 100, ['player1', 'player2']);
      expect(result.valid).toBe(true);
    });

    it('rejects command with missing playerId', () => {
      const cmd: GameCommand = {
        tick: 105,
        playerId: '',
        type: 'MOVE',
        entityIds: [1],
      };

      const result = validateCommand(cmd, 100, ['player1', 'player2']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing playerId');
    });

    it('rejects command with unknown playerId', () => {
      const cmd: GameCommand = {
        tick: 105,
        playerId: 'hacker',
        type: 'MOVE',
        entityIds: [1],
      };

      const result = validateCommand(cmd, 100, ['player1', 'player2']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid playerId');
    });

    it('rejects command with tick in the past', () => {
      const cmd: GameCommand = {
        tick: 50,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: [1],
      };

      const result = validateCommand(cmd, 100, ['player1']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('in the past');
    });

    it('rejects command with tick too far in future', () => {
      const cmd: GameCommand = {
        tick: 500,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: [1],
      };

      const result = validateCommand(cmd, 100, ['player1'], 100);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too far in the future');
    });

    it('accepts command at current tick boundary', () => {
      const cmd: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: [1],
      };

      const result = validateCommand(cmd, 100, ['player1']);
      expect(result.valid).toBe(true);
    });

    it('accepts command at max future tick boundary', () => {
      const cmd: GameCommand = {
        tick: 200,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: [1],
      };

      const result = validateCommand(cmd, 100, ['player1'], 100);
      expect(result.valid).toBe(true);
    });
  });

  describe('Entity Ownership Validation', () => {
    interface EntityOwnership {
      entityId: number;
      ownerId: string;
    }

    function validateEntityOwnership(
      command: GameCommand,
      entityOwnership: EntityOwnership[]
    ): { valid: boolean; error?: string } {
      // BUILD commands don't require entity ownership
      const noOwnershipRequired: GameCommandType[] = ['BUILD', 'BUILD_WALL', 'HEARTBEAT'];
      if (noOwnershipRequired.includes(command.type)) {
        return { valid: true };
      }

      // Check ownership for each entity in the command
      for (const entityId of command.entityIds) {
        const entity = entityOwnership.find((e) => e.entityId === entityId);

        if (!entity) {
          return { valid: false, error: `Entity ${entityId} not found` };
        }

        if (entity.ownerId !== command.playerId) {
          return {
            valid: false,
            error: `Player ${command.playerId} does not own entity ${entityId}`,
          };
        }
      }

      return { valid: true };
    }

    let entityOwnership: EntityOwnership[];

    beforeEach(() => {
      entityOwnership = [
        { entityId: 1, ownerId: 'player1' },
        { entityId: 2, ownerId: 'player1' },
        { entityId: 3, ownerId: 'player2' },
        { entityId: 4, ownerId: 'player2' },
        { entityId: 5, ownerId: 'neutral' },
      ];
    });

    it('accepts command for owned entities', () => {
      const cmd: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: [1, 2],
      };

      const result = validateEntityOwnership(cmd, entityOwnership);
      expect(result.valid).toBe(true);
    });

    it('rejects command for unowned entities', () => {
      const cmd: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: [3], // Owned by player2
      };

      const result = validateEntityOwnership(cmd, entityOwnership);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not own entity 3');
    });

    it('rejects command mixing owned and unowned entities', () => {
      const cmd: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: [1, 2, 3], // 1,2 owned, 3 not owned
      };

      const result = validateEntityOwnership(cmd, entityOwnership);
      expect(result.valid).toBe(false);
    });

    it('rejects command for non-existent entity', () => {
      const cmd: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: [999],
      };

      const result = validateEntityOwnership(cmd, entityOwnership);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('allows BUILD commands without entity ownership check', () => {
      const cmd: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'BUILD',
        entityIds: [], // No entities needed
        buildingType: 'barracks',
        targetPosition: { x: 50, y: 50 },
      };

      const result = validateEntityOwnership(cmd, entityOwnership);
      expect(result.valid).toBe(true);
    });

    it('allows BUILD_WALL commands without entity ownership check', () => {
      const cmd: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'BUILD_WALL',
        entityIds: [],
        wallSegments: [{ x: 10, y: 20 }],
      };

      const result = validateEntityOwnership(cmd, entityOwnership);
      expect(result.valid).toBe(true);
    });

    it('allows HEARTBEAT commands without entity ownership check', () => {
      const cmd: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'HEARTBEAT',
        entityIds: [],
      };

      const result = validateEntityOwnership(cmd, entityOwnership);
      expect(result.valid).toBe(true);
    });
  });

  describe('Heartbeat Command Handling', () => {
    it('heartbeat has minimal payload', () => {
      const heartbeat: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'HEARTBEAT',
        entityIds: [],
      };

      const serialized = serializeForNetwork(heartbeat);

      // Verify it's compact
      expect(serialized.length).toBeLessThan(100);

      // Verify it deserializes correctly
      const deserialized = deserializeFromNetwork<GameCommand>(serialized);
      expect(deserialized.type).toBe('HEARTBEAT');
      expect(deserialized.entityIds).toEqual([]);
    });

    it('heartbeat preserves tick and playerId', () => {
      const heartbeat: GameCommand = {
        tick: 5000,
        playerId: 'player-with-long-id-12345',
        type: 'HEARTBEAT',
        entityIds: [],
      };

      const deserialized = deserializeFromNetwork<GameCommand>(serializeForNetwork(heartbeat));

      expect(deserialized.tick).toBe(5000);
      expect(deserialized.playerId).toBe('player-with-long-id-12345');
    });
  });

  describe('Large Command Batch Serialization', () => {
    it('handles serialization of many commands', () => {
      const commands: GameCommand[] = [];

      // Create 100 commands
      for (let i = 0; i < 100; i++) {
        commands.push({
          tick: 100 + Math.floor(i / 10),
          playerId: `player${(i % 4) + 1}`,
          type: ['MOVE', 'ATTACK', 'GATHER', 'TRAIN'][i % 4] as GameCommandType,
          entityIds: [i * 10, i * 10 + 1],
          targetPosition: { x: i * 5, y: i * 3 },
        });
      }

      const serialized = serializeForNetwork(commands);
      const deserialized = deserializeFromNetwork<GameCommand[]>(serialized);

      expect(deserialized).toHaveLength(100);

      // Verify a few random commands
      expect(deserialized[0].tick).toBe(100);
      expect(deserialized[50].tick).toBe(105);
      expect(deserialized[99].tick).toBe(109);
    });

    it('handles sync response with extensive command history', () => {
      const commandHistory: SyncResponseData['commands'] = [];

      // Create 50 ticks of history with multiple commands each
      for (let tick = 150; tick < 200; tick++) {
        const tickCommands: GameCommand[] = [];
        for (let player = 1; player <= 4; player++) {
          tickCommands.push({
            tick,
            playerId: `player${player}`,
            type: player % 2 === 0 ? 'MOVE' : 'HEARTBEAT',
            entityIds: player % 2 === 0 ? [player * 100] : [],
          });
        }
        commandHistory.push({ tick, commands: tickCommands });
      }

      const syncData: SyncResponseData = {
        currentTick: 200,
        commands: commandHistory,
      };

      const serialized = serializeForNetwork(syncData);
      const deserialized = deserializeFromNetwork<SyncResponseData>(serialized);

      expect(deserialized.currentTick).toBe(200);
      expect(deserialized.commands).toHaveLength(50);
      expect(deserialized.commands[0].commands).toHaveLength(4);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty entityIds array', () => {
      const cmd: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'BUILD',
        entityIds: [],
      };

      const deserialized = deserializeFromNetwork<GameCommand>(serializeForNetwork(cmd));
      expect(deserialized.entityIds).toEqual([]);
    });

    it('handles very large entityIds array', () => {
      const largeEntityIds = Array.from({ length: 255 }, (_, i) => i + 1);
      const cmd: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: largeEntityIds,
      };

      const deserialized = deserializeFromNetwork<GameCommand>(serializeForNetwork(cmd));
      expect(deserialized.entityIds).toHaveLength(255);
      expect(deserialized.entityIds).toEqual(largeEntityIds);
    });

    it('handles special characters in playerId', () => {
      const cmd: GameCommand = {
        tick: 100,
        playerId: 'player_1-abc:def',
        type: 'MOVE',
        entityIds: [1],
      };

      const deserialized = deserializeFromNetwork<GameCommand>(serializeForNetwork(cmd));
      expect(deserialized.playerId).toBe('player_1-abc:def');
    });

    it('handles negative coordinates in targetPosition', () => {
      const cmd: GameCommand = {
        tick: 100,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: [1],
        targetPosition: { x: -100.5, y: -200.75 },
      };

      const deserialized = deserializeFromNetwork<GameCommand>(serializeForNetwork(cmd));
      expect(deserialized.targetPosition).toEqual({ x: -100.5, y: -200.75 });
    });

    it('handles zero tick', () => {
      const cmd: GameCommand = {
        tick: 0,
        playerId: 'player1',
        type: 'HEARTBEAT',
        entityIds: [],
      };

      const deserialized = deserializeFromNetwork<GameCommand>(serializeForNetwork(cmd));
      expect(deserialized.tick).toBe(0);
    });

    it('handles very large tick numbers', () => {
      const cmd: GameCommand = {
        tick: 999999999,
        playerId: 'player1',
        type: 'MOVE',
        entityIds: [1],
      };

      const deserialized = deserializeFromNetwork<GameCommand>(serializeForNetwork(cmd));
      expect(deserialized.tick).toBe(999999999);
    });
  });
});
