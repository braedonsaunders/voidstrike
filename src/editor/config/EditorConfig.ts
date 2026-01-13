/**
 * Map Editor Configuration Types
 *
 * This module defines the configuration interface for a reusable map editor.
 * Games can provide their own configuration to customize the editor for their
 * specific terrain systems, elevation models, and visual themes.
 *
 * @example
 * ```typescript
 * const config: EditorConfig = {
 *   name: 'My Game Map Editor',
 *   terrain: {
 *     elevations: [
 *       { id: 0, name: 'Water', color: '#1e3a5f', walkable: false },
 *       { id: 1, name: 'Ground', color: '#4a6b4a', walkable: true },
 *     ],
 *     features: [...],
 *   },
 *   tools: [...],
 *   theme: {...},
 * };
 * ```
 */

// ============================================
// TERRAIN CONFIGURATION
// ============================================

/**
 * Defines an elevation level in the terrain system.
 * Can represent discrete levels (0, 1, 2) or continuous ranges (0-255).
 */
export interface ElevationConfig {
  /** Unique identifier for this elevation */
  id: number;
  /** Display name */
  name: string;
  /** Hex color for rendering in editor */
  color: string;
  /** Description shown in tooltips */
  description?: string;
  /** Whether units can walk on this elevation */
  walkable: boolean;
  /** Whether buildings can be placed */
  buildable?: boolean;
  /** Optional keyboard shortcut (e.g., '1', '2') */
  shortcut?: string;
}

/**
 * Defines a terrain feature (water, forest, etc.)
 */
export interface TerrainFeatureConfig {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Icon or emoji for UI */
  icon: string;
  /** Hex color for rendering */
  color: string;
  /** Whether units can walk through */
  walkable: boolean;
  /** Whether buildings can be placed */
  buildable: boolean;
  /** Movement speed modifier (1.0 = normal) */
  speedModifier?: number;
  /** Whether it blocks vision */
  blocksVision?: boolean;
}

/**
 * Defines a paintable terrain material/texture type.
 * Materials are the visual textures applied to terrain (grass, dirt, rock, cliff).
 */
export interface MaterialConfig {
  /** Unique identifier (0 = auto/slope-based, 1+ = explicit) */
  id: number;
  /** Display name */
  name: string;
  /** Icon or emoji for UI */
  icon: string;
  /** Preview color for editor */
  color: string;
  /** Keyboard shortcut */
  shortcut?: string;
  /** Texture file prefix (e.g., 'grass' for grass_diffuse.png) */
  texturePrefix?: string;
}

/**
 * Complete terrain configuration
 */
export interface TerrainConfig {
  /** Available elevation levels */
  elevations: ElevationConfig[];
  /** Available terrain features */
  features: TerrainFeatureConfig[];
  /** Available paintable materials/textures (0=auto must be first) */
  materials?: MaterialConfig[];
  /** Default elevation for new maps */
  defaultElevation: number;
  /** Default feature for new cells */
  defaultFeature: string;
  /** Default material (usually 0 for auto) */
  defaultMaterial?: number;
  /** Elevation range mode: 'discrete' (0,1,2) or 'continuous' (0-255) */
  elevationMode: 'discrete' | 'continuous';
  /** For continuous mode: min value */
  elevationMin?: number;
  /** For continuous mode: max value */
  elevationMax?: number;
}

// ============================================
// TOOL CONFIGURATION
// ============================================

/**
 * Built-in tool types supported by the editor
 */
export type BuiltInToolType =
  | 'select'    // Select and move objects
  | 'brush'     // Paint terrain/elevation
  | 'fill'      // Flood fill area
  | 'plateau'   // Create circular elevated area
  | 'ramp'      // Draw ramps between elevations
  | 'eraser'    // Clear/reset terrain
  | 'line'      // Draw lines
  | 'rect'      // Draw rectangles
  | 'ellipse';  // Draw ellipses

/**
 * Tool configuration
 */
export interface ToolConfig {
  /** Tool identifier */
  id: string;
  /** Display name */
  name: string;
  /** Icon (emoji or icon component name) */
  icon: string;
  /** Keyboard shortcut */
  shortcut: string;
  /** Tool type (built-in or custom) */
  type: BuiltInToolType | 'custom';
  /** Whether tool supports brush size */
  hasBrushSize?: boolean;
  /** Default brush size */
  defaultBrushSize?: number;
  /** Min brush size */
  minBrushSize?: number;
  /** Max brush size */
  maxBrushSize?: number;
  /** Tool-specific options */
  options?: Record<string, unknown>;
}

// ============================================
// OBJECT CONFIGURATION
// ============================================

/**
 * Defines a placeable object type (bases, watch towers, etc.)
 */
