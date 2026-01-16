# VOIDSTRIKE - Revolutionary P2P Multiplayer Architecture

## Current Implementation Status

### ✅ What's COMPLETE (Infrastructure Layer)

| Component | Status | Details |
|-----------|--------|---------|
| **WebRTC P2P Connections** | ✅ Complete | Full mesh topology, RTCDataChannel |
| **Peer Connection Management** | ✅ Complete | `PeerConnection.ts` - Individual peer wrappers |
| **Peer Manager** | ✅ Complete | `PeerManager.ts` - Full mesh orchestration |
| **Game Message Protocol** | ✅ Complete | `types.ts` - 16 message types defined |
| **Checksum System** | ✅ Complete | `ChecksumSystem.ts` - State verification |
| **Desync Detection** | ✅ Complete | `DesyncDetection.ts` - 593 lines of debugging |
| **Latency Measurement** | ✅ Complete | Ping/pong every 5 seconds |
| **Connection Quality** | ✅ Complete | excellent/good/poor/critical assessment |

### ⚠️ What's INCOMPLETE (Game Integration)

| Component | Status | Gap |
|-----------|--------|-----|
| **Lockstep Game Loop** | ⚠️ Partial | Game loop doesn't wait for peer inputs |
| **Input Broadcasting** | ⚠️ Partial | Commands defined but not wired to game |
| **Input Buffering** | ❌ Missing | No client-side prediction or lag compensation |
| **Reconnection** | ⚠️ Defined | Types exist, logic not implemented |
| **Matchmaking Queue** | ❌ Missing | Just creates public lobbies |

### 🚫 What REQUIRES SERVERS (Current Dependencies)

| Dependency | Current Solution | Why Problematic |
|------------|------------------|-----------------|
| **Signaling** | Supabase Realtime | Can't exchange SDP without server |
| **Lobby Storage** | Supabase Postgres | Lobbies don't persist without DB |
| **Lobby Discovery** | Supabase Queries | Can't find games without server |
| **Player Profiles** | Supabase Auth/DB | ELO, stats need persistence |

---

## The Vision: Fully Decentralized Multiplayer

**Goal**: Players download the game and play directly with each other. No servers. No subscriptions. No central point of failure. Works offline.

### The Three Tiers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TIER 3: GLOBAL P2P NETWORK                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • DHT-based game discovery (find strangers to play with)           │   │
│  │  • Global matchmaking without servers                               │   │
│  │  • Peer-assisted relay network                                      │   │
│  │  • Reputation/skill tracking via DHT                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│                        TIER 2: FRIEND NETWORK                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • Shareable invite codes/links                                     │   │
│  │  • Direct peer-to-peer connection                                   │   │
│  │  • Uses only free public STUN servers                               │   │
│  │  • No discovery needed - you share the code with friends            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│                       TIER 1: LOCAL/OFFLINE PLAY                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • mDNS/Bonjour local network discovery                             │   │
│  │  • Same-browser play (BroadcastChannel)                             │   │
│  │  • Works completely offline (LAN parties)                           │   │
│  │  • No internet required                                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Technical Architecture

### 1. Connection Codes (Tier 2 - Friend Play)

The revolutionary insight: **Encode the WebRTC offer directly into a shareable code**.

```typescript
// Connection Code Format
interface ConnectionCode {
  version: 1;
  sdp: string;           // Compressed SDP offer
  ice: ICECandidate[];   // Pre-gathered ICE candidates
  gameSettings: {        // Optional game config
    map?: string;
    mode?: string;
  };
  timestamp: number;     // Expiry (codes valid ~5 minutes)
  signature: string;     // Integrity check
}

// Encoding process
function generateConnectionCode(offer: RTCSessionDescription): string {
  // 1. Gather ICE candidates (wait up to 3 seconds)
  // 2. Compress SDP with zlib
  // 3. Encode as base64url
  // 4. Format as human-readable code

  // Result: VOID-A3K7-F9X2-BMRP-L5T8-Y6WN (24 chars)
  return formatCode(compressed);
}

// Decoding process
function parseConnectionCode(code: string): ConnectionCode {
  // 1. Parse formatted code
  // 2. Decode base64url
  // 3. Decompress SDP
  // 4. Validate signature
  return decoded;
}
```

