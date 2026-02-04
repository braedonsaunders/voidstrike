'use client';

import React, { memo } from 'react';
import { useUIStore } from '@/store/uiStore';
import { PerformanceDashboard } from './PerformanceDashboard';
import { PerformanceRecorder } from './PerformanceRecorder';
import { BasePanel } from './BasePanel';

/**
 * Performance Panel - Centralized performance monitoring
 * Contains settings toggle and the unified PerformanceDashboard
 * NOTE: Edge scrolling is now controlled centrally by HUD.tsx via isAnyMenuOpen selector
 */
export const PerformancePanel = memo(function PerformancePanel() {
  const showPerformancePanel = useUIStore((state) => state.showPerformancePanel);
  const togglePerformancePanel = useUIStore((state) => state.togglePerformancePanel);
  const showFPS = useUIStore((state) => state.showFPS);
  const toggleFPS = useUIStore((state) => state.toggleFPS);

  if (!showPerformancePanel) return null;

  return (
    <BasePanel
      title="Performance"
      onClose={togglePerformancePanel}
      width={280}
      testId="performance-panel"
    >
      {/* FPS Counter Toggle */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 10px',
        marginBottom: '12px',
        backgroundColor: '#1a1a1c',
        borderRadius: '6px',
      }}>
        <span style={{ fontSize: '11px', color: '#aaa' }}>FPS Counter (In-Game)</span>
        <button
          onClick={() => toggleFPS()}
          style={{
            width: '36px',
            height: '18px',
            borderRadius: '9px',
            border: 'none',
            backgroundColor: showFPS ? '#22c55e' : '#444',
            cursor: 'pointer',
            position: 'relative',
            transition: 'background-color 0.15s',
          }}
        >
          <div style={{
            width: '14px',
            height: '14px',
            borderRadius: '7px',
            backgroundColor: '#fff',
            position: 'absolute',
            top: '2px',
            left: showFPS ? '20px' : '2px',
            transition: 'left 0.15s',
            boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
          }} />
        </button>
      </div>

      {/* Unified Performance Dashboard */}
      <PerformanceDashboard expanded={true} />

      {/* Performance Recorder */}
      <PerformanceRecorder />
    </BasePanel>
  );
});
