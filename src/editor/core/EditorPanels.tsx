/**
 * EditorPanels - Professional right sidebar
 *
 * Modern panel system with collapsible sections, card-based layout,
 * and polished styling. Organized for efficient workflow.
 */

'use client';

import { useState } from 'react';
import type {
  EditorConfig,
  EditorState,
  EditorObject,
  EditorMapData,
  ToolConfig,
} from '../config/EditorConfig';
import type { DetailedValidationResult } from './EditorCore';

export interface EditorPanelsProps {
  config: EditorConfig;
  state: EditorState;
  visibility: {
    labels: boolean;
    grid: boolean;
    categories: Record<string, boolean>;
  };
  onToolSelect: (toolId: string) => void;
  onElevationSelect: (elevation: number) => void;
  onFeatureSelect: (feature: string) => void;
  onMaterialSelect: (materialId: number) => void;
  onBrushSizeChange: (size: number) => void;
  onPanelChange: (panelId: string) => void;
  onBiomeChange: (biomeId: string) => void;
  onObjectAdd: (obj: Omit<EditorObject, 'id'>) => string;
  onObjectRemove: (id: string) => void;
  onObjectPropertyUpdate: (id: string, key: string, value: unknown) => void;
  onMetadataUpdate: (updates: Partial<Pick<EditorMapData, 'name' | 'width' | 'height' | 'biomeId'>>) => void;
  onValidate: () => void;
  onAutoFix?: () => void;
  validationResult?: DetailedValidationResult;
  onToggleLabels: () => void;
  onToggleGrid: () => void;
  onToggleCategory: (category: string) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

// Tool categories for paint panel
const TOOL_CATEGORIES = {
  paint: { name: 'Paint', tools: ['brush', 'fill', 'eraser'] },
  shapes: { name: 'Shapes', tools: ['line', 'rect', 'ellipse', 'plateau', 'ramp'] },
  platform: { name: 'Platform', tools: ['platform_brush', 'platform_rect', 'platform_ramp'] },
  sculpt: { name: 'Sculpt', tools: ['raise', 'lower', 'smooth', 'noise'] },
};

// Panel icons
const PANEL_ICONS: Record<string, string> = {
  paint: '🎨',
  bases: '🏰',
  objects: '📦',
  decorations: '🌿',
  settings: '⚙️',
  validate: '✓',
};

// Collapsible section component
function Section({
  title,
  icon,
  children,
  defaultOpen = true,
  theme,
  badge,
}: {
  title: string;
  icon?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  theme: EditorConfig['theme'];
  badge?: string | number;
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
        <span className="text-xs font-medium flex-1 text-left" style={{ color: theme.text.secondary }}>
          {title}
        </span>
        {badge !== undefined && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full"
            style={{
              backgroundColor: `${theme.primary}30`,
              color: theme.primary,
            }}
          >
            {badge}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="px-3 pb-3">
          {children}
        </div>
      )}
    </div>
  );
}

// Modern panel tab
function PanelTab({
  active,
  onClick,
  icon,
  name,
  theme,
}: {
  active: boolean;
  onClick: () => void;
  icon?: string;
  name: string;
  theme: EditorConfig['theme'];
}) {
  return (
    <button
      onClick={onClick}
      title={name}
      className={`
        relative px-3 py-2.5 flex items-center justify-center gap-1.5 transition-all duration-150
        ${active ? '' : 'hover:bg-white/5'}
      `}
      style={{
        color: active ? theme.primary : theme.text.muted,
      }}
    >
      <span className="text-base">{icon || PANEL_ICONS[name.toLowerCase()] || name.charAt(0)}</span>
      {active && (
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full"
          style={{ backgroundColor: theme.primary }}
        />
      )}
    </button>
  );
}

