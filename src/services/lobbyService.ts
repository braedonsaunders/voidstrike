import { supabase, isMultiplayerEnabled } from '@/lib/supabase';
import {
  Lobby,
  LobbyPlayer,
  LobbySettings,
  LobbyStatus,
  generateLobbyCode,
} from '@/engine/network/types';
import type { RealtimeChannel } from '@supabase/supabase-js';

// =============================================================================
// Database Row Types (match Supabase schema)
// =============================================================================

interface LobbyRow {
  id: string;
  code: string;
  host_id: string;
  status: LobbyStatus;
  settings: LobbySettings;
  players: LobbyPlayer[];
  created_at: string;
  is_private: boolean;
  game_mode: string;
  is_ranked: boolean;
}

// =============================================================================
// Lobby Service
// =============================================================================

// Convert database row to Lobby type
function rowToLobby(row: LobbyRow): Lobby {
  return {
    id: row.id,
    code: row.code,
    hostId: row.host_id,
    status: row.status,
    settings: row.settings,
    players: row.players || [],
    createdAt: row.created_at,
    isPrivate: row.is_private,
  };
}

// Default lobby settings
export const DEFAULT_LOBBY_SETTINGS: LobbySettings = {
  mapId: 'void-assault',
  mapName: 'Void Assault',
  maxPlayers: 2,
  gameSpeed: 1,
  startingResources: 'normal',
  fogOfWar: true,
  isRanked: false,
};

// Create a new lobby
export async function createLobby(
  hostId: string,
  hostUsername: string,
  hostElo: number,
  settings?: Partial<LobbySettings>,
  isPrivate: boolean = false
): Promise<{ lobby: Lobby | null; error: Error | null }> {
  if (!supabase) {
    return { lobby: null, error: new Error('Multiplayer not enabled') };
  }

  const lobbySettings: LobbySettings = { ...DEFAULT_LOBBY_SETTINGS, ...settings };
  const code = generateLobbyCode();

  const hostPlayer: LobbyPlayer = {
    id: hostId,
    username: hostUsername,
    slot: 0,
    faction: 'dominion',
    color: 0,
    team: 0,
    isReady: false,
    isHost: true,
    eloRating: hostElo,
  };

  const { data, error } = await supabase
    .from('lobbies')
    .insert({
      code,
      host_id: hostId,
      status: 'waiting' as LobbyStatus,
      settings: lobbySettings,
      players: [hostPlayer],
      is_private: isPrivate,
      game_mode: '1v1',
      is_ranked: lobbySettings.isRanked,
    })
    .select()
    .single();

  if (error) {
    return { lobby: null, error };
  }

  return { lobby: rowToLobby(data as LobbyRow), error: null };
}

// Get lobby by code
export async function getLobbyByCode(
  code: string
): Promise<{ lobby: Lobby | null; error: Error | null }> {
  if (!supabase) {
    return { lobby: null, error: new Error('Multiplayer not enabled') };
  }

  const { data, error } = await supabase
    .from('lobbies')
    .select('*')
    .eq('code', code.toUpperCase())
    .single();

  if (error) {
    return { lobby: null, error };
  }

  return { lobby: rowToLobby(data as LobbyRow), error: null };
}

// Get lobby by ID
export async function getLobbyById(
  id: string
): Promise<{ lobby: Lobby | null; error: Error | null }> {
  if (!supabase) {
    return { lobby: null, error: new Error('Multiplayer not enabled') };
  }

  const { data, error } = await supabase
    .from('lobbies')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    return { lobby: null, error };
  }

  return { lobby: rowToLobby(data as LobbyRow), error: null };
}

// Get all public waiting lobbies
export async function getPublicLobbies(): Promise<{ lobbies: Lobby[]; error: Error | null }> {
  if (!supabase) {
    return { lobbies: [], error: new Error('Multiplayer not enabled') };
  }

  const { data, error } = await supabase
    .from('lobbies')
    .select('*')
    .eq('status', 'waiting')
    .eq('is_private', false)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return { lobbies: [], error };
  }

  return {
    lobbies: (data as LobbyRow[]).map(rowToLobby),
    error: null,
  };
}

