/**
 * P2P Multiplayer System
 * Serverless peer-to-peer networking for VOIDSTRIKE
 */

// Nostr Relays - used for lobby signaling
export {
  getRelays,
  checkRelayHealth,
  filterHealthyRelays,
  NostrRelayError,
} from './NostrRelays';

// Nostr Matchmaking (Phase 3) - for future "Find Match" feature
export {
  NostrMatchmaking,
  NostrMatchmakingError,
  type MatchedOpponent,
  type ReceivedSignal,
} from './NostrMatchmaking';

// Peer Relay (Phase 4) - for NAT fallback when direct connections fail
export {
  PeerRelayNetwork,
} from './PeerRelay';
