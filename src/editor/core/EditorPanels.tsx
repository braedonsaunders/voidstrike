/**
 * EditorPanels - Professional right sidebar
 *
 * Modern panel system with collapsible sections, card-based layout,
 * and polished styling. Organized for efficient workflow.
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import type {
  EditorConfig,
  EditorState,
  EditorObject,
  EditorMapData,
  ToolConfig,
} from '../config/EditorConfig';
import type { DetailedValidationResult } from './EditorCore';
import type { MapData } from '@/data/maps/MapTypes';
import { AIGeneratePanel } from '../panels/AIGeneratePanel';
import {
  generateBorderDecorations,
  clearBorderDecorations,
  countBorderDecorations,
  type BorderDecorationStyle,
  type BorderDecorationSettings,
  DEFAULT_BORDER_SETTINGS,
} from '../utils/borderDecorations';

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
  onAIMapGenerated?: (mapData: MapData) => void;
  onUpdateObjects?: (objects: EditorObject[]) => void;
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
  ai: '🪄',
  paint: '🎨',
  bases: '🏰',
  objects: '📦',
  decorations: '🌿',
  settings: '⚙️',
  validate: '✓',
};

// Collapsible section component with smooth animation
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
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | 'auto'>('auto');

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [children, isOpen]);

  return (
    <div
      className="rounded-lg overflow-hidden transition-all duration-200"
      style={{
        backgroundColor: theme.background,
        border: `1px solid ${theme.border}40`,
      }}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/5 transition-all duration-200 group"
      >
        <span
          className="text-[10px] transition-transform duration-300 ease-out"
          style={{
            color: theme.text.muted,
            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ▶
        </span>
        {icon && <span className="text-sm transition-transform duration-200 group-hover:scale-110">{icon}</span>}
        <span className="text-xs font-medium flex-1 text-left" style={{ color: theme.text.secondary }}>
          {title}
        </span>
        {badge !== undefined && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full transition-all duration-200 group-hover:scale-105"
            style={{
              backgroundColor: `${theme.primary}30`,
              color: theme.primary,
            }}
          >
            {badge}
          </span>
        )}
      </button>
      <div
        className="overflow-hidden transition-all duration-300 ease-out"
        style={{
          maxHeight: isOpen ? contentHeight : 0,
          opacity: isOpen ? 1 : 0,
        }}
      >
        <div ref={contentRef} className="px-3 pb-3">
          {children}
        </div>
      </div>
    </div>
  );
}

// Modern panel tab with animated indicator
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
        relative px-3 py-2.5 flex items-center justify-center gap-1.5 transition-all duration-200
        ${active ? '' : 'hover:bg-white/5'}
      `}
      style={{
        color: active ? theme.primary : theme.text.muted,
      }}
    >
      <span
        className="text-base transition-transform duration-200"
        style={{
          transform: active ? 'scale(1.15)' : 'scale(1)',
        }}
      >
        {icon || PANEL_ICONS[name.toLowerCase()] || name.charAt(0)}
      </span>
      {/* Animated underline indicator */}
      <div
        className="absolute bottom-0 left-1/2 h-0.5 rounded-full transition-all duration-300 ease-out"
        style={{
          backgroundColor: theme.primary,
          width: active ? '24px' : '0px',
          transform: 'translateX(-50%)',
          opacity: active ? 1 : 0,
        }}
      />
      {/* Hover glow effect */}
      <div
        className="absolute inset-0 rounded-md transition-opacity duration-200 pointer-events-none"
        style={{
          background: `radial-gradient(circle at center, ${theme.primary}15 0%, transparent 70%)`,
          opacity: active ? 1 : 0,
        }}
      />
    </button>
  );
}

