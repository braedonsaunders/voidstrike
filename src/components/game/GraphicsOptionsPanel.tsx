'use client';

import React, { useEffect, useState, memo, useCallback } from 'react';
import { useUIStore, GraphicsSettings, AntiAliasingMode, UpscalingMode, ResolutionMode, FixedResolution, FIXED_RESOLUTIONS } from '@/store/uiStore';
import { setEdgeScrollEnabled } from '@/store/cameraStore';

// ============================================
// COMPACT UI COMPONENTS
// ============================================

/** Compact toggle switch */
const Toggle = memo(function Toggle({
  enabled,
  onChange,
  disabled = false
}: {
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      style={{
        width: '36px',
        height: '18px',
        borderRadius: '9px',
        border: 'none',
        backgroundColor: disabled ? '#333' : enabled ? '#22c55e' : '#444',
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative',
        transition: 'background-color 0.15s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{
        width: '14px',
        height: '14px',
        borderRadius: '7px',
        backgroundColor: '#fff',
        position: 'absolute',
        top: '2px',
        left: enabled ? '20px' : '2px',
        transition: 'left 0.15s',
        boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
      }} />
    </button>
  );
});

/** Segmented control for mode selection */
const SegmentedControl = memo(function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  disabledOptions = [],
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  disabledOptions?: T[];
}) {
  return (
    <div style={{
      display: 'flex',
      backgroundColor: '#222',
      borderRadius: '4px',
      padding: '2px',
      gap: '2px',
    }}>
      {options.map((opt) => {
        const isDisabled = disabled || disabledOptions.includes(opt.value);
        return (
          <button
            key={opt.value}
            onClick={() => !isDisabled && onChange(opt.value)}
            disabled={isDisabled}
            title={opt.hint}
            style={{
              flex: 1,
              padding: '4px 8px',
              fontSize: '10px',
              border: 'none',
              borderRadius: '3px',
              backgroundColor: value === opt.value ? '#3b82f6' : 'transparent',
              color: isDisabled ? '#555' : value === opt.value ? '#fff' : '#888',
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              opacity: isDisabled ? 0.5 : 1,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
});

/** Compact slider with inline value */
const CompactSlider = memo(function CompactSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled = false,
  format = (v: number) => v.toFixed(2),
  suffix = '',
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  format?: (value: number) => string;
  suffix?: string;
}) {
  return (
    <div style={{ marginBottom: '6px', opacity: disabled ? 0.5 : 1 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '2px',
      }}>
        <span style={{ fontSize: '11px', color: '#999' }}>{label}</span>
        <span style={{ fontSize: '10px', color: '#666', fontFamily: 'monospace' }}>
          {format(value)}{suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        style={{
          width: '100%',
          height: '4px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          accentColor: '#3b82f6',
        }}
      />
    </div>
  );
});

/** Collapsible section header */
const SectionHeader = memo(function SectionHeader({
  title,
  expanded,
  onToggle,
  badge,
  masterToggle,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  badge?: 'performance' | 'quality';
  masterToggle?: { enabled: boolean; onChange: () => void };
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0',
        cursor: 'pointer',
        borderBottom: expanded ? '1px solid #333' : 'none',
        marginBottom: expanded ? '8px' : 0,
      }}
    >
      <div
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}
      >
        <span style={{
          fontSize: '10px',
          color: '#666',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
        }}>▶</span>
        <span style={{ fontSize: '12px', fontWeight: 500, color: '#ddd' }}>{title}</span>
        {badge && (
          <span style={{
            fontSize: '8px',
            padding: '1px 4px',
            borderRadius: '3px',
            backgroundColor: badge === 'performance' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(34, 197, 94, 0.2)',
            color: badge === 'performance' ? '#eab308' : '#22c55e',
            textTransform: 'uppercase',
          }}>
            {badge === 'performance' ? 'GPU' : 'Quality'}
          </span>
        )}
      </div>
      {masterToggle && (
        <Toggle enabled={masterToggle.enabled} onChange={masterToggle.onChange} />
      )}
    </div>
  );
});

/** Row with toggle and label */
const ToggleRow = memo(function ToggleRow({
  label,
  enabled,
  onChange,
  disabled = false,
  indent = false,
  hint,
}: {
  label: string;
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
  indent?: boolean;
  hint?: string;
}) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '6px',
      marginLeft: indent ? '12px' : 0,
    }}>
      <span
        style={{ fontSize: '11px', color: disabled ? '#666' : '#aaa' }}
        title={hint}
      >
        {label}
        {hint && <span style={{ marginLeft: '4px', color: '#555' }}>ⓘ</span>}
      </span>
      <Toggle enabled={enabled} onChange={onChange} disabled={disabled} />
    </div>
  );
});

