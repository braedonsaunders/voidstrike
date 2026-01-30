import { useUIStore, DebugSettings } from '@/store/uiStore';

export type DebugCategory =
  | 'animation'
  | 'mesh'
  | 'terrain'
  | 'shaders'
  | 'postProcessing'
  | 'buildingPlacement'
  | 'combat'
  | 'resources'
  | 'production'
  | 'spawning'
  | 'ai'
  | 'pathfinding'
  | 'assets'
  | 'initialization'
  | 'audio'
  | 'networking'
  | 'performance';

// Map category names to debug settings keys
const categoryToSettingKey: Record<DebugCategory, keyof DebugSettings> = {
  animation: 'debugAnimation',
  mesh: 'debugMesh',
  terrain: 'debugTerrain',
  shaders: 'debugShaders',
  postProcessing: 'debugPostProcessing',
  buildingPlacement: 'debugBuildingPlacement',
  combat: 'debugCombat',
  resources: 'debugResources',
  production: 'debugProduction',
  spawning: 'debugSpawning',
  ai: 'debugAI',
  pathfinding: 'debugPathfinding',
  assets: 'debugAssets',
  initialization: 'debugInitialization',
  audio: 'debugAudio',
  networking: 'debugNetworking',
  performance: 'debugPerformance',
};

let workerDebugSettings: DebugSettings | null = null;

export function setWorkerDebugSettings(settings: DebugSettings): void {
  workerDebugSettings = settings;
}

function getDebugSettings(): DebugSettings | null {
  if (typeof window === 'undefined') {
    return workerDebugSettings;
  }

  return useUIStore.getState().debugSettings;
}

/**
 * Check if debugging is enabled for a specific category
 */
function isEnabled(category: DebugCategory): boolean {
  const debugSettings = getDebugSettings();

  // Check master toggle first
  if (!debugSettings || !debugSettings.debugEnabled) {
    return false;
  }

  // Check specific category
  const settingKey = categoryToSettingKey[category];
  return debugSettings[settingKey] as boolean;
}

/**
 * Debug logger that respects the debug settings from the UI store.
 * Only logs when both the master debug toggle and the specific category are enabled.
 */
export const debugLog = {
  /**
   * Log a message if the category is enabled
   */
  log(category: DebugCategory, ...args: unknown[]): void {
    if (isEnabled(category)) {
      console.log(...args);
    }
  },

  /**
   * Log a warning if the category is enabled
   */
  warn(category: DebugCategory, ...args: unknown[]): void {
    if (isEnabled(category)) {
      console.warn(...args);
    }
  },

  /**
   * Log an error if the category is enabled
   */
  error(category: DebugCategory, ...args: unknown[]): void {
    if (isEnabled(category)) {
      console.error(...args);
    }
  },

  /**
   * Check if a category is enabled (useful for expensive debug operations)
   */
  isEnabled,
};

// Category-specific logger interface
interface CategoryLogger {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  isEnabled: () => boolean;
}

/**
 * Factory function to create category-specific loggers.
 * Eliminates boilerplate for each debug category.
 */
function createCategoryLogger(category: DebugCategory): CategoryLogger {
  return {
    log: (...args: unknown[]) => debugLog.log(category, ...args),
    warn: (...args: unknown[]) => debugLog.warn(category, ...args),
    error: (...args: unknown[]) => debugLog.error(category, ...args),
    isEnabled: () => isEnabled(category),
  };
}

// Category-specific loggers generated via factory
export const debugAnimation = createCategoryLogger('animation');
export const debugMesh = createCategoryLogger('mesh');
export const debugTerrain = createCategoryLogger('terrain');
export const debugShaders = createCategoryLogger('shaders');
export const debugPostProcessing = createCategoryLogger('postProcessing');
export const debugBuildingPlacement = createCategoryLogger('buildingPlacement');
export const debugCombat = createCategoryLogger('combat');
export const debugResources = createCategoryLogger('resources');
export const debugProduction = createCategoryLogger('production');
export const debugSpawning = createCategoryLogger('spawning');
export const debugAI = createCategoryLogger('ai');
export const debugPathfinding = createCategoryLogger('pathfinding');
export const debugAssets = createCategoryLogger('assets');
export const debugInitialization = createCategoryLogger('initialization');
export const debugAudio = createCategoryLogger('audio');
export const debugNetworking = createCategoryLogger('networking');
export const debugPerformance = createCategoryLogger('performance');
