'use client';

import { useGameStore } from '@/store/gameStore';
import { useUIStore } from '@/store/uiStore';
import { useEffect } from 'react';

interface ShortcutCategory {
  name: string;
  shortcuts: { key: string; description: string }[];
}

const SHORTCUTS: ShortcutCategory[] = [
  {
    name: 'Camera',
    shortcuts: [
      { key: 'W A S D / Arrow Keys', description: 'Pan camera' },
      { key: 'Q / E', description: 'Rotate camera' },
      { key: 'Mouse Wheel', description: 'Zoom in/out' },
      { key: 'Edge of Screen', description: 'Pan in direction' },
      { key: 'F5-F8', description: 'Jump to saved location' },
      { key: 'Ctrl + F5-F8', description: 'Save camera location' },
    ],
  },
  {
    name: 'Selection',
    shortcuts: [
      { key: 'Left Click', description: 'Select unit/building' },
      { key: 'Left Drag', description: 'Box select units' },
      { key: 'Shift + Click', description: 'Add/remove from selection' },
      { key: 'Ctrl + Click', description: 'Select all of same type on screen' },
      { key: 'Ctrl + 1-9', description: 'Create control group' },
      { key: '1-9', description: 'Select control group' },
      { key: 'Double-tap 1-9', description: 'Center camera on group' },
      { key: 'Tab', description: 'Cycle subgroups in selection' },
    ],
  },
  {
    name: 'Commands',
    shortcuts: [
      { key: 'Right Click', description: 'Move / Attack-move / Gather' },
      { key: 'A + Click', description: 'Attack-move command' },
      { key: 'M + Click', description: 'Move command' },
      { key: 'P + Click', description: 'Patrol to location' },
      { key: 'S', description: 'Stop all actions' },
      { key: 'H', description: 'Hold position' },
      { key: 'Shift + Command', description: 'Queue command' },
    ],
  },
  {
    name: 'Production',
    shortcuts: [
      { key: 'B', description: 'Build basic structure' },
      { key: 'V', description: 'Build advanced structure' },
      { key: 'Q W E R', description: 'Train units (slot 1-4)' },
      { key: 'Escape / Right-Click', description: 'Cancel current action' },
    ],
  },
  {
    name: 'Interface',
    shortcuts: [
      { key: 'F1', description: 'Select idle worker' },
      { key: 'T', description: 'Open tech tree' },
      { key: 'Space', description: 'Center on last alert' },
      { key: 'Pause', description: 'Pause game' },
      { key: '?', description: 'Toggle this help panel' },
    ],
  },
];

/**
 * Keyboard shortcuts help panel
 * NOTE: Edge scrolling is now controlled centrally by HUD.tsx via isAnyMenuOpen selector
 */
export function KeyboardShortcutsPanel() {
  const { showKeyboardShortcuts, setShowKeyboardShortcuts } = useGameStore();

  // Close on escape
  useEffect(() => {
    if (!showKeyboardShortcuts) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        // Prevent ESC from exiting fullscreen when closing the panel
        if (e.key === 'Escape' && useUIStore.getState().isFullscreen) {
          e.preventDefault();
        }
        setShowKeyboardShortcuts(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showKeyboardShortcuts, setShowKeyboardShortcuts]);

  if (!showKeyboardShortcuts) return null;

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center pointer-events-auto z-50">
      <div className="bg-void-950 border border-void-700 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-void-800">
          <h2 className="font-display text-2xl text-white">Keyboard Shortcuts</h2>
          <button
            onClick={() => setShowKeyboardShortcuts(false)}
            className="text-void-400 hover:text-white transition-colors text-2xl"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {SHORTCUTS.map((category) => (
              <div key={category.name}>
                <h3 className="font-display text-lg text-void-300 mb-3 border-b border-void-800 pb-2">
                  {category.name}
                </h3>
                <div className="space-y-2">
                  {category.shortcuts.map((shortcut, index) => (
                    <div key={index} className="flex items-start gap-3">
                      <kbd className="bg-void-800 text-void-200 px-2 py-1 rounded text-xs font-mono min-w-[80px] text-center shrink-0">
                        {shortcut.key}
                      </kbd>
                      <span className="text-void-400 text-sm">{shortcut.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer hint */}
          <div className="mt-6 pt-4 border-t border-void-800 text-center text-void-500 text-sm">
            Press <kbd className="bg-void-800 px-2 py-0.5 rounded">?</kbd> or{' '}
            <kbd className="bg-void-800 px-2 py-0.5 rounded">Esc</kbd> to close
          </div>
        </div>
      </div>
    </div>
  );
}