**User Flow:**
```
Player A (Host):
1. Click "Create Game" → "Play with Friends"
2. System gathers ICE candidates (2-3 seconds)
3. Displays code: VOID-A3K7-F9X2-BMRP-L5T8-Y6WN
4. Also shows QR code for mobile/tablet
5. Waits for Player B to connect

Player B (Join):
1. Click "Join Game" → "Enter Code"
2. Enters code (or scans QR)
3. System decodes SDP offer, creates answer
4. Connection established directly!
5. Game begins
```

**Code Generation Algorithm:**
```typescript
// Use alphabet that avoids confusion (no 0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 32 chars

function encodeToCode(buffer: Uint8Array): string {
  // 1. Compress with pako (zlib)
  const compressed = pako.deflate(buffer);

  // 2. Convert to base32-like encoding
  let result = '';
  for (let i = 0; i < compressed.length; i += 5) {
    // Take 5 bytes, output 8 chars (40 bits)
    const chunk = compressed.slice(i, i + 5);
    result += encodeChunk(chunk);
  }

  // 3. Format with dashes for readability
  // VOID-XXXX-XXXX-XXXX-XXXX-XXXX
  return formatWithDashes(result);
}
```

### 2. Local Network Discovery (Tier 1 - LAN Play)

**mDNS/DNS-SD Discovery:**
```typescript
// For Electron/Tauri desktop apps
interface LocalGameAnnouncement {
  name: string;          // "_voidstrike._udp.local"
  host: string;          // Player's display name
  port: number;          // WebRTC data port
  slots: {
    total: number;
    filled: number;
  };
  map: string;
  version: string;       // Game version for compatibility
}

// Announce game on local network
function announceLocalGame(settings: GameSettings): void {
  mdns.createAdvertisement(mdns.tcp('voidstrike'), PORT, {
    name: settings.hostName,
    txt: {
      map: settings.mapId,
      slots: `${settings.maxPlayers}`,
      version: GAME_VERSION,
    }
  });
}

// Discover local games
function discoverLocalGames(): Observable<LocalGameAnnouncement[]> {
  return mdns.createBrowser(mdns.tcp('voidstrike'))
    .pipe(map(services => services.map(toAnnouncement)));
}
```

**Same-Browser Play (BroadcastChannel):**
```typescript
// For browser-only play (two tabs)
const channel = new BroadcastChannel('voidstrike-local');

// Announce presence
channel.postMessage({
  type: 'announce',
  playerId: localPlayerId,
  game: gameSettings,
});

// Listen for games
channel.onmessage = (event) => {
  if (event.data.type === 'announce') {
    // Found local game!
    connectToLocalGame(event.data);
  }
};
```

### 3. DHT-Based Discovery (Tier 3 - Global Play)

**Using WebTorrent's Mainline DHT:**
```typescript
import WebTorrent from 'webtorrent';

// The Mainline DHT has millions of nodes globally
// We use it to announce and discover games

interface DHTGameAnnouncement {
  infoHash: string;      // Unique game identifier
  host: {
    peerId: string;      // WebTorrent peer ID
    sdpFingerprint: string; // For WebRTC connection
  };
  settings: {
    map: string;
    mode: '1v1' | '2v2' | 'ffa';
    slots: number;
    skill?: number;      // Optional ELO range
  };
  created: number;
  expires: number;       // Auto-cleanup
}

class DHTDiscovery {
  private client: WebTorrent;
  private announcedGames: Map<string, Torrent>;

  constructor() {
    this.client = new WebTorrent({
      dht: true,           // Enable DHT
      tracker: false,      // No trackers needed
      lsd: true,           // Local service discovery
    });
  }

  /**
   * Announce a game to the global DHT
   */
  async announceGame(settings: GameSettings): Promise<string> {
    // Create a virtual "torrent" for this game
    // The info_hash becomes the game's unique identifier

    const gameData = Buffer.from(JSON.stringify({
      type: 'voidstrike-game',
      version: GAME_VERSION,
      settings,
      host: {
        peerId: this.client.peerId,
        connectionOffer: await this.generateOffer(),
      },
      created: Date.now(),
    }));

    // Create torrent and announce to DHT
    const torrent = this.client.seed(gameData, {
      name: `voidstrike-${settings.mode}-${Date.now()}`,
      announce: [], // No trackers, DHT only
    });

    return torrent.infoHash;
  }

  /**
   * Search for games in the DHT
   */
  async searchGames(filters?: GameFilters): Promise<DHTGameAnnouncement[]> {
    // Search using well-known info_hash patterns
    // Games announce themselves with predictable hashes

    const games: DHTGameAnnouncement[] = [];

    // Search common game "topics"
    const topics = [
      'voidstrike-1v1-seeking',
      'voidstrike-2v2-seeking',
      'voidstrike-ffa-seeking',
    ];

    for (const topic of topics) {
      const infoHash = sha1(topic).toString('hex');

      // Get peers announcing this topic
      const peers = await this.findPeers(infoHash);

      for (const peer of peers) {
        // Exchange game info via WebRTC data channel
        const gameInfo = await this.fetchGameInfo(peer);
        if (gameInfo && matchesFilters(gameInfo, filters)) {
          games.push(gameInfo);
        }
      }
    }

    return games;
  }

  /**
   * Join the matchmaking "swarm" for a game mode
   */
  async joinMatchmaking(mode: '1v1' | '2v2', skill?: number): Promise<void> {
    const topic = `voidstrike-${mode}-seeking${skill ? `-${Math.floor(skill/100)*100}` : ''}`;
    const infoHash = sha1(topic).toString('hex');

    // Add ourselves to this swarm
    const torrent = this.client.add(infoHash, {
      announce: [],
    });

    // When we find a peer, try to match
    torrent.on('wire', async (wire) => {
      const opponent = await this.negotiateMatch(wire);
      if (opponent) {
        this.emit('match-found', opponent);
      }
    });
  }
}
```

