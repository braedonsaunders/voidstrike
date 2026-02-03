'use client';

import { memo, ReactNode, MouseEvent } from 'react';

interface CommandButtonProps {
  icon: ReactNode;
  label: string;
  shortcut: string;
  onClick: () => void;
  onDisabledClick?: () => void;
  isDisabled?: boolean;
  hasCost?: boolean;
  isBackButton?: boolean;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Reusable command button for the command card grid.
 * Displays icon, label, and hotkey badge with disabled/back button variants.
 */
function CommandButtonInner({
  icon,
  label,
  shortcut,
  onClick,
  onDisabledClick,
  isDisabled = false,
  hasCost = false,
  isBackButton = false,
  width = 72,
  height = 58,
  className = '',
}: CommandButtonProps) {
  const handleClick = (e: MouseEvent) => {
    if (isDisabled) {
      e.preventDefault();
      onDisabledClick?.();
      return;
    }
    onClick();
  };

  return (
    <button
      className={`
        relative flex flex-col items-center justify-center
        bg-gradient-to-b from-void-800/80 to-void-900/80
        border rounded
        transition-all duration-100
        ${
          isDisabled
            ? 'opacity-40 cursor-not-allowed border-void-700/30'
            : 'border-void-600/50 hover:from-void-700 hover:to-void-800 hover:border-blue-400/60 active:scale-95'
        }
        ${isBackButton ? 'bg-gradient-to-b from-void-700/80 to-void-800/80' : ''}
        ${className}
      `}
      style={{ width: `${width}px`, height: `${height}px` }}
      onClick={handleClick}
      disabled={isDisabled && !onDisabledClick}
    >
      {/* Icon */}
      <span className="text-lg leading-none mb-0.5">{icon}</span>

      {/* Label */}
      <span className="text-[8px] text-void-300 w-full text-center leading-tight px-0.5 line-clamp-2">
        {label}
      </span>

      {/* Hotkey badge */}
      <span className="absolute bottom-0 right-0.5 text-[7px] text-void-500 font-mono">
        {shortcut}
      </span>

      {/* Can't afford indicator */}
      {hasCost && isDisabled && (
        <div className="absolute inset-0 border border-red-500/40 rounded pointer-events-none" />
      )}
    </button>
  );
}

export const CommandButton = memo(CommandButtonInner);
