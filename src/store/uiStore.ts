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
}

// Graphics settings for post-processing and visual effects
export interface GraphicsSettings {
  postProcessingEnabled: boolean;
  toneMappingExposure: number;
  ssaoEnabled: boolean;
  ssaoRadius: number;
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  bloomRadius: number;
  outlineEnabled: boolean;
  outlineStrength: number;
  fxaaEnabled: boolean;
  particlesEnabled: boolean;
  particleDensity: number;
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
  showFPS: boolean;
  showPing: boolean;

  // Graphics settings
  graphicsSettings: GraphicsSettings;
  showGraphicsOptions: boolean;

  // Sound settings
  showSoundOptions: boolean;

  // Debug settings
  debugSettings: DebugSettings;
  showDebugMenu: boolean;

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
  toggleFPS: () => void;
  togglePing: () => void;
  // Graphics settings actions
  toggleGraphicsOptions: () => void;
  setGraphicsSetting: <K extends keyof GraphicsSettings>(key: K, value: GraphicsSettings[K]) => void;
  toggleGraphicsSetting: (key: keyof GraphicsSettings) => void;
  // Sound settings actions
  toggleSoundOptions: () => void;
  // Debug settings actions
  toggleDebugMenu: () => void;
  toggleDebugSetting: (key: keyof DebugSettings) => void;
  setAllDebugSettings: (enabled: boolean) => void;
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
  showFPS: false,
  showPing: true,
  showGraphicsOptions: false,
  showSoundOptions: false,
  graphicsSettings: {
    postProcessingEnabled: true,
    toneMappingExposure: 1.0,
    ssaoEnabled: true,
    ssaoRadius: 16,
    bloomEnabled: true,
    bloomStrength: 0.2,
    bloomThreshold: 0.9,
    bloomRadius: 0.4,
    outlineEnabled: true,
    outlineStrength: 2,
    fxaaEnabled: true,
    particlesEnabled: true,
    particleDensity: 1.0,
  },
  showDebugMenu: false,
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

  toggleFPS: () => set((state) => ({ showFPS: !state.showFPS })),

  togglePing: () => set((state) => ({ showPing: !state.showPing })),

  toggleGraphicsOptions: () => set((state) => ({ showGraphicsOptions: !state.showGraphicsOptions })),

  toggleSoundOptions: () => set((state) => ({ showSoundOptions: !state.showSoundOptions })),

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
      },
    })),
}));