**DHT Info Hash Strategy:**
```typescript
// Well-known info hashes for game discovery
const DISCOVERY_HASHES = {
  // Public lobby listing
  PUBLIC_LOBBIES: sha1('voidstrike:public-lobbies:v1'),

  // Matchmaking by mode
  MATCHMAKING_1V1: sha1('voidstrike:matchmaking:1v1:v1'),
  MATCHMAKING_2V2: sha1('voidstrike:matchmaking:2v2:v1'),

  // Skill brackets (for ranked-like matching)
  SKILL_0_1000: sha1('voidstrike:skill:0-1000:v1'),
  SKILL_1000_1500: sha1('voidstrike:skill:1000-1500:v1'),
  SKILL_1500_2000: sha1('voidstrike:skill:1500-2000:v1'),
  SKILL_2000_PLUS: sha1('voidstrike:skill:2000+:v1'),
};

// Players announce presence on relevant hashes
// Finding each other via DHT, then exchange offers
```

### 4. Peer Relay Network (NAT Traversal Fallback)

When STUN fails (symmetric NAT), use other players as relays:

```typescript
interface RelayRequest {
  type: 'relay-request';
  from: string;           // Requesting peer
  to: string;             // Target peer
  payload: string;        // Encrypted data
}

class PeerRelayNetwork {
  private connectedPeers: Map<string, RTCDataChannel>;
  private relayRoutes: Map<string, string[]>; // Target -> route through peers

  /**
   * When direct connection fails, find a relay path
   */
  async findRelayPath(targetPeerId: string): Promise<string[]> {
    // BFS through connected peers to find path to target
    const visited = new Set<string>();
    const queue: Array<{ peer: string; path: string[] }> = [];

    // Start with our direct connections
    for (const [peerId] of this.connectedPeers) {
      queue.push({ peer: peerId, path: [peerId] });
    }

    while (queue.length > 0) {
      const { peer, path } = queue.shift()!;

      if (peer === targetPeerId) {
        return path; // Found!
      }

      if (visited.has(peer)) continue;
      visited.add(peer);

      // Ask this peer for their connections
      const theirPeers = await this.getPeerList(peer);
      for (const nextPeer of theirPeers) {
        queue.push({ peer: nextPeer, path: [...path, nextPeer] });
      }
    }

    return []; // No path found
  }

  /**
   * Send data through relay chain
   */
  async relayTo(targetPeerId: string, data: Uint8Array): Promise<void> {
    const path = await this.findRelayPath(targetPeerId);
    if (path.length === 0) {
      throw new Error('No relay path available');
    }

    // Encrypt with target's public key
    const encrypted = await this.encrypt(data, targetPeerId);

    // Send through relay chain
    const message: RelayRequest = {
      type: 'relay-request',
      from: this.localPeerId,
      to: targetPeerId,
      payload: encrypted,
    };

    // Send to first hop
    this.connectedPeers.get(path[0])?.send(JSON.stringify({
      ...message,
      route: path.slice(1),
    }));
  }

  /**
   * Handle relay requests (when we're a relay node)
   */
  handleRelayRequest(request: RelayRequest & { route: string[] }): void {
    if (request.route.length === 0) {
      // We're the destination
      const decrypted = this.decrypt(request.payload);
      this.emit('message', { from: request.from, data: decrypted });
    } else {
      // Forward to next hop
      const nextHop = request.route[0];
      const channel = this.connectedPeers.get(nextHop);
      if (channel) {
        channel.send(JSON.stringify({
          ...request,
          route: request.route.slice(1),
        }));
      }
    }
  }
}
```

