import { create } from 'zustand';
import { debugInitialization } from '@/utils/debugLogger';

export type ScreenType = 'main-menu' | 'game' | 'lobby' | 'loading' | 'settings';
export type NotificationType = 'info' | 'warning' | 'error' | 'success';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  duration: number;
}

// Debug settings for console logging groups
export interface DebugSettings {
  // Master toggle
  debugEnabled: boolean;
  // Rendering
  debugAnimation: boolean;
  debugMesh: boolean;
  debugTerrain: boolean;
  debugShaders: boolean;
  debugPostProcessing: boolean;
  // Gameplay
  debugBuildingPlacement: boolean;
  debugCombat: boolean;
  debugResources: boolean;
  debugProduction: boolean;
  debugSpawning: boolean;
  // Systems
  debugAI: boolean;
  debugPathfinding: boolean;
  // Assets & Initialization
  debugAssets: boolean;
  debugInitialization: boolean;
  // Audio
  debugAudio: boolean;
  // Networking
  debugNetworking: boolean;
  // Performance
  debugPerformance: boolean;
}

// Performance metrics for display
export interface PerformanceMetrics {
  cpuTime: number;      // milliseconds spent in JS/game logic
  gpuTime: number;      // estimated GPU time (frame time - cpu time)
  frameTime: number;    // total frame time in ms
  triangles: number;    // triangles rendered this frame
  drawCalls: number;    // draw calls this frame
  renderWidth: number;  // actual render width in pixels
  renderHeight: number; // actual render height in pixels
  displayWidth: number; // display/canvas width in pixels
  displayHeight: number; // display/canvas height in pixels
  // GPU indirect rendering status
  gpuCullingActive: boolean;   // true if GPU culling is being used
  gpuIndirectActive: boolean;  // true if GPU indirect draw is enabled
  gpuManagedUnits: number;     // units tracked in GPU buffer
}

// Renderer API type (WebGPU or WebGL)
export type RendererAPI = 'WebGPU' | 'WebGL' | null;

// GPU adapter info for display
export interface GpuInfo {
  name: string;           // Device description (e.g., "NVIDIA GeForce RTX 4090")
  vendor: string;         // Vendor name (e.g., "nvidia", "amd", "intel")
  architecture: string;   // Architecture (e.g., "ampere")
  isIntegrated: boolean;  // True if likely an integrated GPU
}

// Anti-aliasing mode selection
export type AntiAliasingMode = 'off' | 'fxaa' | 'taa';

// Upscaling mode selection (EASU = Edge-Adaptive Spatial Upsampling)
export type UpscalingMode = 'off' | 'easu' | 'bilinear';

// Graphics preset types
export type GraphicsPresetName = 'low' | 'medium' | 'high' | 'ultra' | 'custom';

export interface GraphicsPreset {
  name: string;
  description: string;
  settings: Partial<GraphicsSettings> | null;
}

export interface GraphicsPresetsConfig {
  version: string;
  description: string;
  presets: Record<GraphicsPresetName, GraphicsPreset>;
  defaultPreset: GraphicsPresetName;
}

// Resolution mode for display
export type ResolutionMode = 'native' | 'fixed' | 'percentage';

// Common fixed resolutions
export type FixedResolution = '720p' | '1080p' | '1440p' | '4k';

export const FIXED_RESOLUTIONS: Record<FixedResolution, { width: number; height: number; label: string }> = {
  '720p': { width: 1280, height: 720, label: '720p (1280×720)' },
  '1080p': { width: 1920, height: 1080, label: '1080p (1920×1080)' },
  '1440p': { width: 2560, height: 1440, label: '1440p (2560×1440)' },
  '4k': { width: 3840, height: 2160, label: '4K (3840×2160)' },
};

// Graphics settings for post-processing and visual effects
export interface GraphicsSettings {
  // Master toggle
  postProcessingEnabled: boolean;

  // Tone mapping & color
  toneMappingExposure: number;
  saturation: number;
  contrast: number;

  // Shadows
  shadowsEnabled: boolean;
  shadowQuality: 'low' | 'medium' | 'high' | 'ultra';
  shadowDistance: number;

  // Ambient Occlusion (SSAO/GTAO)
  ssaoEnabled: boolean;
  ssaoRadius: number;
  ssaoIntensity: number;

  // Bloom
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  bloomRadius: number;

  // Anti-aliasing (FXAA or TAA)
  antiAliasingMode: AntiAliasingMode;
  fxaaEnabled: boolean; // Legacy - derived from antiAliasingMode

  // TAA-specific settings
  taaEnabled: boolean; // Derived from antiAliasingMode
  taaHistoryBlendRate: number; // 0.0-1.0, lower = more smoothing
  taaSharpeningEnabled: boolean;
  taaSharpeningIntensity: number; // 0.0-1.0

  // SSR (Screen Space Reflections)
  ssrEnabled: boolean;
  ssrOpacity: number; // 0.0-1.0, reflection intensity
  ssrMaxRoughness: number; // 0.0-1.0, max roughness for reflections

