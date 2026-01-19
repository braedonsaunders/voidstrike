'use client';

import React, { memo } from 'react';
import { useUIStore } from '@/store/uiStore';
import { PerformanceDashboard } from './PerformanceDashboard';
import { PerformanceRecorder } from './PerformanceRecorder';

// Format number with K/M suffix for large numbers
function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

/**
 * Performance Panel - Centralized performance monitoring and display settings
 * Combines FPS counter toggle, rendering metrics, and detailed performance dashboard
 * NOTE: Edge scrolling is now controlled centrally by HUD.tsx via isAnyMenuOpen selector
 */
export const PerformancePanel = memo(function PerformancePanel() {
  const showPerformancePanel = useUIStore((state) => state.showPerformancePanel);
  const togglePerformancePanel = useUIStore((state) => state.togglePerformancePanel);
  const showFPS = useUIStore((state) => state.showFPS);
  const toggleFPS = useUIStore((state) => state.toggleFPS);
  const performanceMetrics = useUIStore((state) => state.performanceMetrics);

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

      {/* Rendering Metrics */}
      <div style={{
        marginBottom: '12px',
        padding: '10px',
        backgroundColor: '#1a1a1c',
        borderRadius: '6px',
      }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#888', marginBottom: '8px', textTransform: 'uppercase' }}>
          Rendering
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '3px 0' }}>
          <span style={{ color: '#888' }}>CPU Time</span>
          <span style={{ fontFamily: 'monospace', color: '#22d3ee' }}>{performanceMetrics.cpuTime.toFixed(1)}ms</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '3px 0' }}>
          <span style={{ color: '#888' }}>GPU Time</span>
          <span style={{ fontFamily: 'monospace', color: '#fb923c' }}>{performanceMetrics.gpuTime.toFixed(1)}ms</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '3px 0' }}>
          <span style={{ color: '#888' }}>Frame Time</span>
          <span style={{ fontFamily: 'monospace', color: '#a3a3a3' }}>{performanceMetrics.frameTime.toFixed(1)}ms</span>
        </div>
        <div style={{ borderTop: '1px solid #333', marginTop: '6px', paddingTop: '6px' }}>
          {/* Per-frame metrics (calculated from 1-second accumulated values) */}
          {(() => {
            const fps = performanceMetrics.frameTime > 0 ? 1000 / performanceMetrics.frameTime : 60;
            const trianglesPerFrame = Math.round(performanceMetrics.triangles / fps);
            const drawCallsPerFrame = Math.round(performanceMetrics.drawCalls / fps);
            return (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '3px 0' }}>
                  <span style={{ color: '#888' }}>Triangles/Frame</span>
                  <span style={{ fontFamily: 'monospace', color: '#c084fc' }}>{formatNumber(trianglesPerFrame)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '3px 0' }}>
                  <span style={{ color: '#888' }}>Draw Calls/Frame</span>
                  <span style={{ fontFamily: 'monospace', color: drawCallsPerFrame > 1000 ? '#ef4444' : drawCallsPerFrame > 500 ? '#facc15' : '#22c55e' }}>
                    {drawCallsPerFrame.toLocaleString()}
                  </span>
                </div>
              </>
            );
          })()}
        </div>
        <div style={{ borderTop: '1px solid #333', marginTop: '6px', paddingTop: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '3px 0' }}>
            <span style={{ color: '#888' }}>Render Res</span>
            <span style={{ fontFamily: 'monospace', color: '#a3a3a3' }}>
              {performanceMetrics.renderWidth}×{performanceMetrics.renderHeight}
            </span>
          </div>
          {performanceMetrics.renderWidth !== performanceMetrics.displayWidth && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '3px 0' }}>
              <span style={{ color: '#888' }}>Display Res</span>
              <span style={{ fontFamily: 'monospace', color: '#a3a3a3' }}>
                {performanceMetrics.displayWidth}×{performanceMetrics.displayHeight}
              </span>
            </div>
          )}
        </div>
        {/* GPU Indirect Rendering Status */}
        <div style={{ borderTop: '1px solid #333', marginTop: '6px', paddingTop: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '3px 0' }}>
            <span style={{ color: '#888' }}>GPU Culling</span>
            <span style={{
              fontFamily: 'monospace',
              color: performanceMetrics.gpuCullingActive ? '#22c55e' : '#888',
            }}>
              {performanceMetrics.gpuCullingActive ? 'ON' : 'OFF'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '3px 0' }}>
            <span style={{ color: '#888' }}>GPU Indirect</span>
            <span style={{
              fontFamily: 'monospace',
              color: performanceMetrics.gpuIndirectActive ? '#22c55e' : '#888',
            }}>
              {performanceMetrics.gpuIndirectActive ? 'ON' : 'OFF'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '3px 0' }}>
            <span style={{ color: '#888' }}>GPU Units</span>
            <span style={{ fontFamily: 'monospace', color: '#a3a3a3' }}>
              {performanceMetrics.gpuManagedUnits}
            </span>
          </div>
        </div>
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

        {/* Performance Recorder */}
        <PerformanceRecorder />
      </div>
    </div>
  );
});
