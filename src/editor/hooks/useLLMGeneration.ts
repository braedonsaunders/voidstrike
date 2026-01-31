/**
 * useLLMGeneration - Hook for managing LLM map generation state
 *
 * Provides state management for:
 * - API key configuration and validation
 * - Generation settings
 * - Loading/error states
 * - Generation history for regeneration
 */

import { useState, useCallback, useEffect } from 'react';
import type { MapData } from '@/data/maps/MapTypes';
import type { MapBlueprint } from '@/data/maps/core/ElevationMap';
import {
  type LLMProvider,
  type LLMConfig,
  type MapGenerationSettings,
  type GenerationResult,
  generateMapWithLLM,
  storeApiKey,
  getStoredApiKey,
  testApiKey,
} from '../services/LLMMapGenerator';

// ============================================================================
// TYPES
// ============================================================================

export interface LLMGenerationState {
  // Provider configuration
  provider: LLMProvider;
  apiKey: string;
  isKeyValid: boolean | null; // null = not tested
  isTestingKey: boolean;

  // Generation settings
  settings: MapGenerationSettings;

  // Generation state
  isGenerating: boolean;
  error: string | null;
  lastGeneration: {
    blueprint: MapBlueprint;
    mapData: MapData;
    settings: MapGenerationSettings;
  } | null;

  // History for regeneration
  generationHistory: Array<{
    id: string;
    timestamp: number;
    settings: MapGenerationSettings;
    blueprint: MapBlueprint;
  }>;
}

export interface LLMGenerationActions {
  // Provider/key management
  setProvider: (provider: LLMProvider) => void;
  setApiKey: (key: string) => void;
  validateApiKey: () => Promise<boolean>;
  clearApiKey: () => void;

  // Settings management
  updateSettings: (updates: Partial<MapGenerationSettings>) => void;
  resetSettings: () => void;

  // Generation
  generate: () => Promise<GenerationResult>;
  regenerate: () => Promise<GenerationResult>;
  regenerateWithTweaks: (tweaks: Partial<MapGenerationSettings>) => Promise<GenerationResult>;

