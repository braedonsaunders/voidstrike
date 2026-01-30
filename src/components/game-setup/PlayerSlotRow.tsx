'use client';

import {
  PLAYER_COLORS,
  TEAM_COLORS,
  AIDifficulty,
  PlayerType,
  PlayerSlot,
  TeamNumber,
} from '@/store/gameSetupStore';
import { hexToCSS } from './utils';

interface PlayerSlotRowProps {
  slot: PlayerSlot;
  index: number;
  usedColors: Set<string>;
  onTypeChange: (type: PlayerType) => void;
  onFactionChange: (faction: string) => void;
  onColorChange: (colorId: string) => void;
  onDifficultyChange: (difficulty: AIDifficulty) => void;
  onTeamChange: (team: TeamNumber) => void;
  onRemove: () => void;
  canRemove: boolean;
  isLocalPlayer: boolean;
}

export function PlayerSlotRow({
  slot,
  index,
  usedColors,
  onTypeChange,
  onFactionChange,
  onColorChange,
  onDifficultyChange,
  onTeamChange,
  onRemove,
  canRemove,
  isLocalPlayer,
}: PlayerSlotRowProps) {
  const selectedColor = PLAYER_COLORS.find(c => c.id === slot.colorId);
  const isActive = slot.type === 'human' || slot.type === 'ai';
  const isGuest = slot.isGuest;

  return (
    <div className="flex items-center gap-2 p-1.5 bg-void-900/50 rounded-lg border border-void-800/50">
      {/* Player number */}
      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
           style={{ backgroundColor: hexToCSS(selectedColor?.hex ?? 0x808080), color: '#000' }}>
        {index + 1}
      </div>

        {/* Player type selector */}
        {!isGuest ? (
          isLocalPlayer ? (
            <span className="px-2 py-1 bg-void-600/50 border border-void-500/50 rounded text-white text-xs min-w-[70px]">
              {slot.name || 'You'}
            </span>
          ) : (
            <select
              value={slot.type}
              onChange={(e) => onTypeChange(e.target.value as PlayerType)}
              className="bg-void-800 border border-void-700 rounded px-2 py-1 text-white text-xs
                         focus:outline-none focus:border-void-500 cursor-pointer min-w-[70px]"
            >
              <option value="human">Human</option>
              <option value="ai">AI</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          )
        ) : (
          <span className="px-2 py-1 bg-green-800/50 border border-green-600/50 rounded text-green-300 text-xs">
            {slot.guestName || 'Guest'}
          </span>
        )}

        {/* Team selection (only for active players) */}
        {isActive && (
          <select
            value={slot.team}
            onChange={(e) => onTeamChange(Number(e.target.value) as TeamNumber)}
            disabled={isGuest}
            className="bg-void-800 border border-void-700 rounded px-2 py-1 text-white text-xs
                       focus:outline-none focus:border-void-500 cursor-pointer min-w-[65px]
                       disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ borderLeftColor: TEAM_COLORS[slot.team].color, borderLeftWidth: '3px' }}
          >
            {Object.entries(TEAM_COLORS).map(([key, { name }]) => (
              <option key={key} value={key}>{name}</option>
            ))}
          </select>
        )}

        {/* Faction (only for active players) */}
        {isActive && (
          <select
            value={slot.faction}
            onChange={(e) => onFactionChange(e.target.value)}
            disabled={isGuest}
            className="bg-void-800 border border-void-700 rounded px-2 py-1 text-white text-xs
                       focus:outline-none focus:border-void-500 cursor-pointer min-w-[80px]
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="dominion">Dominion</option>
          </select>
        )}

        {/* AI Difficulty (only for AI) */}
        {slot.type === 'ai' && !isGuest && (
          <select
            value={slot.aiDifficulty}
            onChange={(e) => onDifficultyChange(e.target.value as AIDifficulty)}
            className="bg-void-800 border border-void-700 rounded px-2 py-1 text-white text-xs
                       focus:outline-none focus:border-void-500 cursor-pointer min-w-[65px]"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
            <option value="insane">Insane</option>
          </select>
        )}

        {/* Open slot indicator */}
        {slot.type === 'open' && (
          <span className="text-void-500 text-xs italic">Waiting for player...</span>
        )}

      {/* Color selector (only for active players) */}
      {isActive && (
        <div className="flex gap-0.5 ml-auto">
          {PLAYER_COLORS.map((color) => {
            const isUsed = usedColors.has(color.id) && slot.colorId !== color.id;
            return (
              <button
                key={color.id}
                onClick={() => !isUsed && !isGuest && onColorChange(color.id)}
                title={color.name}
                disabled={isUsed || isGuest}
                className={`w-4 h-4 rounded-full transition-all duration-200
                  ${slot.colorId === color.id
                    ? 'ring-2 ring-white scale-110'
                    : isUsed || isGuest
                      ? 'opacity-30 cursor-not-allowed'
                      : 'hover:scale-110'
                  }`}
                style={{ backgroundColor: hexToCSS(color.hex) }}
              />
            );
          })}
        </div>
      )}

      {/* Remove button */}
      {canRemove && !isLocalPlayer && (
        <button
          onClick={onRemove}
          className="w-5 h-5 flex items-center justify-center text-void-500 hover:text-red-400
                     hover:bg-red-900/30 rounded transition-colors text-xs flex-shrink-0"
          title={isGuest ? 'Kick player' : 'Remove player'}
        >
          ✕
        </button>
      )}
    </div>
  );
}
