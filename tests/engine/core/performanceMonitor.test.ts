import { describe, it, expect, afterEach } from 'vitest';
import { PerformanceMonitor } from '@/engine/core/PerformanceMonitor';

describe('PerformanceMonitor - formatBytes', () => {
  it('formats zero bytes', () => {
    expect(PerformanceMonitor.formatBytes(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(PerformanceMonitor.formatBytes(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(PerformanceMonitor.formatBytes(1024)).toBe('1 KB');
    expect(PerformanceMonitor.formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(PerformanceMonitor.formatBytes(1048576)).toBe('1 MB');
    expect(PerformanceMonitor.formatBytes(10485760)).toBe('10 MB');
  });

  it('formats gigabytes', () => {
    expect(PerformanceMonitor.formatBytes(1073741824)).toBe('1 GB');
  });
});

describe('PerformanceMonitor - getPerformanceGrade', () => {
  it('returns grade object with grade and color', () => {
    const grade = PerformanceMonitor.getPerformanceGrade();

    expect(typeof grade.grade).toBe('string');
    expect(typeof grade.color).toBe('string');
    expect(['Excellent', 'Good', 'Fair', 'Poor', 'Critical']).toContain(grade.grade);
    expect(grade.color.startsWith('#')).toBe(true);
  });
});

describe('PerformanceMonitor - collection toggle', () => {
  afterEach(() => {
    PerformanceMonitor.setCollecting(false);
  });

  it('can toggle collection on and off', () => {
    PerformanceMonitor.setCollecting(true);
    expect(PerformanceMonitor.isCollecting()).toBe(true);

    PerformanceMonitor.setCollecting(false);
    expect(PerformanceMonitor.isCollecting()).toBe(false);
  });
});

describe('PerformanceMonitor - recording methods (no-op when disabled)', () => {
  it('recordTickTime is no-op when collection disabled', () => {
    PerformanceMonitor.setCollecting(false);

    // Should not throw even when disabled
    PerformanceMonitor.recordTickTime(16);
    PerformanceMonitor.recordSystemTiming('TestSystem', 5);
    PerformanceMonitor.clearSystemTimings();
    PerformanceMonitor.updateEntityCounts({
      total: 100,
      units: 50,
      buildings: 20,
      projectiles: 10,
      resources: 15,
      effects: 5,
    });
  });
});

describe('PerformanceMonitor - getSnapshot', () => {
  it('returns a complete performance snapshot', () => {
    const snapshot = PerformanceMonitor.getSnapshot();

    // Verify snapshot has all required properties
    expect(snapshot).toHaveProperty('timestamp');
    expect(snapshot).toHaveProperty('fps');
    expect(snapshot).toHaveProperty('frameTime');
    expect(snapshot).toHaveProperty('tickTime');
    expect(snapshot).toHaveProperty('systemTimings');
    expect(snapshot).toHaveProperty('entityCounts');
    expect(snapshot).toHaveProperty('memory');
    expect(snapshot).toHaveProperty('network');
    expect(snapshot).toHaveProperty('render');

    // Entity counts structure
    expect(snapshot.entityCounts).toHaveProperty('total');
    expect(snapshot.entityCounts).toHaveProperty('units');
    expect(snapshot.entityCounts).toHaveProperty('buildings');
    expect(snapshot.entityCounts).toHaveProperty('projectiles');
    expect(snapshot.entityCounts).toHaveProperty('resources');
    expect(snapshot.entityCounts).toHaveProperty('effects');

    // Memory structure
    expect(snapshot.memory).toHaveProperty('available');

    // Network structure
    expect(snapshot.network).toHaveProperty('rtt');
    expect(snapshot.network).toHaveProperty('connected');

    // Render structure
    expect(snapshot.render).toHaveProperty('drawCalls');
    expect(snapshot.render).toHaveProperty('triangles');
  });
});

describe('PerformanceMonitor - subscribe/unsubscribe', () => {
  it('can subscribe and unsubscribe to updates', () => {
    const listener = () => {};

    const unsubscribe = PerformanceMonitor.subscribe(listener);
    expect(typeof unsubscribe).toBe('function');

    // Should not throw
    unsubscribe();
  });
});

describe('PerformanceMonitor - getFPS and getFrameTime', () => {
  it('returns numbers', () => {
    const fps = PerformanceMonitor.getFPS();
    const frameTime = PerformanceMonitor.getFrameTime();

    expect(typeof fps).toBe('number');
    expect(typeof frameTime).toBe('number');
    expect(fps).toBeGreaterThanOrEqual(0);
    expect(frameTime).toBeGreaterThanOrEqual(0);
  });
});

describe('PerformanceMonitor - getSystemTimings', () => {
  afterEach(() => {
    PerformanceMonitor.clearSystemTimings();
    PerformanceMonitor.setCollecting(false);
  });

  it('returns array of system timings', () => {
    PerformanceMonitor.setCollecting(true);
    PerformanceMonitor.recordSystemTiming('TestSystem', 5);
    PerformanceMonitor.recordSystemTiming('OtherSystem', 10);

    const timings = PerformanceMonitor.getSystemTimings();

    expect(Array.isArray(timings)).toBe(true);

    for (const timing of timings) {
      expect(timing).toHaveProperty('name');
      expect(timing).toHaveProperty('duration');
      expect(timing).toHaveProperty('percentage');
    }
  });

  it('returns timings sorted by duration descending', () => {
    PerformanceMonitor.setCollecting(true);
    PerformanceMonitor.clearSystemTimings();
    PerformanceMonitor.recordSystemTiming('FastSystem', 1);
    PerformanceMonitor.recordSystemTiming('SlowSystem', 10);
    PerformanceMonitor.recordSystemTiming('MediumSystem', 5);

    const timings = PerformanceMonitor.getSystemTimings();

    for (let i = 1; i < timings.length; i++) {
      expect(timings[i - 1].duration).toBeGreaterThanOrEqual(timings[i].duration);
    }
  });
});

describe('PerformanceMonitor - updateNetworkMetrics', () => {
  it('updates network metrics', () => {
    PerformanceMonitor.updateNetworkMetrics({
      rtt: 50,
      packetLoss: 0.01,
      connected: true,
    });

    const snapshot = PerformanceMonitor.getSnapshot();
    expect(snapshot.network.rtt).toBe(50);
    expect(snapshot.network.packetLoss).toBe(0.01);
    expect(snapshot.network.connected).toBe(true);
  });

  it('allows partial updates', () => {
    PerformanceMonitor.updateNetworkMetrics({ rtt: 100 });

    const snapshot = PerformanceMonitor.getSnapshot();
    expect(snapshot.network.rtt).toBe(100);
  });
});

describe('PerformanceMonitor - history methods', () => {
  it('returns frame time history as array', () => {
    const history = PerformanceMonitor.getFrameTimeHistory();
    expect(Array.isArray(history)).toBe(true);
  });

  it('returns FPS history as array', () => {
    const history = PerformanceMonitor.getFPSHistory();
    expect(Array.isArray(history)).toBe(true);
  });

  it('returns tick time history as array', () => {
    const history = PerformanceMonitor.getTickTimeHistory();
    expect(Array.isArray(history)).toBe(true);
  });
});

describe('RingBuffer behavior (via PerformanceMonitor)', () => {
  it('maintains bounded history size', () => {
    const history = PerformanceMonitor.getFrameTimeHistory();
    // History should never exceed HISTORY_SIZE (300)
    expect(history.length).toBeLessThanOrEqual(300);
  });
});

describe('PerformanceMonitor - GPU timing', () => {
  afterEach(() => {
    PerformanceMonitor.setCollecting(false);
  });

  it('updateGPUTiming updates render metrics with GPU timing data', () => {
    PerformanceMonitor.setCollecting(true);
    PerformanceMonitor.updateGPUTiming(8.5, 7.2, true);

    const snapshot = PerformanceMonitor.getSnapshot();
    expect(snapshot.render.gpuFrameTimeMs).toBe(8.5);
    expect(snapshot.render.gpuFrameTimeAvgMs).toBe(7.2);
    expect(snapshot.render.gpuTimingAvailable).toBe(true);
  });

  it('updateGPUTiming handles unavailable timing', () => {
    PerformanceMonitor.setCollecting(true);
    PerformanceMonitor.updateGPUTiming(0, 0, false);

    const snapshot = PerformanceMonitor.getSnapshot();
    expect(snapshot.render.gpuTimingAvailable).toBe(false);
  });

  it('updateGPUTiming is no-op when collection disabled', () => {
    PerformanceMonitor.setCollecting(false);
    // Should not throw
    PerformanceMonitor.updateGPUTiming(10, 10, true);
  });
});

describe('PerformanceMonitor - GPU memory snapshot', () => {
  it('snapshot includes gpuMemory field', () => {
    const snapshot = PerformanceMonitor.getSnapshot();

    expect(snapshot).toHaveProperty('gpuMemory');
    expect(snapshot.gpuMemory).toHaveProperty('totalMB');
    expect(snapshot.gpuMemory).toHaveProperty('budgetMB');
    expect(snapshot.gpuMemory).toHaveProperty('usagePercent');
    expect(snapshot.gpuMemory).toHaveProperty('categories');
    expect(Array.isArray(snapshot.gpuMemory.categories)).toBe(true);
  });

  it('gpuMemory categories have correct structure', () => {
    const snapshot = PerformanceMonitor.getSnapshot();

    for (const category of snapshot.gpuMemory.categories) {
      expect(category).toHaveProperty('name');
      expect(category).toHaveProperty('currentMB');
      expect(category).toHaveProperty('breakdown');
      expect(typeof category.name).toBe('string');
      expect(typeof category.currentMB).toBe('number');
      expect(typeof category.breakdown).toBe('object');
    }
  });
});

describe('PerformanceMonitor - render metrics structure', () => {
  it('render metrics include GPU timing fields', () => {
    const snapshot = PerformanceMonitor.getSnapshot();

    expect(snapshot.render).toHaveProperty('drawCalls');
    expect(snapshot.render).toHaveProperty('triangles');
    expect(snapshot.render).toHaveProperty('drawCallsPerSecond');
    expect(snapshot.render).toHaveProperty('trianglesPerSecond');
    expect(snapshot.render).toHaveProperty('gpuFrameTimeMs');
    expect(snapshot.render).toHaveProperty('gpuFrameTimeAvgMs');
    expect(snapshot.render).toHaveProperty('gpuTimingAvailable');
  });
});
