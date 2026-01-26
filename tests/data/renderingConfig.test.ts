import { describe, it, expect } from 'vitest';
import {
  CAMERA,
  UNIT_RENDERER,
  UNIT_SELECTION_RING,
  UNIT_TEAM_MARKER,
  UNIT_HEALTH_BAR,
  BUILDING_RENDERER,
  BUILDING_SELECTION_RING,
  BUILDING_CONSTRUCTION,
  BUILDING_FIRE,
  BUILDING_PARTICLES,
  BUILDING_SCAFFOLD,
  TERRAIN,
  DECORATIONS,
  BATTLE_EFFECTS,
  RENDER_ORDER,
  FACTION_COLORS,
  BATTLE_GEOMETRIES,
  BATTLE_MATERIALS,
  SHADOW_QUALITY_PRESETS,
  ENVIRONMENT,
  FOG_PRESETS,
  GPU_RENDERING,
  POST_PROCESSING,
  DEFAULT_CAMERA_CONFIG,
} from '@/data/rendering.config';

describe('Rendering Configuration', () => {
  describe('CAMERA', () => {
    it('defines zoom limits', () => {
      expect(CAMERA.MIN_ZOOM).toBeGreaterThan(0);
      expect(CAMERA.MAX_ZOOM).toBeGreaterThan(CAMERA.MIN_ZOOM);
      expect(CAMERA.INITIAL_ZOOM).toBeGreaterThanOrEqual(CAMERA.MIN_ZOOM);
      expect(CAMERA.INITIAL_ZOOM).toBeLessThanOrEqual(CAMERA.MAX_ZOOM);
    });

    it('defines movement speeds', () => {
      expect(CAMERA.PAN_SPEED).toBeGreaterThan(0);
      expect(CAMERA.ZOOM_SPEED).toBeGreaterThan(0);
      expect(CAMERA.ROTATION_SPEED).toBeGreaterThan(0);
      expect(CAMERA.EDGE_SCROLL_SPEED).toBeGreaterThan(0);
    });

    it('defines edge scroll settings', () => {
      expect(CAMERA.EDGE_SCROLL_THRESHOLD).toBeGreaterThan(0);
      expect(CAMERA.BOUNDARY_PADDING).toBeGreaterThanOrEqual(0);
    });

    it('defines perspective settings', () => {
      expect(CAMERA.FOV).toBeGreaterThan(0);
      expect(CAMERA.FOV).toBeLessThanOrEqual(180);
      expect(CAMERA.NEAR_PLANE).toBeGreaterThan(0);
      expect(CAMERA.FAR_PLANE).toBeGreaterThan(CAMERA.NEAR_PLANE);
    });

    it('defines pitch limits', () => {
      expect(CAMERA.MIN_PITCH).toBeGreaterThan(0);
      expect(CAMERA.MAX_PITCH).toBeGreaterThan(CAMERA.MIN_PITCH);
      expect(CAMERA.PITCH_CLAMP_MIN).toBeGreaterThan(0);
      expect(CAMERA.PITCH_CLAMP_MAX).toBeGreaterThan(CAMERA.PITCH_CLAMP_MIN);
    });

    it('defines manual pitch offset range', () => {
      expect(CAMERA.MANUAL_PITCH_OFFSET_MIN).toBeLessThan(0);
      expect(CAMERA.MANUAL_PITCH_OFFSET_MAX).toBeGreaterThan(0);
    });

    it('defines raycast settings', () => {
      expect(CAMERA.RAYCAST_CONVERGENCE_THRESHOLD).toBeGreaterThan(0);
      expect(CAMERA.RAYCAST_MAX_ITERATIONS).toBeGreaterThan(0);
    });
  });

  describe('UNIT_RENDERER', () => {
    it('defines instance limits', () => {
      expect(UNIT_RENDERER.MAX_INSTANCES_PER_TYPE).toBeGreaterThan(0);
      expect(UNIT_RENDERER.MAX_OVERLAY_INSTANCES).toBeGreaterThan(0);
    });

    it('defines cleanup timing', () => {
      expect(UNIT_RENDERER.INACTIVE_MESH_CLEANUP_FRAMES).toBeGreaterThan(0);
    });

    it('defines rotation smoothing', () => {
      expect(UNIT_RENDERER.ROTATION_SMOOTH_FACTOR).toBeGreaterThan(0);
      expect(UNIT_RENDERER.ROTATION_SMOOTH_FACTOR).toBeLessThan(1);
    });
  });

  describe('UNIT_SELECTION_RING', () => {
    it('defines ring geometry', () => {
      expect(UNIT_SELECTION_RING.INNER_RADIUS).toBeGreaterThan(0);
      expect(UNIT_SELECTION_RING.OUTER_RADIUS).toBeGreaterThan(UNIT_SELECTION_RING.INNER_RADIUS);
      expect(UNIT_SELECTION_RING.SEGMENTS).toBeGreaterThan(3);
    });

    it('defines colors', () => {
      expect(typeof UNIT_SELECTION_RING.OWNED_COLOR).toBe('number');
      expect(typeof UNIT_SELECTION_RING.ENEMY_COLOR).toBe('number');
    });

    it('defines animation parameters', () => {
      expect(UNIT_SELECTION_RING.PULSE_SPEED).toBeGreaterThan(0);
      expect(UNIT_SELECTION_RING.PULSE_INTENSITY).toBeGreaterThan(0);
      expect(UNIT_SELECTION_RING.SHIMMER_SPEED).toBeGreaterThan(0);
      expect(UNIT_SELECTION_RING.SHIMMER_BANDS).toBeGreaterThan(0);
    });
  });

  describe('UNIT_TEAM_MARKER', () => {
    it('defines marker geometry', () => {
      expect(UNIT_TEAM_MARKER.RADIUS).toBeGreaterThan(0);
      expect(UNIT_TEAM_MARKER.SEGMENTS).toBeGreaterThan(3);
      expect(UNIT_TEAM_MARKER.OPACITY).toBeGreaterThan(0);
      expect(UNIT_TEAM_MARKER.OPACITY).toBeLessThanOrEqual(1);
    });
  });

  describe('UNIT_HEALTH_BAR', () => {
    it('defines bar dimensions', () => {
      expect(UNIT_HEALTH_BAR.WIDTH).toBeGreaterThan(0);
      expect(UNIT_HEALTH_BAR.HEIGHT).toBeGreaterThan(0);
      expect(UNIT_HEALTH_BAR.Y_OFFSET).toBeGreaterThan(0);
    });

    it('defines health colors', () => {
      expect(typeof UNIT_HEALTH_BAR.COLOR_HIGH).toBe('number');
      expect(typeof UNIT_HEALTH_BAR.COLOR_MEDIUM).toBe('number');
      expect(typeof UNIT_HEALTH_BAR.COLOR_LOW).toBe('number');
    });

    it('defines health thresholds', () => {
      expect(UNIT_HEALTH_BAR.THRESHOLD_LOW).toBeGreaterThan(0);
      expect(UNIT_HEALTH_BAR.THRESHOLD_HIGH).toBeGreaterThan(UNIT_HEALTH_BAR.THRESHOLD_LOW);
      expect(UNIT_HEALTH_BAR.THRESHOLD_HIGH).toBeLessThan(1);
    });
  });

  describe('BUILDING_RENDERER', () => {
    it('defines instance limits', () => {
      expect(BUILDING_RENDERER.MAX_INSTANCES_PER_TYPE).toBeGreaterThan(0);
      expect(BUILDING_RENDERER.MAX_SELECTION_RING_INSTANCES).toBeGreaterThan(0);
    });

    it('defines elevation heights fallback', () => {
      expect(Array.isArray(BUILDING_RENDERER.ELEVATION_HEIGHTS)).toBe(true);
      expect(BUILDING_RENDERER.ELEVATION_HEIGHTS.length).toBeGreaterThan(0);
    });
  });

  describe('BUILDING_SELECTION_RING', () => {
    it('defines ring geometry', () => {
      expect(BUILDING_SELECTION_RING.INNER_RADIUS).toBeGreaterThan(0);
      expect(BUILDING_SELECTION_RING.OUTER_RADIUS).toBeGreaterThan(BUILDING_SELECTION_RING.INNER_RADIUS);
      expect(BUILDING_SELECTION_RING.SEGMENTS).toBeGreaterThan(3);
    });

    it('uses same colors as unit selection', () => {
      expect(BUILDING_SELECTION_RING.OWNED_COLOR).toBe(UNIT_SELECTION_RING.OWNED_COLOR);
      expect(BUILDING_SELECTION_RING.ENEMY_COLOR).toBe(UNIT_SELECTION_RING.ENEMY_COLOR);
    });
  });

  describe('BUILDING_CONSTRUCTION', () => {
    it('defines construction material properties', () => {
      expect(typeof BUILDING_CONSTRUCTION.COLOR).toBe('number');
      expect(BUILDING_CONSTRUCTION.ROUGHNESS).toBeGreaterThanOrEqual(0);
      expect(BUILDING_CONSTRUCTION.METALNESS).toBeGreaterThanOrEqual(0);
      expect(BUILDING_CONSTRUCTION.OPACITY).toBeGreaterThan(0);
      expect(BUILDING_CONSTRUCTION.OPACITY).toBeLessThanOrEqual(1);
    });
  });

  describe('BUILDING_FIRE', () => {
    it('defines fire visual properties', () => {
      expect(typeof BUILDING_FIRE.COLOR).toBe('number');
      expect(BUILDING_FIRE.OPACITY).toBeGreaterThan(0);
      expect(BUILDING_FIRE.CONE_RADIUS).toBeGreaterThan(0);
      expect(BUILDING_FIRE.CONE_HEIGHT).toBeGreaterThan(0);
      expect(BUILDING_FIRE.CONE_SEGMENTS).toBeGreaterThan(3);
    });

    it('defines smoke properties', () => {
      expect(typeof BUILDING_FIRE.SMOKE_COLOR).toBe('number');
      expect(BUILDING_FIRE.SMOKE_OPACITY).toBeGreaterThan(0);
    });
  });

  describe('BUILDING_PARTICLES', () => {
    it('defines dust particles', () => {
      expect(BUILDING_PARTICLES.DUST_SIZE).toBeGreaterThan(0);
      expect(BUILDING_PARTICLES.DUST_OPACITY).toBeGreaterThan(0);
      expect(typeof BUILDING_PARTICLES.DUST_COLOR).toBe('number');
    });

    it('defines spark particles', () => {
      expect(BUILDING_PARTICLES.SPARK_SIZE).toBeGreaterThan(0);
      expect(typeof BUILDING_PARTICLES.SPARK_COLOR).toBe('number');
    });

    it('defines thruster particles', () => {
      expect(BUILDING_PARTICLES.THRUSTER_CORE_SIZE).toBeGreaterThan(0);
      expect(BUILDING_PARTICLES.THRUSTER_GLOW_SIZE).toBeGreaterThan(BUILDING_PARTICLES.THRUSTER_CORE_SIZE);
    });
  });

  describe('BUILDING_SCAFFOLD', () => {
    it('defines scaffold geometry', () => {
      expect(BUILDING_SCAFFOLD.POLE_RADIUS).toBeGreaterThan(0);
      expect(BUILDING_SCAFFOLD.BEAM_RADIUS).toBeGreaterThan(0);
      expect(BUILDING_SCAFFOLD.DIAGONAL_RADIUS).toBeGreaterThan(0);
      expect(BUILDING_SCAFFOLD.SEGMENTS).toBeGreaterThan(3);
    });

    it('defines scaffold colors', () => {
      expect(typeof BUILDING_SCAFFOLD.POLE_COLOR).toBe('number');
      expect(typeof BUILDING_SCAFFOLD.BEAM_COLOR).toBe('number');
      expect(typeof BUILDING_SCAFFOLD.WIREFRAME_COLOR).toBe('number');
    });
  });

  describe('TERRAIN', () => {
    it('defines terrain rendering settings', () => {
      expect(TERRAIN.SUBDIVISIONS).toBeGreaterThan(0);
      expect(TERRAIN.CHUNK_SIZE).toBeGreaterThan(0);
    });

    it('defines slope thresholds', () => {
      expect(TERRAIN.MIN_RAMP_SLOPE).toBeGreaterThanOrEqual(0);
      expect(TERRAIN.MIN_CLIFF_SLOPE).toBeGreaterThan(TERRAIN.MIN_RAMP_SLOPE);
      expect(TERRAIN.CLIFF_EDGE_SLOPE).toBeGreaterThan(TERRAIN.MIN_CLIFF_SLOPE);
    });
  });

  describe('DECORATIONS', () => {
    it('defines culling settings', () => {
      expect(DECORATIONS.DISTANCE_CULL_MULTIPLIER).toBeGreaterThan(0);
      expect(DECORATIONS.MIN_CULL_DISTANCE).toBeGreaterThan(0);
    });

    it('defines ramp clearance', () => {
      expect(DECORATIONS.RAMP_CLEARANCE_RADIUS).toBeGreaterThan(0);
      expect(DECORATIONS.RAMP_EXIT_EXTENSION).toBeGreaterThan(0);
    });

    it('defines tree settings', () => {
      expect(DECORATIONS.TREE_SCALE_MIN).toBeGreaterThan(0);
      expect(DECORATIONS.TREE_SCALE_VARIATION).toBeGreaterThan(0);
      expect(DECORATIONS.TREE_COLLISION_RADIUS).toBeGreaterThan(0);
    });
  });

  describe('BATTLE_EFFECTS', () => {
    it('defines effect settings', () => {
      expect(BATTLE_EFFECTS.GROUND_EFFECT_OFFSET).toBeGreaterThan(0);
      expect(BATTLE_EFFECTS.POOL_SIZE).toBeGreaterThan(0);
      expect(BATTLE_EFFECTS.VECTOR3_POOL_SIZE).toBeGreaterThan(0);
      expect(BATTLE_EFFECTS.MAX_SPARKS).toBeGreaterThan(0);
    });
  });

  describe('RENDER_ORDER', () => {
    it('defines render order hierarchy', () => {
      expect(RENDER_ORDER.TERRAIN).toBeLessThan(RENDER_ORDER.GROUND_EFFECT);
      expect(RENDER_ORDER.GROUND_EFFECT).toBeLessThan(RENDER_ORDER.GROUND_DECAL);
      expect(RENDER_ORDER.GROUND_DECAL).toBeLessThan(RENDER_ORDER.UNIT);
      expect(RENDER_ORDER.UNIT).toBeLessThan(RENDER_ORDER.PROJECTILE);
      expect(RENDER_ORDER.PROJECTILE).toBeLessThan(RENDER_ORDER.UI);
    });

    it('team markers below selection rings', () => {
      expect(RENDER_ORDER.TEAM_MARKER).toBeLessThan(RENDER_ORDER.GROUND_EFFECT);
    });
  });

  describe('FACTION_COLORS', () => {
    it('defines colors for factions', () => {
      const factions = Object.keys(FACTION_COLORS);
      expect(factions.length).toBeGreaterThan(0);
    });

    it('each faction has primary, secondary, glow colors', () => {
      for (const [faction, colors] of Object.entries(FACTION_COLORS)) {
        expect(typeof colors.primary).toBe('number');
        expect(typeof colors.secondary).toBe('number');
        expect(typeof colors.glow).toBe('number');
      }
    });

    it('includes neutral faction', () => {
      expect(FACTION_COLORS.neutral).toBeDefined();
    });
  });

  describe('BATTLE_GEOMETRIES', () => {
    it('defines projectile geometry', () => {
      expect(BATTLE_GEOMETRIES.PROJECTILE_HEAD_RADIUS).toBeGreaterThan(0);
      expect(BATTLE_GEOMETRIES.PROJECTILE_HEAD_SEGMENTS).toBeGreaterThan(3);
    });

    it('defines ring geometries', () => {
      expect(BATTLE_GEOMETRIES.GROUND_RING_INNER).toBeLessThan(BATTLE_GEOMETRIES.GROUND_RING_OUTER);
      expect(BATTLE_GEOMETRIES.LARGE_RING_INNER).toBeLessThan(BATTLE_GEOMETRIES.LARGE_RING_OUTER);
    });

    it('defines shockwave geometry', () => {
      expect(BATTLE_GEOMETRIES.SHOCKWAVE_INNER).toBeLessThan(BATTLE_GEOMETRIES.SHOCKWAVE_OUTER);
      expect(BATTLE_GEOMETRIES.SHOCKWAVE_SEGMENTS).toBeGreaterThan(3);
    });

    it('defines explosion geometry', () => {
      expect(BATTLE_GEOMETRIES.EXPLOSION_CORE_RADIUS).toBeGreaterThan(0);
      expect(BATTLE_GEOMETRIES.EXPLOSION_CORE_SEGMENTS).toBeGreaterThan(3);
    });
  });

  describe('BATTLE_MATERIALS', () => {
    it('defines opacity values in valid range', () => {
      expect(BATTLE_MATERIALS.TRAIL_OPACITY).toBeGreaterThan(0);
      expect(BATTLE_MATERIALS.TRAIL_OPACITY).toBeLessThanOrEqual(1);
      expect(BATTLE_MATERIALS.GROUND_EFFECT_OPACITY).toBeGreaterThan(0);
      expect(BATTLE_MATERIALS.SHOCKWAVE_OPACITY).toBeGreaterThan(0);
      expect(BATTLE_MATERIALS.DECAL_OPACITY).toBeGreaterThan(0);
    });

    it('defines colors', () => {
      expect(typeof BATTLE_MATERIALS.GROUND_EFFECT_COLOR).toBe('number');
      expect(typeof BATTLE_MATERIALS.DEATH_EFFECT_COLOR).toBe('number');
      expect(typeof BATTLE_MATERIALS.SHOCKWAVE_COLOR).toBe('number');
    });

    it('defines polygon offset for ground effects', () => {
      expect(typeof BATTLE_MATERIALS.POLYGON_OFFSET_FACTOR).toBe('number');
      expect(typeof BATTLE_MATERIALS.POLYGON_OFFSET_UNITS).toBe('number');
    });
  });

  describe('SHADOW_QUALITY_PRESETS', () => {
    it('defines quality presets', () => {
      expect(SHADOW_QUALITY_PRESETS.low).toBeDefined();
      expect(SHADOW_QUALITY_PRESETS.medium).toBeDefined();
      expect(SHADOW_QUALITY_PRESETS.high).toBeDefined();
      expect(SHADOW_QUALITY_PRESETS.ultra).toBeDefined();
    });

    it('each preset has required properties', () => {
      for (const [quality, preset] of Object.entries(SHADOW_QUALITY_PRESETS)) {
        expect(preset.mapSize).toBeGreaterThan(0);
        expect(preset.radius).toBeGreaterThan(0);
        expect(typeof preset.bias).toBe('number');
      }
    });

    it('higher quality has larger map size', () => {
      expect(SHADOW_QUALITY_PRESETS.ultra.mapSize)
        .toBeGreaterThan(SHADOW_QUALITY_PRESETS.low.mapSize);
    });
  });

  describe('ENVIRONMENT', () => {
    it('defines light intensities', () => {
      expect(ENVIRONMENT.AMBIENT_INTENSITY).toBeGreaterThan(0);
      expect(ENVIRONMENT.KEY_LIGHT_INTENSITY).toBeGreaterThan(0);
      expect(ENVIRONMENT.FILL_LIGHT_INTENSITY).toBeGreaterThan(0);
      expect(ENVIRONMENT.BACK_LIGHT_INTENSITY).toBeGreaterThan(0);
      expect(ENVIRONMENT.HEMI_LIGHT_INTENSITY).toBeGreaterThan(0);
    });

    it('defines light positions', () => {
      expect(ENVIRONMENT.KEY_LIGHT_POSITION).toBeDefined();
      expect(ENVIRONMENT.FILL_LIGHT_POSITION).toBeDefined();
      expect(ENVIRONMENT.BACK_LIGHT_POSITION).toBeDefined();
    });

    it('defines shadow camera settings', () => {
      expect(ENVIRONMENT.SHADOW_CAMERA_NEAR).toBeGreaterThan(0);
      expect(ENVIRONMENT.SHADOW_CAMERA_FAR).toBeGreaterThan(ENVIRONMENT.SHADOW_CAMERA_NEAR);
      expect(ENVIRONMENT.SHADOW_CAMERA_SIZE).toBeGreaterThan(0);
    });

    it('defines shadow update intervals', () => {
      expect(ENVIRONMENT.SHADOW_UPDATE_INTERVAL_ACTIVE).toBeGreaterThan(0);
      expect(ENVIRONMENT.SHADOW_UPDATE_INTERVAL_STATIC)
        .toBeGreaterThan(ENVIRONMENT.SHADOW_UPDATE_INTERVAL_ACTIVE);
    });
  });

  describe('FOG_PRESETS', () => {
    it('defines biome fog settings', () => {
      expect(Object.keys(FOG_PRESETS).length).toBeGreaterThan(0);
    });

    it('each preset has near and far values', () => {
      for (const [biome, fog] of Object.entries(FOG_PRESETS)) {
        expect(fog.near).toBeGreaterThan(0);
        expect(fog.far).toBeGreaterThan(fog.near);
      }
    });
  });

  describe('GPU_RENDERING', () => {
    it('defines buffer limits', () => {
      expect(GPU_RENDERING.MAX_UNITS).toBeGreaterThan(0);
      expect(GPU_RENDERING.MAX_UNIT_TYPES).toBeGreaterThan(0);
      expect(GPU_RENDERING.MAX_LOD_LEVELS).toBeGreaterThan(0);
      expect(GPU_RENDERING.MAX_PLAYERS).toBeGreaterThan(0);
    });

    it('defines default bounding radius', () => {
      expect(GPU_RENDERING.DEFAULT_BOUNDING_RADIUS).toBeGreaterThan(0);
    });
  });

  describe('POST_PROCESSING', () => {
    it('defines bloom settings', () => {
      expect(POST_PROCESSING.BLOOM_INTENSITY).toBeGreaterThanOrEqual(0);
      expect(POST_PROCESSING.BLOOM_THRESHOLD).toBeGreaterThan(0);
      expect(POST_PROCESSING.BLOOM_RADIUS).toBeGreaterThan(0);
    });

    it('defines feature flags', () => {
      expect(typeof POST_PROCESSING.TRAA_ENABLED).toBe('boolean');
      expect(typeof POST_PROCESSING.AO_ENABLED).toBe('boolean');
    });

    it('defines AO settings', () => {
      expect(POST_PROCESSING.AO_RADIUS).toBeGreaterThan(0);
      expect(POST_PROCESSING.AO_INTENSITY).toBeGreaterThan(0);
    });
  });

  describe('DEFAULT_CAMERA_CONFIG', () => {
    it('contains camera parameters', () => {
      expect(DEFAULT_CAMERA_CONFIG.minZoom).toBe(CAMERA.MIN_ZOOM);
      expect(DEFAULT_CAMERA_CONFIG.maxZoom).toBe(CAMERA.MAX_ZOOM);
      expect(DEFAULT_CAMERA_CONFIG.panSpeed).toBe(CAMERA.PAN_SPEED);
      expect(DEFAULT_CAMERA_CONFIG.zoomSpeed).toBe(CAMERA.ZOOM_SPEED);
    });

    it('contains edge scroll parameters', () => {
      expect(DEFAULT_CAMERA_CONFIG.edgeScrollSpeed).toBe(CAMERA.EDGE_SCROLL_SPEED);
      expect(DEFAULT_CAMERA_CONFIG.edgeScrollThreshold).toBe(CAMERA.EDGE_SCROLL_THRESHOLD);
    });
  });
});
