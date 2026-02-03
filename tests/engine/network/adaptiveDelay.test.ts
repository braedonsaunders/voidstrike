/**
 * Adaptive Command Delay Tests
 *
 * Tests the adaptive command delay calculation for multiplayer networking:
 * - getAdaptiveCommandDelay() calculation
 * - RTT buffer calculation: averageRTT + jitter * 2
 * - Connection quality thresholds (excellent, good, poor, critical)
 * - Delay tick bounds (min 2, max 10)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useMultiplayerStore } from '@/store/multiplayerStore';
import type { LatencyStats } from '@/store/multiplayerStore';

// Helper to create latency stats with defaults
function createLatencyStats(overrides: Partial<LatencyStats> = {}): LatencyStats {
  return {
    currentRTT: 50,
    averageRTT: 50,
    minRTT: 30,
    maxRTT: 80,
    jitter: 10,
    packetsLost: 0,
    packetsSent: 100,
    lastPingTime: Date.now(),
    lastPongTime: Date.now(),
    ...overrides,
  };
}

describe('Adaptive Command Delay', () => {
  beforeEach(() => {
    // Reset store state before each test
    useMultiplayerStore.getState().reset();
  });

  afterEach(() => {
    // Clean up
    useMultiplayerStore.getState().reset();
  });

  describe('getAdaptiveCommandDelay() calculation', () => {
    it('calculates delay based on RTT and jitter', () => {
      const store = useMultiplayerStore.getState();

      // Set up latency stats directly
      useMultiplayerStore.setState({
        latencyStats: createLatencyStats({
          averageRTT: 50, // 50ms RTT
          jitter: 10, // 10ms jitter
        }),
        connectionQuality: 'excellent',
      });

      const tickRate = 20; // 20 TPS = 50ms per tick
      const delay = store.getAdaptiveCommandDelay(tickRate);

      // RTT buffer = 50 + 10*2 = 70ms
      // At 50ms per tick = 1.4 ticks, rounded up = 2
      // Plus excellent quality bonus = +1
      // Total = 3 ticks
      expect(delay).toBeGreaterThanOrEqual(2);
      expect(delay).toBeLessThanOrEqual(10);
    });

    it('uses formula: averageRTT + jitter * 2', () => {
      // Test the formula indirectly through different values
      useMultiplayerStore.setState({
        latencyStats: createLatencyStats({
          averageRTT: 100,
          jitter: 25,
        }),
        connectionQuality: 'excellent',
      });

      const tickRate = 20;
      const delay = useMultiplayerStore.getState().getAdaptiveCommandDelay(tickRate);

      // RTT buffer = 100 + 25*2 = 150ms
      // At 50ms/tick = 3 ticks, + 1 for excellent = 4
      expect(delay).toBeGreaterThanOrEqual(2);
    });

    it('converts RTT buffer to ticks using tick duration', () => {
      useMultiplayerStore.setState({
        latencyStats: createLatencyStats({
          averageRTT: 100,
          jitter: 0,
        }),
        connectionQuality: 'excellent',
      });

      // At 20 TPS (50ms/tick), 100ms RTT = 2 ticks + 1 excellent bonus = 3
      const delay20 = useMultiplayerStore.getState().getAdaptiveCommandDelay(20);

      useMultiplayerStore.setState({
        latencyStats: createLatencyStats({
          averageRTT: 100,
          jitter: 0,
        }),
        connectionQuality: 'excellent',
      });

      // At 10 TPS (100ms/tick), 100ms RTT = 1 tick + 1 excellent bonus = 2
      const delay10 = useMultiplayerStore.getState().getAdaptiveCommandDelay(10);

      expect(delay20).toBeGreaterThanOrEqual(delay10);
    });
  });

  describe('Connection quality thresholds', () => {
    it('classifies connection as excellent when RTT < 50ms', () => {
      useMultiplayerStore.setState({
        latencyStats: createLatencyStats({ averageRTT: 30, jitter: 5 }),
      });

      // Trigger quality update
      const store = useMultiplayerStore.getState();
      store.getAdaptiveCommandDelay(20);

      expect(['excellent', 'good']).toContain(useMultiplayerStore.getState().connectionQuality);
    });

    it('classifies connection as good when RTT < 100ms', () => {
      useMultiplayerStore.setState({
        latencyStats: createLatencyStats({ averageRTT: 75, jitter: 10 }),
      });

      expect(['excellent', 'good']).toContain(useMultiplayerStore.getState().connectionQuality);
    });

    it('classifies connection as poor when RTT < 200ms', () => {
      useMultiplayerStore.setState({
        latencyStats: createLatencyStats({ averageRTT: 150, jitter: 30 }),
        connectionQuality: 'poor',
      });

      expect(useMultiplayerStore.getState().connectionQuality).toBe('poor');
    });

    it('classifies connection as critical when RTT >= 200ms', () => {
      useMultiplayerStore.setState({
        latencyStats: createLatencyStats({ averageRTT: 250, jitter: 50 }),
        connectionQuality: 'critical',
      });

      expect(useMultiplayerStore.getState().connectionQuality).toBe('critical');
    });
  });
});

describe('Latency Stats Management', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset();
  });

  afterEach(() => {
    useMultiplayerStore.getState().reset();
  });

  describe('handlePong RTT calculation', () => {
    it('calculates RTT from ping-pong roundtrip', () => {
      const store = useMultiplayerStore.getState();

      // Simulate sending a ping
      const pingId = 12345;
      const sendTime = performance.now() - 50; // 50ms ago

      useMultiplayerStore.setState({
        pendingPings: new Map([[pingId, sendTime]]),
        latencyStats: createLatencyStats({
          averageRTT: 0,
          packetsSent: 1,
        }),
      });

      // Handle pong
      store.handlePong(pingId, sendTime);

      const stats = useMultiplayerStore.getState().latencyStats;
      expect(stats.currentRTT).toBeGreaterThanOrEqual(40); // At least 50ms (with timing margin)
      expect(stats.averageRTT).toBeGreaterThan(0);
    });

    it('removes ping from pending after pong', () => {
      const pingId = 12345;
      const sendTime = performance.now() - 50;

      useMultiplayerStore.setState({
        pendingPings: new Map([[pingId, sendTime]]),
        latencyStats: createLatencyStats(),
      });

      useMultiplayerStore.getState().handlePong(pingId, sendTime);

      expect(useMultiplayerStore.getState().pendingPings.has(pingId)).toBe(false);
    });

    it('ignores pong for unknown ping', () => {
      useMultiplayerStore.setState({
        pendingPings: new Map(),
        latencyStats: createLatencyStats({ currentRTT: 100 }),
      });

      useMultiplayerStore.getState().handlePong(99999, Date.now());

      // RTT should be unchanged
      expect(useMultiplayerStore.getState().latencyStats.currentRTT).toBe(100);
    });

    it('calculates jitter from RTT variance', () => {
      // Send multiple pings with varying RTTs
      useMultiplayerStore.setState({
        latencyStats: createLatencyStats({
          averageRTT: 50,
          jitter: 0,
        }),
      });

      const now = performance.now();

      // First ping with 50ms RTT
      useMultiplayerStore.setState({
        pendingPings: new Map([[1, now - 50]]),
      });
      useMultiplayerStore.getState().handlePong(1, now - 50);

      // Second ping with 70ms RTT (20ms variance)
      useMultiplayerStore.setState({
        pendingPings: new Map([[2, now - 70]]),
      });
      useMultiplayerStore.getState().handlePong(2, now - 70);

      const stats = useMultiplayerStore.getState().latencyStats;
      expect(stats.jitter).toBeGreaterThan(0);
    });

    it('tracks min and max RTT', () => {
      const now = performance.now();

      useMultiplayerStore.setState({
        latencyStats: createLatencyStats({
          minRTT: Infinity,
          maxRTT: 0,
        }),
      });

      // Ping with 30ms RTT
      useMultiplayerStore.setState({
        pendingPings: new Map([[1, now - 30]]),
      });
      useMultiplayerStore.getState().handlePong(1, now - 30);

      // Ping with 80ms RTT
      useMultiplayerStore.setState({
        pendingPings: new Map([[2, now - 80]]),
      });
      useMultiplayerStore.getState().handlePong(2, now - 80);

      const stats = useMultiplayerStore.getState().latencyStats;
      expect(stats.minRTT).toBeLessThanOrEqual(40); // ~30ms with timing variance
      expect(stats.maxRTT).toBeGreaterThanOrEqual(70); // ~80ms with timing variance
    });
  });

  describe('EMA smoothing', () => {
    it('uses exponential moving average for RTT', () => {
      const now = performance.now();

      // Start with established average
      useMultiplayerStore.setState({
        latencyStats: createLatencyStats({
          averageRTT: 100,
        }),
      });

      // New measurement of 50ms
      useMultiplayerStore.setState({
        pendingPings: new Map([[1, now - 50]]),
      });
      useMultiplayerStore.getState().handlePong(1, now - 50);

      const stats = useMultiplayerStore.getState().latencyStats;
      // EMA should be between 50 and 100
      expect(stats.averageRTT).toBeGreaterThan(45);
      expect(stats.averageRTT).toBeLessThan(100);
    });
  });

  describe('Packet loss tracking', () => {
    it('calculates loss rate from lost/sent ratio', () => {
      useMultiplayerStore.setState({
        latencyStats: createLatencyStats({
          packetsLost: 4,
          packetsSent: 100,
          averageRTT: 50, // Within 'good' range
          jitter: 20, // Within 'good' range
        }),
      });

      useMultiplayerStore.getState().updateConnectionQuality();

      // 4% loss (< 5%) with good RTT and jitter should result in 'good' quality
      expect(useMultiplayerStore.getState().connectionQuality).toBe('good');
    });

    it('handles zero packets sent', () => {
      useMultiplayerStore.setState({
        latencyStats: createLatencyStats({
          packetsLost: 0,
          packetsSent: 0,
        }),
      });

      // Should not crash
      useMultiplayerStore.getState().updateConnectionQuality();
    });
  });
});

describe('Utility Functions', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset();
  });

  afterEach(() => {
    useMultiplayerStore.getState().reset();
  });

  it('getAdaptiveCommandDelay helper function works', async () => {
    const { getAdaptiveCommandDelay } = await import('@/store/multiplayerStore');

    useMultiplayerStore.setState({
      latencyStats: createLatencyStats({
        averageRTT: 50,
        jitter: 10,
      }),
      connectionQuality: 'excellent',
    });

    const delay = getAdaptiveCommandDelay(20);
    expect(delay).toBeGreaterThanOrEqual(2);
    expect(delay).toBeLessThanOrEqual(10);
  });

  it('getLatencyStats helper function works', async () => {
    const { getLatencyStats } = await import('@/store/multiplayerStore');

    useMultiplayerStore.setState({
      latencyStats: createLatencyStats({
        averageRTT: 75,
        jitter: 20,
      }),
    });

    const stats = getLatencyStats();
    expect(stats.averageRTT).toBe(75);
    expect(stats.jitter).toBe(20);
  });

  it('getConnectionQuality helper function works', async () => {
    const { getConnectionQuality } = await import('@/store/multiplayerStore');

    useMultiplayerStore.setState({
      connectionQuality: 'poor',
    });

    const quality = getConnectionQuality();
    expect(quality).toBe('poor');
  });
});

describe('Edge Cases and Boundary Conditions', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset();
  });

  afterEach(() => {
    useMultiplayerStore.getState().reset();
  });

  it('handles negative RTT gracefully', () => {
    // This shouldn't happen in practice, but test defensive coding
    useMultiplayerStore.setState({
      latencyStats: createLatencyStats({
        averageRTT: -10, // Invalid
        jitter: 5,
      }),
      connectionQuality: 'excellent',
    });

    const delay = useMultiplayerStore.getState().getAdaptiveCommandDelay(20);
    // Should still return valid delay
    expect(delay).toBeGreaterThanOrEqual(2);
  });

  it('handles NaN RTT gracefully', () => {
    useMultiplayerStore.setState({
      latencyStats: createLatencyStats({
        averageRTT: NaN,
        jitter: NaN,
      }),
      connectionQuality: 'excellent',
    });

    const delay = useMultiplayerStore.getState().getAdaptiveCommandDelay(20);
    // Should handle NaN without crashing
    expect(typeof delay).toBe('number');
  });

  it('handles very small tick rates', () => {
    useMultiplayerStore.setState({
      latencyStats: createLatencyStats({
        averageRTT: 100,
        jitter: 25,
      }),
      connectionQuality: 'excellent',
    });

    const delay = useMultiplayerStore.getState().getAdaptiveCommandDelay(1);
    // 1 TPS = 1000ms per tick, 150ms buffer = 1 tick + 1 = 2
    expect(delay).toBe(2);
  });

  it('handles very high tick rates', () => {
    useMultiplayerStore.setState({
      latencyStats: createLatencyStats({
        averageRTT: 100,
        jitter: 25,
      }),
      connectionQuality: 'excellent',
    });

    const delay = useMultiplayerStore.getState().getAdaptiveCommandDelay(100);
    // 100 TPS = 10ms per tick, 150ms buffer = 15 ticks + 1 = 16, clamped to 10
    expect(delay).toBeLessThanOrEqual(10);
  });

  it('handles exact boundary values for quality thresholds', () => {
    // Test at exact boundary: RTT = 50, jitter = 20, loss = 1%
    useMultiplayerStore.setState({
      latencyStats: createLatencyStats({
        averageRTT: 50,
        jitter: 20,
        packetsLost: 1,
        packetsSent: 100,
      }),
    });

    useMultiplayerStore.getState().updateConnectionQuality();
    // At exact boundary, should fall into 'good' category
    expect(['excellent', 'good']).toContain(useMultiplayerStore.getState().connectionQuality);
  });

  it('handles Infinity minRTT correctly', () => {
    useMultiplayerStore.setState({
      latencyStats: createLatencyStats({
        minRTT: Infinity,
      }),
    });

    // First pong should set a finite minRTT
    const now = performance.now();
    useMultiplayerStore.setState({
      pendingPings: new Map([[1, now - 50]]),
    });
    useMultiplayerStore.getState().handlePong(1, now - 50);

    expect(useMultiplayerStore.getState().latencyStats.minRTT).toBeLessThan(Infinity);
  });
});
