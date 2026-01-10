'use client';

import { useState } from 'react';
import { useAuthContext } from './AuthProvider';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialMode?: 'signin' | 'signup' | 'guest';
}

export function AuthModal({ isOpen, onClose, onSuccess, initialMode = 'guest' }: AuthModalProps) {
  const { signInAsGuest, signIn, signUp, isLoading, isMultiplayerEnabled } = useAuthContext();
  const [mode, setMode] = useState<'signin' | 'signup' | 'guest'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  if (!isMultiplayerEnabled) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
        <div className="game-panel p-8 max-w-md w-full mx-4">
          <h2 className="font-display text-2xl text-void-300 mb-4">Multiplayer Unavailable</h2>
          <p className="text-void-500 mb-6">
            Multiplayer features are not configured. Please check your Supabase environment variables.
          </p>
          <button onClick={onClose} className="game-button w-full">
            Close
          </button>
        </div>
      </div>
    );
  }

  const handleGuestSignIn = async () => {
    setError(null);
    const { error } = await signInAsGuest();
    if (error) {
      setError(error.message);
    } else {
      onSuccess?.();
      onClose();
    }
  };

  const handleEmailSignIn = async () => {
    setError(null);
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }
    const { error } = await signIn(email, password);
    if (error) {
      setError(error.message);
    } else {
      onSuccess?.();
      onClose();
    }
  };

  const handleEmailSignUp = async () => {
    setError(null);
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    const { error } = await signUp(email, password, username || undefined);
    if (error) {
      setError(error.message);
    } else {
      onSuccess?.();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="game-panel p-8 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-2xl text-void-300">
            {mode === 'guest' && 'Quick Play'}
            {mode === 'signin' && 'Sign In'}
            {mode === 'signup' && 'Create Account'}
          </h2>
          <button
            onClick={onClose}
            className="text-void-500 hover:text-void-300 text-2xl"
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-500/50 rounded px-4 py-2 mb-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        {mode === 'guest' && (
          <div>
            <p className="text-void-500 mb-6">
              Play instantly as a guest. Your stats will be saved, and you can upgrade to a full account later.
            </p>
            <button
              onClick={handleGuestSignIn}
              disabled={isLoading}
              className="game-button-primary w-full mb-4"
            >
              {isLoading ? 'Connecting...' : 'Play as Guest'}
            </button>
            <div className="text-center text-void-500 text-sm">
              <span>Already have an account? </span>
              <button
                onClick={() => setMode('signin')}
                className="text-void-400 hover:text-void-300 underline"
              >
                Sign In
              </button>
            </div>
          </div>
        )}

        {mode === 'signin' && (
          <div>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-void-500 text-sm mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-void-900 border border-void-700 rounded px-4 py-2 text-void-200 focus:border-void-500 focus:outline-none"
                  placeholder="commander@voidstrike.com"
                />
              </div>
              <div>
                <label className="block text-void-500 text-sm mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-void-900 border border-void-700 rounded px-4 py-2 text-void-200 focus:border-void-500 focus:outline-none"
                  placeholder="********"
                />
              </div>
            </div>
            <button
              onClick={handleEmailSignIn}
              disabled={isLoading}
              className="game-button-primary w-full mb-4"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
            <div className="flex justify-between text-sm">
              <button
                onClick={() => setMode('guest')}
                className="text-void-500 hover:text-void-300"
              >
                Play as Guest
              </button>
              <button
                onClick={() => setMode('signup')}
                className="text-void-400 hover:text-void-300 underline"
              >
                Create Account
              </button>
            </div>
          </div>
        )}

        {mode === 'signup' && (
          <div>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-void-500 text-sm mb-2">
                  Username <span className="text-void-600">(optional)</span>
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-void-900 border border-void-700 rounded px-4 py-2 text-void-200 focus:border-void-500 focus:outline-none"
                  placeholder="VoidCommander"
                  maxLength={32}
                />
              </div>
              <div>
                <label className="block text-void-500 text-sm mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-void-900 border border-void-700 rounded px-4 py-2 text-void-200 focus:border-void-500 focus:outline-none"
                  placeholder="commander@voidstrike.com"
                />
              </div>
              <div>
                <label className="block text-void-500 text-sm mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-void-900 border border-void-700 rounded px-4 py-2 text-void-200 focus:border-void-500 focus:outline-none"
                  placeholder="At least 6 characters"
                />
              </div>
            </div>
            <button
              onClick={handleEmailSignUp}
              disabled={isLoading}
              className="game-button-primary w-full mb-4"
            >
              {isLoading ? 'Creating account...' : 'Create Account'}
            </button>
            <div className="flex justify-between text-sm">
              <button
                onClick={() => setMode('guest')}
                className="text-void-500 hover:text-void-300"
              >
                Play as Guest
              </button>
              <button
                onClick={() => setMode('signin')}
                className="text-void-400 hover:text-void-300 underline"
              >
                Sign In
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
