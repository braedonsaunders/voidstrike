import { create } from 'zustand';

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
}

// Renderer API type (WebGPU or WebGL)
export type RendererAPI = 'WebGPU' | 'WebGL' | null;

// Anti-aliasing mode selection
export type AntiAliasingMode = 'off' | 'fxaa' | 'taa';

// Upscaling mode selection (EASU = Edge-Adaptive Spatial Upsampling)
export type UpscalingMode = 'off' | 'easu' | 'bilinear';

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

  // Environment
  environmentMapEnabled: boolean;

  // Outline (selection)
  outlineEnabled: boolean;
  outlineStrength: number;

  // Particles
  particlesEnabled: boolean;
  particleDensity: number;
}

// Game overlay types for strategic information display
export type GameOverlayType = 'none' | 'terrain' | 'elevation' | 'threat';

// Overlay settings
export interface OverlaySettings {
  activeOverlay: GameOverlayType;
  terrainOverlayOpacity: number;
  elevationOverlayOpacity: number;
  threatOverlayOpacity: number;
}

export interface UIState {
  // Screen management
  currentScreen: ScreenType;
  previousScreen: ScreenType | null;

  // Modal/overlay state
  isModalOpen: boolean;
  modalContent: React.ReactNode | null;

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
  showGraphicsOptions: boolean;
  rendererAPI: RendererAPI;
  preferWebGPU: boolean; // User preference for renderer (true = try WebGPU, false = force WebGL)

  // Sound settings
  showSoundOptions: boolean;

  // Fullscreen
  isFullscreen: boolean;

  // Debug settings
  debugSettings: DebugSettings;
  showDebugMenu: boolean;

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
  setRendererAPI: (api: RendererAPI) => void;
  setPreferWebGPU: (prefer: boolean) => void;
  // Sound settings actions
  toggleSoundOptions: () => void;
  // Fullscreen actions
  toggleFullscreen: () => void;
  setFullscreen: (isFullscreen: boolean) => void;
  // Debug settings actions
  toggleDebugMenu: () => void;
  toggleDebugSetting: (key: keyof DebugSettings) => void;
  setAllDebugSettings: (enabled: boolean) => void;
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
  notifications: [],
  tooltipContent: null,
  tooltipPosition: null,
  contextMenuOpen: false,
  contextMenuPosition: null,
  contextMenuItems: [],
  soundEnabled: true,
  musicEnabled: true,
  soundVolume: 0.7,
  musicVolume: 0.25,
  // Granular audio defaults
  voicesEnabled: true,
  alertsEnabled: true,
  voiceVolume: 0.7,
  alertVolume: 0.8,
  showFPS: false,
  showPing: true,
  showGraphicsOptions: false,
  rendererAPI: null,
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
    fogDensity: 0.6,

    // Environment
    environmentMapEnabled: true,

    // Outline (selection)
    outlineEnabled: true,
    outlineStrength: 2,

    // Particles
    particlesEnabled: true,
    particleDensity: 5.0, // 5.0 is the baseline (displayed as 1x), range 1-10
  },
  showDebugMenu: false,
  overlaySettings: {
    activeOverlay: 'none',
    terrainOverlayOpacity: 0.7,
    elevationOverlayOpacity: 0.7,
    threatOverlayOpacity: 0.5,
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
  },
  debugSettings: {
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

  toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),

  toggleMusic: () => set((state) => ({ musicEnabled: !state.musicEnabled })),

  setSoundVolume: (volume) => set({ soundVolume: Math.max(0, Math.min(1, volume)) }),

  setMusicVolume: (volume) => set({ musicVolume: Math.max(0, Math.min(1, volume)) }),

  // Granular audio actions
  toggleVoices: () => set((state) => ({ voicesEnabled: !state.voicesEnabled })),

  toggleAlerts: () => set((state) => ({ alertsEnabled: !state.alertsEnabled })),

  setVoiceVolume: (volume) => set({ voiceVolume: Math.max(0, Math.min(1, volume)) }),

  setAlertVolume: (volume) => set({ alertVolume: Math.max(0, Math.min(1, volume)) }),

  toggleFPS: () => set((state) => ({ showFPS: !state.showFPS })),

  togglePing: () => set((state) => ({ showPing: !state.showPing })),

  toggleGraphicsOptions: () => set((state) => ({ showGraphicsOptions: !state.showGraphicsOptions })),

  setRendererAPI: (api) => set({ rendererAPI: api }),

  setPreferWebGPU: (prefer) => set({ preferWebGPU: prefer }),

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

  setGraphicsSetting: (key, value) =>
    set((state) => ({
      graphicsSettings: { ...state.graphicsSettings, [key]: value },
    })),

  toggleGraphicsSetting: (key) =>
    set((state) => ({
      graphicsSettings: {
        ...state.graphicsSettings,
        [key]: !state.graphicsSettings[key],
      },
    })),

  setAntiAliasingMode: (mode) =>
    set((state) => ({
      graphicsSettings: {
        ...state.graphicsSettings,
        antiAliasingMode: mode,
        fxaaEnabled: mode === 'fxaa',
        taaEnabled: mode === 'taa',
      },
    })),

  setUpscalingMode: (mode) =>
    set((state) => ({
      graphicsSettings: {
        ...state.graphicsSettings,
        upscalingMode: mode,
      },
    })),

  setResolutionMode: (mode) =>
    set((state) => ({
      graphicsSettings: {
        ...state.graphicsSettings,
        resolutionMode: mode,
      },
    })),

  setFixedResolution: (res) =>
    set((state) => ({
      graphicsSettings: {
        ...state.graphicsSettings,
        fixedResolution: res,
      },
    })),

  toggleDebugMenu: () => set((state) => ({ showDebugMenu: !state.showDebugMenu })),

  toggleDebugSetting: (key) =>
    set((state) => ({
      debugSettings: {
        ...state.debugSettings,
        [key]: !state.debugSettings[key],
      },
    })),

  setAllDebugSettings: (enabled) =>
    set((state) => ({
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
    })),

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
