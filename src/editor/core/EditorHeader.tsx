/**
 * EditorHeader - Top bar with title, controls, and actions
 */

'use client';

import { useRef } from 'react';
import type { EditorConfig, EditorMapData } from '../config/EditorConfig';

export interface EditorHeaderProps {
  config: EditorConfig;
  mapName: string;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  musicEnabled: boolean;
  isFullscreen: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCancel: () => void;
  onPreview?: () => void;
  onImport?: (data: EditorMapData) => void;
  onExport?: () => void;
  onToggleMusic: () => void;
  onToggleFullscreen: () => void;
}

export function EditorHeader({
  config,
  mapName,
  isDirty,
  canUndo,
  canRedo,
  musicEnabled,
  isFullscreen,
  onUndo,
  onRedo,
  onCancel,
  onPreview,
  onImport,
  onExport,
  onToggleMusic,
  onToggleFullscreen,
}: EditorHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file import
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImport) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        onImport(json);
      } catch (err) {
        console.error('Failed to parse map JSON:', err);
        alert('Invalid map file. Please select a valid JSON map file.');
      }
    };
    reader.readAsText(file);

    // Reset input so same file can be selected again
    e.target.value = '';
  };

  return (
    <header
      className="flex-shrink-0 h-12 flex items-center px-4 border-b"
      style={{
        backgroundColor: 'var(--editor-surface)',
        borderColor: 'var(--editor-border)',
      }}
    >
      {/* Left section: Back and title */}
      <div className="flex items-center gap-4 flex-1">
        <button
          onClick={onCancel}
          className="text-sm transition-colors hover:opacity-80"
          style={{ color: 'var(--editor-text-secondary)' }}
        >
          &larr; Back
        </button>

        <div
          className="h-5 w-px"
          style={{ backgroundColor: 'var(--editor-border)' }}
        />

        <div className="flex items-center gap-2">
          <h1 className="text-sm font-medium" style={{ color: 'var(--editor-text)' }}>
            {mapName}
          </h1>
          {isDirty && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: 'var(--editor-warning)',
                color: 'var(--editor-bg)',
              }}
            >
              Unsaved
            </span>
          )}
        </div>
      </div>

      {/* Center section: Undo/Redo */}
      <div className="flex items-center gap-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className="w-8 h-8 rounded flex items-center justify-center text-sm transition-colors disabled:opacity-30"
          style={{
            backgroundColor: 'var(--editor-bg)',
            color: 'var(--editor-text-secondary)',
          }}
        >
          ↩
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          className="w-8 h-8 rounded flex items-center justify-center text-sm transition-colors disabled:opacity-30"
          style={{
            backgroundColor: 'var(--editor-bg)',
            color: 'var(--editor-text-secondary)',
          }}
        >
          ↪
        </button>
      </div>

      {/* Right section: Actions */}
      <div className="flex items-center gap-2 ml-4">
        {/* Import button */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-3 py-1.5 text-sm font-medium rounded transition-colors hover:opacity-90"
          style={{
            backgroundColor: 'var(--editor-surface)',
            color: 'var(--editor-text-secondary)',
            border: `1px solid var(--editor-border)`,
          }}
          title="Import map from JSON file"
        >
          Import
        </button>

        {/* Export button */}
        {onExport && (
          <button
            onClick={onExport}
            className="px-3 py-1.5 text-sm font-medium rounded transition-colors hover:opacity-90"
            style={{
              backgroundColor: 'var(--editor-surface)',
              color: 'var(--editor-text-secondary)',
              border: `1px solid var(--editor-border)`,
            }}
            title="Export map as JSON file"
          >
            Export
          </button>
        )}

        {/* Divider */}
        <div
          className="h-5 w-px mx-1"
          style={{ backgroundColor: 'var(--editor-border)' }}
        />

        {/* Mute/Unmute button */}
        <button
          onClick={onToggleMusic}
          className="w-8 h-8 rounded flex items-center justify-center text-sm transition-colors hover:opacity-80"
          style={{
            backgroundColor: 'var(--editor-bg)',
            color: 'var(--editor-text-secondary)',
          }}
          title={musicEnabled ? 'Mute Music' : 'Unmute Music'}
        >
          {musicEnabled ? '🔊' : '🔇'}
        </button>

        {/* Fullscreen button */}
        <button
          onClick={onToggleFullscreen}
          className="w-8 h-8 rounded flex items-center justify-center text-sm transition-colors hover:opacity-80"
          style={{
            backgroundColor: 'var(--editor-bg)',
            color: 'var(--editor-text-secondary)',
          }}
          title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
        >
          ⛶
        </button>

        {/* Divider */}
        <div
          className="h-5 w-px mx-1"
          style={{ backgroundColor: 'var(--editor-border)' }}
        />

        {/* Cancel button */}
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm transition-colors hover:opacity-80"
          style={{ color: 'var(--editor-text-secondary)' }}
        >
          Cancel
        </button>

        {/* Preview button */}
        {onPreview && (
          <button
            onClick={onPreview}
            className="px-4 py-1.5 text-sm font-medium rounded transition-colors hover:opacity-90"
            style={{
              backgroundColor: 'var(--editor-primary)',
              color: 'var(--editor-text)',
            }}
            title="Preview map in game"
          >
            Preview
          </button>
        )}
      </div>
    </header>
  );
}

export default EditorHeader;