// Slider with visual feedback
function Slider({
  label,
  value,
  min,
  max,
  onChange,
  theme,
  showValue = true,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  theme: EditorConfig['theme'];
  showValue?: boolean;
}) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-[11px]" style={{ color: theme.text.muted }}>{label}</span>
        {showValue && (
          <span
            className="text-[11px] font-mono px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: theme.surface,
              color: theme.text.secondary,
            }}
          >
            {value}
          </span>
        )}
      </div>
      <div className="relative h-1.5 rounded-full" style={{ backgroundColor: theme.border }}>
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all"
          style={{
            width: `${percentage}%`,
            backgroundColor: theme.primary,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
}

// Tool grid with category support
function ToolGrid({
  tools,
  activeTool,
  onSelect,
  theme,
  columns = 4,
}: {
  tools: ToolConfig[];
  activeTool: string;
  onSelect: (toolId: string) => void;
  theme: EditorConfig['theme'];
  columns?: number;
}) {
  return (
    <div className={`grid gap-1`} style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => onSelect(tool.id)}
          title={`${tool.name} (${tool.shortcut})`}
          className={`
            relative aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5
            transition-all duration-150
            ${activeTool === tool.id ? 'ring-2' : 'hover:bg-white/5'}
          `}
          style={{
            backgroundColor: activeTool === tool.id ? `${theme.primary}20` : theme.surface,
            '--tw-ring-color': theme.primary,
            color: activeTool === tool.id ? theme.text.primary : theme.text.muted,
          } as React.CSSProperties}
        >
          <span className="text-base">{tool.icon}</span>
          <span className="text-[9px] leading-tight truncate max-w-full px-1">{tool.name}</span>
        </button>
      ))}
    </div>
  );
}