export interface ObjectTypeConfig {
  /** Unique identifier */
  id: string;
  /** Category for grouping in UI */
  category: string;
  /** Display name */
  name: string;
  /** Icon for UI */
  icon: string;
  /** Color for rendering */
  color: string;
  /** Default size/radius */
  defaultRadius?: number;
  /** Whether it can be moved */
  movable?: boolean;
  /** Whether it can be resized */
  resizable?: boolean;
  /** Additional properties for this object type */
  properties?: ObjectPropertyConfig[];
}

/**
 * Defines an editable property on an object
 */
export interface ObjectPropertyConfig {
  /** Property key */
  key: string;
  /** Display name */
  name: string;
  /** Property type */
  type: 'string' | 'number' | 'boolean' | 'select' | 'color';
  /** Default value */
  defaultValue?: unknown;
  /** For select type: available options */
  options?: Array<{ value: string | number; label: string }>;
  /** Min value for numbers */
  min?: number;
  /** Max value for numbers */
  max?: number;
}

// ============================================
// BIOME / THEME CONFIGURATION
// ============================================

/**
 * Defines a visual theme/biome
 */
export interface BiomeConfig {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Ground colors for different elevations */
  groundColors: string[];
  /** Accent color */
  accentColor: string;
  /** Background color */
  backgroundColor: string;
  /** Grid line color */
  gridColor: string;
}

// ============================================
// UI CONFIGURATION
// ============================================

/**
 * Panel configuration
 */
export interface PanelConfig {
  /** Panel identifier */
  id: string;
  /** Display name (tab label) */
  name: string;
  /** Icon for tab */
  icon?: string;
  /** Panel type */
  type: 'paint' | 'objects' | 'settings' | 'validate' | 'custom';
  /** For custom panels: component name to render */
  component?: string;
}

/**
 * UI theme configuration
 */
export interface UIThemeConfig {
  /** Primary accent color */
  primary: string;
  /** Background color */
  background: string;
  /** Surface color (panels, cards) */
  surface: string;
  /** Border color */
  border: string;
  /** Text colors */
  text: {
    primary: string;
    secondary: string;
    muted: string;
  };
  /** Selection/active color */
  selection: string;
  /** Success color */
  success: string;
  /** Warning color */
  warning: string;
  /** Error color */
  error: string;
}

// ============================================
// MAP DATA INTERFACE
// ============================================

/**
 * Generic cell interface that the editor works with
 */
export interface EditorCell {
  /** Elevation value */
  elevation: number;
  /** Terrain feature ID */
  feature: string;
  /** Whether walkable */
  walkable: boolean;
  /** Optional texture/variant ID (for visual variation within a material) */
  textureId?: number;
  /** Material/texture type ID (0=auto based on slope, 1+=explicit material from config) */
  materialId?: number;
}

/**
 * Generic object instance in the map
 */
export interface EditorObject {
  /** Unique instance ID */
  id: string;
  /** Object type ID (references ObjectTypeConfig) */
  type: string;
  /** X position */
  x: number;
  /** Y position */
  y: number;
  /** Optional radius/size */
  radius?: number;
  /** Additional properties */
  properties?: Record<string, unknown>;
}

/**
 * Generic map data structure the editor works with
 */
export interface EditorMapData {
  /** Map identifier */
  id: string;
  /** Map name */
  name: string;
  /** Map width in cells */
  width: number;
  /** Map height in cells */
  height: number;
  /** Terrain grid */
  terrain: EditorCell[][];
  /** Placed objects */
  objects: EditorObject[];
  /** Active biome/theme ID */
  biomeId: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================
// DATA PROVIDER INTERFACE
// ============================================

/**
 * Interface for loading and saving map data.
 * Games implement this to integrate with their data format.
 */
export interface EditorDataProvider {
  /** Get list of available maps */
  getMapList(): Promise<Array<{ id: string; name: string; thumbnail?: string }>>;

  /** Load a map by ID and convert to editor format */
  loadMap(id: string): Promise<EditorMapData>;

  /** Save map data (convert from editor format to game format) */
  saveMap(data: EditorMapData): Promise<void>;

  /** Create a new blank map */
  createMap(width: number, height: number, name: string): EditorMapData;

  /** Validate map connectivity (optional) */
  validateMap?(data: EditorMapData): Promise<ValidationResult>;

  /** Export map to game format (optional, for "save and play") */
  exportForGame?(data: EditorMapData): unknown;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  issues: Array<{
    type: 'error' | 'warning';
    message: string;
    location?: { x: number; y: number };
  }>;
}

// ============================================
// CALLBACKS / EVENT HANDLERS
// ============================================

/**
 * Editor event callbacks
 */
export interface EditorCallbacks {
  /** Called when map is saved */
  onSave?: (data: EditorMapData) => void;
  /** Called when user cancels editing */
  onCancel?: () => void;
  /** Called when user wants to play the map */
  onPlay?: (data: EditorMapData) => void;
  /** Called when map is modified */
  onChange?: (data: EditorMapData) => void;
  /** Called when validation is requested */
  onValidate?: (data: EditorMapData) => void;
}

// ============================================
// MAIN CONFIGURATION
// ============================================

/**
 * Complete editor configuration
 */
export interface EditorConfig {
  /** Editor name/title */
  name: string;
  /** Version string */
  version?: string;