### 5. Decentralized Identity & Stats

Track player identity and stats without servers:

```typescript
interface PlayerIdentity {
  publicKey: string;       // Ed25519 public key
  displayName: string;
  created: number;

  // Stats (self-reported, verified by match history)
  stats: {
    wins: number;
    losses: number;
    skill: number;         // Calculated ELO
  };

  // Match history (signed by both players)
  recentMatches: SignedMatch[];
}

interface SignedMatch {
  matchId: string;
  players: [string, string]; // Public keys
  winner: string;
  duration: number;
  timestamp: number;

  // Both players sign the result
  signatures: {
    [publicKey: string]: string;
  };
}

class DecentralizedIdentity {
  private privateKey: CryptoKey;
  private publicKey: string;

  /**
   * Create or load identity from local storage
   */
  async initialize(): Promise<void> {
    const stored = localStorage.getItem('voidstrike-identity');

    if (stored) {
      const { privateKey, publicKey } = JSON.parse(stored);
      this.privateKey = await importKey(privateKey);
      this.publicKey = publicKey;
    } else {
      // Generate new identity
      const keyPair = await crypto.subtle.generateKey(
        { name: 'Ed25519' },
        true,
        ['sign', 'verify']
      );
      this.privateKey = keyPair.privateKey;
      this.publicKey = await exportPublicKey(keyPair.publicKey);

      // Store locally
      localStorage.setItem('voidstrike-identity', JSON.stringify({
        privateKey: await exportPrivateKey(keyPair.privateKey),
        publicKey: this.publicKey,
      }));
    }
  }

  /**
   * Sign match result for verification
   */
  async signMatchResult(match: Match): Promise<string> {
    const data = JSON.stringify({
      matchId: match.id,
      winner: match.winner,
      timestamp: match.timestamp,
    });

    const signature = await crypto.subtle.sign(
      'Ed25519',
      this.privateKey,
      new TextEncoder().encode(data)
    );

    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  /**
   * Verify opponent's claimed stats
   */
  async verifyPlayerStats(identity: PlayerIdentity): Promise<boolean> {
    // Verify recent match signatures
    for (const match of identity.recentMatches) {
      const isValid = await this.verifyMatchSignature(match);
      if (!isValid) return false;
    }

    // Recalculate ELO from verified matches
    const calculatedElo = calculateEloFromMatches(identity.recentMatches);

    // Allow small tolerance for calculation differences
    return Math.abs(calculatedElo - identity.stats.skill) < 50;
  }
}
```

---

## Implementation Phases

### Phase 1: Connection Codes (Priority: HIGH)
**Goal**: Play with friends without any server

```
Week 1:
- [ ] Implement SDP offer compression
- [ ] Create connection code encoding/decoding
- [ ] Build UI for code display (with QR code)
- [ ] Build UI for code entry
- [ ] Test direct P2P connection via codes

Week 2:
- [ ] Handle ICE candidate gathering timeout
- [ ] Implement code expiration (5 minute validity)
- [ ] Add clipboard copy/paste support
- [ ] Error handling for invalid/expired codes
```

### Phase 2: Local Network Discovery (Priority: MEDIUM)
**Goal**: Auto-discover games on same network

```
Week 3:
- [ ] Implement BroadcastChannel for same-browser
- [ ] Add mDNS discovery (requires Electron/Tauri)
- [ ] Build "Local Games" browser UI
- [ ] Test LAN party scenarios
```

### Phase 3: DHT Global Discovery (Priority: MEDIUM)
**Goal**: Find strangers to play with

```
Week 4-5:
- [ ] Integrate WebTorrent DHT client
- [ ] Implement game announcement to DHT
- [ ] Build game browser with DHT search
- [ ] Implement matchmaking via DHT swarms
- [ ] Add skill-based DHT topics
```

### Phase 4: Peer Relay Network (Priority: LOW)
**Goal**: Connect through difficult NATs

```
Week 6:
- [ ] Implement relay message protocol
- [ ] Build relay path discovery
- [ ] Add end-to-end encryption for relayed data
- [ ] Test with symmetric NAT scenarios
```

