/**
 * TypeScript declarations for WASM modules loaded from public/wasm/
 *
 * These modules are dynamically loaded at runtime via dynamic import()
 * from absolute paths like '/wasm/boids_wasm.js'.
 *
 * The declare module syntax doesn't work for absolute paths, so we
 * use the 'any' type workaround in the actual import.
 */

// Export the types that WasmBoids.ts uses internally
export interface WasmBoidsEngine {
  readonly capacity: number;
  unit_count: number;

  positions_x_ptr(): number;
  positions_y_ptr(): number;
  velocities_x_ptr(): number;
  velocities_y_ptr(): number;
  radii_ptr(): number;
  states_ptr(): number;
  layers_ptr(): number;

  force_sep_x_ptr(): number;
  force_sep_y_ptr(): number;
  force_coh_x_ptr(): number;
  force_coh_y_ptr(): number;
  force_align_x_ptr(): number;
  force_align_y_ptr(): number;

  neighbors_ptr(): number;
  neighbor_offsets_ptr(): number;
  neighbor_counts_ptr(): number;

  set_separation_params(radius: number, strength: number, maxForce: number): void;
  set_cohesion_params(radius: number, strength: number): void;
  set_alignment_params(radius: number, strength: number): void;
  set_min_moving_speed(speed: number): void;
  set_neighbor_total(count: number): void;
  compute_forces(): void;
  clear(): void;
}

export interface WasmBoidsModule {
  memory: WebAssembly.Memory;
  simd_supported: () => boolean;
  BoidsEngine: new (maxUnits: number) => WasmBoidsEngine;
  STATE_ACTIVE: number;
  STATE_DEAD: number;
  STATE_FLYING: number;
  STATE_GATHERING: number;
  STATE_WORKER: number;
  default: () => Promise<void>;
}
