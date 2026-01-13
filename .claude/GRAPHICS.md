# VOIDSTRIKE Graphics Pipeline

## Overview

VOIDSTRIKE uses Three.js with WebGPU renderer and TSL (Three.js Shading Language) for a modern, high-performance graphics pipeline. This document covers implemented features and planned enhancements.

## Current Implementation

### Renderer
- **WebGPU Renderer** with WebGL2 fallback
- **TSL (Three.js Shading Language)** for shader authoring
- Post-processing pipeline using `three/webgpu` PostProcessing class

### Post-Processing Effects (Implemented)

| Effect | Status | Description |
|--------|--------|-------------|
| **GTAO** | ✅ Implemented | Ground Truth Ambient Occlusion for contact shadows |
| **Bloom** | ✅ Implemented | HDR glow effect with threshold/strength/radius controls |
| **FXAA** | ✅ Implemented | Fast Approximate Anti-Aliasing |
| **TRAA** | ✅ Implemented | Temporal Reprojection Anti-Aliasing with MRT velocity buffers |
| **EASU Upscaling** | ✅ Implemented | Edge-Adaptive Spatial Upsampling (FSR 1.0 inspired) |
| **RCAS Sharpening** | ✅ Implemented | Robust Contrast-Adaptive Sharpening |
| **Vignette** | ✅ Implemented | Cinematic edge darkening |
| **Color Grading** | ✅ Implemented | Exposure, saturation, contrast adjustment |

### Anti-Aliasing Details

#### TRAA (Temporal Reprojection Anti-Aliasing)
- Uses **zero-velocity mode** with depth-based reprojection
- Optional RCAS sharpening to counter temporal blur
- Halton sequence camera jittering for temporal sampling

**Why zero-velocity instead of MRT velocity:**
Three.js's velocity buffer calculates motion from `matrixWorld`, but `InstancedMesh` stores per-instance transforms in a separate `instanceMatrix` buffer. This causes incorrect velocity for dynamic instances (buildings, units, resources), resulting in visible jiggling. Zero-velocity mode uses depth-based reprojection which works correctly with InstancedMesh.

