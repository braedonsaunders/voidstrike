/**
 * Map Editor Module
 *
 * A reusable, config-driven 3D map editor for tile-based games.
 * Uses Three.js for full 3D terrain visualization and editing.
 *
 * @example
 * ```tsx
 * import { EditorCore, VOIDSTRIKE_EDITOR_CONFIG } from '@/editor';
 *
 * <EditorCore
 *   config={VOIDSTRIKE_EDITOR_CONFIG}
 *   mapId="my_map"
 *   onSave={(data) => console.log('Saved', data)}
 * />
 * ```
 */

// Configuration types
export type {
  EditorConfig,
  TerrainConfig,
  ElevationConfig,
  TerrainFeatureConfig,
  ToolConfig,
  BuiltInToolType,
  ObjectTypeConfig,
  ObjectPropertyConfig,
  BiomeConfig,
  PanelConfig,
  UIThemeConfig,
  EditorCell,
  EditorObject,
  EditorMapData,
  EditorDataProvider,
  ValidationResult,
  EditorCallbacks,
  EditorState,
} from './config/EditorConfig';

// Default configuration values
export {
  DEFAULT_THEME,
  DEFAULT_TOOLS,
  DEFAULT_PANELS,
  DEFAULT_CANVAS,
  DEFAULT_FEATURES,
} from './config/EditorConfig';

// Core components
export { EditorCore } from './core/EditorCore';
export type { EditorCoreProps } from './core/EditorCore';

export { EditorCanvas } from './core/EditorCanvas';
export type { EditorCanvasProps } from './core/EditorCanvas';

export { Editor3DCanvas } from './core/Editor3DCanvas';
export type { Editor3DCanvasProps } from './core/Editor3DCanvas';

export { EditorHeader } from './core/EditorHeader';
export type { EditorHeaderProps, MapListItem } from './core/EditorHeader';

export { EditorPanels } from './core/EditorPanels';
export type { EditorPanelsProps } from './core/EditorPanels';

export { EditorToolbar } from './core/EditorToolbar';
export type { EditorToolbarProps } from './core/EditorToolbar';

// Hooks
export { useEditorState } from './hooks/useEditorState';
export type { UseEditorStateReturn } from './hooks/useEditorState';

// VOIDSTRIKE-specific configuration
export { VOIDSTRIKE_EDITOR_CONFIG } from './configs/voidstrike';
export {
  VOIDSTRIKE_TERRAIN,
  VOIDSTRIKE_TOOLS,
  VOIDSTRIKE_OBJECTS,
  VOIDSTRIKE_BIOMES,
  VOIDSTRIKE_THEME,
  VOIDSTRIKE_PANELS,
} from './configs/voidstrike';

// 3D Rendering components
export { EditorTerrain } from './rendering3d/EditorTerrain';
export { EditorObjects } from './rendering3d/EditorObjects';
export { EditorGrid } from './rendering3d/EditorGrid';
export { EditorBrushPreview } from './rendering3d/EditorBrushPreview';

// Tools
export { TerrainBrush } from './tools/TerrainBrush';
export { ObjectPlacer } from './tools/ObjectPlacer';
