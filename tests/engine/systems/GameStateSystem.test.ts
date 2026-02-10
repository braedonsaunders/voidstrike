import { describe, it, expect } from 'vitest';

/**
 * GameStateSystem Victory Condition Tests
 *
 * Tests the game end condition logic to ensure:
 * 1. Victory is declared when one team remains with buildings
 * 2. Victory is declared even when eliminated players have no entities in the world
 * 3. Draw is declared when all players are eliminated simultaneously
 * 4. FFA and team game modes both work correctly
 * 5. Surrender correctly identifies the winner among remaining players
 */

type TeamNumber = 0 | 1 | 2 | 3 | 4;

interface VictoryCheckResult {
  type: 'victory' | 'draw' | 'none';
  winner?: string;
  loser?: string;
  eliminatedThisTick?: string[];
}

/**
 * Mirror of checkVictoryConditions logic from GameStateSystem.
 * Uses playerTeams (stable game participants) instead of entity queries.
 */
function checkVictoryConditions(
  playerTeams: Map<string, TeamNumber>,
  playersWithBuildings: Set<string>,
  eliminatedPlayers: Set<string>
): VictoryCheckResult {
  const players = new Set<string>(playerTeams.keys());
  const newlyEliminated: string[] = [];

  // Check for newly eliminated players
  for (const playerId of players) {
    if (!playersWithBuildings.has(playerId) && !eliminatedPlayers.has(playerId)) {
      eliminatedPlayers.add(playerId);
      newlyEliminated.push(playerId);
    }
  }

  // Group active players by team
  const teamsWithActivePlayers = new Map<number, string[]>();
  let ffaIndex = -1;

  for (const playerId of playersWithBuildings) {
    const team = playerTeams.get(playerId) ?? 0;
    if (team === 0) {
      teamsWithActivePlayers.set(ffaIndex--, [playerId]);
    } else {
      const existing = teamsWithActivePlayers.get(team) ?? [];
      existing.push(playerId);
      teamsWithActivePlayers.set(team, existing);
    }
  }

  // Victory condition
  if (teamsWithActivePlayers.size === 1 && players.size > 1) {
    const [, teamPlayers] = [...teamsWithActivePlayers.entries()][0];
    const winner = teamPlayers[0];
    const losers = [...players].filter((p) => !teamPlayers.includes(p));
    return {
      type: 'victory',
      winner,
      loser: losers[0] ?? 'none',
      eliminatedThisTick: newlyEliminated,
    };
  } else if (teamsWithActivePlayers.size === 0 && players.size > 0) {
    return { type: 'draw', eliminatedThisTick: newlyEliminated };
  }

  return { type: 'none', eliminatedThisTick: newlyEliminated };
}

/**
 * Mirror of handleSurrender logic from GameStateSystem.
 * Uses playerTeams and eliminatedPlayers instead of entity queries.
 */
function handleSurrender(
  surrenderingPlayer: string,
  playerTeams: Map<string, TeamNumber>,
  eliminatedPlayers: Set<string>
): { winner: string } | null {
  const players = new Set<string>(playerTeams.keys());
  const remainingPlayers = [...players].filter(
    (p) => p !== surrenderingPlayer && !eliminatedPlayers.has(p)
  );
  if (remainingPlayers.length === 1) {
    return { winner: remainingPlayers[0] };
  }
  return null;
}

