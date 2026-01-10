'use client';

import React from 'react';
import { useUIStore, DebugSettings } from '@/store/uiStore';
import { isMultiplayerMode } from '@/store/gameSetupStore';

interface DebugSettingInfo {
  key: keyof DebugSettings;
  label: string;
}

const renderingSettings: DebugSettingInfo[] = [
  { key: 'debugAnimation', label: 'Animation' },
  { key: 'debugMesh', label: 'Mesh / Geometry' },
  { key: 'debugTerrain', label: 'Terrain' },
  { key: 'debugShaders', label: 'Shaders' },
  { key: 'debugPostProcessing', label: 'Post-Processing' },
];

const gameplaySettings: DebugSettingInfo[] = [
  { key: 'debugBuildingPlacement', label: 'Building Placement' },
  { key: 'debugCombat', label: 'Combat' },
  { key: 'debugResources', label: 'Resources' },
  { key: 'debugProduction', label: 'Production' },
  { key: 'debugSpawning', label: 'Spawning' },
];

const systemSettings: DebugSettingInfo[] = [
  { key: 'debugAI', label: 'AI' },
  { key: 'debugPathfinding', label: 'Pathfinding' },
];

const otherSettings: DebugSettingInfo[] = [
  { key: 'debugAssets', label: 'Asset Loading' },
  { key: 'debugInitialization', label: 'Initialization' },
  { key: 'debugAudio', label: 'Audio' },
];

/**
 * In-game debug menu panel
 * Access via Options menu -> Debug
 * Controls which debug logging categories are enabled
 */
export function DebugMenuPanel() {
  const {
    showDebugMenu,
    debugSettings,
    toggleDebugMenu,
    toggleDebugSetting,
    setAllDebugSettings,
  } = useUIStore();

  // Hide debug menu in multiplayer mode (multiple human players)
  if (!showDebugMenu || isMultiplayerMode()) return null;

  const sectionStyle = { marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #333' };
  const labelStyle = { fontSize: '11px', color: '#888' };

  const ToggleButton = ({ enabled, onClick, small = false }: { enabled: boolean; onClick: () => void; small?: boolean }) => (
    <button
      onClick={onClick}
      style={{
        padding: small ? '2px 8px' : '4px 12px',
        backgroundColor: enabled ? '#2a5a2a' : '#5a2a2a',
        border: 'none',
        borderRadius: '4px',
        color: 'white',
        cursor: 'pointer',
        fontSize: small ? '10px' : '11px',
        minWidth: small ? '40px' : '50px',
      }}
    >
      {enabled ? 'ON' : 'OFF'}
    </button>
  );

  const SettingRow = ({ setting }: { setting: DebugSettingInfo }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
      <span style={{ fontSize: '12px' }}>{setting.label}</span>
      <ToggleButton
        enabled={debugSettings[setting.key] as boolean}
        onClick={() => toggleDebugSetting(setting.key)}
        small
      />
    </div>
  );

  const SectionHeader = ({ title }: { title: string }) => (
    <div style={{ marginBottom: '8px', fontWeight: 'bold', fontSize: '12px', color: '#aaa' }}>
      {title}
    </div>
  );

  // Count enabled settings
  const enabledCount = Object.values(debugSettings).filter(Boolean).length - (debugSettings.debugEnabled ? 1 : 0);
  const totalSettings = Object.keys(debugSettings).length - 1; // Exclude master toggle

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
        minWidth: '280px',
        maxHeight: '80vh',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '14px' }}>Debug Menu</h3>
        <button
          onClick={toggleDebugMenu}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: '16px',
          }}
        >
          X
        </button>
      </div>

      {/* === MASTER TOGGLE === */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontWeight: 'bold' }}>Debug Logging (Master)</span>
          <ToggleButton
            enabled={debugSettings.debugEnabled}
            onClick={() => toggleDebugSetting('debugEnabled')}
          />
        </div>
        <div style={labelStyle}>
          {enabledCount}/{totalSettings} categories enabled
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button
            onClick={() => setAllDebugSettings(true)}
            style={{
              flex: 1,
              padding: '4px 8px',
              backgroundColor: '#2a4a5a',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '10px',
            }}
          >
            Enable All
          </button>
          <button
            onClick={() => setAllDebugSettings(false)}
            style={{
              flex: 1,
              padding: '4px 8px',
              backgroundColor: '#4a3a3a',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '10px',
            }}
          >
            Disable All
          </button>
        </div>
      </div>

      {/* === RENDERING === */}
      <div style={sectionStyle}>
        <SectionHeader title="Rendering" />
        {renderingSettings.map((setting) => (
          <SettingRow key={setting.key} setting={setting} />
        ))}
      </div>

      {/* === GAMEPLAY === */}
      <div style={sectionStyle}>
        <SectionHeader title="Gameplay" />
        {gameplaySettings.map((setting) => (
          <SettingRow key={setting.key} setting={setting} />
        ))}
      </div>

      {/* === SYSTEMS === */}
      <div style={sectionStyle}>
        <SectionHeader title="Systems" />
        {systemSettings.map((setting) => (
          <SettingRow key={setting.key} setting={setting} />
        ))}
      </div>

      {/* === OTHER === */}
      <div style={{ marginBottom: '8px' }}>
        <SectionHeader title="Other" />
        {otherSettings.map((setting) => (
          <SettingRow key={setting.key} setting={setting} />
        ))}
      </div>

      {/* Info */}
      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #333', fontSize: '10px', color: '#666' }}>
        Debug logs appear in browser console (F12)
      </div>
    </div>
  );
}
