/**
 * VOIDSTRIKE Map Editor Configuration
 *
 * This file configures the generic map editor for the VOIDSTRIKE RTS game.
 * Modify this file to change elevation levels, terrain features, tools,
 * biomes, and other editor settings specific to your game.
 */

import {
  EditorConfig,
  TerrainConfig,
  ToolConfig,
  ObjectTypeConfig,
  BiomeConfig,
  PanelConfig,
  UIThemeConfig,
  DEFAULT_TOOLS,
  DEFAULT_PANELS,
  DEFAULT_CANVAS,
  DEFAULT_FEATURES,
} from '../config/EditorConfig';

// ============================================
// TERRAIN CONFIGURATION
// ============================================

/**
 * VOIDSTRIKE uses a continuous 0-255 elevation system similar to StarCraft 2.
 * Gameplay zones:
 * - Low ground: 0-85 (disadvantage when attacking uphill)
 * - Mid ground: 86-170 (neutral)
 * - High ground: 171-255 (advantage when attacking downhill)
 */
export const VOIDSTRIKE_TERRAIN: TerrainConfig = {
  elevationMode: 'continuous',
  elevationMin: 0,
  elevationMax: 255,
  defaultElevation: 140, // Mid ground
  defaultFeature: 'none',

  // Discrete elevation presets for the UI
  elevations: [
    {
      id: 0,
      name: 'Void',
      color: '#0a0015',
      description: 'Impassable void (map edges, chasms)',
      walkable: false,
      buildable: false,
      shortcut: '0',
    },
    {
      id: 30,
      name: 'Water',
      color: '#1e3a5f',
      description: 'Deep water - impassable',
      walkable: false,
      buildable: false,
      shortcut: '1',
    },
    {
      id: 60,
      name: 'Low',
      color: '#2d4a3e',
      description: 'Low ground - disadvantage attacking uphill',
      walkable: true,
      buildable: true,
      shortcut: '2',
    },
    {
      id: 140,
      name: 'Mid',
      color: '#4a6b4a',
      description: 'Medium ground - standard terrain',
      walkable: true,
      buildable: true,
      shortcut: '3',
    },
    {
      id: 220,
      name: 'High',
      color: '#6b8b4a',
      description: 'High ground - advantage attacking downhill',
      walkable: true,
      buildable: true,
      shortcut: '4',
    },
    {
      id: 255,
      name: 'Cliff',
      color: '#8b7355',
      description: 'Impassable cliff edge',
      walkable: false,
      buildable: false,
      shortcut: '5',
    },
  ],

  // Terrain features that can overlay elevation
  features: [
    {
      id: 'none',
      name: 'None',
      icon: '◻',
      color: 'transparent',
      walkable: true,
      buildable: true,
    },
    {
      id: 'water_shallow',
      name: 'Shallow Water',
      icon: '💧',
      color: '#4fc3f7',
      walkable: true,
      buildable: false,
      speedModifier: 0.6,
    },
    {
      id: 'water_deep',
      name: 'Deep Water',
      icon: '🌊',
      color: '#1565c0',
      walkable: false,
      buildable: false,
    },
    {
      id: 'forest_light',
      name: 'Light Forest',
      icon: '🌲',
      color: '#4caf50',
      walkable: true,
      buildable: false,
      speedModifier: 0.85,
    },
    {
      id: 'forest_dense',
      name: 'Dense Forest',
      icon: '🌳',
      color: '#2e7d32',
      walkable: true,
      buildable: false,
      speedModifier: 0.5,
      blocksVision: true,
    },
    {
      id: 'mud',
      name: 'Mud',
      icon: '🟤',
      color: '#795548',
      walkable: true,
      buildable: false,
      speedModifier: 0.4,
    },
    {
      id: 'road',
      name: 'Road',
      icon: '🛤',
      color: '#9e9e9e',
      walkable: true,
      buildable: false,
      speedModifier: 1.25,
    },
    {
      id: 'void',
      name: 'Void',
      icon: '⬛',
      color: '#0a0015',
      walkable: false,
      buildable: false,
    },
    {
      id: 'cliff',
      name: 'Cliff',
      icon: '🪨',
      color: '#8d6e63',
      walkable: false,
      buildable: false,
      blocksVision: true,
    },
  ],
};

