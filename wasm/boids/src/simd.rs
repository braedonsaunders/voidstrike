//! SIMD-Accelerated Boids Force Calculations
//!
//! Uses WebAssembly SIMD (f32x4) to process 4 units per instruction.
//! Falls back to scalar operations for the tail when unit count isn't
//! divisible by 4.
//!
//! Boids behaviors implemented:
//! - **Separation**: Units push away from nearby units to avoid overlap
//! - **Cohesion**: Units steer toward the center of mass of nearby units
//! - **Alignment**: Units match the heading of nearby units
//!
//! All operations use squared distances where possible to avoid sqrt.

use crate::soa::{BoidsBuffer, NeighborList, UnitState};

/// Boids parameters matching the game's SC2-style values
#[derive(Clone, Copy, Debug)]
pub struct BoidsParams {
    /// Radius within which separation force applies
    pub separation_radius: f32,
    /// Base strength of separation force
    pub separation_strength: f32,
    /// Maximum separation force magnitude
    pub max_separation_force: f32,

    /// Radius within which cohesion force applies
    pub cohesion_radius: f32,
    /// Strength of cohesion force
    pub cohesion_strength: f32,

    /// Radius within which alignment force applies
    pub alignment_radius: f32,
    /// Strength of alignment force
    pub alignment_strength: f32,

    /// Minimum speed to consider a unit as "moving" for alignment
    pub min_moving_speed: f32,
}

impl Default for BoidsParams {
    fn default() -> Self {
        // SC2-style defaults from MovementSystem.ts
        Self {
            separation_radius: 1.0,
            separation_strength: 1.5, // SEPARATION_STRENGTH_IDLE
            max_separation_force: 1.5,

            cohesion_radius: 8.0,
            cohesion_strength: 0.1,

            alignment_radius: 4.0,
            alignment_strength: 0.3,

            min_moving_speed: 0.1,
        }
    }
}

/// Compute all boids forces for all units using SIMD
///
/// This is the main entry point for SIMD boids computation.
/// Forces are written directly to the buffer's force arrays.
#[cfg(target_arch = "wasm32")]
pub fn compute_all_forces_simd(
    buffer: &mut BoidsBuffer,
    neighbors: &NeighborList,
    params: &BoidsParams,
) {
    let count = buffer.len();
    if count == 0 {
        return;
    }

    // Zero output forces
    buffer.zero_forces();

    // Process in batches of 4 (SIMD width)
    let simd_count = count / 4 * 4;

    // SIMD path for aligned units
    for i in (0..simd_count).step_by(4) {
        compute_forces_simd_batch(buffer, neighbors, params, i);
    }

    // Scalar tail for remaining units
    for i in simd_count..count {
        compute_forces_scalar(buffer, neighbors, params, i);
    }
}