See: [GitHub Issue #31892](https://github.com/mrdoob/three.js/issues/31892)

```typescript
// Zero-velocity mode - works correctly with InstancedMesh
const traaPass = traa(outputNode, scenePassDepth, zeroVelocityNode, camera);
```

#### EASU Upscaling
- Renders at lower resolution, upscales to display resolution
- 12-tap edge-adaptive filter preserves sharp edges
- Ring suppression via local min/max clamping
- Configurable render scale (50%-100%)

### Effect Pipeline Order

1. **Scene Pass** - Render scene (no MRT currently - see TAA notes above)
2. **EASU Upscaling** - Applied first while we have a texture node (needs `.sample()`)
3. **GTAO** - Ambient occlusion multiplied with scene
4. **Bloom** - Additive HDR glow
5. **Color Grading** - Exposure, saturation, contrast, vignette
6. **Anti-Aliasing** - TRAA (zero-velocity) or FXAA as final pass

---

## Planned Enhancements

### High Priority (Easy to Add)

#### 1. Screen Space Reflections (SSR)
Three.js has an official [WebGPU SSR example](https://threejs.org/examples/webgpu_postprocessing_ssr.html).

**Benefits:**
- Realistic reflections on metallic units, water, floors
- No extra draw calls (screen-space technique)
- Works with roughness for blurred reflections

**Implementation:**
```typescript
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
const ssrPass = ssr(scenePassColor, scenePassDepth, scenePassNormal, camera);
```

#### 2. Motion Blur
**Note:** Requires MRT velocity which currently causes jiggling with InstancedMesh. Would need custom velocity solution for instanced objects.

**Benefits:**
- Cinematic feel for fast-moving units/projectiles
- Per-pixel blur based on motion vectors

**Implementation (when velocity is available):**
```typescript
import { motionBlur } from 'three/tsl';
const blurredNode = motionBlur(outputNode, velocityNode);
```

**Blockers:** Same InstancedMesh velocity issue as TRAA - see TAA notes above.

#### 3. Depth of Field (Bokeh DoF)
```typescript
import { dof } from 'three/tsl';
// dof(node, viewZNode, focusDistance, focalLength, bokehScale)
const dofNode = dof(outputNode, scenePassDepth, 10, 50, 2.0);
```

**Use Cases:**
- Auto-focus on selected units
- Dramatic cutscene moments
- Menu/pause screen background blur

#### 4. Film Grain & Chromatic Aberration
```typescript
import { film, chromaticAberration } from 'three/tsl';
const grainNode = film(outputNode, intensity, grayscale);
const caNode = chromaticAberration(outputNode, offset);
```

#### 5. Anamorphic Lens Flares
```typescript
import { anamorphic, lensflare } from 'three/tsl';
const flareNode = anamorphic(outputNode, threshold, scale, samples);
```

---

### Medium Priority (More Work, Big Impact)

#### 6. Screen Space Global Illumination (SSGI)
[Anderson Mancini's SSGI demo](https://ssgi-webgpu-demo.vercel.app/) shows this working with Three.js WebGPU + TSL.

**Features:**
- Real-time color bleeding
- Dynamic emissive lighting
- Realistic light bounces

**Impact:** Buildings casting colored light, explosions illuminating surroundings - would set VOIDSTRIKE apart from any browser game.

#### 7. Volumetric Lighting / God Rays
[Official Three.js example](https://threejs.org/examples/webgpu_volume_lighting.html) available.

**Features:**
- Atmospheric light shafts through fog/dust
- Compatible with native lights and shadows
- Post-processing based

**Impact:** Perfect for battlefield atmosphere, smoke, dust effects.

#### 8. PCSS Soft Shadows
Percentage-Closer Soft Shadows with variable penumbra.

**Features:**
- Soft shadow edges based on distance from caster
- More realistic than hard shadows
- Vogel disk sampling for quality

#### 9. Atmospheric Scattering
Based on [Epic's Sebastian Hillaire paper](https://discourse.threejs.org/t/volumetric-lighting-in-webgpu/87959).

**Features:**
- Realistic sky rendering
- Proper light scattering
- Day/night cycle support

---

### Cutting-Edge (Research Required)

#### 10. Temporal Super Resolution (TSR/DLSS-like)
Use MRT velocity data for frame interpolation and temporal upscaling beyond EASU.

**Potential:** True industry-first for browsers - neural-network-free temporal upscaling using motion vectors for reconstruction.

#### 11. GPU Particle Systems with Collision
Compute shader particles that interact with depth buffer.

**Features:**
- Debris, smoke, sparks
- Scene collision via depth testing
- Thousands of particles at 60fps

#### 12. Deferred Decals
Project damage marks, tire tracks, blast craters onto any surface.

**Features:**
- No texture modification needed
- Screen-space projection
- Dynamic application

---

## Technical Notes

### TSL Type Definitions
Some TSL exports like `velocity` exist in Three.js but aren't in `@types/three` yet. Workaround:

```typescript
import * as TSL from 'three/tsl';
const velocity = (TSL as any).velocity;
```

### MRT Requirements
- Requires `antialias: false` on WebGPURenderer
- Some materials may not output velocity properly
- Falls back gracefully to zero-velocity mode

### Performance Considerations
- GTAO is expensive - disable for low-end devices
- EASU at 75% scale provides ~1.8x performance boost
- TAA adds ~1ms per frame but provides superior quality

---

## References

- [Three.js TSL Documentation](https://threejs.org/docs/pages/TSL.html)
- [Three.js TSL Wiki](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [WebGPU TRAA Example](https://threejs.org/examples/webgpu_postprocessing_traa.html)
- [WebGPU SSR Example](https://threejs.org/examples/webgpu_postprocessing_ssr.html)
- [WebGPU Volumetric Lighting](https://threejs.org/examples/webgpu_volume_lighting.html)
- [SSGI WebGPU Demo](https://ssgi-webgpu-demo.vercel.app/)
- [TRAANode Docs](https://threejs.org/docs/pages/TRAANode.html)
