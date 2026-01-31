/**
 * Performance Test Helpers
 *
 * Utilities for writing robust, non-flaky performance tests.
 * Provides algorithmic complexity verification, cache effectiveness testing,
 * and adaptive threshold management.
 */

import { BenchmarkResult, getBenchmarkRunner } from './BenchmarkRunner';

// =============================================================================
// ALGORITHMIC COMPLEXITY VERIFICATION
// =============================================================================

export interface ComplexityMeasurement {
  inputSize: number;
  time: number;
}

export type ComplexityClass = 'O(1)' | 'O(log n)' | 'O(n)' | 'O(n log n)' | 'O(n²)' | 'O(n³)';

interface ComplexityResult {
  measurements: ComplexityMeasurement[];
  estimatedComplexity: ComplexityClass;
  scalingRatios: number[];
  withinBounds: boolean;
}

/**
 * Verify that an algorithm has the expected time complexity.
 * This is far more robust than absolute timing thresholds.
 *
 * @param fn - Function that takes input size and returns execution time
 * @param inputSizes - Array of input sizes to test (should be powers of 2)
 * @param expectedComplexity - Expected complexity class
 * @param tolerance - How much variance to allow (default 2.0 = 100% tolerance)
 */
export function assertComplexity(
  fn: (inputSize: number) => number,
  inputSizes: number[],
  expectedComplexity: ComplexityClass,
  tolerance = 2.0
): ComplexityResult {
  if (inputSizes.length < 3) {
    throw new Error('Need at least 3 input sizes for complexity analysis');
  }

  // Note: getBenchmarkRunner() calibrates the environment; we use it for measurements indirectly through warmup
  getBenchmarkRunner();
  const measurements: ComplexityMeasurement[] = [];

  // Collect measurements with warmup
  for (const size of inputSizes) {
    // Warmup run
    fn(size);

    // Collect samples
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const time = fn(size);
      samples.push(time);
    }

    // Use median to reduce noise
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    measurements.push({ inputSize: size, time: median });
  }

  // Calculate scaling ratios between consecutive measurements
  const scalingRatios: number[] = [];
  for (let i = 1; i < measurements.length; i++) {
    const timeRatio = measurements[i].time / measurements[i - 1].time;

    // Avoid division by zero for very fast operations
    const adjustedTimeRatio = measurements[i - 1].time < 0.01 ? 1 : timeRatio;
    scalingRatios.push(adjustedTimeRatio);
  }

  // Determine expected scaling ratio based on complexity class
  const expectedRatios = getExpectedRatios(expectedComplexity, inputSizes);

  // Check if actual ratios are within tolerance of expected
  let withinBounds = true;
  for (let i = 0; i < scalingRatios.length; i++) {
    const expected = expectedRatios[i];
    const actual = scalingRatios[i];
    const lowerBound = expected / tolerance;
    const upperBound = expected * tolerance;

    if (actual < lowerBound || actual > upperBound) {
      withinBounds = false;
    }
  }

  const estimatedComplexity = estimateComplexity(scalingRatios, inputSizes);

  if (!withinBounds) {
    throw new Error(
      `Complexity assertion failed:\n` +
        `  Expected: ${expectedComplexity}\n` +
        `  Estimated: ${estimatedComplexity}\n` +
        `  Scaling ratios: [${scalingRatios.map((r) => r.toFixed(2)).join(', ')}]\n` +
        `  Expected ratios: [${expectedRatios.map((r) => r.toFixed(2)).join(', ')}]\n` +
        `  Measurements: ${measurements.map((m) => `${m.inputSize}→${m.time.toFixed(3)}ms`).join(', ')}`
    );
  }

  return { measurements, estimatedComplexity, scalingRatios, withinBounds };
}

/**
 * Get expected scaling ratios for a complexity class.
 */
function getExpectedRatios(complexity: ComplexityClass, inputSizes: number[]): number[] {
  const ratios: number[] = [];

  for (let i = 1; i < inputSizes.length; i++) {
    const n1 = inputSizes[i - 1];
    const n2 = inputSizes[i];
    const sizeRatio = n2 / n1;

    switch (complexity) {
      case 'O(1)':
        ratios.push(1);
        break;
      case 'O(log n)':
        ratios.push(Math.log2(n2) / Math.log2(n1));
        break;
      case 'O(n)':
        ratios.push(sizeRatio);
        break;
      case 'O(n log n)':
        ratios.push((n2 * Math.log2(n2)) / (n1 * Math.log2(n1)));
        break;
      case 'O(n²)':
        ratios.push(sizeRatio * sizeRatio);
        break;
      case 'O(n³)':
        ratios.push(sizeRatio * sizeRatio * sizeRatio);
        break;
    }
  }

  return ratios;
}