  /** Terrain configuration */
  terrain: TerrainConfig;

  /** Available tools */
  tools: ToolConfig[];

  /** Object types that can be placed */
  objectTypes: ObjectTypeConfig[];

  /** Available biomes/themes */
  biomes: BiomeConfig[];

  /** Panel configuration */
  panels: PanelConfig[];

  /** UI theme */
  theme: UIThemeConfig;

  /** Default canvas settings */
  canvas: {
    /** Default zoom level */
    defaultZoom: number;
    /** Min zoom */
    minZoom: number;
    /** Max zoom */
    maxZoom: number;
    /** Show grid by default */
    showGrid: boolean;
    /** Grid cell size at 100% zoom */
    cellSize: number;
  };

  /** Keyboard shortcuts override */
  shortcuts?: Record<string, string>;

  /** Feature flags */
  features?: {
    /** Enable undo/redo */
    undoRedo?: boolean;
    /** Enable copy/paste */
    copyPaste?: boolean;
    /** Enable validation panel */
    validation?: boolean;
    /** Enable export/import */
    exportImport?: boolean;
    /** Max undo history size */
    maxUndoHistory?: number;
  };
}

// ============================================
// EDITOR STATE
// ============================================

/**
 * Runtime editor state (internal)
 */
export interface EditorState {
  /** Currently loaded map data */
  mapData: EditorMapData | null;
  /** Active tool ID */
  activeTool: string;
  /** Selected elevation */
  selectedElevation: number;
  /** Selected feature */
  selectedFeature: string;
  /** Selected material ID (0=auto, 1+=explicit) */
  selectedMaterial: number;
  /** Brush size */
  brushSize: number;
  /** Current zoom level */
  zoom: number;
  /** Canvas offset (pan) */
  offset: { x: number; y: number };
  /** Selected objects */
  selectedObjects: string[];
  /** Active panel */
  activePanel: string;
  /** Active biome */
  activeBiome: string;
  /** Has unsaved changes */
  isDirty: boolean;
  /** Undo stack */
  undoStack: EditorMapData[];
  /** Redo stack */
  redoStack: EditorMapData[];
}

// ============================================
// DEFAULTS
// ============================================

/**
 * Default UI theme (dark)
 */
export const DEFAULT_THEME: UIThemeConfig = {
  primary: '#843dff',
  background: '#0a0015',
  surface: '#1a0a2e',
  border: '#2c0076',
  text: {
    primary: '#ffffff',
    secondary: '#bea6ff',
    muted: '#6b4b9e',
  },
  selection: '#9f75ff',
  success: '#4caf50',
  warning: '#ff9800',
  error: '#f44336',
};

/**
 * Default tools
 */
export const DEFAULT_TOOLS: ToolConfig[] = [
  { id: 'select', name: 'Select', icon: '⬚', shortcut: 'V', type: 'select' },
  { id: 'brush', name: 'Brush', icon: '●', shortcut: 'B', type: 'brush', hasBrushSize: true, defaultBrushSize: 5, minBrushSize: 1, maxBrushSize: 20 },
  { id: 'fill', name: 'Fill', icon: '◉', shortcut: 'G', type: 'fill' },
  { id: 'plateau', name: 'Plateau', icon: '⬡', shortcut: 'P', type: 'plateau', hasBrushSize: true, defaultBrushSize: 10, minBrushSize: 3, maxBrushSize: 30 },
  { id: 'ramp', name: 'Ramp', icon: '◢', shortcut: 'R', type: 'ramp' },
  { id: 'eraser', name: 'Eraser', icon: '◌', shortcut: 'E', type: 'eraser', hasBrushSize: true, defaultBrushSize: 5, minBrushSize: 1, maxBrushSize: 20 },
];

/**
 * Default panels
 */
export const DEFAULT_PANELS: PanelConfig[] = [
  { id: 'paint', name: 'Paint', type: 'paint' },
  { id: 'objects', name: 'Objects', type: 'objects' },
  { id: 'settings', name: 'Settings', type: 'settings' },
  { id: 'validate', name: 'Validate', type: 'validate' },
];

/**
 * Default canvas settings
 */
export const DEFAULT_CANVAS = {
  defaultZoom: 80,
  minZoom: 20,
  maxZoom: 200,
  showGrid: true,
  cellSize: 4,
};

/**
 * Default features
 */
export const DEFAULT_FEATURES = {
  undoRedo: true,
  copyPaste: true,
  validation: true,
  exportImport: false,
  maxUndoHistory: 50,
};
