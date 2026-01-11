import { supabase, isMultiplayerEnabled } from './supabase';
import type { User, Session } from '@supabase/supabase-js';
import { debugNetworking } from '@/utils/debugLogger';

export interface PlayerProfile {
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
  is_online: boolean;
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  profile: PlayerProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

// Generate a random username for anonymous users
function generateUsername(): string {
  const adjectives = ['Swift', 'Bold', 'Silent', 'Iron', 'Storm', 'Dark', 'Void', 'Nexus', 'Prime', 'Alpha'];
  const nouns = ['Commander', 'Striker', 'Pilot', 'Warden', 'Hunter', 'Vanguard', 'Sentinel', 'Reaper', 'Phoenix', 'Titan'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `${adj}${noun}${num}`;
}

// Sign in anonymously (for quick play)
export async function signInAnonymously(): Promise<{ user: User | null; error: Error | null }> {
  if (!supabase) {
    return { user: null, error: new Error('Multiplayer not enabled') };
  }

  const { data, error } = await supabase.auth.signInAnonymously();

  if (error) {
    return { user: null, error };
  }

  if (data.user) {
    // Create or update player profile
    await ensurePlayerProfile(data.user.id, data.user.email);
  }

  return { user: data.user, error: null };
}

// Sign in with email/password
export async function signInWithEmail(
  email: string,
  password: string
): Promise<{ user: User | null; error: Error | null }> {
  if (!supabase) {
    return { user: null, error: new Error('Multiplayer not enabled') };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { user: null, error };
  }

  if (data.user) {
    await ensurePlayerProfile(data.user.id, data.user.email);
  }

  return { user: data.user, error: null };
}

// Sign up with email/password
export async function signUpWithEmail(
  email: string,
  password: string,
  username?: string
): Promise<{ user: User | null; error: Error | null }> {
  if (!supabase) {
    return { user: null, error: new Error('Multiplayer not enabled') };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    return { user: null, error };
  }

  if (data.user) {
    await ensurePlayerProfile(data.user.id, data.user.email, username);
  }

  return { user: data.user, error: null };
}

// Sign out
export async function signOut(): Promise<{ error: Error | null }> {
  if (!supabase) {
    return { error: new Error('Multiplayer not enabled') };
  }

  // Set offline status before signing out
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from('players')
      .update({ is_online: false, last_online: new Date().toISOString() })
      .eq('id', user.id);
  }

  const { error } = await supabase.auth.signOut();
  return { error };
}

// Get current session
export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

// Get current user
export async function getUser(): Promise<User | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Ensure player profile exists in database
export async function ensurePlayerProfile(
  userId: string,
  email?: string | null,
  username?: string
): Promise<PlayerProfile | null> {
  if (!supabase) return null;

  // Check if profile exists
  const { data: existing } = await supabase
    .from('players')
    .select('*')
    .eq('id', userId)
    .single();

  if (existing) {
    // Update online status
    await supabase
      .from('players')
      .update({ is_online: true, last_online: new Date().toISOString() })
      .eq('id', userId);

    return existing as PlayerProfile;
  }

  // Create new profile
  const newUsername = username || generateUsername();
  const { data: newProfile, error } = await supabase
    .from('players')
    .insert({
      id: userId,
      username: newUsername,
      email: email || `${userId}@anonymous.voidstrike`,
      elo_rating: 1000,
      games_played: 0,
      wins: 0,
      losses: 0,
      current_streak: 0,
      highest_elo: 1000,
      is_online: true,
      last_online: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    debugNetworking.error('Failed to create player profile:', error);
    return null;
  }

  return newProfile as PlayerProfile;
}

// Get player profile
export async function getPlayerProfile(userId: string): Promise<PlayerProfile | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    debugNetworking.error('Failed to fetch player profile:', error);
    return null;
  }

  return data as PlayerProfile;
}

// Update player profile
export async function updatePlayerProfile(
  userId: string,
  updates: Partial<Pick<PlayerProfile, 'username' | 'avatar_url' | 'preferred_faction'>>
): Promise<{ profile: PlayerProfile | null; error: Error | null }> {
  if (!supabase) {
    return { profile: null, error: new Error('Multiplayer not enabled') };
  }

  const { data, error } = await supabase
    .from('players')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    return { profile: null, error };
  }

  return { profile: data as PlayerProfile, error: null };
}

// Update online status (call periodically to maintain presence)
export async function updateOnlineStatus(userId: string, isOnline: boolean): Promise<void> {
  if (!supabase) return;

  await supabase
    .from('players')
    .update({
      is_online: isOnline,
      last_online: new Date().toISOString()
    })
    .eq('id', userId);
}

// Get online player count
export async function getOnlinePlayerCount(): Promise<number> {
  if (!supabase) return 0;

  // Consider players online if they've been active in the last 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from('players')
    .select('*', { count: 'exact', head: true })
    .eq('is_online', true)
    .gte('last_online', fiveMinutesAgo);

  if (error) {
    debugNetworking.error('Failed to get online count:', error);
    return 0;
  }

  return count || 0;
}

// Subscribe to auth state changes
export function onAuthStateChange(
  callback: (event: string, session: Session | null) => void
): (() => void) | null {
  if (!supabase) return null;

  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);

  return () => {
    subscription.unsubscribe();
  };
}

// Check if multiplayer features are available
export { isMultiplayerEnabled };
