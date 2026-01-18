/**
 * WASM Boids Module Placeholder
 *
 * This file is replaced by the actual WASM glue code when built.
 * It provides a graceful fallback that signals SIMD is unavailable.
 *
 * Build the real WASM module with:
 *   ./scripts/build-wasm.sh
 * Or wait for GitHub Actions to build on push.
 */

let wasm;

async function init() {
  console.warn('[WasmBoids] WASM module not built - using JS fallback');
  console.info('[WasmBoids] Build with: ./scripts/build-wasm.sh');
  return undefined;
}

function simd_supported() {
  return false;
}

class BoidsEngine {
  constructor(maxUnits) {
    console.warn('[WasmBoids] Using placeholder - WASM not built');
    this._capacity = maxUnits;
  }

  get capacity() {
    return this._capacity;
  }

  get unit_count() {
    return 0;
  }

  set unit_count(v) {}

  positions_x_ptr() { return 0; }
  positions_y_ptr() { return 0; }
  velocities_x_ptr() { return 0; }
  velocities_y_ptr() { return 0; }
  radii_ptr() { return 0; }
  states_ptr() { return 0; }
  layers_ptr() { return 0; }

  force_sep_x_ptr() { return 0; }
  force_sep_y_ptr() { return 0; }
  force_coh_x_ptr() { return 0; }
  force_coh_y_ptr() { return 0; }
  force_align_x_ptr() { return 0; }
  force_align_y_ptr() { return 0; }

  neighbors_ptr() { return 0; }
  neighbor_offsets_ptr() { return 0; }
  neighbor_counts_ptr() { return 0; }

  set_separation_params() {}
  set_cohesion_params() {}
  set_alignment_params() {}
  set_min_moving_speed() {}
  set_neighbor_total() {}
  compute_forces() {}
  clear() {}
}

const STATE_ACTIVE = 0;
const STATE_DEAD = 1;
const STATE_FLYING = 2;
const STATE_GATHERING = 3;
const STATE_WORKER = 4;

function memory() {
  return null;
}

export default init;
export {
  simd_supported,
  BoidsEngine,
  STATE_ACTIVE,
  STATE_DEAD,
  STATE_FLYING,
  STATE_GATHERING,
  STATE_WORKER,
  memory,
};