  // History
  loadFromHistory: (id: string) => MapBlueprint | null;
  clearHistory: () => void;
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

const DEFAULT_SETTINGS: MapGenerationSettings = {
  playerCount: 2,
  mapSize: 'medium',
  biome: 'void',
  theme: '',
  includeWater: false,
  includeForests: true,
  islandMap: false,
  borderStyle: 'rocks',
};

function createInitialState(): LLMGenerationState {
  return {
    provider: 'claude',
    apiKey: '',
    isKeyValid: null,
    isTestingKey: false,
    settings: { ...DEFAULT_SETTINGS },
    isGenerating: false,
    error: null,
    lastGeneration: null,
    generationHistory: [],
  };
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

export function useLLMGeneration(): [LLMGenerationState, LLMGenerationActions] {
  const [state, setState] = useState<LLMGenerationState>(createInitialState);

  // Load stored API key on mount
  useEffect(() => {
    const storedKey = getStoredApiKey(state.provider);
    if (storedKey) {
      // Use requestAnimationFrame to avoid cascading renders
      requestAnimationFrame(() => {
        setState((prev: LLMGenerationState) => ({ ...prev, apiKey: storedKey }));
      });
    }
  }, [state.provider]);

  // Provider management
  const setProvider = useCallback((provider: LLMProvider) => {
    const storedKey = getStoredApiKey(provider);
    setState((prev: LLMGenerationState) => ({
      ...prev,
      provider,
      apiKey: storedKey || '',
      isKeyValid: storedKey ? prev.isKeyValid : null,
    }));
  }, []);

  const setApiKey = useCallback((key: string) => {
    setState((prev: LLMGenerationState) => ({
      ...prev,
      apiKey: key,
      isKeyValid: null, // Reset validation on key change
    }));
  }, []);

  const validateApiKey = useCallback(async (): Promise<boolean> => {
    setState((prev: LLMGenerationState) => ({ ...prev, isTestingKey: true, error: null }));

    try {
      const isValid = await testApiKey(state.provider, state.apiKey);

      if (isValid) {
        storeApiKey(state.provider, state.apiKey);
      }

      setState((prev: LLMGenerationState) => ({
        ...prev,
        isKeyValid: isValid,
        isTestingKey: false,
        error: isValid ? null : 'Invalid API key',
      }));

      return isValid;
    } catch {
      setState((prev: LLMGenerationState) => ({
        ...prev,
        isKeyValid: false,
        isTestingKey: false,
        error: 'Failed to validate API key',
      }));
      return false;
    }
  }, [state.provider, state.apiKey]);

  const clearApiKey = useCallback(() => {
    setState((prev: LLMGenerationState) => ({
      ...prev,
      apiKey: '',
      isKeyValid: null,
    }));
  }, []);

  // Settings management
  const updateSettings = useCallback((updates: Partial<MapGenerationSettings>) => {
    setState((prev: LLMGenerationState) => ({
      ...prev,
      settings: { ...prev.settings, ...updates },
    }));
  }, []);

  const resetSettings = useCallback(() => {
    setState((prev: LLMGenerationState) => ({
      ...prev,
      settings: { ...DEFAULT_SETTINGS },
    }));
  }, []);

  // Generation
  const generate = useCallback(async (): Promise<GenerationResult> => {
    if (!state.apiKey) {
      return { success: false, error: 'API key not configured' };
    }

    setState((prev: LLMGenerationState) => ({ ...prev, isGenerating: true, error: null }));

    const config: LLMConfig = {
      provider: state.provider,
      apiKey: state.apiKey,
    };

    try {
      const result = await generateMapWithLLM(config, state.settings);

      if (result.success && result.blueprint && result.mapData) {
        const historyEntry = {
          id: `gen_${Date.now()}`,
          timestamp: Date.now(),
          settings: { ...state.settings },
          blueprint: result.blueprint,
        };

        setState((prev: LLMGenerationState) => ({
          ...prev,
          isGenerating: false,
          error: null,
          lastGeneration: {
            blueprint: result.blueprint!,
            mapData: result.mapData!,
            settings: { ...state.settings },
          },
          generationHistory: [historyEntry, ...prev.generationHistory].slice(0, 10), // Keep last 10
        }));
      } else {
        setState((prev: LLMGenerationState) => ({
          ...prev,
          isGenerating: false,
          error: result.error || 'Generation failed',
        }));
      }

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setState((prev: LLMGenerationState) => ({
        ...prev,
        isGenerating: false,
        error: errorMsg,
      }));
      return { success: false, error: errorMsg };
    }
  }, [state.apiKey, state.provider, state.settings]);

  const regenerate = useCallback(async (): Promise<GenerationResult> => {
    // Use last settings but generate fresh
    return generate();
  }, [generate]);

  const regenerateWithTweaks = useCallback(
    async (tweaks: Partial<MapGenerationSettings>): Promise<GenerationResult> => {
      // Apply tweaks first
      setState((prev: LLMGenerationState) => ({
        ...prev,
        settings: { ...prev.settings, ...tweaks },
      }));

      // Then generate (will use updated settings)
      if (!state.apiKey) {
        return { success: false, error: 'API key not configured' };
      }

      setState((prev: LLMGenerationState) => ({ ...prev, isGenerating: true, error: null }));

      const config: LLMConfig = {
        provider: state.provider,
        apiKey: state.apiKey,
      };

      const updatedSettings = { ...state.settings, ...tweaks };

      try {
        const result = await generateMapWithLLM(config, updatedSettings);

        if (result.success && result.blueprint && result.mapData) {
          const historyEntry = {
            id: `gen_${Date.now()}`,
            timestamp: Date.now(),
            settings: updatedSettings,
            blueprint: result.blueprint,
          };

          setState((prev: LLMGenerationState) => ({
            ...prev,
            isGenerating: false,
            error: null,
            settings: updatedSettings,
            lastGeneration: {
              blueprint: result.blueprint!,
              mapData: result.mapData!,
              settings: updatedSettings,
            },
            generationHistory: [historyEntry, ...prev.generationHistory].slice(0, 10),
          }));
        } else {
          setState((prev: LLMGenerationState) => ({
            ...prev,
            isGenerating: false,
            error: result.error || 'Generation failed',
          }));
        }

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setState((prev: LLMGenerationState) => ({
          ...prev,
          isGenerating: false,
          error: errorMsg,
        }));
        return { success: false, error: errorMsg };
      }
    },
    [state.apiKey, state.provider, state.settings]
  );

  // History management
  const loadFromHistory = useCallback(
    (id: string): MapBlueprint | null => {
      const entry = state.generationHistory.find((h: LLMGenerationState['generationHistory'][0]) => h.id === id);
      if (entry) {
        setState((prev: LLMGenerationState) => ({
          ...prev,
          settings: entry.settings,
        }));
        return entry.blueprint;
      }
      return null;
    },
    [state.generationHistory]
  );

  const clearHistory = useCallback(() => {
    setState((prev: LLMGenerationState) => ({
      ...prev,
      generationHistory: [],
    }));
  }, []);

  const actions: LLMGenerationActions = {
    setProvider,
    setApiKey,
    validateApiKey,
    clearApiKey,
    updateSettings,
    resetSettings,
    generate,
    regenerate,
    regenerateWithTweaks,
    loadFromHistory,
    clearHistory,
  };

  return [state, actions];
}
