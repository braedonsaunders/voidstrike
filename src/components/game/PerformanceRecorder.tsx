'use client';

import React, { memo, useState, useCallback, useRef, useEffect } from 'react';
import { PerformanceMonitor } from '@/engine/core/PerformanceMonitor';
import { useUIStore } from '@/store/uiStore';

// Maximum recording duration in seconds
const MAX_RECORDING_DURATION = 30;
const SAMPLE_INTERVAL_MS = 16; // ~60 samples per second for smooth data

/**
 * Extended performance sample with additional metrics
 */
interface PerformanceSample {
  timestamp: number;
  relativeTime: number; // Time since recording started (ms)

  // Core metrics
  fps: number;
  frameTime: number;
  tickTime: number;

  // Rendering metrics (from uiStore)
  cpuTime: number;
  gpuTime: number;
  triangles: number;
  drawCalls: number;
  renderWidth: number;
  renderHeight: number;
  displayWidth: number;
  displayHeight: number;

  // System breakdown
  systemTimings: Array<{ name: string; duration: number; percentage: number }>;

  // Entity counts
  entityCounts: {
    total: number;
    units: number;
    buildings: number;
    projectiles: number;
    resources: number;
    effects: number;
  };

  // Memory (Chrome only)
  memory: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
    available: boolean;
  };

  // Network
  network: {
    rtt: number;
    packetLoss: number;
    connected: boolean;
  };
}

/**
 * Recording session data
 */
interface RecordingSession {
  startTime: number;
  endTime: number;
  duration: number;
  samples: PerformanceSample[];
  summary: {
    avgFPS: number;
    minFPS: number;
    maxFPS: number;
    avgFrameTime: number;
    maxFrameTime: number;
    avgCpuTime: number;
    avgGpuTime: number;
    totalSamples: number;
    droppedFrames: number; // Frames below 30fps
  };
}

/**
 * PerformanceRecorder - Records detailed performance data for analysis
 *
 * Features:
 * - Records up to 30 seconds of detailed metrics at 60 samples/sec
 * - Zero performance impact when not recording
 * - Captures all available performance data from multiple sources
 * - Provides summary statistics and exportable data
 */