// Elevation palette - compact color swatches
function ElevationPalette({
  elevations,
  selected,
  onSelect,
  theme,
}: {
  elevations: EditorConfig['terrain']['elevations'];
  selected: number;
  onSelect: (id: number) => void;
  theme: EditorConfig['theme'];
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {elevations.map((elev) => (
          <button
            key={elev.id}
            onClick={() => onSelect(elev.id)}
            title={`${elev.name} (${elev.shortcut || elev.id})`}
            className={`
              w-8 h-8 rounded-md border-2 transition-all duration-150 relative
              ${selected === elev.id ? 'scale-110 ring-2 ring-offset-1' : 'hover:scale-105'}
            `}
            style={{
              backgroundColor: elev.color,
              borderColor: selected === elev.id ? '#fff' : 'transparent',
              '--tw-ring-color': theme.primary,
              '--tw-ring-offset-color': theme.background,
            } as React.CSSProperties}
          >
            {elev.shortcut && (
              <span
                className="absolute -bottom-0.5 -right-0.5 text-[8px] w-3 h-3 rounded flex items-center justify-center"
                style={{
                  backgroundColor: theme.background,
                  color: theme.text.muted,
                }}
              >
                {elev.shortcut}
              </span>
            )}
          </button>
        ))}
      </div>
      {/* Selected elevation info */}
      {elevations.find((e) => e.id === selected) && (
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded-md"
          style={{ backgroundColor: theme.surface }}
        >
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: elevations.find((e) => e.id === selected)?.color }}
          />
          <span className="text-xs" style={{ color: theme.text.secondary }}>
            {elevations.find((e) => e.id === selected)?.name}
          </span>
          {!elevations.find((e) => e.id === selected)?.walkable && (
            <span
              className="text-[9px] px-1 py-0.5 rounded"
              style={{ backgroundColor: `${theme.error}30`, color: theme.error }}
            >
              Blocked
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Feature buttons
function FeatureGrid({
  features,
  selected,
  onSelect,
  theme,
}: {
  features: EditorConfig['terrain']['features'];
  selected: string;
  onSelect: (id: string) => void;
  theme: EditorConfig['theme'];
}) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {features.map((feature) => (
        <button
          key={feature.id}
          onClick={() => onSelect(feature.id)}
          className={`
            flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-all
            ${selected === feature.id ? 'ring-1' : 'hover:bg-white/5'}
          `}
          style={{
            backgroundColor: selected === feature.id ? `${theme.primary}20` : theme.surface,
            '--tw-ring-color': theme.primary,
            color: selected === feature.id ? theme.text.primary : theme.text.muted,
          } as React.CSSProperties}
        >
          <span>{feature.icon}</span>
          <span className="truncate">{feature.name}</span>
        </button>
      ))}
    </div>
  );
}

// Material selector
function MaterialSelector({
  materials,
  selected,
  onSelect,
  theme,
}: {
  materials: EditorConfig['terrain']['materials'];
  selected: number;
  onSelect: (id: number) => void;
  theme: EditorConfig['theme'];
}) {
  if (!materials || materials.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-1">
      {materials.map((mat) => (
        <button
          key={mat.id}
          onClick={() => onSelect(mat.id)}
          className={`
            flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-all
            ${selected === mat.id ? 'ring-1' : 'hover:bg-white/5'}
          `}
          style={{
            backgroundColor: selected === mat.id ? `${theme.primary}20` : theme.surface,
            '--tw-ring-color': theme.primary,
            color: selected === mat.id ? theme.text.primary : theme.text.muted,
          } as React.CSSProperties}
        >
          <span>{mat.icon}</span>
          <span className="flex-1 truncate text-left">{mat.name}</span>
          {mat.shortcut && (
            <span className="text-[10px] opacity-50">{mat.shortcut}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// Toggle switch component
function ToggleSwitch({
  checked,
  onChange,
  label,
  theme,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  theme: EditorConfig['theme'];
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer py-0.5">
      <span className="text-xs" style={{ color: theme.text.secondary }}>{label}</span>
      <button
        onClick={onChange}
        className="w-9 h-5 rounded-full relative transition-colors duration-200"
        style={{
          backgroundColor: checked ? theme.primary : theme.border,
        }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200"
          style={{
            left: checked ? '18px' : '2px',
          }}
        />
      </button>
    </label>
  );
}

// Paint panel
function PaintPanel({
  config,
  state,
  onToolSelect,
  onElevationSelect,
  onFeatureSelect,
  onMaterialSelect,
  onBrushSizeChange,
}: {
  config: EditorConfig;
  state: EditorState;
  onToolSelect: (toolId: string) => void;
  onElevationSelect: (elevation: number) => void;
  onFeatureSelect: (feature: string) => void;
  onMaterialSelect: (materialId: number) => void;
  onBrushSizeChange: (size: number) => void;
}) {
  const theme = config.theme;
  const activeTool = config.tools.find((t) => t.id === state.activeTool);

  // Group tools by category
  const getToolsForCategory = (category: string): ToolConfig[] => {
    const toolIds = TOOL_CATEGORIES[category as keyof typeof TOOL_CATEGORIES]?.tools || [];
    return toolIds
      .map((id) => config.tools.find((t) => t.id === id))
      .filter((t): t is ToolConfig => t !== undefined);
  };

  return (
    <div className="space-y-3">
      {/* All tools in categories */}
      <Section title="Tools" icon="🔧" theme={theme}>
        <div className="space-y-3">
          {Object.entries(TOOL_CATEGORIES).map(([catId, cat]) => {
            const tools = getToolsForCategory(catId);
            if (tools.length === 0) return null;
            return (
              <div key={catId}>
                <div
                  className="text-[10px] uppercase tracking-wider mb-1.5"
                  style={{ color: theme.text.muted }}
                >
                  {cat.name}
                </div>
                <ToolGrid
                  tools={tools}
                  activeTool={state.activeTool}
                  onSelect={onToolSelect}
                  theme={theme}
                  columns={tools.length <= 3 ? 3 : 4}
                />
              </div>
            );
          })}
        </div>
      </Section>

      {/* Brush size (contextual) */}
      {activeTool?.hasBrushSize && (
        <Section title="Brush" icon="●" theme={theme}>
          <Slider
            label="Size"
            value={state.brushSize}
            min={activeTool.minBrushSize || 1}
            max={activeTool.maxBrushSize || 20}
            onChange={onBrushSizeChange}
            theme={theme}
          />
        </Section>
      )}

      {/* Elevation */}
      <Section title="Elevation" icon="▲" theme={theme}>
        <ElevationPalette
          elevations={config.terrain.elevations}
          selected={state.selectedElevation}
          onSelect={onElevationSelect}
          theme={theme}
        />
      </Section>

      {/* Features */}
      <Section title="Features" icon="🌊" theme={theme} defaultOpen={false}>
        <FeatureGrid
          features={config.terrain.features}
          selected={state.selectedFeature}
          onSelect={onFeatureSelect}
          theme={theme}
        />
      </Section>

      {/* Materials */}
      {config.terrain.materials && config.terrain.materials.length > 0 && (
        <Section title="Material" icon="🎨" theme={theme} defaultOpen={false}>
          <MaterialSelector
            materials={config.terrain.materials}
            selected={state.selectedMaterial}
            onSelect={onMaterialSelect}
            theme={theme}
          />
        </Section>
      )}
    </div>
  );
}

// Objects panel (generic for bases, objects, decorations)
function ObjectsPanel({
  config,
  state,
  category,
  onObjectAdd,
  onObjectRemove,
}: {
  config: EditorConfig;
  state: EditorState;
  category: string;
  onObjectAdd: (obj: Omit<EditorObject, 'id'>) => string;
  onObjectRemove: (id: string) => void;
}) {
  const theme = config.theme;
  const categoryObjects = config.objectTypes.filter((t) => t.category === category);
  const placedObjects = state.mapData?.objects.filter((obj) => {
    const objType = config.objectTypes.find((t) => t.id === obj.type);
    return objType?.category === category;
  }) || [];

  const handleAddObject = (typeId: string) => {
    if (!state.mapData) return;
    const objType = config.objectTypes.find((t) => t.id === typeId);
    if (!objType) return;

    const defaultProperties: Record<string, unknown> = {};
    if (objType.properties) {
      for (const prop of objType.properties) {
        if (prop.defaultValue !== undefined) {
          defaultProperties[prop.key] = prop.defaultValue;
        }
      }
    }

    onObjectAdd({
      type: typeId,
      x: Math.floor(state.mapData.width / 2),
      y: Math.floor(state.mapData.height / 2),
      radius: objType.defaultRadius,
      properties: defaultProperties,
    });
  };

  return (
    <div className="space-y-3">
      {/* Add new objects */}
      <Section title={`Add ${category}`} icon="+" theme={theme}>
        <div className="grid grid-cols-2 gap-1.5">
          {categoryObjects.map((objType) => (
            <button
              key={objType.id}
              onClick={() => handleAddObject(objType.id)}
              className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-all hover:scale-[1.02]"
              style={{
                backgroundColor: theme.surface,
                color: theme.text.secondary,
                border: `1px dashed ${theme.border}`,
              }}
            >
              <span className="text-base">{objType.icon}</span>
              <span className="truncate">{objType.name}</span>
            </button>
          ))}
        </div>
        {categoryObjects.length === 0 && (
          <div className="text-xs italic py-2" style={{ color: theme.text.muted }}>
            No {category} types defined
          </div>
        )}
      </Section>

      {/* Placed objects list */}
      <Section
        title="Placed"
        icon="📍"
        theme={theme}
        badge={placedObjects.length > 0 ? placedObjects.length : undefined}
      >
        {placedObjects.length > 0 ? (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {placedObjects.map((obj) => {
              const objType = config.objectTypes.find((t) => t.id === obj.type);
              if (!objType) return null;
              const isSelected = state.selectedObjects.includes(obj.id);

              return (
                <div
                  key={obj.id}
                  className={`
                    flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all
                    ${isSelected ? 'ring-1' : ''}
                  `}
                  style={{
                    backgroundColor: isSelected ? `${theme.primary}20` : theme.surface,
                    '--tw-ring-color': theme.primary,
                  } as React.CSSProperties}
                >
                  <span className="text-sm">{objType.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate" style={{ color: theme.text.primary }}>
                      {objType.name}
                    </div>
                    <div
                      className="text-[10px] font-mono"
                      style={{ color: theme.text.muted }}
                    >
                      ({Math.round(obj.x)}, {Math.round(obj.y)})
                    </div>
                  </div>
                  <button
                    onClick={() => onObjectRemove(obj.id)}
                    className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/10 transition-colors"
                    style={{ color: theme.error }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs italic py-2" style={{ color: theme.text.muted }}>
            No {category} placed yet
          </div>
        )}
      </Section>
    </div>
  );
}

// Settings panel
function SettingsPanel({
  config,
  state,
  visibility,
  onBiomeChange,
  onMetadataUpdate,
  onToggleLabels,
  onToggleGrid,
  onToggleCategory,
}: {
  config: EditorConfig;
  state: EditorState;
  visibility: { labels: boolean; grid: boolean; categories: Record<string, boolean> };
  onBiomeChange: (biomeId: string) => void;
  onMetadataUpdate: (updates: Partial<Pick<EditorMapData, 'name' | 'width' | 'height' | 'biomeId'>>) => void;
  onToggleLabels: () => void;
  onToggleGrid: () => void;
  onToggleCategory: (category: string) => void;
}) {
  const theme = config.theme;
  if (!state.mapData) return null;

  const categories = Array.from(new Set(config.objectTypes.map((t) => t.category)));

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
    </div>
  );
}

// Validation panel
function ValidatePanel({
  config,
  validationResult,
  onValidate,
  onAutoFix,
}: {
  config: EditorConfig;
  validationResult?: DetailedValidationResult;
  onValidate: () => void;
  onAutoFix?: () => void;
}) {
  const theme = config.theme;
  const hasResult = validationResult?.timestamp !== undefined;
  const isValidating = validationResult?.isValidating ?? false;
  const isValid = validationResult?.valid ?? true;
  const issues = validationResult?.issues ?? [];
  const stats = validationResult?.stats;

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const hasFixes = issues.some(i => i.suggestedFix);

  return (
    <div className="space-y-3">
      {/* Validate button */}
      <button
        onClick={onValidate}
        disabled={isValidating}
        className="w-full py-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2"
        style={{
          backgroundColor: theme.primary,
          color: '#fff',
          opacity: isValidating ? 0.7 : 1,
          boxShadow: `0 2px 12px ${theme.primary}40`,
        }}
      >
        {isValidating ? (
          <>
            <span className="animate-spin">⟳</span>
            Validating...
          </>
        ) : (
          <>
            <span>✓</span>
            Validate Map
          </>
        )}
      </button>

      {/* Description */}
      <div
        className="text-[11px] leading-relaxed"
        style={{ color: theme.text.muted }}
      >
        Checks that all bases are connected and expansions are reachable.
      </div>

      {/* Results */}
      {hasResult && !isValidating && (
        <div className="space-y-3">
          {/* Status banner */}
          <div
            className="p-4 rounded-lg flex items-start gap-3"
            style={{
              backgroundColor: isValid ? `${theme.success}15` : `${theme.error}15`,
              border: `1px solid ${isValid ? theme.success : theme.error}30`,
            }}
          >
            <span
              className="text-xl mt-0.5"
              style={{ color: isValid ? theme.success : theme.error }}
            >
              {isValid ? '✓' : '✗'}
            </span>
            <div>
              <div
                className="text-sm font-medium"
                style={{ color: isValid ? theme.success : theme.error }}
              >
                {isValid ? 'Validation Passed' : 'Validation Failed'}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: theme.text.muted }}>
                {errors.length} error{errors.length !== 1 ? 's' : ''}, {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {/* Statistics */}
          {stats && (
            <Section title="Statistics" icon="📊" theme={theme} defaultOpen={false}>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Nodes', value: stats.totalNodes },
                  { label: 'Islands', value: stats.islandCount, warn: stats.islandCount > 1 },
                  { label: 'Connected', value: stats.connectedPairs, success: true },
                  { label: 'Blocked', value: stats.blockedPairs, error: stats.blockedPairs > 0 },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="px-3 py-2 rounded-lg"
                    style={{ backgroundColor: theme.surface }}
                  >
                    <div className="text-[10px]" style={{ color: theme.text.muted }}>
                      {stat.label}
                    </div>
                    <div
                      className="text-lg font-semibold"
                      style={{
                        color: stat.error
                          ? theme.error
                          : stat.warn
                          ? theme.warning
                          : stat.success
                          ? theme.success
                          : theme.text.primary,
                      }}
                    >
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <Section title="Errors" icon="❌" theme={theme} badge={errors.length}>
              <div className="space-y-2">
                {errors.map((issue, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg"
                    style={{
                      backgroundColor: `${theme.error}10`,
                      border: `1px solid ${theme.error}20`,
                    }}
                  >
                    <div className="text-xs" style={{ color: theme.text.primary }}>
                      {issue.message}
                    </div>
                    {issue.affectedNodes && issue.affectedNodes.length > 0 && (
                      <div className="mt-1 text-[10px]" style={{ color: theme.text.muted }}>
                        Affected: {issue.affectedNodes.join(', ')}
                      </div>
                    )}
                    {issue.suggestedFix && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: theme.primary }}>
                        <span>💡</span>
                        {issue.suggestedFix.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <Section title="Warnings" icon="⚠️" theme={theme} badge={warnings.length} defaultOpen={false}>
              <div className="space-y-2">
                {warnings.map((issue, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg"
                    style={{
                      backgroundColor: `${theme.warning}10`,
                      border: `1px solid ${theme.warning}20`,
                    }}
                  >
                    <div className="text-xs" style={{ color: theme.text.primary }}>
                      {issue.message}
                    </div>
                    {issue.affectedNodes && issue.affectedNodes.length > 0 && (
                      <div className="mt-1 text-[10px]" style={{ color: theme.text.muted }}>
                        Affected: {issue.affectedNodes.join(', ')}
                      </div>
                    )}
                    {issue.suggestedFix && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: theme.primary }}>
                        <span>💡</span>
                        {issue.suggestedFix.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Success message */}
          {!errors.length && !warnings.length && (
            <div
              className="text-center py-4 text-sm"
              style={{ color: theme.success }}
            >
              All connectivity checks passed!
            </div>
          )}

          {/* Auto-fix button */}
          {onAutoFix && hasFixes && (
            <button
              onClick={onAutoFix}
              disabled={isValidating}
              className="w-full py-2.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2"
              style={{
                backgroundColor: `${theme.primary}15`,
                border: `1px solid ${theme.primary}40`,
                color: theme.primary,
              }}
            >
              <span>🔧</span>
              Auto-fix Issues
            </button>
          )}
        </div>
      )}

      {/* Help section */}
      <Section title="Validation Checks" icon="ℹ️" theme={theme} defaultOpen={false}>
        <ul className="space-y-1.5 text-[11px]" style={{ color: theme.text.muted }}>
          <li className="flex items-start gap-2">
            <span style={{ color: theme.success }}>✓</span>
            <span>All main bases can reach each other</span>
          </li>
          <li className="flex items-start gap-2">
            <span style={{ color: theme.success }}>✓</span>
            <span>Natural expansions are accessible</span>
          </li>
          <li className="flex items-start gap-2">
            <span style={{ color: theme.success }}>✓</span>
            <span>No important bases are isolated</span>
          </li>
          <li className="flex items-start gap-2">
            <span style={{ color: theme.success }}>✓</span>
            <span>Ramps connect elevation differences</span>
          </li>
        </ul>
      </Section>
    </div>
  );
}

// Selected object properties panel
function SelectedObjectPanel({
  config,
  state,
  onPropertyUpdate,
  onRemove,
}: {
  config: EditorConfig;
  state: EditorState;
  onPropertyUpdate: (id: string, key: string, value: unknown) => void;
  onRemove: (id: string) => void;
}) {
  const theme = config.theme;

  if (state.selectedObjects.length === 0 || !state.mapData) return null;

  const selectedId = state.selectedObjects[0];
  const selectedObj = state.mapData.objects.find((o) => o.id === selectedId);
  if (!selectedObj) return null;

  const objType = config.objectTypes.find((t) => t.id === selectedObj.type);
  if (!objType) return null;

  const properties = objType.properties || [];

  return (
    <div
      className="border-t p-3 space-y-3"
      style={{ borderColor: theme.border, backgroundColor: theme.surface }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{objType.icon}</span>
          <div>
            <div className="text-sm font-medium" style={{ color: theme.text.primary }}>
              {objType.name}
            </div>
            <div className="text-[10px] font-mono" style={{ color: theme.text.muted }}>
              ({Math.round(selectedObj.x)}, {Math.round(selectedObj.y)})
            </div>
          </div>
        </div>
        <button
          onClick={() => onRemove(selectedId)}
          className="px-2 py-1 rounded text-xs transition-colors hover:bg-white/10"
          style={{ color: theme.error }}
        >
          Delete
        </button>
      </div>

      {/* Properties */}
      {properties.length > 0 && (
        <div className="space-y-3">
          {properties.map((prop) => {
            const currentValue = selectedObj.properties?.[prop.key] ?? prop.defaultValue;

            if (prop.type === 'number') {
              return (
                <Slider
                  key={prop.key}
                  label={prop.name}
                  value={currentValue as number}
                  min={prop.min ?? 0}
                  max={prop.max ?? 100}
                  onChange={(v) => onPropertyUpdate(selectedId, prop.key, v)}
                  theme={theme}
                />
              );
            }

            if (prop.type === 'select' && prop.options) {
              return (
                <div key={prop.key}>
                  <label className="text-[10px] uppercase tracking-wider" style={{ color: theme.text.muted }}>
                    {prop.name}
                  </label>
                  <select
                    value={currentValue as string}
                    onChange={(e) => onPropertyUpdate(selectedId, prop.key, e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg text-sm"
                    style={{
                      backgroundColor: theme.background,
                      border: `1px solid ${theme.border}`,
                      color: theme.text.primary,
                    }}
                  >
                    {prop.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            return null;
          })}
        </div>
      )}

      {/* Multi-selection indicator */}
      {state.selectedObjects.length > 1 && (
        <div
          className="text-xs italic pt-2 border-t"
          style={{ color: theme.text.muted, borderColor: theme.border }}
        >
          +{state.selectedObjects.length - 1} more selected
        </div>
      )}
    </div>
  );
}

// Keyboard shortcuts footer
function ShortcutsFooter({ theme }: { theme: EditorConfig['theme'] }) {
  return (
    <div
      className="flex-shrink-0 px-3 py-2 border-t"
      style={{ borderColor: theme.border, backgroundColor: theme.surface }}
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]" style={{ color: theme.text.muted }}>
        <span>
          <kbd
            className="px-1 py-0.5 rounded font-mono"
            style={{ backgroundColor: theme.background }}
          >
            B
          </kbd>{' '}
          Brush
        </span>
        <span>
          <kbd
            className="px-1 py-0.5 rounded font-mono"
            style={{ backgroundColor: theme.background }}
          >
            G
          </kbd>{' '}
          Fill
        </span>
        <span>
          <kbd
            className="px-1 py-0.5 rounded font-mono"
            style={{ backgroundColor: theme.background }}
          >
            0-5
          </kbd>{' '}
          Elev
        </span>
        <span>
          <kbd
            className="px-1 py-0.5 rounded font-mono"
            style={{ backgroundColor: theme.background }}
          >
            [ ]
          </kbd>{' '}
          Size
        </span>
      </div>
    </div>
  );
}

// Main panels component
export function EditorPanels({
  config,
  state,
  visibility,
  onToolSelect,
  onElevationSelect,
  onFeatureSelect,
  onMaterialSelect,
  onBrushSizeChange,
  onPanelChange,
  onBiomeChange,
  onObjectAdd,
  onObjectRemove,
  onObjectPropertyUpdate,
  onMetadataUpdate,
  onValidate,
  onAutoFix,
  validationResult,
  onToggleLabels,
  onToggleGrid,
  onToggleCategory,
  onMouseEnter,
  onMouseLeave,
}: EditorPanelsProps) {
  const theme = config.theme;

  return (
    <div
      className="w-72 flex-shrink-0 flex flex-col border-l"
      style={{
        backgroundColor: theme.surface,
        borderColor: theme.border,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Panel tabs */}
      <div
        className="flex-shrink-0 flex border-b"
        style={{ borderColor: theme.border }}
      >
        {config.panels.map((panel) => (
          <PanelTab
            key={panel.id}
            active={state.activePanel === panel.id}
            onClick={() => onPanelChange(panel.id)}
            icon={panel.icon}
            name={panel.name}
            theme={theme}
          />
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto p-3">
        {state.activePanel === 'paint' && (
          <PaintPanel
            config={config}
            state={state}
            onToolSelect={onToolSelect}
            onElevationSelect={onElevationSelect}
            onFeatureSelect={onFeatureSelect}
            onMaterialSelect={onMaterialSelect}
            onBrushSizeChange={onBrushSizeChange}
          />
        )}
        {state.activePanel === 'bases' && (
          <ObjectsPanel
            config={config}
            state={state}
            category="bases"
            onObjectAdd={onObjectAdd}
            onObjectRemove={onObjectRemove}
          />
        )}
        {state.activePanel === 'objects' && (
          <ObjectsPanel
            config={config}
            state={state}
            category="objects"
            onObjectAdd={onObjectAdd}
            onObjectRemove={onObjectRemove}
          />
        )}
        {state.activePanel === 'decorations' && (
          <ObjectsPanel
            config={config}
            state={state}
            category="decorations"
            onObjectAdd={onObjectAdd}
            onObjectRemove={onObjectRemove}
          />
        )}
        {state.activePanel === 'settings' && (
          <SettingsPanel
            config={config}
            state={state}
            visibility={visibility}
            onBiomeChange={onBiomeChange}
            onMetadataUpdate={onMetadataUpdate}
            onToggleLabels={onToggleLabels}
            onToggleGrid={onToggleGrid}
            onToggleCategory={onToggleCategory}
          />
        )}
        {state.activePanel === 'validate' && (
          <ValidatePanel
            config={config}
            validationResult={validationResult}
            onValidate={onValidate}
            onAutoFix={onAutoFix}
          />
        )}
      </div>

      {/* Selected object properties */}
      <SelectedObjectPanel
        config={config}
        state={state}
        onPropertyUpdate={onObjectPropertyUpdate}
        onRemove={onObjectRemove}
      />

      {/* Keyboard shortcuts footer */}
      <ShortcutsFooter theme={theme} />
    </div>
  );
}

export default EditorPanels;
