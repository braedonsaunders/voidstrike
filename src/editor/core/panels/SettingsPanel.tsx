'use client';

import { useState } from 'react';
import type { EditorConfig, EditorState, EditorMapData, EditorObject } from '../../config/EditorConfig';
import { Section, ToggleSwitch } from './shared';
import {
  generateBorderDecorations,
  clearBorderDecorations,
  countBorderDecorations,
  type BorderDecorationStyle,
  type BorderDecorationSettings,
  DEFAULT_BORDER_SETTINGS,
} from '../../utils/borderDecorations';

export interface SettingsPanelProps {
  config: EditorConfig;
  state: EditorState;
  visibility: { labels: boolean; grid: boolean; categories: Record<string, boolean> };
  onBiomeChange: (biomeId: string) => void;
  onMetadataUpdate: (updates: Partial<Pick<EditorMapData, 'name' | 'width' | 'height' | 'biomeId'>>) => void;
  onToggleLabels: () => void;
  onToggleGrid: () => void;
  onToggleCategory: (category: string) => void;
  onUpdateObjects?: (objects: EditorObject[]) => void;
}

export function SettingsPanel({
  config,
  state,
  visibility,
  onBiomeChange,
  onMetadataUpdate,
  onToggleLabels,
  onToggleGrid,
  onToggleCategory,
  onUpdateObjects,
}: SettingsPanelProps) {
  const theme = config.theme;

  // Border decoration state
  const [borderStyle, setBorderStyle] = useState<BorderDecorationStyle>('rocks');
  const [borderDensity, setBorderDensity] = useState(0.7);
  const [isGenerating, setIsGenerating] = useState(false);

  if (!state.mapData) return null;

  const categories = Array.from(new Set(config.objectTypes.map((t) => t.category)));
  const borderDecorationCount = countBorderDecorations(state.mapData.objects);

  const handleGenerateBorderDecorations = () => {
    if (!state.mapData || !onUpdateObjects) return;
    setIsGenerating(true);

    const settings: BorderDecorationSettings = {
      ...DEFAULT_BORDER_SETTINGS,
      style: borderStyle,
      density: borderDensity,
    };

    const newObjects = generateBorderDecorations(state.mapData, settings);
    onUpdateObjects(newObjects);
    setIsGenerating(false);
  };

  const handleClearBorderDecorations = () => {
    if (!state.mapData || !onUpdateObjects) return;
    const newObjects = clearBorderDecorations(state.mapData.objects);
    onUpdateObjects(newObjects);
  };

  return (
    <div className="space-y-3">
      {/* Map info */}
      <Section title="Map Info" icon="📋" theme={theme}>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider" style={{ color: theme.text.muted }}>
              Name
            </label>
            <input
              type="text"
              value={state.mapData.name}
              onChange={(e) => onMetadataUpdate({ name: e.target.value })}
              className="w-full mt-1 px-3 py-2 rounded-lg text-sm"
              style={{
                backgroundColor: theme.surface,
                border: `1px solid ${theme.border}`,
                color: theme.text.primary,
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider" style={{ color: theme.text.muted }}>
                Width
              </label>
              <input
                type="number"
                value={state.mapData.width}
                onChange={(e) => onMetadataUpdate({ width: Number(e.target.value) })}
                className="w-full mt-1 px-3 py-2 rounded-lg text-sm font-mono"
                style={{
                  backgroundColor: theme.surface,
                  border: `1px solid ${theme.border}`,
                  color: theme.text.primary,
                }}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider" style={{ color: theme.text.muted }}>
                Height
              </label>
              <input
                type="number"
                value={state.mapData.height}
                onChange={(e) => onMetadataUpdate({ height: Number(e.target.value) })}
                className="w-full mt-1 px-3 py-2 rounded-lg text-sm font-mono"
                style={{
                  backgroundColor: theme.surface,
                  border: `1px solid ${theme.border}`,
                  color: theme.text.primary,
                }}
              />
            </div>
          </div>
        </div>
      </Section>

      {/* Biome selection */}
      <Section title="Biome" icon="🌍" theme={theme}>
        <div className="grid grid-cols-2 gap-1.5">
          {config.biomes.map((biome) => (
            <button
              key={biome.id}
              onClick={() => onBiomeChange(biome.id)}
              className={`
                px-3 py-2 rounded-lg text-xs transition-all
                ${state.activeBiome === biome.id ? 'ring-1' : 'hover:bg-white/5'}
              `}
              style={{
                backgroundColor: state.activeBiome === biome.id ? `${theme.primary}20` : theme.surface,
                color: state.activeBiome === biome.id ? theme.text.primary : theme.text.muted,
                '--tw-ring-color': theme.primary,
              } as React.CSSProperties}
            >
              {biome.name}
            </button>
          ))}
        </div>
      </Section>

      {/* Visibility toggles */}
      <Section title="Visibility" icon="👁️" theme={theme}>
        <div className="space-y-1">
          <ToggleSwitch
            checked={visibility.labels}
            onChange={onToggleLabels}
            label="Show Labels"
            theme={theme}
          />
          <ToggleSwitch
            checked={visibility.grid}
            onChange={onToggleGrid}
            label="Show Grid"
            theme={theme}
          />
          <div
            className="my-2 h-px"
            style={{ backgroundColor: theme.border }}
          />
          <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: theme.text.muted }}>
            Categories
          </div>
          {categories.map((category) => (
            <ToggleSwitch
              key={category}
              checked={visibility.categories[category] ?? true}
              onChange={() => onToggleCategory(category)}
              label={category.charAt(0).toUpperCase() + category.slice(1)}
              theme={theme}
            />
          ))}
        </div>
      </Section>

      {/* Border Decorations */}
      {onUpdateObjects && (
        <Section title="Border Decorations" icon="🪨" theme={theme}>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider block mb-1.5" style={{ color: theme.text.muted }}>
                Style
              </label>
              <div className="grid grid-cols-3 gap-1">
                {(['rocks', 'crystals', 'trees', 'mixed', 'alien', 'dead_trees'] as BorderDecorationStyle[]).map((style) => (
                  <button
                    key={style}
                    onClick={() => setBorderStyle(style)}
                    className="px-2 py-1.5 rounded text-[11px] transition-all capitalize hover:bg-white/5"
                    style={{
                      backgroundColor: borderStyle === style ? `${theme.primary}20` : theme.surface,
                      color: borderStyle === style ? theme.text.primary : theme.text.muted,
                      border: borderStyle === style ? `1px solid ${theme.primary}` : '1px solid transparent',
                    }}
                  >
                    {style.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-[10px] uppercase tracking-wider" style={{ color: theme.text.muted }}>
                  Density
                </label>
                <span className="text-[10px] font-mono" style={{ color: theme.text.secondary }}>
                  {Math.round(borderDensity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={borderDensity}
                onChange={(e) => setBorderDensity(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleGenerateBorderDecorations}
                disabled={isGenerating}
                className="flex-1 py-2 rounded-lg text-xs font-medium transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  backgroundColor: theme.primary,
                  color: '#fff',
                  opacity: isGenerating ? 0.7 : 1,
                }}
              >
                {isGenerating ? 'Generating...' : 'Generate'}
              </button>
              {borderDecorationCount > 0 && (
                <button
                  onClick={handleClearBorderDecorations}
                  className="px-3 py-2 rounded-lg text-xs transition-colors hover:bg-white/10"
                  style={{
                    backgroundColor: theme.surface,
                    color: theme.error,
                    border: `1px solid ${theme.error}40`,
                  }}
                >
                  Clear ({borderDecorationCount})
                </button>
              )}
            </div>

            <div className="text-[10px]" style={{ color: theme.text.muted }}>
              Places decorative {borderStyle} around the map edges to create an imposing boundary wall.
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
