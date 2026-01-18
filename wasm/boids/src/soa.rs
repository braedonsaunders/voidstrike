//! Structure of Arrays (SoA) Memory Layout
//!
//! Stores unit data in contiguous arrays for SIMD-friendly access.
//! Each property (x, y, vx, vy, etc.) has its own array, enabling
//! efficient f32x4 operations that process 4 units simultaneously.
//!
//! Memory layout:
//! ```text
//! positions_x:   [x0, x1, x2, x3, x4, x5, x6, x7, ...]
//! positions_y:   [y0, y1, y2, y3, y4, y5, y6, y7, ...]
//! velocities_x:  [vx0, vx1, vx2, vx3, ...]
//! velocities_y:  [vy0, vy1, vy2, vy3, ...]
//! radii:         [r0, r1, r2, r3, ...]
//! ```
//!
//! This layout enables loading 4 x-positions with a single SIMD load,
//! compared to AoS which would require 4 scattered loads.

use std::alloc::{alloc_zeroed, dealloc, Layout};

/// Alignment for SIMD operations (16 bytes = 4 x f32)
const SIMD_ALIGNMENT: usize = 16;

/// Unit state flags for filtering during boids computation
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum UnitState {
    /// Unit should be processed for boids
    Active = 0,
    /// Unit is dead/inactive - skip during computation
    Dead = 1,
    /// Unit is flying - separate collision layer
    Flying = 2,
    /// Unit is gathering - no separation forces
    Gathering = 3,
    /// Unit is a worker - special rules apply
    Worker = 4,
}

/// SoA buffer for unit positions and velocities
///
/// All arrays are SIMD-aligned (16-byte) for optimal vector load performance.
/// Capacity is always rounded up to the nearest multiple of 4 for SIMD tail handling.
pub struct BoidsBuffer {
    /// X positions of all units
    pub positions_x: *mut f32,
    /// Y positions of all units
    pub positions_y: *mut f32,
    /// X velocities of all units
    pub velocities_x: *mut f32,
    /// Y velocities of all units
    pub velocities_y: *mut f32,
    /// Collision radii of all units
    pub radii: *mut f32,
    /// Unit states for filtering
    pub states: *mut u8,
    /// Player IDs (units only interact with same-layer units)
    pub layers: *mut u8,

    // Output force arrays (written by SIMD computation)
    /// Separation force X components
    pub force_sep_x: *mut f32,
    /// Separation force Y components
    pub force_sep_y: *mut f32,
    /// Cohesion force X components
    pub force_coh_x: *mut f32,
    /// Cohesion force Y components
    pub force_coh_y: *mut f32,
    /// Alignment force X components
    pub force_align_x: *mut f32,
    /// Alignment force Y components
    pub force_align_y: *mut f32,

    /// Current number of units in buffer
    count: usize,
    /// Allocated capacity (always multiple of 4)
    capacity: usize,
}

impl BoidsBuffer {
    /// Create a new buffer with the specified capacity.
    ///
    /// Capacity is rounded up to nearest multiple of 4 for SIMD alignment.
    pub fn new(capacity: usize) -> Self {
        // Round up to multiple of 4 for SIMD
        let aligned_capacity = (capacity + 3) & !3;

        unsafe {
            Self {
                positions_x: Self::alloc_aligned(aligned_capacity),
                positions_y: Self::alloc_aligned(aligned_capacity),
                velocities_x: Self::alloc_aligned(aligned_capacity),
                velocities_y: Self::alloc_aligned(aligned_capacity),
                radii: Self::alloc_aligned(aligned_capacity),
                states: Self::alloc_aligned_u8(aligned_capacity),
                layers: Self::alloc_aligned_u8(aligned_capacity),
                force_sep_x: Self::alloc_aligned(aligned_capacity),
                force_sep_y: Self::alloc_aligned(aligned_capacity),
                force_coh_x: Self::alloc_aligned(aligned_capacity),
                force_coh_y: Self::alloc_aligned(aligned_capacity),
                force_align_x: Self::alloc_aligned(aligned_capacity),
                force_align_y: Self::alloc_aligned(aligned_capacity),
                count: 0,
                capacity: aligned_capacity,
            }
        }
    }

