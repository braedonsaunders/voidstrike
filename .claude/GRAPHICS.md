# VOIDSTRIKE Graphics Pipeline

## Overview

VOIDSTRIKE uses Three.js with WebGPU renderer and TSL (Three.js Shading Language) for a modern, high-performance graphics pipeline. This document covers implemented features and planned enhancements.

## Current Implementation

### Renderer
- **WebGPU Renderer** with WebGL2 fallback
- **TSL (Three.js Shading Language)** for shader authoring
- Post-processing pipeline using `three/webgpu` PostProcessing class
- **Tone Mapping:** Renderer uses `NoToneMapping`; all HDR→SDR conversion handled by PostProcessing via ACES Filmic

### Post-Processing Effects (Implemented)

| Effect | Status | Description |
|--------|--------|-------------|
| **GTAO** | ✅ Implemented | Ground Truth Ambient Occlusion for contact shadows |
| **Bloom** | ✅ Implemented | HDR glow effect with threshold/strength/radius controls |
| **FXAA** | ✅ Implemented | Fast Approximate Anti-Aliasing |
| **TRAA** | ✅ Implemented | Temporal Reprojection Anti-Aliasing with MRT velocity buffers |
| **SSR** | ✅ Implemented | Screen Space Reflections for metallic surfaces |
| **FSR 1.0 EASU** | ✅ Implemented | FidelityFX Super Resolution upscaling with Lanczos2 kernel |
| **RCAS Sharpening** | ✅ Implemented | Robust Contrast-Adaptive Sharpening |
| **Vignette** | ✅ Implemented | Cinematic edge darkening |
| **Color Grading** | ✅ Implemented | Exposure, saturation, contrast with ACES Filmic tone mapping |

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

#### FSR 1.0 EASU Upscaling
- Proper FSR 1.0 (FidelityFX Super Resolution) implementation
- 12-tap edge-adaptive filter with Lanczos2 kernel
- Directional filtering: filters ALONG edges, not across them
- Ring suppression using ALL 12 texels (not just 4)
- Configurable render scale (50%-100%)

**Algorithm:**
1. Sample 12 texels in cross pattern around target pixel
2. Compute luminance gradients for edge direction detection
3. Apply Lanczos2-weighted directional filtering based on edge orientation
4. Blend bilinear (flat areas) with directional (edges) based on edge strength
5. Ring suppression via local min/max from all 12 samples

**Color Space Handling:**
The internal render target uses `LinearSRGBColorSpace` because the post-processing pipeline outputs linear HDR data. Using `SRGBColorSpace` would cause double-linearization when sampling (washed out colors).

**Critical: Dual-Pipeline Color Space Fix:**
When rendering the internal pipeline to `internalRenderTarget`, the renderer's `outputColorSpace` must be temporarily set to `LinearSRGBColorSpace`. This is because:
1. ACES tone mapping already outputs display-referred (gamma-corrected) SDR values
2. If `outputColorSpace = SRGBColorSpace` (the default), Three.js applies ANOTHER gamma conversion
3. This caused washed out colors (double gamma correction)

The fix in `PostProcessing.render()`:
```typescript
// Save original color space
const originalColorSpace = this.renderer.outputColorSpace;
// Set linear for internal pipeline render
this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
// Render to target...
// Restore for canvas output
this.renderer.outputColorSpace = originalColorSpace;
```

**Tone Mapping Architecture (AAA Standard):**
- `renderer.toneMapping = NoToneMapping` (disabled on Three.js renderer)
- PostProcessing handles ALL tone mapping via ACES Filmic in color grading pass
- Prevents double-application of exposure/tone mapping (was causing washed out colors)
- Order: Linear HDR → Exposure → Saturation → Contrast → ACES Tone Map → Vignette

**AAA Dual-Pipeline Architecture for TAA + FSR:**

The render pipeline uses a dual-pipeline architecture like AAA games:

```
┌──────────────────────────────────────────┐
│     INTERNAL PIPELINE @ Render Res       │
│     (all buffers at render resolution)   │
│                                          │
│  Scene → SSGI → GTAO → SSR → Bloom →    │
│  Color Grading → TAA                     │
│                    │                     │
│                    ▼                     │
│              TextureNode                 │
└────────────────────┼─────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────┐
│     DISPLAY PIPELINE @ Display Res       │
│                                          │
│  EASU Upscale → Canvas                   │
└──────────────────────────────────────────┘
```

**Implementation:**
1. Set renderer to render resolution
2. Create internal PostProcessing (all buffers at render res)
3. Restore renderer to display resolution
4. Create display PostProcessing (EASU only)

**Render Order:**
1. Temporarily set renderer to render resolution
2. Render internal pipeline (scene + effects + TAA)
3. Restore renderer to display resolution
4. Render display pipeline (EASU upscale to canvas)

This solves:
- **WebGPU depth copy errors** - All depths match (no cross-resolution copies)
- **Camera shake with FSR** - TAA jitter at render resolution
- **Proper temporal accumulation** - History buffer at correct resolution

**SSR/SSGI Normal Texture Fix:**
- Pass raw encoded normal texture from MRT (has `.sample()` method)
- Do NOT use `colorToDirection()` before passing - returns Fn node without `.sample()`
- SSR/SSGI handle decoding internally during ray marching

### Effect Pipeline Order

**Internal Pipeline (render resolution):**
1. **Scene Pass** - Render scene with MRT (output, normals, velocity)
2. **SSGI** - Global illumination + AO (if enabled)
3. **GTAO** - Ambient occlusion (if SSGI disabled)
4. **SSR** - Screen space reflections
5. **Bloom** - HDR glow
6. **Color Grading** - Exposure, saturation, contrast, vignette
7. **TAA/FXAA** - Anti-aliasing

**Display Pipeline (display resolution):**
1. **EASU** - Edge-adaptive upscaling from internal output

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
