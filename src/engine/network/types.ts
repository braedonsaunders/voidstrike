// =============================================================================
// VOIDSTRIKE Network Types
// WebRTC P2P multiplayer infrastructure types
// =============================================================================

// -----------------------------------------------------------------------------
// Lobby Types
// -----------------------------------------------------------------------------

export type LobbyStatus =
  | 'waiting'      // Waiting for players
  | 'ready'        // All players ready, can start
  | 'signaling'    // WebRTC handshake in progress
  | 'connecting'   // Establishing P2P connections
  | 'in_game'      // Game active
  | 'finished';    // Game ended

export interface LobbySettings {
  mapId: string;
  mapName: string;
  maxPlayers: number;
  gameSpeed: number;           // 0.5 = slower, 1 = normal, 1.5 = faster, 2 = fastest
  startingResources: 'normal' | 'high' | 'insane';
  fogOfWar: boolean;
  isRanked: boolean;
}

export interface LobbyPlayer {
  id: string;
  username: string;
  slot: number;                 // 0-7
  faction: string;              // 'dominion' | 'synthesis' | 'swarm'
  color: number;                // Color index 0-7
  team: number;                 // 0 = FFA, 1-4 = teams
  isReady: boolean;
  isHost: boolean;
  eloRating: number;
}

export interface Lobby {
  id: string;
  code: string;                 // 6-char join code
  hostId: string;
  status: LobbyStatus;
  settings: LobbySettings;
  players: LobbyPlayer[];
  createdAt: string;
  isPrivate: boolean;
}

// -----------------------------------------------------------------------------
// WebRTC Signaling Types
// -----------------------------------------------------------------------------

export type SignalingMessageType =
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'ready'
  | 'error';

export interface SignalingMessage {
  type: SignalingMessageType;
  from: string;                 // Sender player ID
  to: string;                   // Recipient player ID or 'all'
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit | string;
  timestamp: number;
}

// -----------------------------------------------------------------------------
// Game Message Types (sent over WebRTC DataChannel)
// -----------------------------------------------------------------------------

export type GameMessageType =
  | 'input'                     // Player input commands for a tick
  | 'input-ack'                 // Acknowledgement of received inputs
  | 'checksum'                  // State checksum for desync detection
  | 'desync'                    // Desync notification with details
  | 'state-dump-request'        // Request full state dump for debugging
  | 'state-dump-response'       // Full state dump data
  | 'ping'                      // Latency measurement request
  | 'pong'                      // Latency measurement response
  | 'sync-request'              // Request state sync (reconnection)
  | 'sync-response'             // State sync data
  | 'pause'                     // Request pause
  | 'resume'                    // Request resume
  | 'forfeit'                   // Player forfeits
  | 'chat';                     // In-game chat

export interface GameMessage {
  type: GameMessageType;
  tick: number;                 // Game tick this message relates to
  senderId: string;             // Player who sent this message
  data: unknown;                // Type-specific payload
  timestamp: number;            // When the message was created
  sequence: number;             // Sequence number for ordering
}

// Input message data
export interface InputMessageData {
  commands: GameCommand[];      // Commands for this tick
}

// Checksum message data (enhanced for determinism debugging)
export interface ChecksumMessageData {
  checksum: number;             // Primary state hash (computed from all entity states)
  unitCount: number;            // Total alive units
  buildingCount: number;        // Total alive buildings
  resourceSum: number;          // Sum of all resource amounts
  unitPositionHash: number;     // Hash of all unit positions (for quick position divergence check)
  healthSum: number;            // Sum of all health values
}

// Desync notification data
export interface DesyncMessageData {
  tick: number;                 // Tick where desync was detected
  localChecksum: number;        // Local client's checksum
  remoteChecksum: number;       // Remote client's checksum
  requestStateDump: boolean;    // Whether to request full state dump for debugging
}

// Ping/pong message data
export interface PingMessageData {
  originalTimestamp: number;
}

// Sync request data
export interface SyncRequestData {
  lastKnownTick: number;
}

// Sync response data
// Uses array of tuples instead of Map for proper JSON serialization over WebRTC
export interface SyncResponseData {
  commands: Array<{ tick: number; commands: GameCommand[] }>;
  currentTick: number;
}

// -----------------------------------------------------------------------------
// Game Command Types (for lockstep synchronization)
// -----------------------------------------------------------------------------

export type GameCommandType =
  | 'MOVE'
  | 'ATTACK'
  | 'ATTACK_MOVE'
  | 'PATROL'
  | 'HOLD'
  | 'STOP'
  | 'BUILD'
  | 'TRAIN'
  | 'RESEARCH'
  | 'ABILITY'
  | 'TRANSFORM'
  | 'LOAD'
  | 'UNLOAD'
  | 'LOAD_BUNKER'
  | 'UNLOAD_BUNKER'
  | 'RALLY'
  | 'GATHER'
  | 'REPAIR'
  | 'HEAL'
  | 'CLOAK'
  | 'CANCEL';

