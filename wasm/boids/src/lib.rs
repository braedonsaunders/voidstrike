//! WASM SIMD Boids Module
//!
//! High-performance boids flocking algorithm using WebAssembly SIMD.
//! Processes 4 units simultaneously per SIMD instruction for 4x throughput.
//!
//! # Architecture
//!
//! The module uses Structure of Arrays (SoA) layout for SIMD-friendly access:
//! - All X positions are contiguous in memory
//! - All Y positions are contiguous in memory
//! - etc.
//!
//! This enables efficient f32x4 vector loads that grab 4 units' worth of
//! data in a single instruction.
//!
//! # Usage from JavaScript
//!
//! ```javascript
//! import init, { BoidsEngine } from './boids_wasm.js';
//!
//! await init();
//! const engine = new BoidsEngine(500); // Max 500 units
//!
//! // Get typed array views into WASM memory
//! const posX = engine.positions_x();
//! const posY = engine.positions_y();
//!
//! // Populate from game state
//! for (let i = 0; i < unitCount; i++) {
//!     posX[i] = units[i].x;
//!     posY[i] = units[i].y;
//! }
//!
//! // Compute forces
//! engine.set_unit_count(unitCount);
//! engine.compute_forces(separationStrength, cohesionStrength, alignmentStrength);
//!
//! // Read results
//! const forceX = engine.separation_force_x();
//! const forceY = engine.separation_force_y();
//! ```

mod simd;
mod soa;

use soa::{BoidsBuffer, NeighborList};
use wasm_bindgen::prelude::*;

// Use `wee_alloc` as the global allocator for smaller WASM size
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

/// Initialize panic hook for better error messages in browser console
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Check if WASM SIMD is available
#[wasm_bindgen]
pub fn simd_supported() -> bool {
    simd::simd_available()
}

/// Main boids computation engine
///
/// Manages memory buffers and provides the interface for JS to
/// populate unit data and retrieve computed forces.
#[wasm_bindgen]
pub struct BoidsEngine {
    buffer: BoidsBuffer,
    neighbors: NeighborList,
    params: simd::BoidsParams,
}

#[wasm_bindgen]
impl BoidsEngine {
    /// Create a new boids engine with capacity for `max_units`
    #[wasm_bindgen(constructor)]
    pub fn new(max_units: usize) -> Self {
        Self {
            buffer: BoidsBuffer::new(max_units),
            neighbors: NeighborList::new(max_units),
            params: simd::BoidsParams::default(),
        }
    }

    /// Get the buffer capacity (max units)
    #[wasm_bindgen(getter)]
    pub fn capacity(&self) -> usize {
        self.buffer.capacity()
    }

    /// Get the current unit count
    #[wasm_bindgen(getter)]
    pub fn unit_count(&self) -> usize {
        self.buffer.len()
    }

    /// Set the current unit count (after JS populates buffers)
    #[wasm_bindgen(setter)]
    pub fn set_unit_count(&mut self, count: usize) {
        self.buffer.set_count(count);
    }

    // ==================== Buffer Pointers ====================
    // These return raw pointers that JS converts to Float32Array views

    /// Get pointer to positions X array
    #[wasm_bindgen]
    pub fn positions_x_ptr(&self) -> *mut f32 {
        self.buffer.positions_x_ptr()
    }

    /// Get pointer to positions Y array
    #[wasm_bindgen]
    pub fn positions_y_ptr(&self) -> *mut f32 {
        self.buffer.positions_y_ptr()
    }

    /// Get pointer to velocities X array
    #[wasm_bindgen]
    pub fn velocities_x_ptr(&self) -> *mut f32 {
        self.buffer.velocities_x_ptr()
    }

    /// Get pointer to velocities Y array
    #[wasm_bindgen]
    pub fn velocities_y_ptr(&self) -> *mut f32 {
        self.buffer.velocities_y_ptr()
    }

    /// Get pointer to radii array
    #[wasm_bindgen]
    pub fn radii_ptr(&self) -> *mut f32 {
        self.buffer.radii_ptr()
    }

    /// Get pointer to states array (u8)
    #[wasm_bindgen]
    pub fn states_ptr(&self) -> *mut u8 {
        self.buffer.states_ptr()
    }

    /// Get pointer to layers array (u8)
    #[wasm_bindgen]
    pub fn layers_ptr(&self) -> *mut u8 {
        self.buffer.layers_ptr()
    }

    // ==================== Force Output Pointers ====================

    /// Get pointer to separation force X array (read after compute)
    #[wasm_bindgen]
    pub fn force_sep_x_ptr(&self) -> *mut f32 {
        self.buffer.force_sep_x_ptr()
    }

    /// Get pointer to separation force Y array (read after compute)
    #[wasm_bindgen]
    pub fn force_sep_y_ptr(&self) -> *mut f32 {
        self.buffer.force_sep_y_ptr()
    }