// ============================================
// TOOLS CONFIGURATION
// ============================================

export const VOIDSTRIKE_TOOLS: ToolConfig[] = [
  ...DEFAULT_TOOLS,
  // Add VOIDSTRIKE-specific tools
  {
    id: 'water',
    name: 'Water',
    icon: '🌊',
    shortcut: 'W',
    type: 'brush',
    hasBrushSize: true,
    defaultBrushSize: 8,
    minBrushSize: 2,
    maxBrushSize: 30,
    options: { feature: 'water_deep' },
  },
  {
    id: 'forest',
    name: 'Forest',
    icon: '🌲',
    shortcut: 'F',
    type: 'brush',
    hasBrushSize: true,
    defaultBrushSize: 6,
    minBrushSize: 2,
    maxBrushSize: 20,
    options: { feature: 'forest_light' },
  },
];

// ============================================
// OBJECT TYPES
// ============================================

export const VOIDSTRIKE_OBJECTS: ObjectTypeConfig[] = [
  // Base locations
  {
    id: 'main_base',
    category: 'bases',
    name: 'Main Base',
    icon: '🏠',
    color: '#ffeb3b',
    defaultRadius: 12,
    movable: true,
    resizable: false,
    properties: [
      {
        key: 'playerSlot',
        name: 'Player Slot',
        type: 'number',
        defaultValue: 1,
        min: 1,
        max: 8,
      },
      {
        key: 'mineralDirection',
        name: 'Mineral Direction',
        type: 'select',
        defaultValue: 'right',
        options: [
          { value: 'up', label: 'Up' },
          { value: 'down', label: 'Down' },
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
          { value: 'up_left', label: 'Up-Left' },
          { value: 'up_right', label: 'Up-Right' },
          { value: 'down_left', label: 'Down-Left' },
          { value: 'down_right', label: 'Down-Right' },
        ],
      },
    ],
  },
  {
    id: 'natural',
    category: 'bases',
    name: 'Natural Expansion',
    icon: '🏗',
    color: '#8bc34a',
    defaultRadius: 10,
    movable: true,
    properties: [
      {
        key: 'mineralDirection',
        name: 'Mineral Direction',
        type: 'select',
        defaultValue: 'right',
        options: [
          { value: 'up', label: 'Up' },
          { value: 'down', label: 'Down' },
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
        ],
      },
    ],
  },
  {
    id: 'third',
    category: 'bases',
    name: 'Third Base',
    icon: '📍',
    color: '#9c27b0',
    defaultRadius: 10,
    movable: true,
  },
  {
    id: 'fourth',
    category: 'bases',
    name: 'Fourth Base',
    icon: '📍',
    color: '#673ab7',
    defaultRadius: 10,
    movable: true,
  },
  {
    id: 'gold',
    category: 'bases',
    name: 'Gold Base',
    icon: '💰',
    color: '#ffc107',
    defaultRadius: 10,
    movable: true,
  },

  // Watch towers
  {
    id: 'watch_tower',
    category: 'objects',
    name: 'Watch Tower',
    icon: '👁',
    color: '#ff9800',
    defaultRadius: 3,
    movable: true,
    resizable: true,
    properties: [
      {
        key: 'visionRadius',
        name: 'Vision Radius',
        type: 'number',
        defaultValue: 22,
        min: 10,
        max: 40,
      },
    ],
  },

  // Destructibles
  {
    id: 'destructible_rock',
    category: 'objects',
    name: 'Destructible Rock',
    icon: '🪨',
    color: '#795548',
    defaultRadius: 2,
    movable: true,
    properties: [
      {
        key: 'health',
        name: 'Health',
        type: 'number',
        defaultValue: 2000,
        min: 500,
        max: 5000,
      },
    ],
  },
  {
    id: 'destructible_debris',
    category: 'objects',
    name: 'Destructible Debris',
    icon: '💥',
    color: '#607d8b',
    defaultRadius: 3,
    movable: true,
  },
];

