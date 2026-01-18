/**
 * EditorToolbar - Professional horizontal toolbar
 *
 * Modern toolbar with grouped tools, contextual options, and polished styling.
 * Inspired by professional design tools like Figma and Photoshop.
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import type { EditorConfig, ToolConfig, SymmetryMode, SnapMode } from '../config/EditorConfig';

export interface EditorToolbarProps {
  config: EditorConfig;
  activeTool: string;
  selectedElevation: number;
  brushSize: number;
  symmetryMode?: SymmetryMode;
  snapMode?: SnapMode;
  onToolSelect: (toolId: string) => void;
  onBrushSizeChange: (size: number) => void;
  onElevationSelect: (elevation: number) => void;
  onSymmetryChange?: (mode: SymmetryMode) => void;
  onSnapChange?: (mode: SnapMode) => void;
}

// Tool groups for organization
const TOOL_GROUPS = {
  select: ['select'],
  paint: ['brush', 'fill', 'eraser'],
  shapes: ['line', 'rect', 'ellipse', 'plateau', 'ramp'],
  platform: ['platform_brush', 'platform_rect', 'platform_ramp'],
  sculpt: ['raise', 'lower', 'smooth', 'noise'],
};

// Group metadata
const GROUP_META: Record<string, { name: string; icon: string }> = {
  select: { name: 'Select', icon: '⬚' },
  paint: { name: 'Paint', icon: '●' },
  shapes: { name: 'Shapes', icon: '◇' },
  platform: { name: 'Platform', icon: '▣' },
  sculpt: { name: 'Sculpt', icon: '▲' },
};

// Symmetry options
const SYMMETRY_OPTIONS: { id: SymmetryMode; name: string; icon: string }[] = [
  { id: 'none', name: 'None', icon: '○' },
  { id: 'x', name: 'Mirror X', icon: '↔' },
  { id: 'y', name: 'Mirror Y', icon: '↕' },
  { id: 'both', name: 'Mirror Both', icon: '⊕' },
  { id: 'radial4', name: 'Radial 4', icon: '✦' },
  { id: 'radial8', name: 'Radial 8', icon: '✸' },
];

// Snap options
const SNAP_OPTIONS: { id: SnapMode; name: string; icon: string }[] = [
  { id: 'none', name: 'None', icon: '○' },
  { id: 'grid', name: 'Grid', icon: '⊞' },
  { id: 'orthogonal', name: '90°', icon: '┼' },
  { id: '45deg', name: '45°', icon: '╳' },
];

// Compact tool button
function ToolButton({
  tool,
  active,
  onClick,
  theme,
  compact = false,
}: {
  tool: ToolConfig;
  active: boolean;
  onClick: () => void;
  theme: EditorConfig['theme'];
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={`${tool.name} (${tool.shortcut})`}
      className={`
        relative flex items-center justify-center transition-all duration-150
        ${compact ? 'w-8 h-8 rounded-md' : 'h-8 px-2.5 rounded-md gap-1.5'}
        ${active ? 'shadow-lg' : 'hover:bg-white/5'}
      `}
      style={{
        backgroundColor: active ? theme.primary : 'transparent',
        color: active ? '#fff' : theme.text.secondary,
        boxShadow: active ? `0 2px 8px ${theme.primary}40` : 'none',
      }}
    >
      <span className={compact ? 'text-sm' : 'text-base'}>{tool.icon}</span>
      {!compact && (
        <span className="text-xs font-medium hidden xl:inline">{tool.name}</span>
      )}
    </button>
  );
}

// Dropdown menu for tool groups
function ToolGroupDropdown({
  groupId,
  tools,
  activeTool,
  onToolSelect,
  theme,
}: {
  groupId: string;
  tools: ToolConfig[];
  activeTool: string;
  onToolSelect: (toolId: string) => void;
  theme: EditorConfig['theme'];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const meta = GROUP_META[groupId] || { name: groupId, icon: '?' };
  const hasActiveTool = tools.some((t) => t.id === activeTool);
  const activeToolInGroup = tools.find((t) => t.id === activeTool);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          h-8 px-2 rounded-md flex items-center gap-1.5 transition-all duration-150
          ${hasActiveTool ? '' : 'hover:bg-white/5'}
        `}
        style={{
          backgroundColor: hasActiveTool ? `${theme.primary}20` : 'transparent',
          color: hasActiveTool ? theme.text.primary : theme.text.muted,
          border: hasActiveTool ? `1px solid ${theme.primary}40` : '1px solid transparent',
        }}
      >
        <span className="text-sm">{activeToolInGroup?.icon || meta.icon}</span>
        <span className="text-xs font-medium hidden lg:inline">
          {activeToolInGroup?.name || meta.name}
        </span>
        <span className="text-[10px] opacity-60">▾</span>
      </button>

      {isOpen && (
        <div
          className="absolute top-full left-0 mt-1 py-1 rounded-lg shadow-xl z-50 min-w-[160px]"
          style={{
            backgroundColor: theme.surface,
            border: `1px solid ${theme.border}`,
          }}
        >
          <div
            className="px-2 py-1 text-[10px] uppercase tracking-wider"
            style={{ color: theme.text.muted }}
          >
            {meta.name}
          </div>
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => {
                onToolSelect(tool.id);
                setIsOpen(false);
              }}
              className="w-full px-2 py-1.5 flex items-center gap-2 hover:bg-white/5 transition-colors"
              style={{
                backgroundColor: activeTool === tool.id ? `${theme.primary}20` : 'transparent',
                color: activeTool === tool.id ? theme.text.primary : theme.text.secondary,
              }}
            >
              <span className="w-5 text-center">{tool.icon}</span>
              <span className="text-xs flex-1 text-left">{tool.name}</span>
              <span className="text-[10px] opacity-50 font-mono">{tool.shortcut}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
  const [showTooltip, setShowTooltip] = useState<number | null>(null);

  return (
    <div className="flex items-center gap-1">
      {elevations.map((elev) => (
        <div key={elev.id} className="relative">
          <button
            onClick={() => onSelect(elev.id)}
            onMouseEnter={() => setShowTooltip(elev.id)}
            onMouseLeave={() => setShowTooltip(null)}
            className={`
              w-6 h-6 rounded-md border transition-all duration-150
              ${selected === elev.id ? 'scale-110 ring-2 ring-offset-1' : 'hover:scale-105'}
            `}
            style={{
              backgroundColor: elev.color,
              borderColor: selected === elev.id ? '#fff' : `${elev.color}80`,
              '--tw-ring-color': theme.primary,
              '--tw-ring-offset-color': theme.surface,
            } as React.CSSProperties}
          />
          {showTooltip === elev.id && (
            <div
              className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 rounded text-[10px] whitespace-nowrap z-50"
              style={{
                backgroundColor: theme.background,
                border: `1px solid ${theme.border}`,
                color: theme.text.primary,
              }}
            >
              {elev.name}
              {elev.shortcut && (
                <span className="ml-1 opacity-50">({elev.shortcut})</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Compact dropdown for symmetry/snap
function ModeDropdown({
  label,
  icon,
  value,
  options,
  onChange,
  theme,
}: {
  label: string;
  icon: string;
  value: string;
  options: { id: string; name: string; icon: string }[];
  onChange: (value: string) => void;
  theme: EditorConfig['theme'];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        title={`${label}: ${selected?.name || value}`}
        className="h-7 px-2 rounded flex items-center gap-1 text-xs transition-colors hover:bg-white/5"
        style={{
          color: value !== 'none' ? theme.primary : theme.text.muted,
        }}
      >
        <span>{selected?.icon || icon}</span>
        <span className="hidden sm:inline">{selected?.name || label}</span>
      </button>

      {isOpen && (
        <div
          className="absolute top-full right-0 mt-1 py-1 rounded-lg shadow-xl z-50 min-w-[120px]"
          style={{
            backgroundColor: theme.surface,
            border: `1px solid ${theme.border}`,
          }}
        >
          <div
            className="px-2 py-1 text-[10px] uppercase tracking-wider"
            style={{ color: theme.text.muted }}
          >
            {label}
          </div>
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => {
                onChange(opt.id);
                setIsOpen(false);
              }}
              className="w-full px-2 py-1.5 flex items-center gap-2 hover:bg-white/5 transition-colors"
              style={{
                backgroundColor: value === opt.id ? `${theme.primary}20` : 'transparent',
                color: value === opt.id ? theme.text.primary : theme.text.secondary,
              }}
            >
              <span className="w-4">{opt.icon}</span>
              <span className="text-xs">{opt.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Brush size control
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
    <div className="flex items-center gap-2">
      <div
        className="w-5 h-5 rounded-full border flex items-center justify-center"
        style={{
          borderColor: theme.border,
          backgroundColor: theme.background,
        }}
      >
        <div
          className="rounded-full"
          style={{
            width: `${Math.max(4, (value / max) * 14)}px`,
            height: `${Math.max(4, (value / max) * 14)}px`,
            backgroundColor: theme.primary,
          }}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-16 h-1 rounded-full appearance-none cursor-pointer"
        style={{
          backgroundColor: theme.border,
          accentColor: theme.primary,
        }}
      />
      <span
        className="w-5 text-center text-xs font-mono"
        style={{ color: theme.text.secondary }}
      >
        {value}
      </span>
    </div>
  );
}

// Vertical divider
function Divider({ theme }: { theme: EditorConfig['theme'] }) {
  return (
    <div
      className="w-px h-6 mx-1"
      style={{ backgroundColor: theme.border }}
    />
  );
}

export function EditorToolbar({
  config,
  activeTool,
  selectedElevation,
  brushSize,
  symmetryMode = 'none',
  snapMode = 'none',
  onToolSelect,
  onBrushSizeChange,
  onElevationSelect,
  onSymmetryChange,
  onSnapChange,
}: EditorToolbarProps) {
  const theme = config.theme;
  const activeToolConfig = config.tools.find((t) => t.id === activeTool);
  const showBrushSize = activeToolConfig?.hasBrushSize;

  // Group tools by category
  const getToolsForGroup = (groupId: string): ToolConfig[] => {
    const toolIds = TOOL_GROUPS[groupId as keyof typeof TOOL_GROUPS] || [];
    return toolIds
      .map((id) => config.tools.find((t) => t.id === id))
      .filter((t): t is ToolConfig => t !== undefined);
  };

  return (
    <div
      className="h-11 flex items-center gap-1 px-2 border-b"
      style={{
        backgroundColor: theme.surface,
        borderColor: theme.border,
      }}
    >
      {/* Primary tool groups - always visible */}
      <div className="flex items-center">
        {/* Select tool - single button */}
        {getToolsForGroup('select').map((tool) => (
          <ToolButton
            key={tool.id}
            tool={tool}
            active={activeTool === tool.id}
            onClick={() => onToolSelect(tool.id)}
            theme={theme}
            compact
          />
        ))}
      </div>

      <Divider theme={theme} />

      {/* Paint tools */}
      <div className="flex items-center gap-0.5">
        {getToolsForGroup('paint').map((tool) => (
          <ToolButton
            key={tool.id}
            tool={tool}
            active={activeTool === tool.id}
            onClick={() => onToolSelect(tool.id)}
            theme={theme}
            compact
          />
        ))}
      </div>

      <Divider theme={theme} />

      {/* Shape tools dropdown */}
      <ToolGroupDropdown
        groupId="shapes"
        tools={getToolsForGroup('shapes')}
        activeTool={activeTool}
        onToolSelect={onToolSelect}
        theme={theme}
      />

      {/* Platform tools dropdown */}
      {getToolsForGroup('platform').length > 0 && (
        <>
          <Divider theme={theme} />
          <ToolGroupDropdown
            groupId="platform"
            tools={getToolsForGroup('platform')}
            activeTool={activeTool}
            onToolSelect={onToolSelect}
            theme={theme}
          />
        </>
      )}

      {/* Sculpt tools dropdown */}
      <Divider theme={theme} />
      <ToolGroupDropdown
        groupId="sculpt"
        tools={getToolsForGroup('sculpt')}
        activeTool={activeTool}
        onToolSelect={onToolSelect}
        theme={theme}
      />

      <Divider theme={theme} />

      {/* Elevation selector */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: theme.text.muted }}>
          Elev
        </span>
        <ElevationSelector
          elevations={config.terrain.elevations}
          selected={selectedElevation}
          onSelect={onElevationSelect}
          theme={theme}
        />
      </div>

      {/* Contextual: Brush size */}
      {showBrushSize && (
        <>
          <Divider theme={theme} />
          <BrushSizeControl
            value={brushSize}
            min={activeToolConfig?.minBrushSize || 1}
            max={activeToolConfig?.maxBrushSize || 20}
            onChange={onBrushSizeChange}
            theme={theme}
          />
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Mode controls */}
      <div className="flex items-center gap-1">
        {onSymmetryChange && (
          <ModeDropdown
            label="Symmetry"
            icon="◐"
            value={symmetryMode}
            options={SYMMETRY_OPTIONS}
            onChange={(v) => onSymmetryChange(v as SymmetryMode)}
            theme={theme}
          />
        )}
        {onSnapChange && (
          <ModeDropdown
            label="Snap"
            icon="⊞"
            value={snapMode}
            options={SNAP_OPTIONS}
            onChange={(v) => onSnapChange(v as SnapMode)}
            theme={theme}
          />
        )}
      </div>

      <Divider theme={theme} />

      {/* Keyboard hints */}
      <div className="hidden lg:flex items-center gap-2">
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ backgroundColor: theme.background, color: theme.text.muted }}
        >
          [ ] Size
        </span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ backgroundColor: theme.background, color: theme.text.muted }}
        >
          Ctrl+Z Undo
        </span>
      </div>
    </div>
  );
}

export default EditorToolbar;
