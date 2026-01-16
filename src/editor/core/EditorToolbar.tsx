/**
 * EditorToolbar - Horizontal toolbar for tool selection
 *
 * Photoshop-style horizontal toolbar at the top of the canvas area.
 * Shows tools, current tool options, and quick actions.
 */

'use client';

import type { EditorConfig, ToolConfig } from '../config/EditorConfig';

export interface EditorToolbarProps {
  config: EditorConfig;
  activeTool: string;
  selectedElevation: number;
  brushSize: number;
  onToolSelect: (toolId: string) => void;
  onBrushSizeChange: (size: number) => void;
  onElevationSelect: (elevation: number) => void;
}

// Tool button with icon and shortcut
function ToolButton({
  tool,
  active,
  onClick,
  theme,
}: {
  tool: ToolConfig;
  active: boolean;
  onClick: () => void;
  theme: EditorConfig['theme'];
}) {
  return (
    <button
      onClick={onClick}
      title={`${tool.name} (${tool.shortcut})`}
      className={`
        h-9 px-3 rounded flex items-center justify-center gap-1.5 text-sm font-medium
        transition-all duration-100
        ${active ? '' : 'hover:bg-white/10'}
      `}
      style={{
        backgroundColor: active ? theme.primary : 'transparent',
        color: active ? '#fff' : theme.text.secondary,
      }}
    >
      <span className="text-base">{tool.icon}</span>
      <span className="hidden sm:inline">{tool.name}</span>
      <span
        className="text-[10px] opacity-50 ml-1 hidden md:inline"
        style={{ color: active ? '#fff' : theme.text.muted }}
      >
        {tool.shortcut}
      </span>
    </button>
  );
}

export function EditorToolbar({
  config,
  activeTool,
  selectedElevation,
  brushSize,
  onToolSelect,
  onBrushSizeChange,
  onElevationSelect,
}: EditorToolbarProps) {
  const theme = config.theme;
  const activeToolConfig = config.tools.find((t) => t.id === activeTool);
  const showBrushSize = activeToolConfig?.hasBrushSize;
  const selectedElev = config.terrain.elevations.find((e) => e.id === selectedElevation);

  return (
    <div
      className="h-12 flex items-center gap-1 px-3 border-b"
      style={{
        backgroundColor: theme.surface,
        borderColor: theme.border,
      }}
    >
      {/* Tools */}
      <div className="flex items-center gap-1">
        {config.tools.map((tool) => (
          <ToolButton
            key={tool.id}
            tool={tool}
            active={activeTool === tool.id}
            onClick={() => onToolSelect(tool.id)}
            theme={theme}
          />
        ))}
      </div>

      {/* Divider */}
      <div className="w-px h-6 mx-2" style={{ backgroundColor: theme.border }} />

      {/* Elevation selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: theme.text.muted }}>
          Elevation:
        </span>
        <div className="flex items-center gap-1">
          {config.terrain.elevations.map((elev) => (
            <button
              key={elev.id}
              onClick={() => onElevationSelect(elev.id)}
              title={`${elev.name} (${elev.shortcut})`}
              className={`
                w-7 h-7 rounded border-2 transition-all
                ${selectedElevation === elev.id ? 'scale-110 ring-2 ring-offset-1' : 'hover:scale-105'}
              `}
              style={{
                backgroundColor: elev.color,
                borderColor: selectedElevation === elev.id ? '#fff' : 'transparent',
                '--tw-ring-color': theme.primary,
                '--tw-ring-offset-color': theme.surface,
              } as React.CSSProperties}
            />
          ))}
        </div>
        {selectedElev && (
          <span className="text-xs ml-1" style={{ color: theme.text.secondary }}>
            {selectedElev.name}
          </span>
        )}
      </div>

      {/* Divider */}
      {showBrushSize && (
        <>
          <div className="w-px h-6 mx-2" style={{ backgroundColor: theme.border }} />

          {/* Brush size */}
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: theme.text.muted }}>
              Size:
            </span>
            <input
              type="range"
              min={activeToolConfig?.minBrushSize || 1}
              max={activeToolConfig?.maxBrushSize || 20}
              value={brushSize}
              onChange={(e) => onBrushSizeChange(Number(e.target.value))}
              className="w-20 h-1.5 rounded-full appearance-none cursor-pointer"
              style={{ backgroundColor: theme.border }}
            />
            <span
              className="w-6 text-center text-sm font-mono"
              style={{ color: theme.text.primary }}
            >
              {brushSize}
            </span>
          </div>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Keyboard hints */}
      <div className="hidden lg:flex items-center gap-3 text-xs" style={{ color: theme.text.muted }}>
        <span>[ ] Brush size</span>
        <span>Ctrl+Z Undo</span>
        <span>Tab Toggle panel</span>
      </div>
    </div>
  );
}

export default EditorToolbar;
