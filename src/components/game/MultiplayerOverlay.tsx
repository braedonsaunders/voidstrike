'use client';

import { useEffect, useState } from 'react';
import {
  useMultiplayerStore,
  ConnectionStatus,
  DesyncState,
  ConnectionQuality,
  LatencyStats,
} from '@/store/multiplayerStore';

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
  const {
    isMultiplayer,
    connectionStatus,
    connectionQuality,
    latencyStats,
  } = useMultiplayerStore();

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

/**
 * ConnectionQualityIndicator - Shows detailed latency and connection quality
 * For use in HUD or settings overlay
 */
export function ConnectionQualityIndicator({ showDetails = false }: { showDetails?: boolean }) {
  const {
    isMultiplayer,
    connectionStatus,
    connectionQuality,
    latencyStats,
  } = useMultiplayerStore();

  // Update latency display periodically
  const [displayStats, setDisplayStats] = useState<LatencyStats | null>(null);

  useEffect(() => {
    if (!isMultiplayer || connectionStatus !== 'connected') {
      setDisplayStats(null);
      return;
    }

    // Update every 500ms
    const interval = setInterval(() => {
      setDisplayStats(useMultiplayerStore.getState().latencyStats);
    }, 500);

    return () => clearInterval(interval);
  }, [isMultiplayer, connectionStatus]);

  if (!isMultiplayer) return null;

  const getQualityColor = (quality: ConnectionQuality) => {
    switch (quality) {
      case 'excellent':
        return 'text-green-400';
      case 'good':
        return 'text-lime-400';
      case 'poor':
        return 'text-yellow-400';
      case 'critical':
        return 'text-red-400';
      default:
        return 'text-void-400';
    }
  };

  const getQualityIcon = (quality: ConnectionQuality) => {
    switch (quality) {
      case 'excellent':
        return '▓▓▓▓'; // 4 bars
      case 'good':
        return '▓▓▓░'; // 3 bars
      case 'poor':
        return '▓▓░░'; // 2 bars
      case 'critical':
        return '▓░░░'; // 1 bar
      default:
        return '░░░░';
    }
  };

  if (connectionStatus !== 'connected' || !displayStats) {
    return (
      <div className="flex items-center gap-2 text-void-500 text-xs">
        <span className="font-mono">---</span>
        <span>ms</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* Signal bars */}
      <span className={`font-mono text-xs ${getQualityColor(connectionQuality)}`}>
        {getQualityIcon(connectionQuality)}
      </span>

      {/* Latency */}
      <span className={`font-mono text-xs ${getQualityColor(connectionQuality)}`}>
        {Math.round(displayStats.averageRTT)}ms
      </span>

      {/* Extended details */}
      {showDetails && (
        <div className="flex items-center gap-3 text-void-500 text-xs">
          <span title="Jitter">±{Math.round(displayStats.jitter)}ms</span>
          <span title="Min/Max RTT">
            {Math.round(displayStats.minRTT === Infinity ? 0 : displayStats.minRTT)}-
            {Math.round(displayStats.maxRTT)}ms
          </span>
          {displayStats.packetsSent > 0 && (
            <span title="Packet loss">
              {((displayStats.packetsLost / displayStats.packetsSent) * 100).toFixed(1)}% loss
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * LatencyGraph - Visual representation of latency over time
 * For use in debug overlay or network settings
 */
export function LatencyDisplay() {
  const {
    isMultiplayer,
    connectionStatus,
    connectionQuality,
    latencyStats,
  } = useMultiplayerStore();

  const [stats, setStats] = useState<LatencyStats | null>(null);

  useEffect(() => {
    if (!isMultiplayer || connectionStatus !== 'connected') {
      setStats(null);
      return;
    }

    const interval = setInterval(() => {
      setStats(useMultiplayerStore.getState().latencyStats);
    }, 250);

    return () => clearInterval(interval);
  }, [isMultiplayer, connectionStatus]);

  if (!isMultiplayer || connectionStatus !== 'connected' || !stats) {
    return null;
  }

  const getQualityLabel = (quality: ConnectionQuality) => {
    switch (quality) {
      case 'excellent':
        return 'Excellent';
      case 'good':
        return 'Good';
      case 'poor':
        return 'Poor';
      case 'critical':
        return 'Critical';
      default:
        return 'Unknown';
    }
  };

  const getQualityBgColor = (quality: ConnectionQuality) => {
    switch (quality) {
      case 'excellent':
        return 'bg-green-500/20 border-green-500/50';
      case 'good':
        return 'bg-lime-500/20 border-lime-500/50';
      case 'poor':
        return 'bg-yellow-500/20 border-yellow-500/50';
      case 'critical':
        return 'bg-red-500/20 border-red-500/50';
      default:
        return 'bg-void-500/20 border-void-500/50';
    }
  };

  return (
    <div className={`rounded-lg border p-3 ${getQualityBgColor(connectionQuality)}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-void-300 text-sm font-medium">Network Quality</span>
        <span className="text-sm font-bold">{getQualityLabel(connectionQuality)}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex justify-between">
          <span className="text-void-500">Ping:</span>
          <span className="font-mono">{Math.round(stats.averageRTT)}ms</span>
        </div>
        <div className="flex justify-between">
          <span className="text-void-500">Jitter:</span>
          <span className="font-mono">±{Math.round(stats.jitter)}ms</span>
        </div>
        <div className="flex justify-between">
          <span className="text-void-500">Min:</span>
          <span className="font-mono">{Math.round(stats.minRTT === Infinity ? 0 : stats.minRTT)}ms</span>
        </div>
        <div className="flex justify-between">
          <span className="text-void-500">Max:</span>
          <span className="font-mono">{Math.round(stats.maxRTT)}ms</span>
        </div>
        <div className="flex justify-between col-span-2">
          <span className="text-void-500">Packet Loss:</span>
          <span className="font-mono">
            {stats.packetsSent > 0
              ? `${((stats.packetsLost / stats.packetsSent) * 100).toFixed(1)}%`
              : '0%'}
            {' '}({stats.packetsLost}/{stats.packetsSent})
          </span>
        </div>
      </div>
    </div>
  );
}
