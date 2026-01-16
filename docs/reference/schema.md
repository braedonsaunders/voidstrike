# VOIDSTRIKE - Schema Reference

> **Note:** The PostgreSQL tables below are reference documentation. The game now uses serverless P2P multiplayer via Nostr relays - no database required. The TypeScript interfaces in the Network Types section are the active schema.

## Historical: PostgreSQL Schema (Not Used)

### Players Table
```sql
-- Players are linked to Supabase Auth users
CREATE TABLE players (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username VARCHAR(32) NOT NULL,
  email VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  elo_rating INTEGER DEFAULT 1000,
  games_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  highest_elo INTEGER DEFAULT 1000,
  preferred_faction VARCHAR(32),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_online TIMESTAMPTZ DEFAULT NOW(),
  is_online BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_players_elo ON players(elo_rating DESC);
CREATE INDEX idx_players_online ON players(is_online) WHERE is_online = TRUE;
```

### Lobbies Table
```sql
-- Lobbies for multiplayer game setup
-- Players are stored as JSONB array for real-time sync
CREATE TABLE lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(6) UNIQUE NOT NULL,           -- 6-char join code (e.g., "ABC123")
  host_id UUID REFERENCES players(id) ON DELETE CASCADE,
  status VARCHAR(32) DEFAULT 'waiting',      -- waiting, ready, signaling, connecting, in_game, finished
  settings JSONB DEFAULT '{}',               -- LobbySettings object
  players JSONB DEFAULT '[]',                -- Array of LobbyPlayer objects
  game_mode VARCHAR(32) DEFAULT '1v1',
  is_ranked BOOLEAN DEFAULT FALSE,
  is_private BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ
);

CREATE INDEX idx_lobbies_code ON lobbies(code);
CREATE INDEX idx_lobbies_status ON lobbies(status) WHERE status = 'waiting';
CREATE INDEX idx_lobbies_public ON lobbies(is_private, status)
  WHERE is_private = FALSE AND status = 'waiting';

-- LobbySettings JSONB structure:
-- {
--   "mapId": "void-assault",
--   "mapName": "Void Assault",
--   "maxPlayers": 2,
--   "gameSpeed": 1,
--   "startingResources": "normal",
--   "fogOfWar": true,
--   "isRanked": false
-- }

-- LobbyPlayer JSONB structure:
-- {
--   "id": "uuid",
--   "username": "PlayerName",
--   "slot": 0,
--   "faction": "dominion",
--   "color": 0,
--   "team": 0,
--   "isReady": false,
--   "isHost": true,
--   "eloRating": 1000
-- }
```

### Matches Table
```sql
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id UUID REFERENCES lobbies(id),
  player1_id UUID REFERENCES players(id),
  player2_id UUID REFERENCES players(id),
  player1_faction VARCHAR(32) NOT NULL,
  player2_faction VARCHAR(32) NOT NULL,
  winner_id UUID REFERENCES players(id),
  map_id VARCHAR(64),
  duration_seconds INTEGER,
  end_reason VARCHAR(32),                    -- 'surrender', 'elimination', 'disconnect'
  replay_data JSONB,                         -- Array of GameCommand objects
  player1_elo_before INTEGER,
  player2_elo_before INTEGER,
  player1_elo_change INTEGER,
  player2_elo_change INTEGER,
  is_ranked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX idx_matches_player1 ON matches(player1_id);
CREATE INDEX idx_matches_player2 ON matches(player2_id);
CREATE INDEX idx_matches_created ON matches(created_at DESC);
```

### Matchmaking Queue Table
```sql
-- Players waiting for Quick Match
CREATE TABLE matchmaking_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id) ON DELETE CASCADE UNIQUE,
  elo INTEGER NOT NULL,
  game_mode VARCHAR(32) NOT NULL DEFAULT '1v1',
  elo_range_expansion INTEGER DEFAULT 0,     -- Increases over time for faster matches
  joined_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_queue_elo ON matchmaking_queue(game_mode, elo);
CREATE INDEX idx_queue_joined ON matchmaking_queue(joined_at);
```

### Factions Table
```sql
CREATE TABLE factions (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  description TEXT,
  theme_color VARCHAR(7),                    -- hex color
  icon_url TEXT,
  is_playable BOOLEAN DEFAULT TRUE
);

INSERT INTO factions (id, name, description, theme_color) VALUES
  ('dominion', 'The Dominion', 'Human military forces - versatile and adaptive', '#4A90D9'),
  ('synthesis', 'The Synthesis', 'Machine consciousness - powerful but costly', '#9B59B6'),
  ('swarm', 'The Swarm', 'Organic hive-mind - cheap and overwhelming', '#8B4513');
```

### Player Stats Table
```sql
CREATE TABLE player_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id),
  faction_id VARCHAR(32) REFERENCES factions(id),
  games_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  avg_apm DECIMAL(6,2) DEFAULT 0,
  avg_game_duration INTEGER DEFAULT 0,
  total_units_produced INTEGER DEFAULT 0,
  total_resources_gathered INTEGER DEFAULT 0,
  UNIQUE(player_id, faction_id)
);

CREATE INDEX idx_player_stats_player ON player_stats(player_id);
```

