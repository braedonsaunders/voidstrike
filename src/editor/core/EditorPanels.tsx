/**
 * EditorPanels - Right sidebar with tools and settings
 */

'use client';

import type {
  EditorConfig,
  EditorState,
  EditorObject,
  EditorMapData,
} from '../config/EditorConfig';

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
  onMetadataUpdate: (updates: Partial<Pick<EditorMapData, 'name' | 'width' | 'height' | 'biomeId'>>) => void;
  onValidate: () => void;
  onToggleLabels: () => void;
  onToggleGrid: () => void;
  onToggleCategory: (category: string) => void;
}

// Tab button component
function PanelTab({
  active,
  onClick,
  children,
  theme,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  theme: EditorConfig['theme'];
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-2 text-xs font-medium transition-colors border-b-2"
      style={{
        color: active ? theme.text.primary : theme.text.muted,
        borderColor: active ? theme.primary : 'transparent',
      }}
    >
      {children}
    </button>
  );
}

// Slider component
function Slider({
  label,
  value,
  min,
  max,
  onChange,
  theme,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  theme: EditorConfig['theme'];
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span style={{ color: theme.text.muted }}>{label}</span>
        <span className="font-mono" style={{ color: theme.text.secondary }}>
          {value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
        style={{ backgroundColor: theme.border }}
      />
    </div>
  );
}

// Icon button component
function IconButton({
  active,
  onClick,
  title,
  children,
  theme,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  theme: EditorConfig['theme'];
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150"
      style={{
        backgroundColor: active ? theme.primary : theme.surface,
        color: active ? theme.text.primary : theme.text.muted,
        boxShadow: active ? `0 0 10px ${theme.primary}50` : 'none',
      }}
    >
      {children}
    </button>
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
  const activeTool = config.tools.find((t) => t.id === state.activeTool);
  const materials = config.terrain.materials;

  return (
    <div className="space-y-4">
      {/* Tools */}
      <div>
        <div className="text-xs mb-2" style={{ color: config.theme.text.muted }}>
          Tools
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {config.tools.map((tool) => (
            <IconButton
              key={tool.id}
              active={state.activeTool === tool.id}
              onClick={() => onToolSelect(tool.id)}
              title={`${tool.name} (${tool.shortcut})`}
              theme={config.theme}
            >
              {tool.icon}
            </IconButton>
          ))}
        </div>
      </div>

      {/* Brush size */}
      {activeTool?.hasBrushSize && (
        <Slider
          label="Brush Size"
          value={state.brushSize}
          min={activeTool.minBrushSize || 1}
          max={activeTool.maxBrushSize || 20}
          onChange={onBrushSizeChange}
          theme={config.theme}
        />
      )}

      {/* Elevation palette */}
      <div>
        <div className="text-xs mb-2" style={{ color: config.theme.text.muted }}>
          Elevation
        </div>
        <div className="space-y-1">
          {config.terrain.elevations.map((elev) => (
            <button
              key={elev.id}
              onClick={() => onElevationSelect(elev.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors"
              style={{
                backgroundColor:
                  state.selectedElevation === elev.id ? config.theme.primary + '40' : config.theme.surface,
                color:
                  state.selectedElevation === elev.id ? config.theme.text.primary : config.theme.text.muted,
              }}
            >
              <div
                className="w-4 h-4 rounded border"
                style={{
                  backgroundColor: elev.color,
                  borderColor: config.theme.border,
                }}
              />
              <span className="text-xs flex-1 text-left">{elev.name}</span>
              {elev.shortcut && (
                <span className="text-[10px]" style={{ color: config.theme.text.muted }}>
                  {elev.shortcut}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Materials / Textures */}
      {materials && materials.length > 0 && (
        <div>
          <div className="text-xs mb-2" style={{ color: config.theme.text.muted }}>
            Material
          </div>
          <div className="space-y-1">
            {materials.map((mat) => (
              <button
                key={mat.id}
                onClick={() => onMaterialSelect(mat.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors"
                style={{
                  backgroundColor:
                    state.selectedMaterial === mat.id ? config.theme.primary + '40' : config.theme.surface,
                  color:
                    state.selectedMaterial === mat.id ? config.theme.text.primary : config.theme.text.muted,
                }}
              >
                <span className="text-sm">{mat.icon}</span>
                <span className="text-xs flex-1 text-left">{mat.name}</span>
                {mat.shortcut && (
                  <span className="text-[10px]" style={{ color: config.theme.text.muted }}>
                    {mat.shortcut}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Features */}
      <div>
        <div className="text-xs mb-2" style={{ color: config.theme.text.muted }}>
          Features
        </div>
        <div className="grid grid-cols-2 gap-1">
          {config.terrain.features.map((feature) => (
            <button
              key={feature.id}
              onClick={() => onFeatureSelect(feature.id)}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
              style={{
                backgroundColor:
                  state.selectedFeature === feature.id ? config.theme.primary + '40' : config.theme.surface,
                color:
                  state.selectedFeature === feature.id
                    ? config.theme.text.primary
                    : config.theme.text.muted,
              }}
            >
              <span>{feature.icon}</span>
              <span className="truncate">{feature.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Objects panel
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
  const categoryObjects = config.objectTypes.filter((t) => t.category === category);
  const placedObjects = state.mapData?.objects.filter((obj) => {
    const objType = config.objectTypes.find((t) => t.id === obj.type);
    return objType?.category === category;
  }) || [];

  const handleAddObject = (typeId: string) => {
    if (!state.mapData) return;
    const objType = config.objectTypes.find((t) => t.id === typeId);
    if (!objType) return;

    // Place at center of map
    onObjectAdd({
      type: typeId,
      x: Math.floor(state.mapData.width / 2),
      y: Math.floor(state.mapData.height / 2),
      radius: objType.defaultRadius,
      properties: {},
    });
  };

  return (
    <div className="space-y-4">
      {/* Add buttons */}
      <div>
        <div className="text-xs mb-2" style={{ color: config.theme.text.muted }}>
          Add {category}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {categoryObjects.map((objType) => (
            <button
              key={objType.id}
              onClick={() => handleAddObject(objType.id)}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors"
              style={{
                backgroundColor: config.theme.surface,
                color: config.theme.text.secondary,
                border: `1px dashed ${config.theme.border}`,
              }}
            >
              <span>{objType.icon}</span>
              <span className="truncate">{objType.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Placed objects list */}
      <div>
        <div className="text-xs mb-2" style={{ color: config.theme.text.muted }}>
          Placed ({placedObjects.length})
        </div>
        <div className="space-y-1">
          {placedObjects.map((obj) => {
            const objType = config.objectTypes.find((t) => t.id === obj.type);
            if (!objType) return null;

            return (
              <div
                key={obj.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded"
                style={{
                  backgroundColor: state.selectedObjects.includes(obj.id)
                    ? config.theme.primary + '30'
                    : config.theme.surface,
                }}
              >
                <span>{objType.icon}</span>
                <div className="flex-1">
                  <div className="text-xs" style={{ color: config.theme.text.primary }}>
                    {objType.name}
                  </div>
                  <div className="text-[10px] font-mono" style={{ color: config.theme.text.muted }}>
                    {Math.floor(obj.x)}, {Math.floor(obj.y)}
                  </div>
                </div>
                <button
                  onClick={() => onObjectRemove(obj.id)}
                  className="w-5 h-5 rounded flex items-center justify-center text-xs transition-colors"
                  style={{ color: config.theme.error }}
                >
                  ✕
                </button>
              </div>
            );
          })}
          {placedObjects.length === 0 && (
            <div className="text-xs italic" style={{ color: config.theme.text.muted }}>
              No {category} placed
            </div>
          )}
        </div>
      </div>
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
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-xs" style={{ color: theme.text.secondary }}>{label}</span>
      <button
        onClick={onChange}
        className="w-8 h-4 rounded-full relative transition-colors"
        style={{
          backgroundColor: checked ? theme.primary : theme.border,
        }}
      >
        <span
          className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
          style={{
            left: checked ? '17px' : '2px',
          }}
        />
      </button>
    </label>
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
  if (!state.mapData) return null;

  // Get unique categories
  const categories = Array.from(new Set(config.objectTypes.map((t) => t.category)));

  return (
    <div className="space-y-4">
      {/* Visibility toggles */}
      <div>
        <div className="text-xs mb-2" style={{ color: config.theme.text.muted }}>
          Visibility
        </div>
        <div className="space-y-2 p-2 rounded" style={{ backgroundColor: config.theme.background }}>
          <ToggleSwitch
            checked={visibility.labels}
            onChange={onToggleLabels}
            label="Labels"
            theme={config.theme}
          />
          <ToggleSwitch
            checked={visibility.grid}
            onChange={onToggleGrid}
            label="Grid"
            theme={config.theme}
          />
          <div className="border-t my-2" style={{ borderColor: config.theme.border }} />
          <div className="text-[10px] mb-1" style={{ color: config.theme.text.muted }}>Categories</div>
          {categories.map((category) => (
            <ToggleSwitch
              key={category}
              checked={visibility.categories[category] ?? true}
              onChange={() => onToggleCategory(category)}
              label={category.charAt(0).toUpperCase() + category.slice(1)}
              theme={config.theme}
            />
          ))}
        </div>
      </div>

      {/* Map info */}
      <div>
        <div className="text-xs mb-2" style={{ color: config.theme.text.muted }}>
          Map Info
        </div>
        <div className="space-y-2">
          <div>
            <label className="text-[10px]" style={{ color: config.theme.text.muted }}>
              Name
            </label>
            <input
              type="text"
              value={state.mapData.name}
              onChange={(e) => onMetadataUpdate({ name: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 rounded text-xs"
              style={{
                backgroundColor: config.theme.surface,
                border: `1px solid ${config.theme.border}`,
                color: config.theme.text.primary,
              }}
            />
          </div>
        </div>
      </div>

      {/* Canvas size */}
      <div>
        <div className="text-xs mb-2" style={{ color: config.theme.text.muted }}>
          Canvas Size
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px]" style={{ color: config.theme.text.muted }}>
              Width
            </label>
            <input
              type="number"
              value={state.mapData.width}
              onChange={(e) => onMetadataUpdate({ width: Number(e.target.value) })}
              className="w-full mt-1 px-2 py-1.5 rounded text-xs"
              style={{
                backgroundColor: config.theme.surface,
                border: `1px solid ${config.theme.border}`,
                color: config.theme.text.primary,
              }}
            />
          </div>
          <div>
            <label className="text-[10px]" style={{ color: config.theme.text.muted }}>
              Height
            </label>
            <input
              type="number"
              value={state.mapData.height}
              onChange={(e) => onMetadataUpdate({ height: Number(e.target.value) })}
              className="w-full mt-1 px-2 py-1.5 rounded text-xs"
              style={{
                backgroundColor: config.theme.surface,
                border: `1px solid ${config.theme.border}`,
                color: config.theme.text.primary,
              }}
            />
          </div>
        </div>
      </div>

      {/* Biome selection */}
      <div>
        <div className="text-xs mb-2" style={{ color: config.theme.text.muted }}>
          Biome
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {config.biomes.map((biome) => (
            <button
              key={biome.id}
              onClick={() => onBiomeChange(biome.id)}
              className="px-2 py-1.5 rounded text-xs transition-colors"
              style={{
                backgroundColor:
                  state.activeBiome === biome.id ? config.theme.primary : config.theme.surface,
                color:
                  state.activeBiome === biome.id ? config.theme.text.primary : config.theme.text.muted,
              }}
            >
              {biome.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Validate panel
function ValidatePanel({
  config,
  onValidate,
}: {
  config: EditorConfig;
  onValidate: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="text-xs mb-2" style={{ color: config.theme.text.muted }}>
        Connectivity Validation
      </div>

      <button
        onClick={onValidate}
        className="w-full py-2.5 rounded text-sm font-medium transition-colors"
        style={{
          backgroundColor: config.theme.primary,
          color: config.theme.text.primary,
        }}
      >
        Validate Map
      </button>

      <div className="text-[10px]" style={{ color: config.theme.text.muted }}>
        Validates that all main bases are connected via walkable paths and that natural expansions are
        reachable.
      </div>

      <button
        className="w-full py-2 rounded text-xs transition-colors"
        style={{
          border: `1px solid ${config.theme.border}`,
          color: config.theme.text.secondary,
        }}
      >
        Auto-fix Issues
      </button>
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
  onMetadataUpdate,
  onValidate,
  onToggleLabels,
  onToggleGrid,
  onToggleCategory,
}: EditorPanelsProps) {
  return (
    <div
      className="w-64 flex-shrink-0 flex flex-col border-l"
      style={{
        backgroundColor: config.theme.surface,
        borderColor: config.theme.border,
      }}
    >
      {/* Panel tabs */}
      <div className="flex-shrink-0 flex border-b" style={{ borderColor: config.theme.border }}>
        {config.panels.map((panel) => (
          <PanelTab
            key={panel.id}
            active={state.activePanel === panel.id}
            onClick={() => onPanelChange(panel.id)}
            theme={config.theme}
          >
            {panel.name}
          </PanelTab>
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
        {state.activePanel === 'validate' && <ValidatePanel config={config} onValidate={onValidate} />}
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="flex-shrink-0 p-3 border-t" style={{ borderColor: config.theme.border }}>
        <div className="text-[10px] space-y-0.5" style={{ color: config.theme.text.muted }}>
          <div>
            <kbd
              className="px-1 rounded"
              style={{ backgroundColor: config.theme.background }}
            >
              B
            </kbd>{' '}
            Brush •{' '}
            <kbd
              className="px-1 rounded"
              style={{ backgroundColor: config.theme.background }}
            >
              G
            </kbd>{' '}
            Fill •{' '}
            <kbd
              className="px-1 rounded"
              style={{ backgroundColor: config.theme.background }}
            >
              P
            </kbd>{' '}
            Plateau
          </div>
          <div>
            <kbd
              className="px-1 rounded"
              style={{ backgroundColor: config.theme.background }}
            >
              0-5
            </kbd>{' '}
            Elevation •{' '}
            <kbd
              className="px-1 rounded"
              style={{ backgroundColor: config.theme.background }}
            >
              Scroll
            </kbd>{' '}
            Zoom
          </div>
          <div>
            <kbd
              className="px-1 rounded"
              style={{ backgroundColor: config.theme.background }}
            >
              Arrows
            </kbd>{' '}
            Pan •{' '}
            <kbd
              className="px-1 rounded"
              style={{ backgroundColor: config.theme.background }}
            >
              Mid-Drag
            </kbd>{' '}
            Rotate
          </div>
        </div>
      </div>
    </div>
  );
}

export default EditorPanels;