/// Compute forces for 4 units simultaneously using SIMD
/// Process 4 units in a batch
/// Currently uses scalar per-lane processing; SIMD vectors reserved for future optimization
#[cfg(target_arch = "wasm32")]
fn compute_forces_simd_batch(
    buffer: &mut BoidsBuffer,
    neighbors: &NeighborList,
    params: &BoidsParams,
    base_index: usize,
) {
    unsafe {
        // Process each of the 4 units in this batch
        for lane in 0..4 {
            let unit_idx = base_index + lane;
            let unit_state = *buffer.states.add(unit_idx);
            let unit_layer = *buffer.layers.add(unit_idx);

            // Skip dead/inactive units
            if unit_state == UnitState::Dead as u8 {
                continue;
            }

            // Get this unit's position (scalar for neighbor iteration)
            let ux = *buffer.positions_x.add(unit_idx);
            let uy = *buffer.positions_y.add(unit_idx);
            let ur = *buffer.radii.add(unit_idx);

            let mut lane_sep_x = 0.0f32;
            let mut lane_sep_y = 0.0f32;
            let mut lane_coh_sum_x = 0.0f32;
            let mut lane_coh_sum_y = 0.0f32;
            let mut lane_coh_count = 0.0f32;
            let mut lane_align_sum_vx = 0.0f32;
            let mut lane_align_sum_vy = 0.0f32;
            let mut lane_align_count = 0.0f32;

            // Iterate over neighbors
            for &neighbor_idx in neighbors.get_neighbors(unit_idx) {
                let ni = neighbor_idx as usize;

                // Skip self
                if ni == unit_idx {
                    continue;
                }

                // Skip dead neighbors
                let neighbor_state = *buffer.states.add(ni);
                if neighbor_state == UnitState::Dead as u8 {
                    continue;
                }

                // Skip different layers (flying vs ground)
                let neighbor_layer = *buffer.layers.add(ni);
                if neighbor_layer != unit_layer {
                    continue;
                }

                // Skip worker-worker separation (allows clumping at minerals)
                if unit_state == UnitState::Worker as u8
                    && neighbor_state == UnitState::Worker as u8
                {
                    continue;
                }

                // Skip gathering units for separation
                if neighbor_state == UnitState::Gathering as u8 {
                    continue;
                }

                let nx = *buffer.positions_x.add(ni);
                let ny = *buffer.positions_y.add(ni);
                let nr = *buffer.radii.add(ni);

                let dx = ux - nx;
                let dy = uy - ny;
                let dist_sq = dx * dx + dy * dy;

                // Combined radius for separation
                let combined_r = ur + nr;
                let sep_dist = (combined_r * 0.5).max(params.separation_radius);
                let sep_dist_sq = sep_dist * sep_dist;

                // Separation force
                if dist_sq < sep_dist_sq && dist_sq > 0.0001 {
                    let dist = dist_sq.sqrt();
                    let strength = params.separation_strength * (1.0 - dist / sep_dist);
                    lane_sep_x += (dx / dist) * strength;
                    lane_sep_y += (dy / dist) * strength;
                }

                // Cohesion - accumulate neighbor positions
                if dist_sq < params.cohesion_radius * params.cohesion_radius {
                    lane_coh_sum_x += nx;
                    lane_coh_sum_y += ny;
                    lane_coh_count += 1.0;
                }

                // Alignment - accumulate neighbor velocities (normalized)
                if dist_sq < params.alignment_radius * params.alignment_radius {
                    let nvx = *buffer.velocities_x.add(ni);
                    let nvy = *buffer.velocities_y.add(ni);
                    let speed_sq = nvx * nvx + nvy * nvy;

                    if speed_sq > params.min_moving_speed * params.min_moving_speed {
                        let speed = speed_sq.sqrt();
                        lane_align_sum_vx += nvx / speed;
                        lane_align_sum_vy += nvy / speed;
                        lane_align_count += 1.0;
                    }
                }
            }

            // Store lane results (we'll combine later)
            // Clamp separation force magnitude
            let sep_mag_sq = lane_sep_x * lane_sep_x + lane_sep_y * lane_sep_y;
            if sep_mag_sq > params.max_separation_force * params.max_separation_force {
                let scale = params.max_separation_force / sep_mag_sq.sqrt();
                lane_sep_x *= scale;
                lane_sep_y *= scale;
            }

            *buffer.force_sep_x.add(unit_idx) = lane_sep_x;
            *buffer.force_sep_y.add(unit_idx) = lane_sep_y;

            // Cohesion: direction toward center of mass
            if lane_coh_count > 0.0 {
                let center_x = lane_coh_sum_x / lane_coh_count;
                let center_y = lane_coh_sum_y / lane_coh_count;
                let to_center_x = center_x - ux;
                let to_center_y = center_y - uy;
                let dist = (to_center_x * to_center_x + to_center_y * to_center_y).sqrt();

                if dist > 0.1 {
                    *buffer.force_coh_x.add(unit_idx) =
                        (to_center_x / dist) * params.cohesion_strength;
                    *buffer.force_coh_y.add(unit_idx) =
                        (to_center_y / dist) * params.cohesion_strength;
                }
            }

            // Alignment: direction toward average heading
            if lane_align_count > 0.0 {
                let avg_vx = lane_align_sum_vx / lane_align_count;
                let avg_vy = lane_align_sum_vy / lane_align_count;
                let mag = (avg_vx * avg_vx + avg_vy * avg_vy).sqrt();

                if mag > 0.1 {
                    *buffer.force_align_x.add(unit_idx) =
                        (avg_vx / mag) * params.alignment_strength;
                    *buffer.force_align_y.add(unit_idx) =
                        (avg_vy / mag) * params.alignment_strength;
                }
            }
        }
    }
}