/** Info/Warning hint box */
const HintBox = memo(function HintBox({
  type = 'info',
  children,
}: {
  type?: 'info' | 'warning';
  children: React.ReactNode;
}) {
  const colors = {
    info: { bg: 'rgba(59, 130, 246, 0.1)', border: '#3b82f640', text: '#93c5fd' },
    warning: { bg: 'rgba(234, 179, 8, 0.1)', border: '#eab30840', text: '#fcd34d' },
  };
  const c = colors[type];

  return (
    <div style={{
      fontSize: '9px',
      padding: '6px 8px',
      marginBottom: '8px',
      borderRadius: '4px',
      backgroundColor: c.bg,
      border: `1px solid ${c.border}`,
      color: c.text,
      lineHeight: 1.4,
    }}>
      {type === 'warning' && '⚠ '}
      {children}
    </div>
  );
});

// Format number with K/M suffix for large numbers
function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

/** Performance Metrics Display - shows CPU/GPU timing, triangles, resolution */
const PerformanceMetricsDisplay = memo(function PerformanceMetricsDisplay() {
  const performanceMetrics = useUIStore((state) => state.performanceMetrics);

  const metricStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '10px',
    padding: '2px 0',
  };

  const labelStyle = { color: '#888' };
  const valueStyle = { fontFamily: 'monospace' };

  return (
    <div style={{
      paddingTop: '8px',
      borderTop: '1px solid #222',
      marginTop: '4px',
    }}>
      <div style={{ fontSize: '10px', fontWeight: 600, color: '#666', marginBottom: '6px', textTransform: 'uppercase' }}>
        Performance Metrics
      </div>

      {/* Timing */}
      <div style={metricStyle}>
        <span style={labelStyle}>CPU Time</span>
        <span style={{ ...valueStyle, color: '#22d3ee' }}>{performanceMetrics.cpuTime.toFixed(1)}ms</span>
      </div>
      <div style={metricStyle}>
        <span style={labelStyle}>GPU Time</span>
        <span style={{ ...valueStyle, color: '#fb923c' }}>{performanceMetrics.gpuTime.toFixed(1)}ms</span>
      </div>
      <div style={metricStyle}>
        <span style={labelStyle}>Frame Time</span>
        <span style={{ ...valueStyle, color: '#a3a3a3' }}>{performanceMetrics.frameTime.toFixed(1)}ms</span>
      </div>

      {/* Rendering stats */}
      <div style={{ ...metricStyle, marginTop: '4px', borderTop: '1px solid #333', paddingTop: '4px' }}>
        <span style={labelStyle}>Triangles</span>
        <span style={{ ...valueStyle, color: '#c084fc' }}>{formatNumber(performanceMetrics.triangles)}</span>
      </div>
      <div style={metricStyle}>
        <span style={labelStyle}>Draw Calls</span>
        <span style={{ ...valueStyle, color: '#facc15' }}>{performanceMetrics.drawCalls}</span>
      </div>

      {/* Resolution */}
      <div style={{ ...metricStyle, marginTop: '4px', borderTop: '1px solid #333', paddingTop: '4px' }}>
        <span style={labelStyle}>Render Res</span>
        <span style={{ ...valueStyle, color: '#a3a3a3' }}>
          {performanceMetrics.renderWidth}×{performanceMetrics.renderHeight}
        </span>
      </div>
      {performanceMetrics.renderWidth !== performanceMetrics.displayWidth && (
        <div style={metricStyle}>
          <span style={labelStyle}>Display Res</span>
          <span style={{ ...valueStyle, color: '#a3a3a3' }}>
            {performanceMetrics.displayWidth}×{performanceMetrics.displayHeight}
          </span>
        </div>
      )}
    </div>
  );
});

