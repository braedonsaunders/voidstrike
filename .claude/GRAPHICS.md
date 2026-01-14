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
| **SSR** | ✅ Implemented | Screen Space Reflections for metallic surfaces |
| **EASU Upscaling** | ✅ Implemented | Edge-Adaptive Spatial Upsampling (FSR 1.0 inspired) |
| **RCAS Sharpening** | ✅ Implemented | Robust Contrast-Adaptive Sharpening |
| **Vignette** | ✅ Implemented | Cinematic edge darkening |
| **Color Grading** | ✅ Implemented | Exposure, saturation, contrast adjustment |

### Anti-Aliasing Details

#### TRAA (Temporal Reprojection Anti-Aliasing)
- Uses **per-instance velocity** via MRT for proper motion vectors
- Optional RCAS sharpening to counter temporal blur
- TRAANode handles camera jitter internally (Halton sequence)
- AAA-style optimization: only moving objects pay the velocity cost

**Per-Instance Velocity (AAA Optimization):**
Three.js's built-in VelocityNode doesn't work for InstancedMesh (only tracks per-object, not per-instance). Our solution:

| Renderer | Velocity | Cost |
|----------|----------|------|
| UnitRenderer | Full per-instance | ~5-10% overhead |
| BuildingRenderer | Zero (static) | None |
| ResourceRenderer | Zero (static) | None |

**Key Insight:** Floating-point precision differences between code paths caused micro-jitter. By storing BOTH current and previous instance matrices as attributes and reading them identically, we eliminate precision issues.