    /// Allocate SIMD-aligned f32 array
    unsafe fn alloc_aligned(count: usize) -> *mut f32 {
        let layout = Layout::from_size_align(count * 4, SIMD_ALIGNMENT)
            .expect("Invalid layout for f32 array");
        alloc_zeroed(layout) as *mut f32
    }

    /// Allocate SIMD-aligned u8 array
    unsafe fn alloc_aligned_u8(count: usize) -> *mut u8 {
        let layout = Layout::from_size_align(count, SIMD_ALIGNMENT)
            .expect("Invalid layout for u8 array");
        alloc_zeroed(layout)
    }

    /// Get current unit count
    #[inline]
    pub fn len(&self) -> usize {
        self.count
    }

    /// Check if buffer is empty
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// Get buffer capacity
    #[inline]
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Clear all units from the buffer (resets count, keeps capacity)
    #[inline]
    pub fn clear(&mut self) {
        self.count = 0;
    }

    /// Set the unit count (called after JS populates the buffer)
    ///
    /// # Safety
    /// Caller must ensure `count` does not exceed capacity.
    #[inline]
    pub fn set_count(&mut self, count: usize) {
        debug_assert!(count <= self.capacity, "Count exceeds capacity");
        self.count = count;
    }

    /// Get raw pointer to positions_x for JS interop
    #[inline]
    pub fn positions_x_ptr(&self) -> *mut f32 {
        self.positions_x
    }

    /// Get raw pointer to positions_y for JS interop
    #[inline]
    pub fn positions_y_ptr(&self) -> *mut f32 {
        self.positions_y
    }

    /// Get raw pointer to velocities_x for JS interop
    #[inline]
    pub fn velocities_x_ptr(&self) -> *mut f32 {
        self.velocities_x
    }

    /// Get raw pointer to velocities_y for JS interop
    #[inline]
    pub fn velocities_y_ptr(&self) -> *mut f32 {
        self.velocities_y
    }

    /// Get raw pointer to radii for JS interop
    #[inline]
    pub fn radii_ptr(&self) -> *mut f32 {
        self.radii
    }

    /// Get raw pointer to states for JS interop
    #[inline]
    pub fn states_ptr(&self) -> *mut u8 {
        self.states
    }

    /// Get raw pointer to layers for JS interop
    #[inline]
    pub fn layers_ptr(&self) -> *mut u8 {
        self.layers
    }

    /// Get raw pointer to separation force X for JS interop
    #[inline]
    pub fn force_sep_x_ptr(&self) -> *mut f32 {
        self.force_sep_x
    }

    /// Get raw pointer to separation force Y for JS interop
    #[inline]
    pub fn force_sep_y_ptr(&self) -> *mut f32 {
        self.force_sep_y
    }

    /// Get raw pointer to cohesion force X for JS interop
    #[inline]
    pub fn force_coh_x_ptr(&self) -> *mut f32 {
        self.force_coh_x
    }

    /// Get raw pointer to cohesion force Y for JS interop
    #[inline]
    pub fn force_coh_y_ptr(&self) -> *mut f32 {
        self.force_coh_y
    }

    /// Get raw pointer to alignment force X for JS interop
    #[inline]
    pub fn force_align_x_ptr(&self) -> *mut f32 {
        self.force_align_x
    }

    /// Get raw pointer to alignment force Y for JS interop
    #[inline]
    pub fn force_align_y_ptr(&self) -> *mut f32 {
        self.force_align_y
    }

    /// Zero all output force arrays
    pub fn zero_forces(&mut self) {
        unsafe {
            std::ptr::write_bytes(self.force_sep_x, 0, self.capacity);
            std::ptr::write_bytes(self.force_sep_y, 0, self.capacity);
            std::ptr::write_bytes(self.force_coh_x, 0, self.capacity);
            std::ptr::write_bytes(self.force_coh_y, 0, self.capacity);
            std::ptr::write_bytes(self.force_align_x, 0, self.capacity);
            std::ptr::write_bytes(self.force_align_y, 0, self.capacity);
        }
    }

