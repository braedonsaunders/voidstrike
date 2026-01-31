//! SIMD-Accelerated Boids Force Calculations
//!
//! Uses WebAssembly SIMD (f32x4) to process 4 neighbors per instruction.
//! For each unit, neighbors are processed in SIMD batches of 4, with
//! scalar handling for the tail when neighbor count isn't divisible by 4.
//!
//! Boids behaviors implemented:
//! - **Separation**: Units push away from nearby units to avoid overlap
//! - **Cohesion**: Units steer toward the center of mass of nearby units
//! - **Alignment**: Units match the heading of nearby units
//!
//! All operations use squared distances where possible to avoid sqrt.

#[cfg(target_arch = "wasm32")]
use std::arch::wasm32::*;

use crate::soa::{BoidsBuffer, NeighborList, UnitState};

/// Boids parameters matching the game's RTS-style values
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
        // RTS-style defaults from MovementSystem.ts
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

/// SIMD vector operations for batch neighbor processing
#[cfg(target_arch = "wasm32")]
pub mod vector_ops {
    use std::arch::wasm32::*;

    /// Gather 4 f32 values from scattered indices into a v128
    /// WASM SIMD lacks native gather, so we do 4 scalar loads
    #[inline]
    pub unsafe fn gather_f32x4(
        ptr: *const f32,
        i0: usize,
        i1: usize,
        i2: usize,
        i3: usize,
    ) -> v128 {
        f32x4(
            *ptr.add(i0),
            *ptr.add(i1),
            *ptr.add(i2),
            *ptr.add(i3),
        )
    }