describe('GameStateSystem', () => {
  describe('Victory conditions with stable player set', () => {
    it('declares victory when one FFA player has buildings and others do not', () => {
      const playerTeams = new Map<string, TeamNumber>([
        ['player1', 0],
        ['player2', 0],
        ['player3', 0],
      ]);
      const playersWithBuildings = new Set(['player1']);
      const eliminatedPlayers = new Set<string>();

      const result = checkVictoryConditions(playerTeams, playersWithBuildings, eliminatedPlayers);

      expect(result.type).toBe('victory');
      expect(result.winner).toBe('player1');
    });

    it('declares victory even when eliminated players have zero entities in world', () => {
      // This is the core bug fix: previously players were counted from entities,
      // so eliminated players with no surviving units wouldn't be in the set,
      // causing players.size to be 1 and preventing victory
      const playerTeams = new Map<string, TeamNumber>([
        ['player1', 0],
        ['player2', 0],
      ]);
      // player2 has no buildings AND no units (entity completely gone)
      // With the old code, players.size would be 1 (only player1's entities exist)
      // With the fix, players.size is 2 (from playerTeams)
      const playersWithBuildings = new Set(['player1']);
      const eliminatedPlayers = new Set<string>();

      const result = checkVictoryConditions(playerTeams, playersWithBuildings, eliminatedPlayers);

      expect(result.type).toBe('victory');
      expect(result.winner).toBe('player1');
    });

    it('does not declare victory when multiple FFA players have buildings', () => {
      const playerTeams = new Map<string, TeamNumber>([
        ['player1', 0],
        ['player2', 0],
        ['player3', 0],
      ]);
      const playersWithBuildings = new Set(['player1', 'player3']);
      const eliminatedPlayers = new Set<string>();

      const result = checkVictoryConditions(playerTeams, playersWithBuildings, eliminatedPlayers);

      expect(result.type).toBe('none');
    });

    it('declares draw when all players lose buildings simultaneously', () => {
      const playerTeams = new Map<string, TeamNumber>([
        ['player1', 0],
        ['player2', 0],
      ]);
      const playersWithBuildings = new Set<string>();
      const eliminatedPlayers = new Set<string>();

      const result = checkVictoryConditions(playerTeams, playersWithBuildings, eliminatedPlayers);

      expect(result.type).toBe('draw');
    });

    it('does not declare victory in single-player game', () => {
      const playerTeams = new Map<string, TeamNumber>([['player1', 0]]);
      const playersWithBuildings = new Set(['player1']);
      const eliminatedPlayers = new Set<string>();

      const result = checkVictoryConditions(playerTeams, playersWithBuildings, eliminatedPlayers);

      expect(result.type).toBe('none');
    });

    it('tracks newly eliminated players', () => {
      const playerTeams = new Map<string, TeamNumber>([
        ['player1', 0],
        ['player2', 0],
        ['player3', 0],
      ]);
      const playersWithBuildings = new Set(['player1']);
      const eliminatedPlayers = new Set<string>();

      const result = checkVictoryConditions(playerTeams, playersWithBuildings, eliminatedPlayers);

      expect(result.eliminatedThisTick).toContain('player2');
      expect(result.eliminatedThisTick).toContain('player3');
      expect(eliminatedPlayers.has('player2')).toBe(true);
      expect(eliminatedPlayers.has('player3')).toBe(true);
    });

    it('does not re-eliminate already eliminated players', () => {
      const playerTeams = new Map<string, TeamNumber>([
        ['player1', 0],
        ['player2', 0],
        ['player3', 0],
      ]);
      const playersWithBuildings = new Set(['player1']);
      const eliminatedPlayers = new Set(['player2']); // Already eliminated

      const result = checkVictoryConditions(playerTeams, playersWithBuildings, eliminatedPlayers);

      // Only player3 is newly eliminated
      expect(result.eliminatedThisTick).toEqual(['player3']);
    });
  });

  describe('Team game victory conditions', () => {
    it('declares victory when one team remains in a 2v2', () => {
      const playerTeams = new Map<string, TeamNumber>([
        ['player1', 1],
        ['player2', 1],
        ['player3', 2],
        ['player4', 2],
      ]);
      // Team 1 has buildings, team 2 does not
      const playersWithBuildings = new Set(['player1', 'player2']);
      const eliminatedPlayers = new Set<string>();

      const result = checkVictoryConditions(playerTeams, playersWithBuildings, eliminatedPlayers);

      expect(result.type).toBe('victory');
      expect(result.winner).toBe('player1');
    });

    it('declares victory even when only one teammate has buildings', () => {
      const playerTeams = new Map<string, TeamNumber>([
        ['player1', 1],
        ['player2', 1],
        ['player3', 2],
        ['player4', 2],
      ]);
      // Only player1 on team 1 has buildings, but team 1 still wins
      const playersWithBuildings = new Set(['player1']);
      const eliminatedPlayers = new Set<string>();

      const result = checkVictoryConditions(playerTeams, playersWithBuildings, eliminatedPlayers);

      expect(result.type).toBe('victory');
      expect(result.winner).toBe('player1');
    });

    it('does not declare victory when both teams have buildings', () => {
      const playerTeams = new Map<string, TeamNumber>([
        ['player1', 1],
        ['player2', 1],
        ['player3', 2],
        ['player4', 2],
      ]);
      const playersWithBuildings = new Set(['player1', 'player3']);
      const eliminatedPlayers = new Set<string>();

      const result = checkVictoryConditions(playerTeams, playersWithBuildings, eliminatedPlayers);

      expect(result.type).toBe('none');
    });
  });

  describe('Surrender handling with stable player set', () => {
    it('identifies winner when last opponent surrenders', () => {
      const playerTeams = new Map<string, TeamNumber>([
        ['player1', 0],
        ['player2', 0],
      ]);
      const eliminatedPlayers = new Set<string>();

      const result = handleSurrender('player2', playerTeams, eliminatedPlayers);

      expect(result).not.toBeNull();
      expect(result!.winner).toBe('player1');
    });

    it('does not declare winner when multiple opponents remain', () => {
      const playerTeams = new Map<string, TeamNumber>([
        ['player1', 0],
        ['player2', 0],
        ['player3', 0],
      ]);
      const eliminatedPlayers = new Set<string>();

      const result = handleSurrender('player2', playerTeams, eliminatedPlayers);

      expect(result).toBeNull();
    });

    it('correctly identifies winner when some players already eliminated', () => {
      const playerTeams = new Map<string, TeamNumber>([
        ['player1', 0],
        ['player2', 0],
        ['player3', 0],
      ]);
      const eliminatedPlayers = new Set(['player3']); // Already eliminated

      const result = handleSurrender('player2', playerTeams, eliminatedPlayers);

      expect(result).not.toBeNull();
      expect(result!.winner).toBe('player1');
    });
  });

  describe('AI elimination stops operations', () => {
    it('eliminated AI player ID is tracked and can be checked', () => {
      // Mirrors the AICoordinator's eliminatedPlayers Set behavior
      const eliminatedPlayers = new Set<string>();
      const aiPlayers = new Map([
        ['player2', { playerId: 'player2' }],
        ['player3', { playerId: 'player3' }],
      ]);

      // Simulate game:playerEliminated event for player2
      const eliminatedPlayerId = 'player2';
      if (aiPlayers.has(eliminatedPlayerId)) {
        eliminatedPlayers.add(eliminatedPlayerId);
      }

      // In the update loop, eliminated players should be skipped
      const processedPlayers: string[] = [];
      for (const [playerId] of aiPlayers) {
        if (eliminatedPlayers.has(playerId)) continue;
        processedPlayers.push(playerId);
      }

      expect(processedPlayers).toEqual(['player3']);
      expect(processedPlayers).not.toContain('player2');
    });

    it('non-AI players being eliminated does not affect AI tracking', () => {
      const eliminatedPlayers = new Set<string>();
      const aiPlayers = new Map([['player2', { playerId: 'player2' }]]);

      // Human player1 eliminated - not in aiPlayers
      const eliminatedPlayerId = 'player1';
      if (aiPlayers.has(eliminatedPlayerId)) {
        eliminatedPlayers.add(eliminatedPlayerId);
      }

      expect(eliminatedPlayers.size).toBe(0);

      // AI player should still be processed
      const processedPlayers: string[] = [];
      for (const [playerId] of aiPlayers) {
        if (eliminatedPlayers.has(playerId)) continue;
        processedPlayers.push(playerId);
      }

      expect(processedPlayers).toEqual(['player2']);
    });

    it('multiple AI players can be eliminated independently', () => {
      const eliminatedPlayers = new Set<string>();
      const aiPlayers = new Map([
        ['player2', { playerId: 'player2' }],
        ['player3', { playerId: 'player3' }],
        ['player4', { playerId: 'player4' }],
      ]);

      // Eliminate player2 and player4
      eliminatedPlayers.add('player2');
      eliminatedPlayers.add('player4');

      const processedPlayers: string[] = [];
      for (const [playerId] of aiPlayers) {
        if (eliminatedPlayers.has(playerId)) continue;
        processedPlayers.push(playerId);
      }

      expect(processedPlayers).toEqual(['player3']);
    });
  });
});
