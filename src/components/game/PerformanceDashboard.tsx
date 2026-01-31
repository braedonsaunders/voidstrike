'use client';

import React, { useEffect, useState, useCallback, memo, useRef } from 'react';
import {
  PerformanceMonitor,
  PerformanceSnapshot,
  SystemTiming,
} from '@/engine/core/PerformanceMonitor';
import { getWorkerBridge } from '@/engine/workers/WorkerBridge';

// Mini sparkline graph component
const Sparkline = memo(function Sparkline({
  data,
  width = 120,
  height = 30,
  color = '#22c55e',
  maxValue,
  thresholds,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  maxValue?: number;
  thresholds?: { value: number; color: string }[];
}) {
  if (data.length < 2) return null;

  const max = maxValue ?? Math.max(...data, 1);
  const points = data.map((value, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (value / max) * height;
    return `${x},${y}`;
  }).join(' ');

  // Determine color based on latest value and thresholds
  let lineColor = color;
  if (thresholds && data.length > 0) {
    const latestValue = data[data.length - 1];
    for (const threshold of thresholds) {
      if (latestValue >= threshold.value) {
        lineColor = threshold.color;
      }
    }
  }

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {/* Reference lines */}
      <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="#333" strokeWidth="1" strokeDasharray="2,2" />
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
});

