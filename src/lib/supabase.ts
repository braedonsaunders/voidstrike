import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase credentials not found. Multiplayer features will be disabled.'
  );
}

// Client-side Supabase client (uses anon key)
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 20, // Match game tick rate
        },
      },
    })
  : null;

// Type definitions for database
export interface Database {
  public: {
    Tables: {
      players: {
        Row: {
          id: string;
          username: string;
          email: string;
          avatar_url: string | null;
          elo_rating: number;
          games_played: number;
          wins: number;
          losses: number;
          current_streak: number;
          highest_elo: number;
          preferred_faction: string | null;
          created_at: string;
          last_online: string;
          is_online: boolean;
        };
        Insert: Omit<Database['public']['Tables']['players']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['players']['Insert']>;
      };
      matches: {
        Row: {
          id: string;
          player1_id: string;
          player2_id: string;
          player1_faction: string;
          player2_faction: string;
          winner_id: string | null;
          map_id: string;
          duration_seconds: number | null;
          end_reason: string | null;
          replay_data: unknown;
          player1_elo_before: number | null;
          player2_elo_before: number | null;
          player1_elo_change: number | null;
          player2_elo_change: number | null;
          is_ranked: boolean;
          created_at: string;
          ended_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['matches']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['matches']['Insert']>;
      };
      lobbies: {
        Row: {
          id: string;
          name: string;
          host_id: string;
          guest_id: string | null;
          map_id: string | null;
          host_faction: string | null;
          guest_faction: string | null;
          status: 'waiting' | 'ready' | 'starting' | 'in_progress' | 'finished';
          game_mode: string;
          is_ranked: boolean;
          is_private: boolean;
          game_speed: number;
          settings: unknown;
          created_at: string;
          started_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['lobbies']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['lobbies']['Insert']>;
      };
      factions: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          theme_color: string | null;
          icon_url: string | null;
          is_playable: boolean;
        };
        Insert: Database['public']['Tables']['factions']['Row'];
        Update: Partial<Database['public']['Tables']['factions']['Insert']>;
      };
      maps: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          author_id: string | null;
          width: number;
          height: number;
          max_players: number;
          terrain_data: unknown;
          spawn_points: unknown;
          resource_nodes: unknown;
          thumbnail_url: string | null;
          is_ranked: boolean;
          is_official: boolean;
          play_count: number;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['maps']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['maps']['Insert']>;
      };
    };
    Views: {
      leaderboard: {
        Row: {
          id: string;
          username: string;
          avatar_url: string | null;
          elo_rating: number;
          games_played: number;
          wins: number;
          losses: number;
          win_rate: number;
          current_streak: number;
          highest_elo: number;
          preferred_faction: string | null;
          rank: number;
        };
      };
    };
  };
}

// Helper to check if multiplayer is available
export function isMultiplayerEnabled(): boolean {
  return supabase !== null;
}