    /// Read a position at index (for debugging/testing)
    #[inline]
    pub unsafe fn get_position(&self, index: usize) -> (f32, f32) {
        debug_assert!(index < self.count, "Index out of bounds");
        (*self.positions_x.add(index), *self.positions_y.add(index))
    }

    /// Read a velocity at index (for debugging/testing)
    #[inline]
    pub unsafe fn get_velocity(&self, index: usize) -> (f32, f32) {
        debug_assert!(index < self.count, "Index out of bounds");
        (*self.velocities_x.add(index), *self.velocities_y.add(index))
    }

    /// Read separation force at index
    #[inline]
    pub unsafe fn get_separation_force(&self, index: usize) -> (f32, f32) {
        debug_assert!(index < self.count, "Index out of bounds");
        (*self.force_sep_x.add(index), *self.force_sep_y.add(index))
    }

    /// Read cohesion force at index
    #[inline]
    pub unsafe fn get_cohesion_force(&self, index: usize) -> (f32, f32) {
        debug_assert!(index < self.count, "Index out of bounds");
        (*self.force_coh_x.add(index), *self.force_coh_y.add(index))
    }

    /// Read alignment force at index
    #[inline]
    pub unsafe fn get_alignment_force(&self, index: usize) -> (f32, f32) {
        debug_assert!(index < self.count, "Index out of bounds");
        (*self.force_align_x.add(index), *self.force_align_y.add(index))
    }
}

impl Drop for BoidsBuffer {
    fn drop(&mut self) {
        unsafe {
            let f32_layout = Layout::from_size_align(self.capacity * 4, SIMD_ALIGNMENT).unwrap();
            let u8_layout = Layout::from_size_align(self.capacity, SIMD_ALIGNMENT).unwrap();

            dealloc(self.positions_x as *mut u8, f32_layout);
            dealloc(self.positions_y as *mut u8, f32_layout);
            dealloc(self.velocities_x as *mut u8, f32_layout);
            dealloc(self.velocities_y as *mut u8, f32_layout);
            dealloc(self.radii as *mut u8, f32_layout);
            dealloc(self.states, u8_layout);
            dealloc(self.layers, u8_layout);
            dealloc(self.force_sep_x as *mut u8, f32_layout);
            dealloc(self.force_sep_y as *mut u8, f32_layout);
            dealloc(self.force_coh_x as *mut u8, f32_layout);
            dealloc(self.force_coh_y as *mut u8, f32_layout);
            dealloc(self.force_align_x as *mut u8, f32_layout);
            dealloc(self.force_align_y as *mut u8, f32_layout);
        }
    }
}

/// Neighbor list for spatial queries
///
/// Stores indices of nearby units for each unit. This enables batch
/// processing of boids forces without repeated spatial queries.
pub struct NeighborList {
    /// Flat array of neighbor indices
    neighbors: Vec<u32>,
    /// Start index in neighbors array for each unit
    offsets: Vec<u32>,
    /// Number of neighbors for each unit
    counts: Vec<u32>,
    /// Capacity (max units)
    capacity: usize,
}

impl NeighborList {
    /// Create a new neighbor list with capacity for max_units
    pub fn new(max_units: usize) -> Self {
        // Assume average of 8 neighbors per unit
        let neighbor_capacity = max_units * 8;

        Self {
            neighbors: Vec::with_capacity(neighbor_capacity),
            offsets: vec![0; max_units],
            counts: vec![0; max_units],
            capacity: max_units,
        }
    }

    /// Clear the neighbor list for reuse
    pub fn clear(&mut self) {
        self.neighbors.clear();
        // Counts will be overwritten, no need to zero
    }

    /// Begin adding neighbors for a unit at index
    #[inline]
    pub fn begin_unit(&mut self, unit_index: usize) {
        debug_assert!(unit_index < self.capacity, "Unit index out of bounds");
        self.offsets[unit_index] = self.neighbors.len() as u32;
        self.counts[unit_index] = 0;
    }

