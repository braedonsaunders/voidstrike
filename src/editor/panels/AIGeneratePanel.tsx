/**
 * AIGeneratePanel - LLM-powered map generation panel
 *
 * Clean, focused layout:
 * 1. Prompt & Presets (hero section)
 * 2. Map Configuration (compact grid)
 * 3. Generate Button
 * 4. API Settings (collapsible, set-once)
 * 5. History (collapsible)
 */

'use client';

import { useState, useEffect } from 'react';
import type { EditorConfig } from '../config/EditorConfig';
import type { MapData } from '@/data/maps/MapTypes';
import type { BiomeType } from '@/data/maps/core/ElevationMap';
import { useLLMGeneration } from '../hooks/useLLMGeneration';
import type { LLMProvider, MapGenerationSettings } from '../services/LLMMapGenerator';
import {
  PRESET_CATEGORIES,
  getPresetsByCategory,
  type MapPromptPreset,
  type PresetCategory,
} from '../data/mapPromptPresets';

// ============================================================================
// TYPES
// ============================================================================

export interface AIGeneratePanelProps {
  config: EditorConfig;
  onMapGenerated: (mapData: MapData) => void;
}

type ThemeConfig = EditorConfig['theme'];

// ============================================================================
// CONSTANTS
// ============================================================================

const PROVIDERS: Array<{ id: LLMProvider; name: string }> = [
  { id: 'claude', name: 'Claude' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'gemini', name: 'Gemini' },
];

const PLAYER_COUNTS: Array<2 | 4 | 6 | 8> = [2, 4, 6, 8];

const MAP_SIZES: Array<{ id: MapGenerationSettings['mapSize']; label: string }> = [
  { id: 'small', label: 'S' },
  { id: 'medium', label: 'M' },
  { id: 'large', label: 'L' },
  { id: 'huge', label: 'XL' },
];

const BIOMES: Array<{ id: BiomeType; name: string }> = [
  { id: 'grassland', name: 'Grass' },
  { id: 'desert', name: 'Desert' },
  { id: 'frozen', name: 'Ice' },
  { id: 'volcanic', name: 'Lava' },
  { id: 'jungle', name: 'Jungle' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'void', name: 'Void' },
];

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function Label({ children, theme }: { children: React.ReactNode; theme: ThemeConfig }) {
  return (
    <span
      className="text-[10px] font-medium uppercase tracking-wide"
      style={{ color: theme.text.muted }}
    >
      {children}
    </span>
  );
}

