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
  | 'audio';

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
};

/**
 * Check if debugging is enabled for a specific category
 */
function isEnabled(category: DebugCategory): boolean {
  const state = useUIStore.getState();
  const { debugSettings } = state;

  // Check master toggle first
  if (!debugSettings.debugEnabled) {
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

// Category-specific loggers for convenience
export const debugAnimation = {
  log: (...args: unknown[]) => debugLog.log('animation', ...args),
  warn: (...args: unknown[]) => debugLog.warn('animation', ...args),
  error: (...args: unknown[]) => debugLog.error('animation', ...args),
  isEnabled: () => isEnabled('animation'),
};

export const debugMesh = {
  log: (...args: unknown[]) => debugLog.log('mesh', ...args),
  warn: (...args: unknown[]) => debugLog.warn('mesh', ...args),
  error: (...args: unknown[]) => debugLog.error('mesh', ...args),
  isEnabled: () => isEnabled('mesh'),
};

export const debugTerrain = {
  log: (...args: unknown[]) => debugLog.log('terrain', ...args),
  warn: (...args: unknown[]) => debugLog.warn('terrain', ...args),
  error: (...args: unknown[]) => debugLog.error('terrain', ...args),
  isEnabled: () => isEnabled('terrain'),
};

export const debugShaders = {
  log: (...args: unknown[]) => debugLog.log('shaders', ...args),
  warn: (...args: unknown[]) => debugLog.warn('shaders', ...args),
  error: (...args: unknown[]) => debugLog.error('shaders', ...args),
  isEnabled: () => isEnabled('shaders'),
};

export const debugPostProcessing = {
  log: (...args: unknown[]) => debugLog.log('postProcessing', ...args),
  warn: (...args: unknown[]) => debugLog.warn('postProcessing', ...args),
  error: (...args: unknown[]) => debugLog.error('postProcessing', ...args),
  isEnabled: () => isEnabled('postProcessing'),
};

export const debugBuildingPlacement = {
  log: (...args: unknown[]) => debugLog.log('buildingPlacement', ...args),
  warn: (...args: unknown[]) => debugLog.warn('buildingPlacement', ...args),
  error: (...args: unknown[]) => debugLog.error('buildingPlacement', ...args),
  isEnabled: () => isEnabled('buildingPlacement'),
};

export const debugCombat = {
  log: (...args: unknown[]) => debugLog.log('combat', ...args),
  warn: (...args: unknown[]) => debugLog.warn('combat', ...args),
  error: (...args: unknown[]) => debugLog.error('combat', ...args),
  isEnabled: () => isEnabled('combat'),
};

export const debugResources = {
  log: (...args: unknown[]) => debugLog.log('resources', ...args),
  warn: (...args: unknown[]) => debugLog.warn('resources', ...args),
  error: (...args: unknown[]) => debugLog.error('resources', ...args),
  isEnabled: () => isEnabled('resources'),
};

export const debugProduction = {
  log: (...args: unknown[]) => debugLog.log('production', ...args),
  warn: (...args: unknown[]) => debugLog.warn('production', ...args),
  error: (...args: unknown[]) => debugLog.error('production', ...args),
  isEnabled: () => isEnabled('production'),
};

export const debugSpawning = {
  log: (...args: unknown[]) => debugLog.log('spawning', ...args),
  warn: (...args: unknown[]) => debugLog.warn('spawning', ...args),
  error: (...args: unknown[]) => debugLog.error('spawning', ...args),
  isEnabled: () => isEnabled('spawning'),
};

export const debugAI = {
  log: (...args: unknown[]) => debugLog.log('ai', ...args),
  warn: (...args: unknown[]) => debugLog.warn('ai', ...args),
  error: (...args: unknown[]) => debugLog.error('ai', ...args),
  isEnabled: () => isEnabled('ai'),
};

export const debugPathfinding = {
  log: (...args: unknown[]) => debugLog.log('pathfinding', ...args),
  warn: (...args: unknown[]) => debugLog.warn('pathfinding', ...args),
  error: (...args: unknown[]) => debugLog.error('pathfinding', ...args),
  isEnabled: () => isEnabled('pathfinding'),
};

export const debugAssets = {
  log: (...args: unknown[]) => debugLog.log('assets', ...args),
  warn: (...args: unknown[]) => debugLog.warn('assets', ...args),
  error: (...args: unknown[]) => debugLog.error('assets', ...args),
  isEnabled: () => isEnabled('assets'),
};

export const debugInitialization = {
  log: (...args: unknown[]) => debugLog.log('initialization', ...args),
  warn: (...args: unknown[]) => debugLog.warn('initialization', ...args),
  error: (...args: unknown[]) => debugLog.error('initialization', ...args),
  isEnabled: () => isEnabled('initialization'),
};

export const debugAudio = {
  log: (...args: unknown[]) => debugLog.log('audio', ...args),
  warn: (...args: unknown[]) => debugLog.warn('audio', ...args),
  error: (...args: unknown[]) => debugLog.error('audio', ...args),
  isEnabled: () => isEnabled('audio'),
};
