-- VOIDSTRIKE Initial Schema
-- Run this in Supabase SQL Editor or via migrations

-- ============================================
-- PLAYERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS players (
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

CREATE INDEX IF NOT EXISTS idx_players_elo ON players(elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);

-- ============================================
-- FACTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS factions (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  description TEXT,
  theme_color VARCHAR(7),
  icon_url TEXT,
  is_playable BOOLEAN DEFAULT TRUE
);

-- Insert default factions
INSERT INTO factions (id, name, description, theme_color) VALUES
  ('dominion', 'The Dominion', 'Human military forces - versatile and adaptive', '#4A90D9'),
  ('synthesis', 'The Synthesis', 'Machine consciousness - powerful but costly', '#9B59B6'),
  ('swarm', 'The Swarm', 'Organic hive-mind - cheap and overwhelming', '#8B4513')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- MAPS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(64) NOT NULL,
  description TEXT,
  author_id UUID REFERENCES players(id),
  width INTEGER NOT NULL DEFAULT 128,
  height INTEGER NOT NULL DEFAULT 128,
  max_players INTEGER DEFAULT 2,
  terrain_data JSONB NOT NULL DEFAULT '{}',
  spawn_points JSONB NOT NULL DEFAULT '[]',
  resource_nodes JSONB NOT NULL DEFAULT '[]',
  thumbnail_url TEXT,
  is_ranked BOOLEAN DEFAULT FALSE,
  is_official BOOLEAN DEFAULT FALSE,
  play_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maps_ranked ON maps(is_ranked) WHERE is_ranked = TRUE;

-- Insert default maps
INSERT INTO maps (name, description, width, height, max_players, is_ranked, is_official, spawn_points, resource_nodes) VALUES
  ('Void Assault', 'A balanced 1v1 map with central contested resources', 128, 128, 2, TRUE, TRUE,
   '[{"x": 20, "y": 20, "player": 1}, {"x": 108, "y": 108, "player": 2}]'::jsonb,
   '[{"x": 30, "y": 20, "type": "minerals"}, {"x": 98, "y": 108, "type": "minerals"}, {"x": 64, "y": 64, "type": "minerals"}]'::jsonb),
  ('Crystal Valley', 'Rich expansion options with multiple attack paths', 128, 128, 2, TRUE, TRUE,
   '[{"x": 15, "y": 64, "player": 1}, {"x": 113, "y": 64, "player": 2}]'::jsonb,
   '[{"x": 25, "y": 64, "type": "minerals"}, {"x": 103, "y": 64, "type": "minerals"}]'::jsonb),
  ('Training Grounds', 'Simple map for learning the basics', 96, 96, 2, FALSE, TRUE,
   '[{"x": 16, "y": 16, "player": 1}, {"x": 80, "y": 80, "player": 2}]'::jsonb,
   '[{"x": 24, "y": 16, "type": "minerals"}, {"x": 72, "y": 80, "type": "minerals"}]'::jsonb)
ON CONFLICT DO NOTHING;

-- ============================================
-- MATCHES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player1_id UUID REFERENCES players(id),
  player2_id UUID REFERENCES players(id),
  player1_faction VARCHAR(32) REFERENCES factions(id),
  player2_faction VARCHAR(32) REFERENCES factions(id),
  winner_id UUID REFERENCES players(id),
  map_id UUID REFERENCES maps(id),
  duration_seconds INTEGER,
  end_reason VARCHAR(32), -- 'surrender', 'elimination', 'disconnect'
  replay_data JSONB,
  player1_elo_before INTEGER,
  player2_elo_before INTEGER,
  player1_elo_change INTEGER,
  player2_elo_change INTEGER,
  is_ranked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_matches_player1 ON matches(player1_id);
CREATE INDEX IF NOT EXISTS idx_matches_player2 ON matches(player2_id);
CREATE INDEX IF NOT EXISTS idx_matches_created ON matches(created_at DESC);

-- ============================================
-- PLAYER STATS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS player_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_player_stats_player ON player_stats(player_id);

-- ============================================
-- LOBBIES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(64) NOT NULL,
  host_id UUID REFERENCES players(id) ON DELETE CASCADE,
  guest_id UUID REFERENCES players(id),
  map_id UUID REFERENCES maps(id),
  host_faction VARCHAR(32) REFERENCES factions(id),
  guest_faction VARCHAR(32) REFERENCES factions(id),
  status VARCHAR(32) DEFAULT 'waiting', -- 'waiting', 'ready', 'starting', 'in_progress', 'finished'
  game_mode VARCHAR(32) DEFAULT '1v1',
  is_ranked BOOLEAN DEFAULT FALSE,
  is_private BOOLEAN DEFAULT FALSE,
  password_hash TEXT,
  game_speed DECIMAL(3,2) DEFAULT 1.0,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,

  CONSTRAINT valid_status CHECK (status IN ('waiting', 'ready', 'starting', 'in_progress', 'finished'))
);

