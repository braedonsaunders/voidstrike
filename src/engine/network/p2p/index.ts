/**
 * P2P Multiplayer System
 * Serverless peer-to-peer networking for VOIDSTRIKE
 */

// Connection Codes (Phase 1)
export {
  generateOfferCode,
  generateAnswerCode,
  parseConnectionCode,
  completeConnection,
  createPeerConnection,
  waitForConnection,
  getDataChannel,
  ConnectionCodeError,
  type ConnectionCodeData,
} from './ConnectionCode';

// Nostr Relays
export {
  getRelays,
  checkRelayHealth,
  filterHealthyRelays,
  NostrRelayError,
} from './NostrRelays';

// Nostr Matchmaking (Phase 3)
export {
  NostrMatchmaking,
  NostrMatchmakingError,
  type MatchedOpponent,
  type ReceivedSignal,
} from './NostrMatchmaking';

// Peer Relay (Phase 4)
export {
  PeerRelayNetwork,
} from './PeerRelay';