// ============================================
// MAIN COMPONENT
// ============================================

/**
 * Graphics Options Panel - AAA Quality
 * Compact, organized, professional design
 */
export const GraphicsOptionsPanel = memo(function GraphicsOptionsPanel() {
  // Store state
  const showGraphicsOptions = useUIStore((state) => state.showGraphicsOptions);
  const graphicsSettings = useUIStore((state) => state.graphicsSettings);
  const rendererAPI = useUIStore((state) => state.rendererAPI);
  const showFPS = useUIStore((state) => state.showFPS);
  const toggleFPS = useUIStore((state) => state.toggleFPS);
  const toggleGraphicsOptions = useUIStore((state) => state.toggleGraphicsOptions);
  const toggleGraphicsSetting = useUIStore((state) => state.toggleGraphicsSetting);
  const setGraphicsSetting = useUIStore((state) => state.setGraphicsSetting);
  const setAntiAliasingMode = useUIStore((state) => state.setAntiAliasingMode);
  const setUpscalingMode = useUIStore((state) => state.setUpscalingMode);
  const setResolutionMode = useUIStore((state) => state.setResolutionMode);
  const setFixedResolution = useUIStore((state) => state.setFixedResolution);

  // Section expansion state
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    resolution: true,
    performance: true,
    antialiasing: false,
    lighting: false,
    reflections: false,
    gi: false,
    effects: false,
    color: false,
  });

  const toggleSection = useCallback((section: string) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // Disable edge scrolling when panel is open
  useEffect(() => {
    if (showGraphicsOptions) {
      setEdgeScrollEnabled(false);
      return () => setEdgeScrollEnabled(true);
    }
  }, [showGraphicsOptions]);

  if (!showGraphicsOptions) return null;

  const handleToggle = (key: keyof GraphicsSettings) => {
    toggleGraphicsSetting(key);
  };

  const isWebGPU = rendererAPI === 'WebGPU';

  // FSR compatibility checks
  // FSR (EASU) requires TAA because it needs a texture node with .sample() support
  const fsrActive = graphicsSettings.upscalingMode === 'easu' && graphicsSettings.renderScale < 1;
  const fsrRequiresTaa = graphicsSettings.upscalingMode === 'easu';

  return (
    <div
      style={{
        position: 'absolute',
        top: '50px',
        right: '10px',
        backgroundColor: 'rgba(10, 10, 12, 0.98)',
        border: '1px solid #333',
        borderRadius: '8px',
        padding: '12px',
        color: 'white',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '12px',
        zIndex: 1000,
        width: '280px',
        maxHeight: '80vh',
        overflowY: 'auto',
        pointerEvents: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
        paddingBottom: '8px',
        borderBottom: '1px solid #222',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>Graphics</span>
          <span style={{
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '9px',
            fontWeight: 600,
            backgroundColor: isWebGPU ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
            color: isWebGPU ? '#22c55e' : '#eab308',
            border: `1px solid ${isWebGPU ? '#22c55e40' : '#eab30840'}`,
          }}>
            {rendererAPI || 'Unknown'}
          </span>
        </div>
        <button
          onClick={() => toggleGraphicsOptions()}
          style={{
            background: 'none',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '4px',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Master Post-Processing Toggle */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 10px',
        marginBottom: '12px',
        backgroundColor: '#1a1a1c',
        borderRadius: '6px',
      }}>
        <span style={{ fontSize: '11px', fontWeight: 500 }}>Post-Processing</span>
        <Toggle
          enabled={graphicsSettings.postProcessingEnabled}
          onChange={() => handleToggle('postProcessingEnabled')}
        />
      </div>

      {/* ===== RESOLUTION ===== */}
      <SectionHeader
        title="Resolution"
        expanded={expanded.resolution}
        onToggle={() => toggleSection('resolution')}
      />
      {expanded.resolution && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ marginBottom: '8px' }}>
            <span style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>
              Resolution Mode
            </span>
            <SegmentedControl
              options={[
                { value: 'native', label: 'Native' },
                { value: 'fixed', label: 'Fixed' },
                { value: 'percentage', label: 'Scale' },
              ]}
              value={graphicsSettings.resolutionMode}
              onChange={(v) => setResolutionMode(v as ResolutionMode)}
            />
            <div style={{ fontSize: '9px', color: '#555', marginTop: '4px' }}>
              {graphicsSettings.resolutionMode === 'native' && 'Uses window size with DPR cap'}
              {graphicsSettings.resolutionMode === 'fixed' && 'Renders at a fixed resolution'}
              {graphicsSettings.resolutionMode === 'percentage' && 'Percentage of native resolution'}
            </div>
          </div>

          {graphicsSettings.resolutionMode === 'fixed' && (
            <div style={{ marginBottom: '8px' }}>
              <span style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>
                Target Resolution
              </span>
              <SegmentedControl
                options={[
                  { value: '720p', label: '720p' },
                  { value: '1080p', label: '1080p' },
                  { value: '1440p', label: '1440p' },
                  { value: '4k', label: '4K' },
                ]}
                value={graphicsSettings.fixedResolution}
                onChange={(v) => setFixedResolution(v as FixedResolution)}
              />
              <div style={{ fontSize: '9px', color: '#555', marginTop: '4px' }}>
                {FIXED_RESOLUTIONS[graphicsSettings.fixedResolution].label}
              </div>
            </div>
          )}

          {graphicsSettings.resolutionMode === 'percentage' && (
            <CompactSlider
              label="Resolution Scale"
              value={graphicsSettings.resolutionScale}
              min={0.5}
              max={1}
              step={0.05}
              onChange={(v) => setGraphicsSetting('resolutionScale', v)}
              format={(v) => `${Math.round(v * 100)}`}
              suffix="%"
            />
          )}

          <CompactSlider
            label="Max Pixel Ratio"
            value={graphicsSettings.maxPixelRatio}
            min={1}
            max={3}
            step={0.5}
            onChange={(v) => setGraphicsSetting('maxPixelRatio', v)}
            format={(v) => v.toFixed(1)}
            suffix="x"
          />
          <div style={{ fontSize: '9px', color: '#555', marginTop: '2px', marginBottom: '4px' }}>
            Caps high-DPI rendering (lower = faster on Retina/4K displays)
          </div>
        </div>
      )}

      {/* ===== PERFORMANCE ===== */}
      <SectionHeader
        title="Upscaling"
        expanded={expanded.performance}
        onToggle={() => toggleSection('performance')}
        badge="performance"
      />
      {expanded.performance && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ marginBottom: '8px' }}>
            <span style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>
              Upscaling Mode
            </span>
            <SegmentedControl
              options={[
                { value: 'off', label: 'Native' },
                { value: 'easu', label: 'FSR', hint: 'Requires TAA anti-aliasing' },
                { value: 'bilinear', label: 'Bilinear' },
              ]}
              value={graphicsSettings.upscalingMode}
              onChange={(v) => {
                // Auto-enable TAA when FSR is selected
                if (v === 'easu' && graphicsSettings.antiAliasingMode !== 'taa') {
                  setAntiAliasingMode('taa');
                }
                setUpscalingMode(v as UpscalingMode);
              }}
            />
            <div style={{ fontSize: '9px', color: '#555', marginTop: '4px' }}>
              {graphicsSettings.upscalingMode === 'off' && 'Full resolution rendering'}
              {graphicsSettings.upscalingMode === 'easu' && 'AMD FSR 1.0 edge-adaptive upscaling'}
              {graphicsSettings.upscalingMode === 'bilinear' && 'Fast GPU bilinear filtering'}
            </div>
          </div>

          {/* FSR requires TAA warning */}
          {graphicsSettings.upscalingMode === 'easu' && graphicsSettings.antiAliasingMode !== 'taa' && (
            <HintBox type="warning">
              FSR requires TAA for edge-adaptive upscaling. TAA has been auto-enabled.
            </HintBox>
          )}

          {graphicsSettings.upscalingMode !== 'off' && (
            <>
              <CompactSlider
                label="Render Scale"
                value={graphicsSettings.renderScale}
                min={0.5}
                max={1}
                step={0.05}
                onChange={(v) => setGraphicsSetting('renderScale', v)}
                format={(v) => `${Math.round(v * 100)}`}
                suffix="%"
              />
              {graphicsSettings.upscalingMode === 'easu' && (
                <CompactSlider
                  label="Edge Sharpness"
                  value={graphicsSettings.easuSharpness}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => setGraphicsSetting('easuSharpness', v)}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* ===== ANTI-ALIASING ===== */}
      <SectionHeader
        title="Anti-Aliasing"
        expanded={expanded.antialiasing}
        onToggle={() => toggleSection('antialiasing')}
        badge="quality"
      />
      {expanded.antialiasing && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ marginBottom: '8px' }}>
            <SegmentedControl
              options={[
                { value: 'off', label: 'Off', hint: fsrRequiresTaa ? 'Disabled: FSR requires TAA' : undefined },
                { value: 'fxaa', label: 'FXAA', hint: fsrRequiresTaa ? 'Disabled: FSR requires TAA' : undefined },
                { value: 'taa', label: 'TAA' },
              ]}
              value={graphicsSettings.antiAliasingMode}
              onChange={(v) => {
                // If FSR is enabled and user tries to switch away from TAA, switch FSR to bilinear
                if (graphicsSettings.upscalingMode === 'easu' && v !== 'taa') {
                  setUpscalingMode('bilinear');
                }
                setAntiAliasingMode(v as AntiAliasingMode);
              }}
              disabledOptions={fsrRequiresTaa ? ['off', 'fxaa'] : []}
            />
            {fsrRequiresTaa && (
              <div style={{ fontSize: '9px', color: '#eab308', marginTop: '4px' }}>
                TAA required for FSR upscaling
              </div>
            )}
          </div>
          {graphicsSettings.antiAliasingMode === 'taa' && (
            <>
              {/* Sharpening is disabled when FSR is active (FSR has its own edge enhancement) */}
              {fsrActive ? (
                <HintBox type="info">
                  RCAS sharpening disabled when FSR is active (FSR includes edge enhancement)
                </HintBox>
              ) : (
                <>
                  <ToggleRow
                    label="RCAS Sharpening"
                    enabled={graphicsSettings.taaSharpeningEnabled}
                    onChange={() => handleToggle('taaSharpeningEnabled')}
                  />
                  {graphicsSettings.taaSharpeningEnabled && (
                    <CompactSlider
                      label="Intensity"
                      value={graphicsSettings.taaSharpeningIntensity}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => setGraphicsSetting('taaSharpeningIntensity', v)}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ===== LIGHTING ===== */}
      <SectionHeader
        title="Lighting & Shadows"
        expanded={expanded.lighting}
        onToggle={() => toggleSection('lighting')}
        badge="performance"
      />
      {expanded.lighting && (
        <div style={{ marginBottom: '12px' }}>
          {/* Shadows */}
          <ToggleRow
            label="Shadows"
            enabled={graphicsSettings.shadowsEnabled}
            onChange={() => handleToggle('shadowsEnabled')}
          />
          {graphicsSettings.shadowsEnabled && (
            <div style={{ marginLeft: '12px', marginBottom: '8px' }}>
              <div style={{ marginBottom: '6px' }}>
                <span style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>
                  Quality
                </span>
                <SegmentedControl
                  options={[
                    { value: 'low', label: 'Low' },
                    { value: 'medium', label: 'Med' },
                    { value: 'high', label: 'High' },
                    { value: 'ultra', label: 'Ultra' },
                  ]}
                  value={graphicsSettings.shadowQuality}
                  onChange={(v) => setGraphicsSetting('shadowQuality', v as 'low' | 'medium' | 'high' | 'ultra')}
                />
              </div>
              <CompactSlider
                label="Distance"
                value={graphicsSettings.shadowDistance}
                min={50}
                max={200}
                step={10}
                onChange={(v) => setGraphicsSetting('shadowDistance', v)}
                format={(v) => v.toString()}
              />
            </div>
          )}

          {/* Ambient Occlusion */}
          <ToggleRow
            label="Ambient Occlusion"
            enabled={graphicsSettings.ssaoEnabled}
            onChange={() => handleToggle('ssaoEnabled')}
          />
          {graphicsSettings.ssaoEnabled && (
            <div style={{ marginLeft: '12px', marginBottom: '8px' }}>
              <CompactSlider
                label="Radius"
                value={graphicsSettings.ssaoRadius}
                min={1}
                max={16}
                step={0.5}
                onChange={(v) => setGraphicsSetting('ssaoRadius', v)}
                format={(v) => v.toFixed(1)}
              />
              <CompactSlider
                label="Intensity"
                value={graphicsSettings.ssaoIntensity}
                min={0}
                max={2}
                step={0.1}
                onChange={(v) => setGraphicsSetting('ssaoIntensity', v)}
              />
            </div>
          )}

          {/* Environment */}
          <ToggleRow
            label="Environment Lighting"
            enabled={graphicsSettings.environmentMapEnabled}
            onChange={() => handleToggle('environmentMapEnabled')}
          />
        </div>
      )}

      {/* ===== REFLECTIONS ===== */}
      <SectionHeader
        title="Reflections"
        expanded={expanded.reflections}
        onToggle={() => toggleSection('reflections')}
        badge="performance"
        masterToggle={{
          enabled: graphicsSettings.ssrEnabled,
          onChange: () => handleToggle('ssrEnabled'),
        }}
      />
      {expanded.reflections && graphicsSettings.ssrEnabled && (
        <div style={{ marginBottom: '12px' }}>
          <CompactSlider
            label="Intensity"
            value={graphicsSettings.ssrOpacity}
            min={0}
            max={1}
            step={0.1}
            onChange={(v) => setGraphicsSetting('ssrOpacity', v)}
          />
          <CompactSlider
            label="Max Roughness"
            value={graphicsSettings.ssrMaxRoughness}
            min={0}
            max={1}
            step={0.1}
            onChange={(v) => setGraphicsSetting('ssrMaxRoughness', v)}
          />
        </div>
      )}

      {/* ===== GLOBAL ILLUMINATION ===== */}
      <SectionHeader
        title="Global Illumination"
        expanded={expanded.gi}
        onToggle={() => toggleSection('gi')}
        badge="performance"
        masterToggle={{
          enabled: graphicsSettings.ssgiEnabled,
          onChange: () => handleToggle('ssgiEnabled'),
        }}
      />
      {expanded.gi && graphicsSettings.ssgiEnabled && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '9px', color: '#555', marginBottom: '8px' }}>
            Realistic light bouncing between surfaces. Works best with TAA.
          </div>
          <CompactSlider
            label="Radius"
            value={graphicsSettings.ssgiRadius}
            min={1}
            max={25}
            step={1}
            onChange={(v) => setGraphicsSetting('ssgiRadius', v)}
            format={(v) => v.toString()}
          />
          <CompactSlider
            label="Intensity"
            value={graphicsSettings.ssgiIntensity}
            min={0}
            max={50}
            step={1}
            onChange={(v) => setGraphicsSetting('ssgiIntensity', v)}
            format={(v) => v.toString()}
          />
        </div>
      )}

      {/* ===== EFFECTS ===== */}
      <SectionHeader
        title="Effects"
        expanded={expanded.effects}
        onToggle={() => toggleSection('effects')}
      />
      {expanded.effects && (
        <div style={{ marginBottom: '12px' }}>
          {/* Bloom */}
          <ToggleRow
            label="Bloom"
            enabled={graphicsSettings.bloomEnabled}
            onChange={() => handleToggle('bloomEnabled')}
          />
          {graphicsSettings.bloomEnabled && (
            <div style={{ marginLeft: '12px', marginBottom: '8px' }}>
              <CompactSlider
                label="Strength"
                value={graphicsSettings.bloomStrength}
                min={0}
                max={1.5}
                step={0.05}
                onChange={(v) => setGraphicsSetting('bloomStrength', v)}
              />
              <CompactSlider
                label="Threshold"
                value={graphicsSettings.bloomThreshold}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => setGraphicsSetting('bloomThreshold', v)}
              />
              <CompactSlider
                label="Radius"
                value={graphicsSettings.bloomRadius}
                min={0}
                max={2}
                step={0.1}
                onChange={(v) => setGraphicsSetting('bloomRadius', v)}
              />
            </div>
          )}

          {/* Fog */}
          <ToggleRow
            label="Atmospheric Fog"
            enabled={graphicsSettings.fogEnabled}
            onChange={() => handleToggle('fogEnabled')}
          />
          {graphicsSettings.fogEnabled && (
            <div style={{ marginLeft: '12px', marginBottom: '8px' }}>
              <CompactSlider
                label="Density"
                value={graphicsSettings.fogDensity}
                min={0.5}
                max={2}
                step={0.1}
                onChange={(v) => setGraphicsSetting('fogDensity', v)}
                format={(v) => v.toFixed(1)}
                suffix="x"
              />
            </div>
          )}

          {/* Particles */}
          <ToggleRow
            label="Particles"
            enabled={graphicsSettings.particlesEnabled}
            onChange={() => handleToggle('particlesEnabled')}
          />
          {graphicsSettings.particlesEnabled && (
            <div style={{ marginLeft: '12px', marginBottom: '8px' }}>
              <CompactSlider
                label="Density"
                value={graphicsSettings.particleDensity}
                min={1}
                max={10}
                step={0.5}
                onChange={(v) => setGraphicsSetting('particleDensity', v)}
                format={(v) => (v / 5).toFixed(1)}
                suffix="x"
              />
            </div>
          )}

          {/* Vignette */}
          <ToggleRow
            label="Vignette"
            enabled={graphicsSettings.vignetteEnabled}
            onChange={() => handleToggle('vignetteEnabled')}
          />
          {graphicsSettings.vignetteEnabled && (
            <div style={{ marginLeft: '12px', marginBottom: '8px' }}>
              <CompactSlider
                label="Intensity"
                value={graphicsSettings.vignetteIntensity}
                min={0}
                max={0.6}
                step={0.05}
                onChange={(v) => setGraphicsSetting('vignetteIntensity', v)}
              />
            </div>
          )}
        </div>
      )}

      {/* ===== COLOR GRADING ===== */}
      <SectionHeader
        title="Color"
        expanded={expanded.color}
        onToggle={() => toggleSection('color')}
      />
      {expanded.color && (
        <div style={{ marginBottom: '12px' }}>
          <CompactSlider
            label="Exposure"
            value={graphicsSettings.toneMappingExposure}
            min={0.5}
            max={2}
            step={0.05}
            onChange={(v) => setGraphicsSetting('toneMappingExposure', v)}
          />
          <CompactSlider
            label="Saturation"
            value={graphicsSettings.saturation}
            min={0.5}
            max={1.5}
            step={0.05}
            onChange={(v) => setGraphicsSetting('saturation', v)}
          />
          <CompactSlider
            label="Contrast"
            value={graphicsSettings.contrast}
            min={0.8}
            max={1.3}
            step={0.05}
            onChange={(v) => setGraphicsSetting('contrast', v)}
          />
        </div>
      )}

      {/* ===== DISPLAY ===== */}
      <div style={{
        paddingTop: '8px',
        borderTop: '1px solid #222',
        marginTop: '4px',
      }}>
        <ToggleRow
          label="FPS Counter"
          enabled={showFPS}
          onChange={() => toggleFPS()}
        />
      </div>

      {/* ===== PERFORMANCE METRICS ===== */}
      <PerformanceMetricsDisplay />
    </div>
  );
});