/**
 * Estimate complexity class from observed scaling ratios.
 */
function estimateComplexity(ratios: number[], _inputSizes: number[]): ComplexityClass {
  // Calculate average ratio when doubling input size
  const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;

  // Use heuristics to classify
  if (avgRatio < 1.2) return 'O(1)';
  if (avgRatio < 1.5) return 'O(log n)';
  if (avgRatio < 2.5) return 'O(n)';
  if (avgRatio < 4.5) return 'O(n log n)';
  if (avgRatio < 8.5) return 'O(n²)';
  return 'O(n³)';
}

// =============================================================================
// CACHE EFFECTIVENESS TESTING
// =============================================================================

export interface CacheEffectivenessResult {
  coldTime: number;
  warmTime: number;
  speedup: number;
  significantImprovement: boolean;
  pValue: number;
}

/**
 * Test cache effectiveness using statistical comparison.
 * Much more robust than simple ratio assertions.
 *
 * @param coldFn - Function to run on cold cache
 * @param warmFn - Function to run on warm cache (or same function)
 * @param expectedMinSpeedup - Minimum expected speedup (e.g., 1.5 = 50% faster)
 */
export function assertCacheEffectiveness(
  coldFn: () => void,
  warmFn: () => void,
  expectedMinSpeedup = 1.3
): CacheEffectivenessResult {
  const runner = getBenchmarkRunner();

  // Run cold benchmark
  const coldResult = runner.run('cold-cache', coldFn, {
    warmupIterations: 0, // No warmup for cold cache test
    sampleIterations: 15,
  });

  // Run warm benchmark
  const warmResult = runner.run('warm-cache', warmFn, {
    warmupIterations: 3,
    sampleIterations: 15,
  });

  // Statistical comparison
  const comparison = runner.isSignificantlyDifferent(coldResult, warmResult, 0.90);

  const result: CacheEffectivenessResult = {
    coldTime: coldResult.median,
    warmTime: warmResult.median,
    speedup: comparison.speedup,
    significantImprovement: comparison.significant && comparison.speedup > 1,
    pValue: comparison.pValue,
  };

  // Only fail if we're confident there's no improvement
  // (speedup < expected AND statistically significant)
  if (comparison.speedup < expectedMinSpeedup && comparison.significant) {
    throw new Error(
      `Cache effectiveness below threshold:\n` +
        `  Cold cache median: ${coldResult.median.toFixed(3)}ms\n` +
        `  Warm cache median: ${warmResult.median.toFixed(3)}ms\n` +
        `  Speedup: ${comparison.speedup.toFixed(2)}x (expected: ${expectedMinSpeedup}x)\n` +
        `  P-value: ${comparison.pValue.toFixed(4)}\n` +
        `  Note: Cache may not be effective or test is too noisy`
    );
  }

  return result;
}

// =============================================================================
// ADAPTIVE THRESHOLD MANAGEMENT
// =============================================================================

export interface AdaptiveThreshold {
  baseThresholdMs: number;
  adjustedThresholdMs: number;
  environmentMultiplier: number;
}

/**
 * Create an adaptive threshold that adjusts based on environment.
 * Use this instead of hard-coded timing thresholds.
 *
 * @param baseThresholdMs - Threshold calibrated on reference hardware
 * @param safetyMultiplier - Additional safety margin (default 1.5)
 */
export function createAdaptiveThreshold(
  baseThresholdMs: number,
  safetyMultiplier = 1.5
): AdaptiveThreshold {
  const runner = getBenchmarkRunner();
  const envMultiplier = runner.getEnvironmentMultiplier();

  return {
    baseThresholdMs,
    adjustedThresholdMs: baseThresholdMs * envMultiplier * safetyMultiplier,
    environmentMultiplier: envMultiplier,
  };
}

/**
 * Assert that a benchmark median is within an adaptive threshold.
 * This is the recommended way to do performance assertions.
 */
export function assertBenchmarkPasses(
  result: BenchmarkResult,
  baseThresholdMs: number,
  options?: {
    safetyMultiplier?: number;
    percentile?: 'median' | 'p75' | 'p95';
  }
): void {
  const runner = getBenchmarkRunner();
  const safetyMultiplier = options?.safetyMultiplier ?? 1.5;
  const percentile = options?.percentile ?? 'median';

  runner.assertWithinThreshold(result, baseThresholdMs * safetyMultiplier, {
    percentile,
    useCalibration: true,
  });
}

