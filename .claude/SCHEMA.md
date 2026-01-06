# VOIDSTRIKE - Database Schema

## Supabase PostgreSQL Schema

### Players Table
```sql
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(32) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
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
CREATE INDEX idx_players_username ON players(username);
```

### Matches Table
```sql
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player1_id UUID REFERENCES players(id),
  player2_id UUID REFERENCES players(id),
  player1_faction VARCHAR(32) NOT NULL,
  player2_faction VARCHAR(32) NOT NULL,
  winner_id UUID REFERENCES players(id),
  map_id UUID REFERENCES maps(id),
  duration_seconds INTEGER,
  end_reason VARCHAR(32), -- 'surrender', 'elimination', 'disconnect'
  replay_data JSONB,
  player1_elo_change INTEGER,
  player2_elo_change INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX idx_matches_player1 ON matches(player1_id);
CREATE INDEX idx_matches_player2 ON matches(player2_id);
CREATE INDEX idx_matches_created ON matches(created_at DESC);
```

### Factions Table
```sql
CREATE TABLE factions (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  description TEXT,
  theme_color VARCHAR(7), -- hex color
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

### Lobbies Table (for matchmaking)
```sql
CREATE TABLE lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID REFERENCES players(id),
  guest_id UUID REFERENCES players(id),
  map_id UUID REFERENCES maps(id),
  status VARCHAR(32) DEFAULT 'waiting', -- 'waiting', 'ready', 'in_progress', 'finished'
  game_mode VARCHAR(32) DEFAULT '1v1',
  is_ranked BOOLEAN DEFAULT FALSE,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lobbies_status ON lobbies(status) WHERE status = 'waiting';
```

### Leaderboard View
```sql
CREATE VIEW leaderboard AS
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
  RANK() OVER (ORDER BY p.elo_rating DESC) as rank
FROM players p
WHERE p.games_played >= 10
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

### Active Games Channel
```typescript
// Subscribe to lobby updates
supabase
  .channel('lobbies')
  .on('postgres_changes',
    { event: '*', schema: 'public', table: 'lobbies' },
    (payload) => handleLobbyUpdate(payload)
  )
  .subscribe()
```

### Game State Channel
```typescript
// Game-specific channel for lockstep sync
supabase
  .channel(`game:${gameId}`)
  .on('broadcast', { event: 'input' }, handleInput)
  .on('broadcast', { event: 'checksum' }, handleChecksum)
  .subscribe()
```

## Row Level Security (RLS)

```sql
-- Players can only update their own profile
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all players"
  ON players FOR SELECT
  USING (true);

CREATE POLICY "Users can update own profile"
  ON players FOR UPDATE
  USING (auth.uid() = id);

-- Match data is public but only system can insert
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view matches"
  ON matches FOR SELECT
  USING (true);
```
