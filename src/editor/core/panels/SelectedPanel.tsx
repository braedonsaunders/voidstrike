'use client';

import type { EditorConfig, EditorState } from '../../config/EditorConfig';
import { Slider, RotationDial, ScaleControl } from './shared';

export interface SelectedPanelProps {
  config: EditorConfig;
  state: EditorState;
  onPropertyUpdate: (id: string, key: string, value: unknown) => void;
  onRemove: (id: string) => void;
}

export function SelectedPanel({
  config,
  state,
  onPropertyUpdate,
  onRemove,
}: SelectedPanelProps) {
  const theme = config.theme;

  if (state.selectedObjects.length === 0 || !state.mapData) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-2xl mb-4"
          style={{ backgroundColor: `${theme.primary}15` }}
        >
          ✎
        </div>
        <div className="text-sm font-medium mb-2" style={{ color: theme.text.primary }}>
          No Object Selected
        </div>
        <div className="text-xs max-w-[180px]" style={{ color: theme.text.muted }}>
          Click on an object in the map to select it and edit its properties here
        </div>
      </div>
    );
  }

  const selectedId = state.selectedObjects[0];
  const selectedObj = state.mapData.objects.find((o) => o.id === selectedId);
  if (!selectedObj) return null;

  const objType = config.objectTypes.find((t) => t.id === selectedObj.type);
  if (!objType) return null;

  const properties = objType.properties || [];

  // Separate rotation and scale from other properties
  const rotationProp = properties.find((p) => p.key === 'rotation');
  const scaleProp = properties.find((p) => p.key === 'scale');
  const otherProps = properties.filter((p) => p.key !== 'rotation' && p.key !== 'scale');

  const currentRotation = (selectedObj.properties?.rotation as number) ?? rotationProp?.defaultValue ?? 0;
  const currentScale = (selectedObj.properties?.scale as number) ?? scaleProp?.defaultValue ?? 1;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-all duration-200"
            style={{ backgroundColor: `${theme.primary}20` }}
          >
            {objType.icon}
          </div>
          <div>
            <div className="text-sm font-medium" style={{ color: theme.text.primary }}>
              {objType.name}
            </div>
            <div className="text-[10px] font-mono flex items-center gap-1" style={{ color: theme.text.muted }}>
              <span style={{ color: theme.primary }}>x:</span>{Math.round(selectedObj.x)}
              <span style={{ color: theme.primary, marginLeft: '4px' }}>y:</span>{Math.round(selectedObj.y)}
            </div>
          </div>
        </div>
        <button
          onClick={() => onRemove(selectedId)}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all duration-200 hover:bg-red-500/20 hover:scale-110"
          style={{ color: theme.error }}
          title="Delete object"
        >
          ✕
        </button>
      </div>

      {/* Transform Section */}
      {(scaleProp || rotationProp) && (
        <div
          className="p-3 rounded-lg space-y-4"
          style={{ backgroundColor: theme.background }}
        >
          <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: theme.text.muted }}>
            Transform
          </div>

          {/* Scale control */}
          {scaleProp && (
            <ScaleControl
              value={currentScale}
              min={scaleProp.min ?? 0.25}
              max={scaleProp.max ?? 3}
              onChange={(v) => onPropertyUpdate(selectedId, 'scale', v)}
              theme={theme}
            />
          )}

          {/* Rotation dial */}
          {rotationProp && (
            <RotationDial
              value={currentRotation}
              onChange={(v) => onPropertyUpdate(selectedId, 'rotation', v)}
              theme={theme}
            />
          )}
        </div>
      )}

      {/* Other Properties */}
      {otherProps.length > 0 && (
        <div
          className="p-3 rounded-lg space-y-3"
          style={{ backgroundColor: theme.background }}
        >
          <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: theme.text.muted }}>
            Properties
          </div>

          {otherProps.map((prop) => {
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
                    className="w-full mt-1 px-3 py-2 rounded-lg text-sm transition-all duration-200 focus:ring-2"
                    style={{
                      backgroundColor: theme.surface,
                      border: `1px solid ${theme.border}`,
                      color: theme.text.primary,
                      '--tw-ring-color': theme.primary,
                    } as React.CSSProperties}
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
          className="flex items-center gap-2 text-xs pt-2 border-t"
          style={{ color: theme.text.muted, borderColor: theme.border }}
        >
          <div
            className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-medium"
            style={{ backgroundColor: `${theme.primary}20`, color: theme.primary }}
          >
            +{state.selectedObjects.length - 1}
          </div>
          <span>more selected</span>
        </div>
      )}
    </div>
  );
}