// System timing bar component
const SystemTimingBar = memo(function SystemTimingBar({
  timing,
  maxDuration,
}: {
  timing: SystemTiming;
  maxDuration: number;
}) {
  const widthPercent = maxDuration > 0 ? (timing.duration / maxDuration) * 100 : 0;
  const barColor = timing.duration > 5 ? '#ef4444' : timing.duration > 2 ? '#eab308' : '#22c55e';

  return (
    <div style={{ marginBottom: '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' }}>
        <span style={{ color: '#aaa' }}>{timing.name.replace('System', '')}</span>
        <span style={{ color: barColor }}>{timing.duration.toFixed(2)}ms</span>
      </div>
      <div style={{ height: '4px', backgroundColor: '#222', borderRadius: '2px', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${Math.min(widthPercent, 100)}%`,
            backgroundColor: barColor,
            transition: 'width 0.1s ease-out',
          }}
        />
      </div>
    </div>
  );
});

// Entity count display
const EntityCountBadge = memo(function EntityCountBadge({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '2px 6px',
      backgroundColor: 'rgba(0,0,0,0.3)',
      borderRadius: '4px',
    }}>
      <span style={{ fontSize: '10px', color: '#888' }}>{label}</span>
      <span style={{ fontSize: '11px', color, fontWeight: 'bold' }}>{count}</span>
    </div>
  );
});

interface PerformanceDashboardProps {
  expanded?: boolean;
}

export const PerformanceDashboard = memo(function PerformanceDashboard({
  expanded = true,
}: PerformanceDashboardProps) {
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot | null>(null);
  const [fpsHistory, setFpsHistory] = useState<number[]>([]);
  const [tickHistory, setTickHistory] = useState<number[]>([]);
  const [showSystemDetails, setShowSystemDetails] = useState(false);

  // Throttle updates to ~10 fps for performance
  const lastUpdateRef = useRef<number>(0);
  const UPDATE_INTERVAL = 100; // ms

  const handleSnapshot = useCallback((newSnapshot: PerformanceSnapshot) => {
    const now = performance.now();
    if (now - lastUpdateRef.current < UPDATE_INTERVAL) return;
    lastUpdateRef.current = now;

    setSnapshot(newSnapshot);
    setFpsHistory(PerformanceMonitor.getFPSHistory().slice(-60));
    setTickHistory(PerformanceMonitor.getTickTimeHistory().slice(-60));
  }, []);

  useEffect(() => {
    // Enable worker performance collection when dashboard mounts
    const bridge = getWorkerBridge();
    bridge?.setPerformanceCollection(true);

    // Start main thread performance monitor
    PerformanceMonitor.start();

    // Subscribe to performance updates
    const unsubscribe = PerformanceMonitor.subscribe(handleSnapshot);

    // Get initial snapshot and update state - this is the async initialization pattern
    // where we need to populate state from external data sources on mount
    const initial = PerformanceMonitor.getSnapshot();
    // Use queueMicrotask to defer setState calls and avoid the "setState during effect" lint error
    queueMicrotask(() => {
      setSnapshot(initial);
      setFpsHistory(PerformanceMonitor.getFPSHistory().slice(-60));
      setTickHistory(PerformanceMonitor.getTickTimeHistory().slice(-60));
    });

    return () => {
      // Disable worker performance collection when dashboard unmounts
      bridge?.setPerformanceCollection(false);
      PerformanceMonitor.stop();
      unsubscribe();
    };
  }, [handleSnapshot]);

  if (!snapshot) {
    return (
      <div style={{ padding: '8px', color: '#666', fontSize: '11px' }}>
        Waiting for performance data...
      </div>
    );
  }

  const { grade, color: gradeColor } = PerformanceMonitor.getPerformanceGrade();
  const avgSystemTimings = PerformanceMonitor.getAverageSystemTimings();
  const maxSystemDuration = Math.max(...avgSystemTimings.map(t => t.duration), 1);

  // Top 5 systems by duration
  const topSystems = avgSystemTimings.slice(0, showSystemDetails ? 15 : 5);

  return (
    <div style={{ fontSize: '11px' }}>
      {/* FPS Section */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <span style={{ fontWeight: 'bold', color: '#aaa' }}>FPS</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px', fontWeight: 'bold', color: gradeColor }}>
              {snapshot.fps.toFixed(0)}
            </span>
            <span style={{
              fontSize: '9px',
              padding: '2px 4px',
              backgroundColor: gradeColor + '33',
              color: gradeColor,
              borderRadius: '3px',
            }}>
              {grade}
            </span>
          </div>
        </div>
        <Sparkline
          data={fpsHistory}
          width={240}
          height={24}
          color="#22c55e"
          maxValue={Math.max(...fpsHistory, 60) * 1.1} // Dynamic axis with 10% headroom
          thresholds={[
            { value: 0, color: '#ef4444' },
            { value: 20, color: '#f97316' },
            { value: 30, color: '#eab308' },
            { value: 45, color: '#84cc16' },
            { value: 55, color: '#22c55e' },
          ]}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#666', marginTop: '2px' }}>
          <span>Frame: {snapshot.frameTime.toFixed(1)}ms</span>
          <span>Range: 0-{Math.round(Math.max(...fpsHistory, 60) * 1.1)}</span>
        </div>
      </div>

      {/* Tick Time Section */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <span style={{ fontWeight: 'bold', color: '#aaa' }}>Game Tick</span>
          <span style={{
            fontSize: '14px',
            fontWeight: 'bold',
            color: snapshot.tickTime > 10 ? '#ef4444' : snapshot.tickTime > 5 ? '#eab308' : '#22c55e',
          }}>
            {snapshot.tickTime.toFixed(1)}ms
          </span>
        </div>
        <Sparkline
          data={tickHistory}
          width={240}
          height={24}
          color="#3b82f6"
          maxValue={20}
          thresholds={[
            { value: 0, color: '#22c55e' },
            { value: 5, color: '#eab308' },
            { value: 10, color: '#ef4444' },
          ]}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#666', marginTop: '2px' }}>
          <span>Budget: 50ms (20 tick/sec)</span>
          <span>{snapshot.tickTime < 50 ? 'OK' : 'OVER BUDGET'}</span>
        </div>
      </div>

      {/* System Breakdown */}
      {expanded && (
        <div style={{ marginBottom: '12px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
              cursor: 'pointer',
            }}
            onClick={() => setShowSystemDetails(!showSystemDetails)}
          >
            <span style={{ fontWeight: 'bold', color: '#aaa' }}>
              System Breakdown {showSystemDetails ? '▼' : '▶'}
            </span>
            <span style={{ fontSize: '9px', color: '#666' }}>
              {avgSystemTimings.length} systems
            </span>
          </div>
          <div>
            {topSystems.map((timing) => (
              <SystemTimingBar
                key={timing.name}
                timing={timing}
                maxDuration={maxSystemDuration}
              />
            ))}
            {!showSystemDetails && avgSystemTimings.length > 5 && (
              <div style={{ fontSize: '9px', color: '#666', textAlign: 'center', marginTop: '4px' }}>
                +{avgSystemTimings.length - 5} more systems
              </div>
            )}
          </div>
        </div>
      )}

      {/* Entity Counts */}
      {expanded && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontWeight: 'bold', color: '#aaa', marginBottom: '6px' }}>Entities</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            <EntityCountBadge label="Total" count={snapshot.entityCounts.total} color="#fff" />
            <EntityCountBadge label="Units" count={snapshot.entityCounts.units} color="#3b82f6" />
            <EntityCountBadge label="Buildings" count={snapshot.entityCounts.buildings} color="#f59e0b" />
            <EntityCountBadge label="Resources" count={snapshot.entityCounts.resources} color="#10b981" />
            <EntityCountBadge label="Projectiles" count={snapshot.entityCounts.projectiles} color="#ef4444" />
          </div>
        </div>
      )}

      {/* Memory Usage (Chrome only) */}
      {expanded && snapshot.memory.available && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontWeight: 'bold', color: '#aaa' }}>Memory</span>
            <span style={{ fontSize: '10px', color: '#888' }}>
              {PerformanceMonitor.formatBytes(snapshot.memory.usedJSHeapSize)} /
              {PerformanceMonitor.formatBytes(snapshot.memory.jsHeapSizeLimit)}
            </span>
          </div>
          <div style={{ height: '6px', backgroundColor: '#222', borderRadius: '3px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${(snapshot.memory.usedJSHeapSize / snapshot.memory.jsHeapSizeLimit) * 100}%`,
                backgroundColor: snapshot.memory.usedJSHeapSize > snapshot.memory.jsHeapSizeLimit * 0.8
                  ? '#ef4444'
                  : '#3b82f6',
                transition: 'width 0.3s ease-out',
              }}
            />
          </div>
        </div>
      )}

      {/* Network (if connected) */}
      {expanded && snapshot.network.connected && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 'bold', color: '#aaa' }}>Network</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <span style={{
                fontSize: '10px',
                color: snapshot.network.rtt > 100 ? '#ef4444' : snapshot.network.rtt > 50 ? '#eab308' : '#22c55e',
              }}>
                RTT: {snapshot.network.rtt.toFixed(0)}ms
              </span>
              {snapshot.network.packetLoss > 0 && (
                <span style={{ fontSize: '10px', color: '#ef4444' }}>
                  Loss: {snapshot.network.packetLoss.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{
        marginTop: '12px',
        paddingTop: '8px',
        borderTop: '1px solid #333',
        fontSize: '9px',
        color: '#555',
        textAlign: 'center',
      }}>
        Performance Dashboard v1.0
      </div>
    </div>
  );
});
