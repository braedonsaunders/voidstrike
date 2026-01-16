'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { useUIStore } from '@/store/uiStore';
import { useMultiplayerStore } from '@/store/multiplayerStore';
import { useGameSetupStore } from '@/store/gameSetupStore';
import { useP2P, P2PStatus } from '@/hooks/useP2P';

type Tab = 'host' | 'join' | 'find';

export default function LobbyPage() {
  const router = useRouter();
  const musicEnabled = useUIStore((state) => state.musicEnabled);
  const musicVolume = useUIStore((state) => state.musicVolume);

  // Multiplayer and game setup stores
  const {
    setMultiplayer,
    setConnected,
    setHost,
    setDataChannel,
  } = useMultiplayerStore();

  const {
    startGame,
    setPlayerSlotType,
  } = useGameSetupStore();

  const {
    state: p2pState,
    hostGame,
    joinWithCode,
    completeWithAnswerCode,
    findMatch,
    cancelSearch,
    disconnect,
    onMessage,
  } = useP2P();

  const [isHost, setIsHostLocal] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>('host');
  const [joinCode, setJoinCode] = useState('');
  const [answerCode, setAnswerCode] = useState('');
  const [copied, setCopied] = useState(false);

  // Continue menu music
  useEffect(() => {
    const initMusic = async () => {
      await MusicPlayer.initialize();
      MusicPlayer.setVolume(musicVolume);
      MusicPlayer.setMuted(!musicEnabled);
      await MusicPlayer.discoverTracks();
      if (musicEnabled && MusicPlayer.getCurrentCategory() !== 'menu') {
        MusicPlayer.play('menu');
      }
    };
    initMusic();
  }, []);

  useEffect(() => {
    MusicPlayer.setVolume(musicVolume);
    MusicPlayer.setMuted(!musicEnabled);
  }, [musicVolume, musicEnabled]);

  // Navigate to game when connected
  useEffect(() => {
    if (p2pState.status === 'connected' && p2pState.dataChannel) {
      // Set up multiplayer store
      setMultiplayer(true);
      setConnected(true);
      setHost(isHost);
      setDataChannel(p2pState.dataChannel);

      // Configure game for 2 human players
      setPlayerSlotType('player1', 'human');
      setPlayerSlotType('player2', 'human');

      // Start the game
      startGame();

      // Navigate to game
      router.push('/game?multiplayer=true');
    }
  }, [p2pState.status, p2pState.dataChannel, isHost, router, setMultiplayer, setConnected, setHost, setDataChannel, setPlayerSlotType, startGame]);

  // Handle message events
  useEffect(() => {
    onMessage((data) => {
      console.log('[Lobby] Received message:', data);
    });
  }, [onMessage]);

  const handleCopyCode = useCallback(() => {
    if (p2pState.offerCode) {
      navigator.clipboard.writeText(p2pState.offerCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [p2pState.offerCode]);

  const handleHostGame = useCallback(async () => {
    setIsHostLocal(true);
    await hostGame({ mode: '1v1' });
  }, [hostGame]);

  const handleJoinGame = useCallback(async () => {
    if (joinCode.trim()) {
      setIsHostLocal(false);
      await joinWithCode(joinCode.trim());
    }
  }, [joinCode, joinWithCode]);

  const handleCompleteConnection = useCallback(async () => {
    if (answerCode.trim()) {
      await completeWithAnswerCode(answerCode.trim());
    }
  }, [answerCode, completeWithAnswerCode]);

  const handleFindMatch = useCallback(async () => {
    await findMatch({ mode: '1v1' });
  }, [findMatch]);

  const handleCancel = useCallback(() => {
    disconnect();
    cancelSearch();
    setJoinCode('');
    setAnswerCode('');
  }, [disconnect, cancelSearch]);

  const getStatusMessage = (status: P2PStatus): string => {
    switch (status) {
      case 'idle': return 'Ready';
      case 'generating_code': return 'Generating connection code...';
      case 'waiting_for_peer': return 'Waiting for opponent...';
      case 'connecting': return 'Connecting...';
      case 'connected': return 'Connected!';
      case 'searching': return 'Searching for opponents...';
      case 'match_found': return 'Match found!';
      case 'error': return 'Error';
      default: return '';
    }
  };

  const isLoading = ['generating_code', 'connecting', 'searching', 'match_found'].includes(p2pState.status);

  return (
    <main className="min-h-screen bg-black p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link href="/" className="text-void-500 hover:text-void-400 transition">
            ← Back to Menu
          </Link>
          <h1 className="font-display text-4xl text-void-300 mt-2">Multiplayer</h1>
          <p className="text-void-500 mt-1">
            Play with friends using connection codes, or find opponents via Nostr
          </p>
        </div>

        {/* Error Display */}
        {p2pState.error && (
          <div className="bg-red-900/30 border border-red-500/50 rounded px-4 py-3 mb-6 text-red-400">
            <div className="font-semibold">Error</div>
            <div className="text-sm">{p2pState.error}</div>
            <button
              onClick={handleCancel}
              className="mt-2 text-sm text-red-300 hover:text-red-200 underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Tab Buttons */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => { handleCancel(); setActiveTab('host'); }}
            className={`px-6 py-3 rounded font-medium transition ${
              activeTab === 'host'
                ? 'bg-void-700 text-void-200'
                : 'bg-void-900 text-void-500 hover:bg-void-800 hover:text-void-400'
            }`}
          >
            Host Game
          </button>
          <button
            onClick={() => { handleCancel(); setActiveTab('join'); }}
            className={`px-6 py-3 rounded font-medium transition ${
              activeTab === 'join'
                ? 'bg-void-700 text-void-200'
                : 'bg-void-900 text-void-500 hover:bg-void-800 hover:text-void-400'
            }`}
          >
            Join with Code
          </button>
          <button
            onClick={() => { handleCancel(); setActiveTab('find'); }}
            className={`px-6 py-3 rounded font-medium transition ${
              activeTab === 'find'
                ? 'bg-void-700 text-void-200'
                : 'bg-void-900 text-void-500 hover:bg-void-800 hover:text-void-400'
            }`}
          >
            Find Match
          </button>
        </div>

        {/* Main Panel */}
        <div className="game-panel p-8">
          {/* HOST TAB */}
          {activeTab === 'host' && (
            <div>
              <h2 className="font-display text-2xl text-void-300 mb-4">Host a Game</h2>
              <p className="text-void-500 mb-6">
                Generate a connection code and share it with your friend. They&apos;ll send back a response code to complete the connection.
              </p>

              {p2pState.status === 'idle' && (
                <button
                  onClick={handleHostGame}
                  className="game-button-primary px-8 py-3 text-lg"
                >
                  Generate Code
                </button>
              )}

              {p2pState.status === 'generating_code' && (
                <div className="text-void-400">
                  <div className="animate-pulse">Generating connection code...</div>
                </div>
              )}

              {p2pState.status === 'waiting_for_peer' && p2pState.offerCode && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-void-500 text-sm mb-2">Your Connection Code</label>
                    <div className="bg-void-900 border border-void-700 rounded p-4">
                      <div className="font-mono text-void-200 text-lg break-all select-all">
                        {p2pState.offerCode}
                      </div>
                    </div>
                    <button
                      onClick={handleCopyCode}
                      className="mt-2 text-void-400 hover:text-void-300 text-sm"
                    >
                      {copied ? '✓ Copied!' : 'Copy to clipboard'}
                    </button>
                  </div>

                  <div>
                    <label className="block text-void-500 text-sm mb-2">
                      Enter Friend&apos;s Response Code
                    </label>
                    <textarea
                      value={answerCode}
                      onChange={(e) => setAnswerCode(e.target.value)}
                      placeholder="Paste their response code here..."
                      className="w-full bg-void-900 border border-void-700 rounded px-4 py-3 text-void-200 font-mono text-sm focus:border-void-500 focus:outline-none h-32 resize-none"
                    />
                  </div>

                  <div className="flex gap-4">
                    <button
                      onClick={handleCancel}
                      className="game-button px-6 py-2"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCompleteConnection}
                      disabled={!answerCode.trim() || isLoading}
                      className="game-button-primary px-6 py-2 disabled:opacity-50"
                    >
                      Connect
                    </button>
                  </div>
                </div>
              )}

              {p2pState.status === 'connecting' && (
                <div className="text-void-400">
                  <div className="animate-pulse">Connecting to opponent...</div>
                </div>
              )}
            </div>
          )}

          {/* JOIN TAB */}
          {activeTab === 'join' && (
            <div>
              <h2 className="font-display text-2xl text-void-300 mb-4">Join with Code</h2>
              <p className="text-void-500 mb-6">
                Enter the connection code from your friend. A response code will be generated for you to send back.
              </p>

              {(p2pState.status === 'idle' || p2pState.status === 'error') && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-void-500 text-sm mb-2">Connection Code</label>
                    <textarea
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value)}
                      placeholder="Paste the connection code here..."
                      className="w-full bg-void-900 border border-void-700 rounded px-4 py-3 text-void-200 font-mono text-sm focus:border-void-500 focus:outline-none h-32 resize-none"
                    />
                  </div>
                  <button
                    onClick={handleJoinGame}
                    disabled={!joinCode.trim()}
                    className="game-button-primary px-8 py-3 disabled:opacity-50"
                  >
                    Join Game
                  </button>
                </div>
              )}

              {p2pState.status === 'connecting' && (
                <div className="text-void-400">
                  <div className="animate-pulse">Processing code and connecting...</div>
                </div>
              )}

              {p2pState.status === 'connected' && p2pState.offerCode && (
                <div className="space-y-6">
                  <div className="text-green-400 font-semibold">
                    ✓ Connected! Redirecting to game...
                  </div>
                </div>
              )}
            </div>
          )}

          {/* FIND MATCH TAB */}
          {activeTab === 'find' && (
            <div>
              <h2 className="font-display text-2xl text-void-300 mb-4">Find Match</h2>
              <p className="text-void-500 mb-6">
                Search for opponents using the Nostr network. This connects you with players worldwide, no server required.
              </p>

              {p2pState.status === 'idle' && (
                <button
                  onClick={handleFindMatch}
                  className="game-button-primary px-8 py-3 text-lg"
                >
                  Find Opponent
                </button>
              )}

              {(p2pState.status === 'searching' || p2pState.status === 'match_found') && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 bg-void-500 rounded-full animate-pulse" />
                    <span className="text-void-300">
                      {p2pState.nostrStatus || getStatusMessage(p2pState.status)}
                    </span>
                  </div>

                  {p2pState.matchedOpponent && (
                    <div className="bg-void-900 border border-void-700 rounded p-4">
                      <div className="text-void-400 text-sm">Matched with:</div>
                      <div className="text-void-200 font-mono">
                        {p2pState.matchedOpponent.pubkey.slice(0, 16)}...
                      </div>
                      {p2pState.matchedOpponent.skill && (
                        <div className="text-void-400 text-sm mt-1">
                          Skill: ~{p2pState.matchedOpponent.skill}
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={handleCancel}
                    className="game-button px-6 py-2"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {p2pState.status === 'connecting' && (
                <div className="text-void-400">
                  <div className="animate-pulse">
                    {p2pState.nostrStatus || 'Connecting to opponent...'}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Status Footer */}
          {p2pState.status !== 'idle' && p2pState.status !== 'error' && (
            <div className="mt-8 pt-4 border-t border-void-800">
              <div className="text-void-500 text-sm">
                Status: <span className="text-void-400">{getStatusMessage(p2pState.status)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-3 gap-6 mt-8">
          <div className="game-panel p-4">
            <h3 className="font-display text-lg text-void-300 mb-2">Connection Codes</h3>
            <p className="text-void-500 text-sm">
              Share a code with friends to connect directly. Works with any internet connection.
            </p>
          </div>

          <div className="game-panel p-4">
            <h3 className="font-display text-lg text-void-300 mb-2">Nostr Network</h3>
            <p className="text-void-500 text-sm">
              Find opponents worldwide using the decentralized Nostr network. No accounts needed.
            </p>
          </div>

          <div className="game-panel p-4">
            <h3 className="font-display text-lg text-void-300 mb-2">Peer-to-Peer</h3>
            <p className="text-void-500 text-sm">
              Direct connection between players. No servers, no lag, no downtime.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