### Phase 5: Decentralized Identity (Priority: LOW)
**Goal**: Track stats without servers

```
Week 7-8:
- [ ] Implement Ed25519 key generation
- [ ] Create signed match result protocol
- [ ] Build local stats storage
- [ ] Implement peer stat verification
- [ ] Add identity backup/restore
```

---

## Connection Flow Diagrams

### Flow 1: Friend Code Connection

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FRIEND CODE CONNECTION FLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PLAYER A (Host)                              PLAYER B (Join)               │
│  ═══════════════                              ═══════════════               │
│                                                                             │
│  1. Click "Create Game"                                                     │
│         │                                                                   │
│         ▼                                                                   │
│  2. RTCPeerConnection created                                               │
│         │                                                                   │
│         ▼                                                                   │
│  3. createOffer()                                                           │
│         │                                                                   │
│         ▼                                                                   │
│  4. Gather ICE candidates                                                   │
│     (wait 2-3 seconds)                                                      │
│         │                                                                   │
│         ▼                                                                   │
│  5. Compress & encode                                                       │
│         │                                                                   │
│         ▼                                                                   │
│  6. Display code:                                                           │
│     ┌─────────────────────────┐                                             │
│     │ VOID-A3K7-F9X2-BMRP    │    ───────►    1. Enter code                │
│     │ [QR CODE]              │                        │                     │
│     │ Waiting for player...   │                        ▼                     │
│     └─────────────────────────┘               2. Decode & validate          │
│         │                                             │                     │
│         │                                             ▼                     │
│         │                                    3. RTCPeerConnection           │
│         │                                             │                     │
│         │                                             ▼                     │
│         │                                    4. setRemoteDescription        │
│         │                                             │                     │
│         │                                             ▼                     │
│         │                                    5. createAnswer()              │
│         │                                             │                     │
│         │                                             ▼                     │
│         │                                    6. Gather ICE candidates       │
│         │                                             │                     │
│         │                                             ▼                     │
│         │           ◄───────────────────    7. Send answer via              │
│         │              WebRTC DataChannel       existing offer              │
│         │                                    (trickle through offer's       │
│         │                                     ICE candidates)               │
│         ▼                                                                   │
│  7. Receive answer                                                          │
│         │                                                                   │
│         ▼                                                                   │
│  8. setRemoteDescription                                                    │
│         │                                                                   │
│         ▼                                                                   │
│  ═══════════════════════════════════════════════════════════════════════   │
│                    P2P CONNECTION ESTABLISHED                               │
│  ═══════════════════════════════════════════════════════════════════════   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Flow 2: DHT Matchmaking

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DHT MATCHMAKING FLOW                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PLAYER A                     DHT NETWORK                   PLAYER B        │
│  ════════                     ═══════════                   ════════        │
│                                                                             │
│  1. "Find 1v1 Match"               │                                        │
│         │                          │                                        │
│         ▼                          │                                        │
│  2. Calculate skill hash           │                                        │
│     hash("voidstrike:1v1:1500")    │                                        │
│         │                          │                                        │
│         ▼                          │                                        │
│  3. Announce to DHT ──────────────►│◄───────────────── 3. Announce to DHT  │
│     (info_hash: 0xABC...)          │                      (same hash)       │
│         │                          │                           │            │
│         │                          │                           │            │
│         │    ┌─────────────────────┴───────────────────┐       │            │
│         │    │         DHT PEER DISCOVERY              │       │            │
│         │    │                                         │       │            │
│         │    │   Both players find each other via      │       │            │
│         │    │   the same info_hash in the DHT         │       │            │
│         │    │                                         │       │            │
│         │    └─────────────────────┬───────────────────┘       │            │
│         │                          │                           │            │
│         ▼                          │                           ▼            │
│  4. Receive peer list              │              4. Receive peer list      │
│     [Player B found]               │                 [Player A found]       │
│         │                          │                           │            │
│         ▼                          │                           ▼            │
│  5. Exchange offers via DHT ◄──────┼────────────────► 5. Exchange offers   │
│     (small metadata only)          │                     via DHT            │
│         │                          │                           │            │
│         ▼                          │                           ▼            │
│  6. Initiate WebRTC ───────────────┼───────────────► 6. Accept WebRTC      │
│     (STUN hole punch)              │                    connection          │
│         │                          │                           │            │
│         ▼                          │                           ▼            │
│  ═══════════════════════════════════════════════════════════════════════   │
│                      P2P CONNECTION ESTABLISHED                             │
│  ═══════════════════════════════════════════════════════════════════════   │
│         │                                                      │            │
│         ▼                                                      ▼            │
│  7. Remove DHT announcement                       7. Remove DHT announcement│
│     (no longer seeking)                              (no longer seeking)    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Flow 3: Peer Relay (NAT Fallback)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PEER RELAY FALLBACK FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PLAYER A              RELAY PEERS (C, D)              PLAYER B             │
│  (Symmetric NAT)       (Open NAT)                      (Symmetric NAT)      │
│  ═════════════         ═══════════════                 ═════════════        │
│                                                                             │
│  1. Direct connection to B fails                                            │
│     (both behind symmetric NAT)                                             │
│         │                                                                   │
│         ▼                                                                   │
│  2. Find relay path                                                         │
│     Query DHT for online peers                                              │
│         │                                                                   │
│         ▼                                                                   │
│  3. Connect to Relay C ──────────► C (already connected to D)               │
│         │                          │                                        │
│         │                          ▼                                        │
│         │                   D (connected to B) ──────► B                    │
│         │                                                                   │
│         ▼                                                                   │
│  4. Path found: A → C → D → B                                               │
│         │                                                                   │
│         ▼                                                                   │
│  ═══════════════════════════════════════════════════════════════════════   │
│                         RELAY PATH ESTABLISHED                              │
│  ═══════════════════════════════════════════════════════════════════════   │
│                                                                             │
│  5. Game data flows:                                                        │
│                                                                             │
│     A ───[encrypted]──► C ───[forward]──► D ───[forward]──► B               │
│     A ◄──[encrypted]─── C ◄──[forward]─── D ◄──[forward]─── B               │
│                                                                             │
│  Note: Data is end-to-end encrypted with B's public key                     │
│        Relay peers (C, D) cannot read the content                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Why This Is Revolutionary