export const PerformanceRecorder = memo(function PerformanceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [lastSession, setLastSession] = useState<RecordingSession | null>(null);
  const [showResults, setShowResults] = useState(false);

  // Refs for recording state (avoid stale closures)
  const recordingRef = useRef(false);
  const samplesRef = useRef<PerformanceSample[]>([]);
  const startTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const lastSampleTimeRef = useRef<number>(0);

  // Get performance metrics from UI store
  const performanceMetrics = useUIStore((state) => state.performanceMetrics);
  const performanceMetricsRef = useRef(performanceMetrics);

  // Keep ref updated
  useEffect(() => {
    performanceMetricsRef.current = performanceMetrics;
  }, [performanceMetrics]);

  /**
   * Collect a single performance sample
   */
  const collectSample = useCallback((): PerformanceSample => {
    const snapshot = PerformanceMonitor.getSnapshot();
    const metrics = performanceMetricsRef.current;
    const now = performance.now();

    return {
      timestamp: now,
      relativeTime: now - startTimeRef.current,

      // Core metrics
      fps: snapshot.fps,
      frameTime: snapshot.frameTime,
      tickTime: snapshot.tickTime,

      // Rendering metrics
      cpuTime: metrics.cpuTime,
      gpuTime: metrics.gpuTime,
      triangles: metrics.triangles,
      drawCalls: metrics.drawCalls,
      renderWidth: metrics.renderWidth,
      renderHeight: metrics.renderHeight,
      displayWidth: metrics.displayWidth,
      displayHeight: metrics.displayHeight,

      // System breakdown
      systemTimings: snapshot.systemTimings,

      // Entity counts
      entityCounts: { ...snapshot.entityCounts },

      // Memory
      memory: { ...snapshot.memory },

      // Network
      network: { ...snapshot.network },
    };
  }, []);

  // Store collectSample in a ref for use in animation loop
  const collectSampleRef = useRef(collectSample);
  useEffect(() => {
    collectSampleRef.current = collectSample;
  }, [collectSample]);

  // Store the recording loop function in a ref for self-reference
  const recordingLoopRef = useRef<() => void>(() => {});

  /**
   * Recording loop - uses refs to avoid circular dependency issues
   */
  useEffect(() => {
    recordingLoopRef.current = () => {
      if (!recordingRef.current) return;

      const now = performance.now();
      const elapsed = now - startTimeRef.current;

      // Stop if we've exceeded max duration
      if (elapsed >= MAX_RECORDING_DURATION * 1000) {
        recordingRef.current = false;
        setIsRecording(false);
        return;
      }

      // Collect sample at interval
      if (now - lastSampleTimeRef.current >= SAMPLE_INTERVAL_MS) {
        samplesRef.current.push(collectSampleRef.current());
        lastSampleTimeRef.current = now;
      }

      // Update progress
      setRecordingProgress((elapsed / (MAX_RECORDING_DURATION * 1000)) * 100);

      // Schedule next frame using ref
      animationFrameRef.current = requestAnimationFrame(recordingLoopRef.current);
    };
  }, []);

  /**
   * Start recording
   */
  const startRecording = useCallback(() => {
    // Reset state
    samplesRef.current = [];
    startTimeRef.current = performance.now();
    lastSampleTimeRef.current = 0;
    recordingRef.current = true;

    setIsRecording(true);
    setRecordingProgress(0);
    setShowResults(false);

    // Start recording loop using ref
    animationFrameRef.current = requestAnimationFrame(recordingLoopRef.current);
  }, []);

  /**
   * Stop recording and generate summary
   */
  const stopRecording = useCallback(() => {
    recordingRef.current = false;
    setIsRecording(false);

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const samples = samplesRef.current;
    if (samples.length === 0) return;

    // Calculate summary statistics
    const fpsValues = samples.map(s => s.fps);
    const frameTimeValues = samples.map(s => s.frameTime);
    const cpuTimeValues = samples.map(s => s.cpuTime);
    const gpuTimeValues = samples.map(s => s.gpuTime);

    const avgFPS = fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length;
    const minFPS = Math.min(...fpsValues);
    const maxFPS = Math.max(...fpsValues);
    const avgFrameTime = frameTimeValues.reduce((a, b) => a + b, 0) / frameTimeValues.length;
    const maxFrameTime = Math.max(...frameTimeValues);
    const avgCpuTime = cpuTimeValues.reduce((a, b) => a + b, 0) / cpuTimeValues.length;
    const avgGpuTime = gpuTimeValues.reduce((a, b) => a + b, 0) / gpuTimeValues.length;
    const droppedFrames = fpsValues.filter(fps => fps < 30).length;

    const session: RecordingSession = {
      startTime: startTimeRef.current,
      endTime: performance.now(),
      duration: samples[samples.length - 1].relativeTime,
      samples,
      summary: {
        avgFPS,
        minFPS,
        maxFPS,
        avgFrameTime,
        maxFrameTime,
        avgCpuTime,
        avgGpuTime,
        totalSamples: samples.length,
        droppedFrames,
      },
    };

    setLastSession(session);
    setShowResults(true);
  }, []);

  /**
   * Export recording as JSON
   */
  const exportRecording = useCallback(() => {
    if (!lastSession) return;

    const dataStr = JSON.stringify(lastSession, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `voidstrike-perf-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.json`;
    link.click();

    URL.revokeObjectURL(url);
  }, [lastSession]);

  /**
   * Copy summary to clipboard
   */
  const copySummary = useCallback(() => {
    if (!lastSession) return;

    const { summary, duration } = lastSession;
    const text = `VOIDSTRIKE Performance Recording
Duration: ${(duration / 1000).toFixed(1)}s (${summary.totalSamples} samples)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FPS: ${summary.avgFPS.toFixed(1)} avg | ${summary.minFPS.toFixed(0)} min | ${summary.maxFPS.toFixed(0)} max
Frame Time: ${summary.avgFrameTime.toFixed(1)}ms avg | ${summary.maxFrameTime.toFixed(1)}ms max
CPU Time: ${summary.avgCpuTime.toFixed(1)}ms avg
GPU Time: ${summary.avgGpuTime.toFixed(1)}ms avg
Dropped Frames: ${summary.droppedFrames} (${((summary.droppedFrames / summary.totalSamples) * 100).toFixed(1)}%)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    navigator.clipboard.writeText(text);
  }, [lastSession]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <div style={{
      marginTop: '12px',
      paddingTop: '12px',
      borderTop: '1px solid #333',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#aaa' }}>
            Performance Recorder
          </span>
          {isRecording && (
            <span style={{
              fontSize: '9px',
              padding: '2px 6px',
              borderRadius: '3px',
              backgroundColor: 'rgba(239, 68, 68, 0.2)',
              color: '#ef4444',
              animation: 'pulse 1s ease-in-out infinite',
            }}>
              REC
            </span>
          )}
        </div>
        <span style={{ fontSize: '9px', color: '#555' }}>
          {MAX_RECORDING_DURATION}s max
        </span>
      </div>

      {/* Record/Stop Button */}
      <button
        onClick={isRecording ? stopRecording : startRecording}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: '6px',
          border: 'none',
          backgroundColor: isRecording
            ? 'rgba(239, 68, 68, 0.15)'
            : 'rgba(34, 197, 94, 0.15)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          transition: 'all 0.15s',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Progress bar background when recording */}
        {isRecording && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              width: `${recordingProgress}%`,
              backgroundColor: 'rgba(239, 68, 68, 0.2)',
              transition: 'width 0.1s linear',
            }}
          />
        )}

        {/* Button content */}
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Record/Stop icon */}
          <div style={{
            width: '18px',
            height: '18px',
            borderRadius: isRecording ? '3px' : '50%',
            backgroundColor: isRecording ? '#ef4444' : '#22c55e',
            boxShadow: isRecording
              ? '0 0 8px rgba(239, 68, 68, 0.5), 0 0 16px rgba(239, 68, 68, 0.3)'
              : '0 0 8px rgba(34, 197, 94, 0.5), 0 0 16px rgba(34, 197, 94, 0.3)',
            transition: 'all 0.2s',
          }} />

          <span style={{
            fontSize: '12px',
            fontWeight: 600,
            color: isRecording ? '#ef4444' : '#22c55e',
            letterSpacing: '0.5px',
          }}>
            {isRecording ? 'STOP RECORDING' : 'START RECORDING'}
          </span>

          {isRecording && (
            <span style={{
              fontSize: '11px',
              fontFamily: 'monospace',
              color: '#888',
            }}>
              {((recordingProgress / 100) * MAX_RECORDING_DURATION).toFixed(1)}s
            </span>
          )}
        </div>
      </button>

      {/* Recording info */}
      {!isRecording && !showResults && (
        <div style={{
          fontSize: '9px',
          color: '#555',
          textAlign: 'center',
          marginTop: '6px',
          lineHeight: 1.4,
        }}>
          Records FPS, frame times, CPU/GPU times, system timings, entity counts, memory, and more
        </div>
      )}

      {/* Results Panel */}
      {showResults && lastSession && (
        <div style={{
          marginTop: '10px',
          padding: '10px',
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          borderRadius: '6px',
          border: '1px solid #333',
        }}>
          {/* Summary Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
          }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#888', textTransform: 'uppercase' }}>
              Recording Summary
            </span>
            <span style={{ fontSize: '9px', color: '#555' }}>
              {(lastSession.duration / 1000).toFixed(1)}s • {lastSession.summary.totalSamples} samples
            </span>
          </div>

          {/* Stats Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '10px' }}>
            {/* FPS */}
            <div style={{
              padding: '6px 8px',
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              borderRadius: '4px',
            }}>
              <div style={{ fontSize: '9px', color: '#888', marginBottom: '2px' }}>Avg FPS</div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#22c55e' }}>
                {lastSession.summary.avgFPS.toFixed(1)}
              </div>
            </div>

            <div style={{
              padding: '6px 8px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              borderRadius: '4px',
            }}>
              <div style={{ fontSize: '9px', color: '#888', marginBottom: '2px' }}>Min FPS</div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#ef4444' }}>
                {lastSession.summary.minFPS.toFixed(0)}
              </div>
            </div>

            <div style={{
              padding: '6px 8px',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              borderRadius: '4px',
            }}>
              <div style={{ fontSize: '9px', color: '#888', marginBottom: '2px' }}>Avg Frame</div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#3b82f6' }}>
                {lastSession.summary.avgFrameTime.toFixed(1)}ms
              </div>
            </div>

            <div style={{
              padding: '6px 8px',
              backgroundColor: 'rgba(234, 179, 8, 0.1)',
              borderRadius: '4px',
            }}>
              <div style={{ fontSize: '9px', color: '#888', marginBottom: '2px' }}>Dropped</div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#eab308' }}>
                {lastSession.summary.droppedFrames}
                <span style={{ fontSize: '10px', fontWeight: 400, color: '#888', marginLeft: '4px' }}>
                  ({((lastSession.summary.droppedFrames / lastSession.summary.totalSamples) * 100).toFixed(1)}%)
                </span>
              </div>
            </div>
          </div>

          {/* Additional Stats */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '10px',
            color: '#666',
            marginBottom: '10px',
            padding: '0 4px',
          }}>
            <span>CPU: {lastSession.summary.avgCpuTime.toFixed(1)}ms</span>
            <span>GPU: {lastSession.summary.avgGpuTime.toFixed(1)}ms</span>
            <span>Max: {lastSession.summary.maxFPS.toFixed(0)} fps</span>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={copySummary}
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: '10px',
                fontWeight: 500,
                border: 'none',
                borderRadius: '4px',
                backgroundColor: '#333',
                color: '#aaa',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Copy Summary
            </button>
            <button
              onClick={exportRecording}
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: '10px',
                fontWeight: 500,
                border: 'none',
                borderRadius: '4px',
                backgroundColor: '#3b82f6',
                color: '#fff',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Export JSON
            </button>
          </div>

          {/* Close button */}
          <button
            onClick={() => setShowResults(false)}
            style={{
              width: '100%',
              marginTop: '8px',
              padding: '4px',
              fontSize: '9px',
              border: 'none',
              borderRadius: '3px',
              backgroundColor: 'transparent',
              color: '#555',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
});
