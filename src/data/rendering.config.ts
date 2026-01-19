/**
 * RenderingConfig - Centralized rendering configuration
 *
 * SINGLE SOURCE OF TRUTH for all rendering parameters.
 * All visual constants (camera, materials, particles, effects) are defined here.
 *
 * IMPORTANT: Changes here affect all rendering subsystems.
 * Test thoroughly after modifying values.
 */

// =============================================================================
// CAMERA CONFIGURATION
// =============================================================================

/**
 * Default camera configuration for RTS gameplay.
 * Camera with zoom-dependent pitch.
 */
export const CAMERA = {
  /** Minimum zoom distance (closest to ground) */
  MIN_ZOOM: 14,
  /** Maximum zoom distance (furthest from ground) */
  MAX_ZOOM: 80,
  /** Initial zoom level - default for good base overview */
  INITIAL_ZOOM: 45,
  /** Camera pan speed (units per second) */
  PAN_SPEED: 80,
  /** Mouse wheel zoom speed multiplier */
  ZOOM_SPEED: 5,
  /** Middle mouse rotation speed */
  ROTATION_SPEED: 2,
  /** Edge scroll pan speed (units per second) */
  EDGE_SCROLL_SPEED: 60,
  /** Pixels from screen edge to trigger scroll */
  EDGE_SCROLL_THRESHOLD: 50,
  /** Boundary padding for map edges */
  BOUNDARY_PADDING: 10,
  /** Perspective camera field of view (degrees) */
  FOV: 60,
  /** Near clipping plane - close for detailed zoom */
  NEAR_PLANE: 0.1,
  /** Far clipping plane */
  FAR_PLANE: 300,
  /** Pitch when zoomed in (nearly horizontal, building sides visible) */
  MIN_PITCH: 0.2,
  /** Pitch when zoomed out (more top-down view) */
  MAX_PITCH: Math.PI / 2.5,
  /** Pitch clamp minimum to prevent looking straight ahead */
  PITCH_CLAMP_MIN: 0.15,
  /** Pitch clamp maximum to prevent looking straight down */
  PITCH_CLAMP_MAX: Math.PI / 2 - 0.1,
  /** Manual pitch offset range (middle mouse drag) */
  MANUAL_PITCH_OFFSET_MIN: -0.5,
  MANUAL_PITCH_OFFSET_MAX: 0.5,
  /** Smooth zoom interpolation factor (higher = faster) */
  ZOOM_LERP_FACTOR: 8,
  /** View half-size factor for pan clamping */
  VIEW_HALF_SIZE_FACTOR: 0.3,
  /** Minimum height above terrain */
  MIN_TERRAIN_CLEARANCE: 2,
  /** Zoom delta multiplier from wheel */
  WHEEL_ZOOM_MULTIPLIER: 0.08,
  /** Screen-to-world raycast convergence threshold */
  RAYCAST_CONVERGENCE_THRESHOLD: 0.01,
  /** Maximum raycast iterations for terrain intersection */
  RAYCAST_MAX_ITERATIONS: 6,
} as const;

// =============================================================================
// UNIT RENDERER CONFIGURATION
// =============================================================================

export const UNIT_RENDERER = {
  /** Maximum instances per unit type/player/LOD combination */
  MAX_INSTANCES_PER_TYPE: 512,
  /** Maximum units for instanced overlay rendering */
  MAX_OVERLAY_INSTANCES: 1024,
  /** Frames before inactive mesh groups are cleaned up (3 seconds at 60fps) */
  INACTIVE_MESH_CLEANUP_FRAMES: 180,
  /** Rotation smooth interpolation factor (0.1=slow, 0.3=fast) */
  ROTATION_SMOOTH_FACTOR: 0.15,
  /** Threshold for recalculating cached terrain height */
  TERRAIN_HEIGHT_CACHE_THRESHOLD: 0.5,
} as const;

export const UNIT_SELECTION_RING = {
  /** Inner radius of selection ring */
  INNER_RADIUS: 0.6,
  /** Outer radius of selection ring */
  OUTER_RADIUS: 0.8,
  /** Number of geometry segments */
  SEGMENTS: 16,
  /** Material opacity */
  OPACITY: 0.6,
  /** Color for owned unit selection */
  OWNED_COLOR: 0x00ff00,
  /** Color for enemy unit selection */
  ENEMY_COLOR: 0xff0000,
} as const;