### 1. Zero Infrastructure Cost
- No servers to maintain
- No database to host
- No bandwidth to pay for
- Scales infinitely with player base

### 2. Cannot Be Shut Down
- No central point of failure
- DHT is distributed across millions of nodes
- Game works even if original developers disappear

### 3. Works Offline
- LAN parties work without internet
- Friend codes work with any network path
- Local discovery for same-network play

### 4. Privacy Preserving
- No account required
- No data collected
- Peer relay is end-to-end encrypted
- Identity is self-sovereign (your keys, your stats)

### 5. Better Than Servers
- Lower latency (direct P2P)
- More reliable (no server downtime)
- Fairer (no server advantage)

---

## Migration Path from Current Implementation

### Step 1: Keep Supabase as Optional
```typescript
// New architecture supports both
class ConnectionManager {
  async connect(method: 'code' | 'local' | 'dht' | 'supabase'): Promise<void> {
    switch (method) {
      case 'code':
        return this.connectViaCode();
      case 'local':
        return this.connectViaLocal();
      case 'dht':
        return this.connectViaDHT();
      case 'supabase':
        return this.connectViaSupabase(); // Existing implementation
    }
  }
}
```

### Step 2: Add Connection Code UI First
- Easiest to implement
- Immediate value for friend play
- No dependencies

### Step 3: Add DHT Discovery Later
- More complex implementation
- Adds stranger matchmaking
- Requires WebTorrent integration

### Step 4: Eventually Remove Supabase Dependency
- Once P2P is stable
- Keep as optional for organizations wanting stats

---

## File Structure

```
src/engine/network/
├── p2p/
│   ├── ConnectionCode.ts        # Code generation/parsing
│   ├── LocalDiscovery.ts        # mDNS + BroadcastChannel
│   ├── DHTDiscovery.ts          # WebTorrent DHT integration
│   ├── PeerRelay.ts             # Relay network for NAT fallback
│   └── DecentralizedIdentity.ts # Ed25519 key management
├── PeerConnection.ts            # (existing) WebRTC wrapper
├── PeerManager.ts               # (existing) Full mesh management
├── SignalingService.ts          # (existing) Supabase signaling
└── types.ts                     # (existing) Network types
```

---

## References

- [WebTorrent](https://webtorrent.io/) - BitTorrent in the browser with DHT
- [Mainline DHT](https://www.bittorrent.org/beps/bep_0005.html) - BitTorrent DHT specification
- [WebRTC](https://webrtc.org/) - P2P connections in browsers
- [mDNS](https://tools.ietf.org/html/rfc6762) - Local network discovery
- [Ed25519](https://ed25519.cr.yp.to/) - High-performance signatures
