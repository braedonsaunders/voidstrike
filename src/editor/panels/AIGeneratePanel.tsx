/**
 * AIGeneratePanel - LLM-powered map generation panel
 */

'use client';

import { useState, useEffect } from 'react';
import type { EditorConfig } from '../config/EditorConfig';
import type { MapData } from '@/data/maps/MapTypes';
import type { BiomeType } from '@/data/maps/core/ElevationMap';
import { useLLMGeneration } from '../hooks/useLLMGeneration';
import type { LLMProvider, MapGenerationSettings } from '../services/LLMMapGenerator';
import mapPresetsConfig from '../configs/mapPresets.json';

// ============================================================================
// TYPES
// ============================================================================

export interface AIGeneratePanelProps {
  config: EditorConfig;
  onMapGenerated: (mapData: MapData) => void;
}

type ThemeConfig = EditorConfig['theme'];

interface PresetCategory {
  id: string;
  name: string;
  description: string;
}

interface MapPreset {
  id: string;
  name: string;
  category: string;
  description: string;
  prompt: string;
  suggestedSettings?: {
    playerCount?: number;
    mapSize?: string;
    biome?: string;
    includeWater?: boolean;
    includeForests?: boolean;
    islandMap?: boolean;
  };
}

// ============================================================================
// CONFIG DATA
// ============================================================================

const PRESET_CATEGORIES: PresetCategory[] = mapPresetsConfig.categories;
const MAP_PRESETS: MapPreset[] = mapPresetsConfig.presets as MapPreset[];

function getPresetsByCategory(categoryId: string): MapPreset[] {
  return MAP_PRESETS.filter((p) => p.category === categoryId);
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PROVIDERS: Array<{ id: LLMProvider; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'openai', label: 'GPT' },
  { id: 'gemini', label: 'Gemini' },
];

const PLAYER_COUNTS: Array<2 | 4 | 6 | 8> = [2, 4, 6, 8];

const MAP_SIZES: Array<{ id: MapGenerationSettings['mapSize']; label: string }> = [
  { id: 'small', label: 'S' },
  { id: 'medium', label: 'M' },
  { id: 'large', label: 'L' },
  { id: 'huge', label: 'XL' },
];

