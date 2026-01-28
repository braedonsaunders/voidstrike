import { describe, it, expect, beforeEach } from 'vitest';
import type { DebugSettings } from '@/store/uiStore';
import { debugLog, setWorkerDebugSettings } from '@/utils/debugLogger';

const baseSettings: DebugSettings = {
  debugEnabled: false,
  debugAnimation: false,
  debugMesh: false,
  debugTerrain: false,
  debugShaders: false,
  debugPostProcessing: false,
  debugBuildingPlacement: false,
  debugCombat: false,
  debugResources: false,
  debugProduction: false,
  debugSpawning: false,
  debugAI: false,
  debugPathfinding: false,
  debugAssets: false,
  debugInitialization: false,
  debugAudio: false,
  debugNetworking: false,
  debugPerformance: false,
};

const createSettings = (overrides: Partial<DebugSettings>): DebugSettings => ({
  ...baseSettings,
  ...overrides,
});

describe('debugLogger worker settings', () => {
  beforeEach(() => {
    setWorkerDebugSettings(baseSettings);
  });

  it('disables categories when master toggle is off', () => {
    setWorkerDebugSettings(createSettings({ debugEnabled: false, debugAI: true }));
    expect(debugLog.isEnabled('ai')).toBe(false);
  });

  it('respects category toggles when master is on', () => {
    setWorkerDebugSettings(createSettings({ debugEnabled: true, debugAI: true, debugResources: false }));
    expect(debugLog.isEnabled('ai')).toBe(true);
    expect(debugLog.isEnabled('resources')).toBe(false);
  });
});