CREATE INDEX IF NOT EXISTS idx_lobbies_status ON lobbies(status) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_lobbies_host ON lobbies(host_id);

-- ============================================
-- REPLAY COMMANDS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS replay_commands (
  id BIGSERIAL PRIMARY KEY,
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  tick INTEGER NOT NULL,
  player_id UUID REFERENCES players(id),
  command_type VARCHAR(32) NOT NULL,
  command_data JSONB NOT NULL,
  checksum VARCHAR(64),

  CONSTRAINT valid_command_type CHECK (command_type IN ('MOVE', 'ATTACK', 'BUILD', 'TRAIN', 'ABILITY', 'STOP', 'HOLD', 'GATHER', 'RALLY'))
);

CREATE INDEX IF NOT EXISTS idx_replay_commands_match ON replay_commands(match_id, tick);

-- ============================================
-- ACHIEVEMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS achievements (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  icon_url TEXT,
  points INTEGER DEFAULT 10,
  is_hidden BOOLEAN DEFAULT FALSE
);

-- Insert default achievements
INSERT INTO achievements (id, name, description, points) VALUES
  ('first_win', 'First Victory', 'Win your first match', 10),
  ('win_streak_5', 'On Fire', 'Win 5 matches in a row', 25),
  ('reach_gold', 'Gold League', 'Reach 1500 ELO rating', 50),
  ('games_100', 'Veteran', 'Play 100 matches', 30),
  ('fast_win', 'Blitzkrieg', 'Win a match in under 5 minutes', 20)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- PLAYER ACHIEVEMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS player_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  achievement_id VARCHAR(64) REFERENCES achievements(id),
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, achievement_id)
);

-- ============================================
-- LEADERBOARD VIEW
-- ============================================
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
WHERE p.games_played >= 10
ORDER BY p.elo_rating DESC;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on all tables
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE lobbies ENABLE ROW LEVEL SECURITY;
ALTER TABLE replay_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_achievements ENABLE ROW LEVEL SECURITY;

-- Players policies
CREATE POLICY "Anyone can view players" ON players
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON players
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON players
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Matches policies
CREATE POLICY "Anyone can view matches" ON matches
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create matches" ON matches
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Player stats policies
CREATE POLICY "Anyone can view stats" ON player_stats
  FOR SELECT USING (true);

CREATE POLICY "Users can update own stats" ON player_stats
  FOR UPDATE USING (auth.uid() = player_id);

-- Lobbies policies
CREATE POLICY "Anyone can view public lobbies" ON lobbies
  FOR SELECT USING (is_private = false OR host_id = auth.uid() OR guest_id = auth.uid());

CREATE POLICY "Authenticated users can create lobbies" ON lobbies
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND host_id = auth.uid());

CREATE POLICY "Host can update lobby" ON lobbies
  FOR UPDATE USING (host_id = auth.uid());