// ============================================
// BIOMES
// ============================================

export const VOIDSTRIKE_BIOMES: BiomeConfig[] = [
  {
    id: 'grassland',
    name: 'Grassland',
    groundColors: ['#3d5c3d', '#4a6b4a', '#5a7b5a'],
    accentColor: '#8bc34a',
    backgroundColor: '#1a2f1a',
    gridColor: 'rgba(139, 195, 74, 0.15)',
  },
  {
    id: 'desert',
    name: 'Desert',
    groundColors: ['#8b7355', '#9b8365', '#ab9375'],
    accentColor: '#ffc107',
    backgroundColor: '#2a1f15',
    gridColor: 'rgba(255, 193, 7, 0.15)',
  },
  {
    id: 'volcanic',
    name: 'Volcanic',
    groundColors: ['#4a3030', '#5a4040', '#6a5050'],
    accentColor: '#ff5722',
    backgroundColor: '#1a0a0a',
    gridColor: 'rgba(255, 87, 34, 0.15)',
  },
  {
    id: 'ice',
    name: 'Ice',
    groundColors: ['#4a5a6a', '#5a6a7a', '#6a7a8a'],
    accentColor: '#4fc3f7',
    backgroundColor: '#0a1520',
    gridColor: 'rgba(79, 195, 247, 0.15)',
  },
  {
    id: 'swamp',
    name: 'Swamp',
    groundColors: ['#3d4a3d', '#4d5a4d', '#5d6a5d'],
    accentColor: '#9c27b0',
    backgroundColor: '#0a150a',
    gridColor: 'rgba(156, 39, 176, 0.15)',
  },
];

// ============================================
// UI THEME
// ============================================

export const VOIDSTRIKE_THEME: UIThemeConfig = {
  primary: '#843dff',
  background: '#000000',
  surface: '#0a0015',
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

// ============================================
// PANELS
// ============================================

export const VOIDSTRIKE_PANELS: PanelConfig[] = [
  { id: 'paint', name: 'Paint', type: 'paint' },
  { id: 'bases', name: 'Bases', type: 'objects' },
  { id: 'objects', name: 'Objects', type: 'objects' },
  { id: 'settings', name: 'Settings', type: 'settings' },
  { id: 'validate', name: 'Validate', type: 'validate' },
];

// ============================================
// COMPLETE CONFIGURATION
// ============================================

export const VOIDSTRIKE_EDITOR_CONFIG: EditorConfig = {
  name: 'VOIDSTRIKE Map Editor',
  version: '1.0.0',

  terrain: VOIDSTRIKE_TERRAIN,
  tools: VOIDSTRIKE_TOOLS,
  objectTypes: VOIDSTRIKE_OBJECTS,
  biomes: VOIDSTRIKE_BIOMES,
  panels: VOIDSTRIKE_PANELS,
  theme: VOIDSTRIKE_THEME,

  canvas: {
    ...DEFAULT_CANVAS,
    defaultZoom: 80,
    cellSize: 4,
  },

  features: {
    ...DEFAULT_FEATURES,
    validation: true,
    undoRedo: true,
    maxUndoHistory: 50,
  },

  // Custom shortcuts
  shortcuts: {
    undo: 'Ctrl+Z',
    redo: 'Ctrl+Shift+Z',
    save: 'Ctrl+S',
    delete: 'Delete',
    selectAll: 'Ctrl+A',
    copy: 'Ctrl+C',
    paste: 'Ctrl+V',
  },
};

export default VOIDSTRIKE_EDITOR_CONFIG;
