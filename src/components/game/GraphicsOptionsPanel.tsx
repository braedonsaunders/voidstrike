'use client';

import React, { useEffect, memo } from 'react';
import { useUIStore, GraphicsSettings, RendererAPI, AntiAliasingMode, UpscalingMode } from '@/store/uiStore';
import { setEdgeScrollEnabled } from '@/store/cameraStore';

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

const selectStyle: React.CSSProperties = {
  padding: '4px 8px',
  backgroundColor: '#333',
  border: '1px solid #555',
  borderRadius: '4px',
  color: 'white',
  cursor: 'pointer',
  fontSize: '11px',
};

const sliderStyle = { width: '100%', marginTop: '4px' };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '2px', color: '#888', fontSize: '11px' };
const sectionStyle: React.CSSProperties = { marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #333' };
const sectionTitleStyle: React.CSSProperties = { fontWeight: 'bold', marginBottom: '8px', color: '#ddd', fontSize: '12px' };

/**
 * In-game graphics options panel - AAA Quality Controls
 * Access via Options menu -> Graphics
 * WebGPU-compatible effects only
 * PERF: Wrapped in memo to prevent unnecessary re-renders
 */
export const GraphicsOptionsPanel = memo(function GraphicsOptionsPanel() {
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

  // Disable edge scrolling when panel is open
  useEffect(() => {
    if (showGraphicsOptions) {
      setEdgeScrollEnabled(false);
      return () => {
        setEdgeScrollEnabled(true);
      };
    }
  }, [showGraphicsOptions]);

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
        minWidth: '320px',
        maxHeight: '80vh',
        overflowY: 'auto',
        pointerEvents: 'auto',
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '14px' }}>⚙ Graphics Options</h3>
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

      {/* Renderer API Indicator */}
      <div style={{ ...sectionStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#888', fontSize: '12px' }}>Renderer</span>
        <span
          style={{
            padding: '3px 10px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 'bold',
            backgroundColor: rendererAPI === 'WebGPU' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)',
            color: rendererAPI === 'WebGPU' ? '#22c55e' : '#eab308',
            border: `1px solid ${rendererAPI === 'WebGPU' ? '#22c55e' : '#eab308'}`,
          }}
        >
          {rendererAPI || 'Unknown'}
        </span>
      </div>

      {/* === POST-PROCESSING MASTER === */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={sectionTitleStyle}>Post-Processing</span>
          <button
            onClick={() => handleToggle('postProcessingEnabled')}
            style={buttonStyle(graphicsSettings.postProcessingEnabled)}
          >
            {graphicsSettings.postProcessingEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* === SHADOWS === */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Shadows</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span>Enable Shadows</span>
          <button
            onClick={() => handleToggle('shadowsEnabled')}
            style={buttonStyle(graphicsSettings.shadowsEnabled)}
          >
            {graphicsSettings.shadowsEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div style={{ marginBottom: '8px' }}>
          <label style={labelStyle}>Quality</label>
          <select
            value={graphicsSettings.shadowQuality}
            onChange={(e) => setGraphicsSetting('shadowQuality', e.target.value as 'low' | 'medium' | 'high' | 'ultra')}
            style={selectStyle}
            disabled={!graphicsSettings.shadowsEnabled}
          >
            <option value="low">Low (512)</option>
            <option value="medium">Medium (1024)</option>
            <option value="high">High (2048)</option>
            <option value="ultra">Ultra (4096)</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>
            Distance: {graphicsSettings.shadowDistance}
          </label>
          <input
            type="range"
            min="50"
            max="200"
            step="10"
            value={graphicsSettings.shadowDistance}
            onChange={(e) => setGraphicsSetting('shadowDistance', parseFloat(e.target.value))}
            style={sliderStyle}
            disabled={!graphicsSettings.shadowsEnabled}
          />
        </div>
      </div>

      {/* === AMBIENT OCCLUSION === */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Ambient Occlusion (SSAO)</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span>Enable SSAO</span>
          <button
            onClick={() => handleToggle('ssaoEnabled')}
            style={buttonStyle(graphicsSettings.ssaoEnabled)}
          >
            {graphicsSettings.ssaoEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div style={{ marginBottom: '8px' }}>
          <label style={labelStyle}>
            Radius: {graphicsSettings.ssaoRadius.toFixed(1)}
          </label>
          <input
            type="range"
            min="1"
            max="16"
            step="0.5"
            value={graphicsSettings.ssaoRadius}
            onChange={(e) => setGraphicsSetting('ssaoRadius', parseFloat(e.target.value))}
            style={sliderStyle}
            disabled={!graphicsSettings.ssaoEnabled}
          />
        </div>
        <div>
          <label style={labelStyle}>
            Intensity: {graphicsSettings.ssaoIntensity.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={graphicsSettings.ssaoIntensity}
            onChange={(e) => setGraphicsSetting('ssaoIntensity', parseFloat(e.target.value))}
            style={sliderStyle}
            disabled={!graphicsSettings.ssaoEnabled}
          />
        </div>
      </div>

      {/* === BLOOM === */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Bloom</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span>Enable Bloom</span>
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
            disabled={!graphicsSettings.bloomEnabled}
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
            disabled={!graphicsSettings.bloomEnabled}
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
            disabled={!graphicsSettings.bloomEnabled}
          />
        </div>
      </div>

      {/* === COLOR GRADING === */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Color Grading</div>
        <div style={{ marginBottom: '8px' }}>
          <label style={labelStyle}>
            Exposure: {graphicsSettings.toneMappingExposure.toFixed(2)}
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
        <div style={{ marginBottom: '8px' }}>
          <label style={labelStyle}>
            Saturation: {graphicsSettings.saturation.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.5"
            max="1.5"
            step="0.05"
            value={graphicsSettings.saturation}
            onChange={(e) => setGraphicsSetting('saturation', parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>
            Contrast: {graphicsSettings.contrast.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.8"
            max="1.3"
            step="0.05"
            value={graphicsSettings.contrast}
            onChange={(e) => setGraphicsSetting('contrast', parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>
      </div>

      {/* === VIGNETTE === */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Vignette</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span>Enable Vignette</span>
          <button
            onClick={() => handleToggle('vignetteEnabled')}
            style={buttonStyle(graphicsSettings.vignetteEnabled)}
          >
            {graphicsSettings.vignetteEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div>
          <label style={labelStyle}>
            Intensity: {graphicsSettings.vignetteIntensity.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="0.6"
            step="0.05"
            value={graphicsSettings.vignetteIntensity}
            onChange={(e) => setGraphicsSetting('vignetteIntensity', parseFloat(e.target.value))}
            style={sliderStyle}
            disabled={!graphicsSettings.vignetteEnabled}
          />
        </div>
      </div>

      {/* === ANTI-ALIASING === */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Anti-Aliasing</div>
        <div style={{ marginBottom: '8px' }}>
          <label style={labelStyle}>Mode</label>
          <select
            value={graphicsSettings.antiAliasingMode}
            onChange={(e) => setAntiAliasingMode(e.target.value as AntiAliasingMode)}
            style={selectStyle}
          >
            <option value="off">Off</option>
            <option value="fxaa">FXAA (Recommended)</option>
          </select>
          <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
            FXAA provides fast edge smoothing with minimal performance cost
          </div>
        </div>
      </div>

      {/* === RESOLUTION UPSCALING === */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Resolution Upscaling (EASU)</div>
        <div style={{ marginBottom: '8px' }}>
          <label style={labelStyle}>Mode</label>
          <select
            value={graphicsSettings.upscalingMode}
            onChange={(e) => setUpscalingMode(e.target.value as UpscalingMode)}
            style={selectStyle}
          >
            <option value="off">Off (Native)</option>
            <option value="easu">EASU (Quality)</option>
            <option value="bilinear">Bilinear (Fast)</option>
          </select>
        </div>
        {graphicsSettings.upscalingMode !== 'off' && (
          <>
            <div style={{ marginBottom: '8px' }}>
              <label style={labelStyle}>
                Render Scale: {Math.round(graphicsSettings.renderScale * 100)}%
              </label>
              <input
                type="range"
                min="0.5"
                max="1"
                step="0.05"
                value={graphicsSettings.renderScale}
                onChange={(e) => setGraphicsSetting('renderScale', parseFloat(e.target.value))}
                style={sliderStyle}
              />
              <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
                {graphicsSettings.renderScale < 0.75 ? 'Performance' : graphicsSettings.renderScale < 0.9 ? 'Balanced' : 'Quality'}
              </div>
            </div>
            {graphicsSettings.upscalingMode === 'easu' && (
              <div>
                <label style={labelStyle}>
                  Edge Sharpness: {graphicsSettings.easuSharpness.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={graphicsSettings.easuSharpness}
                  onChange={(e) => setGraphicsSetting('easuSharpness', parseFloat(e.target.value))}
                  style={sliderStyle}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* === FOG === */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Atmospheric Fog</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span>Enable Fog</span>
          <button
            onClick={() => handleToggle('fogEnabled')}
            style={buttonStyle(graphicsSettings.fogEnabled)}
          >
            {graphicsSettings.fogEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div>
          <label style={labelStyle}>
            Density: {graphicsSettings.fogDensity.toFixed(2)}x
          </label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={graphicsSettings.fogDensity}
            onChange={(e) => setGraphicsSetting('fogDensity', parseFloat(e.target.value))}
            style={sliderStyle}
            disabled={!graphicsSettings.fogEnabled}
          />
        </div>
      </div>

      {/* === ENVIRONMENT === */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Environment</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span>Environment Map (IBL)</span>
          <button
            onClick={() => handleToggle('environmentMapEnabled')}
            style={buttonStyle(graphicsSettings.environmentMapEnabled)}
          >
            {graphicsSettings.environmentMapEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* === PARTICLES === */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Particles</div>
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
            Density: {(graphicsSettings.particleDensity / 5).toFixed(1)}x
          </label>
          <input
            type="range"
            min="1"
            max="10"
            step="0.5"
            value={graphicsSettings.particleDensity}
            onChange={(e) => setGraphicsSetting('particleDensity', parseFloat(e.target.value))}
            style={sliderStyle}
            disabled={!graphicsSettings.particlesEnabled}
          />
        </div>
      </div>

      {/* === DISPLAY === */}
      <div style={{ marginBottom: '8px' }}>
        <div style={sectionTitleStyle}>Display</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Show FPS Counter</span>
          <button
            onClick={() => toggleFPS()}
            style={buttonStyle(showFPS)}
          >
            {showFPS ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
    </div>
  );
});