export const UNIT_TEAM_MARKER = {
  /** Team marker circle radius */
  RADIUS: 0.4,
  /** Number of geometry segments */
  SEGMENTS: 12,
  /** Material opacity */
  OPACITY: 0.7,
} as const;

export const UNIT_HEALTH_BAR = {
  /** Health bar width */
  WIDTH: 1.4,
  /** Health bar height */
  HEIGHT: 0.18,
  /** Background opacity */
  BG_OPACITY: 0.8,
  /** Background color */
  BG_COLOR: 0x333333,
  /** Offset above unit model */
  Y_OFFSET: 0.3,
  /** High health color (>60%) */
  COLOR_HIGH: 0x00ff00,
  /** Medium health color (30-60%) */
  COLOR_MEDIUM: 0xffff00,
  /** Low health color (<30%) */
  COLOR_LOW: 0xff0000,
  /** High health threshold */
  THRESHOLD_HIGH: 0.6,
  /** Low health threshold */
  THRESHOLD_LOW: 0.3,
} as const;

// =============================================================================
// BUILDING RENDERER CONFIGURATION
// =============================================================================

export const BUILDING_RENDERER = {
  /** Maximum instances per building type/player/LOD combination */
  MAX_INSTANCES_PER_TYPE: 50,
  /** Maximum instanced selection rings */
  MAX_SELECTION_RING_INSTANCES: 100,
  /** Fallback elevation heights when terrain unavailable */
  ELEVATION_HEIGHTS: [0, 1.8, 3.5],
} as const;

export const BUILDING_SELECTION_RING = {
  /** Inner radius of building selection ring */
  INNER_RADIUS: 0.8,
  /** Outer radius of building selection ring */
  OUTER_RADIUS: 1.0,
  /** Number of geometry segments */
  SEGMENTS: 32,
  /** Material opacity */
  OPACITY: 0.5,
  /** Color for owned building selection */
  OWNED_COLOR: 0x00ff00,
  /** Color for enemy building selection */
  ENEMY_COLOR: 0xff0000,
} as const;

export const BUILDING_CONSTRUCTION = {
  /** Construction transparency color */
  COLOR: 0x4a90d9,
  /** Roughness of construction material */
  ROUGHNESS: 0.5,
  /** Metalness of construction material */
  METALNESS: 0.5,
  /** Opacity during construction */
  OPACITY: 0.5,
} as const;

export const BUILDING_FIRE = {
  /** Fire color */
  COLOR: 0xff4400,
  /** Fire opacity */
  OPACITY: 0.8,
  /** Fire cone radius */
  CONE_RADIUS: 0.3,
  /** Fire cone height */
  CONE_HEIGHT: 0.8,
  /** Fire cone segments */
  CONE_SEGMENTS: 8,
  /** Smoke color */
  SMOKE_COLOR: 0x333333,
  /** Smoke opacity */
  SMOKE_OPACITY: 0.5,
} as const;

export const BUILDING_PARTICLES = {
  /** Construction dust particle size */
  DUST_SIZE: 8.0,
  /** Construction dust opacity */
  DUST_OPACITY: 0.7,
  /** Construction dust color */
  DUST_COLOR: 0xddcc99,
  /** Construction spark particle size */
  SPARK_SIZE: 5.0,
  /** Construction spark color */
  SPARK_COLOR: 0xffdd55,
  /** Ground dust particle size */
  GROUND_DUST_SIZE: 12.0,
  /** Ground dust opacity */
  GROUND_DUST_OPACITY: 0.6,
  /** Ground dust color */
  GROUND_DUST_COLOR: 0xccbb99,
  /** Metal debris particle size */
  METAL_DEBRIS_SIZE: 3.0,
  /** Metal debris color */
  METAL_DEBRIS_COLOR: 0xeeeeee,
  /** Welding flash particle size */
  WELDING_FLASH_SIZE: 6.0,
  /** Welding flash color */
  WELDING_FLASH_COLOR: 0xffffcc,
  /** Blueprint pulse particle size */
  BLUEPRINT_PULSE_SIZE: 4.0,
  /** Blueprint pulse color */
  BLUEPRINT_PULSE_COLOR: 0x00ddff,
  /** Blueprint line color */
  BLUEPRINT_LINE_COLOR: 0x00aaff,
  /** Blueprint scan color */
  BLUEPRINT_SCAN_COLOR: 0x00ccff,
  /** Thruster core particle size */
  THRUSTER_CORE_SIZE: 0.4,
  /** Thruster core color */
  THRUSTER_CORE_COLOR: 0x88ccff,
  /** Thruster glow particle size */
  THRUSTER_GLOW_SIZE: 0.6,
  /** Thruster glow color */
  THRUSTER_GLOW_COLOR: 0x4488ff,
} as const;