CREATE POLICY "Host can delete lobby" ON lobbies
  FOR DELETE USING (host_id = auth.uid());

-- Replay commands policies
CREATE POLICY "Anyone can view replay commands" ON replay_commands
  FOR SELECT USING (true);

-- Player achievements policies
CREATE POLICY "Anyone can view achievements" ON player_achievements
  FOR SELECT USING (true);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to update player stats after a match
CREATE OR REPLACE FUNCTION update_player_stats_after_match()
RETURNS TRIGGER AS $$
BEGIN
  -- Update winner stats
  IF NEW.winner_id IS NOT NULL THEN
    UPDATE players SET
      games_played = games_played + 1,
      wins = wins + 1,
      current_streak = GREATEST(current_streak + 1, 1),
      elo_rating = elo_rating + COALESCE(
        CASE WHEN NEW.winner_id = NEW.player1_id THEN NEW.player1_elo_change ELSE NEW.player2_elo_change END,
        0
      ),
      highest_elo = GREATEST(highest_elo, elo_rating + COALESCE(
        CASE WHEN NEW.winner_id = NEW.player1_id THEN NEW.player1_elo_change ELSE NEW.player2_elo_change END,
        0
      )),
      last_online = NOW()
    WHERE id = NEW.winner_id;

    -- Update loser stats
    UPDATE players SET
      games_played = games_played + 1,
      losses = losses + 1,
      current_streak = LEAST(current_streak - 1, -1),
      elo_rating = elo_rating + COALESCE(
        CASE WHEN NEW.winner_id = NEW.player1_id THEN NEW.player2_elo_change ELSE NEW.player1_elo_change END,
        0
      ),
      last_online = NOW()
    WHERE id = CASE WHEN NEW.winner_id = NEW.player1_id THEN NEW.player2_id ELSE NEW.player1_id END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for match completion
DROP TRIGGER IF EXISTS on_match_complete ON matches;
CREATE TRIGGER on_match_complete
  AFTER UPDATE OF winner_id ON matches
  FOR EACH ROW
  WHEN (OLD.winner_id IS NULL AND NEW.winner_id IS NOT NULL)
  EXECUTE FUNCTION update_player_stats_after_match();

-- Function to calculate ELO change
CREATE OR REPLACE FUNCTION calculate_elo_change(
  winner_elo INTEGER,
  loser_elo INTEGER,
  k_factor INTEGER DEFAULT 32
)
RETURNS TABLE(winner_change INTEGER, loser_change INTEGER) AS $$
DECLARE
  expected_winner DECIMAL;
  expected_loser DECIMAL;
BEGIN
  expected_winner := 1.0 / (1.0 + POWER(10, (loser_elo - winner_elo)::decimal / 400));
  expected_loser := 1.0 - expected_winner;

  winner_change := ROUND(k_factor * (1 - expected_winner));
  loser_change := ROUND(k_factor * (0 - expected_loser));

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old lobbies
CREATE OR REPLACE FUNCTION cleanup_stale_lobbies()
RETURNS void AS $$
BEGIN
  DELETE FROM lobbies
  WHERE status = 'waiting'
    AND created_at < NOW() - INTERVAL '1 hour';

  UPDATE lobbies SET status = 'finished'
  WHERE status = 'in_progress'
    AND started_at < NOW() - INTERVAL '2 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- REALTIME SUBSCRIPTIONS
-- ============================================

-- Enable realtime for lobbies
ALTER PUBLICATION supabase_realtime ADD TABLE lobbies;

-- Note: For game state sync, use Supabase Realtime Broadcast channels
-- Example channel: game:{match_id}
-- Events: 'input' for player commands, 'checksum' for sync validation

-- ============================================
-- SCHEDULED JOBS (requires pg_cron extension)
-- ============================================

-- Uncomment if pg_cron is enabled:
-- SELECT cron.schedule('cleanup-stale-lobbies', '*/15 * * * *', 'SELECT cleanup_stale_lobbies()');
