'use client';

interface JoinLobbyModalProps {
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  joinCode: string;
  onJoinCodeChange: (code: string) => void;
  lobbyStatus: string;
  lobbyError: string | null;
  onJoin: () => void;
  onClose: () => void;
}

export function JoinLobbyModal({
  playerName,
  onPlayerNameChange,
  joinCode,
  onJoinCodeChange,
  lobbyStatus,
  lobbyError,
  onJoin,
  onClose,
}: JoinLobbyModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="bg-void-900 border border-void-700 rounded-lg p-6 max-w-sm w-full mx-4">
        <h2 className="font-display text-xl text-white mb-4">Join Game</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-void-300 text-sm mb-1">Your Name</label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => onPlayerNameChange(e.target.value)}
              placeholder="Enter your name"
              className="w-full bg-void-800 border border-void-600 rounded px-3 py-2 text-white"
            />
          </div>

          <div>
            <label className="block text-void-300 text-sm mb-1">Lobby Code</label>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => onJoinCodeChange(e.target.value.toUpperCase())}
              placeholder="XXXX"
              maxLength={4}
              className="w-full bg-void-800 border border-void-600 rounded px-3 py-2 text-white
                         font-mono text-2xl text-center tracking-widest uppercase"
            />
          </div>

          {lobbyStatus === 'joining' && (
            <p className="text-void-400 text-sm text-center">Looking for lobby...</p>
          )}

          {lobbyError && (
            <p className="text-red-400 text-sm text-center">{lobbyError}</p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-void-800 hover:bg-void-700 text-white rounded transition"
          >
            Cancel
          </button>
          <button
            onClick={onJoin}
            disabled={joinCode.length !== 4 || lobbyStatus === 'joining'}
            className="flex-1 px-4 py-2 bg-void-500 hover:bg-void-400 disabled:bg-void-700
                       disabled:cursor-not-allowed text-white rounded transition"
          >
            Join
          </button>
        </div>
      </div>
    </div>
  );
}