export interface GameCommand {
  id: string;                   // Unique command ID
  type: GameCommandType;
  playerId: string;             // Player who issued the command
  tick: number;                 // Tick this command executes on
  entityIds: number[];          // Entities this command affects
  data: GameCommandData;        // Command-specific data
}

export type GameCommandData =
  | MoveCommandData
  | AttackCommandData
  | BuildCommandData
  | TrainCommandData
  | ResearchCommandData
  | AbilityCommandData
  | GenericCommandData;

export interface MoveCommandData {
  targetX: number;
  targetY: number;
  formation?: string;
  queued?: boolean;
}

export interface AttackCommandData {
  targetEntityId?: number;
  targetX?: number;
  targetY?: number;
  queued?: boolean;
}

export interface BuildCommandData {
  buildingType: string;
  x: number;
  y: number;
}

export interface TrainCommandData {
  unitType: string;
  count: number;
}

export interface ResearchCommandData {
  upgradeId: string;
}

export interface AbilityCommandData {
  abilityId: string;
  targetEntityId?: number;
  targetX?: number;
  targetY?: number;
}

export interface GenericCommandData {
  [key: string]: unknown;
}

// -----------------------------------------------------------------------------
// Connection State Types
// -----------------------------------------------------------------------------

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export interface PeerState {
  id: string;
  username: string;
  connectionState: ConnectionState;
  dataChannelState: RTCDataChannelState | null;
  latency: number;              // RTT in milliseconds
  lastSeen: number;             // Timestamp of last message
}

export interface NetworkState {
  localPlayerId: string;
  peers: Map<string, PeerState>;
  isHost: boolean;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'critical';
  averageLatency: number;
}

// -----------------------------------------------------------------------------
// Matchmaking Types
// -----------------------------------------------------------------------------

export type MatchmakingStatus =
  | 'idle'
  | 'searching'
  | 'found'
  | 'cancelled'
  | 'error';

export interface MatchmakingState {
  status: MatchmakingStatus;
  queuedAt: number | null;
  estimatedWait: number | null;
  currentEloRange: number;
  gameMode: '1v1' | '2v2';
}

export interface MatchmakingQueueEntry {
  id: string;
  playerId: string;
  elo: number;
  gameMode: '1v1' | '2v2';
  joinedAt: string;
  eloRangeExpansion: number;
}

// -----------------------------------------------------------------------------
// ICE Server Configuration
// -----------------------------------------------------------------------------

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// Default free STUN servers
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
];

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

export interface NetworkEvents {
  'peer:connected': { peerId: string };
  'peer:disconnected': { peerId: string; reason?: string };
  'peer:message': { peerId: string; message: GameMessage };
  'connection:quality-changed': { quality: NetworkState['connectionQuality'] };
  'sync:desync-detected': { tick: number; localChecksum: number; remoteChecksum: number; peerId: string };
  'sync:waiting': { tick: number; waitingFor: string[] };
  'game:paused': { requesterId: string };
  'game:resumed': { requesterId: string };
}

// -----------------------------------------------------------------------------
// Utility Types
// -----------------------------------------------------------------------------

// Command ID generation
// Uses per-player counters managed by CommandIdGenerator for deterministic IDs across clients
export class CommandIdGenerator {
  private counters: Map<string, number> = new Map();
  private currentTick: number = 0;

  /**
   * Update the current tick (call at start of each game tick)
   */
  setTick(tick: number): void {
    // Reset per-tick sequence when tick advances
    if (tick !== this.currentTick) {
      this.currentTick = tick;
      this.counters.clear();
    }
  }

  /**
   * Generate a deterministic command ID
   * Format: playerId-tick-sequence (e.g., "player1-100-3")
   */
  generate(playerId: string): string {
    const count = (this.counters.get(playerId) ?? 0) + 1;
    this.counters.set(playerId, count);
    return `${playerId}-${this.currentTick}-${count}`;
  }

  /**
   * Reset all counters (call at game start)
   */
  reset(): void {
    this.counters.clear();
    this.currentTick = 0;
  }
}

// Global instance for backward compatibility
// Game should call commandIdGenerator.setTick() at the start of each tick
export const commandIdGenerator = new CommandIdGenerator();

/**
 * @deprecated Use commandIdGenerator.generate() instead for deterministic IDs
 */
export function generateCommandId(playerId: string = 'local'): string {
  return commandIdGenerator.generate(playerId);
}

/**
 * @deprecated Use commandIdGenerator.reset() instead
 */
export function resetCommandIdCounter(): void {
  commandIdGenerator.reset();
}

// For creating unique lobby codes
export function generateLobbyCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
