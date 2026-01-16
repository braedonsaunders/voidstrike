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
import { useUIStore } from '@/store/uiStore';
import { MusicPlayer } from '@/audio/MusicPlayer';

// Components
import { Editor3DCanvas } from './Editor3DCanvas';
import { EditorPanels } from './EditorPanels';
import { EditorHeader } from './EditorHeader';

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
  const handleImport = useCallback((data: EditorMapData) => {
    loadMap(data);
  }, [loadMap]);

  // Handle export
  const handleExportJson = useCallback(() => {
    if (!state.mapData) return;

    // Create a clean copy of the map data for export
    const exportData = {
      ...state.mapData,
      // Ensure we have all required fields
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

  // Handle preview (play without saving)
  const handlePreview = useCallback(() => {
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

      // Export (Ctrl+S exports as JSON)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleExportJson();
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
  }, [config, editorState, state.selectedObjects, handleExportJson]);

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
      />

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* 3D Canvas area */}
        <div className="flex-1 p-3">
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
          onMouseEnter={handlePanelMouseEnter}
          onMouseLeave={handlePanelMouseLeave}
        />
      </div>
    </div>
  );
}

export default EditorCore;
