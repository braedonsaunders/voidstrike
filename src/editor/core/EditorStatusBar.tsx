/**
 * EditorStatusBar - Bottom status bar showing current state
 *
 * Displays cursor position, brush info, selected object details, and helpful tips.
 */

'use client';

import type { EditorConfig, EditorState, EditorObject } from '../config/EditorConfig';

export interface EditorStatusBarProps {
  config: EditorConfig;
  state: EditorState;
  cursorPosition: { x: number; y: number } | null;
  cursorWorldPosition: { x: number; y: number; z: number } | null;
  hoveredObject: EditorObject | null;
}

export function EditorStatusBar({
  config,
  state,
  cursorPosition,
  cursorWorldPosition,
  hoveredObject,
}: EditorStatusBarProps) {
  const activeTool = config.tools.find((t) => t.id === state.activeTool);
  const selectedElevation = config.terrain.elevations.find((e) => e.id === state.selectedElevation);
  const selectedFeature = config.terrain.features.find((f) => f.id === state.selectedFeature);

  // Get current cell info if cursor is on map
  const cellInfo = cursorPosition && state.mapData
    ? state.mapData.terrain[cursorPosition.y]?.[cursorPosition.x]
    : null;

  return (
    <div
      className="absolute bottom-0 left-0 right-0 h-7 flex items-center px-3 gap-4 text-xs z-20"
      style={{
        backgroundColor: 'rgba(20, 20, 30, 0.9)',
        borderTop: `1px solid ${config.theme.border}`,
        color: config.theme.text.secondary,
      }}
    >
      {/* Current tool */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{activeTool?.icon}</span>
        <span style={{ color: config.theme.text.primary }}>{activeTool?.name}</span>
        {activeTool?.hasBrushSize && (
          <span className="font-mono opacity-60">({state.brushSize}px)</span>
        )}
      </div>

      {/* Divider */}
      <div className="h-4 w-px bg-white/10" />

      {/* Selected elevation */}
      {selectedElevation && (
        <div className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: selectedElevation.color }}
          />
          <span>{selectedElevation.name}</span>
        </div>
      )}

      {/* Selected feature */}
      {selectedFeature && selectedFeature.id !== 'none' && (
        <div className="flex items-center gap-1">
          <span>{selectedFeature.icon}</span>
          <span>{selectedFeature.name}</span>
        </div>
      )}

      {/* Divider */}
      <div className="h-4 w-px bg-white/10" />

      {/* Cursor position */}
      {cursorPosition ? (
        <div className="font-mono">
          <span className="opacity-50">Grid:</span>{' '}
          <span style={{ color: config.theme.text.primary }}>
            {cursorPosition.x}, {cursorPosition.y}
          </span>
        </div>
      ) : (
        <div className="opacity-50">Hover over map</div>
      )}

      {/* Cell info */}
      {cellInfo && (
        <>
          <div className="font-mono">
            <span className="opacity-50">Elev:</span>{' '}
            <span>{cellInfo.elevation}</span>
          </div>
          {cellInfo.feature !== 'none' && (
            <div>
              <span className="opacity-50">Feature:</span>{' '}
              <span>{cellInfo.feature}</span>
            </div>
          )}
        </>
      )}

      {/* Hovered object info */}
      {hoveredObject && (
        <>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-1.5">
            {(() => {
              const objType = config.objectTypes.find((t) => t.id === hoveredObject.type);
              return (
                <>
                  <span>{objType?.icon}</span>
                  <span style={{ color: config.theme.primary }}>{objType?.name}</span>
                </>
              );
            })()}
          </div>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Selection count */}
      {state.selectedObjects.length > 0 && (
        <div style={{ color: config.theme.primary }}>
          {state.selectedObjects.length} selected
        </div>
      )}

      {/* Map dimensions */}
      {state.mapData && (
        <div className="font-mono opacity-50">
          {state.mapData.width}×{state.mapData.height}
        </div>
      )}

      {/* Dirty indicator */}
      {state.isDirty && (
        <div
          className="px-1.5 py-0.5 rounded text-[10px]"
          style={{ backgroundColor: config.theme.warning, color: '#000' }}
        >
          Unsaved
        </div>
      )}
    </div>
  );
}

export default EditorStatusBar;