export const BUILDING_SCAFFOLD = {
  /** Scaffold pole radius */
  POLE_RADIUS: 0.08,
  /** Scaffold beam radius */
  BEAM_RADIUS: 0.05,
  /** Scaffold diagonal radius */
  DIAGONAL_RADIUS: 0.035,
  /** Scaffold pole color */
  POLE_COLOR: 0xdd8833,
  /** Scaffold beam color */
  BEAM_COLOR: 0xaa6622,
  /** Scaffold wireframe color */
  WIREFRAME_COLOR: 0xffaa44,
  /** Scaffold wireframe opacity */
  WIREFRAME_OPACITY: 0.8,
  /** Cylinder segments */
  SEGMENTS: 6,
} as const;

// =============================================================================
// TERRAIN CONFIGURATION
// =============================================================================

export const TERRAIN = {
  /** Subdivisions per cell for smoother rendering */
  SUBDIVISIONS: 2,
  /** Chunk size for frustum culling (cells per chunk) */
  CHUNK_SIZE: 32,
  /** Minimum slope for ramps */
  MIN_RAMP_SLOPE: 0,
  /** Minimum slope for cliffs */
  MIN_CLIFF_SLOPE: 0.15,
  /** Slope for cliff edges */
  CLIFF_EDGE_SLOPE: 0.35,
} as const;

// =============================================================================
// DECORATION CONFIGURATION
// =============================================================================

export const DECORATIONS = {
  /** Distance culling multiplier (camera height * multiplier = max distance) */
  DISTANCE_CULL_MULTIPLIER: 1.2,
  /** Minimum culling distance regardless of camera height */
  MIN_CULL_DISTANCE: 40,
  /** Cells to clear around ramp centers */
  RAMP_CLEARANCE_RADIUS: 10,
  /** Extended clearance in ramp entry/exit direction */
  RAMP_EXIT_EXTENSION: 18,
  /** Cells from map edge considered border zone */
  BORDER_MARGIN: 15,
  /** Base tree scale minimum */
  TREE_SCALE_MIN: 0.8,
  /** Tree scale variation */
  TREE_SCALE_VARIATION: 0.5,
  /** Tree collision radius multiplier */
  TREE_COLLISION_RADIUS: 0.8,
} as const;

// =============================================================================
// BATTLE EFFECTS CONFIGURATION
// =============================================================================

export const BATTLE_EFFECTS = {
  /** Ground effect height offset above terrain */
  GROUND_EFFECT_OFFSET: 0.15,
  /** Object pool size for effects */
  POOL_SIZE: 150,
  /** Vector3 pool size for calculations */
  VECTOR3_POOL_SIZE: 300,
  /** Maximum spark particles */
  MAX_SPARKS: 2000,
} as const;

/** Render order hierarchy for proper depth sorting */
export const RENDER_ORDER = {
  /** Terrain base */
  TERRAIN: 0,
  /** Team markers below selection rings */
  TEAM_MARKER: 4,
  /** Selection rings and ground effects */
  GROUND_EFFECT: 5,
  /** Ground decals (scorch marks, impacts) */
  GROUND_DECAL: 15,
  /** Ground hit effects */
  HIT_EFFECT: 25,
  /** Explosions */
  EXPLOSION: 35,
  /** Units and buildings */
  UNIT: 50,
  /** Projectiles and trails */
  PROJECTILE: 65,
  /** Air unit effects */
  AIR_EFFECT: 75,
  /** Additive glow effects */
  GLOW: 90,
  /** UI elements and damage numbers */
  UI: 100,
} as const;

