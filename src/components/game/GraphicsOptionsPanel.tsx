'use client';

import React, { useEffect, useState, memo, useCallback } from 'react';
import { useUIStore, GraphicsSettings, AntiAliasingMode, UpscalingMode } from '@/store/uiStore';
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
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      backgroundColor: '#222',
      borderRadius: '4px',
      padding: '2px',
      gap: '2px',
    }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          disabled={disabled}
          style={{
            flex: 1,
            padding: '4px 8px',
            fontSize: '10px',
            border: 'none',
            borderRadius: '3px',
            backgroundColor: value === opt.value ? '#3b82f6' : 'transparent',
            color: value === opt.value ? '#fff' : '#888',
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {opt.label}
        </button>
      ))}
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
}: {
  label: string;
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
  indent?: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '6px',
      marginLeft: indent ? '12px' : 0,
    }}>
      <span style={{ fontSize: '11px', color: '#aaa' }}>{label}</span>
      <Toggle enabled={enabled} onChange={onChange} disabled={disabled} />
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

  // Section expansion state
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    performance: true,
    antialiasing: true,
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

      {/* ===== PERFORMANCE ===== */}
      <SectionHeader
        title="Performance"
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
                { value: 'easu', label: 'FSR' },
                { value: 'bilinear', label: 'Bilinear' },
              ]}
              value={graphicsSettings.upscalingMode}
              onChange={(v) => setUpscalingMode(v as UpscalingMode)}
            />
            <div style={{ fontSize: '9px', color: '#555', marginTop: '4px' }}>
              {graphicsSettings.upscalingMode === 'off' && 'Full resolution rendering'}
              {graphicsSettings.upscalingMode === 'easu' && 'AMD FSR 1.0 edge-adaptive upscaling'}
              {graphicsSettings.upscalingMode === 'bilinear' && 'Fast GPU bilinear filtering'}
            </div>
          </div>
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
                { value: 'off', label: 'Off' },
                { value: 'fxaa', label: 'FXAA' },
                { value: 'taa', label: 'TAA' },
              ]}
              value={graphicsSettings.antiAliasingMode}
              onChange={(v) => setAntiAliasingMode(v as AntiAliasingMode)}
            />
          </div>
          {graphicsSettings.antiAliasingMode === 'taa' && (
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
    </div>
  );
});
