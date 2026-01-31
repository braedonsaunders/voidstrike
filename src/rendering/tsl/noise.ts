/* eslint-disable @typescript-eslint/no-explicit-any -- TSL shader nodes use polymorphic types */
/**
 * TSL Noise Functions
 *
 * WebGPU-compatible noise implementations using Three.js Shading Language (TSL).
 * These functions are used for procedural terrain generation, particle effects,
 * and other visual effects throughout the rendering pipeline.
 *
 * All functions compile to WGSL (WebGPU) or GLSL (WebGL fallback) automatically.
 */

import {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  floor,
  fract,
  abs,
  min,
  max,
  dot,
  normalize,
  step,
  sin,
  cos,
  sqrt,
  length,
  Loop,
  If,
  type ShaderNodeObject,
} from 'three/tsl';

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * mod289 - Used in Simplex noise implementation
 */
export const mod289_vec3 = Fn(([x]: [ShaderNodeObject<any>]) => {
  return x.sub(floor(x.mul(1.0 / 289.0)).mul(289.0));
});

export const mod289_vec4 = Fn(([x]: [ShaderNodeObject<any>]) => {
  return x.sub(floor(x.mul(1.0 / 289.0)).mul(289.0));
});

/**
 * permute - Permutation function for noise
 */
export const permute = Fn(([x]: [ShaderNodeObject<any>]) => {
  return mod289_vec4(x.mul(34.0).add(1.0).mul(x));
});

/**
 * taylorInvSqrt - Taylor series approximation of inverse square root
 */
export const taylorInvSqrt = Fn(([r]: [ShaderNodeObject<any>]) => {
  return float(1.79284291400159).sub(float(0.85373472095314).mul(r));
});

// ============================================
// SIMPLEX NOISE (3D)
// ============================================

/**
 * 3D Simplex Noise
 * Returns value in range [-1, 1]
 */
export const snoise3D = Fn(([v_immutable]: [ShaderNodeObject<any>]) => {
  const v = vec3(v_immutable).toVar();

  const C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  const i = floor(v.add(dot(v, vec3(C.y, C.y, C.y)))).toVar();
  const x0 = v.sub(i).add(dot(i, vec3(C.x, C.x, C.x))).toVar();

  // Other corners
  const g = step(x0.yzx, x0.xyz).toVar();
  const l = float(1.0).sub(g).toVar();
  const i1 = min(g.xyz, vec3(l.z, l.x, l.y)).toVar();
  const i2 = max(g.xyz, vec3(l.z, l.x, l.y)).toVar();

  const x1 = x0.sub(i1).add(C.x).toVar();
  const x2 = x0.sub(i2).add(C.y).toVar();
  const x3 = x0.sub(D.y).toVar();

  // Permutations
  const iMod = mod289_vec3(i).toVar();
  const p = permute(
    permute(
      permute(
        iMod.z.add(vec4(0.0, i1.z, i2.z, 1.0))
      ).add(iMod.y).add(vec4(0.0, i1.y, i2.y, 1.0))
    ).add(iMod.x).add(vec4(0.0, i1.x, i2.x, 1.0))
  ).toVar();

  // Gradients
  const n_ = float(0.142857142857).toVar();
  const ns = n_.mul(D.wyz).sub(D.xzx).toVar();

  const j = p.sub(floor(p.mul(ns.z).mul(ns.z)).mul(49.0)).toVar();

  const x_ = floor(j.mul(ns.z)).toVar();
  const y_ = floor(j.sub(x_.mul(7.0))).toVar();

  const x = x_.mul(ns.x).add(ns.y).toVar();
  const y = y_.mul(ns.x).add(ns.y).toVar();
  const h = float(1.0).sub(abs(x)).sub(abs(y)).toVar();

  const b0 = vec4(x.xy, y.xy).toVar();
  const b1 = vec4(x.zw, y.zw).toVar();

  const s0 = floor(b0).mul(2.0).add(1.0).toVar();
  const s1 = floor(b1).mul(2.0).add(1.0).toVar();
  const sh = step(h, vec4(0.0)).negate().toVar();

  const a0 = b0.xzyw.add(s0.xzyw.mul(vec4(sh.x, sh.x, sh.y, sh.y))).toVar();
  const a1 = b1.xzyw.add(s1.xzyw.mul(vec4(sh.z, sh.z, sh.w, sh.w))).toVar();

  const p0 = vec3(a0.xy, h.x).toVar();
  const p1 = vec3(a0.zw, h.y).toVar();
  const p2 = vec3(a1.xy, h.z).toVar();
  const p3 = vec3(a1.zw, h.w).toVar();

  // Normalize gradients
  const norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3))).toVar();
  p0.mulAssign(norm.x);
  p1.mulAssign(norm.y);
  p2.mulAssign(norm.z);
  p3.mulAssign(norm.w);

  // Mix contributions from the four corners
  const m = max(
    float(0.6).sub(vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))),
    0.0
  ).toVar();
  m.assign(m.mul(m));

  return float(42.0).mul(
    dot(m.mul(m), vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)))
  );
});