/** Faction-specific projectile colors */
export const FACTION_COLORS = {
  terran: {
    primary: 0xffaa00,    // Orange-yellow tracer
    secondary: 0xff6600,  // Orange trail
    glow: 0xffdd44,       // Bright yellow glow
  },
  dominion: {
    primary: 0xffaa00,    // Orange-yellow tracer (same as terran for now)
    secondary: 0xff6600,  // Orange trail
    glow: 0xffdd44,       // Bright yellow glow
  },
  protoss: {
    primary: 0x4488ff,    // Blue energy
    secondary: 0x8844ff,  // Purple trail
    glow: 0x66aaff,       // Cyan glow
  },
  zerg: {
    primary: 0x88ff44,    // Acid green
    secondary: 0x44aa00,  // Dark green trail
    glow: 0xaaff66,       // Bright green glow
  },
  neutral: {
    primary: 0xffaa00,
    secondary: 0xff6600,
    glow: 0xffdd44,
  },
} as const;

export const BATTLE_GEOMETRIES = {
  /** Projectile head sphere radius */
  PROJECTILE_HEAD_RADIUS: 0.2,
  /** Projectile head sphere segments */
  PROJECTILE_HEAD_SEGMENTS: 12,
  /** Ground ring inner radius */
  GROUND_RING_INNER: 0.2,
  /** Ground ring outer radius */
  GROUND_RING_OUTER: 0.6,
  /** Ground ring segments */
  GROUND_RING_SEGMENTS: 24,
  /** Large ring inner radius */
  LARGE_RING_INNER: 0.5,
  /** Large ring outer radius */
  LARGE_RING_OUTER: 1.2,
  /** Shockwave inner radius */
  SHOCKWAVE_INNER: 0.3,
  /** Shockwave outer radius */
  SHOCKWAVE_OUTER: 3.0,
  /** Shockwave segments */
  SHOCKWAVE_SEGMENTS: 32,
  /** Decal plane size */
  DECAL_SIZE: 2,
  /** Debris box size */
  DEBRIS_SIZE: 0.15,
  /** Explosion core sphere radius */
  EXPLOSION_CORE_RADIUS: 0.8,
  /** Explosion core sphere segments */
  EXPLOSION_CORE_SEGMENTS: 16,
  /** Move ring inner radius */
  MOVE_RING_INNER: 0.3,
  /** Move ring outer radius */
  MOVE_RING_OUTER: 0.6,
  /** Move ring segments */
  MOVE_RING_SEGMENTS: 16,
} as const;

export const BATTLE_MATERIALS = {
  /** Trail opacity */
  TRAIL_OPACITY: 0.6,
  /** Ground effect opacity */
  GROUND_EFFECT_OPACITY: 0.9,
  /** Ground effect color */
  GROUND_EFFECT_COLOR: 0xffcc00,
  /** Death effect color */
  DEATH_EFFECT_COLOR: 0xff4400,
  /** Shockwave opacity */
  SHOCKWAVE_OPACITY: 0.8,
  /** Shockwave color */
  SHOCKWAVE_COLOR: 0xff6600,
  /** Decal opacity */
  DECAL_OPACITY: 0.7,
  /** Debris color */
  DEBRIS_COLOR: 0x664422,
  /** Explosion core color */
  EXPLOSION_CORE_COLOR: 0xffffaa,
  /** Focus fire indicator color */
  FOCUS_FIRE_COLOR: 0xff2200,
  /** Focus fire opacity */
  FOCUS_FIRE_OPACITY: 0.7,
  /** Move indicator color */
  MOVE_INDICATOR_COLOR: 0x00ff88,
  /** Move indicator opacity */
  MOVE_INDICATOR_OPACITY: 0.9,
  /** Polygon offset factor for ground effects */
  POLYGON_OFFSET_FACTOR: -4,
  /** Polygon offset units for ground effects */
  POLYGON_OFFSET_UNITS: -4,
} as const;

// =============================================================================
// ENVIRONMENT CONFIGURATION
// =============================================================================

export const SHADOW_QUALITY_PRESETS = {
  low: { mapSize: 256, radius: 1, bias: -0.001 },
  medium: { mapSize: 512, radius: 2, bias: -0.0005 },
  high: { mapSize: 1024, radius: 3, bias: -0.0003 },
  ultra: { mapSize: 2048, radius: 4, bias: -0.0002 },
} as const;

