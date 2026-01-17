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

// Tab button component with icon
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
      className="px-3 py-2 text-base transition-colors border-b-2 flex-shrink-0"
      style={{
        color: active ? theme.text.primary : theme.text.muted,
        borderColor: active ? theme.primary : 'transparent',
      }}
    >
      {icon || name.charAt(0)}
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

    // Initialize properties with default values from config
    const defaultProperties: Record<string, unknown> = {};
    if (objType.properties) {
      for (const prop of objType.properties) {
        if (prop.defaultValue !== undefined) {
          defaultProperties[prop.key] = prop.defaultValue;
        }
      }
    }

    // Place at center of map
    onObjectAdd({
      type: typeId,
      x: Math.floor(state.mapData.width / 2),
      y: Math.floor(state.mapData.height / 2),
      radius: objType.defaultRadius,
      properties: defaultProperties,
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
          className="w-3 h-3 rounded-full bg-white transition-all absolute"
          style={{
            top: '50%',
            transform: 'translateY(-50%)',
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

// Validate panel with full results display
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
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const hasFixes = issues.some(i => i.suggestedFix);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-xs mb-2" style={{ color: theme.text.muted }}>
        Connectivity Validation
      </div>

      {/* Validate Button */}
      <button
        onClick={onValidate}
        disabled={isValidating}
        className="w-full py-2.5 rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
        style={{
          backgroundColor: theme.primary,
          color: theme.text.primary,
          opacity: isValidating ? 0.7 : 1,
        }}
      >
        {isValidating ? (
          <>
            <span className="animate-spin">⟳</span>
            Validating...
          </>
        ) : (
          <>Validate Map</>
        )}
      </button>

      {/* Description */}
      <div className="text-[10px]" style={{ color: theme.text.muted }}>
        Validates that all main bases are connected via walkable paths and that natural expansions are
        reachable.
      </div>

      {/* Validation Result */}
      {hasResult && !isValidating && (
        <div className="space-y-3">
          {/* Status Banner */}
          <div
            className="p-3 rounded-lg flex items-center gap-2"
            style={{
              backgroundColor: isValid ? `${theme.success}20` : `${theme.error}20`,
              border: `1px solid ${isValid ? theme.success : theme.error}40`,
            }}
          >
            <span className="text-lg">{isValid ? '✓' : '✗'}</span>
            <div>
              <div className="text-sm font-medium" style={{ color: isValid ? theme.success : theme.error }}>
                {isValid ? 'Validation Passed' : 'Validation Failed'}
              </div>
              <div className="text-[10px]" style={{ color: theme.text.muted }}>
                {errors.length} error{errors.length !== 1 ? 's' : ''}, {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {/* Statistics */}
          {stats && (
            <div className="p-2 rounded" style={{ backgroundColor: theme.background }}>
              <div className="text-[10px] mb-1.5" style={{ color: theme.text.muted }}>
                Connectivity Stats
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span style={{ color: theme.text.muted }}>Nodes:</span>
                  <span style={{ color: theme.text.secondary }}>{stats.totalNodes}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: theme.text.muted }}>Islands:</span>
                  <span style={{ color: stats.islandCount > 1 ? theme.warning : theme.text.secondary }}>
                    {stats.islandCount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: theme.text.muted }}>Connected:</span>
                  <span style={{ color: theme.success }}>{stats.connectedPairs}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: theme.text.muted }}>Blocked:</span>
                  <span style={{ color: stats.blockedPairs > 0 ? theme.error : theme.text.secondary }}>
                    {stats.blockedPairs}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Errors */}
          {hasErrors && (
            <div className="space-y-1.5">
              <div className="text-[10px] flex items-center gap-1" style={{ color: theme.error }}>
                <span>●</span> Errors ({errors.length})
              </div>
              <div className="space-y-1">
                {errors.map((issue, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded text-[11px]"
                    style={{
                      backgroundColor: `${theme.error}15`,
                      border: `1px solid ${theme.error}30`,
                    }}
                  >
                    <div style={{ color: theme.text.primary }}>{issue.message}</div>
                    {issue.affectedNodes && issue.affectedNodes.length > 0 && (
                      <div className="mt-1" style={{ color: theme.text.muted }}>
                        Affected: {issue.affectedNodes.join(', ')}
                      </div>
                    )}
                    {issue.suggestedFix && (
                      <div className="mt-1 flex items-center gap-1" style={{ color: theme.primary }}>
                        <span>💡</span> {issue.suggestedFix.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {hasWarnings && (
            <div className="space-y-1.5">
              <div className="text-[10px] flex items-center gap-1" style={{ color: theme.warning }}>
                <span>●</span> Warnings ({warnings.length})
              </div>
              <div className="space-y-1">
                {warnings.map((issue, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded text-[11px]"
                    style={{
                      backgroundColor: `${theme.warning}15`,
                      border: `1px solid ${theme.warning}30`,
                    }}
                  >
                    <div style={{ color: theme.text.primary }}>{issue.message}</div>
                    {issue.affectedNodes && issue.affectedNodes.length > 0 && (
                      <div className="mt-1" style={{ color: theme.text.muted }}>
                        Affected: {issue.affectedNodes.join(', ')}
                      </div>
                    )}
                    {issue.suggestedFix && (
                      <div className="mt-1 flex items-center gap-1" style={{ color: theme.primary }}>
                        <span>💡</span> {issue.suggestedFix.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No Issues */}
          {!hasErrors && !hasWarnings && (
            <div className="text-[11px] text-center py-2" style={{ color: theme.success }}>
              All connectivity checks passed!
            </div>
          )}
        </div>
      )}

      {/* Auto-fix Button */}
      {onAutoFix && (
        <button
          onClick={onAutoFix}
          disabled={isValidating || (!hasErrors && !hasFixes)}
          className="w-full py-2 rounded text-xs transition-colors flex items-center justify-center gap-1.5"
          style={{
            border: `1px solid ${hasFixes ? theme.primary : theme.border}`,
            color: hasFixes ? theme.primary : theme.text.muted,
            backgroundColor: hasFixes ? `${theme.primary}10` : 'transparent',
            opacity: isValidating || (!hasErrors && !hasFixes) ? 0.5 : 1,
            cursor: isValidating || (!hasErrors && !hasFixes) ? 'not-allowed' : 'pointer',
          }}
        >
          <span>🔧</span>
          {hasFixes ? 'Auto-fix Issues' : 'No Fixes Available'}
        </button>
      )}

      {/* Help Text */}
      <div className="text-[10px] space-y-1" style={{ color: theme.text.muted }}>
        <div className="font-medium">Validation Checks:</div>
        <ul className="list-disc list-inside space-y-0.5 ml-1">
          <li>All main bases can reach each other</li>
          <li>Each main can reach its natural expansion</li>
          <li>No important bases are isolated</li>
          <li>Ramps connect elevation differences</li>
        </ul>
      </div>
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
  if (state.selectedObjects.length === 0 || !state.mapData) return null;

  // Get the first selected object
  const selectedId = state.selectedObjects[0];
  const selectedObj = state.mapData.objects.find((o) => o.id === selectedId);
  if (!selectedObj) return null;

  const objType = config.objectTypes.find((t) => t.id === selectedObj.type);
  if (!objType) return null;

  const properties = objType.properties || [];

  return (
    <div
      className="border-t p-3 space-y-3"
      style={{ borderColor: config.theme.border }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>{objType.icon}</span>
          <span className="text-xs font-medium" style={{ color: config.theme.text.primary }}>
            {objType.name}
          </span>
        </div>
        <button
          onClick={() => onRemove(selectedId)}
          className="text-xs px-2 py-1 rounded"
          style={{ color: config.theme.error }}
        >
          Delete
        </button>
      </div>

      {/* Position display */}
      <div className="text-[10px] font-mono" style={{ color: config.theme.text.muted }}>
        Position: {Math.round(selectedObj.x)}, {Math.round(selectedObj.y)}
      </div>

      {/* Properties */}
      {properties.length > 0 && (
        <div className="space-y-2">
          {properties.map((prop) => {
            const currentValue = selectedObj.properties?.[prop.key] ?? prop.defaultValue;

            if (prop.type === 'number') {
              return (
                <div key={prop.key}>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span style={{ color: config.theme.text.muted }}>{prop.name}</span>
                    <span className="font-mono" style={{ color: config.theme.text.secondary }}>
                      {typeof currentValue === 'number' ? currentValue.toFixed(2) : String(currentValue)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={prop.min ?? 0}
                    max={prop.max ?? 100}
                    step={0.1}
                    value={currentValue as number}
                    onChange={(e) => onPropertyUpdate(selectedId, prop.key, Number(e.target.value))}
                    className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
                    style={{ backgroundColor: config.theme.border }}
                  />
                </div>
              );
            }

            if (prop.type === 'select' && prop.options) {
              return (
                <div key={prop.key}>
                  <label className="text-[10px]" style={{ color: config.theme.text.muted }}>
                    {prop.name}
                  </label>
                  <select
                    value={currentValue as string}
                    onChange={(e) => onPropertyUpdate(selectedId, prop.key, e.target.value)}
                    className="w-full mt-1 px-2 py-1 rounded text-xs"
                    style={{
                      backgroundColor: config.theme.surface,
                      border: `1px solid ${config.theme.border}`,
                      color: config.theme.text.primary,
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

      {state.selectedObjects.length > 1 && (
        <div className="text-[10px] italic" style={{ color: config.theme.text.muted }}>
          +{state.selectedObjects.length - 1} more selected
        </div>
      )}
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
  return (
    <div
      className="w-64 flex-shrink-0 flex flex-col border-l"
      style={{
        backgroundColor: config.theme.surface,
        borderColor: config.theme.border,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Panel tabs */}
      <div
        className="flex-shrink-0 flex border-b overflow-x-auto"
        style={{
          borderColor: config.theme.border,
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {config.panels.map((panel) => (
          <PanelTab
            key={panel.id}
            active={state.activePanel === panel.id}
            onClick={() => onPanelChange(panel.id)}
            icon={panel.icon}
            name={panel.name}
            theme={config.theme}
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
