import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { PerformanceMonitor } from '@/engine/core/PerformanceMonitor';

describe('PerformanceMonitor - formatBytes', () => {
  it('formats zero bytes', () => {
    assert.strictEqual(PerformanceMonitor.formatBytes(0), '0 B');
  });

  it('formats bytes', () => {
    assert.strictEqual(PerformanceMonitor.formatBytes(500), '500 B');
  });

  it('formats kilobytes', () => {
    assert.strictEqual(PerformanceMonitor.formatBytes(1024), '1 KB');
    assert.strictEqual(PerformanceMonitor.formatBytes(1536), '1.5 KB');
  });

  it('formats megabytes', () => {
    assert.strictEqual(PerformanceMonitor.formatBytes(1048576), '1 MB');
    assert.strictEqual(PerformanceMonitor.formatBytes(10485760), '10 MB');
  });

  it('formats gigabytes', () => {
    assert.strictEqual(PerformanceMonitor.formatBytes(1073741824), '1 GB');
  });
});

describe('PerformanceMonitor - getPerformanceGrade', () => {
  it('returns grade object with grade and color', () => {
    const grade = PerformanceMonitor.getPerformanceGrade();

    assert.ok(typeof grade.grade === 'string');
    assert.ok(typeof grade.color === 'string');
    assert.ok(['Excellent', 'Good', 'Fair', 'Poor', 'Critical'].includes(grade.grade));
    assert.ok(grade.color.startsWith('#'));
  });
});

describe('PerformanceMonitor - collection toggle', () => {
  afterEach(() => {
    PerformanceMonitor.setCollecting(false);
  });

  it('can toggle collection on and off', () => {
    PerformanceMonitor.setCollecting(true);
    assert.strictEqual(PerformanceMonitor.isCollecting(), true);

    PerformanceMonitor.setCollecting(false);
    assert.strictEqual(PerformanceMonitor.isCollecting(), false);
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
    assert.ok('timestamp' in snapshot);
    assert.ok('fps' in snapshot);
    assert.ok('frameTime' in snapshot);
    assert.ok('tickTime' in snapshot);
    assert.ok('systemTimings' in snapshot);
    assert.ok('entityCounts' in snapshot);
    assert.ok('memory' in snapshot);
    assert.ok('network' in snapshot);
    assert.ok('render' in snapshot);

    // Entity counts structure
    assert.ok('total' in snapshot.entityCounts);
    assert.ok('units' in snapshot.entityCounts);
    assert.ok('buildings' in snapshot.entityCounts);
    assert.ok('projectiles' in snapshot.entityCounts);
    assert.ok('resources' in snapshot.entityCounts);
    assert.ok('effects' in snapshot.entityCounts);

    // Memory structure
    assert.ok('available' in snapshot.memory);

    // Network structure
    assert.ok('rtt' in snapshot.network);
    assert.ok('connected' in snapshot.network);

    // Render structure
    assert.ok('drawCalls' in snapshot.render);
    assert.ok('triangles' in snapshot.render);
  });
});

describe('PerformanceMonitor - subscribe/unsubscribe', () => {
  it('can subscribe and unsubscribe to updates', () => {
    const listener = () => {};

    const unsubscribe = PerformanceMonitor.subscribe(listener);
    assert.ok(typeof unsubscribe === 'function');

    // Should not throw
    unsubscribe();
  });
});

describe('PerformanceMonitor - getFPS and getFrameTime', () => {
  it('returns numbers', () => {
    const fps = PerformanceMonitor.getFPS();
    const frameTime = PerformanceMonitor.getFrameTime();

    assert.ok(typeof fps === 'number');
    assert.ok(typeof frameTime === 'number');
    assert.ok(fps >= 0);
    assert.ok(frameTime >= 0);
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

    assert.ok(Array.isArray(timings));

    for (const timing of timings) {
      assert.ok('name' in timing);
      assert.ok('duration' in timing);
      assert.ok('percentage' in timing);
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
      assert.ok(
        timings[i - 1].duration >= timings[i].duration,
        `Expected ${timings[i - 1].duration} >= ${timings[i].duration}`
      );
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
    assert.strictEqual(snapshot.network.rtt, 50);
    assert.strictEqual(snapshot.network.packetLoss, 0.01);
    assert.strictEqual(snapshot.network.connected, true);
  });

  it('allows partial updates', () => {
    PerformanceMonitor.updateNetworkMetrics({ rtt: 100 });

    const snapshot = PerformanceMonitor.getSnapshot();
    assert.strictEqual(snapshot.network.rtt, 100);
  });
});

describe('PerformanceMonitor - history methods', () => {
  it('returns frame time history as array', () => {
    const history = PerformanceMonitor.getFrameTimeHistory();
    assert.ok(Array.isArray(history));
  });

  it('returns FPS history as array', () => {
    const history = PerformanceMonitor.getFPSHistory();
    assert.ok(Array.isArray(history));
  });

  it('returns tick time history as array', () => {
    const history = PerformanceMonitor.getTickTimeHistory();
    assert.ok(Array.isArray(history));
  });
});

describe('RingBuffer behavior (via PerformanceMonitor)', () => {
  it('maintains bounded history size', () => {
    const history = PerformanceMonitor.getFrameTimeHistory();
    // History should never exceed HISTORY_SIZE (300)
    assert.ok(history.length <= 300);
  });
});
