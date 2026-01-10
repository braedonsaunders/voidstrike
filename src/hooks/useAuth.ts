'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AuthState,
  PlayerProfile,
  signInAnonymously,
  signInWithEmail,
  signUpWithEmail,
  signOut as authSignOut,
  getSession,
  getPlayerProfile,
  updatePlayerProfile,
  updateOnlineStatus,
  onAuthStateChange,
  isMultiplayerEnabled,
} from '@/lib/auth';
import type { User, Session } from '@supabase/supabase-js';

const PRESENCE_INTERVAL = 60000; // Update presence every minute

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    profile: null,
    isLoading: true,
    isAuthenticated: false,
  });

  // Fetch profile for a user
  const fetchProfile = useCallback(async (userId: string): Promise<PlayerProfile | null> => {
    const profile = await getPlayerProfile(userId);
    return profile;
  }, []);

  // Initialize auth state
  useEffect(() => {
    if (!isMultiplayerEnabled()) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    let presenceInterval: NodeJS.Timeout | null = null;

    const initAuth = async () => {
      const session = await getSession();

      if (session?.user) {
        const profile = await fetchProfile(session.user.id);
        setState({
          user: session.user,
          session,
          profile,
          isLoading: false,
          isAuthenticated: true,
        });

        // Start presence updates
        presenceInterval = setInterval(() => {
          updateOnlineStatus(session.user.id, true);
        }, PRESENCE_INTERVAL);
      } else {
        setState({
          user: null,
          session: null,
          profile: null,
          isLoading: false,
          isAuthenticated: false,
        });
      }
    };

    initAuth();

    // Subscribe to auth changes
    const unsubscribe = onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const profile = await fetchProfile(session.user.id);
        setState({
          user: session.user,
          session,
          profile,
          isLoading: false,
          isAuthenticated: true,
        });

        // Start presence updates
        if (presenceInterval) clearInterval(presenceInterval);
        presenceInterval = setInterval(() => {
          updateOnlineStatus(session.user.id, true);
        }, PRESENCE_INTERVAL);
      } else if (event === 'SIGNED_OUT') {
        if (presenceInterval) clearInterval(presenceInterval);
        setState({
          user: null,
          session: null,
          profile: null,
          isLoading: false,
          isAuthenticated: false,
        });
      } else if (event === 'TOKEN_REFRESHED' && session) {
        setState(prev => ({ ...prev, session }));
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
      if (presenceInterval) clearInterval(presenceInterval);
    };
  }, [fetchProfile]);

  // Sign in anonymously for quick play
  const signInAsGuest = useCallback(async (): Promise<{ error: Error | null }> => {
    setState(prev => ({ ...prev, isLoading: true }));

    const { user, error } = await signInAnonymously();

    if (error) {
      setState(prev => ({ ...prev, isLoading: false }));
      return { error };
    }

    if (user) {
      const profile = await fetchProfile(user.id);
      setState({
        user,
        session: null, // Will be updated by auth listener
        profile,
        isLoading: false,
        isAuthenticated: true,
      });
    }

    return { error: null };
  }, [fetchProfile]);

  // Sign in with email
  const signIn = useCallback(async (
    email: string,
    password: string
  ): Promise<{ error: Error | null }> => {
    setState(prev => ({ ...prev, isLoading: true }));

    const { user, error } = await signInWithEmail(email, password);

    if (error) {
      setState(prev => ({ ...prev, isLoading: false }));
      return { error };
    }

    if (user) {
      const profile = await fetchProfile(user.id);
      setState({
        user,
        session: null,
        profile,
        isLoading: false,
        isAuthenticated: true,
      });
    }

    return { error: null };
  }, [fetchProfile]);

  // Sign up with email
  const signUp = useCallback(async (
    email: string,
    password: string,
    username?: string
  ): Promise<{ error: Error | null }> => {
    setState(prev => ({ ...prev, isLoading: true }));

    const { user, error } = await signUpWithEmail(email, password, username);

    if (error) {
      setState(prev => ({ ...prev, isLoading: false }));
      return { error };
    }

    if (user) {
      const profile = await fetchProfile(user.id);
      setState({
        user,
        session: null,
        profile,
        isLoading: false,
        isAuthenticated: true,
      });
    }

    return { error: null };
  }, [fetchProfile]);

  // Sign out
  const signOut = useCallback(async (): Promise<{ error: Error | null }> => {
    setState(prev => ({ ...prev, isLoading: true }));
    const { error } = await authSignOut();
    // State will be updated by auth listener
    return { error };
  }, []);

  // Update profile
  const updateProfile = useCallback(async (
    updates: Partial<Pick<PlayerProfile, 'username' | 'avatar_url' | 'preferred_faction'>>
  ): Promise<{ error: Error | null }> => {
    if (!state.user) {
      return { error: new Error('Not authenticated') };
    }

    const { profile, error } = await updatePlayerProfile(state.user.id, updates);

    if (error) {
      return { error };
    }

    if (profile) {
      setState(prev => ({ ...prev, profile }));
    }

    return { error: null };
  }, [state.user]);

  // Refresh profile from database
  const refreshProfile = useCallback(async (): Promise<void> => {
    if (!state.user) return;

    const profile = await fetchProfile(state.user.id);
    if (profile) {
      setState(prev => ({ ...prev, profile }));
    }
  }, [state.user, fetchProfile]);

  return {
    ...state,
    signInAsGuest,
    signIn,
    signUp,
    signOut,
    updateProfile,
    refreshProfile,
    isMultiplayerEnabled: isMultiplayerEnabled(),
  };
}

export type UseAuthReturn = ReturnType<typeof useAuth>;
