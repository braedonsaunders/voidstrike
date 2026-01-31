/**
 * AIGeneratePanel - LLM-powered map generation panel
 *
 * Provides UI for:
 * - API key configuration (Claude, OpenAI, Gemini)
 * - Map generation settings (players, size, biome, theme)
 * - Generation controls with loading state
 * - History for regeneration with tweaks
 */

'use client';

import { useState, useEffect } from 'react';
import type { EditorConfig } from '../config/EditorConfig';
import type { MapData } from '@/data/maps/MapTypes';
import type { BiomeType } from '@/data/maps/core/ElevationMap';
import { useLLMGeneration } from '../hooks/useLLMGeneration';
import type { LLMProvider, MapGenerationSettings } from '../services/LLMMapGenerator';

// ============================================================================
// TYPES
// ============================================================================

export interface AIGeneratePanelProps {
  config: EditorConfig;
  onMapGenerated: (mapData: MapData) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PROVIDERS: Array<{ id: LLMProvider; name: string; icon: string }> = [
  { id: 'claude', name: 'Claude', icon: '🧠' },
  { id: 'openai', name: 'OpenAI', icon: '🤖' },
  { id: 'gemini', name: 'Gemini', icon: '✨' },
];

const PLAYER_COUNTS: Array<2 | 4 | 6 | 8> = [2, 4, 6, 8];

const MAP_SIZES: Array<{ id: MapGenerationSettings['mapSize']; name: string; desc: string }> = [
  { id: 'small', name: 'Small', desc: '128x128' },
  { id: 'medium', name: 'Medium', desc: '176x176' },
  { id: 'large', name: 'Large', desc: '224x224' },
  { id: 'huge', name: 'Huge', desc: '256x256' },
];

const BIOMES: Array<{ id: BiomeType; name: string; icon: string }> = [
  { id: 'void', name: 'Void', icon: '🌌' },
  { id: 'grassland', name: 'Grassland', icon: '🌿' },
  { id: 'desert', name: 'Desert', icon: '🏜️' },
  { id: 'frozen', name: 'Frozen', icon: '❄️' },
  { id: 'volcanic', name: 'Volcanic', icon: '🌋' },
  { id: 'jungle', name: 'Jungle', icon: '🌴' },
  { id: 'ocean', name: 'Ocean', icon: '🌊' },
];

const BORDER_STYLES: Array<{ id: MapGenerationSettings['borderStyle']; name: string }> = [
  { id: 'rocks', name: 'Rocks' },
  { id: 'crystals', name: 'Crystals' },
  { id: 'trees', name: 'Trees' },
  { id: 'mixed', name: 'Mixed' },
  { id: 'none', name: 'None' },
];

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function Section({
  title,
  icon,
  children,
  defaultOpen = true,
  theme,
}: {
  title: string;
  icon?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  theme: EditorConfig['theme'];
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        backgroundColor: theme.background,
        border: `1px solid ${theme.border}40`,
      }}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/5 transition-colors"
      >
        <span
          className="text-[10px] transition-transform"
          style={{
            color: theme.text.muted,
            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ▶
        </span>
        {icon && <span className="text-sm">{icon}</span>}
        <span className="text-xs font-medium" style={{ color: theme.text.secondary }}>
          {title}
        </span>
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
  theme,
  fullWidth = false,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  theme: EditorConfig['theme'];
  fullWidth?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        px-3 py-2 rounded-lg text-xs transition-all
        ${active ? 'ring-1' : 'hover:bg-white/5'}
        ${fullWidth ? 'w-full' : ''}
      `}
      style={{
        backgroundColor: active ? `${theme.primary}20` : theme.surface,
        color: active ? theme.text.primary : theme.text.muted,
        '--tw-ring-color': theme.primary,
      } as React.CSSProperties}
    >
      {children}
    </button>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
  theme,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  theme: EditorConfig['theme'];
}) {
  return (
    <label
      className="flex items-center gap-2 cursor-pointer group"
      onClick={() => onChange(!checked)}
    >
      <div
        className="w-4 h-4 rounded border-2 flex items-center justify-center transition-all"
        style={{
          borderColor: checked ? theme.primary : theme.border,
          backgroundColor: checked ? theme.primary : 'transparent',
        }}
      >
        {checked && (
          <span className="text-white text-[10px]">✓</span>
        )}
      </div>
      <span
        className="text-xs transition-colors group-hover:text-white"
        style={{ color: theme.text.muted }}
      >
        {label}
      </span>
    </label>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function AIGeneratePanel({ config, onMapGenerated }: AIGeneratePanelProps) {
  const theme = config.theme;
  const [state, actions] = useLLMGeneration();
  const [showApiKey, setShowApiKey] = useState(false);

  // Handle successful generation
  useEffect(() => {
    if (state.lastGeneration?.mapData) {
      onMapGenerated(state.lastGeneration.mapData);
    }
  }, [state.lastGeneration, onMapGenerated]);

  const handleGenerate = async () => {
    // Validate API key first if not validated
    if (!state.isKeyValid) {
      const valid = await actions.validateApiKey();
      if (!valid) return;
    }
    await actions.generate();
  };

  const canGenerate = state.apiKey.length > 0 && !state.isGenerating;

  return (
    <div className="space-y-3">
      {/* API Configuration */}
      <Section title="API Configuration" icon="🔑" theme={theme}>
        <div className="space-y-3">
          {/* Provider Selection */}
          <div>
            <label
              className="text-[10px] uppercase tracking-wider block mb-1.5"
              style={{ color: theme.text.muted }}
            >
              Provider
            </label>
            <div className="grid grid-cols-3 gap-1">
              {PROVIDERS.map((provider) => (
                <ToggleButton
                  key={provider.id}
                  active={state.provider === provider.id}
                  onClick={() => actions.setProvider(provider.id)}
                  theme={theme}
                >
                  <span className="mr-1">{provider.icon}</span>
                  {provider.name}
                </ToggleButton>
              ))}
            </div>
          </div>

          {/* API Key Input */}
          <div>
            <label
              className="text-[10px] uppercase tracking-wider block mb-1.5"
              style={{ color: theme.text.muted }}
            >
              API Key
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={state.apiKey}
                onChange={(e) => actions.setApiKey(e.target.value)}
                placeholder={`Enter ${state.provider} API key...`}
                className="w-full px-3 py-2 pr-16 rounded-lg text-sm font-mono"
                style={{
                  backgroundColor: theme.surface,
                  border: `1px solid ${
                    state.isKeyValid === true
                      ? theme.success
                      : state.isKeyValid === false
                      ? theme.error
                      : theme.border
                  }`,
                  color: theme.text.primary,
                }}
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1">
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="px-2 py-1 text-[10px] rounded hover:bg-white/10 transition-colors"
                  style={{ color: theme.text.muted }}
                >
                  {showApiKey ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            {state.isKeyValid === true && (
              <div className="mt-1 text-[10px] flex items-center gap-1" style={{ color: theme.success }}>
                <span>✓</span> Key validated
              </div>
            )}
            {state.isKeyValid === false && (
              <div className="mt-1 text-[10px] flex items-center gap-1" style={{ color: theme.error }}>
                <span>✗</span> Invalid key
              </div>
            )}
          </div>

          {/* Validate Button */}
          {state.apiKey && state.isKeyValid === null && (
            <button
              onClick={actions.validateApiKey}
              disabled={state.isTestingKey}
              className="w-full py-2 rounded-lg text-xs transition-colors"
              style={{
                backgroundColor: theme.surface,
                color: theme.text.secondary,
                border: `1px solid ${theme.border}`,
              }}
            >
              {state.isTestingKey ? 'Validating...' : 'Validate Key'}
            </button>
          )}
        </div>
      </Section>

      {/* Map Settings */}
      <Section title="Map Settings" icon="🗺️" theme={theme}>
        <div className="space-y-3">
          {/* Player Count */}
          <div>
            <label
              className="text-[10px] uppercase tracking-wider block mb-1.5"
              style={{ color: theme.text.muted }}
            >
              Players
            </label>
            <div className="grid grid-cols-4 gap-1">
              {PLAYER_COUNTS.map((count) => (
                <ToggleButton
                  key={count}
                  active={state.settings.playerCount === count}
                  onClick={() => actions.updateSettings({ playerCount: count })}
                  theme={theme}
                >
                  {count}P
                </ToggleButton>
              ))}
            </div>
          </div>

          {/* Map Size */}
          <div>
            <label
              className="text-[10px] uppercase tracking-wider block mb-1.5"
              style={{ color: theme.text.muted }}
            >
              Size
            </label>
            <div className="grid grid-cols-2 gap-1">
              {MAP_SIZES.map((size) => (
                <ToggleButton
                  key={size.id}
                  active={state.settings.mapSize === size.id}
                  onClick={() => actions.updateSettings({ mapSize: size.id })}
                  theme={theme}
                >
                  <div className="text-left">
                    <div>{size.name}</div>
                    <div className="text-[9px] opacity-60">{size.desc}</div>
                  </div>
                </ToggleButton>
              ))}
            </div>
          </div>

          {/* Biome */}
          <div>
            <label
              className="text-[10px] uppercase tracking-wider block mb-1.5"
              style={{ color: theme.text.muted }}
            >
              Biome
            </label>
            <div className="grid grid-cols-3 gap-1">
              {BIOMES.map((biome) => (
                <ToggleButton
                  key={biome.id}
                  active={state.settings.biome === biome.id}
                  onClick={() => actions.updateSettings({ biome: biome.id })}
                  theme={theme}
                >
                  <span className="mr-1">{biome.icon}</span>
                  {biome.name}
                </ToggleButton>
              ))}
            </div>
          </div>

          {/* Border Style */}
          <div>
            <label
              className="text-[10px] uppercase tracking-wider block mb-1.5"
              style={{ color: theme.text.muted }}
            >
              Border Decorations
            </label>
            <div className="grid grid-cols-3 gap-1">
              {BORDER_STYLES.map((style) => (
                <ToggleButton
                  key={style.id}
                  active={state.settings.borderStyle === style.id}
                  onClick={() => actions.updateSettings({ borderStyle: style.id })}
                  theme={theme}
                >
                  {style.name}
                </ToggleButton>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* Features */}
      <Section title="Features" icon="⚡" theme={theme}>
        <div className="space-y-2">
          <Checkbox
            checked={state.settings.includeForests}
            onChange={(checked) => actions.updateSettings({ includeForests: checked })}
            label="Include forests (vision blockers)"
            theme={theme}
          />
          <Checkbox
            checked={state.settings.includeWater}
            onChange={(checked) => actions.updateSettings({ includeWater: checked, islandMap: checked ? state.settings.islandMap : false })}
            label="Include water features"
            theme={theme}
          />
          {state.settings.includeWater && (
            <div className="ml-6">
              <Checkbox
                checked={state.settings.islandMap}
                onChange={(checked) => actions.updateSettings({ islandMap: checked })}
                label="Island/Naval map (deep water barriers)"
                theme={theme}
              />
            </div>
          )}
        </div>
      </Section>

      {/* Theme Description */}
      <Section title="Theme Description" icon="💡" theme={theme}>
        <div>
          <textarea
            value={state.settings.theme}
            onChange={(e) => actions.updateSettings({ theme: e.target.value })}
            placeholder="Describe your map vision... e.g., 'A frozen wasteland with a contested central high ground, multiple attack paths, and hidden gold bases'"
            rows={4}
            className="w-full px-3 py-2 rounded-lg text-sm resize-none"
            style={{
              backgroundColor: theme.surface,
              border: `1px solid ${theme.border}`,
              color: theme.text.primary,
            }}
          />
          <div className="mt-1 text-[10px]" style={{ color: theme.text.muted }}>
            Be specific about layout, terrain features, and gameplay style
          </div>
        </div>
      </Section>

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        className="w-full py-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
        style={{
          backgroundColor: canGenerate ? theme.primary : theme.surface,
          color: canGenerate ? '#fff' : theme.text.muted,
          opacity: state.isGenerating ? 0.7 : 1,
          boxShadow: canGenerate ? `0 4px 16px ${theme.primary}50` : 'none',
        }}
      >
        {state.isGenerating ? (
          <>
            <span className="animate-spin">⟳</span>
            Generating Map...
          </>
        ) : (
          <>
            <span>🪄</span>
            Generate Map
          </>
        )}
      </button>

      {/* Error Display */}
      {state.error && (
        <div
          className="p-3 rounded-lg text-xs"
          style={{
            backgroundColor: `${theme.error}15`,
            border: `1px solid ${theme.error}30`,
            color: theme.error,
          }}
        >
          <div className="font-medium mb-1">Generation Failed</div>
          <div style={{ color: theme.text.muted }}>{state.error}</div>
        </div>
      )}

      {/* Success Display */}
      {state.lastGeneration && !state.isGenerating && !state.error && (
        <div
          className="p-3 rounded-lg text-xs"
          style={{
            backgroundColor: `${theme.success}15`,
            border: `1px solid ${theme.success}30`,
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span style={{ color: theme.success }}>✓</span>
            <span className="font-medium" style={{ color: theme.success }}>
              Map Generated Successfully
            </span>
          </div>
          <div className="space-y-1" style={{ color: theme.text.muted }}>
            <div>
              <strong style={{ color: theme.text.secondary }}>Name:</strong>{' '}
              {state.lastGeneration.blueprint.meta.name}
            </div>
            <div>
              <strong style={{ color: theme.text.secondary }}>Size:</strong>{' '}
              {state.lastGeneration.blueprint.canvas.width}x{state.lastGeneration.blueprint.canvas.height}
            </div>
            <div>
              <strong style={{ color: theme.text.secondary }}>Bases:</strong>{' '}
              {state.lastGeneration.blueprint.bases.length}
            </div>
          </div>
          <button
            onClick={actions.regenerate}
            className="mt-2 w-full py-2 rounded text-[11px] transition-colors hover:bg-white/10"
            style={{
              backgroundColor: theme.surface,
              color: theme.text.secondary,
              border: `1px solid ${theme.border}`,
            }}
          >
            🔄 Regenerate with Same Settings
          </button>
        </div>
      )}

      {/* Generation History */}
      {state.generationHistory.length > 0 && (
        <Section title="History" icon="📜" theme={theme} defaultOpen={false}>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {state.generationHistory.slice(0, 5).map((entry) => (
              <button
                key={entry.id}
                onClick={() => {
                  const _blueprint = actions.loadFromHistory(entry.id);
                  // Could regenerate from this blueprint's settings
                }}
                className="w-full p-2 rounded text-left text-[11px] transition-colors hover:bg-white/5"
                style={{
                  backgroundColor: theme.surface,
                  border: `1px solid ${theme.border}40`,
                }}
              >
                <div className="flex justify-between items-center">
                  <span style={{ color: theme.text.secondary }}>
                    {entry.settings.playerCount}P {entry.settings.mapSize}
                  </span>
                  <span style={{ color: theme.text.muted }}>
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                {entry.settings.theme && (
                  <div
                    className="mt-1 truncate"
                    style={{ color: theme.text.muted }}
                  >
                    {entry.settings.theme.slice(0, 50)}...
                  </div>
                )}
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* Tips */}
      <Section title="Tips" icon="💭" theme={theme} defaultOpen={false}>
        <ul className="space-y-1.5 text-[11px]" style={{ color: theme.text.muted }}>
          <li className="flex items-start gap-2">
            <span style={{ color: theme.primary }}>•</span>
            <span>Describe terrain features like &quot;central high ground&quot; or &quot;island bases&quot;</span>
          </li>
          <li className="flex items-start gap-2">
            <span style={{ color: theme.primary }}>•</span>
            <span>Mention expansion layout: &quot;easy natural, contested third&quot;</span>
          </li>
          <li className="flex items-start gap-2">
            <span style={{ color: theme.primary }}>•</span>
            <span>Request strategic elements: &quot;multiple attack paths&quot;, &quot;watch tower at center&quot;</span>
          </li>
          <li className="flex items-start gap-2">
            <span style={{ color: theme.primary }}>•</span>
            <span>Use Ctrl+Z to undo if you don&apos;t like the result</span>
          </li>
        </ul>
      </Section>
    </div>
  );
}

export default AIGeneratePanel;
