'use client';

import React, { useEffect, memo } from 'react';
import { useUIStore } from '@/store/uiStore';
import { setEdgeScrollEnabled } from '@/store/cameraStore';
import { PerformanceDashboard } from './PerformanceDashboard';

/**
 * Performance Panel - Centralized performance monitoring and display settings
 * Combines FPS counter toggle and detailed performance dashboard
 */
export const PerformancePanel = memo(function PerformancePanel() {
  const showPerformancePanel = useUIStore((state) => state.showPerformancePanel);
  const togglePerformancePanel = useUIStore((state) => state.togglePerformancePanel);
  const showFPS = useUIStore((state) => state.showFPS);
  const toggleFPS = useUIStore((state) => state.toggleFPS);

  // Disable edge scrolling when panel is open
  useEffect(() => {
    if (showPerformancePanel) {
      setEdgeScrollEnabled(false);
      return () => setEdgeScrollEnabled(true);
    }
  }, [showPerformancePanel]);

  if (!showPerformancePanel) return null;

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
        <span style={{ fontSize: '13px', fontWeight: 600 }}>Performance</span>
        <button
          onClick={() => togglePerformancePanel()}
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

      {/* Performance Dashboard */}
      <div style={{
        borderTop: '1px solid #222',
        paddingTop: '12px',
      }}>
        <div style={{ marginBottom: '8px', fontWeight: 'bold', fontSize: '12px', color: '#4ade80' }}>
          Performance Dashboard
        </div>
        <PerformanceDashboard expanded={true} />
      </div>
    </div>
  );
});
