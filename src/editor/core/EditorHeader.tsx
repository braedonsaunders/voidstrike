/**
 * EditorHeader - Top bar with title, controls, and actions
 */

'use client';

import type { EditorConfig } from '../config/EditorConfig';

export interface EditorHeaderProps {
  config: EditorConfig;
  mapName: string;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onCancel: () => void;
  onPlay?: () => void;
  onExport?: () => void;
}

export function EditorHeader({
  config,
  mapName,
  isDirty,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  onCancel,
  onPlay,
  onExport,
}: EditorHeaderProps) {
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
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-sm transition-colors hover:opacity-80"
          style={{ color: 'var(--editor-text-secondary)' }}
        >
          Cancel
        </button>

        {onExport && (
          <button
            onClick={onExport}
            className="px-4 py-1.5 text-sm font-medium rounded transition-colors hover:opacity-90"
            style={{
              backgroundColor: 'var(--editor-surface)',
              color: 'var(--editor-text)',
              border: `1px solid var(--editor-border)`,
            }}
          >
            Export
          </button>
        )}

        <button
          onClick={onSave}
          className="px-4 py-1.5 text-sm font-medium rounded transition-colors hover:opacity-90"
          style={{
            backgroundColor: 'var(--editor-surface)',
            color: 'var(--editor-text)',
            border: `1px solid var(--editor-border)`,
          }}
        >
          Save
        </button>

        {onPlay && (
          <button
            onClick={onPlay}
            className="px-4 py-1.5 text-sm font-medium rounded transition-colors hover:opacity-90"
            style={{
              backgroundColor: 'var(--editor-primary)',
              color: 'var(--editor-text)',
            }}
          >
            Save & Play
          </button>
        )}
      </div>
    </header>
  );
}

export default EditorHeader;