See: [GitHub Issue #31892](https://github.com/mrdoob/three.js/issues/31892)

**Implementation:**
```typescript
// UnitRenderer: Full velocity tracking
setupInstancedVelocity(mesh);      // Add 8 vec4 attributes (curr + prev matrices)
swapInstanceMatrices(mesh);        // At frame START: prev = curr
commitInstanceMatrices(mesh);      // After updates: curr = mesh.instanceMatrix

// BuildingRenderer/ResourceRenderer: No velocity (static objects)
// Velocity node returns zero for meshes without attributes
```

**Velocity Node Architecture:**
```
createInstancedVelocityNode()
├── Read currInstanceMatrix0-3 (current frame transforms)
├── Read prevInstanceMatrix0-3 (previous frame transforms)
├── Check hasVelocity (currCol3.w == 1.0 for valid matrices)
├── Transform positionGeometry identically with both matrices
└── Return velocity.mul(hasVelocity) (zero if no attributes)
```

#### SSR (Screen Space Reflections)
- Real-time reflections on metallic surfaces
- Uses MRT to output view-space normals
- Configurable parameters:
  - `ssrMaxDistance` - Maximum reflection ray distance
  - `ssrOpacity` - Reflection intensity (0-1)
  - `ssrThickness` - Ray thickness for hit detection
  - `ssrMaxRoughness` - Maximum roughness that still reflects

```typescript
// Enable SSR in graphics settings
renderPipeline.applyConfig({ ssrEnabled: true });
```

**Note:** SSR uses MRT for normals which works correctly with InstancedMesh (unlike velocity).

#### EASU Upscaling
- Renders at lower resolution, upscales to display resolution
- 12-tap edge-adaptive filter preserves sharp edges
- Ring suppression via local min/max clamping
- Configurable render scale (50%-100%)

### Effect Pipeline Order

1. **Scene Pass** - Render scene (MRT with normals when SSR enabled)
2. **EASU Upscaling** - Applied first while we have a texture node (needs `.sample()`)
3. **GTAO** - Ambient occlusion multiplied with scene
4. **SSR** - Screen space reflections (when enabled)
5. **Bloom** - Additive HDR glow
6. **Color Grading** - Exposure, saturation, contrast, vignette
7. **Anti-Aliasing** - TRAA (zero-velocity) or FXAA as final pass

---

## Planned Enhancements

### High Priority (Easy to Add)

#### 1. Motion Blur
**Status:** Now possible with custom velocity implementation!

**Benefits:**
- Cinematic feel for fast-moving units/projectiles
- Per-pixel blur based on motion vectors

**Implementation:**
```typescript
import { motionBlur } from 'three/tsl';
// Use our custom velocity from MRT
const scenePassVelocity = scenePass.getTextureNode('velocity');
const blurredNode = motionBlur(outputNode, scenePassVelocity);
```

**Note:** Our custom per-instance velocity now enables proper motion blur with InstancedMesh objects.

#### 2. Depth of Field (Bokeh DoF)
```typescript
import { dof } from 'three/tsl';
// dof(node, viewZNode, focusDistance, focalLength, bokehScale)
const dofNode = dof(outputNode, scenePassDepth, 10, 50, 2.0);
```

**Use Cases:**
- Auto-focus on selected units
- Dramatic cutscene moments
- Menu/pause screen background blur

#### 3. Film Grain & Chromatic Aberration
```typescript
import { film, chromaticAberration } from 'three/tsl';
const grainNode = film(outputNode, intensity, grayscale);
const caNode = chromaticAberration(outputNode, offset);
```

#### 4. Anamorphic Lens Flares
```typescript
import { anamorphic, lensflare } from 'three/tsl';
const flareNode = anamorphic(outputNode, threshold, scale, samples);
```

---

### Medium Priority (More Work, Big Impact)

#### 5. Screen Space Global Illumination (SSGI)
[Anderson Mancini's SSGI demo](https://ssgi-webgpu-demo.vercel.app/) shows this working with Three.js WebGPU + TSL.

**Features:**
- Real-time color bleeding
- Dynamic emissive lighting
- Realistic light bounces

**Impact:** Buildings casting colored light, explosions illuminating surroundings - would set VOIDSTRIKE apart from any browser game.

#### 6. Volumetric Lighting / God Rays
[Official Three.js example](https://threejs.org/examples/webgpu_volume_lighting.html) available.

**Features:**
- Atmospheric light shafts through fog/dust
- Compatible with native lights and shadows
- Post-processing based

**Impact:** Perfect for battlefield atmosphere, smoke, dust effects.

#### 7. PCSS Soft Shadows
Percentage-Closer Soft Shadows with variable penumbra.

**Features:**
- Soft shadow edges based on distance from caster
- More realistic than hard shadows
- Vogel disk sampling for quality

#### 8. Atmospheric Scattering
Based on [Epic's Sebastian Hillaire paper](https://discourse.threejs.org/t/volumetric-lighting-in-webgpu/87959).

**Features:**
- Realistic sky rendering
- Proper light scattering
- Day/night cycle support

---

### Cutting-Edge (Research Required)

#### 9. Temporal Super Resolution (TSR/DLSS-like)
Use MRT velocity data for frame interpolation and temporal upscaling beyond EASU.

**Potential:** True industry-first for browsers - neural-network-free temporal upscaling using motion vectors for reconstruction.

#### 10. GPU Particle Systems with Collision
Compute shader particles that interact with depth buffer.

**Features:**
- Debris, smoke, sparks
- Scene collision via depth testing
- Thousands of particles at 60fps

#### 11. Deferred Decals
Project damage marks, tire tracks, blast craters onto any surface.

**Features:**
- No texture modification needed
- Screen-space projection
- Dynamic application

---

## Technical Notes

### TSL Type Definitions
Some TSL exports aren't in `@types/three` yet. Workaround:

```typescript
import * as TSL from 'three/tsl';
const modelWorldMatrix = (TSL as any).modelWorldMatrix;
const cameraProjectionMatrix = (TSL as any).cameraProjectionMatrix;
```

### MRT Requirements
- Requires `antialias: false` on WebGPURenderer
- Custom velocity node handles InstancedMesh correctly
- Normals output for SSR works with all materials

### Performance Considerations
- **GTAO:** ~1-2ms per frame - disable for low-end devices
- **EASU:** 75% render scale provides ~1.8x performance boost
- **TAA:** ~0.5-1ms overhead with custom velocity - excellent quality/cost ratio
- **SSR:** ~1-3ms per frame depending on scene complexity

---

## References

- [Three.js TSL Documentation](https://threejs.org/docs/pages/TSL.html)
- [Three.js TSL Wiki](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [WebGPU TRAA Example](https://threejs.org/examples/webgpu_postprocessing_traa.html)
- [WebGPU SSR Example](https://threejs.org/examples/webgpu_postprocessing_ssr.html)
- [WebGPU Volumetric Lighting](https://threejs.org/examples/webgpu_volume_lighting.html)
- [SSGI WebGPU Demo](https://ssgi-webgpu-demo.vercel.app/)
- [TRAANode Docs](https://threejs.org/docs/pages/TRAANode.html)
