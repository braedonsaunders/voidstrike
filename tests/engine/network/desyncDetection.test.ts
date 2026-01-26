import { describe, it, expect } from 'vitest';
import {
  formatChecksum,
  compareChecksums,
} from '@/engine/network/DesyncDetection';
import { ChecksumData } from '@/engine/systems/ChecksumSystem';

describe('DesyncDetection Utility Functions', () => {
  describe('formatChecksum', () => {
    it('formats zero checksum', () => {
      const result = formatChecksum(0);
      expect(result).toBe('0x00000000');
    });

    it('formats small checksum with padding', () => {
      const result = formatChecksum(255);
      expect(result).toBe('0x000000FF');
    });

    it('formats large checksum', () => {
      const result = formatChecksum(0xDEADBEEF);
      expect(result).toBe('0xDEADBEEF');
    });

    it('formats mid-range checksum', () => {
      const result = formatChecksum(0x12345678);
      expect(result).toBe('0x12345678');
    });

    it('uses uppercase hex', () => {
      const result = formatChecksum(0xabcdef);
      expect(result).toBe('0x00ABCDEF');
    });
  });

  describe('compareChecksums', () => {
    const createChecksum = (overrides: Partial<ChecksumData> = {}): ChecksumData => ({
      tick: 100,
      checksum: 0x12345678,
      unitCount: 50,
      buildingCount: 10,
      resourceSum: 5000,
      healthSum: 10000,
      ...overrides,
    });

    it('returns empty array for identical checksums', () => {
      const local = createChecksum();
      const remote = createChecksum();

      const differences = compareChecksums(local, remote);

      expect(differences).toEqual([]);
    });

    it('detects checksum difference', () => {
      const local = createChecksum({ checksum: 0xAAAAAAAA });
      const remote = createChecksum({ checksum: 0xBBBBBBBB });

      const differences = compareChecksums(local, remote);

      expect(differences.length).toBe(1);
      expect(differences[0]).toContain('Checksum');
      expect(differences[0]).toContain('0xAAAAAAAA');
      expect(differences[0]).toContain('0xBBBBBBBB');
    });

    it('detects unit count difference', () => {
      const local = createChecksum({ unitCount: 50 });
      const remote = createChecksum({ unitCount: 48 });

      const differences = compareChecksums(local, remote);

      expect(differences.length).toBe(1);
      expect(differences[0]).toContain('Unit count');
      expect(differences[0]).toContain('50');
      expect(differences[0]).toContain('48');
    });

    it('detects building count difference', () => {
      const local = createChecksum({ buildingCount: 10 });
      const remote = createChecksum({ buildingCount: 12 });

      const differences = compareChecksums(local, remote);

      expect(differences.length).toBe(1);
      expect(differences[0]).toContain('Building count');
      expect(differences[0]).toContain('10');
      expect(differences[0]).toContain('12');
    });

    it('detects resource sum difference', () => {
      const local = createChecksum({ resourceSum: 5000 });
      const remote = createChecksum({ resourceSum: 5100 });

      const differences = compareChecksums(local, remote);

      expect(differences.length).toBe(1);
      expect(differences[0]).toContain('Resource sum');
      expect(differences[0]).toContain('5000');
      expect(differences[0]).toContain('5100');
    });

    it('detects health sum difference', () => {
      const local = createChecksum({ healthSum: 10000 });
      const remote = createChecksum({ healthSum: 9500 });

      const differences = compareChecksums(local, remote);

      expect(differences.length).toBe(1);
      expect(differences[0]).toContain('Health sum');
      expect(differences[0]).toContain('10000');
      expect(differences[0]).toContain('9500');
    });

    it('detects multiple differences', () => {
      const local = createChecksum({
        checksum: 0x11111111,
        unitCount: 50,
        buildingCount: 10,
      });
      const remote = createChecksum({
        checksum: 0x22222222,
        unitCount: 45,
        buildingCount: 15,
      });

      const differences = compareChecksums(local, remote);

      expect(differences.length).toBe(3);
      expect(differences.some(d => d.includes('Checksum'))).toBe(true);
      expect(differences.some(d => d.includes('Unit count'))).toBe(true);
      expect(differences.some(d => d.includes('Building count'))).toBe(true);
    });
  });
});

describe('DesyncDetectionConfig defaults', () => {
  it('has reasonable default values', async () => {
    // Import the default config
    const { DesyncDetectionManager } = await import('@/engine/network/DesyncDetection');

    // Create a mock game to test config
    const mockGame = {
      eventBus: {
        on: () => {},
        emit: () => {},
      },
      getCurrentTick: () => 0,
      pause: () => {},
    };

    const manager = new DesyncDetectionManager(mockGame as never);
    const config = manager.getConfig();

    expect(config.enabled).toBe(true);
    expect(config.pauseOnDesync).toBe(false);
    expect(config.showDesyncIndicator).toBe(true);
    expect(config.maxDesyncHistory).toBe(100);
    expect(config.verboseLogging).toBe(false);
  });
});

describe('DesyncDetectionManager state', () => {
  it('tracks desync state', async () => {
    const { DesyncDetectionManager } = await import('@/engine/network/DesyncDetection');

    const mockGame = {
      eventBus: {
        on: () => {},
        emit: () => {},
      },
      getCurrentTick: () => 0,
      pause: () => {},
    };

    const manager = new DesyncDetectionManager(mockGame as never);

    expect(manager.isDesynced()).toBe(false);
    expect(manager.getLastDesyncTick()).toBe(-1);
    expect(manager.getDesyncHistory()).toEqual([]);
  });

  it('updates configuration', async () => {
    const { DesyncDetectionManager } = await import('@/engine/network/DesyncDetection');

    const mockGame = {
      eventBus: {
        on: () => {},
        emit: () => {},
      },
      getCurrentTick: () => 0,
      pause: () => {},
    };

    const manager = new DesyncDetectionManager(mockGame as never);

    manager.setConfig({ verboseLogging: true, pauseOnDesync: true });
    const config = manager.getConfig();

    expect(config.verboseLogging).toBe(true);
    expect(config.pauseOnDesync).toBe(true);
    expect(config.enabled).toBe(true); // Unchanged
  });

  it('clears history', async () => {
    const { DesyncDetectionManager } = await import('@/engine/network/DesyncDetection');

    const mockGame = {
      eventBus: {
        on: () => {},
        emit: () => {},
      },
      getCurrentTick: () => 0,
      pause: () => {},
    };

    const manager = new DesyncDetectionManager(mockGame as never);

    manager.clearHistory();

    expect(manager.isDesynced()).toBe(false);
    expect(manager.getLastDesyncTick()).toBe(-1);
    expect(manager.getDesyncHistory()).toEqual([]);
  });
});
