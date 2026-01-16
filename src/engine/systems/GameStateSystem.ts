import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Building } from '../components/Building';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { useGameSetupStore, TeamNumber } from '@/store/gameSetupStore';
import { isBattleSimulatorMode } from '@/store/gameSetupStore';

export interface PlayerStats {
  playerId: string;
  unitsProduced: number;
  unitsLost: number;
  unitsKilled: number;
  buildingsConstructed: number;
  buildingsLost: number;
  buildingsDestroyed: number;
  resourcesGathered: { minerals: number; vespene: number };
  resourcesSpent: { minerals: number; vespene: number };
  peakSupply: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  apm: number; // Actions per minute
  actionCount: number;
}

export interface GameResult {
  winner: string | null;
  loser: string | null;
  reason: 'elimination' | 'surrender' | 'disconnect' | 'timeout';
  duration: number; // in seconds
  stats: Map<string, PlayerStats>;
}

export class GameStateSystem extends System {
  public readonly name = 'GameStateSystem';
  public priority = 200; // Run late, after most other systems

  private playerStats: Map<string, PlayerStats> = new Map();
  private playerTeams: Map<string, TeamNumber> = new Map(); // Cache player -> team mapping
  private isGameOver: boolean = false;
  private gameResult: GameResult | null = null;
  private lastVictoryCheck: number = 0;
  private victoryCheckInterval: number = 1; // Check every 1 second
  private eliminatedPlayers: Set<string> = new Set(); // Track eliminated players

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
    this.cachePlayerTeams();
  }

  private cachePlayerTeams(): void {
    const setupStore = useGameSetupStore.getState();
    for (const slot of setupStore.playerSlots) {
      if (slot.type === 'human' || slot.type === 'ai') {
        this.playerTeams.set(slot.id, slot.team);
      }
    }
  }

  private getPlayerTeam(playerId: string): TeamNumber {
    return this.playerTeams.get(playerId) ?? 0;
  }

  public initializePlayer(playerId: string): void {
    this.playerStats.set(playerId, {
      playerId,
      unitsProduced: 0,
      unitsLost: 0,
      unitsKilled: 0,
      buildingsConstructed: 0,
      buildingsLost: 0,
      buildingsDestroyed: 0,
      resourcesGathered: { minerals: 0, vespene: 0 },
      resourcesSpent: { minerals: 0, vespene: 0 },
      peakSupply: 0,
      totalDamageDealt: 0,
      totalDamageTaken: 0,
      apm: 0,
      actionCount: 0,
    });
  }

  private setupEventListeners(): void {
    // Track unit production
    this.game.eventBus.on('unit:spawned', (data: { playerId: string }) => {
      const stats = this.playerStats.get(data.playerId);
      if (stats) stats.unitsProduced++;
    });

    // Track unit deaths
    this.game.eventBus.on('unit:died', (data: { playerId: string; killedBy?: string }) => {
      const stats = this.playerStats.get(data.playerId);
      if (stats) stats.unitsLost++;

      if (data.killedBy) {
        const killerStats = this.playerStats.get(data.killedBy);
        if (killerStats) killerStats.unitsKilled++;
      }
    });

    // Track building construction
    this.game.eventBus.on('building:complete', (data: { playerId: string }) => {
      const stats = this.playerStats.get(data.playerId);
      if (stats) stats.buildingsConstructed++;
    });

    // Track building destruction
    this.game.eventBus.on('building:destroyed', (data: { playerId: string; destroyedBy?: string }) => {
      const stats = this.playerStats.get(data.playerId);
      if (stats) stats.buildingsLost++;

      if (data.destroyedBy) {
        const destroyerStats = this.playerStats.get(data.destroyedBy);
        if (destroyerStats) destroyerStats.buildingsDestroyed++;
      }
    });

    // Track resources gathered
    this.game.eventBus.on('resources:gathered', (data: { playerId: string; minerals?: number; vespene?: number }) => {
      const stats = this.playerStats.get(data.playerId);
      if (stats) {
        stats.resourcesGathered.minerals += data.minerals || 0;
        stats.resourcesGathered.vespene += data.vespene || 0;
      }
    });

    // Track resources spent
    this.game.eventBus.on('resources:spent', (data: { playerId: string; minerals?: number; vespene?: number }) => {
      const stats = this.playerStats.get(data.playerId);
      if (stats) {
        stats.resourcesSpent.minerals += data.minerals || 0;
        stats.resourcesSpent.vespene += data.vespene || 0;
      }
    });

    // Track damage dealt
    this.game.eventBus.on('combat:damage', (data: { attackerPlayerId?: string; defenderPlayerId?: string; damage: number }) => {
      if (data.attackerPlayerId) {
        const stats = this.playerStats.get(data.attackerPlayerId);
        if (stats) stats.totalDamageDealt += data.damage;
      }
      if (data.defenderPlayerId) {
        const stats = this.playerStats.get(data.defenderPlayerId);
        if (stats) stats.totalDamageTaken += data.damage;
      }
    });

    // Track player actions (for APM)
    this.game.eventBus.on('command:received', (data: { playerId: string }) => {
      const stats = this.playerStats.get(data.playerId);
      if (stats) stats.actionCount++;
    });

    // Handle surrender
    this.game.eventBus.on('player:surrender', (data: { playerId: string }) => {
      this.handleSurrender(data.playerId);
    });

    // Game start
    this.game.eventBus.on('game:started', () => {
      // Note: gameStartTime is no longer needed - we use tick-based game time
      this.isGameOver = false;
    });
  }

  public update(deltaTime: number): void {
    if (this.isGameOver) return;

    const gameTime = this.game.getGameTime();

    // Update APM calculations
    this.updateAPM(gameTime);

    // Check victory conditions periodically
    if (gameTime - this.lastVictoryCheck >= this.victoryCheckInterval) {
      this.lastVictoryCheck = gameTime;
      this.checkVictoryConditions();
    }
  }

  private updateAPM(gameTime: number): void {
    if (gameTime <= 0) return;

    const minutes = gameTime / 60;
    for (const stats of this.playerStats.values()) {
      stats.apm = Math.round(stats.actionCount / Math.max(minutes, 1));
    }
  }

  private checkVictoryConditions(): void {
    // Skip victory conditions in battle simulator mode
    if (isBattleSimulatorMode()) return;

    const players = new Set<string>();
    const playersWithBuildings = new Set<string>();

    // Collect all players
    const allEntities = this.world.getEntitiesWith('Selectable');
    for (const entity of allEntities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      players.add(selectable.playerId);
    }

    // Check which players still have complete buildings (not blueprints)
    const buildings = this.world.getEntitiesWith('Building', 'Selectable', 'Health');
    for (const entity of buildings) {
      const building = entity.get<Building>('Building');
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');

      if (!building || !selectable || !health) continue;
      // Only count operational buildings, not blueprints (waiting_for_worker or constructing)
      // isOperational() includes complete and flying states (lifting, flying, landing)
      if (!health.isDead() && building.isOperational()) {
        playersWithBuildings.add(selectable.playerId);
      }
    }

    // Check for newly eliminated players (had buildings before, now have none)
    for (const playerId of players) {
      if (!playersWithBuildings.has(playerId) && !this.eliminatedPlayers.has(playerId)) {
        // Player just got eliminated
        this.eliminatedPlayers.add(playerId);

        // Count remaining active teams (excluding just-eliminated player)
        let remainingTeams = 0;
        const countedTeams = new Set<number>();
        for (const activePlayerId of playersWithBuildings) {
          const team = this.getPlayerTeam(activePlayerId);
          const teamKey = team === 0 ? -parseInt(activePlayerId.replace('player', '')) : team;
          if (!countedTeams.has(teamKey)) {
            countedTeams.add(teamKey);
            remainingTeams++;
          }
        }

        const duration = this.game.getGameTime();
        this.game.eventBus.emit('game:playerEliminated', {
          playerId,
          reason: 'elimination',
          duration,
          gameOver: remainingTeams <= 1, // Game will end after this
          remainingPlayers: playersWithBuildings.size,
        });
      }
    }

    // Group active players by team
    // For FFA (team 0), each player is their own "team" using negative player index
    const teamsWithActivePlayers = new Map<number, string[]>();
    let ffaIndex = -1;

    for (const playerId of playersWithBuildings) {
      const team = this.getPlayerTeam(playerId);
      if (team === 0) {
        // FFA - each player is their own team
        teamsWithActivePlayers.set(ffaIndex--, [playerId]);
      } else {
        // Team game - group by team number
        const existing = teamsWithActivePlayers.get(team) ?? [];
        existing.push(playerId);
        teamsWithActivePlayers.set(team, existing);
      }
    }

    // Victory condition: Only one team has players with buildings remaining
    if (teamsWithActivePlayers.size === 1 && players.size > 1) {
      const [teamId, teamPlayers] = [...teamsWithActivePlayers.entries()][0];
      const winner = teamPlayers[0]; // First player of winning team
      const losers = [...players].filter(p => !teamPlayers.includes(p));

      this.declareVictory(winner, losers[0] ?? 'none', 'elimination');
    } else if (teamsWithActivePlayers.size === 0 && players.size > 0) {
      // Draw - everyone eliminated
      this.declareDraw();
    }
  }

  private handleSurrender(playerId: string): void {
    const players = new Set<string>();
    const allEntities = this.world.getEntitiesWith('Selectable');
    for (const entity of allEntities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      players.add(selectable.playerId);
    }

    const remainingPlayers = [...players].filter(p => p !== playerId);
    if (remainingPlayers.length === 1) {
      this.declareVictory(remainingPlayers[0], playerId, 'surrender');
    }
  }

  private declareVictory(winner: string, loser: string, reason: 'elimination' | 'surrender' | 'disconnect' | 'timeout'): void {
    if (this.isGameOver) return;

    this.isGameOver = true;
    const duration = this.game.getGameTime();

    this.gameResult = {
      winner,
      loser,
      reason,
      duration,
      stats: new Map(this.playerStats),
    };

    this.game.eventBus.emit('game:victory', {
      winner,
      loser,
      reason,
      duration,
      stats: Object.fromEntries(this.playerStats),
    });
  }

  private declareDraw(): void {
    if (this.isGameOver) return;

    this.isGameOver = true;
    const duration = this.game.getGameTime();

    this.gameResult = {
      winner: null,
      loser: null,
      reason: 'elimination',
      duration,
      stats: new Map(this.playerStats),
    };

    this.game.eventBus.emit('game:draw', {
      duration,
      stats: Object.fromEntries(this.playerStats),
    });
  }

  // Public getters for UI
  public getPlayerStats(playerId: string): PlayerStats | undefined {
    return this.playerStats.get(playerId);
  }

  public getAllStats(): Map<string, PlayerStats> {
    return new Map(this.playerStats);
  }

  public getGameResult(): GameResult | null {
    return this.gameResult;
  }

  public isGameFinished(): boolean {
    return this.isGameOver;
  }

  public getGameDuration(): number {
    return this.game.getGameTime();
  }
}