function Pill({
  active,
  onClick,
  children,
  theme,
  size = 'sm',
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  theme: ThemeConfig;
  size?: 'xs' | 'sm';
}) {
  return (
    <button
      onClick={onClick}
      className={`
        rounded transition-all font-medium
        ${size === 'xs' ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-[11px]'}
        ${active ? '' : 'hover:bg-white/5'}
      `}
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
    <button
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 group"
    >
      <div
        className="w-7 h-4 rounded-full relative transition-colors"
        style={{ backgroundColor: checked ? theme.primary : theme.surface }}
      >
        <div
          className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
          style={{ transform: checked ? 'translateX(14px)' : 'translateX(2px)' }}
        />
      </div>
      <span
        className="text-[11px] transition-colors"
        style={{ color: checked ? theme.text.primary : theme.text.muted }}
      >
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
    <div
      className="rounded-lg overflow-hidden"
      style={{ backgroundColor: `${theme.surface}80` }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[9px] transition-transform"
            style={{
              color: theme.text.muted,
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            ▶
          </span>
          <span className="text-[11px] font-medium" style={{ color: theme.text.secondary }}>
            {title}
          </span>
        </div>
        {badge}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
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
  const [selectedCategory, setSelectedCategory] = useState<PresetCategory['id']>('standard');
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false);

  const categoryPresets = getPresetsByCategory(selectedCategory);
  const selectedPreset = categoryPresets.find((p) => p.id === selectedPresetId);

  const applyPreset = (preset: MapPromptPreset) => {
    setSelectedPresetId(preset.id);
    setPresetDropdownOpen(false);
    actions.updateSettings({ theme: preset.prompt.trim() });
    if (preset.suggestedSettings) {
      actions.updateSettings(preset.suggestedSettings);
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
    <div className="space-y-4">
      {/* ================================================================== */}
      {/* PROMPT SECTION - Hero Area */}
      {/* ================================================================== */}
      <div className="space-y-2">
        {/* Preset Selector */}
        <div className="flex items-center justify-between">
          <Label theme={theme}>Map Prompt</Label>
          <div className="relative">
            <button
              onClick={() => setPresetDropdownOpen(!presetDropdownOpen)}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] transition-colors hover:bg-white/10"
              style={{ color: theme.primary }}
            >
              <span>Use Preset</span>
              <span style={{ fontSize: '8px' }}>{presetDropdownOpen ? '▲' : '▼'}</span>
            </button>

            {/* Preset Dropdown */}
            {presetDropdownOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-64 rounded-lg shadow-xl z-50 overflow-hidden"
                style={{
                  backgroundColor: theme.background,
                  border: `1px solid ${theme.border}`,
                }}
              >
                {/* Category Tabs */}
                <div
                  className="flex border-b"
                  style={{ borderColor: theme.border }}
                >
                  {PRESET_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className="flex-1 py-2 text-[10px] font-medium transition-colors"
                      style={{
                        color: selectedCategory === cat.id ? theme.primary : theme.text.muted,
                        backgroundColor: selectedCategory === cat.id ? `${theme.primary}10` : 'transparent',
                      }}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>

                {/* Preset List */}
                <div className="max-h-52 overflow-y-auto">
                  {categoryPresets.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => applyPreset(preset)}
                      className="w-full px-3 py-2 text-left transition-colors hover:bg-white/5"
                      style={{
                        backgroundColor: selectedPresetId === preset.id ? `${theme.primary}15` : 'transparent',
                      }}
                    >
                      <div
                        className="text-[11px] font-medium"
                        style={{ color: theme.text.primary }}
                      >
                        {preset.name}
                      </div>
                      <div
                        className="text-[9px] mt-0.5 line-clamp-1"
                        style={{ color: theme.text.muted }}
                      >
                        {preset.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Active Preset Chip */}
        {selectedPreset && (
          <div
            className="flex items-center justify-between px-2.5 py-1.5 rounded-lg"
            style={{ backgroundColor: `${theme.primary}15` }}
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px]" style={{ color: theme.primary }}>●</span>
              <span className="text-[11px] font-medium" style={{ color: theme.text.primary }}>
                {selectedPreset.name}
              </span>
            </div>
            <button
              onClick={() => {
                setSelectedPresetId(null);
                actions.updateSettings({ theme: '' });
              }}
              className="text-[10px] px-1.5 rounded hover:bg-white/10 transition-colors"
              style={{ color: theme.text.muted }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Prompt Textarea */}
        <textarea
          value={state.settings.theme}
          onChange={(e) => {
            actions.updateSettings({ theme: e.target.value });
            if (selectedPresetId) setSelectedPresetId(null);
          }}
          placeholder="Describe your map: terrain, layout, strategic elements..."
          rows={4}
          className="w-full px-3 py-2.5 rounded-lg text-[12px] leading-relaxed resize-none focus:outline-none focus:ring-1"
          style={{
            backgroundColor: theme.surface,
            border: `1px solid ${theme.border}`,
            color: theme.text.primary,
            '--tw-ring-color': theme.primary,
          } as React.CSSProperties}
        />
      </div>

      {/* ================================================================== */}
      {/* MAP CONFIGURATION - Compact Grid */}
      {/* ================================================================== */}
      <div
        className="p-3 rounded-lg space-y-3"
        style={{ backgroundColor: `${theme.surface}60` }}
      >
        {/* Row 1: Players & Size */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label theme={theme}>Players</Label>
            <div className="flex gap-0.5">
              {PLAYER_COUNTS.map((n) => (
                <Pill
                  key={n}
                  active={state.settings.playerCount === n}
                  onClick={() => actions.updateSettings({ playerCount: n })}
                  theme={theme}
                  size="xs"
                >
                  {n}
                </Pill>
              ))}
            </div>
          </div>

          <div className="w-px h-4" style={{ backgroundColor: theme.border }} />

          <div className="flex items-center gap-2">
            <Label theme={theme}>Size</Label>
            <div className="flex gap-0.5">
              {MAP_SIZES.map((s) => (
                <Pill
                  key={s.id}
                  active={state.settings.mapSize === s.id}
                  onClick={() => actions.updateSettings({ mapSize: s.id })}
                  theme={theme}
                  size="xs"
                >
                  {s.label}
                </Pill>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: Biome */}
        <div className="flex items-center gap-2 flex-wrap">
          <Label theme={theme}>Biome</Label>
          <div className="flex gap-0.5 flex-wrap">
            {BIOMES.map((b) => (
              <Pill
                key={b.id}
                active={state.settings.biome === b.id}
                onClick={() => actions.updateSettings({ biome: b.id })}
                theme={theme}
                size="xs"
              >
                {b.name}
              </Pill>
            ))}
          </div>
        </div>

        {/* Row 3: Feature Toggles */}
        <div className="flex items-center gap-4 flex-wrap">
          <Toggle
            checked={state.settings.includeForests}
            onChange={(v) => actions.updateSettings({ includeForests: v })}
            label="Forests"
            theme={theme}
          />
          <Toggle
            checked={state.settings.includeWater}
            onChange={(v) => actions.updateSettings({
              includeWater: v,
              islandMap: v ? state.settings.islandMap : false
            })}
            label="Water"
            theme={theme}
          />
          {state.settings.includeWater && (
            <Toggle
              checked={state.settings.islandMap}
              onChange={(v) => actions.updateSettings({ islandMap: v })}
              label="Naval/Islands"
              theme={theme}
            />
          )}
        </div>
      </div>

      {/* ================================================================== */}
      {/* GENERATE BUTTON */}
      {/* ================================================================== */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        className="w-full py-3 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2"
        style={{
          backgroundColor: canGenerate ? theme.primary : theme.surface,
          color: canGenerate ? '#fff' : theme.text.muted,
          opacity: state.isGenerating ? 0.8 : 1,
          boxShadow: canGenerate ? `0 4px 20px ${theme.primary}40` : 'none',
        }}
      >
        {state.isGenerating ? (
          <>
            <span className="animate-spin">◌</span>
            Generating...
          </>
        ) : (
          'Generate Map'
        )}
      </button>

      {/* ================================================================== */}
      {/* STATUS MESSAGES */}
      {/* ================================================================== */}

      {/* Error */}
      {state.error && (
        <div
          className="p-3 rounded-lg text-[11px]"
          style={{
            backgroundColor: `${theme.error}10`,
            border: `1px solid ${theme.error}30`,
            color: theme.error,
          }}
        >
          <div className="font-medium">Generation failed</div>
          <div className="mt-1 opacity-80">{state.error}</div>
        </div>
      )}

      {/* Success */}
      {state.lastGeneration && !state.isGenerating && !state.error && (
        <div
          className="p-3 rounded-lg text-[11px]"
          style={{
            backgroundColor: `${theme.success}10`,
            border: `1px solid ${theme.success}30`,
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span style={{ color: theme.success }}>✓</span>
              <span className="font-medium" style={{ color: theme.success }}>
                {state.lastGeneration.blueprint.meta.name}
              </span>
            </div>
            <span style={{ color: theme.text.muted }}>
              {state.lastGeneration.blueprint.canvas.width}×{state.lastGeneration.blueprint.canvas.height}
            </span>
          </div>
          <button
            onClick={actions.regenerate}
            className="mt-2 w-full py-1.5 rounded text-[10px] transition-colors hover:bg-white/10"
            style={{
              backgroundColor: theme.surface,
              color: theme.text.secondary,
            }}
          >
            Regenerate
          </button>
        </div>
      )}

      {/* ================================================================== */}
      {/* API CONFIGURATION - Collapsible */}
      {/* ================================================================== */}
      <Collapsible
        title="API Settings"
        defaultOpen={!hasValidKey}
        theme={theme}
        badge={
          hasValidKey ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ backgroundColor: `${theme.success}20`, color: theme.success }}>
              Connected
            </span>
          ) : null
        }
      >
        <div className="space-y-3">
          {/* Provider Pills */}
          <div className="flex gap-1">
            {PROVIDERS.map((p) => (
              <Pill
                key={p.id}
                active={state.provider === p.id}
                onClick={() => actions.setProvider(p.id)}
                theme={theme}
                size="sm"
              >
                {p.name}
              </Pill>
            ))}
          </div>

          {/* API Key Input */}
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={state.apiKey}
              onChange={(e) => actions.setApiKey(e.target.value)}
              placeholder={`${state.provider} API key`}
              className="w-full px-3 py-2 pr-14 rounded-lg text-[11px] font-mono"
              style={{
                backgroundColor: theme.background,
                border: `1px solid ${
                  state.isKeyValid === true ? theme.success :
                  state.isKeyValid === false ? theme.error : theme.border
                }`,
                color: theme.text.primary,
              }}
            />
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] px-1.5 py-0.5 rounded hover:bg-white/10"
              style={{ color: theme.text.muted }}
            >
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>

          {/* Validation Status */}
          {state.apiKey && state.isKeyValid === null && (
            <button
              onClick={actions.validateApiKey}
              disabled={state.isTestingKey}
              className="w-full py-1.5 rounded text-[10px] transition-colors"
              style={{
                backgroundColor: theme.surface,
                color: theme.text.secondary,
              }}
            >
              {state.isTestingKey ? 'Validating...' : 'Validate Key'}
            </button>
          )}
          {state.isKeyValid === false && (
            <div className="text-[10px]" style={{ color: theme.error }}>
              Invalid API key
            </div>
          )}
        </div>
      </Collapsible>

      {/* ================================================================== */}
      {/* HISTORY - Collapsible */}
      {/* ================================================================== */}
      {state.generationHistory.length > 0 && (
        <Collapsible title="History" theme={theme}>
          <div className="space-y-1">
            {state.generationHistory.slice(0, 5).map((entry) => (
              <button
                key={entry.id}
                onClick={() => actions.loadFromHistory(entry.id)}
                className="w-full p-2 rounded text-left text-[10px] transition-colors hover:bg-white/5"
                style={{ backgroundColor: theme.background }}
              >
                <div className="flex justify-between">
                  <span style={{ color: theme.text.secondary }}>
                    {entry.settings.playerCount}P · {entry.settings.mapSize} · {entry.settings.biome}
                  </span>
                  <span style={{ color: theme.text.muted }}>
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </Collapsible>
      )}
    </div>
  );
}

export default AIGeneratePanel;
