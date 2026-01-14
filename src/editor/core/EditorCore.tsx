/**
 * EditorCore - The main map editor component
 *
 * A config-driven, reusable map editor that can be customized for any game.
 * Provide an EditorConfig and EditorDataProvider to integrate with your game.
 *
 * @example
 * ```tsx
 * import { EditorCore } from '@/editor';
 * import { VOIDSTRIKE_EDITOR_CONFIG } from '@/editor/configs/voidstrike';
 * import { voidstrikeDataProvider } from '@/editor/providers/voidstrike';
 *
 * <EditorCore
 *   config={VOIDSTRIKE_EDITOR_CONFIG}
 *   dataProvider={voidstrikeDataProvider}
 *   mapId="my_map"
 *   onSave={(data) => console.log('Saved', data)}
 *   onCancel={() => router.back()}
 * />
 * ```
 */

'use client';

import { useEffect, useCallback, useMemo, useState } from 'react';
import type {
  EditorConfig,
  EditorDataProvider,
  EditorCallbacks,
  EditorMapData,
} from '../config/EditorConfig';
import { useEditorState } from '../hooks/useEditorState';

// Components
import { Editor3DCanvas } from './Editor3DCanvas';
import { EditorToolbar } from './EditorToolbar';
import { EditorPanels } from './EditorPanels';
import { EditorHeader } from './EditorHeader';
import { EditorExportModal } from './EditorExportModal';

// Types
import type { MapData } from '@/data/maps/MapTypes';

// ============================================
// TYPES
// ============================================

export interface EditorCoreProps extends EditorCallbacks {
  /** Editor configuration */
  config: EditorConfig;
  /** Data provider for loading/saving maps */
  dataProvider?: EditorDataProvider;
  /** Map ID to load (optional) */
  mapId?: string;
  /** Initial map data (alternative to mapId) */
  initialMapData?: EditorMapData;
  /** CSS class name */
  className?: string;
}

// ============================================
// COMPONENT
// ============================================

export function EditorCore({
  config,
  dataProvider,
  mapId,
  initialMapData,
  onSave,
  onCancel,
  onPlay,
  onChange,
  onValidate,
  className = '',
}: EditorCoreProps) {
  const editorState = useEditorState(config);
  const { state, loadMap } = editorState;

  // Visibility state for 3D elements
  const [visibility, setVisibility] = useState({
    labels: true,
    grid: true,
    categories: {} as Record<string, boolean>,
  });

  // Export modal state
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportMapData, setExportMapData] = useState<MapData | null>(null);

  // Initialize category visibility when config loads
  useEffect(() => {
    const categories: Record<string, boolean> = {};
    for (const objType of config.objectTypes) {
      if (!(objType.category in categories)) {
        categories[objType.category] = true;
      }
    }
    setVisibility((prev) => ({ ...prev, categories }));
  }, [config.objectTypes]);

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
          console.error('Failed to load map:', error);
        }
      } else if (dataProvider) {
        // Create new blank map
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

  // Handle save
  const handleSave = useCallback(async () => {
    if (!state.mapData) return;

    if (dataProvider?.saveMap) {
      await dataProvider.saveMap(state.mapData);
    }

    editorState.markClean();
    onSave?.(state.mapData);
  }, [state.mapData, dataProvider, editorState, onSave]);

  // Handle play
  const handlePlay = useCallback(() => {
    if (!state.mapData) return;
    onPlay?.(state.mapData);
  }, [state.mapData, onPlay]);

  // Handle validate
  const handleValidate = useCallback(async () => {
    if (!state.mapData) return;

    if (dataProvider?.validateMap) {
      const result = await dataProvider.validateMap(state.mapData);
      console.log('Validation result:', result);
    }

    onValidate?.(state.mapData);
  }, [state.mapData, dataProvider, onValidate]);

  // Handle cancel with unsaved changes warning
  const handleCancel = useCallback(() => {
    if (state.isDirty) {
      const confirmed = window.confirm('You have unsaved changes. Are you sure you want to leave?');
      if (!confirmed) return;
    }
    onCancel?.();
  }, [state.isDirty, onCancel]);

  // Handle export
  const handleExport = useCallback(() => {
    if (!state.mapData || !dataProvider?.exportForGame) return;

    // Convert editor format to game format
    const gameData = dataProvider.exportForGame(state.mapData);
    setExportMapData(gameData as MapData);
    setExportModalOpen(true);
  }, [state.mapData, dataProvider]);

  // Handle export modal close
  const handleExportClose = useCallback(() => {
    setExportModalOpen(false);
    setExportMapData(null);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
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

      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          editorState.redo();
        } else {
          editorState.undo();
        }
        return;
      }

      // Save
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
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

      // Escape - clear selection
      if (e.key === 'Escape') {
        editorState.clearSelection();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [config, editorState, state.selectedObjects, handleSave]);

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
        onUndo={editorState.undo}
        onRedo={editorState.redo}
        onSave={handleSave}
        onCancel={handleCancel}
        onPlay={handlePlay}
        onExport={dataProvider?.exportForGame ? handleExport : undefined}
      />

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* 3D Canvas area */}
        <div className="flex-1 p-3">
          <Editor3DCanvas
            config={config}
            state={state}
            visibility={visibility}
            onCellsUpdateBatched={editorState.updateCellsBatched}
            onStartBatch={editorState.startBatch}
            onCommitBatch={editorState.commitBatch}
            onFillArea={editorState.fillArea}
            onObjectSelect={editorState.selectObjects}
            onObjectUpdate={editorState.updateObject}
            onObjectAdd={editorState.addObject}
          />
        </div>

        {/* Right panel */}
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
          onToggleLabels={toggleLabels}
          onToggleGrid={toggleGrid}
          onToggleCategory={toggleCategory}
        />
      </div>

      {/* Export Modal */}
      {exportMapData && (
        <EditorExportModal
          map={exportMapData}
          isOpen={exportModalOpen}
          onClose={handleExportClose}
        />
      )}
    </div>
  );
}

export default EditorCore;
