'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { EditorConfig, ToolConfig } from '../../config/EditorConfig';

// Panel icons
export const PANEL_ICONS: Record<string, string> = {
  ai: '🪄',
  paint: '🎨',
  bases: '🏰',
  objects: '📦',
  decorations: '🌿',
  settings: '⚙️',
  validate: '✓',
};

// Tool categories for paint panel
export const TOOL_CATEGORIES = {
  paint: { name: 'Paint', tools: ['brush', 'fill', 'eraser'] },
  shapes: { name: 'Shapes', tools: ['line', 'rect', 'ellipse', 'plateau', 'ramp'] },
  platform: { name: 'Platform', tools: ['platform_brush', 'platform_rect', 'platform_ramp'] },
  sculpt: { name: 'Sculpt', tools: ['raise', 'lower', 'smooth', 'noise'] },
};

// Collapsible section component with smooth animation
export function Section({
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
export function PanelTab({
  active,
  onClick,
  icon,
  name,
  theme,
  hasContent,
}: {
  active: boolean;
  onClick: () => void;
  icon?: string;
  name: string;
  theme: EditorConfig['theme'];
  hasContent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={name}
      className={`
        relative px-2 py-2 flex-1 flex items-center justify-center transition-all duration-200
        ${active ? '' : 'hover:bg-white/5'}
        ${hasContent === false ? 'opacity-40' : ''}
      `}
      style={{
        color: active ? theme.primary : theme.text.muted,
        minWidth: '32px',
      }}
    >
      <span
        className="text-sm transition-transform duration-200"
        style={{
          transform: active ? 'scale(1.1)' : 'scale(1)',
        }}
      >
        {icon || PANEL_ICONS[name.toLowerCase()] || name.charAt(0)}
      </span>
      {/* Animated underline indicator */}
      <div
        className="absolute bottom-0 left-1/2 h-0.5 rounded-full transition-all duration-300 ease-out"
        style={{
          backgroundColor: theme.primary,
          width: active ? '16px' : '0px',
          transform: 'translateX(-50%)',
          opacity: active ? 1 : 0,
        }}
      />
      {/* Active indicator dot for "has content" */}
      {hasContent && !active && (
        <div
          className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: theme.primary }}
        />
      )}
    </button>
  );
}