// ============================================
// FRACTAL BROWNIAN MOTION (FBM)
// ============================================

/**
 * 2-octave FBM
 */
export const fbm2 = Fn(([p_immutable]: [ShaderNodeObject<any>]) => {
  const p = vec3(p_immutable).toVar();
  const value = float(0).toVar();
  const amplitude = float(0.5).toVar();
  const frequency = float(1.0).toVar();

  value.addAssign(amplitude.mul(snoise3D(p.mul(frequency))));
  amplitude.mulAssign(0.5);
  frequency.mulAssign(2.0);
  value.addAssign(amplitude.mul(snoise3D(p.mul(frequency))));

  return value;
});

/**
 * 3-octave FBM
 */
export const fbm3 = Fn(([p_immutable]: [ShaderNodeObject<any>]) => {
  const p = vec3(p_immutable).toVar();
  const value = float(0).toVar();
  const amplitude = float(0.5).toVar();
  const frequency = float(1.0).toVar();

  value.addAssign(amplitude.mul(snoise3D(p.mul(frequency))));
  amplitude.mulAssign(0.5);
  frequency.mulAssign(2.0);
  value.addAssign(amplitude.mul(snoise3D(p.mul(frequency))));
  amplitude.mulAssign(0.5);
  frequency.mulAssign(2.0);
  value.addAssign(amplitude.mul(snoise3D(p.mul(frequency))));

  return value;
});

/**
 * 4-octave FBM
 */
export const fbm4 = Fn(([p_immutable]: [ShaderNodeObject<any>]) => {
  const p = vec3(p_immutable).toVar();
  const value = float(0).toVar();
  const amplitude = float(0.5).toVar();
  const frequency = float(1.0).toVar();

  value.addAssign(amplitude.mul(snoise3D(p.mul(frequency))));
  amplitude.mulAssign(0.5);
  frequency.mulAssign(2.0);
  value.addAssign(amplitude.mul(snoise3D(p.mul(frequency))));
  amplitude.mulAssign(0.5);
  frequency.mulAssign(2.0);
  value.addAssign(amplitude.mul(snoise3D(p.mul(frequency))));
  amplitude.mulAssign(0.5);
  frequency.mulAssign(2.0);
  value.addAssign(amplitude.mul(snoise3D(p.mul(frequency))));

  return value;
});

/**
 * 5-octave FBM
 */
export const fbm5 = Fn(([p_immutable]: [ShaderNodeObject<any>]) => {
  const p = vec3(p_immutable).toVar();
  const value = float(0).toVar();
  const amplitude = float(0.5).toVar();
  const frequency = float(1.0).toVar();

  value.addAssign(amplitude.mul(snoise3D(p.mul(frequency))));
  amplitude.mulAssign(0.5);
  frequency.mulAssign(2.0);
  value.addAssign(amplitude.mul(snoise3D(p.mul(frequency))));
  amplitude.mulAssign(0.5);
  frequency.mulAssign(2.0);
  value.addAssign(amplitude.mul(snoise3D(p.mul(frequency))));
  amplitude.mulAssign(0.5);
  frequency.mulAssign(2.0);
  value.addAssign(amplitude.mul(snoise3D(p.mul(frequency))));
  amplitude.mulAssign(0.5);
  frequency.mulAssign(2.0);
  value.addAssign(amplitude.mul(snoise3D(p.mul(frequency))));

  return value;
});

// ============================================
// VORONOI NOISE
// ============================================

/**
 * 2D Voronoi noise - returns (minDist, edgeDist)
 * Useful for rock cracks, cellular patterns
 */