// Join a lobby
export async function joinLobby(
  lobbyId: string,
  playerId: string,
  playerUsername: string,
  playerElo: number
): Promise<{ lobby: Lobby | null; error: Error | null }> {
  if (!supabase) {
    return { lobby: null, error: new Error('Multiplayer not enabled') };
  }

  // Get current lobby state
  const { data: currentLobby, error: fetchError } = await supabase
    .from('lobbies')
    .select('*')
    .eq('id', lobbyId)
    .single();

  if (fetchError || !currentLobby) {
    return { lobby: null, error: fetchError || new Error('Lobby not found') };
  }

  const lobby = currentLobby as LobbyRow;

  // Check if lobby is joinable
  if (lobby.status !== 'waiting') {
    return { lobby: null, error: new Error('Lobby is no longer accepting players') };
  }

  if (lobby.players.length >= lobby.settings.maxPlayers) {
    return { lobby: null, error: new Error('Lobby is full') };
  }

  // Check if player is already in lobby
  if (lobby.players.some(p => p.id === playerId)) {
    return { lobby: rowToLobby(lobby), error: null };
  }

  // Find next available slot and color
  const usedSlots = new Set(lobby.players.map(p => p.slot));
  const usedColors = new Set(lobby.players.map(p => p.color));

  let slot = 0;
  while (usedSlots.has(slot)) slot++;

  let color = 1; // Start at 1 since host usually has 0
  while (usedColors.has(color)) color++;

  const newPlayer: LobbyPlayer = {
    id: playerId,
    username: playerUsername,
    slot,
    faction: 'dominion',
    color,
    team: 0,
    isReady: false,
    isHost: false,
    eloRating: playerElo,
  };

  const updatedPlayers = [...lobby.players, newPlayer];

  const { data, error } = await supabase
    .from('lobbies')
    .update({ players: updatedPlayers })
    .eq('id', lobbyId)
    .select()
    .single();

  if (error) {
    return { lobby: null, error };
  }

  return { lobby: rowToLobby(data as LobbyRow), error: null };
}

// Leave a lobby
export async function leaveLobby(
  lobbyId: string,
  playerId: string
): Promise<{ error: Error | null }> {
  if (!supabase) {
    return { error: new Error('Multiplayer not enabled') };
  }

  const { data: currentLobby, error: fetchError } = await supabase
    .from('lobbies')
    .select('*')
    .eq('id', lobbyId)
    .single();

  if (fetchError || !currentLobby) {
    return { error: fetchError || new Error('Lobby not found') };
  }

  const lobby = currentLobby as LobbyRow;

  // If host is leaving, either transfer host or delete lobby
  if (lobby.host_id === playerId) {
    const remainingPlayers = lobby.players.filter(p => p.id !== playerId);

    if (remainingPlayers.length === 0) {
      // Delete empty lobby
      const { error } = await supabase
        .from('lobbies')
        .delete()
        .eq('id', lobbyId);
      return { error };
    }

    // Transfer host to next player
    const newHost = remainingPlayers[0];
    newHost.isHost = true;

    const { error } = await supabase
      .from('lobbies')
      .update({
        host_id: newHost.id,
        players: remainingPlayers,
      })
      .eq('id', lobbyId);

    return { error };
  }

  // Regular player leaving
  const updatedPlayers = lobby.players.filter(p => p.id !== playerId);

  const { error } = await supabase
    .from('lobbies')
    .update({ players: updatedPlayers })
    .eq('id', lobbyId);

  return { error };
}

// Update player in lobby (faction, color, team, ready status)
export async function updateLobbyPlayer(
  lobbyId: string,
  playerId: string,
  updates: Partial<Pick<LobbyPlayer, 'faction' | 'color' | 'team' | 'isReady'>>
): Promise<{ lobby: Lobby | null; error: Error | null }> {
  if (!supabase) {
    return { lobby: null, error: new Error('Multiplayer not enabled') };
  }

  const { data: currentLobby, error: fetchError } = await supabase
    .from('lobbies')
    .select('*')
    .eq('id', lobbyId)
    .single();

  if (fetchError || !currentLobby) {
    return { lobby: null, error: fetchError || new Error('Lobby not found') };
  }

  const lobby = currentLobby as LobbyRow;
  const playerIndex = lobby.players.findIndex(p => p.id === playerId);

  if (playerIndex === -1) {
    return { lobby: null, error: new Error('Player not in lobby') };
  }

  // Handle color swap if changing to a color already in use
  if (updates.color !== undefined) {
    const existingPlayerWithColor = lobby.players.find(
      p => p.color === updates.color && p.id !== playerId
    );
    if (existingPlayerWithColor) {
      // Swap colors
      const currentColor = lobby.players[playerIndex].color;
      const otherIndex = lobby.players.findIndex(p => p.id === existingPlayerWithColor.id);
      lobby.players[otherIndex].color = currentColor;
    }
  }

  // Apply updates
  lobby.players[playerIndex] = { ...lobby.players[playerIndex], ...updates };

  const { data, error } = await supabase
    .from('lobbies')
    .update({ players: lobby.players })
    .eq('id', lobbyId)
    .select()
    .single();

  if (error) {
    return { lobby: null, error };
  }

  return { lobby: rowToLobby(data as LobbyRow), error: null };
}

