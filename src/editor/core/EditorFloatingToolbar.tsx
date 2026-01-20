/**
 * EditorFloatingToolbar - Draggable floating toolbar for quick tool access
 *
 * A sleek, minimal toolbar that floats over the canvas for quick access to
 * painting tools. Can be dragged to reposition.
 */

'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { EditorConfig, ToolConfig } from '../config/EditorConfig';
import { clamp } from '@/utils/math';

export interface EditorFloatingToolbarProps {
  config: EditorConfig;
  activeTool: string;
  selectedElevation: number;
  brushSize: number;
  onToolSelect: (toolId: string) => void;
  onBrushSizeChange: (size: number) => void;
  onElevationSelect: (elevation: number) => void;
}

// Tool icon component with hover effects
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
        w-10 h-10 rounded-lg flex items-center justify-center text-lg
        transition-all duration-150 relative group
        ${active ? 'scale-110' : 'hover:scale-105'}
      `}
      style={{
        backgroundColor: active ? theme.primary : 'rgba(255,255,255,0.1)',
        color: active ? '#fff' : theme.text.secondary,
        boxShadow: active ? `0 0 20px ${theme.primary}60` : 'none',
      }}
    >
      {tool.icon}
      {/* Shortcut badge */}
      <span
        className="absolute -bottom-0.5 -right-0.5 text-[8px] font-bold px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ backgroundColor: theme.background, color: theme.text.muted }}
      >
        {tool.shortcut}
      </span>
    </button>
  );
}

// Elevation quick selector
function ElevationSelector({
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
  const [expanded, setExpanded] = useState(false);
  const selectedElev = elevations.find((e) => e.id === selected);

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-10 h-10 rounded-lg flex items-center justify-center transition-all hover:scale-105"
        style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
        title="Elevation"
      >
        <div
          className="w-6 h-6 rounded border-2"
          style={{
            backgroundColor: selectedElev?.color || '#666',
            borderColor: 'rgba(255,255,255,0.3)',
          }}
        />
      </button>

      {expanded && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setExpanded(false)} />
          <div
            className="absolute left-full ml-2 top-0 p-2 rounded-lg shadow-2xl z-50 flex flex-col gap-1"
            style={{ backgroundColor: theme.surface, border: `1px solid ${theme.border}` }}
          >
            {elevations.map((elev) => (
              <button
                key={elev.id}
                onClick={() => {
                  onSelect(elev.id);
                  setExpanded(false);
                }}
                className={`
                  flex items-center gap-2 px-3 py-2 rounded transition-colors whitespace-nowrap
                  ${selected === elev.id ? 'ring-2' : ''}
                `}
                style={{
                  backgroundColor: selected === elev.id ? theme.primary + '30' : 'transparent',
                  '--tw-ring-color': theme.primary,
                } as React.CSSProperties}
              >
                <div
                  className="w-5 h-5 rounded border"
                  style={{ backgroundColor: elev.color, borderColor: theme.border }}
                />
                <span className="text-xs" style={{ color: theme.text.primary }}>
                  {elev.name}
                </span>
                <span className="text-[10px] ml-auto" style={{ color: theme.text.muted }}>
                  {elev.shortcut}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Brush size slider
function BrushSizeControl({
  value,
  min,
  max,
  onChange,
  theme,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (size: number) => void;
  theme: EditorConfig['theme'];
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-1">
      <div
        className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-mono"
        style={{
          borderColor: theme.primary,
          color: theme.text.primary,
          width: clamp(16 + value * 2, 24, 40),
          height: clamp(16 + value * 2, 24, 40),
        }}
      >
        {value}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 h-1 rounded-full appearance-none cursor-pointer"
        style={{ backgroundColor: theme.border }}
        title={`Brush Size: ${value}`}
      />
    </div>
  );
}

export function EditorFloatingToolbar({
  config,
  activeTool,
  selectedElevation,
  brushSize,
  onToolSelect,
  onBrushSizeChange,
  onElevationSelect,
}: EditorFloatingToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 16, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const activeToolConfig = config.tools.find((t) => t.id === activeTool);
  const showBrushSize = activeToolConfig?.hasBrushSize;

  // Handle drag start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return;
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position]);

  // Handle drag move
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Separate tools by type
  const paintTools = config.tools.filter((t) => ['brush', 'eraser', 'fill', 'plateau'].includes(t.type));
  const selectTools = config.tools.filter((t) => t.type === 'select');

  return (
    <div
      ref={toolbarRef}
      className="absolute z-30 select-none"
      style={{
        left: position.x,
        top: position.y,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
    >
      <div
        className="rounded-2xl shadow-2xl backdrop-blur-xl p-2 flex flex-col gap-2"
        style={{
          backgroundColor: 'rgba(20, 20, 30, 0.9)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center py-1 cursor-grab">
          <div className="w-8 h-1 rounded-full bg-white/20" />
        </div>

        {/* Select tool */}
        {selectTools.map((tool) => (
          <ToolButton
            key={tool.id}
            tool={tool}
            active={activeTool === tool.id}
            onClick={() => onToolSelect(tool.id)}
            theme={config.theme}
          />
        ))}

        {/* Divider */}
        <div className="h-px mx-1 bg-white/10" />

        {/* Paint tools */}
        {paintTools.map((tool) => (
          <ToolButton
            key={tool.id}
            tool={tool}
            active={activeTool === tool.id}
            onClick={() => onToolSelect(tool.id)}
            theme={config.theme}
          />
        ))}

        {/* Divider */}
        <div className="h-px mx-1 bg-white/10" />

        {/* Elevation selector */}
        <ElevationSelector
          elevations={config.terrain.elevations}
          selected={selectedElevation}
          onSelect={onElevationSelect}
          theme={config.theme}
        />

        {/* Brush size (when applicable) */}
        {showBrushSize && (
          <>
            <div className="h-px mx-1 bg-white/10" />
            <BrushSizeControl
              value={brushSize}
              min={activeToolConfig?.minBrushSize || 1}
              max={activeToolConfig?.maxBrushSize || 20}
              onChange={onBrushSizeChange}
              theme={config.theme}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default EditorFloatingToolbar;
