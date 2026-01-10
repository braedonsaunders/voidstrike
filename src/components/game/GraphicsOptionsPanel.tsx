'use client';

import React from 'react';
import { useUIStore, GraphicsSettings } from '@/store/uiStore';

/**
 * In-game graphics options panel
 * Access via Options menu -> Graphics
 */
export function GraphicsOptionsPanel() {
  const {
    showGraphicsOptions,
    graphicsSettings,
    toggleGraphicsOptions,
    toggleGraphicsSetting,
    setGraphicsSetting,
  } = useUIStore();

  if (!showGraphicsOptions) return null;

  const toggleOptions: Array<{ key: keyof GraphicsSettings; label: string }> = [
    { key: 'postProcessingEnabled', label: 'Post-Processing (Master)' },
    { key: 'bloomEnabled', label: 'Bloom' },
    { key: 'fxaaEnabled', label: 'Anti-Aliasing (FXAA)' },
    { key: 'groundFogEnabled', label: 'Ground Fog' },
    { key: 'particlesEnabled', label: 'Ambient Particles' },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        top: '50px',
        right: '10px',
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        border: '1px solid #444',
        borderRadius: '8px',
        padding: '16px',
        color: 'white',
        fontFamily: 'monospace',
        fontSize: '13px',
        zIndex: 1000,
        minWidth: '280px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '14px' }}>Graphics Options</h3>
        <button
          onClick={toggleGraphicsOptions}
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

      <div style={{ borderBottom: '1px solid #333', marginBottom: '12px', paddingBottom: '8px' }}>
        <span style={{ color: '#888', fontSize: '11px' }}>Using Three.js EffectComposer</span>
      </div>

      {toggleOptions.map(({ key, label }) => (
        <div
          key={key}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 0',
            borderBottom: '1px solid #222',
          }}
        >
          <span style={{ color: graphicsSettings[key] ? '#fff' : '#666' }}>{label}</span>
          <button
            onClick={() => toggleGraphicsSetting(key)}
            style={{
              padding: '4px 12px',
              backgroundColor: graphicsSettings[key] ? '#2a5a2a' : '#5a2a2a',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '11px',
              minWidth: '50px',
            }}
          >
            {graphicsSettings[key] ? 'ON' : 'OFF'}
          </button>
        </div>
      ))}

      <div style={{ marginTop: '16px', borderTop: '1px solid #333', paddingTop: '12px' }}>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', color: '#aaa', fontSize: '11px' }}>
            Bloom Strength: {graphicsSettings.bloomStrength.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={graphicsSettings.bloomStrength}
            onChange={(e) => setGraphicsSetting('bloomStrength', parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '4px', color: '#aaa', fontSize: '11px' }}>
            Bloom Threshold: {graphicsSettings.bloomThreshold.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.5"
            max="1"
            step="0.05"
            value={graphicsSettings.bloomThreshold}
            onChange={(e) => setGraphicsSetting('bloomThreshold', parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </div>
  );
}