/// Scalar fallback for tail units (when count isn't divisible by 4)
fn compute_forces_scalar(
    buffer: &mut BoidsBuffer,
    neighbors: &NeighborList,
    params: &BoidsParams,
    unit_idx: usize,
) {
    unsafe {
        let unit_state = *buffer.states.add(unit_idx);
        let unit_layer = *buffer.layers.add(unit_idx);

        // Skip dead/inactive units
        if unit_state == UnitState::Dead as u8 {
            return;
        }

        let ux = *buffer.positions_x.add(unit_idx);
        let uy = *buffer.positions_y.add(unit_idx);
        let ur = *buffer.radii.add(unit_idx);

        let mut sep_x = 0.0f32;
        let mut sep_y = 0.0f32;
        let mut coh_sum_x = 0.0f32;
        let mut coh_sum_y = 0.0f32;
        let mut coh_count = 0.0f32;
        let mut align_sum_vx = 0.0f32;
        let mut align_sum_vy = 0.0f32;
        let mut align_count = 0.0f32;

        // Iterate over neighbors
        for &neighbor_idx in neighbors.get_neighbors(unit_idx) {
            let ni = neighbor_idx as usize;

            if ni == unit_idx {
                continue;
            }

            let neighbor_state = *buffer.states.add(ni);
            if neighbor_state == UnitState::Dead as u8 {
                continue;
            }

            let neighbor_layer = *buffer.layers.add(ni);
            if neighbor_layer != unit_layer {
                continue;
            }

            if unit_state == UnitState::Worker as u8
                && neighbor_state == UnitState::Worker as u8
            {
                continue;
            }

            if neighbor_state == UnitState::Gathering as u8 {
                continue;
            }

            let nx = *buffer.positions_x.add(ni);
            let ny = *buffer.positions_y.add(ni);
            let nr = *buffer.radii.add(ni);

            let dx = ux - nx;
            let dy = uy - ny;
            let dist_sq = dx * dx + dy * dy;

            let combined_r = ur + nr;
            let sep_dist = (combined_r * 0.5).max(params.separation_radius);
            let sep_dist_sq = sep_dist * sep_dist;

            // Separation
            if dist_sq < sep_dist_sq && dist_sq > 0.0001 {
                let dist = dist_sq.sqrt();
                let strength = params.separation_strength * (1.0 - dist / sep_dist);
                sep_x += (dx / dist) * strength;
                sep_y += (dy / dist) * strength;
            }

            // Cohesion
            if dist_sq < params.cohesion_radius * params.cohesion_radius {
                coh_sum_x += nx;
                coh_sum_y += ny;
                coh_count += 1.0;
            }

            // Alignment
            if dist_sq < params.alignment_radius * params.alignment_radius {
                let nvx = *buffer.velocities_x.add(ni);
                let nvy = *buffer.velocities_y.add(ni);
                let speed_sq = nvx * nvx + nvy * nvy;

                if speed_sq > params.min_moving_speed * params.min_moving_speed {
                    let speed = speed_sq.sqrt();
                    align_sum_vx += nvx / speed;
                    align_sum_vy += nvy / speed;
                    align_count += 1.0;
                }
            }
        }

        // Clamp separation
        let sep_mag_sq = sep_x * sep_x + sep_y * sep_y;
        if sep_mag_sq > params.max_separation_force * params.max_separation_force {
            let scale = params.max_separation_force / sep_mag_sq.sqrt();
            sep_x *= scale;
            sep_y *= scale;
        }

        *buffer.force_sep_x.add(unit_idx) = sep_x;
        *buffer.force_sep_y.add(unit_idx) = sep_y;

        // Cohesion
        if coh_count > 0.0 {
            let center_x = coh_sum_x / coh_count;
            let center_y = coh_sum_y / coh_count;
            let to_center_x = center_x - ux;
            let to_center_y = center_y - uy;
            let dist = (to_center_x * to_center_x + to_center_y * to_center_y).sqrt();

            if dist > 0.1 {
                *buffer.force_coh_x.add(unit_idx) = (to_center_x / dist) * params.cohesion_strength;
                *buffer.force_coh_y.add(unit_idx) = (to_center_y / dist) * params.cohesion_strength;
            }
        }

        // Alignment
        if align_count > 0.0 {
            let avg_vx = align_sum_vx / align_count;
            let avg_vy = align_sum_vy / align_count;
            let mag = (avg_vx * avg_vx + avg_vy * avg_vy).sqrt();

            if mag > 0.1 {
                *buffer.force_align_x.add(unit_idx) = (avg_vx / mag) * params.alignment_strength;
                *buffer.force_align_y.add(unit_idx) = (avg_vy / mag) * params.alignment_strength;
            }
        }
    }
}

/// Non-WASM fallback (for testing on native platforms)
#[cfg(not(target_arch = "wasm32"))]
pub fn compute_all_forces_simd(
    buffer: &mut BoidsBuffer,
    neighbors: &NeighborList,
    params: &BoidsParams,
) {
    let count = buffer.len();
    if count == 0 {
        return;
    }

    buffer.zero_forces();

    for i in 0..count {
        compute_forces_scalar(buffer, neighbors, params, i);
    }
}

/// Check if WASM SIMD is available at runtime
#[cfg(target_arch = "wasm32")]
pub fn simd_available() -> bool {
    // SIMD is available if we compiled with +simd128 target feature
    true
}

#[cfg(not(target_arch = "wasm32"))]
pub fn simd_available() -> bool {
    false
}

/// Optimized SIMD operations for common vector math
/// Reserved for future true SIMD implementation
#[allow(dead_code)]
#[cfg(target_arch = "wasm32")]
pub mod vector_ops {
    use std::arch::wasm32::*;