### Maps Table
```sql
CREATE TABLE maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(64) NOT NULL,
  description TEXT,
  author_id UUID REFERENCES players(id),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  max_players INTEGER DEFAULT 2,
  terrain_data JSONB NOT NULL,
  spawn_points JSONB NOT NULL,
  resource_nodes JSONB NOT NULL,
  thumbnail_url TEXT,
  is_ranked BOOLEAN DEFAULT FALSE,
  is_official BOOLEAN DEFAULT FALSE,
  play_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_maps_ranked ON maps(is_ranked) WHERE is_ranked = TRUE;
```

### Leaderboard View
```sql
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  p.id,
  p.username,
  p.avatar_url,
  p.elo_rating,
  p.games_played,
  p.wins,
  p.losses,
  CASE WHEN p.games_played > 0
    THEN ROUND(p.wins::decimal / p.games_played * 100, 1)
    ELSE 0
  END as win_rate,
  p.current_streak,
  p.highest_elo,
  p.preferred_faction,
  RANK() OVER (ORDER BY p.elo_rating DESC) as rank
FROM players p
WHERE p.games_played >= 5
ORDER BY p.elo_rating DESC;
```

### Replay Commands Table
```sql
CREATE TABLE replay_commands (
  id BIGSERIAL PRIMARY KEY,
  match_id UUID REFERENCES matches(id),
  tick INTEGER NOT NULL,
  player_id UUID REFERENCES players(id),
  command_type VARCHAR(32) NOT NULL,
  command_data JSONB NOT NULL,
  UNIQUE(match_id, tick, id)
);

CREATE INDEX idx_replay_commands_match ON replay_commands(match_id, tick);
```

## Real-time Subscriptions

### Lobby Updates (Postgres Changes)
```typescript
// Subscribe to specific lobby updates
supabase
  .channel(`lobby:${lobbyId}`)
  .on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyId}` },
    (payload) => handleLobbyUpdate(payload.new)
  )
  .subscribe()
```

### Public Lobby List
```typescript
// Subscribe to all lobby changes for browser
supabase
  .channel('public-lobbies')
  .on('postgres_changes',
    { event: '*', schema: 'public', table: 'lobbies' },
    () => refetchLobbies()
  )
  .subscribe()
```

### WebRTC Signaling Channel
```typescript
// Temporary channel for WebRTC handshake (~30 seconds per game)
supabase
  .channel(`signaling:${lobbyId}`, { config: { broadcast: { self: false } } })
  .on('broadcast', { event: 'signal' }, ({ payload }) => {
    // payload: SignalingMessage { type, from, to, payload, timestamp }
    handleSignalingMessage(payload)
  })
  .subscribe()
```

### User Notifications (for matchmaking)
```typescript
// Subscribe to personal notifications
supabase
  .channel(`user:${userId}`)
  .on('broadcast', { event: 'match_found' }, ({ payload }) => {
    // payload: { lobbyCode, lobbyId }
    router.push(`/lobby/${payload.lobbyCode}`)
  })
  .subscribe()
```

## Row Level Security (RLS)

```sql
-- Enable RLS on all tables
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE lobbies ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE matchmaking_queue ENABLE ROW LEVEL SECURITY;

-- Players: Anyone can read, only self can insert/update
CREATE POLICY "Players are viewable by everyone" ON players
  FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile" ON players
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON players
  FOR UPDATE USING (auth.uid() = id);

-- Lobbies: Public readable, participants can modify
CREATE POLICY "Public lobbies are viewable by everyone" ON lobbies
  FOR SELECT USING (
    is_private = FALSE OR
    host_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(players) AS p
      WHERE (p->>'id')::uuid = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can create lobbies" ON lobbies
  FOR INSERT WITH CHECK (auth.uid() = host_id);

CREATE POLICY "Lobby participants can update" ON lobbies
  FOR UPDATE USING (
    host_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(players) AS p
      WHERE (p->>'id')::uuid = auth.uid()
    )
  );

CREATE POLICY "Host can delete lobby" ON lobbies
  FOR DELETE USING (host_id = auth.uid());

-- Matches: Anyone can read, participants can insert
CREATE POLICY "Matches are viewable by everyone" ON matches
  FOR SELECT USING (true);

CREATE POLICY "Participants can insert matches" ON matches
  FOR INSERT WITH CHECK (auth.uid() = player1_id OR auth.uid() = player2_id);

-- Matchmaking Queue: Users manage their own entry
CREATE POLICY "Users can view queue" ON matchmaking_queue
  FOR SELECT USING (true);

CREATE POLICY "Users can join queue" ON matchmaking_queue
  FOR INSERT WITH CHECK (auth.uid() = player_id);

CREATE POLICY "Users can leave queue" ON matchmaking_queue
  FOR DELETE USING (auth.uid() = player_id);
```

## Realtime Publication

```sql
-- Enable realtime for lobby and player changes
ALTER PUBLICATION supabase_realtime ADD TABLE lobbies;
ALTER PUBLICATION supabase_realtime ADD TABLE players;
```

## Supabase Edge Function: Matchmaking

Located at `supabase/functions/matchmaking/index.ts`

Triggered by pg_cron every 10-60 seconds:
1. Fetches players from `matchmaking_queue`
2. Matches players within ELO range (expands over time)
3. Creates lobby for matched players
4. Notifies players via broadcast channel
5. Removes matched players from queue

## TypeScript Types

See `src/engine/network/types.ts` for:
- `LobbySettings` - Game configuration
- `LobbyPlayer` - Player in lobby
- `Lobby` - Full lobby state
- `GameCommand` - Lockstep game commands
- `GameMessage` - WebRTC data channel messages
- `SignalingMessage` - WebRTC signaling messages