const BIOMES: Array<{ id: BiomeType; label: string }> = [
  { id: 'grassland', label: 'Grass' },
  { id: 'desert', label: 'Desert' },
  { id: 'frozen', label: 'Ice' },
  { id: 'volcanic', label: 'Lava' },
  { id: 'jungle', label: 'Jungle' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'void', label: 'Void' },
];

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function Pill({
  active,
  onClick,
  children,
  theme,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  theme: ThemeConfig;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${active ? '' : 'hover:bg-white/5'}`}
      style={{
        backgroundColor: active ? theme.primary : 'transparent',
        color: active ? '#fff' : theme.text.muted,
      }}
    >
      {children}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  theme,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  theme: ThemeConfig;
}) {
  return (
    <button onClick={() => onChange(!checked)} className="flex items-center gap-1.5">
      <div
        className="w-6 h-3 rounded-full relative transition-colors"
        style={{ backgroundColor: checked ? theme.primary : theme.surface }}
      >
        <div
          className="absolute top-0.5 w-2 h-2 rounded-full bg-white transition-transform"
          style={{ transform: checked ? 'translateX(12px)' : 'translateX(2px)' }}
        />
      </div>
      <span className="text-[9px]" style={{ color: checked ? theme.text.primary : theme.text.muted }}>
        {label}
      </span>
    </button>
  );
}

function Collapsible({
  title,
  defaultOpen = false,
  theme,
  children,
  badge,
}: {
  title: string;
  defaultOpen?: boolean;
  theme: ThemeConfig;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded overflow-hidden flex-shrink-0" style={{ backgroundColor: `${theme.surface}80` }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-2 py-1.5 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="text-[8px] transition-transform flex-shrink-0"
            style={{ color: theme.text.muted, transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            ▶
          </span>
          <span className="text-[9px] font-medium truncate" style={{ color: theme.text.secondary }}>
            {title}
          </span>
        </div>
        {badge}
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function AIGeneratePanel({ config, onMapGenerated }: AIGeneratePanelProps) {
  const theme = config.theme;
  const [state, actions] = useLLMGeneration();
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('standard');
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false);

  const categoryPresets = getPresetsByCategory(selectedCategory);
  const selectedPreset = MAP_PRESETS.find((p) => p.id === selectedPresetId);

  const applyPreset = (preset: MapPreset) => {
    setSelectedPresetId(preset.id);
    setPresetDropdownOpen(false);
    actions.updateSettings({ theme: preset.prompt.trim() });
    if (preset.suggestedSettings) {
      actions.updateSettings(preset.suggestedSettings as Partial<MapGenerationSettings>);
    }
  };

  useEffect(() => {
    if (state.lastGeneration?.mapData) {
      onMapGenerated(state.lastGeneration.mapData);
    }
  }, [state.lastGeneration, onMapGenerated]);

  const handleGenerate = async () => {
    if (!state.isKeyValid) {
      const valid = await actions.validateApiKey();
      if (!valid) return;
    }
    await actions.generate();
  };

  const canGenerate = state.apiKey.length > 0 && !state.isGenerating;
  const hasValidKey = state.isKeyValid === true;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* PROMPT SECTION - Grows to fill space */}
      <div className="flex-1 flex flex-col min-h-0 mb-2">
        <div className="flex items-center justify-between mb-1 flex-shrink-0">
          <span className="text-[9px] font-medium uppercase" style={{ color: theme.text.muted }}>
            Prompt
          </span>
          <div className="relative">
            <button
              onClick={() => setPresetDropdownOpen(!presetDropdownOpen)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] transition-colors hover:bg-white/10"
              style={{ color: theme.primary }}
            >
              Presets
              <span style={{ fontSize: '7px' }}>{presetDropdownOpen ? '▲' : '▼'}</span>
            </button>

            {presetDropdownOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-52 rounded shadow-xl z-50 overflow-hidden"
                style={{ backgroundColor: theme.background, border: `1px solid ${theme.border}` }}
              >
                <div className="flex border-b" style={{ borderColor: theme.border }}>
                  {PRESET_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className="flex-1 py-1.5 text-[8px] font-medium transition-colors"
                      style={{
                        color: selectedCategory === cat.id ? theme.primary : theme.text.muted,
                        backgroundColor: selectedCategory === cat.id ? `${theme.primary}10` : 'transparent',
                      }}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {categoryPresets.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => applyPreset(preset)}
                      className="w-full px-2 py-1.5 text-left transition-colors hover:bg-white/5 h-10 flex flex-col justify-center"
                      style={{ backgroundColor: selectedPresetId === preset.id ? `${theme.primary}15` : 'transparent' }}
                    >
                      <div className="text-[9px] font-medium truncate" style={{ color: theme.text.primary }}>
                        {preset.name}
                      </div>
                      <div className="text-[8px] truncate" style={{ color: theme.text.muted }}>
                        {preset.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {selectedPreset && (
          <div
            className="flex items-center justify-between px-2 py-1 rounded mb-1 flex-shrink-0"
            style={{ backgroundColor: `${theme.primary}15` }}
          >
            <span className="text-[9px] font-medium truncate" style={{ color: theme.text.primary }}>
              {selectedPreset.name}
            </span>
            <button
              onClick={() => { setSelectedPresetId(null); actions.updateSettings({ theme: '' }); }}
              className="text-[9px] px-1 hover:bg-white/10 rounded flex-shrink-0"
              style={{ color: theme.text.muted }}
            >
              ✕
            </button>
          </div>
        )}

        <textarea
          value={state.settings.theme}
          onChange={(e) => {
            actions.updateSettings({ theme: e.target.value });
            if (selectedPresetId) setSelectedPresetId(null);
          }}
          placeholder="Describe terrain, layout, strategic elements..."
          className="flex-1 w-full px-2 py-1.5 rounded text-[10px] leading-relaxed resize-none focus:outline-none min-h-[60px]"
          style={{
            backgroundColor: theme.surface,
            border: `1px solid ${theme.border}`,
            color: theme.text.primary,
          }}
        />
      </div>

      {/* MAP CONFIG - Fixed height */}
      <div className="p-2 rounded space-y-1.5 flex-shrink-0 mb-2" style={{ backgroundColor: `${theme.surface}60` }}>
        {/* Players */}
        <div className="flex items-center gap-2">
          <span className="text-[8px] uppercase w-10 flex-shrink-0" style={{ color: theme.text.muted }}>Players</span>
          <div className="flex gap-px">
            {PLAYER_COUNTS.map((n) => (
              <Pill key={n} active={state.settings.playerCount === n} onClick={() => actions.updateSettings({ playerCount: n })} theme={theme}>
                {n}
              </Pill>
            ))}
          </div>
        </div>

        {/* Size */}
        <div className="flex items-center gap-2">
          <span className="text-[8px] uppercase w-10 flex-shrink-0" style={{ color: theme.text.muted }}>Size</span>
          <div className="flex gap-px">
            {MAP_SIZES.map((s) => (
              <Pill key={s.id} active={state.settings.mapSize === s.id} onClick={() => actions.updateSettings({ mapSize: s.id })} theme={theme}>
                {s.label}
              </Pill>
            ))}
          </div>
        </div>

        {/* Biome */}
        <div className="flex items-center gap-2">
          <span className="text-[8px] uppercase w-10 flex-shrink-0" style={{ color: theme.text.muted }}>Biome</span>
          <div className="flex gap-px flex-wrap">
            {BIOMES.map((b) => (
              <Pill key={b.id} active={state.settings.biome === b.id} onClick={() => actions.updateSettings({ biome: b.id })} theme={theme}>
                {b.label}
              </Pill>
            ))}
          </div>
        </div>

        {/* Features */}
        <div className="flex items-center gap-3 pt-1">
          <Toggle checked={state.settings.includeForests} onChange={(v) => actions.updateSettings({ includeForests: v })} label="Forests" theme={theme} />
          <Toggle checked={state.settings.includeWater} onChange={(v) => actions.updateSettings({ includeWater: v, islandMap: v ? state.settings.islandMap : false })} label="Water" theme={theme} />
          {state.settings.includeWater && (
            <Toggle checked={state.settings.islandMap} onChange={(v) => actions.updateSettings({ islandMap: v })} label="Islands" theme={theme} />
          )}
        </div>
      </div>

      {/* GENERATE BUTTON */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        className="w-full py-2 rounded text-[11px] font-semibold transition-all flex items-center justify-center gap-1.5 flex-shrink-0 mb-2"
        style={{
          backgroundColor: canGenerate ? theme.primary : theme.surface,
          color: canGenerate ? '#fff' : theme.text.muted,
          opacity: state.isGenerating ? 0.8 : 1,
        }}
      >
        {state.isGenerating ? (
          <><span className="animate-spin">◌</span>Generating...</>
        ) : (
          'Generate Map'
        )}
      </button>

      {/* STATUS MESSAGES */}
      {state.error && (
        <div className="p-2 rounded text-[9px] flex-shrink-0 mb-2" style={{ backgroundColor: `${theme.error}10`, border: `1px solid ${theme.error}30`, color: theme.error }}>
          <div className="font-medium">Failed</div>
          <div className="mt-0.5 opacity-80 truncate">{state.error}</div>
        </div>
      )}

      {state.lastGeneration && !state.isGenerating && !state.error && (
        <div className="p-2 rounded text-[9px] flex-shrink-0 mb-2" style={{ backgroundColor: `${theme.success}10`, border: `1px solid ${theme.success}30` }}>
          <div className="flex items-center justify-between">
            <span className="font-medium truncate" style={{ color: theme.success }}>
              ✓ {state.lastGeneration.blueprint.meta.name}
            </span>
            <span style={{ color: theme.text.muted }}>
              {state.lastGeneration.blueprint.canvas.width}×{state.lastGeneration.blueprint.canvas.height}
            </span>
          </div>
          <button
            onClick={actions.regenerate}
            className="mt-1.5 w-full py-1 rounded text-[9px] hover:bg-white/10"
            style={{ backgroundColor: theme.surface, color: theme.text.secondary }}
          >
            Regenerate
          </button>
        </div>
      )}

      {/* API SETTINGS */}
      <Collapsible
        title="API"
        defaultOpen={!hasValidKey}
        theme={theme}
        badge={hasValidKey ? <span className="text-[8px] px-1 py-0.5 rounded" style={{ backgroundColor: `${theme.success}20`, color: theme.success }}>OK</span> : null}
      >
        <div className="space-y-2">
          <div className="flex gap-0.5">
            {PROVIDERS.map((p) => (
              <Pill key={p.id} active={state.provider === p.id} onClick={() => actions.setProvider(p.id)} theme={theme}>
                {p.label}
              </Pill>
            ))}
          </div>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={state.apiKey}
              onChange={(e) => actions.setApiKey(e.target.value)}
              placeholder="API key"
              className="w-full px-2 py-1 pr-10 rounded text-[9px] font-mono"
              style={{
                backgroundColor: theme.background,
                border: `1px solid ${state.isKeyValid === true ? theme.success : state.isKeyValid === false ? theme.error : theme.border}`,
                color: theme.text.primary,
              }}
            />
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-[8px] px-1 rounded hover:bg-white/10"
              style={{ color: theme.text.muted }}
            >
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>
          {state.apiKey && state.isKeyValid === null && (
            <button
              onClick={actions.validateApiKey}
              disabled={state.isTestingKey}
              className="w-full py-1 rounded text-[9px]"
              style={{ backgroundColor: theme.surface, color: theme.text.secondary }}
            >
              {state.isTestingKey ? 'Checking...' : 'Validate'}
            </button>
          )}
          {state.isKeyValid === false && (
            <div className="text-[8px]" style={{ color: theme.error }}>Invalid key</div>
          )}
        </div>
      </Collapsible>

      {/* HISTORY */}
      {state.generationHistory.length > 0 && (
        <div className="mt-2">
          <Collapsible title="History" theme={theme}>
            <div className="space-y-0.5">
              {state.generationHistory.slice(0, 5).map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => actions.loadFromHistory(entry.id)}
                  className="w-full p-1.5 rounded text-left text-[8px] hover:bg-white/5"
                  style={{ backgroundColor: theme.background }}
                >
                  <div className="flex justify-between">
                    <span style={{ color: theme.text.secondary }}>{entry.settings.playerCount}P {entry.settings.mapSize}</span>
                    <span style={{ color: theme.text.muted }}>{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </button>
              ))}
            </div>
          </Collapsible>
        </div>
      )}
    </div>
  );
}

export default AIGeneratePanel;
