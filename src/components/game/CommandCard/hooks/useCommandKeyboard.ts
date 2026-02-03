import { useEffect } from 'react';
import { getRenderStateAdapter } from '@/engine/workers';
import { CommandButtonData, MenuMode } from '../types';

interface UseCommandKeyboardParams {
  menuMode: MenuMode;
  setMenuMode: (mode: MenuMode) => void;
  selectedUnits: number[];
  commands: CommandButtonData[];
}

/**
 * Handle keyboard shortcuts for the command card.
 */
export function useCommandKeyboard({
  menuMode,
  setMenuMode,
  selectedUnits,
  commands,
}: UseCommandKeyboardParams): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // ESC to go back in menus
      if (e.key === 'Escape' && menuMode !== 'main') {
        e.stopPropagation();
        setMenuMode('main');
        return;
      }

      // Helper to check if selected entity is a worker
      const isWorkerSelected = (): boolean => {
        if (selectedUnits.length === 0) return false;
        const worldAdapter = getRenderStateAdapter();
        const entity = worldAdapter.getEntity(selectedUnits[0]);
        const unit = entity?.get<{ isWorker: boolean }>('Unit');
        return unit?.isWorker ?? false;
      };

      // Hotkey B for Build Basic
      if (e.key.toLowerCase() === 'b' && menuMode === 'main' && isWorkerSelected()) {
        setMenuMode('build_basic');
        return;
      }

      // Hotkey V for Build Advanced
      if (e.key.toLowerCase() === 'v' && menuMode === 'main' && isWorkerSelected()) {
        setMenuMode('build_advanced');
        return;
      }

      // Hotkey W for Build Walls
      if (e.key.toLowerCase() === 'w' && menuMode === 'main' && isWorkerSelected()) {
        setMenuMode('build_walls');
        return;
      }

      // Handle building shortcuts when in build submenus
      if (menuMode === 'build_basic' || menuMode === 'build_advanced' || menuMode === 'build_walls') {
        const pressedKey = e.key.toUpperCase();
        const matchingCommand = commands.find(
          (cmd) => cmd.shortcut === pressedKey && cmd.id !== 'back' && !cmd.isDisabled
        );
        if (matchingCommand) {
          e.preventDefault();
          e.stopPropagation();
          matchingCommand.action();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuMode, selectedUnits, commands, setMenuMode]);
}