  // SSGI (Screen Space Global Illumination)
  ssgiEnabled: boolean;
  ssgiRadius: number; // 1-25, sampling radius in world space
  ssgiIntensity: number; // 0-100, GI intensity

  // Resolution settings
  resolutionMode: ResolutionMode; // 'native', 'fixed', or 'percentage'
  fixedResolution: FixedResolution; // Used when resolutionMode is 'fixed'
  resolutionScale: number; // 0.5-1.0, used when resolutionMode is 'percentage'
  maxPixelRatio: number; // 1-3, max device pixel ratio (caps high-DPI rendering)

  // Resolution upscaling (EASU - Edge-Adaptive Spatial Upsampling)
  upscalingMode: UpscalingMode;
  renderScale: number; // 0.5-1.0, internal render resolution (for FSR/bilinear)
  easuSharpness: number; // 0.0-1.0, edge enhancement strength

  // Vignette
  vignetteEnabled: boolean;
  vignetteIntensity: number;

  // Fog
  fogEnabled: boolean;
  fogDensity: number;
  volumetricFogEnabled: boolean;
  volumetricFogQuality: 'low' | 'medium' | 'high' | 'ultra';
  volumetricFogDensity: number;
  volumetricFogScattering: number;

  // Fog of War (StarCraft 2-style post-processing)
  fogOfWarQuality: 'low' | 'medium' | 'high' | 'ultra';
  fogOfWarEdgeBlur: number; // 0-4 cells
  fogOfWarDesaturation: number; // 0-1
  fogOfWarExploredDarkness: number; // 0.3-0.7
  fogOfWarUnexploredDarkness: number; // 0.05-0.2
  fogOfWarCloudSpeed: number;
  fogOfWarRimIntensity: number; // 0-0.3
  fogOfWarHeightInfluence: number; // 0-1

  // Lighting
  shadowFill: number; // 0-1, controls ground bounce light intensity
  dynamicLightsEnabled: boolean;
  maxDynamicLights: number; // 4, 8, 16, 32
  emissiveDecorationsEnabled: boolean;
  emissiveIntensityMultiplier: number; // 0.5-2.0

  // Environment
  environmentMapEnabled: boolean;

  // Outline (selection)
  outlineEnabled: boolean;
  outlineStrength: number;

  // Particles
  particlesEnabled: boolean;
  particleDensity: number;

  // LOD (Level of Detail)
  lodEnabled: boolean;
  lodDistance0: number; // Distance threshold for LOD0 (highest detail)
  lodDistance1: number; // Distance threshold for LOD1 (medium detail)
  // Beyond lodDistance1, LOD2 (lowest detail) is used

  // Frame Rate Limit
  maxFPS: number; // 0 = unlimited, otherwise caps at this value (30, 60, 120, 144)
}

// ============================================
// LOCALSTORAGE PERSISTENCE
// ============================================

const GRAPHICS_SETTINGS_KEY = 'voidstrike_graphics_settings';
const AUDIO_SETTINGS_KEY = 'voidstrike_audio_settings';

interface SavedGraphicsState {
  settings: GraphicsSettings;
  preset: GraphicsPresetName;
  version: number; // For future migrations
}

interface SavedAudioState {
  musicEnabled: boolean;
  soundEnabled: boolean;
  musicVolume: number;
  soundVolume: number;
  voicesEnabled: boolean;
  alertsEnabled: boolean;
  voiceVolume: number;
  alertVolume: number;
  version: number;
}

const SETTINGS_VERSION = 1;
const AUDIO_SETTINGS_VERSION = 1;

function saveGraphicsSettings(settings: GraphicsSettings, preset: GraphicsPresetName): void {
  if (typeof window === 'undefined') return;
  try {
    const state: SavedGraphicsState = {
      settings,
      preset,
      version: SETTINGS_VERSION,
    };
    localStorage.setItem(GRAPHICS_SETTINGS_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save graphics settings:', e);
  }
}

function loadGraphicsSettings(): { settings: Partial<GraphicsSettings>; preset: GraphicsPresetName } | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(GRAPHICS_SETTINGS_KEY);
    if (!saved) return null;

    const state = JSON.parse(saved) as SavedGraphicsState;

    // Version check for future migrations
    if (state.version !== SETTINGS_VERSION) {
      debugInitialization.log('[Graphics] Settings version mismatch, using defaults');
      return null;
    }

    return { settings: state.settings, preset: state.preset };
  } catch (e) {
    console.warn('Failed to load graphics settings:', e);
    return null;
  }
}

// ============================================
// LOCALSTORAGE PERSISTENCE (Audio Settings)
// ============================================

function saveAudioSettings(state: SavedAudioState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save audio settings:', e);
  }
}

function loadAudioSettings(): SavedAudioState | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(AUDIO_SETTINGS_KEY);
    if (!saved) return null;

    const state = JSON.parse(saved) as SavedAudioState;

    // Version check for future migrations
    if (state.version !== AUDIO_SETTINGS_VERSION) {
      debugInitialization.log('[Audio] Settings version mismatch, using defaults');
      return null;
    }

    return state;
  } catch (e) {
    console.warn('Failed to load audio settings:', e);
    return null;
  }
}

