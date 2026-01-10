'use client';

import React from 'react';
import { useUIStore, GraphicsSettings } from '@/store/uiStore';

const buttonStyle = (enabled: boolean) => ({
  padding: '4px 12px',
  backgroundColor: enabled ? '#2a5a2a' : '#5a2a2a',
  border: 'none',
  borderRadius: '4px',
  color: 'white',
  cursor: 'pointer',
  fontSize: '11px',
  minWidth: '50px',
});

const sliderStyle = { width: '100%', marginTop: '4px' };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '2px', color: '#888', fontSize: '11px' };
const sectionStyle: React.CSSProperties = { marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #333' };

/**
 * In-game graphics options panel
 * Access via Options menu -> Graphics
 * Each effect has its toggle followed by related sliders
 */
export function GraphicsOptionsPanel() {
  const showGraphicsOptions = useUIStore((state) => state.showGraphicsOptions);
  const graphicsSettings = useUIStore((state) => state.graphicsSettings);
  const toggleGraphicsOptions = useUIStore((state) => state.toggleGraphicsOptions);
  const toggleGraphicsSetting = useUIStore((state) => state.toggleGraphicsSetting);
  const setGraphicsSetting = useUIStore((state) => state.setGraphicsSetting);

  if (!showGraphicsOptions) return null;

  const handleToggle = (key: keyof GraphicsSettings) => {
    toggleGraphicsSetting(key);
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: '50px',
        right: '10px',
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        border: '1px solid #444',
        borderRadius: '8px',
        padding: '16px',
        color: 'white',
        fontFamily: 'monospace',
        fontSize: '13px',
        zIndex: 1000,
        minWidth: '300px',
        maxHeight: '80vh',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '14px' }}>Graphics Options</h3>
        <button
          onClick={() => toggleGraphicsOptions()}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: '16px',
          }}
        >
          ✕
        </button>
      </div>

      {/* === POST-PROCESSING MASTER === */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontWeight: 'bold' }}>Post-Processing (Master)</span>
          <button
            onClick={() => handleToggle('postProcessingEnabled')}
            style={buttonStyle(graphicsSettings.postProcessingEnabled)}
          >
            {graphicsSettings.postProcessingEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div>
          <label style={labelStyle}>
            Tone Mapping Exposure: {graphicsSettings.toneMappingExposure.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.05"
            value={graphicsSettings.toneMappingExposure}
            onChange={(e) => setGraphicsSetting('toneMappingExposure', parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>
      </div>

      {/* === SSAO === */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span>SSAO (Ambient Occlusion)</span>
          <button
            onClick={() => handleToggle('ssaoEnabled')}
            style={buttonStyle(graphicsSettings.ssaoEnabled)}
          >
            {graphicsSettings.ssaoEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div>
          <label style={labelStyle}>
            Radius: {graphicsSettings.ssaoRadius}
          </label>
          <input
            type="range"
            min="4"
            max="32"
            step="2"
            value={graphicsSettings.ssaoRadius}
            onChange={(e) => setGraphicsSetting('ssaoRadius', parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>
      </div>

      {/* === BLOOM === */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span>Bloom</span>
          <button
            onClick={() => handleToggle('bloomEnabled')}
            style={buttonStyle(graphicsSettings.bloomEnabled)}
          >
            {graphicsSettings.bloomEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div style={{ marginBottom: '8px' }}>
          <label style={labelStyle}>
            Strength: {graphicsSettings.bloomStrength.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.05"
            value={graphicsSettings.bloomStrength}
            onChange={(e) => setGraphicsSetting('bloomStrength', parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>
        <div style={{ marginBottom: '8px' }}>
          <label style={labelStyle}>
            Threshold: {graphicsSettings.bloomThreshold.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={graphicsSettings.bloomThreshold}
            onChange={(e) => setGraphicsSetting('bloomThreshold', parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>
            Radius: {graphicsSettings.bloomRadius.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={graphicsSettings.bloomRadius}
            onChange={(e) => setGraphicsSetting('bloomRadius', parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>
      </div>

      {/* === OUTLINE === */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span>Selection Outline</span>
          <button
            onClick={() => handleToggle('outlineEnabled')}
            style={buttonStyle(graphicsSettings.outlineEnabled)}
          >
            {graphicsSettings.outlineEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div>
          <label style={labelStyle}>
            Strength: {graphicsSettings.outlineStrength.toFixed(1)}
          </label>
          <input
            type="range"
            min="0.5"
            max="10"
            step="0.5"
            value={graphicsSettings.outlineStrength}
            onChange={(e) => setGraphicsSetting('outlineStrength', parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>
      </div>

      {/* === FXAA === */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Anti-Aliasing (FXAA)</span>
          <button
            onClick={() => handleToggle('fxaaEnabled')}
            style={buttonStyle(graphicsSettings.fxaaEnabled)}
          >
            {graphicsSettings.fxaaEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* === PARTICLES === */}
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span>Ambient Particles</span>
          <button
            onClick={() => handleToggle('particlesEnabled')}
            style={buttonStyle(graphicsSettings.particlesEnabled)}
          >
            {graphicsSettings.particlesEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div>
          <label style={labelStyle}>
            Density: {graphicsSettings.particleDensity.toFixed(1)}x
          </label>
          <input
            type="range"
            min="0.5"
            max="5"
            step="0.5"
            value={graphicsSettings.particleDensity}
            onChange={(e) => setGraphicsSetting('particleDensity', parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>
      </div>
    </div>
  );
}