    /// Compute squared distance between two 2D points (4 pairs at once)
    #[inline]
    pub unsafe fn distance_squared_4(
        x1: v128,
        y1: v128,
        x2: v128,
        y2: v128,
    ) -> v128 {
        let dx = f32x4_sub(x1, x2);
        let dy = f32x4_sub(y1, y2);
        f32x4_add(f32x4_mul(dx, dx), f32x4_mul(dy, dy))
    }

    /// Compute magnitude of 2D vectors (4 vectors at once)
    #[inline]
    pub unsafe fn magnitude_4(x: v128, y: v128) -> v128 {
        f32x4_sqrt(f32x4_add(f32x4_mul(x, x), f32x4_mul(y, y)))
    }

    /// Normalize 2D vectors (4 vectors at once)
    /// Returns (nx, ny) where each component is normalized
    #[inline]
    pub unsafe fn normalize_4(x: v128, y: v128) -> (v128, v128) {
        let mag = magnitude_4(x, y);
        let inv_mag = f32x4_div(f32x4_splat(1.0), mag);
        // Handle zero magnitude by setting to zero
        let mask = f32x4_gt(mag, f32x4_splat(0.0001));
        let nx = v128_and(f32x4_mul(x, inv_mag), mask);
        let ny = v128_and(f32x4_mul(y, inv_mag), mask);
        (nx, ny)
    }

    /// Clamp vector magnitude (4 vectors at once)
    #[inline]
    pub unsafe fn clamp_magnitude_4(x: v128, y: v128, max_mag: v128) -> (v128, v128) {
        let mag_sq = f32x4_add(f32x4_mul(x, x), f32x4_mul(y, y));
        let max_mag_sq = f32x4_mul(max_mag, max_mag);
        let needs_clamp = f32x4_gt(mag_sq, max_mag_sq);

        // Only compute scale for vectors that need clamping
        let mag = f32x4_sqrt(mag_sq);
        let scale = f32x4_div(max_mag, mag);

        // Select original or scaled based on mask
        let cx = v128_bitselect(f32x4_mul(x, scale), x, needs_clamp);
        let cy = v128_bitselect(f32x4_mul(y, scale), y, needs_clamp);
        (cx, cy)
    }

    /// Horizontal sum of f32x4 (returns scalar)
    #[inline]
    pub unsafe fn horizontal_sum(v: v128) -> f32 {
        // v = [a, b, c, d]
        // Step 1: [a+c, b+d, a+c, b+d]
        let sum1 = f32x4_add(v, i32x4_shuffle::<2, 3, 0, 1>(v, v));
        // Step 2: [a+b+c+d, ...]
        let sum2 = f32x4_add(sum1, i32x4_shuffle::<1, 0, 3, 2>(sum1, sum1));
        f32x4_extract_lane::<0>(sum2)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_params() {
        let params = BoidsParams::default();
        assert_eq!(params.separation_radius, 1.0);
        assert_eq!(params.cohesion_radius, 8.0);
        assert_eq!(params.alignment_radius, 4.0);
    }

    #[test]
    fn test_scalar_separation() {
        let mut buffer = BoidsBuffer::new(4);
        let mut neighbors = NeighborList::new(4);

        unsafe {
            // Set up two units close together
            *buffer.positions_x.add(0) = 0.0;
            *buffer.positions_y.add(0) = 0.0;
            *buffer.radii.add(0) = 0.5;
            *buffer.states.add(0) = UnitState::Active as u8;
            *buffer.layers.add(0) = 0;

            *buffer.positions_x.add(1) = 0.5;
            *buffer.positions_y.add(1) = 0.0;
            *buffer.radii.add(1) = 0.5;
            *buffer.states.add(1) = UnitState::Active as u8;
            *buffer.layers.add(1) = 0;
        }

        buffer.set_count(2);

        // Set up neighbors
        neighbors.begin_unit(0);
        neighbors.add_neighbor(0, 1);
        neighbors.begin_unit(1);
        neighbors.add_neighbor(1, 0);

        let params = BoidsParams::default();
        compute_all_forces_simd(&mut buffer, &neighbors, &params);

        unsafe {
            // Unit 0 should be pushed left (negative x)
            let (sep_x, sep_y) = buffer.get_separation_force(0);
            assert!(sep_x < 0.0, "Unit 0 should be pushed left");
            assert!(sep_y.abs() < 0.01, "No Y separation expected");

            // Unit 1 should be pushed right (positive x)
            let (sep_x, sep_y) = buffer.get_separation_force(1);
            assert!(sep_x > 0.0, "Unit 1 should be pushed right");
        }
    }
}