export const voronoi2D = Fn(([p_immutable]: [ShaderNodeObject<any>]) => {
  const p = vec2(p_immutable).toVar();
  const n = floor(p).toVar();
  const f = fract(p).toVar();

  const minDist = float(8.0).toVar();
  const secondMin = float(8.0).toVar();

  // Manual loop unrolling for WebGPU compatibility
  // Check all 9 neighboring cells
  const offsets = [
    vec2(-1, -1), vec2(0, -1), vec2(1, -1),
    vec2(-1, 0), vec2(0, 0), vec2(1, 0),
    vec2(-1, 1), vec2(0, 1), vec2(1, 1),
  ];

  for (const offset of offsets) {
    const g = offset;
    const cellPos = n.add(g).toVar();

    // Pseudo-random point in cell using sin-based hash
    const hashInput = vec2(
      dot(cellPos, vec2(127.1, 311.7)),
      dot(cellPos, vec2(269.5, 183.3))
    );
    const o = fract(sin(hashInput).mul(43758.5453)).toVar();

    const r = g.add(o).sub(f).toVar();
    const d = dot(r, r).toVar();

    // Track two closest distances
    If(d.lessThan(minDist), () => {
      secondMin.assign(minDist);
      minDist.assign(d);
    }).Else(() => {
      If(d.lessThan(secondMin), () => {
        secondMin.assign(d);
      });
    });
  }

  return vec2(sqrt(minDist), sqrt(secondMin).sub(sqrt(minDist)));
});

// ============================================
// UTILITY NOISE FUNCTIONS
// ============================================

/**
 * Simple hash-based noise for quick variation
 */
export const hashNoise2D = Fn(([x, y, seed]: [ShaderNodeObject<any>, ShaderNodeObject<any>, ShaderNodeObject<any>]) => {
  const n = sin(float(x).mul(12.9898).add(float(y).mul(78.233)).add(seed)).mul(43758.5453);
  return fract(n);
});

/**
 * Triplanar noise sampling - avoids UV stretching on steep surfaces
 */
export const triplanarNoise = Fn(([
  worldPos,
  worldNormal,
  scale
]: [ShaderNodeObject<any>, ShaderNodeObject<any>, ShaderNodeObject<any>]) => {
  // Calculate blend weights based on normal
  const blending = abs(worldNormal).toVar();
  blending.assign(normalize(max(blending, float(0.00001))));
  const b = blending.x.add(blending.y).add(blending.z).toVar();
  blending.divAssign(b);

  // Sample noise from three planes
  const noiseX = fbm3(vec3(worldPos.zy.mul(scale), float(0)));
  const noiseY = fbm3(vec3(worldPos.xz.mul(scale), float(0)));
  const noiseZ = fbm3(vec3(worldPos.xy.mul(scale), float(0)));

  // Blend based on normal direction
  return noiseX.mul(blending.x).add(noiseY.mul(blending.y)).add(noiseZ.mul(blending.z));
});

// ============================================
// PROCEDURAL NORMAL CALCULATION
// ============================================

/**
 * Calculate procedural detail normal from noise
 */
export const calculateDetailNormal = Fn(([
  pos,
  scale,
  strength
]: [ShaderNodeObject<any>, ShaderNodeObject<any>, ShaderNodeObject<any>]) => {
  const eps = float(0.02).toVar();

  const h0 = fbm4(vec3(pos).mul(scale));
  const hx = fbm4(vec3(pos).add(vec3(eps, 0.0, 0.0)).mul(scale));
  const hz = fbm4(vec3(pos).add(vec3(0.0, 0.0, eps)).mul(scale));

  const normal = vec3(
    h0.sub(hx).mul(strength),
    float(1.0),
    h0.sub(hz).mul(strength)
  );

  return normalize(normal);
});

/**
 * Calculate high-frequency micro normal for surface detail
 */
export const calculateMicroNormal = Fn(([pos, scale]: [ShaderNodeObject<any>, ShaderNodeObject<any>]) => {
  const eps = float(0.01).toVar();

  const h0 = snoise3D(vec3(pos).mul(scale));
  const hx = snoise3D(vec3(pos).add(vec3(eps, 0.0, 0.0)).mul(scale));
  const hz = snoise3D(vec3(pos).add(vec3(0.0, 0.0, eps)).mul(scale));

  const normal = vec3(
    h0.sub(hx).mul(2.0),
    float(1.0),
    h0.sub(hz).mul(2.0)
  );

  return normalize(normal);
});
