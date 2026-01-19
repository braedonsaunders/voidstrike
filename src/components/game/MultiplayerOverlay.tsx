'use client';

import { useEffect, useState } from 'react';
import { useMultiplayerStore, ConnectionStatus, DesyncState } from '@/store/multiplayerStore';
import { Game } from '@/engine/core/Game';

/**
 * MultiplayerOverlay - Shows connection status, network pause, and desync notifications
 *
 * This overlay handles:
 * - "Waiting for player..." when connection is lost
 * - Reconnection attempt progress
 * - Desync notification (game ending)
 * - Connection failed state
 */
export function MultiplayerOverlay() {
  const {
    isMultiplayer,
    isNetworkPaused,
    networkPauseReason,
    networkPauseStartTime,
    connectionStatus,
    desyncState,
    desyncTick,
    reconnectAttempts,
    maxReconnectAttempts,
  } = useMultiplayerStore();

  const [elapsedTime, setElapsedTime] = useState(0);
  const [showDesyncDetails, setShowDesyncDetails] = useState(false);

  // Update elapsed time during network pause
  useEffect(() => {
    if (!isNetworkPaused || !networkPauseStartTime) {
      setElapsedTime(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - networkPauseStartTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [isNetworkPaused, networkPauseStartTime]);

  // Don't render if not in multiplayer
  if (!isMultiplayer) {
    return null;
  }

  // Desync overlay - game cannot continue
  if (desyncState === 'desynced') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <div className="bg-void-900 border border-red-500/50 rounded-lg p-8 max-w-md text-center shadow-2xl">
          <div className="text-red-500 text-6xl mb-4">!</div>
          <h2 className="text-2xl font-display text-red-400 mb-4">Game Desynchronized</h2>
          <p className="text-void-300 mb-6">
            The game state has diverged between players at tick {desyncTick}.
            This can happen due to a bug or network issues. The game cannot continue.
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => setShowDesyncDetails(!showDesyncDetails)}
              className="text-void-400 text-sm hover:text-void-300 underline"
            >
              {showDesyncDetails ? 'Hide Details' : 'Show Technical Details'}
            </button>

            {showDesyncDetails && (
              <div className="bg-void-950 rounded p-3 text-left text-xs text-void-400 font-mono">
                <div>Desync Tick: {desyncTick}</div>
                <div>Connection Status: {connectionStatus}</div>
                <div className="mt-2 text-void-500">
                  In a deterministic RTS, both clients must have identical game state.
                  When checksums don't match, the games have diverged and cannot recover.
                </div>
              </div>
            )}

            <button
              onClick={() => {
                // Navigate back to menu
                window.location.href = '/';
              }}
              className="game-button-primary px-6 py-3 font-display"
            >
              Return to Menu
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Network pause overlay - waiting for connection
  if (isNetworkPaused) {
    const isFailed = connectionStatus === 'failed';

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="bg-void-900 border border-void-700 rounded-lg p-8 max-w-md text-center shadow-2xl">
          {isFailed ? (
            <>
              <div className="text-red-500 text-5xl mb-4">!</div>
              <h2 className="text-xl font-display text-red-400 mb-4">Connection Lost</h2>
              <p className="text-void-300 mb-6">
                Unable to reconnect to the other player after {maxReconnectAttempts} attempts.
              </p>
              <button
                onClick={() => {
                  window.location.href = '/';
                }}
                className="game-button-primary px-6 py-3 font-display"
              >
                Return to Menu
              </button>
            </>
          ) : (
            <>
              {/* Spinning loader */}
              <div className="w-16 h-16 mx-auto mb-6 border-4 border-void-600 border-t-void-400 rounded-full animate-spin" />

              <h2 className="text-xl font-display text-white mb-2">Waiting for Player</h2>
              <p className="text-void-400 mb-4">{networkPauseReason}</p>

              {elapsedTime > 0 && (
                <p className="text-void-500 text-sm mb-4">
                  Waiting for {elapsedTime}s...
                </p>
              )}

              {reconnectAttempts > 0 && (
                <div className="flex items-center justify-center gap-2 text-void-500 text-sm">
                  <span>Attempt {reconnectAttempts}/{maxReconnectAttempts}</span>
                  <div className="flex gap-1">
                    {Array.from({ length: maxReconnectAttempts }).map((_, i) => (
                      <div
                        key={i}
                        className={`w-2 h-2 rounded-full ${
                          i < reconnectAttempts ? 'bg-void-400' : 'bg-void-700'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  window.location.href = '/';
                }}
                className="mt-6 text-void-400 text-sm hover:text-void-300 underline"
              >
                Leave Game
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Connection status indicator (small, non-blocking)
  if (connectionStatus === 'connected') {
    return null; // Don't show anything when connected
  }

  // Show small connecting indicator
  if (connectionStatus === 'connecting') {
    return (
      <div className="fixed top-4 right-4 z-40 flex items-center gap-2 bg-void-900/90 border border-void-700 rounded-lg px-4 py-2">
        <div className="w-3 h-3 border-2 border-void-500 border-t-void-300 rounded-full animate-spin" />
        <span className="text-void-300 text-sm">Connecting...</span>
      </div>
    );
  }

  return null;
}

/**
 * ConnectionStatusIndicator - Small indicator for in-game HUD
 * Shows connection quality/status without blocking gameplay
 */
export function ConnectionStatusIndicator() {
  const { isMultiplayer, connectionStatus, isConnected } = useMultiplayerStore();

  if (!isMultiplayer) return null;

  const getStatusColor = (status: ConnectionStatus) => {
    switch (status) {
      case 'connected':
        return 'bg-green-500';
      case 'connecting':
      case 'reconnecting':
        return 'bg-yellow-500 animate-pulse';
      case 'waiting':
        return 'bg-orange-500 animate-pulse';
      case 'disconnected':
      case 'failed':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusText = (status: ConnectionStatus) => {
    switch (status) {
      case 'connected':
        return 'Online';
      case 'connecting':
        return 'Connecting';
      case 'reconnecting':
        return 'Reconnecting';
      case 'waiting':
        return 'Waiting';
      case 'disconnected':
        return 'Offline';
      case 'failed':
        return 'Failed';
      default:
        return status;
    }
  };

  return (
    <div className="flex items-center gap-1.5" title={`Multiplayer: ${getStatusText(connectionStatus)}`}>
      <div className={`w-2 h-2 rounded-full ${getStatusColor(connectionStatus)}`} />
      <span className="text-xs text-void-400">{getStatusText(connectionStatus)}</span>
    </div>
  );
}