    /// Add a neighbor to the current unit
    #[inline]
    pub fn add_neighbor(&mut self, unit_index: usize, neighbor_index: u32) {
        self.neighbors.push(neighbor_index);
        self.counts[unit_index] += 1;
    }

    /// Get neighbors for a unit
    #[inline]
    pub fn get_neighbors(&self, unit_index: usize) -> &[u32] {
        let offset = self.offsets[unit_index] as usize;
        let count = self.counts[unit_index] as usize;
        &self.neighbors[offset..offset + count]
    }

    /// Get neighbor count for a unit
    #[inline]
    pub fn neighbor_count(&self, unit_index: usize) -> usize {
        self.counts[unit_index] as usize
    }

    /// Get raw pointer to neighbors array
    #[inline]
    pub fn neighbors_ptr(&self) -> *const u32 {
        self.neighbors.as_ptr()
    }

    /// Get raw pointer to offsets array
    #[inline]
    pub fn offsets_ptr(&self) -> *const u32 {
        self.offsets.as_ptr()
    }

    /// Get raw pointer to counts array
    #[inline]
    pub fn counts_ptr(&self) -> *const u32 {
        self.counts.as_ptr()
    }

    /// Get mutable pointer to neighbors array (for JS to populate)
    #[inline]
    pub fn neighbors_ptr_mut(&mut self) -> *mut u32 {
        // Ensure capacity
        if self.neighbors.capacity() == 0 {
            self.neighbors.reserve(self.capacity * 8);
        }
        self.neighbors.as_mut_ptr()
    }

    /// Get mutable pointer to offsets array (for JS to populate)
    #[inline]
    pub fn offsets_ptr_mut(&mut self) -> *mut u32 {
        self.offsets.as_mut_ptr()
    }

    /// Get mutable pointer to counts array (for JS to populate)
    #[inline]
    pub fn counts_ptr_mut(&mut self) -> *mut u32 {
        self.counts.as_mut_ptr()
    }

    /// Set the number of neighbors (after JS populates the array)
    #[inline]
    pub fn set_neighbor_count(&mut self, count: usize) {
        // SAFETY: JS has written `count` neighbors
        unsafe {
            self.neighbors.set_len(count);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_buffer_creation() {
        let buffer = BoidsBuffer::new(100);
        assert_eq!(buffer.capacity(), 100);
        assert_eq!(buffer.len(), 0);
        assert!(buffer.is_empty());
    }

    #[test]
    fn test_buffer_alignment() {
        let buffer = BoidsBuffer::new(100);
        // Check that pointers are 16-byte aligned
        assert_eq!(buffer.positions_x as usize % 16, 0);
        assert_eq!(buffer.positions_y as usize % 16, 0);
        assert_eq!(buffer.velocities_x as usize % 16, 0);
        assert_eq!(buffer.velocities_y as usize % 16, 0);
    }

    #[test]
    fn test_capacity_rounding() {
        // Capacity should round up to multiple of 4
        let buffer = BoidsBuffer::new(1);
        assert_eq!(buffer.capacity(), 4);

        let buffer = BoidsBuffer::new(5);
        assert_eq!(buffer.capacity(), 8);

        let buffer = BoidsBuffer::new(8);
        assert_eq!(buffer.capacity(), 8);
    }

    #[test]
    fn test_neighbor_list() {
        let mut list = NeighborList::new(10);

        list.begin_unit(0);
        list.add_neighbor(0, 1);
        list.add_neighbor(0, 2);
        list.add_neighbor(0, 3);

        list.begin_unit(1);
        list.add_neighbor(1, 0);
        list.add_neighbor(1, 2);

        assert_eq!(list.neighbor_count(0), 3);
        assert_eq!(list.neighbor_count(1), 2);
        assert_eq!(list.get_neighbors(0), &[1, 2, 3]);
        assert_eq!(list.get_neighbors(1), &[0, 2]);
    }
}