// Update lobby settings (host only)
export async function updateLobbySettings(
  lobbyId: string,
  hostId: string,
  settings: Partial<LobbySettings>
): Promise<{ lobby: Lobby | null; error: Error | null }> {
  if (!supabase) {
    return { lobby: null, error: new Error('Multiplayer not enabled') };
  }

  const { data: currentLobby, error: fetchError } = await supabase
    .from('lobbies')
    .select('*')
    .eq('id', lobbyId)
    .single();

  if (fetchError || !currentLobby) {
    return { lobby: null, error: fetchError || new Error('Lobby not found') };
  }

  const lobby = currentLobby as LobbyRow;

  if (lobby.host_id !== hostId) {
    return { lobby: null, error: new Error('Only the host can change settings') };
  }

  const updatedSettings = { ...lobby.settings, ...settings };

  const { data, error } = await supabase
    .from('lobbies')
    .update({ settings: updatedSettings })
    .eq('id', lobbyId)
    .select()
    .single();

  if (error) {
    return { lobby: null, error };
  }

  return { lobby: rowToLobby(data as LobbyRow), error: null };
}

// Update lobby status
export async function updateLobbyStatus(
  lobbyId: string,
  status: LobbyStatus
): Promise<{ error: Error | null }> {
  if (!supabase) {
    return { error: new Error('Multiplayer not enabled') };
  }

  const { error } = await supabase
    .from('lobbies')
    .update({ status })
    .eq('id', lobbyId);

  return { error };
}

// Check if all players are ready
export function areAllPlayersReady(lobby: Lobby): boolean {
  if (lobby.players.length < 2) return false;
  return lobby.players.every(p => p.isReady);
}

// Subscribe to lobby changes
export function subscribeLobby(
  lobbyId: string,
  onUpdate: (lobby: Lobby) => void,
  onDelete?: () => void
): RealtimeChannel | null {
  if (!supabase) return null;

  const channel = supabase
    .channel(`lobby:${lobbyId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'lobbies',
        filter: `id=eq.${lobbyId}`,
      },
      (payload) => {
        onUpdate(rowToLobby(payload.new as LobbyRow));
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'lobbies',
        filter: `id=eq.${lobbyId}`,
      },
      () => {
        onDelete?.();
      }
    )
    .subscribe();

  return channel;
}

// Subscribe to public lobby list
export function subscribePublicLobbies(
  onUpdate: (lobbies: Lobby[]) => void
): RealtimeChannel | null {
  if (!supabase) return null;

  // Initial fetch and subscribe to changes
  const fetchLobbies = async () => {
    const { lobbies } = await getPublicLobbies();
    onUpdate(lobbies);
  };

  const channel = supabase
    .channel('public-lobbies')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'lobbies',
      },
      () => {
        // Refetch on any change
        fetchLobbies();
      }
    )
    .subscribe();

  // Initial fetch
  fetchLobbies();

  return channel;
}

// Unsubscribe from a channel
export function unsubscribeLobby(channel: RealtimeChannel): void {
  if (supabase) {
    supabase.removeChannel(channel);
  }
}

// Clean up old lobbies (could be called by edge function)
export async function cleanupOldLobbies(): Promise<{ deletedCount: number; error: Error | null }> {
  if (!supabase) {
    return { deletedCount: 0, error: new Error('Multiplayer not enabled') };
  }

  // Delete lobbies older than 2 hours that are still waiting
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('lobbies')
    .delete()
    .in('status', ['waiting', 'finished'])
    .lt('created_at', twoHoursAgo)
    .select();

  if (error) {
    return { deletedCount: 0, error };
  }

  return { deletedCount: data?.length || 0, error: null };
}