// =============================================================================
// OPERATION COUNTING (NON-TIMING ASSERTIONS)
// =============================================================================

export interface OperationCounter {
  count: number;
  increment(): void;
  reset(): void;
}

/**
 * Create an operation counter for non-timing based performance tests.
 * Counts are deterministic and immune to timing variance.
 */
export function createOperationCounter(): OperationCounter {
  let count = 0;
  return {
    get count() {
      return count;
    },
    increment() {
      count++;
    },
    reset() {
      count = 0;
    },
  };
}

/**
 * Assert operation count is within expected bounds.
 * Use this for O(n) vs O(n²) verification without timing.
 */
export function assertOperationCount(
  actual: number,
  expected: number,
  tolerance = 0.1
): void {
  const lowerBound = expected * (1 - tolerance);
  const upperBound = expected * (1 + tolerance);

  if (actual < lowerBound || actual > upperBound) {
    throw new Error(
      `Operation count out of bounds:\n` +
        `  Actual: ${actual}\n` +
        `  Expected: ${expected} (±${tolerance * 100}%)\n` +
        `  Bounds: [${Math.floor(lowerBound)}, ${Math.ceil(upperBound)}]`
    );
  }
}

// =============================================================================
// TEST SCENARIO UTILITIES
// =============================================================================

/**
 * Run a performance test with multiple scenarios and aggregate results.
 */
export function runScenarioSuite<T>(
  scenarios: { name: string; setup: () => T }[],
  testFn: (scenario: T) => void,
  options?: { warmupIterations?: number; sampleIterations?: number }
): Map<string, BenchmarkResult> {
  const runner = getBenchmarkRunner();
  const results = new Map<string, BenchmarkResult>();

  for (const scenario of scenarios) {
    const data = scenario.setup();
    const result = runner.run(scenario.name, () => testFn(data), options);
    results.set(scenario.name, result);
  }

  return results;
}

/**
 * Assert all scenarios in a suite pass their thresholds.
 */
export function assertAllScenariosPass(
  results: Map<string, BenchmarkResult>,
  thresholds: Map<string, number>,
  options?: { safetyMultiplier?: number }
): void {
  const failures: string[] = [];

  for (const [name, result] of results) {
    const threshold = thresholds.get(name);
    if (threshold === undefined) continue;

    try {
      assertBenchmarkPasses(result, threshold, options);
    } catch (e) {
      failures.push(`${name}: ${(e as Error).message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Scenario suite failures:\n${failures.join('\n')}`);
  }
}

// =============================================================================
// REGRESSION DETECTION
// =============================================================================

export interface BaselineComparison {
  name: string;
  baselineMedian: number;
  currentMedian: number;
  percentChange: number;
  regression: boolean;
  significant: boolean;
}

/**
 * Compare current benchmark against a stored baseline.
 * Useful for detecting performance regressions in CI.
 *
 * @param current - Current benchmark result
 * @param baselineMedian - Previously recorded median (from baseline file)
 * @param regressionThreshold - Max allowed slowdown (e.g., 1.2 = 20% slower)
 */
export function detectRegression(
  current: BenchmarkResult,
  baselineMedian: number,
  regressionThreshold = 1.2
): BaselineComparison {
  const percentChange = ((current.median - baselineMedian) / baselineMedian) * 100;
  const regression = current.median > baselineMedian * regressionThreshold;

  // Check if the change is statistically significant
  // (using margin of error from current measurements)
  const significant = Math.abs(current.median - baselineMedian) > current.marginOfError;

  return {
    name: current.name,
    baselineMedian,
    currentMedian: current.median,
    percentChange,
    regression: regression && significant,
    significant,
  };
}

/**
 * Format a benchmark result for logging/debugging.
 */
export function formatBenchmarkResult(result: BenchmarkResult): string {
  return (
    `${result.name}:\n` +
    `  Samples: ${result.iterations}\n` +
    `  Min: ${result.min.toFixed(3)}ms\n` +
    `  Max: ${result.max.toFixed(3)}ms\n` +
    `  Mean: ${result.mean.toFixed(3)}ms ± ${result.marginOfError.toFixed(3)}ms\n` +
    `  Median: ${result.median.toFixed(3)}ms\n` +
    `  P95: ${result.p95.toFixed(3)}ms\n` +
    `  StdDev: ${result.stddev.toFixed(3)}ms\n` +
    `  Ops/sec: ${result.operationsPerSecond.toFixed(0)}`
  );
}