    /// Get pointer to cohesion force X array (read after compute)
    #[wasm_bindgen]
    pub fn force_coh_x_ptr(&self) -> *mut f32 {
        self.buffer.force_coh_x_ptr()
    }

    /// Get pointer to cohesion force Y array (read after compute)
    #[wasm_bindgen]
    pub fn force_coh_y_ptr(&self) -> *mut f32 {
        self.buffer.force_coh_y_ptr()
    }

    /// Get pointer to alignment force X array (read after compute)
    #[wasm_bindgen]
    pub fn force_align_x_ptr(&self) -> *mut f32 {
        self.buffer.force_align_x_ptr()
    }

    /// Get pointer to alignment force Y array (read after compute)
    #[wasm_bindgen]
    pub fn force_align_y_ptr(&self) -> *mut f32 {
        self.buffer.force_align_y_ptr()
    }

    // ==================== Neighbor List Pointers ====================

    /// Get pointer to neighbors array (for JS to populate)
    #[wasm_bindgen]
    pub fn neighbors_ptr(&mut self) -> *mut u32 {
        self.neighbors.neighbors_ptr_mut()
    }

    /// Get pointer to neighbor offsets array (for JS to populate)
    #[wasm_bindgen]
    pub fn neighbor_offsets_ptr(&mut self) -> *mut u32 {
        self.neighbors.offsets_ptr_mut()
    }

    /// Get pointer to neighbor counts array (for JS to populate)
    #[wasm_bindgen]
    pub fn neighbor_counts_ptr(&mut self) -> *mut u32 {
        self.neighbors.counts_ptr_mut()
    }

    /// Set total neighbor count (after JS populates neighbor array)
    #[wasm_bindgen]
    pub fn set_neighbor_total(&mut self, count: usize) {
        self.neighbors.set_neighbor_count(count);
    }

    // ==================== Parameters ====================

    /// Set separation parameters
    #[wasm_bindgen]
    pub fn set_separation_params(&mut self, radius: f32, strength: f32, max_force: f32) {
        self.params.separation_radius = radius;
        self.params.separation_strength = strength;
        self.params.max_separation_force = max_force;
    }

    /// Set cohesion parameters
    #[wasm_bindgen]
    pub fn set_cohesion_params(&mut self, radius: f32, strength: f32) {
        self.params.cohesion_radius = radius;
        self.params.cohesion_strength = strength;
    }

    /// Set alignment parameters
    #[wasm_bindgen]
    pub fn set_alignment_params(&mut self, radius: f32, strength: f32) {
        self.params.alignment_radius = radius;
        self.params.alignment_strength = strength;
    }

    /// Set minimum speed for alignment (units below this speed are ignored)
    #[wasm_bindgen]
    pub fn set_min_moving_speed(&mut self, speed: f32) {
        self.params.min_moving_speed = speed;
    }

    // ==================== Computation ====================

    /// Compute all boids forces using SIMD
    ///
    /// Prerequisites:
    /// 1. Populate input arrays (positions, velocities, radii, states, layers)
    /// 2. Set unit_count
    /// 3. Populate neighbor arrays (neighbors, offsets, counts)
    /// 4. Set neighbor_total
    ///
    /// After calling, read results from force arrays.
    #[wasm_bindgen]
    pub fn compute_forces(&mut self) {
        simd::compute_all_forces_simd(&mut self.buffer, &self.neighbors, &self.params);
    }

    /// Clear all buffers for reuse
    #[wasm_bindgen]
    pub fn clear(&mut self) {
        self.buffer.clear();
        self.neighbors.clear();
    }
}

// ==================== Unit State Constants ====================
// Exposed as getter functions for JS (wasm_bindgen doesn't support const exports)

/// Unit is active and should be processed
#[wasm_bindgen]
pub fn state_active() -> u8 {
    0
}

/// Unit is dead/inactive
#[wasm_bindgen]
pub fn state_dead() -> u8 {
    1
}

/// Unit is flying (different collision layer)
#[wasm_bindgen]
pub fn state_flying() -> u8 {
    2
}

/// Unit is gathering resources (no separation)
#[wasm_bindgen]
pub fn state_gathering() -> u8 {
    3
}

/// Unit is a worker (special rules)
#[wasm_bindgen]
pub fn state_worker() -> u8 {
    4
}

// Note: wasm-bindgen automatically exports `memory` - don't define it manually

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_creation() {
        let engine = BoidsEngine::new(100);
        assert_eq!(engine.capacity(), 100);
        assert_eq!(engine.unit_count(), 0);
    }

    #[test]
    fn test_simd_check() {
        // On native, SIMD is not available
        #[cfg(not(target_arch = "wasm32"))]
        assert!(!simd_supported());
    }
}