// Slider with visual feedback and premium animations
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
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div className="space-y-1.5 group">
      <div className="flex justify-between items-center">
        <span className="text-[11px]" style={{ color: theme.text.muted }}>{label}</span>
        {showValue && (
          <span
            className="text-[11px] font-mono px-1.5 py-0.5 rounded transition-all duration-200"
            style={{
              backgroundColor: isDragging ? `${theme.primary}20` : theme.surface,
              color: isDragging ? theme.primary : theme.text.secondary,
              transform: isDragging ? 'scale(1.05)' : 'scale(1)',
            }}
          >
            {value}
          </span>
        )}
      </div>
      <div
        className="relative h-1.5 rounded-full transition-all duration-200"
        style={{
          backgroundColor: theme.border,
          height: isDragging ? '8px' : '6px',
        }}
      >
        {/* Track fill */}
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all duration-150"
          style={{
            width: `${percentage}%`,
            backgroundColor: theme.primary,
            boxShadow: isDragging ? `0 0 8px ${theme.primary}60` : 'none',
          }}
        />
        {/* Thumb indicator */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full bg-white transition-all duration-200 pointer-events-none"
          style={{
            left: `${percentage}%`,
            transform: `translateX(-50%) translateY(-50%) scale(${isDragging ? 1.3 : 1})`,
            width: isDragging ? '14px' : '10px',
            height: isDragging ? '14px' : '10px',
            boxShadow: `0 2px 6px rgba(0,0,0,0.3)`,
            opacity: isDragging ? 1 : 0,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
          onTouchStart={() => setIsDragging(true)}
          onTouchEnd={() => setIsDragging(false)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
}

// Tool grid with category support and premium animations
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
      {tools.map((tool) => {
        const isActive = activeTool === tool.id;
        return (
          <button
            key={tool.id}
            onClick={() => onSelect(tool.id)}
            title={`${tool.name} (${tool.shortcut})`}
            className={`
              relative aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5
              transition-all duration-200 ease-out group
              ${isActive ? 'ring-2' : 'hover:bg-white/5'}
            `}
            style={{
              backgroundColor: isActive ? `${theme.primary}20` : theme.surface,
              '--tw-ring-color': theme.primary,
              color: isActive ? theme.text.primary : theme.text.muted,
              transform: isActive ? 'scale(1.05)' : 'scale(1)',
            } as React.CSSProperties}
          >
            <span
              className="text-base transition-transform duration-200 group-hover:scale-110"
              style={{ transform: isActive ? 'scale(1.1)' : undefined }}
            >
              {tool.icon}
            </span>
            <span className="text-[9px] leading-tight truncate max-w-full px-1">{tool.name}</span>
            {/* Active glow effect */}
            {isActive && (
              <div
                className="absolute inset-0 rounded-lg pointer-events-none"
                style={{
                  boxShadow: `0 0 12px ${theme.primary}40`,
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// Elevation palette - compact color swatches with premium animations
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
        {elevations.map((elev) => {
          const isSelected = selected === elev.id;
          return (
            <button
              key={elev.id}
              onClick={() => onSelect(elev.id)}
              title={`${elev.name} (${elev.shortcut || elev.id})`}
              className={`
                w-8 h-8 rounded-md border-2 transition-all duration-200 ease-out relative group
                ${isSelected ? 'ring-2 ring-offset-1' : 'hover:scale-110'}
              `}
              style={{
                backgroundColor: elev.color,
                borderColor: isSelected ? '#fff' : 'transparent',
                '--tw-ring-color': theme.primary,
                '--tw-ring-offset-color': theme.background,
                transform: isSelected ? 'scale(1.15)' : undefined,
                boxShadow: isSelected ? `0 0 12px ${elev.color}80` : undefined,
              } as React.CSSProperties}
            >
              {elev.shortcut && (
                <span
                  className="absolute -bottom-0.5 -right-0.5 text-[8px] w-3 h-3 rounded flex items-center justify-center transition-transform duration-200 group-hover:scale-110"
                  style={{
                    backgroundColor: theme.background,
                    color: theme.text.muted,
                  }}
                >
                  {elev.shortcut}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* Selected elevation info with fade transition */}
      {elevations.find((e) => e.id === selected) && (
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded-md transition-all duration-200"
          style={{ backgroundColor: theme.surface }}
        >
          <div
            className="w-3 h-3 rounded transition-colors duration-200"
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

// Feature buttons with premium animations
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
      {features.map((feature) => {
        const isSelected = selected === feature.id;
        return (
          <button
            key={feature.id}
            onClick={() => onSelect(feature.id)}
            className={`
              flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-all duration-200 ease-out group
              ${isSelected ? 'ring-1' : 'hover:bg-white/5 hover:scale-105'}
            `}
            style={{
              backgroundColor: isSelected ? `${theme.primary}20` : theme.surface,
              '--tw-ring-color': theme.primary,
              color: isSelected ? theme.text.primary : theme.text.muted,
              transform: isSelected ? 'scale(1.02)' : undefined,
            } as React.CSSProperties}
          >
            <span className="transition-transform duration-200 group-hover:scale-110">{feature.icon}</span>
            <span className="truncate">{feature.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// Material selector with premium animations
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
      {materials.map((mat) => {
        const isSelected = selected === mat.id;
        return (
          <button
            key={mat.id}
            onClick={() => onSelect(mat.id)}
            className={`
              flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-all duration-200 ease-out group
              ${isSelected ? 'ring-1' : 'hover:bg-white/5 hover:scale-105'}
            `}
            style={{
              backgroundColor: isSelected ? `${theme.primary}20` : theme.surface,
              '--tw-ring-color': theme.primary,
              color: isSelected ? theme.text.primary : theme.text.muted,
              transform: isSelected ? 'scale(1.02)' : undefined,
            } as React.CSSProperties}
          >
            <span className="transition-transform duration-200 group-hover:scale-110">{mat.icon}</span>
            <span className="flex-1 truncate text-left">{mat.name}</span>
            {mat.shortcut && (
              <span className="text-[10px] opacity-50 transition-opacity duration-200 group-hover:opacity-100">{mat.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Toggle switch component with premium animations
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
    <label className="flex items-center justify-between cursor-pointer py-0.5 group">
      <span
        className="text-xs transition-colors duration-200"
        style={{ color: checked ? theme.text.primary : theme.text.secondary }}
      >
        {label}
      </span>
      <button
        onClick={onChange}
        className="w-9 h-5 rounded-full relative transition-all duration-300 ease-out"
        style={{
          backgroundColor: checked ? theme.primary : theme.border,
          boxShadow: checked ? `0 0 8px ${theme.primary}50` : 'none',
        }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ease-out"
          style={{
            left: checked ? '18px' : '2px',
            transform: checked ? 'scale(1.05)' : 'scale(1)',
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

// Objects panel (generic for bases, objects, decorations) with premium animations
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
              className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-all duration-200 ease-out hover:scale-105 group"
              style={{
                backgroundColor: theme.surface,
                color: theme.text.secondary,
                border: `1px dashed ${theme.border}`,
              }}
            >
              <span className="text-base transition-transform duration-200 group-hover:scale-110">{objType.icon}</span>
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
                    flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all duration-200 ease-out group
                    ${isSelected ? 'ring-1' : 'hover:translate-x-1'}
                  `}
                  style={{
                    backgroundColor: isSelected ? `${theme.primary}20` : theme.surface,
                    '--tw-ring-color': theme.primary,
                    boxShadow: isSelected ? `0 0 12px ${theme.primary}30` : undefined,
                  } as React.CSSProperties}
                >
                  <span className="text-sm transition-transform duration-200 group-hover:scale-110">{objType.icon}</span>
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
                    className="w-6 h-6 rounded flex items-center justify-center transition-all duration-200 hover:bg-white/10 hover:scale-110 opacity-0 group-hover:opacity-100"
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
  onUpdateObjects,
}: {
  config: EditorConfig;
  state: EditorState;
  visibility: { labels: boolean; grid: boolean; categories: Record<string, boolean> };
  onBiomeChange: (biomeId: string) => void;
  onMetadataUpdate: (updates: Partial<Pick<EditorMapData, 'name' | 'width' | 'height' | 'biomeId'>>) => void;
  onToggleLabels: () => void;
  onToggleGrid: () => void;
  onToggleCategory: (category: string) => void;
  onUpdateObjects?: (objects: EditorObject[]) => void;
}) {
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
                    className={`
                      px-2 py-1.5 rounded text-[11px] transition-all capitalize
                      ${borderStyle === style ? 'ring-1' : 'hover:bg-white/5'}
                    `}
                    style={{
                      backgroundColor: borderStyle === style ? `${theme.primary}20` : theme.surface,
                      color: borderStyle === style ? theme.text.primary : theme.text.muted,
                      '--tw-ring-color': theme.primary,
                    } as React.CSSProperties}
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
      {/* Validate button with premium animation */}
      <button
        onClick={onValidate}
        disabled={isValidating}
        className="w-full py-3 rounded-lg text-sm font-medium transition-all duration-300 ease-out flex items-center justify-center gap-2 group hover:scale-[1.02] active:scale-[0.98]"
        style={{
          backgroundColor: theme.primary,
          color: '#fff',
          opacity: isValidating ? 0.7 : 1,
          boxShadow: isValidating
            ? `0 2px 12px ${theme.primary}40`
            : `0 4px 16px ${theme.primary}50`,
        }}
      >
        {isValidating ? (
          <>
            <span className="animate-spin">⟳</span>
            Validating...
          </>
        ) : (
          <>
            <span className="transition-transform duration-200 group-hover:scale-125">✓</span>
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

// Animated panel content wrapper
function AnimatedPanelContent({
  isActive,
  children,
}: {
  isActive: boolean;
  children: React.ReactNode;
}) {
  const [shouldRender, setShouldRender] = useState(isActive);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isActive) {
      setShouldRender(true);
      // Small delay to trigger CSS transition
      requestAnimationFrame(() => {
        setIsAnimating(true);
      });
    } else {
      setIsAnimating(false);
      // Wait for animation to complete before unmounting
      const timer = setTimeout(() => setShouldRender(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isActive]);

  if (!shouldRender) return null;

  return (
    <div
      className="transition-all duration-200 ease-out"
      style={{
        opacity: isAnimating && isActive ? 1 : 0,
        transform: isAnimating && isActive ? 'translateY(0)' : 'translateY(8px)',
      }}
    >
      {children}
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
  onAIMapGenerated,
  onUpdateObjects,
}: EditorPanelsProps) {
  const theme = config.theme;

  return (
    <div
      className="w-full h-full flex flex-col"
      style={{
        backgroundColor: theme.surface,
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

      {/* Panel content with animated transitions */}
      <div className="flex-1 overflow-y-auto p-3 relative">
        <AnimatedPanelContent isActive={state.activePanel === 'ai'}>
          {onAIMapGenerated && (
            <AIGeneratePanel
              config={config}
              onMapGenerated={onAIMapGenerated}
            />
          )}
        </AnimatedPanelContent>
        <AnimatedPanelContent isActive={state.activePanel === 'paint'}>
          <PaintPanel
            config={config}
            state={state}
            onToolSelect={onToolSelect}
            onElevationSelect={onElevationSelect}
            onFeatureSelect={onFeatureSelect}
            onMaterialSelect={onMaterialSelect}
            onBrushSizeChange={onBrushSizeChange}
          />
        </AnimatedPanelContent>
        <AnimatedPanelContent isActive={state.activePanel === 'bases'}>
          <ObjectsPanel
            config={config}
            state={state}
            category="bases"
            onObjectAdd={onObjectAdd}
            onObjectRemove={onObjectRemove}
          />
        </AnimatedPanelContent>
        <AnimatedPanelContent isActive={state.activePanel === 'objects'}>
          <ObjectsPanel
            config={config}
            state={state}
            category="objects"
            onObjectAdd={onObjectAdd}
            onObjectRemove={onObjectRemove}
          />
        </AnimatedPanelContent>
        <AnimatedPanelContent isActive={state.activePanel === 'decorations'}>
          <ObjectsPanel
            config={config}
            state={state}
            category="decorations"
            onObjectAdd={onObjectAdd}
            onObjectRemove={onObjectRemove}
          />
        </AnimatedPanelContent>
        <AnimatedPanelContent isActive={state.activePanel === 'settings'}>
          <SettingsPanel
            config={config}
            state={state}
            visibility={visibility}
            onBiomeChange={onBiomeChange}
            onMetadataUpdate={onMetadataUpdate}
            onToggleLabels={onToggleLabels}
            onToggleGrid={onToggleGrid}
            onToggleCategory={onToggleCategory}
            onUpdateObjects={onUpdateObjects}
          />
        </AnimatedPanelContent>
        <AnimatedPanelContent isActive={state.activePanel === 'validate'}>
          <ValidatePanel
            config={config}
            validationResult={validationResult}
            onValidate={onValidate}
            onAutoFix={onAutoFix}
          />
        </AnimatedPanelContent>
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