// Slider with visual feedback
export function Slider({
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

// Toggle switch component
export function ToggleSwitch({
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

// Tool grid with category support
export function ToolGrid({
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

// Elevation palette - compact color swatches
export function ElevationPalette({
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

// Feature buttons
export function FeatureGrid({
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

// Material selector
export function MaterialSelector({
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

// Rotation dial component for intuitive rotation control
export function RotationDial({
  value,
  onChange,
  theme,
}: {
  value: number;
  onChange: (value: number) => void;
  theme: EditorConfig['theme'];
}) {
  const dialRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const updateRotation = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!dialRef.current) return;
    const rect = dialRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;
    onChange(Math.round(angle) % 360);
  }, [onChange]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    updateRotation(e);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => updateRotation(e);
    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, updateRotation]);

  // Quick snap buttons
  const snapAngles = [0, 45, 90, 135, 180, 225, 270, 315];

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: theme.text.muted }}>
          Rotation
        </span>
        <span
          className="text-[11px] font-mono px-1.5 py-0.5 rounded transition-all duration-200"
          style={{
            backgroundColor: isDragging ? `${theme.primary}20` : theme.surface,
            color: isDragging ? theme.primary : theme.text.secondary,
          }}
        >
          {value}°
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Dial */}
        <div
          ref={dialRef}
          onMouseDown={handleMouseDown}
          className="relative w-16 h-16 rounded-full cursor-pointer transition-all duration-200 flex-shrink-0"
          style={{
            background: `conic-gradient(from 0deg, ${theme.primary}40, ${theme.primary}, ${theme.primary}40)`,
            boxShadow: isDragging ? `0 0 16px ${theme.primary}50` : `0 2px 8px rgba(0,0,0,0.3)`,
          }}
        >
          {/* Inner circle */}
          <div
            className="absolute inset-2 rounded-full flex items-center justify-center"
            style={{ backgroundColor: theme.background }}
          >
            {/* Rotation indicator */}
            <div
              className="absolute w-1 h-6 rounded-full transition-transform duration-75"
              style={{
                backgroundColor: theme.primary,
                transform: `rotate(${value}deg) translateY(-4px)`,
                transformOrigin: 'center bottom',
              }}
            />
            {/* Center dot */}
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: theme.text.muted }}
            />
          </div>

          {/* Cardinal markers */}
          {[0, 90, 180, 270].map((angle) => (
            <div
              key={angle}
              className="absolute w-1 h-1.5 rounded-full"
              style={{
                backgroundColor: theme.text.muted,
                left: '50%',
                top: '2px',
                transform: `translateX(-50%) rotate(${angle}deg)`,
                transformOrigin: 'center 30px',
              }}
            />
          ))}
        </div>

        {/* Quick snap buttons */}
        <div className="grid grid-cols-4 gap-1 flex-1">
          {snapAngles.map((angle) => (
            <button
              key={angle}
              onClick={() => onChange(angle)}
              className="px-1.5 py-1 text-[10px] rounded transition-all duration-150 hover:scale-105"
              style={{
                backgroundColor: value === angle ? `${theme.primary}30` : theme.surface,
                color: value === angle ? theme.primary : theme.text.muted,
                border: value === angle ? `1px solid ${theme.primary}` : `1px solid transparent`,
              }}
            >
              {angle}°
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Scale control with visual feedback
export function ScaleControl({
  value,
  min,
  max,
  onChange,
  theme,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  theme: EditorConfig['theme'];
}) {
  const percentage = ((value - min) / (max - min)) * 100;
  const [isDragging, setIsDragging] = useState(false);

  // Quick scale presets
  const presets = [0.5, 1.0, 1.5, 2.0];

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: theme.text.muted }}>
          Scale
        </span>
        <span
          className="text-[11px] font-mono px-1.5 py-0.5 rounded transition-all duration-200"
          style={{
            backgroundColor: isDragging ? `${theme.primary}20` : theme.surface,
            color: isDragging ? theme.primary : theme.text.secondary,
          }}
        >
          {value.toFixed(2)}x
        </span>
      </div>

      {/* Slider */}
      <div
        className="relative h-2 rounded-full transition-all duration-200"
        style={{
          backgroundColor: theme.border,
          height: isDragging ? '10px' : '8px',
        }}
      >
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all duration-150"
          style={{
            width: `${percentage}%`,
            backgroundColor: theme.primary,
            boxShadow: isDragging ? `0 0 8px ${theme.primary}60` : 'none',
          }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white transition-all duration-200 pointer-events-none"
          style={{
            left: `${percentage}%`,
            transform: `translateX(-50%) translateY(-50%) scale(${isDragging ? 1.2 : 1})`,
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={0.05}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>

      {/* Preset buttons */}
      <div className="flex gap-1">
        {presets.map((preset) => (
          <button
            key={preset}
            onClick={() => onChange(preset)}
            className="flex-1 py-1 text-[10px] rounded transition-all duration-150 hover:scale-105"
            style={{
              backgroundColor: Math.abs(value - preset) < 0.05 ? `${theme.primary}30` : theme.surface,
              color: Math.abs(value - preset) < 0.05 ? theme.primary : theme.text.muted,
              border: Math.abs(value - preset) < 0.05 ? `1px solid ${theme.primary}` : `1px solid transparent`,
            }}
          >
            {preset}x
          </button>
        ))}
      </div>
    </div>
  );
}

// Animated panel content wrapper
export function AnimatedPanelContent({
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
      // Use requestAnimationFrame to avoid cascading renders
      requestAnimationFrame(() => {
        setShouldRender(true);
        // Small delay to trigger CSS transition
        requestAnimationFrame(() => {
          setIsAnimating(true);
        });
      });
    } else {
      // Use requestAnimationFrame to avoid cascading renders
      requestAnimationFrame(() => {
        setIsAnimating(false);
      });
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

// Keyboard shortcuts footer
export function ShortcutsFooter({ theme }: { theme: EditorConfig['theme'] }) {
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