    /// Compute squared distance between two 2D points (4 pairs at once)
    #[inline]
    pub unsafe fn distance_squared_4(x1: v128, y1: v128, x2: v128, y2: v128) -> v128 {
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
    /// Returns (nx, ny) with zero-magnitude protection
    #[inline]
    pub unsafe fn normalize_4(x: v128, y: v128) -> (v128, v128) {
        let mag = magnitude_4(x, y);
        let epsilon = f32x4_splat(0.0001);
        let safe_mag = f32x4_max(mag, epsilon);
        let inv_mag = f32x4_div(f32x4_splat(1.0), safe_mag);

        // Zero out results where original magnitude was too small
        let valid = f32x4_gt(mag, epsilon);
        let nx = v128_and(f32x4_mul(x, inv_mag), valid);
        let ny = v128_and(f32x4_mul(y, inv_mag), valid);
        (nx, ny)
    }

    /// Clamp vector magnitude (4 vectors at once)
    #[inline]
    pub unsafe fn clamp_magnitude_4(x: v128, y: v128, max_mag: v128) -> (v128, v128) {
        let mag_sq = f32x4_add(f32x4_mul(x, x), f32x4_mul(y, y));
        let max_mag_sq = f32x4_mul(max_mag, max_mag);
        let needs_clamp = f32x4_gt(mag_sq, max_mag_sq);

        let mag = f32x4_sqrt(f32x4_max(mag_sq, f32x4_splat(0.0001)));
        let scale = f32x4_div(max_mag, mag);

        // Select original or scaled based on clamp mask
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

    /// Create a v128 mask from 4 boolean conditions
    /// True lanes get all 1s (-1 as i32), false lanes get 0s
    #[inline]
    pub unsafe fn mask_from_bools(b0: bool, b1: bool, b2: bool, b3: bool) -> v128 {
        i32x4(
            if b0 { -1 } else { 0 },
            if b1 { -1 } else { 0 },
            if b2 { -1 } else { 0 },
            if b3 { -1 } else { 0 },
        )
    }

    /// Apply mask to a vector (zeroes lanes where mask is false)
    #[inline]
    pub unsafe fn apply_mask(v: v128, mask: v128) -> v128 {
        v128_and(v, mask)
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

    // Process each unit with SIMD-batched neighbor processing
    for unit_idx in 0..count {
        compute_unit_forces_simd(buffer, neighbors, params, unit_idx);
    }
}

/// Check if a neighbor should be processed for boids forces
#[inline]
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
unsafe fn is_valid_neighbor(
    buffer: &BoidsBuffer,
    unit_idx: usize,
    unit_state: u8,
    unit_layer: u8,
    neighbor_idx: usize,
) -> bool {
    // Skip self
    if neighbor_idx == unit_idx {
        return false;
    }

    let neighbor_state = *buffer.states.add(neighbor_idx);

    // Skip dead neighbors
    if neighbor_state == UnitState::Dead as u8 {
        return false;
    }

    // Skip different layers (flying vs ground)
    let neighbor_layer = *buffer.layers.add(neighbor_idx);
    if neighbor_layer != unit_layer {
        return false;
    }

    // Skip worker-worker separation (allows clumping at minerals)
    if unit_state == UnitState::Worker as u8 && neighbor_state == UnitState::Worker as u8 {
        return false;
    }

    // Skip gathering units for separation
    if neighbor_state == UnitState::Gathering as u8 {
        return false;
    }

    true
}

/// Compute forces for a single unit using SIMD over neighbor batches
#[cfg(target_arch = "wasm32")]
fn compute_unit_forces_simd(
    buffer: &mut BoidsBuffer,
    neighbors: &NeighborList,
    params: &BoidsParams,
    unit_idx: usize,
) {
    use vector_ops::*;

    unsafe {
        let unit_state = *buffer.states.add(unit_idx);

        // Skip dead/inactive units
        if unit_state == UnitState::Dead as u8 {
            return;
        }

        let ux = *buffer.positions_x.add(unit_idx);
        let uy = *buffer.positions_y.add(unit_idx);
        let ur = *buffer.radii.add(unit_idx);
        let unit_layer = *buffer.layers.add(unit_idx);

        // SIMD accumulators for force components
        let mut sep_x_acc = f32x4_splat(0.0);
        let mut sep_y_acc = f32x4_splat(0.0);
        let mut coh_x_acc = f32x4_splat(0.0);
        let mut coh_y_acc = f32x4_splat(0.0);
        let mut coh_count_acc = f32x4_splat(0.0);
        let mut align_vx_acc = f32x4_splat(0.0);
        let mut align_vy_acc = f32x4_splat(0.0);
        let mut align_count_acc = f32x4_splat(0.0);

        // Splat unit values for SIMD operations
        let ux4 = f32x4_splat(ux);
        let uy4 = f32x4_splat(uy);
        let ur4 = f32x4_splat(ur);

        // Params as SIMD vectors
        let sep_radius = f32x4_splat(params.separation_radius);
        let sep_strength = f32x4_splat(params.separation_strength);
        let coh_radius_sq = f32x4_splat(params.cohesion_radius * params.cohesion_radius);
        let align_radius_sq = f32x4_splat(params.alignment_radius * params.alignment_radius);
        let min_speed_sq = f32x4_splat(params.min_moving_speed * params.min_moving_speed);
        let epsilon = f32x4_splat(0.0001);
        let one = f32x4_splat(1.0);

        let neighbor_slice = neighbors.get_neighbors(unit_idx);
        let neighbor_count = neighbor_slice.len();
        let simd_count = neighbor_count / 4 * 4;

        // SIMD path: process 4 neighbors at a time
        for batch_start in (0..simd_count).step_by(4) {
            let n0 = neighbor_slice[batch_start] as usize;
            let n1 = neighbor_slice[batch_start + 1] as usize;
            let n2 = neighbor_slice[batch_start + 2] as usize;
            let n3 = neighbor_slice[batch_start + 3] as usize;

            // Build validity mask for all skip conditions
            let valid0 = is_valid_neighbor(buffer, unit_idx, unit_state, unit_layer, n0);
            let valid1 = is_valid_neighbor(buffer, unit_idx, unit_state, unit_layer, n1);
            let valid2 = is_valid_neighbor(buffer, unit_idx, unit_state, unit_layer, n2);
            let valid3 = is_valid_neighbor(buffer, unit_idx, unit_state, unit_layer, n3);
            let valid_mask = mask_from_bools(valid0, valid1, valid2, valid3);

            // Gather neighbor positions
            let nx4 = gather_f32x4(buffer.positions_x, n0, n1, n2, n3);
            let ny4 = gather_f32x4(buffer.positions_y, n0, n1, n2, n3);
            let nr4 = gather_f32x4(buffer.radii, n0, n1, n2, n3);

            // Compute direction and distance
            let dx4 = f32x4_sub(ux4, nx4);
            let dy4 = f32x4_sub(uy4, ny4);
            let dist_sq = distance_squared_4(ux4, uy4, nx4, ny4);

            // === SEPARATION ===
            // Separation distance is proportional to combined unit sizes
            let combined_r = f32x4_add(ur4, nr4);
            let sep_dist = f32x4_mul(combined_r, sep_radius);
            let sep_dist_sq = f32x4_mul(sep_dist, sep_dist);

            // Check if in separation range (dist < sep_dist && dist > epsilon)
            let in_sep_range = v128_and(
                f32x4_lt(dist_sq, sep_dist_sq),
                f32x4_gt(dist_sq, epsilon),
            );
            let sep_mask = v128_and(valid_mask, in_sep_range);

            // Compute separation force: strength * (1 - dist/sep_dist) * normalized_direction
            let dist = f32x4_sqrt(f32x4_max(dist_sq, epsilon));
            let inv_dist = f32x4_div(one, dist);
            let strength = f32x4_mul(
                sep_strength,
                f32x4_sub(one, f32x4_div(dist, sep_dist)),
            );

            let sep_fx = f32x4_mul(f32x4_mul(dx4, inv_dist), strength);
            let sep_fy = f32x4_mul(f32x4_mul(dy4, inv_dist), strength);

            sep_x_acc = f32x4_add(sep_x_acc, apply_mask(sep_fx, sep_mask));
            sep_y_acc = f32x4_add(sep_y_acc, apply_mask(sep_fy, sep_mask));

            // === COHESION ===
            // Accumulate neighbor positions for center-of-mass calculation
            let in_coh_range = f32x4_lt(dist_sq, coh_radius_sq);
            let coh_mask = v128_and(valid_mask, in_coh_range);

            coh_x_acc = f32x4_add(coh_x_acc, apply_mask(nx4, coh_mask));
            coh_y_acc = f32x4_add(coh_y_acc, apply_mask(ny4, coh_mask));
            coh_count_acc = f32x4_add(coh_count_acc, apply_mask(one, coh_mask));

            // === ALIGNMENT ===
            // Accumulate normalized neighbor velocities
            let nvx4 = gather_f32x4(buffer.velocities_x, n0, n1, n2, n3);
            let nvy4 = gather_f32x4(buffer.velocities_y, n0, n1, n2, n3);
            let speed_sq = f32x4_add(f32x4_mul(nvx4, nvx4), f32x4_mul(nvy4, nvy4));

            let in_align_range = f32x4_lt(dist_sq, align_radius_sq);
            let is_moving = f32x4_gt(speed_sq, min_speed_sq);
            let align_mask = v128_and(v128_and(valid_mask, in_align_range), is_moving);

            // Normalize velocities
            let speed = f32x4_sqrt(f32x4_max(speed_sq, epsilon));
            let inv_speed = f32x4_div(one, speed);
            let norm_vx = f32x4_mul(nvx4, inv_speed);
            let norm_vy = f32x4_mul(nvy4, inv_speed);

            align_vx_acc = f32x4_add(align_vx_acc, apply_mask(norm_vx, align_mask));
            align_vy_acc = f32x4_add(align_vy_acc, apply_mask(norm_vy, align_mask));
            align_count_acc = f32x4_add(align_count_acc, apply_mask(one, align_mask));
        }

        // Horizontal sums to reduce SIMD accumulators to scalars
        let mut sep_x = horizontal_sum(sep_x_acc);
        let mut sep_y = horizontal_sum(sep_y_acc);
        let mut coh_sum_x = horizontal_sum(coh_x_acc);
        let mut coh_sum_y = horizontal_sum(coh_y_acc);
        let mut coh_count = horizontal_sum(coh_count_acc);
        let mut align_sum_vx = horizontal_sum(align_vx_acc);
        let mut align_sum_vy = horizontal_sum(align_vy_acc);
        let mut align_count = horizontal_sum(align_count_acc);

        // Scalar tail: process remaining neighbors (count % 4)
        for i in simd_count..neighbor_count {
            let ni = neighbor_slice[i] as usize;

            if !is_valid_neighbor(buffer, unit_idx, unit_state, unit_layer, ni) {
                continue;
            }

            let nx = *buffer.positions_x.add(ni);
            let ny = *buffer.positions_y.add(ni);
            let nr = *buffer.radii.add(ni);

            let dx = ux - nx;
            let dy = uy - ny;
            let dist_sq = dx * dx + dy * dy;

            // Separation
            let combined_r = ur + nr;
            let sep_dist = combined_r * params.separation_radius;
            let sep_dist_sq = sep_dist * sep_dist;

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

        // Clamp separation force magnitude
        let sep_mag_sq = sep_x * sep_x + sep_y * sep_y;
        if sep_mag_sq > params.max_separation_force * params.max_separation_force {
            let scale = params.max_separation_force / sep_mag_sq.sqrt();
            sep_x *= scale;
            sep_y *= scale;
        }

        // Write separation forces
        *buffer.force_sep_x.add(unit_idx) = sep_x;
        *buffer.force_sep_y.add(unit_idx) = sep_y;

        // Cohesion: direction toward center of mass
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

        // Alignment: direction toward average heading
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

/// Scalar fallback for individual units (used in non-WASM builds)
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
            let sep_dist = combined_r * params.separation_radius;
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
    true
}

#[cfg(not(target_arch = "wasm32"))]
pub fn simd_available() -> bool {
    false
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
            assert!(sep_y.abs() < 0.01, "No Y separation expected");
        }
    }

    #[test]
    fn test_cohesion_force() {
        let mut buffer = BoidsBuffer::new(8);
        let mut neighbors = NeighborList::new(8);

        unsafe {
            // Unit 0 at origin
            *buffer.positions_x.add(0) = 0.0;
            *buffer.positions_y.add(0) = 0.0;
            *buffer.radii.add(0) = 0.5;
            *buffer.states.add(0) = UnitState::Active as u8;
            *buffer.layers.add(0) = 0;

            // Unit 1 at (5, 0) - within cohesion radius (8)
            *buffer.positions_x.add(1) = 5.0;
            *buffer.positions_y.add(1) = 0.0;
            *buffer.radii.add(1) = 0.5;
            *buffer.states.add(1) = UnitState::Active as u8;
            *buffer.layers.add(1) = 0;
        }

        buffer.set_count(2);

        neighbors.begin_unit(0);
        neighbors.add_neighbor(0, 1);
        neighbors.begin_unit(1);
        neighbors.add_neighbor(1, 0);

        let params = BoidsParams::default();
        compute_all_forces_simd(&mut buffer, &neighbors, &params);

        unsafe {
            // Unit 0 should be pulled toward unit 1 (positive x direction)
            let (coh_x, coh_y) = buffer.get_cohesion_force(0);
            assert!(coh_x > 0.0, "Unit 0 should be pulled right toward unit 1");
            assert!(coh_y.abs() < 0.01, "No Y cohesion expected");
        }
    }

    #[test]
    fn test_alignment_force() {
        let mut buffer = BoidsBuffer::new(8);
        let mut neighbors = NeighborList::new(8);

        unsafe {
            // Unit 0 at origin, stationary
            *buffer.positions_x.add(0) = 0.0;
            *buffer.positions_y.add(0) = 0.0;
            *buffer.velocities_x.add(0) = 0.0;
            *buffer.velocities_y.add(0) = 0.0;
            *buffer.radii.add(0) = 0.5;
            *buffer.states.add(0) = UnitState::Active as u8;
            *buffer.layers.add(0) = 0;

            // Unit 1 at (2, 0), moving in +Y direction
            *buffer.positions_x.add(1) = 2.0;
            *buffer.positions_y.add(1) = 0.0;
            *buffer.velocities_x.add(1) = 0.0;
            *buffer.velocities_y.add(1) = 1.0;
            *buffer.radii.add(1) = 0.5;
            *buffer.states.add(1) = UnitState::Active as u8;
            *buffer.layers.add(1) = 0;
        }

        buffer.set_count(2);

        neighbors.begin_unit(0);
        neighbors.add_neighbor(0, 1);
        neighbors.begin_unit(1);
        neighbors.add_neighbor(1, 0);

        let params = BoidsParams::default();
        compute_all_forces_simd(&mut buffer, &neighbors, &params);

        unsafe {
            // Unit 0 should align with unit 1's velocity (positive y direction)
            let (align_x, align_y) = buffer.get_alignment_force(0);
            assert!(align_x.abs() < 0.01, "No X alignment expected");
            assert!(align_y > 0.0, "Unit 0 should align toward +Y");
        }
    }

    #[test]
    fn test_skip_dead_units() {
        let mut buffer = BoidsBuffer::new(4);
        let mut neighbors = NeighborList::new(4);

        unsafe {
            // Unit 0 active
            *buffer.positions_x.add(0) = 0.0;
            *buffer.positions_y.add(0) = 0.0;
            *buffer.radii.add(0) = 0.5;
            *buffer.states.add(0) = UnitState::Active as u8;
            *buffer.layers.add(0) = 0;

            // Unit 1 dead (should be skipped)
            *buffer.positions_x.add(1) = 0.5;
            *buffer.positions_y.add(1) = 0.0;
            *buffer.radii.add(1) = 0.5;
            *buffer.states.add(1) = UnitState::Dead as u8;
            *buffer.layers.add(1) = 0;
        }

        buffer.set_count(2);

        neighbors.begin_unit(0);
        neighbors.add_neighbor(0, 1);

        let params = BoidsParams::default();
        compute_all_forces_simd(&mut buffer, &neighbors, &params);

        unsafe {
            // No forces should be applied since the only neighbor is dead
            let (sep_x, sep_y) = buffer.get_separation_force(0);
            assert_eq!(sep_x, 0.0, "No separation expected with dead neighbor");
            assert_eq!(sep_y, 0.0, "No separation expected with dead neighbor");
        }
    }

    #[test]
    fn test_skip_different_layers() {
        let mut buffer = BoidsBuffer::new(4);
        let mut neighbors = NeighborList::new(4);

        unsafe {
            // Unit 0 on layer 0 (ground)
            *buffer.positions_x.add(0) = 0.0;
            *buffer.positions_y.add(0) = 0.0;
            *buffer.radii.add(0) = 0.5;
            *buffer.states.add(0) = UnitState::Active as u8;
            *buffer.layers.add(0) = 0;

            // Unit 1 on layer 1 (flying) - should be skipped
            *buffer.positions_x.add(1) = 0.5;
            *buffer.positions_y.add(1) = 0.0;
            *buffer.radii.add(1) = 0.5;
            *buffer.states.add(1) = UnitState::Active as u8;
            *buffer.layers.add(1) = 1;
        }

        buffer.set_count(2);

        neighbors.begin_unit(0);
        neighbors.add_neighbor(0, 1);

        let params = BoidsParams::default();
        compute_all_forces_simd(&mut buffer, &neighbors, &params);

        unsafe {
            // No forces should be applied since neighbor is on different layer
            let (sep_x, sep_y) = buffer.get_separation_force(0);
            assert_eq!(sep_x, 0.0, "No separation expected across layers");
            assert_eq!(sep_y, 0.0, "No separation expected across layers");
        }
    }

    #[test]
    fn test_many_neighbors() {
        // Test with more than 4 neighbors to exercise SIMD batching + scalar tail
        let mut buffer = BoidsBuffer::new(8);
        let mut neighbors = NeighborList::new(8);

        unsafe {
            // Unit 0 at origin
            *buffer.positions_x.add(0) = 0.0;
            *buffer.positions_y.add(0) = 0.0;
            *buffer.radii.add(0) = 0.5;
            *buffer.states.add(0) = UnitState::Active as u8;
            *buffer.layers.add(0) = 0;

            // 6 neighbors surrounding unit 0
            for i in 1..7 {
                let angle = (i as f32) * std::f32::consts::PI / 3.0;
                *buffer.positions_x.add(i) = 0.5 * angle.cos();
                *buffer.positions_y.add(i) = 0.5 * angle.sin();
                *buffer.radii.add(i) = 0.5;
                *buffer.states.add(i) = UnitState::Active as u8;
                *buffer.layers.add(i) = 0;
            }
        }

        buffer.set_count(7);

        neighbors.begin_unit(0);
        for i in 1..7 {
            neighbors.add_neighbor(0, i as u32);
        }

        let params = BoidsParams::default();
        compute_all_forces_simd(&mut buffer, &neighbors, &params);

        // With symmetric neighbors, forces should roughly cancel out
        unsafe {
            let (sep_x, sep_y) = buffer.get_separation_force(0);
            // Forces won't be exactly zero due to the arrangement, but should be small
            assert!(
                sep_x.abs() < 1.0 && sep_y.abs() < 1.0,
                "Symmetric neighbors should partially cancel"
            );
        }
    }
}