// Load audio settings at module initialization
const savedAudioSettings = loadAudioSettings();

// ============================================
// SESSIONSTORAGE PERSISTENCE (Debug Settings)
// ============================================

const DEBUG_SETTINGS_KEY = 'voidstrike_debug_settings';

function saveDebugSettings(settings: DebugSettings): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(DEBUG_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Silently fail - debug settings not critical
  }
}

function loadDebugSettings(): DebugSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = sessionStorage.getItem(DEBUG_SETTINGS_KEY);
    if (!saved) return null;
    return JSON.parse(saved) as DebugSettings;
  } catch {
    return null;
  }
}

// Load debug settings at module initialization (before store is created)
const savedDebugSettings = loadDebugSettings();

// ============================================
// UI STATE TYPES
// ============================================

// Game overlay types for strategic information display
// 'navmesh' shows ACTUAL pathfinding data from Recast Navigation (critical for debugging)
export type GameOverlayType = 'none' | 'terrain' | 'elevation' | 'threat' | 'navmesh';

// Overlay settings
export interface OverlaySettings {
  activeOverlay: GameOverlayType;
  terrainOverlayOpacity: number;
  elevationOverlayOpacity: number;
  threatOverlayOpacity: number;
  navmeshOverlayOpacity: number;
}

export interface UIState {
  // Screen management
  currentScreen: ScreenType;
  previousScreen: ScreenType | null;

  // Modal/overlay state
  isModalOpen: boolean;
  modalContent: React.ReactNode | null;

  // HUD menu state (centralized for edge scroll control)
  showOptionsMenu: boolean;
  showOverlayMenu: boolean;
  showPlayerStatus: boolean;

  // Notifications
  notifications: Notification[];

  // Tooltip
  tooltipContent: string | null;
  tooltipPosition: { x: number; y: number } | null;

  // Context menu
  contextMenuOpen: boolean;
  contextMenuPosition: { x: number; y: number } | null;
  contextMenuItems: Array<{ label: string; action: () => void }>;

  // Settings
  soundEnabled: boolean;
  musicEnabled: boolean;
  soundVolume: number;
  musicVolume: number;
  // Granular audio settings
  voicesEnabled: boolean;
  alertsEnabled: boolean;
  voiceVolume: number;
  alertVolume: number;
  showFPS: boolean;
  showPing: boolean;

  // Graphics settings
  graphicsSettings: GraphicsSettings;
  currentGraphicsPreset: GraphicsPresetName;
  graphicsPresetsLoaded: boolean;
  graphicsPresetsConfig: GraphicsPresetsConfig | null;
  showGraphicsOptions: boolean;
  rendererAPI: RendererAPI;
  gpuInfo: GpuInfo | null;
  preferWebGPU: boolean; // User preference for renderer (true = try WebGPU, false = force WebGL)

  // Sound settings
  showSoundOptions: boolean;

  // Fullscreen
  isFullscreen: boolean;

  // Debug settings
  debugSettings: DebugSettings;
  showDebugMenu: boolean;

  // Performance panel
  showPerformancePanel: boolean;

  // Overlay settings for strategic view
  overlaySettings: OverlaySettings;

  // Performance metrics (updated from render loop)
  performanceMetrics: PerformanceMetrics;