export type ShadowQuality = keyof typeof SHADOW_QUALITY_PRESETS;

export const ENVIRONMENT = {
  /** Ambient light intensity */
  AMBIENT_INTENSITY: 0.8,
  /** Key light (sun) intensity */
  KEY_LIGHT_INTENSITY: 1.8,
  /** Key light position */
  KEY_LIGHT_POSITION: { x: 50, y: 80, z: 50 },
  /** Fill light intensity */
  FILL_LIGHT_INTENSITY: 0.7,
  /** Fill light color */
  FILL_LIGHT_COLOR: 0x8090b0,
  /** Fill light position */
  FILL_LIGHT_POSITION: { x: -40, y: 50, z: -40 },
  /** Back/rim light intensity */
  BACK_LIGHT_INTENSITY: 0.4,
  /** Back light position */
  BACK_LIGHT_POSITION: { x: -20, y: 30, z: 60 },
  /** Hemisphere light intensity */
  HEMI_LIGHT_INTENSITY: 0.5,
  /** Shadow camera near plane */
  SHADOW_CAMERA_NEAR: 1,
  /** Shadow camera far plane */
  SHADOW_CAMERA_FAR: 200,
  /** Shadow camera frustum size */
  SHADOW_CAMERA_SIZE: 100,
  /** Shadow update interval during active gameplay */
  SHADOW_UPDATE_INTERVAL_ACTIVE: 6,
  /** Shadow update interval for static scenes */
  SHADOW_UPDATE_INTERVAL_STATIC: 30,
  /** Threshold for shadow camera position update (units) */
  SHADOW_CAMERA_UPDATE_THRESHOLD: 5,
} as const;

/** Biome-specific fog configuration */
export const FOG_PRESETS = {
  grassland: { near: 60, far: 180 },
  jungle: { near: 30, far: 120 },
  volcanic: { near: 25, far: 100 },
  void: { near: 20, far: 90 },
  frozen: { near: 50, far: 160 },
  desert: { near: 80, far: 250 },
} as const;

// =============================================================================
// GPU RENDERING CONFIGURATION
// =============================================================================

export const GPU_RENDERING = {
  /** Maximum units in GPU buffer */
  MAX_UNITS: 4096,
  /** Maximum unit types supported */
  MAX_UNIT_TYPES: 64,
  /** Maximum LOD levels */
  MAX_LOD_LEVELS: 3,
  /** Maximum players supported */
  MAX_PLAYERS: 8,
  /** Default bounding radius for units */
  DEFAULT_BOUNDING_RADIUS: 1.0,
} as const;

// =============================================================================
// POST-PROCESSING CONFIGURATION
// =============================================================================

export const POST_PROCESSING = {
  /** Default bloom intensity */
  BLOOM_INTENSITY: 0.3,
  /** Default bloom threshold */
  BLOOM_THRESHOLD: 0.8,
  /** Default bloom radius */
  BLOOM_RADIUS: 0.5,
  /** Default TRAA (temporal anti-aliasing) enabled */
  TRAA_ENABLED: true,
  /** Default AO (ambient occlusion) enabled */
  AO_ENABLED: true,
  /** Default AO radius */
  AO_RADIUS: 0.5,
  /** Default AO intensity */
  AO_INTENSITY: 1.0,
} as const;

// =============================================================================
// CONFIG OBJECTS (for libraries that need object format)
// =============================================================================

/**
 * Default camera configuration object.
 * Use this when creating RTSCamera with default settings.
 */
export const DEFAULT_CAMERA_CONFIG = {
  minZoom: CAMERA.MIN_ZOOM,
  maxZoom: CAMERA.MAX_ZOOM,
  panSpeed: CAMERA.PAN_SPEED,
  zoomSpeed: CAMERA.ZOOM_SPEED,
  rotationSpeed: CAMERA.ROTATION_SPEED,
  edgeScrollSpeed: CAMERA.EDGE_SCROLL_SPEED,
  edgeScrollThreshold: CAMERA.EDGE_SCROLL_THRESHOLD,
  boundaryPadding: CAMERA.BOUNDARY_PADDING,
} as const;
