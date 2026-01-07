'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import * as Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore } from '@/store/gameSetupStore';
import { SelectionBox } from '@/components/game/SelectionBox';

interface PhaserGameProps {
  onGameReady?: () => void;
}

export function PhaserGame({ onGameReady }: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<GameScene | null>(null);

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState({ x: 0, y: 0 });
  const [selectionEnd, setSelectionEnd] = useState({ x: 0, y: 0 });

  const { isBuilding, buildingType, isSettingRallyPoint, abilityTargetMode } = useGameStore();

  // Initialize Phaser game
  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.WEBGL,
      parent: containerRef.current,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: '#1a1a2e',
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: {
        pixelArt: false,
        antialias: true,
        antialiasGL: true,
      },
      scene: [GameScene],
      physics: {
        default: 'arcade',
        arcade: {
          debug: false,
        },
      },
      input: {
        mouse: {
          preventDefaultWheel: true,
        },
      },
    };

    gameRef.current = new Phaser.Game(config);

    // Get scene reference once it's ready
    gameRef.current.events.once('ready', () => {
      sceneRef.current = gameRef.current!.scene.getScene('GameScene') as GameScene;

      // Set up event bridge from Phaser to React
      if (sceneRef.current) {
        sceneRef.current.events.on('selection-start', (data: { x: number; y: number }) => {
          setIsSelecting(true);
          setSelectionStart(data);
          setSelectionEnd(data);
        });

        sceneRef.current.events.on('selection-move', (data: { x: number; y: number }) => {
          setSelectionEnd(data);
        });

        sceneRef.current.events.on('selection-end', () => {
          setIsSelecting(false);
        });
      }

      onGameReady?.();
    });

    // Handle resize
    const handleResize = () => {
      if (gameRef.current) {
        gameRef.current.scale.resize(window.innerWidth, window.innerHeight);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
        sceneRef.current = null;
      }
    };
  }, [onGameReady]);

  // Handle keyboard shortcuts that affect React state
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const scene = sceneRef.current;
      if (!scene) return;

      switch (e.key.toLowerCase()) {
        case 'escape':
          if (isSettingRallyPoint) {
            useGameStore.getState().setRallyPointMode(false);
          } else if (abilityTargetMode) {
            useGameStore.getState().setAbilityTargetMode(null);
          } else if (isBuilding) {
            useGameStore.getState().setBuildingMode(null);
          }
          break;
        case '?':
          {
            const store = useGameStore.getState();
            store.setShowKeyboardShortcuts(!store.showKeyboardShortcuts);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBuilding, isSettingRallyPoint, abilityTargetMode]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {isSelecting && (
        <SelectionBox
          startX={selectionStart.x}
          startY={selectionStart.y}
          endX={selectionEnd.x}
          endY={selectionEnd.y}
        />
      )}

      {isBuilding && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-void-600">
          <span className="text-void-300">
            Placing {buildingType} - Click to place, ESC to cancel
          </span>
        </div>
      )}

      {isSettingRallyPoint && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-green-600">
          <span className="text-green-400">
            Set Rally Point - Right-click to set, ESC to cancel
          </span>
        </div>
      )}

      {abilityTargetMode && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-purple-600">
          <span className="text-purple-400">
            Select Target - Click location, ESC to cancel
          </span>
        </div>
      )}
    </div>
  );
}