  // Actions
  setScreen: (screen: ScreenType) => void;
  goBack: () => void;
  openModal: (content: React.ReactNode) => void;
  closeModal: () => void;
  addNotification: (type: NotificationType, message: string, duration?: number) => void;
  removeNotification: (id: string) => void;
  showTooltip: (content: string, x: number, y: number) => void;
  hideTooltip: () => void;
  openContextMenu: (
    x: number,
    y: number,
    items: Array<{ label: string; action: () => void }>
  ) => void;
  closeContextMenu: () => void;
  toggleSound: () => void;
  toggleMusic: () => void;
  setSoundVolume: (volume: number) => void;
  setMusicVolume: (volume: number) => void;
  // Granular audio actions
  toggleVoices: () => void;
  toggleAlerts: () => void;
  setVoiceVolume: (volume: number) => void;
  setAlertVolume: (volume: number) => void;
  toggleFPS: () => void;
  togglePing: () => void;
  // Graphics settings actions
  toggleGraphicsOptions: () => void;
  setGraphicsSetting: <K extends keyof GraphicsSettings>(key: K, value: GraphicsSettings[K]) => void;
  toggleGraphicsSetting: (key: keyof GraphicsSettings) => void;
  setAntiAliasingMode: (mode: AntiAliasingMode) => void;
  setUpscalingMode: (mode: UpscalingMode) => void;
  setResolutionMode: (mode: ResolutionMode) => void;
  setFixedResolution: (res: FixedResolution) => void;
  setMaxFPS: (fps: number) => void;
  setRendererAPI: (api: RendererAPI) => void;
  setGpuInfo: (info: GpuInfo | null) => void;
  setPreferWebGPU: (prefer: boolean) => void;
  // Graphics preset actions
  loadGraphicsPresets: () => Promise<void>;
  applyGraphicsPreset: (presetName: GraphicsPresetName) => void;
  detectCurrentPreset: () => GraphicsPresetName;
  // Graphics persistence
  loadSavedGraphicsSettings: () => void;
  // Sound settings actions
  toggleSoundOptions: () => void;
  // Fullscreen actions
  toggleFullscreen: () => void;
  setFullscreen: (isFullscreen: boolean) => void;
  // Debug settings actions
  toggleDebugMenu: () => void;
  toggleDebugSetting: (key: keyof DebugSettings) => void;
  setAllDebugSettings: (enabled: boolean) => void;
  // Performance panel actions
  togglePerformancePanel: () => void;
  // HUD menu actions
  setShowOptionsMenu: (show: boolean) => void;
  setShowOverlayMenu: (show: boolean) => void;
  setShowPlayerStatus: (show: boolean) => void;
  closeAllMenus: () => void;
  // Overlay settings actions
  setActiveOverlay: (overlay: GameOverlayType) => void;
  toggleOverlay: (overlay: GameOverlayType) => void;
  setOverlayOpacity: (overlay: GameOverlayType, opacity: number) => void;
  // Performance metrics action
  updatePerformanceMetrics: (metrics: Partial<PerformanceMetrics>) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  currentScreen: 'main-menu',
  previousScreen: null,
  isModalOpen: false,
  modalContent: null,
  // HUD menu state
  showOptionsMenu: false,
  showOverlayMenu: false,
  showPlayerStatus: false,
  notifications: [],
  tooltipContent: null,
  tooltipPosition: null,
  contextMenuOpen: false,
  contextMenuPosition: null,
  contextMenuItems: [],
  // Audio settings - load from localStorage if available
  soundEnabled: savedAudioSettings?.soundEnabled ?? true,
  musicEnabled: savedAudioSettings?.musicEnabled ?? true,
  soundVolume: savedAudioSettings?.soundVolume ?? 0.7,
  musicVolume: savedAudioSettings?.musicVolume ?? 0.25,
  // Granular audio defaults
  voicesEnabled: savedAudioSettings?.voicesEnabled ?? true,
  alertsEnabled: savedAudioSettings?.alertsEnabled ?? true,
  voiceVolume: savedAudioSettings?.voiceVolume ?? 0.7,
  alertVolume: savedAudioSettings?.alertVolume ?? 0.8,
  showFPS: false,
  showPing: true,
  showGraphicsOptions: false,
  rendererAPI: null,
  gpuInfo: null,
  preferWebGPU: true, // Default to WebGPU for best visual quality
  showSoundOptions: false,
  isFullscreen: false,
  graphicsSettings: {
    // Master
    postProcessingEnabled: true,

    // Tone mapping & color
    toneMappingExposure: 1.0,
    saturation: 0.8,
    contrast: 1.05,

    // Shadows
    // PERFORMANCE: Default to medium quality (1024x1024) to reduce shadow rendering overhead
    shadowsEnabled: true,
    shadowQuality: 'medium',
    shadowDistance: 80,

    // Ambient Occlusion
    ssaoEnabled: true,
    ssaoRadius: 4,
    ssaoIntensity: 1.0,

    // Bloom
    bloomEnabled: true,
    bloomStrength: 0.3,
    bloomThreshold: 0.8,
    bloomRadius: 0.5,

    // Anti-aliasing - TAA provides best quality, FXAA is fast fallback
    // TAA uses zero-velocity mode to work with all material types
    antiAliasingMode: 'taa' as AntiAliasingMode,
    fxaaEnabled: false, // Legacy, derived from antiAliasingMode
    taaEnabled: true, // Derived from antiAliasingMode
    taaHistoryBlendRate: 0.1, // Default blend rate (90% history, 10% current)
    taaSharpeningEnabled: true, // Counter TAA blur with RCAS
    taaSharpeningIntensity: 0.5, // Moderate sharpening

    // SSR (Screen Space Reflections) - disabled by default (expensive)
    ssrEnabled: false,
    ssrOpacity: 1.0, // Full reflection intensity when enabled
    ssrMaxRoughness: 0.5, // Only reflect on moderately smooth surfaces

    // SSGI (Screen Space Global Illumination) - disabled by default (expensive)
    ssgiEnabled: false,
    ssgiRadius: 8, // Sampling radius in world space
    ssgiIntensity: 15, // GI intensity

    // Resolution settings - native by default with DPR cap of 2
    resolutionMode: 'native' as ResolutionMode,
    fixedResolution: '1080p' as FixedResolution,
    resolutionScale: 1.0, // 100% of native
    maxPixelRatio: 2, // Cap at 2x for performance on high-DPI displays

    // Resolution upscaling - disabled by default (native resolution)
    upscalingMode: 'off' as UpscalingMode,
    renderScale: 1.0, // 100% resolution
    easuSharpness: 0.5, // Moderate edge enhancement

    // Vignette
    vignetteEnabled: true,
    vignetteIntensity: 0.25,

    // Fog
    fogEnabled: true,
    fogDensity: 1.0, // 1.0 is baseline (1x), range 0.5-2.0
    volumetricFogEnabled: false, // Disabled by default (performance)
    volumetricFogQuality: 'medium' as const,
    volumetricFogDensity: 1.0,
    volumetricFogScattering: 1.0,

    // Fog of War (StarCraft 2-style) - High quality defaults for polished look
    fogOfWarQuality: 'high' as const,
    fogOfWarEdgeBlur: 2.5, // Soft edges like SC2
    fogOfWarDesaturation: 0.7, // Strong desaturation for explored
    fogOfWarExploredDarkness: 0.5, // Half brightness for explored
    fogOfWarUnexploredDarkness: 0.12, // Very dark unexplored
    fogOfWarCloudSpeed: 0.015, // Slow, subtle cloud animation
    fogOfWarRimIntensity: 0.12, // Subtle edge glow
    fogOfWarHeightInfluence: 0.25, // Moderate height influence

    // Lighting
    shadowFill: 0.3, // 30% ground bounce fill light
    dynamicLightsEnabled: true,
    maxDynamicLights: 8,
    emissiveDecorationsEnabled: true,
    emissiveIntensityMultiplier: 1.0,

    // Environment
    environmentMapEnabled: true,

    // Outline (selection)
    outlineEnabled: true,
    outlineStrength: 2,

    // Particles
    particlesEnabled: true,
    particleDensity: 7.5, // 5.0 is baseline (1x), 7.5 = 1.5x, range 1-15

    // LOD (Level of Detail)
    lodEnabled: true,
    lodDistance0: 50, // Use LOD0 (highest detail) within 50 units from camera
    lodDistance1: 120, // Use LOD1 (medium detail) between 50-120 units, LOD2 beyond

    // Frame Rate Limit
    maxFPS: 0, // Unlimited by default
  },
  currentGraphicsPreset: 'high' as GraphicsPresetName, // Default to High preset
  graphicsPresetsLoaded: false,
  graphicsPresetsConfig: null,
  showDebugMenu: false,
  showPerformancePanel: false,
  overlaySettings: {
    activeOverlay: 'none',
    terrainOverlayOpacity: 0.7,
    elevationOverlayOpacity: 0.7,
    threatOverlayOpacity: 0.5,
    navmeshOverlayOpacity: 0.8,
  },
  performanceMetrics: {
    cpuTime: 0,
    gpuTime: 0,
    frameTime: 0,
    triangles: 0,
    drawCalls: 0,
    renderWidth: 0,
    renderHeight: 0,
    displayWidth: 0,
    displayHeight: 0,
    gpuCullingActive: false,
    gpuIndirectActive: false,
    gpuManagedUnits: 0,
  },
  debugSettings: savedDebugSettings ?? {
    debugEnabled: false,
    // Rendering
    debugAnimation: false,
    debugMesh: false,
    debugTerrain: false,
    debugShaders: false,
    debugPostProcessing: false,
    // Gameplay
    debugBuildingPlacement: false,
    debugCombat: false,
    debugResources: false,
    debugProduction: false,
    debugSpawning: false,
    // Systems
    debugAI: false,
    debugPathfinding: false,
    // Assets & Initialization
    debugAssets: false,
    debugInitialization: false,
    // Audio
    debugAudio: false,
    // Networking
    debugNetworking: false,
    // Performance
    debugPerformance: false,
  },

