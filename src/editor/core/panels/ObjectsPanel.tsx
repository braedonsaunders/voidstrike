'use client';

import type { EditorConfig, EditorState, EditorObject } from '../../config/EditorConfig';
import { Section } from './shared';

export interface ObjectsPanelProps {
  config: EditorConfig;
  state: EditorState;
  category: string;
  onObjectAdd: (obj: Omit<EditorObject, 'id'>) => string;
  onObjectRemove: (id: string) => void;
}

export function ObjectsPanel({
  config,
  state,
  category,
  onObjectAdd,
  onObjectRemove,
}: ObjectsPanelProps) {
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
