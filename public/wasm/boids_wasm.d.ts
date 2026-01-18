/**
 * WASM Boids Module TypeScript Declarations
 *
 * These types describe the interface exported by the WASM boids module.
 */

export interface BoidsEngine {
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

export interface BoidsEngineConstructor {
  new (maxUnits: number): BoidsEngine;
}

export function simd_supported(): boolean;

export const BoidsEngine: BoidsEngineConstructor;

export const STATE_ACTIVE: number;
export const STATE_DEAD: number;
export const STATE_FLYING: number;
export const STATE_GATHERING: number;
export const STATE_WORKER: number;

export function memory(): WebAssembly.Memory | null;

declare function init(): Promise<void>;
export default init;
