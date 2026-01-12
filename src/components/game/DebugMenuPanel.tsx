'use client';

import React, { useEffect, useState, memo } from 'react';
import { useUIStore, DebugSettings } from '@/store/uiStore';
import { isMultiplayerMode } from '@/store/gameSetupStore';
import { setEdgeScrollEnabled } from '@/store/cameraStore';
import { PerformanceDashboard } from './PerformanceDashboard';

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
  { key: 'debugNetworking', label: 'Networking' },
  { key: 'debugPerformance', label: 'Performance' },
];

const otherSettings: DebugSettingInfo[] = [
  { key: 'debugAssets', label: 'Asset Loading' },
  { key: 'debugInitialization', label: 'Initialization' },
  { key: 'debugAudio', label: 'Audio' },
];

const sectionStyle: React.CSSProperties = { marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #333' };
const labelStyle: React.CSSProperties = { fontSize: '11px', color: '#888' };

// Extracted toggle button component
function ToggleButton({ enabled, onClick, small = false }: { enabled: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
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
}

// Extracted setting row component
function SettingRow({
  setting,
  enabled,
  onToggle
}: {
  setting: DebugSettingInfo;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
      <span style={{ fontSize: '12px' }}>{setting.label}</span>
      <ToggleButton enabled={enabled} onClick={onToggle} small />
    </div>
  );
}

// Section header component
function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ marginBottom: '8px', fontWeight: 'bold', fontSize: '12px', color: '#aaa' }}>
      {title}
    </div>
  );
}

/**
 * In-game debug menu panel
 * Access via Options menu -> Debug
 * Controls which debug logging categories are enabled
 * PERF: Wrapped in memo to prevent unnecessary re-renders
 */
export const DebugMenuPanel = memo(function DebugMenuPanel() {
  const showDebugMenu = useUIStore((state) => state.showDebugMenu);
  const debugSettings = useUIStore((state) => state.debugSettings);
  const toggleDebugMenu = useUIStore((state) => state.toggleDebugMenu);
  const toggleDebugSetting = useUIStore((state) => state.toggleDebugSetting);
  const setAllDebugSettings = useUIStore((state) => state.setAllDebugSettings);
  const [showPerformanceDashboard, setShowPerformanceDashboard] = useState(true);

  // Disable edge scrolling when panel is open
  useEffect(() => {
    if (showDebugMenu) {
      setEdgeScrollEnabled(false);
      return () => {
        setEdgeScrollEnabled(true);
      };
    }
  }, [showDebugMenu]);

  // Hide debug menu in multiplayer mode (multiple human players)
  if (!showDebugMenu || isMultiplayerMode()) return null;

  // Count enabled settings
  const enabledCount = Object.values(debugSettings).filter(Boolean).length - (debugSettings.debugEnabled ? 1 : 0);
  const totalSettings = Object.keys(debugSettings).length - 1; // Exclude master toggle

  const handleToggleSetting = (key: keyof DebugSettings) => {
    toggleDebugSetting(key);
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
        minWidth: '280px',
        maxHeight: '80vh',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '14px' }}>Debug Menu</h3>
        <button
          onClick={(e) => {
            e.preventDefault();
            toggleDebugMenu();
          }}
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

      {/* === PERFORMANCE DASHBOARD === */}
      <div style={sectionStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
            cursor: 'pointer',
          }}
          onClick={() => setShowPerformanceDashboard(!showPerformanceDashboard)}
        >
          <span style={{ fontWeight: 'bold', fontSize: '12px', color: '#4ade80' }}>
            Performance Dashboard {showPerformanceDashboard ? '▼' : '▶'}
          </span>
        </div>
        {showPerformanceDashboard && (
          <PerformanceDashboard expanded={true} />
        )}
      </div>

      {/* === MASTER TOGGLE === */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontWeight: 'bold' }}>Debug Logging (Master)</span>
          <ToggleButton
            enabled={debugSettings.debugEnabled}
            onClick={() => handleToggleSetting('debugEnabled')}
          />
        </div>
        <div style={labelStyle as React.CSSProperties}>
          {enabledCount}/{totalSettings} categories enabled
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button
            onClick={(e) => {
              e.preventDefault();
              setAllDebugSettings(true);
            }}
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
            onClick={(e) => {
              e.preventDefault();
              setAllDebugSettings(false);
            }}
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
          <SettingRow
            key={setting.key}
            setting={setting}
            enabled={debugSettings[setting.key] as boolean}
            onToggle={() => handleToggleSetting(setting.key)}
          />
        ))}
      </div>

      {/* === GAMEPLAY === */}
      <div style={sectionStyle}>
        <SectionHeader title="Gameplay" />
        {gameplaySettings.map((setting) => (
          <SettingRow
            key={setting.key}
            setting={setting}
            enabled={debugSettings[setting.key] as boolean}
            onToggle={() => handleToggleSetting(setting.key)}
          />
        ))}
      </div>

      {/* === SYSTEMS === */}
      <div style={sectionStyle}>
        <SectionHeader title="Systems" />
        {systemSettings.map((setting) => (
          <SettingRow
            key={setting.key}
            setting={setting}
            enabled={debugSettings[setting.key] as boolean}
            onToggle={() => handleToggleSetting(setting.key)}
          />
        ))}
      </div>

      {/* === OTHER === */}
      <div style={{ marginBottom: '8px' }}>
        <SectionHeader title="Other" />
        {otherSettings.map((setting) => (
          <SettingRow
            key={setting.key}
            setting={setting}
            enabled={debugSettings[setting.key] as boolean}
            onToggle={() => handleToggleSetting(setting.key)}
          />
        ))}
      </div>

      {/* Info */}
      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #333', fontSize: '10px', color: '#666' }}>
        Debug logs appear in browser console (F12)
      </div>
    </div>
  );
});
