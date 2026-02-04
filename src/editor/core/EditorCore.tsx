/**
 * EditorCore - The main map editor component
 *
 * A config-driven, reusable map editor that can be customized for any game.
 * Photoshop-style layout: toolbar at top, properties panel on right.
 */

'use client';

import { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import type {
  EditorConfig,
  EditorDataProvider,
  EditorCallbacks,
  EditorMapData,
  EditorObject,
} from '../config/EditorConfig';
import { useEditorState } from '../hooks/useEditorState';
import { useUIStore } from '@/store/uiStore';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { mapDataToEditorFormat } from '../providers/voidstrike';
import { debugInitialization } from '@/utils/debugLogger';
import type { MapData } from '@/data/maps/MapTypes';

// Detailed validation result type for the editor UI
export interface DetailedValidationResult {
  valid: boolean;
  isValidating: boolean;
  issues: Array<{
    severity: 'error' | 'warning';
    message: string;
    type?: string;
    affectedNodes?: string[];
    suggestedFix?: {
      type: string;
      description: string;
    };
  }>;
  stats?: {
    totalNodes: number;
    totalEdges: number;
    islandCount: number;
    connectedPairs: number;
    blockedPairs: number;
  };
  timestamp?: number;
}

// Components
import { Editor3DCanvas } from './Editor3DCanvas';
import { EditorPanels } from './panels';
import { EditorHeader, type MapListItem } from './EditorHeader';
import { EditorToolbar } from './EditorToolbar';
import {
  EditorContextMenu,
  buildContextMenuActions,
  type ContextMenuAction,
} from './EditorContextMenu';
import { EditorStatusBar } from './EditorStatusBar';

// ============================================
// TYPES
// ============================================

export interface EditorCoreProps extends EditorCallbacks {
  config: EditorConfig;
  dataProvider?: EditorDataProvider;
  mapId?: string;
  initialMapData?: EditorMapData;
  className?: string;
  mapList?: MapListItem[];
  onLoadMap?: (mapId: string) => void;
  onNewMap?: () => void;
}

// ============================================
// COMPONENT
// ============================================

export function EditorCore({
  config,
  dataProvider,
  mapId,
  initialMapData,
  onSave: _onSave,
  onCancel,
  onPlay,
  onChange,
  onValidate,
  className = '',
  mapList,
  onLoadMap,
  onNewMap,
}: EditorCoreProps) {
  const editorState = useEditorState(config);
  const { state, loadMap } = editorState;

  // UI Store for music and fullscreen
  const musicEnabled = useUIStore((s) => s.musicEnabled);
  const toggleMusic = useUIStore((s) => s.toggleMusic);
  const isFullscreen = useUIStore((s) => s.isFullscreen);
  const toggleFullscreen = useUIStore((s) => s.toggleFullscreen);
  const setFullscreen = useUIStore((s) => s.setFullscreen);

  // Visibility state for 3D elements
  const [visibility, setVisibility] = useState({
    labels: true,
    grid: true,
    categories: {} as Record<string, boolean>,
  });

  // Edge scroll control - disabled when mouse is over UI panels
  const [edgeScrollEnabled, setEdgeScrollEnabled] = useState(true);

  // Right panel collapsed state
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  // Cursor tracking for status bar
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
  const [cursorWorldPosition, setCursorWorldPosition] = useState<{
    x: number;
    y: number;
    z: number;
  } | null>(null);
  const [hoveredObject, setHoveredObject] = useState<EditorObject | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    gridPos: { x: number; y: number } | null;
    objectAtPosition: EditorObject | null;
  } | null>(null);

  // Terrain copy buffer
  const [copiedTerrain, setCopiedTerrain] = useState<{
    cells: Array<{ dx: number; dy: number; cell: EditorMapData['terrain'][0][0] }>;
    centerX: number;
    centerY: number;
  } | null>(null);

  // Ref to canvas for navigation
  const canvasNavigateRef = useRef<((x: number, y: number) => void) | null>(null);

  // Validation state
  const [validationResult, setValidationResult] = useState<DetailedValidationResult>({
    valid: true,
    isValidating: false,
    issues: [],
  });

  // Initialize category visibility when config loads
  useEffect(() => {
    const categories: Record<string, boolean> = {};
    for (const objType of config.objectTypes) {
      if (!(objType.category in categories)) {
        categories[objType.category] = true;
      }
    }
    // Use requestAnimationFrame to avoid cascading renders
    requestAnimationFrame(() => {
      setVisibility((prev) => ({ ...prev, categories }));
    });
  }, [config.objectTypes]);

  // Sync fullscreen state with browser
  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    setFullscreen(!!document.fullscreenElement);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [setFullscreen]);

  // Visibility toggle handlers
  const toggleLabels = useCallback(() => {
    setVisibility((prev) => ({ ...prev, labels: !prev.labels }));
  }, []);

  const toggleGrid = useCallback(() => {
    setVisibility((prev) => ({ ...prev, grid: !prev.grid }));
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setVisibility((prev) => ({
      ...prev,
      categories: {
        ...prev.categories,
        [category]: !prev.categories[category],
      },
    }));
  }, []);

  // Panel hover handlers for edge scroll control
  const handlePanelMouseEnter = useCallback(() => {
    setEdgeScrollEnabled(false);
  }, []);

  const handlePanelMouseLeave = useCallback(() => {
    setEdgeScrollEnabled(true);
  }, []);

  // Load map on mount
  useEffect(() => {
    const loadInitialMap = async () => {
      if (initialMapData) {
        loadMap(initialMapData);
      } else if (mapId && dataProvider) {
        try {
          const data = await dataProvider.loadMap(mapId);
          loadMap(data);
        } catch (error) {
          debugInitialization.error('Failed to load map:', error);
        }
      } else if (dataProvider) {
        const newMap = dataProvider.createMap(128, 128, 'New Map');
        loadMap(newMap);
      }
    };
    loadInitialMap();
  }, [mapId, initialMapData, dataProvider, loadMap]);

  // Notify parent of changes
  useEffect(() => {
    if (state.mapData && onChange) {
      onChange(state.mapData);
    }
  }, [state.mapData, onChange]);

  // Handle music toggle
  const handleMusicToggle = useCallback(() => {
    toggleMusic();
    const newEnabled = !musicEnabled;
    MusicPlayer.setMuted(!newEnabled);
    if (!newEnabled) {
      MusicPlayer.pause();
    } else {
      MusicPlayer.resume();
    }
  }, [toggleMusic, musicEnabled]);

  // Handle import
  const handleImport = useCallback(
    (data: EditorMapData) => {
      loadMap(data);
    },
    [loadMap]
  );

  // Handle export
  const handleExportJson = useCallback(() => {
    if (!state.mapData) return;

    const exportData = {
      ...state.mapData,
      name: state.mapData.name || 'Untitled Map',
      width: state.mapData.width,
      height: state.mapData.height,
      biomeId: state.mapData.biomeId,
      terrain: state.mapData.terrain,
      objects: state.mapData.objects,
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.mapData.name || 'map'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [state.mapData]);

  // Handle preview
  const handlePreview = useCallback(() => {
    if (!state.mapData) return;
    onPlay?.(state.mapData);
  }, [state.mapData, onPlay]);

  // Handle AI-generated map
  const handleAIMapGenerated = useCallback(
    (mapData: MapData) => {
      // Convert MapData to EditorMapData and load into editor
      const editorMapData = mapDataToEditorFormat(mapData);
      loadMap(editorMapData);
    },
    [loadMap]
  );

  // Handle update objects (for border decorations, etc.)
  const handleUpdateObjects = useCallback(
    (objects: EditorObject[]) => {
      editorState.replaceObjects(objects);
    },
    [editorState]
  );

  // Handle validate
  const handleValidate = useCallback(async () => {
    if (!state.mapData) return;

    // Set validating state
    setValidationResult((prev) => ({ ...prev, isValidating: true }));

    try {
      if (dataProvider?.validateMap) {
        const result = await dataProvider.validateMap(state.mapData);

        // Convert to detailed result format
        setValidationResult({
          valid: result.valid,
          isValidating: false,
          issues: result.issues.map((issue) => ({
            severity: issue.type,
            message: issue.message,
            type: (issue as unknown as { issueType?: string }).issueType,
            affectedNodes: (issue as unknown as { affectedNodes?: string[] }).affectedNodes,
            suggestedFix: (
              issue as unknown as { suggestedFix?: { type: string; description: string } }
            ).suggestedFix,
          })),
          stats: (
            result as unknown as {
              stats?: {
                totalNodes: number;
                totalEdges: number;
                islandCount: number;
                connectedPairs: number;
                blockedPairs: number;
              };
            }
          ).stats,
          timestamp: Date.now(),
        });
      }
      onValidate?.(state.mapData);
    } catch (error) {
      debugInitialization.error('Validation failed:', error);
      setValidationResult({
        valid: false,
        isValidating: false,
        issues: [{ severity: 'error', message: 'Validation failed unexpectedly' }],
        timestamp: Date.now(),
      });
    }
  }, [state.mapData, dataProvider, onValidate]);

  // Handle auto-fix
  const handleAutoFix = useCallback(async () => {
    if (!state.mapData || !dataProvider) return;

    setValidationResult((prev) => ({ ...prev, isValidating: true }));

    try {
      // Check if provider has autoFix method
      const providerWithAutoFix = dataProvider as unknown as {
        autoFixMap?: (data: EditorMapData) => Promise<EditorMapData>;
      };
      if (providerWithAutoFix.autoFixMap) {
        const fixedData = await providerWithAutoFix.autoFixMap(state.mapData);
        if (fixedData) {
          loadMap(fixedData);
          // Re-validate after fix
          await handleValidate();
        }
      }
    } catch (error) {
      debugInitialization.error('Auto-fix failed:', error);
      setValidationResult((prev) => ({
        ...prev,
        isValidating: false,
        issues: [...prev.issues, { severity: 'error', message: 'Auto-fix failed unexpectedly' }],
      }));
    }
  }, [state.mapData, dataProvider, loadMap, handleValidate]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (state.isDirty) {
      const confirmed = window.confirm('You have unsaved changes. Are you sure you want to leave?');
      if (!confirmed) return;
    }
    onCancel?.();
  }, [state.isDirty, onCancel]);

  // Handle context menu open
  const handleContextMenu = useCallback(
    (
      e: { clientX: number; clientY: number },
      gridPos: { x: number; y: number } | null,
      objectAtPosition: EditorObject | null
    ) => {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        gridPos,
        objectAtPosition,
      });
    },
    []
  );

  // Copy terrain around current position
  const handleCopyTerrain = useCallback(() => {
    if (!cursorPosition || !state.mapData) return;

    const radius = state.brushSize;
    const cells: Array<{ dx: number; dy: number; cell: EditorMapData['terrain'][0][0] }> = [];

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = cursorPosition.x + dx;
        const y = cursorPosition.y + dy;
        if (x < 0 || x >= state.mapData.width || y < 0 || y >= state.mapData.height) continue;
        cells.push({
          dx,
          dy,
          cell: { ...state.mapData.terrain[y][x] },
        });
      }
    }

    setCopiedTerrain({
      cells,
      centerX: cursorPosition.x,
      centerY: cursorPosition.y,
    });
  }, [cursorPosition, state.mapData, state.brushSize]);

  // Paste terrain at current position
  const handlePasteTerrain = useCallback(() => {
    if (!copiedTerrain || !cursorPosition || !state.mapData) return;

    const updates: Array<{ x: number; y: number; cell: Partial<EditorMapData['terrain'][0][0]> }> =
      [];

    for (const { dx, dy, cell } of copiedTerrain.cells) {
      const x = cursorPosition.x + dx;
      const y = cursorPosition.y + dy;
      if (x < 0 || x >= state.mapData.width || y < 0 || y >= state.mapData.height) continue;
      updates.push({ x, y, cell });
    }

    if (updates.length > 0) {
      editorState.startBatch();
      editorState.updateCellsBatched(updates);
      editorState.commitBatch();
    }
  }, [copiedTerrain, cursorPosition, state.mapData, editorState]);

  // Add object at position
  const handleAddObjectAtPosition = useCallback(
    (typeId: string, x: number, y: number) => {
      const objType = config.objectTypes.find((t) => t.id === typeId);
      if (!objType) return;

      const defaultProperties: Record<string, unknown> = {};
      if (objType.properties) {
        for (const prop of objType.properties) {
          if (prop.defaultValue !== undefined) {
            defaultProperties[prop.key] = prop.defaultValue;
          }
        }
      }

      editorState.addObject({
        type: typeId,
        x,
        y,
        radius: objType.defaultRadius,
        properties: defaultProperties,
      });
    },
    [config.objectTypes, editorState]
  );

  // Build context menu actions
  const contextMenuActions = useMemo((): ContextMenuAction[] => {
    if (!contextMenu) return [];

    // Get cell at context menu position
    const cellAtPosition =
      contextMenu.gridPos && state.mapData
        ? state.mapData.terrain[contextMenu.gridPos.y]?.[contextMenu.gridPos.x]
        : null;

    return buildContextMenuActions({
      gridPos: contextMenu.gridPos,
      cellAtPosition,
      selectedObjects: state.selectedObjects,
      objectAtPosition: contextMenu.objectAtPosition,
      config,
      onToolSelect: editorState.setActiveTool,
      onFillArea: () => {
        if (contextMenu.gridPos) {
          editorState.setActiveTool('fill');
        }
      },
      onObjectRemove: editorState.removeObject,
      onCopyTerrain: handleCopyTerrain,
      onPasteTerrain: handlePasteTerrain,
      onAddObject: handleAddObjectAtPosition,
      onUndo: editorState.undo,
      onRedo: editorState.redo,
      hasCopiedTerrain: copiedTerrain !== null,
      canUndo: editorState.canUndo,
      canRedo: editorState.canRedo,
    });
  }, [
    contextMenu,
    state.selectedObjects,
    state.mapData,
    config,
    editorState,
    handleCopyTerrain,
    handlePasteTerrain,
    handleAddObjectAtPosition,
    copiedTerrain,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Tool shortcuts
      const tool = config.tools.find((t) => t.shortcut.toUpperCase() === e.key.toUpperCase());
      if (tool && !e.ctrlKey && !e.metaKey && !e.altKey) {
        editorState.setActiveTool(tool.id);
        return;
      }

      // Elevation shortcuts (0-9)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[0-9]$/.test(e.key)) {
        const elevation = config.terrain.elevations.find((el) => el.shortcut === e.key);
        if (elevation) {
          editorState.setSelectedElevation(elevation.id);
        }
        return;
      }

      // Undo/Redo/Undo Preview
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          // Ctrl+Shift+Z = Toggle undo preview
          editorState.toggleUndoPreview();
        } else {
          // Ctrl+Z = Undo (clear preview first if active)
          if (editorState.isUndoPreviewActive) {
            editorState.clearUndoPreview();
          }
          editorState.undo();
        }
        return;
      }

      // Redo (Ctrl+Y as alternative since Ctrl+Shift+Z is now undo preview)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        editorState.redo();
        return;
      }

      // Export (Ctrl+S)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleExportJson();
        return;
      }

      // Copy terrain (Ctrl+C)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleCopyTerrain();
        return;
      }

      // Paste terrain (Ctrl+V)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePasteTerrain();
        return;
      }

      // Delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedObjects.length > 0) {
          e.preventDefault();
          for (const id of state.selectedObjects) {
            editorState.removeObject(id);
          }
        }
        return;
      }

      // Escape - clear undo preview / clear selection / close context menu
      if (e.key === 'Escape') {
        if (editorState.isUndoPreviewActive) {
          editorState.clearUndoPreview();
        } else {
          setContextMenu(null);
          editorState.clearSelection();
        }
        return;
      }

      // Tab - toggle panel
      if (e.key === 'Tab') {
        e.preventDefault();
        setIsPanelCollapsed((prev) => !prev);
        return;
      }

      // Brush size with [ and ]
      if (e.key === '[') {
        editorState.setBrushSize(Math.max(1, state.brushSize - 1));
        return;
      }
      if (e.key === ']') {
        editorState.setBrushSize(Math.min(20, state.brushSize + 1));
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    config,
    editorState,
    state.selectedObjects,
    state.brushSize,
    handleExportJson,
    handleCopyTerrain,
    handlePasteTerrain,
    editorState.isUndoPreviewActive,
  ]);

  // Theme CSS variables
  const themeStyle = useMemo(
    () => ({
      '--editor-primary': config.theme.primary,
      '--editor-bg': config.theme.background,
      '--editor-surface': config.theme.surface,
      '--editor-border': config.theme.border,
      '--editor-text': config.theme.text.primary,
      '--editor-text-secondary': config.theme.text.secondary,
      '--editor-text-muted': config.theme.text.muted,
      '--editor-selection': config.theme.selection,
      '--editor-success': config.theme.success,
      '--editor-warning': config.theme.warning,
      '--editor-error': config.theme.error,
    }),
    [config.theme]
  ) as React.CSSProperties;

  return (
    <div
      className={`editor-core h-screen flex flex-col overflow-hidden ${className}`}
      style={{
        ...themeStyle,
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--editor-text)',
      }}
    >
      {/* Header */}
      <EditorHeader
        config={config}
        mapName={state.mapData?.name || 'Untitled'}
        isDirty={state.isDirty}
        canUndo={editorState.canUndo}
        canRedo={editorState.canRedo}
        musicEnabled={musicEnabled}
        isFullscreen={isFullscreen}
        onUndo={editorState.undo}
        onRedo={editorState.redo}
        onCancel={handleCancel}
        onPreview={onPlay ? handlePreview : undefined}
        onImport={handleImport}
        onExport={handleExportJson}
        onToggleMusic={handleMusicToggle}
        onToggleFullscreen={toggleFullscreen}
        mapList={mapList}
        currentMapId={mapId}
        onLoadMap={onLoadMap}
        onNewMap={onNewMap}
      />

      {/* Main content */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Canvas area with toolbar */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Horizontal Toolbar */}
          <EditorToolbar
            config={config}
            activeTool={state.activeTool}
            selectedElevation={state.selectedElevation}
            brushSize={state.brushSize}
            symmetryMode={state.symmetryMode}
            snapMode={state.snapMode}
            onToolSelect={editorState.setActiveTool}
            onBrushSizeChange={editorState.setBrushSize}
            onElevationSelect={editorState.setSelectedElevation}
            onSymmetryChange={editorState.setSymmetryMode}
            onSnapChange={editorState.setSnapMode}
            canUndo={editorState.canUndo}
            isUndoPreviewActive={editorState.isUndoPreviewActive}
            onToggleUndoPreview={editorState.toggleUndoPreview}
          />

          {/* 3D Canvas */}
          <div className="flex-1 relative">
            <Editor3DCanvas
              config={config}
              state={state}
              visibility={visibility}
              edgeScrollEnabled={edgeScrollEnabled}
              onCellsUpdateBatched={editorState.updateCellsBatched}
              onStartBatch={editorState.startBatch}
              onCommitBatch={editorState.commitBatch}
              onFillArea={editorState.fillArea}
              onObjectSelect={editorState.selectObjects}
              onObjectUpdate={editorState.updateObject}
              onObjectAdd={editorState.addObject}
              onCursorMove={(gridPos, worldPos) => {
                setCursorPosition(gridPos);
                setCursorWorldPosition(worldPos);
              }}
              onObjectHover={setHoveredObject}
              onContextMenu={handleContextMenu}
              onNavigateRef={(fn) => {
                canvasNavigateRef.current = fn;
              }}
              undoPreview={editorState.undoPreview}
              isUndoPreviewActive={editorState.isUndoPreviewActive}
              onUndoPreviewDismiss={editorState.clearUndoPreview}
              onUndoPreviewConfirm={() => {
                editorState.clearUndoPreview();
                editorState.undo();
              }}
            />

            {/* Status Bar */}
            <EditorStatusBar
              config={config}
              state={state}
              cursorPosition={cursorPosition}
              cursorWorldPosition={cursorWorldPosition}
              hoveredObject={hoveredObject}
              isUndoPreviewActive={editorState.isUndoPreviewActive}
              undoPreview={editorState.undoPreview}
            />
          </div>
        </div>

        {/* Right panel (collapsible) with smooth animation */}
        <div
          className="flex-shrink-0 border-l overflow-hidden transition-all duration-300 ease-out"
          style={{
            borderColor: config.theme.border,
            width: isPanelCollapsed ? 0 : 280,
            opacity: isPanelCollapsed ? 0 : 1,
          }}
          onMouseEnter={handlePanelMouseEnter}
          onMouseLeave={handlePanelMouseLeave}
        >
          <div className="w-[280px] h-full">
            <EditorPanels
              config={config}
              state={state}
              visibility={visibility}
              onToolSelect={editorState.setActiveTool}
              onElevationSelect={editorState.setSelectedElevation}
              onFeatureSelect={editorState.setSelectedFeature}
              onMaterialSelect={editorState.setSelectedMaterial}
              onBrushSizeChange={editorState.setBrushSize}
              onPanelChange={editorState.setActivePanel}
              onBiomeChange={editorState.setActiveBiome}
              onObjectAdd={editorState.addObject}
              onObjectRemove={editorState.removeObject}
              onObjectPropertyUpdate={editorState.updateObjectProperty}
              onMetadataUpdate={editorState.updateMapMetadata}
              onValidate={handleValidate}
              onAutoFix={handleAutoFix}
              validationResult={validationResult}
              onToggleLabels={toggleLabels}
              onToggleGrid={toggleGrid}
              onToggleCategory={toggleCategory}
              onAIMapGenerated={handleAIMapGenerated}
              onUpdateObjects={handleUpdateObjects}
            />
          </div>
        </div>

        {/* Panel toggle button - always visible, positioned at right edge */}
        <button
          onClick={() => setIsPanelCollapsed((prev) => !prev)}
          className="absolute top-1/2 -translate-y-1/2 w-6 h-16 flex items-center justify-center rounded-l-lg z-30 transition-all duration-300 ease-out hover:w-7 group"
          style={{
            backgroundColor: config.theme.surface,
            border: `1px solid ${config.theme.border}`,
            borderRight: 'none',
            right: isPanelCollapsed ? 0 : 280,
          }}
          title={isPanelCollapsed ? 'Show Panel (Tab)' : 'Hide Panel (Tab)'}
        >
          <span
            className="transition-transform duration-300 group-hover:scale-110"
            style={{ color: config.theme.text.muted }}
          >
            {isPanelCollapsed ? '◀' : '▶'}
          </span>
        </button>
      </div>

      {/* Context Menu */}
      <EditorContextMenu
        x={contextMenu?.x || 0}
        y={contextMenu?.y || 0}
        isOpen={contextMenu !== null}
        onClose={() => setContextMenu(null)}
        actions={contextMenuActions}
        theme={config.theme}
      />
    </div>
  );
}

export default EditorCore;