  setScreen: (screen) =>
    set((state) => ({
      previousScreen: state.currentScreen,
      currentScreen: screen,
    })),

  goBack: () =>
    set((state) => ({
      currentScreen: state.previousScreen || 'main-menu',
      previousScreen: null,
    })),

  openModal: (content) => set({ isModalOpen: true, modalContent: content }),

  closeModal: () => set({ isModalOpen: false, modalContent: null }),

  addNotification: (type, message, duration = 5000) => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const notification: Notification = { id, type, message, duration };

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        get().removeNotification(id);
      }, duration);
    }
  },

  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  showTooltip: (content, x, y) =>
    set({
      tooltipContent: content,
      tooltipPosition: { x, y },
    }),

  hideTooltip: () =>
    set({
      tooltipContent: null,
      tooltipPosition: null,
    }),

  openContextMenu: (x, y, items) =>
    set({
      contextMenuOpen: true,
      contextMenuPosition: { x, y },
      contextMenuItems: items,
    }),

  closeContextMenu: () =>
    set({
      contextMenuOpen: false,
      contextMenuPosition: null,
      contextMenuItems: [],
    }),

  toggleSound: () => {
    set((state) => ({ soundEnabled: !state.soundEnabled }));
    // Save to localStorage
    const s = get();
    saveAudioSettings({
      musicEnabled: s.musicEnabled, soundEnabled: s.soundEnabled,
      musicVolume: s.musicVolume, soundVolume: s.soundVolume,
      voicesEnabled: s.voicesEnabled, alertsEnabled: s.alertsEnabled,
      voiceVolume: s.voiceVolume, alertVolume: s.alertVolume,
      version: AUDIO_SETTINGS_VERSION,
    });
  },

  toggleMusic: () => {
    set((state) => ({ musicEnabled: !state.musicEnabled }));
    // Save to localStorage
    const s = get();
    saveAudioSettings({
      musicEnabled: s.musicEnabled, soundEnabled: s.soundEnabled,
      musicVolume: s.musicVolume, soundVolume: s.soundVolume,
      voicesEnabled: s.voicesEnabled, alertsEnabled: s.alertsEnabled,
      voiceVolume: s.voiceVolume, alertVolume: s.alertVolume,
      version: AUDIO_SETTINGS_VERSION,
    });
  },

  setSoundVolume: (volume) => {
    set({ soundVolume: Math.max(0, Math.min(1, volume)) });
    const s = get();
    saveAudioSettings({
      musicEnabled: s.musicEnabled, soundEnabled: s.soundEnabled,
      musicVolume: s.musicVolume, soundVolume: s.soundVolume,
      voicesEnabled: s.voicesEnabled, alertsEnabled: s.alertsEnabled,
      voiceVolume: s.voiceVolume, alertVolume: s.alertVolume,
      version: AUDIO_SETTINGS_VERSION,
    });
  },

  setMusicVolume: (volume) => {
    set({ musicVolume: Math.max(0, Math.min(1, volume)) });
    const s = get();
    saveAudioSettings({
      musicEnabled: s.musicEnabled, soundEnabled: s.soundEnabled,
      musicVolume: s.musicVolume, soundVolume: s.soundVolume,
      voicesEnabled: s.voicesEnabled, alertsEnabled: s.alertsEnabled,
      voiceVolume: s.voiceVolume, alertVolume: s.alertVolume,
      version: AUDIO_SETTINGS_VERSION,
    });
  },

  // Granular audio actions
  toggleVoices: () => {
    set((state) => ({ voicesEnabled: !state.voicesEnabled }));
    const s = get();
    saveAudioSettings({
      musicEnabled: s.musicEnabled, soundEnabled: s.soundEnabled,
      musicVolume: s.musicVolume, soundVolume: s.soundVolume,
      voicesEnabled: s.voicesEnabled, alertsEnabled: s.alertsEnabled,
      voiceVolume: s.voiceVolume, alertVolume: s.alertVolume,
      version: AUDIO_SETTINGS_VERSION,
    });
  },

  toggleAlerts: () => {
    set((state) => ({ alertsEnabled: !state.alertsEnabled }));
    const s = get();
    saveAudioSettings({
      musicEnabled: s.musicEnabled, soundEnabled: s.soundEnabled,
      musicVolume: s.musicVolume, soundVolume: s.soundVolume,
      voicesEnabled: s.voicesEnabled, alertsEnabled: s.alertsEnabled,
      voiceVolume: s.voiceVolume, alertVolume: s.alertVolume,
      version: AUDIO_SETTINGS_VERSION,
    });
  },

  setVoiceVolume: (volume) => {
    set({ voiceVolume: Math.max(0, Math.min(1, volume)) });
    const s = get();
    saveAudioSettings({
      musicEnabled: s.musicEnabled, soundEnabled: s.soundEnabled,
      musicVolume: s.musicVolume, soundVolume: s.soundVolume,
      voicesEnabled: s.voicesEnabled, alertsEnabled: s.alertsEnabled,
      voiceVolume: s.voiceVolume, alertVolume: s.alertVolume,
      version: AUDIO_SETTINGS_VERSION,
    });
  },

  setAlertVolume: (volume) => {
    set({ alertVolume: Math.max(0, Math.min(1, volume)) });
    const s = get();
    saveAudioSettings({
      musicEnabled: s.musicEnabled, soundEnabled: s.soundEnabled,
      musicVolume: s.musicVolume, soundVolume: s.soundVolume,
      voicesEnabled: s.voicesEnabled, alertsEnabled: s.alertsEnabled,
      voiceVolume: s.voiceVolume, alertVolume: s.alertVolume,
      version: AUDIO_SETTINGS_VERSION,
    });
  },

  toggleFPS: () => set((state) => ({ showFPS: !state.showFPS })),

  togglePing: () => set((state) => ({ showPing: !state.showPing })),

  toggleGraphicsOptions: () => set((state) => ({ showGraphicsOptions: !state.showGraphicsOptions })),

  setRendererAPI: (api) => set({ rendererAPI: api }),

  setGpuInfo: (info) => set({ gpuInfo: info }),

  setPreferWebGPU: (prefer) => set({ preferWebGPU: prefer }),

  // Graphics preset actions
  loadGraphicsPresets: async () => {
    const state = get();
    if (state.graphicsPresetsLoaded) return;

    try {
      const response = await fetch('/config/graphics-presets.json');
      if (!response.ok) {
        console.warn('Failed to load graphics presets, using defaults');
        return;
      }
      const config = await response.json() as GraphicsPresetsConfig;
      set({
        graphicsPresetsConfig: config,
        graphicsPresetsLoaded: true,
      });
    } catch (error) {
      console.warn('Error loading graphics presets:', error);
    }
  },

  applyGraphicsPreset: (presetName) => {
    const state = get();
    const config = state.graphicsPresetsConfig;

    // For 'custom', just set the preset name without changing settings
    if (presetName === 'custom') {
      set({ currentGraphicsPreset: 'custom' });
      return;
    }

    // Get preset settings from loaded config or use defaults
    let presetSettings: Partial<GraphicsSettings> | null = null;

    if (config && config.presets[presetName]) {
      presetSettings = config.presets[presetName].settings;
    }

    if (!presetSettings) {
      console.warn(`Preset "${presetName}" not found or has no settings`);
      return;
    }

    // Apply all preset settings at once
    set((s) => ({
      currentGraphicsPreset: presetName,
      graphicsSettings: {
        ...s.graphicsSettings,
        ...presetSettings,
        // Ensure derived AA settings are consistent
        fxaaEnabled: presetSettings.antiAliasingMode === 'fxaa',
        taaEnabled: presetSettings.antiAliasingMode === 'taa',
      },
    }));
    // Save to localStorage
    const newState = get();
    saveGraphicsSettings(newState.graphicsSettings, newState.currentGraphicsPreset);
  },

  detectCurrentPreset: () => {
    const state = get();
    const config = state.graphicsPresetsConfig;
    const currentSettings = state.graphicsSettings;

    if (!config) return 'custom';

    // Check each preset (except custom) to see if current settings match
    const presetNames: GraphicsPresetName[] = ['low', 'medium', 'high', 'ultra'];

    for (const presetName of presetNames) {
      const preset = config.presets[presetName];
      if (!preset?.settings) continue;

      let matches = true;
      for (const [key, value] of Object.entries(preset.settings)) {
        // Skip derived settings that are computed
        if (key === 'fxaaEnabled' || key === 'taaEnabled') continue;

        if (currentSettings[key as keyof GraphicsSettings] !== value) {
          matches = false;
          break;
        }
      }

      if (matches) return presetName;
    }

    return 'custom';
  },

  loadSavedGraphicsSettings: () => {
    const saved = loadGraphicsSettings();
    if (saved) {
      set((state) => ({
        graphicsSettings: { ...state.graphicsSettings, ...saved.settings },
        currentGraphicsPreset: saved.preset,
      }));
      debugInitialization.log(`[Graphics] Loaded saved settings (preset: ${saved.preset})`);
    }
  },

  toggleSoundOptions: () => set((state) => ({ showSoundOptions: !state.showSoundOptions })),

  toggleFullscreen: () => {
    if (typeof document !== 'undefined') {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {
          // Fullscreen request failed - possibly not allowed
        });
      } else {
        document.exitFullscreen().catch(() => {
          // Exit fullscreen failed
        });
      }
    }
  },

  setFullscreen: (isFullscreen) => set({ isFullscreen }),

  setGraphicsSetting: (key, value) => {
    set((state) => ({
      graphicsSettings: { ...state.graphicsSettings, [key]: value },
      // Mark as custom when individual settings are changed
      currentGraphicsPreset: 'custom' as GraphicsPresetName,
    }));
    // After setting, detect if it matches a preset
    const detected = get().detectCurrentPreset();
    if (detected !== 'custom') {
      set({ currentGraphicsPreset: detected });
    }
    // Save to localStorage
    const state = get();
    saveGraphicsSettings(state.graphicsSettings, state.currentGraphicsPreset);
  },

  toggleGraphicsSetting: (key) => {
    set((state) => ({
      graphicsSettings: {
        ...state.graphicsSettings,
        [key]: !state.graphicsSettings[key],
      },
      currentGraphicsPreset: 'custom' as GraphicsPresetName,
    }));
    const detected = get().detectCurrentPreset();
    if (detected !== 'custom') {
      set({ currentGraphicsPreset: detected });
    }
    // Save to localStorage
    const state = get();
    saveGraphicsSettings(state.graphicsSettings, state.currentGraphicsPreset);
  },

  setAntiAliasingMode: (mode) => {
    set((state) => ({
      graphicsSettings: {
        ...state.graphicsSettings,
        antiAliasingMode: mode,
        fxaaEnabled: mode === 'fxaa',
        taaEnabled: mode === 'taa',
      },
      currentGraphicsPreset: 'custom' as GraphicsPresetName,
    }));
    const detected = get().detectCurrentPreset();
    if (detected !== 'custom') {
      set({ currentGraphicsPreset: detected });
    }
    // Save to localStorage
    const state = get();
    saveGraphicsSettings(state.graphicsSettings, state.currentGraphicsPreset);
  },

  setUpscalingMode: (mode) => {
    set((state) => ({
      graphicsSettings: {
        ...state.graphicsSettings,
        upscalingMode: mode,
      },
      currentGraphicsPreset: 'custom' as GraphicsPresetName,
    }));
    const detected = get().detectCurrentPreset();
    if (detected !== 'custom') {
      set({ currentGraphicsPreset: detected });
    }
    // Save to localStorage
    const state = get();
    saveGraphicsSettings(state.graphicsSettings, state.currentGraphicsPreset);
  },

  setResolutionMode: (mode) => {
    set((state) => ({
      graphicsSettings: {
        ...state.graphicsSettings,
        resolutionMode: mode,
      },
      currentGraphicsPreset: 'custom' as GraphicsPresetName,
    }));
    const detected = get().detectCurrentPreset();
    if (detected !== 'custom') {
      set({ currentGraphicsPreset: detected });
    }
    // Save to localStorage
    const state = get();
    saveGraphicsSettings(state.graphicsSettings, state.currentGraphicsPreset);
  },

  setFixedResolution: (res) => {
    set((state) => ({
      graphicsSettings: {
        ...state.graphicsSettings,
        fixedResolution: res,
      },
      currentGraphicsPreset: 'custom' as GraphicsPresetName,
    }));
    const detected = get().detectCurrentPreset();
    if (detected !== 'custom') {
      set({ currentGraphicsPreset: detected });
    }
    // Save to localStorage
    const state = get();
    saveGraphicsSettings(state.graphicsSettings, state.currentGraphicsPreset);
  },

  setMaxFPS: (fps) => {
    set((state) => ({
      graphicsSettings: {
        ...state.graphicsSettings,
        maxFPS: fps,
      },
      currentGraphicsPreset: 'custom' as GraphicsPresetName,
    }));
    const detected = get().detectCurrentPreset();
    if (detected !== 'custom') {
      set({ currentGraphicsPreset: detected });
    }
    // Save to localStorage
    const state = get();
    saveGraphicsSettings(state.graphicsSettings, state.currentGraphicsPreset);
  },

  toggleDebugMenu: () => set((state) => ({ showDebugMenu: !state.showDebugMenu })),

  togglePerformancePanel: () => set((state) => ({ showPerformancePanel: !state.showPerformancePanel })),

  // HUD menu actions
  setShowOptionsMenu: (show: boolean) => set({ showOptionsMenu: show }),
  setShowOverlayMenu: (show: boolean) => set({ showOverlayMenu: show }),
  setShowPlayerStatus: (show: boolean) => set({ showPlayerStatus: show }),
  closeAllMenus: () => set({
    showOptionsMenu: false,
    showOverlayMenu: false,
    showPlayerStatus: false,
    showGraphicsOptions: false,
    showSoundOptions: false,
    showPerformancePanel: false,
    showDebugMenu: false,
  }),

  toggleDebugSetting: (key) => {
    set((state) => ({
      debugSettings: {
        ...state.debugSettings,
        [key]: !state.debugSettings[key],
      },
    }));
    // Persist to sessionStorage
    saveDebugSettings(get().debugSettings);
  },

  setAllDebugSettings: (enabled) => {
    set(() => ({
      debugSettings: {
        debugEnabled: enabled,
        debugAnimation: enabled,
        debugMesh: enabled,
        debugTerrain: enabled,
        debugShaders: enabled,
        debugPostProcessing: enabled,
        debugBuildingPlacement: enabled,
        debugCombat: enabled,
        debugResources: enabled,
        debugProduction: enabled,
        debugSpawning: enabled,
        debugAI: enabled,
        debugPathfinding: enabled,
        debugAssets: enabled,
        debugInitialization: enabled,
        debugAudio: enabled,
        debugNetworking: enabled,
        debugPerformance: enabled,
      },
    }));
    // Persist to sessionStorage
    saveDebugSettings(get().debugSettings);
  },

  // Overlay settings actions
  setActiveOverlay: (overlay) =>
    set((state) => ({
      overlaySettings: { ...state.overlaySettings, activeOverlay: overlay },
    })),

  toggleOverlay: (overlay) =>
    set((state) => ({
      overlaySettings: {
        ...state.overlaySettings,
        activeOverlay: state.overlaySettings.activeOverlay === overlay ? 'none' : overlay,
      },
    })),

  setOverlayOpacity: (overlay, opacity) =>
    set((state) => {
      const key = `${overlay}OverlayOpacity` as keyof OverlaySettings;
      if (key in state.overlaySettings && key !== 'activeOverlay') {
        return {
          overlaySettings: {
            ...state.overlaySettings,
            [key]: Math.max(0, Math.min(1, opacity)),
          },
        };
      }
      return state;
    }),

  updatePerformanceMetrics: (metrics) =>
    set((state) => ({
      performanceMetrics: { ...state.performanceMetrics, ...metrics },
    })),
}));

/**
 * Selector to check if any menu/panel is open that should disable edge scrolling.
 * This provides a single source of truth for edge scroll control.
 */
export const isAnyMenuOpen = (state: UIState): boolean => {
  return (
    state.showOptionsMenu ||
    state.showOverlayMenu ||
    state.showPlayerStatus ||
    state.showGraphicsOptions ||
    state.showSoundOptions ||
    state.showPerformancePanel ||
    state.showDebugMenu
  );
};
