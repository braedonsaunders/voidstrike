/* tslint:disable */
/* eslint-disable */

/**
 * Main boids computation engine
 *
 * Manages memory buffers and provides the interface for JS to
 * populate unit data and retrieve computed forces.
 */
export class BoidsEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Clear all buffers for reuse
     */
    clear(): void;
    /**
     * Compute all boids forces using SIMD
     *
     * Prerequisites:
     * 1. Populate input arrays (positions, velocities, radii, states, layers)
     * 2. Set unit_count
     * 3. Populate neighbor arrays (neighbors, offsets, counts)
     * 4. Set neighbor_total
     *
     * After calling, read results from force arrays.
     */
    compute_forces(): void;
    /**
     * Get pointer to alignment force X array (read after compute)
     */
    force_align_x_ptr(): number;
    /**
     * Get pointer to alignment force Y array (read after compute)
     */
    force_align_y_ptr(): number;
    /**
     * Get pointer to cohesion force X array (read after compute)
     */
    force_coh_x_ptr(): number;
    /**
     * Get pointer to cohesion force Y array (read after compute)
     */
    force_coh_y_ptr(): number;
    /**
     * Get pointer to separation force X array (read after compute)
     */
    force_sep_x_ptr(): number;
    /**
     * Get pointer to separation force Y array (read after compute)
     */
    force_sep_y_ptr(): number;
    /**
     * Get pointer to layers array (u8)
     */
    layers_ptr(): number;
    /**
     * Get pointer to neighbor counts array (for JS to populate)
     */
    neighbor_counts_ptr(): number;
    /**
     * Get pointer to neighbor offsets array (for JS to populate)
     */
    neighbor_offsets_ptr(): number;
    /**
     * Get pointer to neighbors array (for JS to populate)
     */
    neighbors_ptr(): number;
    /**
     * Create a new boids engine with capacity for `max_units`
     */
    constructor(max_units: number);
    /**
     * Get pointer to positions X array
     */
    positions_x_ptr(): number;
    /**
     * Get pointer to positions Y array
     */
    positions_y_ptr(): number;
    /**
     * Get pointer to radii array
     */
    radii_ptr(): number;
    /**
     * Set alignment parameters
     */
    set_alignment_params(radius: number, strength: number): void;
    /**
     * Set cohesion parameters
     */
    set_cohesion_params(radius: number, strength: number): void;
    /**
     * Set minimum speed for alignment (units below this speed are ignored)
     */
    set_min_moving_speed(speed: number): void;
    /**
     * Set total neighbor count (after JS populates neighbor array)
     */
    set_neighbor_total(count: number): void;
    /**
     * Set separation parameters
     */
    set_separation_params(radius: number, strength: number, max_force: number): void;
    /**
     * Get pointer to states array (u8)
     */
    states_ptr(): number;
    /**
     * Get pointer to velocities X array
     */
    velocities_x_ptr(): number;
    /**
     * Get pointer to velocities Y array
     */
    velocities_y_ptr(): number;
    /**
     * Get the buffer capacity (max units)
     */
    readonly capacity: number;
    /**
     * Get the current unit count
     */
    unit_count: number;
}

/**
 * Initialize panic hook for better error messages in browser console
 */
export function init(): void;

/**
 * Check if WASM SIMD is available
 */
export function simd_supported(): boolean;

/**
 * Unit is active and should be processed
 */
export function state_active(): number;

/**
 * Unit is dead/inactive
 */
export function state_dead(): number;

/**
 * Unit is flying (different collision layer)
 */
export function state_flying(): number;

/**
 * Unit is gathering resources (no separation)
 */
export function state_gathering(): number;

/**
 * Unit is a worker (special rules)
 */
export function state_worker(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_boidsengine_free: (a: number, b: number) => void;
    readonly boidsengine_capacity: (a: number) => number;
    readonly boidsengine_clear: (a: number) => void;
    readonly boidsengine_compute_forces: (a: number) => void;
    readonly boidsengine_force_align_x_ptr: (a: number) => number;
    readonly boidsengine_force_align_y_ptr: (a: number) => number;
    readonly boidsengine_force_coh_x_ptr: (a: number) => number;
    readonly boidsengine_force_coh_y_ptr: (a: number) => number;
    readonly boidsengine_force_sep_x_ptr: (a: number) => number;
    readonly boidsengine_force_sep_y_ptr: (a: number) => number;
    readonly boidsengine_layers_ptr: (a: number) => number;
    readonly boidsengine_neighbor_counts_ptr: (a: number) => number;
    readonly boidsengine_neighbor_offsets_ptr: (a: number) => number;
    readonly boidsengine_neighbors_ptr: (a: number) => number;
    readonly boidsengine_new: (a: number) => number;
    readonly boidsengine_positions_x_ptr: (a: number) => number;
    readonly boidsengine_positions_y_ptr: (a: number) => number;
    readonly boidsengine_radii_ptr: (a: number) => number;
    readonly boidsengine_set_alignment_params: (a: number, b: number, c: number) => void;
    readonly boidsengine_set_cohesion_params: (a: number, b: number, c: number) => void;
    readonly boidsengine_set_min_moving_speed: (a: number, b: number) => void;
    readonly boidsengine_set_neighbor_total: (a: number, b: number) => void;
    readonly boidsengine_set_separation_params: (a: number, b: number, c: number, d: number) => void;
    readonly boidsengine_set_unit_count: (a: number, b: number) => void;
    readonly boidsengine_states_ptr: (a: number) => number;
    readonly boidsengine_unit_count: (a: number) => number;
    readonly boidsengine_velocities_x_ptr: (a: number) => number;
    readonly boidsengine_velocities_y_ptr: (a: number) => number;
    readonly simd_supported: () => number;
    readonly state_active: () => number;
    readonly state_flying: () => number;
    readonly state_gathering: () => number;
    readonly state_worker: () => number;
    readonly init: () => void;
    readonly state_dead: () => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
