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
      setMultiplayer(true);
      setConnected(true);
      setHost(isHost);
      setDataChannel(p2pState.dataChannel);
      setPlayerSlotType('player1', 'human');
      setPlayerSlotType('player2', 'human');
      startGame();
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

  // Truncate code for display (show first and last parts)
  const getTruncatedCode = (code: string): string => {
    if (code.length <= 40) return code;
    return `${code.slice(0, 20)}...${code.slice(-16)}`;
  };

  const isLoading = ['generating_code', 'connecting', 'searching', 'match_found'].includes(p2pState.status);

  return (
    <main className="h-screen bg-black overflow-hidden">
      {/* Background - same as single player setup */}
      <div className="fixed inset-0 bg-gradient-to-b from-void-950/50 via-black to-black" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgba(132,61,255,0.1),transparent_70%)]" />

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col">
        {/* Header */}
        <div className="px-6 py-4">
          <Link href="/" className="text-void-400 hover:text-void-300 text-sm">
            &larr; Back to Menu
          </Link>
          <h1 className="font-display text-2xl text-white mt-1">Multiplayer</h1>
        </div>

        {/* Main Content */}
        <div className="flex-1 px-6 pb-6 flex flex-col">
          {/* Error Display */}
          {p2pState.error && (
            <div className="bg-red-900/30 border border-red-500/50 rounded px-4 py-3 mb-4 text-red-400">
              <div className="flex items-center justify-between">
                <span className="text-sm">{p2pState.error}</span>
                <button
                  onClick={handleCancel}
                  className="text-sm text-red-300 hover:text-red-200 underline ml-4"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Tab Buttons */}
          <div className="flex gap-2 mb-4">
            {(['host', 'join', 'find'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => { handleCancel(); setActiveTab(tab); }}
                className={`px-5 py-2.5 rounded text-sm font-medium transition ${
                  activeTab === tab
                    ? 'bg-void-600/80 text-white border border-void-500/50'
                    : 'bg-white/5 text-void-400 hover:bg-white/10 hover:text-void-300 border border-white/10'
                }`}
              >
                {tab === 'host' ? 'Host Game' : tab === 'join' ? 'Join with Code' : 'Find Match'}
              </button>
            ))}
          </div>

          {/* Main Panel */}
          <div className="flex-1 bg-black/40 border border-white/10 rounded-lg p-6 backdrop-blur-sm">
            {/* HOST TAB */}
            {activeTab === 'host' && (
              <div className="h-full flex flex-col">
                <h2 className="font-display text-xl text-white mb-2">Host a Game</h2>
                <p className="text-void-400 text-sm mb-4">
                  Generate a code to share with your friend, then paste their response code.
                </p>

                {p2pState.status === 'idle' && (
                  <button
                    onClick={handleHostGame}
                    className="self-start px-6 py-2.5 bg-void-600 hover:bg-void-500 text-white rounded font-medium transition"
                  >
                    Generate Code
                  </button>
                )}

                {p2pState.status === 'generating_code' && (
                  <div className="flex items-center gap-3 text-void-400">
                    <div className="w-4 h-4 border-2 border-void-500 border-t-transparent rounded-full animate-spin" />
                    <span>Generating connection code...</span>
                  </div>
                )}

                {p2pState.status === 'waiting_for_peer' && p2pState.offerCode && (
                  <div className="flex-1 flex flex-col space-y-4">
                    {/* Connection code display - compact */}
                    <div className="bg-void-900/50 border border-void-700/50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-void-400 text-xs uppercase tracking-wide">Your Code</span>
                        <span className="text-void-500 text-xs">{p2pState.offerCode.length} chars</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <code className="flex-1 text-void-200 font-mono text-sm truncate">
                          {getTruncatedCode(p2pState.offerCode)}
                        </code>
                        <button
                          onClick={handleCopyCode}
                          className={`px-4 py-1.5 rounded text-sm font-medium transition ${
                            copied
                              ? 'bg-green-600/20 text-green-400 border border-green-500/30'
                              : 'bg-void-700/50 text-void-300 hover:bg-void-600/50 border border-void-600/50'
                          }`}
                        >
                          {copied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>

                    {/* Response code input */}
                    <div className="flex-1 flex flex-col">
                      <label className="text-void-400 text-xs uppercase tracking-wide mb-2">
                        Friend&apos;s Response Code
                      </label>
                      <textarea
                        value={answerCode}
                        onChange={(e) => setAnswerCode(e.target.value)}
                        placeholder="Paste their response code here..."
                        className="flex-1 min-h-[100px] bg-void-900/50 border border-void-700/50 rounded-lg px-4 py-3 text-void-200 font-mono text-sm focus:border-void-500 focus:outline-none resize-none"
                      />
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={handleCancel}
                        className="px-5 py-2 bg-white/5 hover:bg-white/10 text-void-400 rounded border border-white/10 transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCompleteConnection}
                        disabled={!answerCode.trim() || isLoading}
                        className="px-5 py-2 bg-void-600 hover:bg-void-500 disabled:bg-void-800 disabled:text-void-500 text-white rounded font-medium transition"
                      >
                        Connect
                      </button>
                    </div>
                  </div>
                )}

                {p2pState.status === 'connecting' && (
                  <div className="flex items-center gap-3 text-void-400">
                    <div className="w-4 h-4 border-2 border-void-500 border-t-transparent rounded-full animate-spin" />
                    <span>Connecting to opponent...</span>
                  </div>
                )}
              </div>
            )}

            {/* JOIN TAB */}
            {activeTab === 'join' && (
              <div className="h-full flex flex-col">
                <h2 className="font-display text-xl text-white mb-2">Join with Code</h2>
                <p className="text-void-400 text-sm mb-4">
                  Paste your friend&apos;s connection code to join their game.
                </p>

                {(p2pState.status === 'idle' || p2pState.status === 'error') && (
                  <div className="flex-1 flex flex-col space-y-4">
                    <div className="flex-1 flex flex-col">
                      <label className="text-void-400 text-xs uppercase tracking-wide mb-2">
                        Connection Code
                      </label>
                      <textarea
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value)}
                        placeholder="Paste the connection code here..."
                        className="flex-1 min-h-[120px] bg-void-900/50 border border-void-700/50 rounded-lg px-4 py-3 text-void-200 font-mono text-sm focus:border-void-500 focus:outline-none resize-none"
                      />
                    </div>
                    <button
                      onClick={handleJoinGame}
                      disabled={!joinCode.trim()}
                      className="self-start px-6 py-2.5 bg-void-600 hover:bg-void-500 disabled:bg-void-800 disabled:text-void-500 text-white rounded font-medium transition"
                    >
                      Join Game
                    </button>
                  </div>
                )}

                {p2pState.status === 'connecting' && (
                  <div className="flex items-center gap-3 text-void-400">
                    <div className="w-4 h-4 border-2 border-void-500 border-t-transparent rounded-full animate-spin" />
                    <span>Processing code and connecting...</span>
                  </div>
                )}

                {p2pState.status === 'connected' && (
                  <div className="flex items-center gap-3 text-green-400">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Connected! Starting game...</span>
                  </div>
                )}
              </div>
            )}

            {/* FIND MATCH TAB */}
            {activeTab === 'find' && (
              <div className="h-full flex flex-col">
                <h2 className="font-display text-xl text-white mb-2">Find Match</h2>
                <p className="text-void-400 text-sm mb-4">
                  Search for opponents on the Nostr network. No accounts needed.
                </p>

                {p2pState.status === 'idle' && (
                  <button
                    onClick={handleFindMatch}
                    className="self-start px-6 py-2.5 bg-void-600 hover:bg-void-500 text-white rounded font-medium transition"
                  >
                    Find Opponent
                  </button>
                )}

                {(p2pState.status === 'searching' || p2pState.status === 'match_found') && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 border-2 border-void-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-void-300">
                        {p2pState.nostrStatus || getStatusMessage(p2pState.status)}
                      </span>
                    </div>

                    {p2pState.matchedOpponent && (
                      <div className="bg-void-900/50 border border-void-700/50 rounded-lg p-4">
                        <div className="text-void-400 text-xs uppercase tracking-wide mb-1">Matched with</div>
                        <code className="text-void-200 font-mono text-sm">
                          {p2pState.matchedOpponent.pubkey.slice(0, 16)}...
                        </code>
                      </div>
                    )}

                    <button
                      onClick={handleCancel}
                      className="px-5 py-2 bg-white/5 hover:bg-white/10 text-void-400 rounded border border-white/10 transition"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {p2pState.status === 'connecting' && (
                  <div className="flex items-center gap-3 text-void-400">
                    <div className="w-4 h-4 border-2 border-void-500 border-t-transparent rounded-full animate-spin" />
                    <span>{p2pState.nostrStatus || 'Connecting to opponent...'}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Info Footer */}
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
              <h3 className="text-void-300 text-sm font-medium mb-1">Connection Codes</h3>
              <p className="text-void-500 text-xs">Share with friends for direct connection</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
              <h3 className="text-void-300 text-sm font-medium mb-1">Nostr Network</h3>
              <p className="text-void-500 text-xs">Find opponents worldwide, no accounts</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
              <h3 className="text-void-300 text-sm font-medium mb-1">Peer-to-Peer</h3>
              <p className="text-void-500 text-xs">Direct connection, no servers</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
