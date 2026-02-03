/**
 * UndoPreviewOverlay - UI overlay for undo preview mode
 *
 * Displays information about what will change when undo is applied and
 * provides controls to apply or dismiss the preview. The actual cell
 * visualization is handled by EditorUndoPreview in the 3D scene.
 */

'use client';

import { useEffect } from 'react';
import type { TerrainDiff } from '../hooks/useEditorState';
import type { EditorConfig } from '../config/EditorConfig';

export interface UndoPreviewOverlayProps {
  /** The terrain diff to visualize */
  diff: TerrainDiff;
  /** Editor configuration for theming */
  config: EditorConfig;
  /** Callback when user clicks to dismiss */
  onDismiss?: () => void;
  /** Callback when user confirms (applies undo) */
  onConfirm?: () => void;
}

/**
 * HTML overlay that provides UI controls for undo preview
 */
export function UndoPreviewOverlay({
  diff,
  config,
  onDismiss,
  onConfirm,
}: UndoPreviewOverlayProps) {
  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape dismisses
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss?.();
      }
      // Ctrl+Z applies the undo (without shift - shift toggles preview)
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        onConfirm?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss, onConfirm]);

  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {/* Semi-transparent backdrop for visual feedback */}
      <div
        className="absolute inset-0 pointer-events-auto"
        onClick={onDismiss}
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.1)',
        }}
      />

      {/* Info banner at top */}
      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-3 rounded-lg shadow-xl flex items-center gap-4 pointer-events-auto"
        style={{
          backgroundColor: config.theme.surface,
          border: `2px solid ${config.theme.primary}`,
          color: config.theme.text.primary,
        }}
      >
        {/* Preview icon */}
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ backgroundColor: `${config.theme.primary}20` }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke={config.theme.primary}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>

        {/* Info text */}
        <div className="flex flex-col">
          <div className="text-sm font-semibold">Undo Preview</div>
          <div className="text-xs" style={{ color: config.theme.text.muted }}>
            {diff.cellCount > 0 && (
              <span>
                {diff.cellCount.toLocaleString()} cell{diff.cellCount !== 1 ? 's' : ''} will change
              </span>
            )}
            {diff.hasObjectChanges && (
              <span>
                {diff.cellCount > 0 && ' + '}
                {diff.objectChangeCount} object{diff.objectChangeCount !== 1 ? 's' : ''} affected
              </span>
            )}
            {diff.cellCount === 0 && !diff.hasObjectChanges && <span>No changes to preview</span>}
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-8" style={{ backgroundColor: config.theme.border }} />

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onConfirm?.();
            }}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-all hover:opacity-90 active:scale-95"
            style={{
              backgroundColor: config.theme.primary,
              color: '#fff',
            }}
          >
            Apply Undo
            <span
              className="ml-2 px-1 py-0.5 rounded text-[10px]"
              style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
            >
              Ctrl+Z
            </span>
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss?.();
            }}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-all hover:bg-white/5 active:scale-95"
            style={{
              border: `1px solid ${config.theme.border}`,
              color: config.theme.text.secondary,
            }}
          >
            Dismiss
            <span
              className="ml-2 px-1 py-0.5 rounded text-[10px]"
              style={{ backgroundColor: config.theme.background }}
            >
              Esc
            </span>
          </button>
        </div>
      </div>

      {/* Legend in bottom-left */}
      <div
        className="absolute bottom-14 left-3 px-3 py-2 rounded-lg shadow-lg pointer-events-auto"
        style={{
          backgroundColor: `${config.theme.surface}ee`,
          border: `1px solid ${config.theme.border}`,
        }}
      >
        <div
          className="text-[10px] uppercase tracking-wider mb-2"
          style={{ color: config.theme.text.muted }}
        >
          Legend
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: 'rgba(34, 197, 94, 0.6)' }}
            />
            <span className="text-xs" style={{ color: config.theme.text.secondary }}>
              Cells to be restored
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: 'rgba(251, 191, 36, 0.6)' }}
            />
            <span className="text-xs" style={{ color: config.theme.text.secondary }}>
              Property changes
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UndoPreviewOverlay;
