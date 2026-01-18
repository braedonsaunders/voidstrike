# VOIDSTRIKE Graphics Pipeline

## Overview

VOIDSTRIKE uses Three.js with WebGPU renderer and TSL (Three.js Shading Language) for a modern, high-performance graphics pipeline. This document covers implemented features and planned enhancements.

## Current Implementation

### Renderer
- **WebGPU Renderer** with WebGL2 fallback
- **TSL (Three.js Shading Language)** for shader authoring
- Post-processing pipeline using `three/webgpu` PostProcessing class
- **Tone Mapping:** Renderer uses `ACESFilmicToneMapping` with exposure 1.0

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
| **Volumetric Fog** | ✅ Implemented | Raymarched atmospheric scattering with quality presets |

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

**Tone Mapping Architecture:**
- `renderer.toneMapping = ACESFilmicToneMapping` (Three.js renderer)
- `renderer.toneMappingExposure = 1.0`
- PostProcessing also applies ACES Filmic in color grading pass
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

**Volumetric Fog Input Type Fix (January 2026):**
- Volumetric fog must handle both texture nodes AND Fn nodes as input
- When SSGI/SSR are enabled (ultra preset), previous effects transform `outputNode` from a texture node to a Fn node via `.mul()` and `.add()` operations
- Fn nodes do NOT have `.sample()` method - only texture nodes do
- Fix: Use `vec3(sceneColorTexture)` instead of `sceneColorTexture.sample(fragUV)`
- This works because TSL texture nodes auto-sample at current UV when used directly, and Fn nodes already represent the computed value
- **Symptom if broken:** Dark screen + "THREE.TSL: TypeError: o.sample is not a function" error on ultra preset

### Effect Pipeline Order

**Internal Pipeline (render resolution):**
1. **Scene Pass** - Render scene with MRT (output, normals, velocity)
2. **SSGI** - Global illumination + AO (if enabled)
3. **GTAO** - Ambient occlusion (if SSGI disabled)
4. **SSR** - Screen space reflections
5. **Bloom** - HDR glow
6. **Volumetric Fog** - Raymarched atmospheric scattering (if enabled)
7. **Color Grading** - Exposure, saturation, contrast, vignette
8. **TAA/FXAA** - Anti-aliasing

**Display Pipeline (display resolution):**
1. **EASU** - Edge-adaptive upscaling from internal output

---

## GPU Optimization Infrastructure

### GPU Compute Vision/Fog of War

**Location:** `src/rendering/compute/VisionCompute.ts`

The vision system supports GPU-accelerated computation for fog of war:

**Architecture:**
- Storage buffer: Unit positions + sight ranges packed as `vec4(x, y, sightRange, playerId)`
- Output texture: RGBA per cell (R=explored, G=visible) per player
- Optimized CPU path with typed arrays (ready for GPU compute shader migration)

**Benefits:**
- 1000+ vision casters at 60Hz (vs. hundreds at 2Hz with worker)
- Direct texture output for fog shader sampling
- Version tracking for dirty checking

**Usage:**
```typescript
// In VisionSystem
this.gpuVisionCompute = new VisionCompute(renderer, {
  mapWidth: 256,
  mapHeight: 256,
  cellSize: 2,
});

// Update every frame instead of every 10 ticks
gpuVisionCompute.updateVision(casters, playerIds);
```

### Temporal Reprojection for GTAO/SSR

**Location:** `src/rendering/tsl/TemporalAO.ts`, `src/rendering/tsl/TemporalSSR.ts`

Quarter-resolution rendering with history reprojection reduces GPU cost by 75%.

**GTAO Temporal Reprojection:**
- Render GTAO at quarter resolution (width/2 × height/2)
- Reproject previous frame's AO using velocity buffer
- Blend: 90% reprojected + 10% new quarter-res sample
- Depth-based rejection prevents disocclusion ghosting

**SSR Temporal Reprojection:**
- Render SSR at quarter resolution
- Neighborhood clamping (3×3) reduces ghosting
- Blend: 85% reprojected + 15% new (lower for reflection parallax)

**Configuration:**
```typescript
renderPipeline.applyConfig({
  temporalAOEnabled: true,
  temporalAOBlendFactor: 0.9,
  temporalSSREnabled: true,
  temporalSSRBlendFactor: 0.85,
});
```

### GPU-Driven Indirect Draw

**Location:** `src/rendering/compute/GPUUnitBuffer.ts`, `src/rendering/compute/CullingCompute.ts`

Infrastructure for GPU-driven rendering (zero CPU per-unit iteration).

**GPUUnitBuffer:**
- Slot allocation/deallocation for dynamic entities
- Transform buffer with velocity tracking (prev/curr matrices)
- Metadata buffer: `vec4(entityId, unitTypeIndex, playerId, boundingRadius)`
- Single buffer design per [Toji's best practices](https://toji.dev/webgpu-best-practices/indirect-draws.html)

**CullingCompute:**
- Frustum culling using bounding spheres
- LOD selection based on camera distance
- Configurable LOD thresholds
- Ready for GPU compute shader migration

**Usage:**
```typescript
// Enable GPU-driven mode
unitRenderer.enableGPUDrivenRendering();

// Per-frame update
gpuUnitBuffer.swapTransformBuffers(); // Start of frame
gpuUnitBuffer.commitChanges(); // Before render

// Culling (currently CPU, ready for GPU compute)
const result = cullingCompute.cull(gpuUnitBuffer, camera);
```

**WebGPU Indirect Draw Status:**
- `drawIndexedIndirect()` - Standardized, works in Three.js r174+
- `multiDrawIndexedIndirect()` - Experimental, requires `chrome://flags/#enable-unsafe-webgpu`
- Our implementation uses single buffer with multiple `drawIndexedIndirect` calls (300x faster than separate buffers on Chrome/Windows)

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

### WebGPU Device Limits (Custom Backend)

**Problem:** WebGPU's default limit is 8 vertex buffers, but TAA velocity tracking requires 8 attributes plus mesh attributes (3-5), totaling 11-13.

**Solution:** Custom WebGPU backend with higher limits (January 2025)

`WebGPURenderer.ts` now requests optimized device limits from the GPU adapter:

```typescript
const DESIRED_LIMITS = {
  maxVertexBuffers: 16,         // For TAA velocity (8) + mesh attrs (3-5)
  maxTextureDimension2D: 16384, // High-res shadow maps and terrain
  maxStorageBufferBindingSize: 1GB, // Large GPU particle systems
  maxBufferSize: 1GB,           // Massive instance buffers
};
```

**How it works:**
1. Query the GPU adapter's maximum supported limits
2. Request the minimum of desired and adapter-supported limits
3. Create a custom `WebGPUBackend` with `requiredLimits`
4. Pass backend to `WebGPURenderer`
5. Verify actual device limits after initialization

Most modern GPUs (Vulkan/D3D12/Metal backends) support 16+ vertex buffers.

**Fallback Behavior:**
- If limits can't be raised, `setupInstancedVelocity()` checks attribute count
- Velocity setup skipped if it would exceed device limit
- TAA uses depth-only reprojection (slight ghosting on fast objects)
- Console warns which meshes lack velocity tracking

### Runtime Vertex Attribute Cleanup

**Additional Safety:** `AssetManager.ts` also cleans excess attributes from AI-generated models:

The `cleanupModelAttributes()` function removes:
- Extra UV layers (`uv1`, `uv2`, `texcoord_1`)
- Extra color layers (`color_0`, `_color_1`)
- Morph targets
- Custom attributes starting with `_`

**Standard Attribute Budget:**
| Type | Attributes | Count |
|------|------------|-------|
| Static Mesh | position, normal, uv, tangent, color | 5 |
| Skinned Mesh | position, normal, uv, tangent, skinIndex, skinWeight | 6 |
| With Velocity | + currInstanceMatrix0-3, prevInstanceMatrix0-3 | +8 |

**Total with velocity:** 13-14 attributes (within 16 limit)

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

---

## Graphics Preset System

### Overview

VOIDSTRIKE implements an AAA-style data-driven graphics preset system, allowing users to select quality levels (Low, Medium, High, Ultra) or customize individual settings. Presets are defined in a JSON configuration file that can be edited to add custom presets or modify existing ones.

### Configuration File

Location: `public/config/graphics-presets.json`

```json
{
  "version": "1.0",
  "description": "Graphics quality presets",
  "presets": {
    "low": {
      "name": "Low",
      "description": "Best performance, minimal visual effects",
      "settings": {
        "postProcessingEnabled": true,
        "shadowsEnabled": false,
        "shadowQuality": "low",
        "ssaoEnabled": false,
        "bloomEnabled": false,
        "antiAliasingMode": "fxaa",
        "ssrEnabled": false,
        "ssgiEnabled": false,
        "volumetricFogEnabled": false,
        "dynamicLightsEnabled": false,
        "emissiveDecorationsEnabled": false,
        "particleDensity": 2.5,
        "maxPixelRatio": 1
        // ... all GraphicsSettings values
      }
    },
    "medium": { ... },
    "high": { ... },
    "ultra": { ... },
    "custom": {
      "name": "Custom",
      "description": "User-defined settings",
      "settings": null  // Custom doesn't apply settings
    }
  },
  "defaultPreset": "high"
}
```

### Preset Behavior

1. **Selection**: Users click a preset button (Low/Medium/High/Ultra) in the Graphics Options panel
2. **Application**: All settings from the preset's `settings` object are applied at once
3. **Custom Detection**: When any individual setting is changed, the system:
   - Temporarily marks preset as "custom"
   - Checks if new settings match any defined preset
   - If match found, updates preset indicator to that preset
4. **Modified Badge**: When preset is "custom", a yellow "Modified" badge appears

### Adding Custom Presets

Edit `public/config/graphics-presets.json` to add new presets:

```json
{
  "presets": {
    // ... existing presets ...
    "cinematic": {
      "name": "Cinematic",
      "description": "Maximum quality for screenshots and videos",
      "settings": {
        "postProcessingEnabled": true,
        "shadowsEnabled": true,
        "shadowQuality": "ultra",
        "shadowDistance": 150,
        "ssaoEnabled": true,
        "ssaoIntensity": 1.5,
        "bloomEnabled": true,
        "bloomStrength": 0.4,
        "antiAliasingMode": "taa",
        "ssrEnabled": true,
        "ssgiEnabled": true,
        "ssgiIntensity": 25,
        "volumetricFogEnabled": true,
        "volumetricFogQuality": "ultra",
        "dynamicLightsEnabled": true,
        "maxDynamicLights": 32,
        "emissiveDecorationsEnabled": true,
        "emissiveIntensityMultiplier": 1.5,
        "particleDensity": 12.0,
        "vignetteEnabled": true,
        "vignetteIntensity": 0.3
      }
    }
  }
}
```

### Implementation Details

**Store Integration** (`uiStore.ts`):
- `currentGraphicsPreset: GraphicsPresetName` - Tracks active preset
- `graphicsPresetsConfig: GraphicsPresetsConfig | null` - Loaded presets JSON
- `loadGraphicsPresets()` - Fetches presets from JSON file
- `applyGraphicsPreset(name)` - Applies all settings from a preset
- `detectCurrentPreset()` - Checks if current settings match any preset

**UI Integration** (`GraphicsOptionsPanel.tsx`):
- Preset selector buttons at top of panel
- "Modified" badge when custom
- Description text below buttons
- Auto-loads presets when panel opens

### Preset Settings Reference

Each preset controls all `GraphicsSettings` values:

| Category | Settings |
|----------|----------|
| **Core** | postProcessingEnabled |
| **Shadows** | shadowsEnabled, shadowQuality, shadowDistance |
| **Ambient Occlusion** | ssaoEnabled, ssaoRadius, ssaoIntensity |
| **Bloom** | bloomEnabled, bloomStrength, bloomThreshold, bloomRadius |
| **Anti-Aliasing** | antiAliasingMode, taaSharpeningEnabled, taaSharpeningIntensity |
| **Reflections** | ssrEnabled, ssrOpacity, ssrMaxRoughness |
| **Global Illumination** | ssgiEnabled, ssgiRadius, ssgiIntensity |
| **Resolution** | resolutionMode, resolutionScale, maxPixelRatio |
| **Frame Rate** | maxFPS (Off/60/120/144) |
| **Upscaling** | upscalingMode, renderScale, easuSharpness |
| **Fog** | fogEnabled, fogDensity, volumetricFogEnabled, volumetricFogQuality |
| **Lighting** | shadowFill, dynamicLightsEnabled, maxDynamicLights |
| **Effects** | emissiveDecorationsEnabled, particlesEnabled, particleDensity |
| **Color** | toneMappingExposure, saturation, contrast |
| **Vignette** | vignetteEnabled, vignetteIntensity |
| **Environment** | environmentMapEnabled |

---

## Graphics Settings Audit (January 2025)

### Connected Settings
All working and wired up:
- Post-processing master toggle
- Tone mapping (exposure, saturation, contrast)
- Shadows (enabled, quality, distance)
- SSAO (enabled, radius, intensity)
- Bloom (enabled, strength, threshold, radius)
- Anti-aliasing mode (off, FXAA, TAA)
- TAA sharpening (enabled, intensity)
- SSR (enabled, opacity, max roughness)
- SSGI (enabled, radius, intensity)
- Resolution settings (mode, scale, max pixel ratio)
- Upscaling (mode, render scale, EASU sharpness)
- Vignette (enabled, intensity)
- Fog (enabled, density) ✅ Fixed initialization
- **Volumetric Fog (enabled, quality, density, scattering)** ✅ New - integrated into PostProcessing pipeline
- Particles (enabled, density) ✅ Fixed - now wired up
- Environment map (enabled)
- **Emissive Decorations (enabled, intensity multiplier)** ✅ New - crystals now respond to settings
- Dynamic lights (enabled, max lights)
- Shadow fill

### Disconnected Settings (Not Wired)
These exist in `uiStore.ts` but have no effect:

| Setting | In Store | Has UI | Wired to Code |
|---------|----------|--------|---------------|
| `outlineEnabled` | ✅ | ❌ | ❌ |
| `outlineStrength` | ✅ | ❌ | ❌ |
| `taaHistoryBlendRate` | ✅ | ❌ | ❌ (comment says "kept for UI compatibility") |

**Recommendation:** Either implement these features or remove from store to avoid confusion.

---

## Proposed Features (Discussion)

### 1. Volumetric Fog System ✅ IMPLEMENTED

**Status:** Fully implemented and integrated into the PostProcessing pipeline (January 2025).

**Implementation Details:**
- Raymarched volumetric fog with Henyey-Greenstein phase function for light scattering
- Quality presets: Low (16 steps), Medium (32), High (64), Ultra (128)
- Configurable density and scattering intensity
- Height-based density falloff for realistic atmosphere
- Integrated into post-processing between Bloom and Color Grading

**Files:**
- `src/rendering/tsl/VolumetricFog.ts` - TSL implementation
- `src/rendering/tsl/PostProcessing.ts` - Pipeline integration
- `src/components/game/WebGPUGameCanvas.tsx` - Reactive settings

**Previous Proposed Approach (for reference):**

#### Implementation Approach

```typescript
// TSL Volumetric Fog Node
const volumetricFog = Fn(({ sceneColor, depth, lightPos, fogDensity }) => {
  const rayOrigin = cameraPosition;
  const rayDir = normalize(worldPosition.sub(cameraPosition));
  const rayLength = length(worldPosition.sub(cameraPosition));

  // Raymarch through fog volume
  const STEPS = 32; // Performance tunable
  const stepSize = rayLength / STEPS;

  let transmittance = 1.0;
  let inScattering = vec3(0);

  for (let i = 0; i < STEPS; i++) {
    const samplePos = rayOrigin.add(rayDir.mul(stepSize * i));

    // Sample fog density (can be noise-based for realism)
    const localDensity = fogDensity * heightFalloff(samplePos.y);

    // Light contribution (Henyey-Greenstein phase function)
    const lightDir = normalize(lightPos.sub(samplePos));
    const phase = henyeyGreenstein(dot(rayDir, lightDir), 0.3);

    // Shadow sampling (optional, expensive)
    const shadow = shadowMapSample(samplePos);

    inScattering += transmittance * localDensity * phase * shadow;
    transmittance *= exp(-localDensity * stepSize);
  }

  return mix(fogColor.mul(inScattering), sceneColor, transmittance);
});
```

#### Performance Impact

| Quality | Steps | Performance Hit | Visual Quality |
|---------|-------|-----------------|----------------|
| Low | 16 | ~1-2ms | Basic depth fog |
| Medium | 32 | ~2-4ms | Good volume feel |
| High | 64 | ~4-8ms | Cinematic quality |
| Ultra | 128 | ~8-15ms | Film-quality scattering |

**Optimization Strategies:**
1. **Half-resolution rendering** - Render fog at 50% res, bilateral upsample
2. **Temporal reprojection** - Spread samples across frames
3. **Frustum-aligned volumes** - Only raymarch visible area
4. **Blue noise dithering** - Better quality at low step counts

#### Use Cases for VOIDSTRIKE

| Effect | Implementation | Performance |
|--------|----------------|-------------|
| Production building smoke | Local density volumes at building positions | Low cost if localized |
| Vespene geyser gas | Animated noise-based density | Medium cost |
| Battlefield dust/haze | Full-screen low-density fog | Medium cost |
| Explosion smoke clouds | Temporary high-density spheres | Low (transient) |

#### Proposed UI (Graphics Panel → Atmosphere Section)

```
[Atmosphere]
├── [ ] Volumetric Fog           [Performance: Medium]
│   ├── Quality: [Low|Medium|High|Ultra]
│   ├── Density: ───●─── 0.8x
│   └── Light Scattering: ───●─── 1.0
├── [ ] Building Smoke
├── [ ] Geyser Effects
└── [ ] Battlefield Haze
```

---

### 2. Emissive Decorations (Crystals, Alien Structures) ✅ BASIC IMPLEMENTATION

**Status:** Basic implementation complete (January 2025). Crystals now respond to graphics settings.

**What's Working:**
- `emissiveDecorationsEnabled` - Toggle emissive glow on/off
- `emissiveIntensityMultiplier` - Control glow intensity (0.5x - 2.0x)
- CrystalField class stores material reference and updates emissive properties
- EnvironmentManager provides methods: `setEmissiveDecorationsEnabled()`, `setEmissiveIntensityMultiplier()`
- Reactive updates in WebGPUGameCanvas when settings change

**Limitations:**
- Only CrystalField is currently wired up
- InstancedDecorations and other emissive objects would need similar treatment
- No per-object pulsing animation yet
- Emissive objects don't cast actual point lights (would need LightPool integration)

**Files:**
- `src/rendering/GroundDetail.ts` - CrystalField with emissive controls
- `src/rendering/EnvironmentManager.ts` - Manager methods
- `src/components/game/WebGPUGameCanvas.tsx` - Reactive settings

**Previous Design (for reference):**

**Goal:** Crystals and alien structures that emit light, creating stunning visual effects.

#### Implementation Options

**Option A: Material Emissive + Bloom**
```typescript
// Simple: Set emissive on material
crystal.material.emissive = new THREE.Color(0x00ff88);
crystal.material.emissiveIntensity = 2.0; // > 1.0 triggers bloom

// Animate pulsing
crystal.material.emissiveIntensity = 1.5 + Math.sin(time) * 0.5;
```
- **Pros:** Simple, uses existing bloom pipeline
- **Cons:** No actual light cast on surroundings

**Option B: Emissive + Point Lights**
```typescript
// Create point light at decoration position
const crystalLight = new THREE.PointLight(0x00ff88, 2.0, 10);
crystalLight.position.copy(crystal.position);
scene.add(crystalLight);
```
- **Pros:** Actual light affects nearby objects
- **Cons:** Many point lights = expensive (but see pooling below)

**Option C: SSGI-Based Emission (Best Quality)**
```typescript
// Already have SSGI! Just need high emissive values
crystal.material.emissive = new THREE.Color(0x00ff88);
crystal.material.emissiveIntensity = 5.0;
// SSGI automatically handles light bouncing
```
- **Pros:** Physically accurate light bleeding, uses existing system
- **Cons:** Requires SSGI enabled (already high-end option)

#### Proposed Architecture

```typescript
// In EnvironmentManager or new EmissiveManager
interface EmissiveDecoration {
  mesh: THREE.Mesh;
  baseEmissive: THREE.Color;
  pulseSpeed: number;
  pulseAmplitude: number;
  attachedLight?: THREE.PointLight; // Optional actual light
}

class EmissiveDecorationManager {
  private decorations: EmissiveDecoration[] = [];
  private lightPool: THREE.PointLight[] = [];

  update(time: number) {
    for (const deco of this.decorations) {
      const pulse = 1.0 + Math.sin(time * deco.pulseSpeed) * deco.pulseAmplitude;
      deco.mesh.material.emissiveIntensity = pulse;

      if (deco.attachedLight) {
        deco.attachedLight.intensity = pulse * 0.5;
      }
    }
  }
}
```

#### Proposed UI

```
[Effects]
├── [ ] Emissive Decorations
│   ├── Crystals Glow: [Off|Subtle|Bright|Intense]
│   ├── Alien Structures: [Off|Subtle|Bright|Intense]
│   ├── Pulse Animation: [ ] ───●─── 1.0 speed
│   └── [ ] Cast Light (GPU expensive)
```

---

### 3. Ground-Up Fill Lighting

**Problem:** Dark rocks and shadowed areas look too dark.

#### Solutions

**Option A: Hemisphere Light Boost (Already Have)**
```typescript
// Current setup (EnvironmentManager.ts:121-126)
this.hemiLight = new THREE.HemisphereLight(
  skyColor,    // From above
  groundColor, // From below (THIS IS FILL LIGHT)
  0.5          // Intensity
);
```
**Quick fix:** Increase intensity to 0.7-0.8, use brighter ground color.

**Option B: Secondary Ambient from Below**
```typescript
// Add second ambient light with upward bias
const groundAmbient = new THREE.AmbientLight(0x404050, 0.3);
// Or use DirectionalLight pointing UP
const groundFill = new THREE.DirectionalLight(0x303040, 0.4);
groundFill.position.set(0, -1, 0); // From below
```

**Option C: Per-Material Ambient Boost**
```typescript
// In decoration material setup (InstancedDecorations.ts)
if (instancedMaterial instanceof THREE.MeshStandardMaterial) {
  // Re-enable some environment map contribution
  instancedMaterial.envMapIntensity = 0.3; // Was 0, contributing to darkness
}
```

**Option D: TSL Custom Fill Light Node**
```typescript
// In post-processing, add fill light based on surface orientation
const fillLight = Fn(({ color, normal }) => {
  const upFactor = clamp(dot(normal, vec3(0, 1, 0)), 0, 1);
  const fillAmount = 1.0 - upFactor; // More fill on downward-facing
  return color.add(fillColor.mul(fillAmount * fillIntensity));
});
```

#### Recommended Approach
1. **Immediate:** Increase `envMapIntensity` on rock materials from 0 to 0.2-0.3
2. **Quick win:** Boost hemisphere light ground color brightness
3. **Long-term:** Add UI slider for "Shadow Fill" that controls ground ambient

---

### 4. Per-Model Exposure/Material Settings in assets.json

**Proposal:** Add model-specific rendering hints to asset metadata.

```json
// assets.json
{
  "models": {
    "rocks_large": {
      "path": "/models/rocks_large.glb",
      "yOffset": 0.5,
      "rendering": {
        "envMapIntensity": 0.3,
        "emissive": null,
        "roughnessOverride": null,
        "metalnessOverride": null,
        "receiveShadow": true,
        "castShadow": true
      }
    },
    "crystal_blue": {
      "path": "/models/crystal_blue.glb",
      "yOffset": 0,
      "rendering": {
        "emissive": "#0088ff",
        "emissiveIntensity": 2.0,
        "envMapIntensity": 0.5,
        "attachLight": {
          "color": "#0088ff",
          "intensity": 1.5,
          "distance": 8
        }
      }
    },
    "alien_tower": {
      "path": "/models/alien_tower.glb",
      "yOffset": 0,
      "rendering": {
        "emissive": "#ff4400",
        "emissiveIntensity": 3.0,
        "pulseSpeed": 0.5,
        "pulseAmplitude": 0.3
      }
    }
  }
}
```

**Implementation:**
```typescript
// AssetManager.ts - Apply rendering hints when loading
function applyRenderingHints(mesh: THREE.Mesh, hints: RenderingHints) {
  if (hints.emissive) {
    mesh.material.emissive = new THREE.Color(hints.emissive);
    mesh.material.emissiveIntensity = hints.emissiveIntensity ?? 1.0;
  }
  if (hints.envMapIntensity !== undefined) {
    mesh.material.envMapIntensity = hints.envMapIntensity;
  }
  // ... etc
}
```

---

### 5. Lighting System Recommendations

#### Current State
5 static lights (ambient, key, fill, back, hemisphere) - traditional 3-point + additions.

#### Recommended Improvements

**Tier 1: Easy Wins (Low Effort)**
- [ ] Increase hemisphere ground color brightness (+20% for shadow fill)
- [ ] Re-enable partial envMapIntensity on decorations (0.2-0.3)
- [ ] Add UI exposure slider range expansion (0.5-2.5 instead of 0.5-2.0)

**Tier 2: Moderate Effort**
- [ ] **Light Pool System** - Reusable point/spot lights for effects
- [ ] **Emissive decoration manager** - Crystals/towers that glow
- [ ] **Per-biome light color presets** - More dramatic biome lighting

**Tier 3: Advanced (High Impact)**
- [ ] **Clustered lighting** - Efficient many-lights for WebGPU
- [ ] **Light probes** - Baked indirect lighting for performance
- [ ] **Dynamic time-of-day** - Moving sun, changing shadows

#### Proposed UI: Lighting Section

```
[Lighting]
├── Ambient Brightness: ───●─── 1.0
├── Shadow Intensity: ───●─── 1.0
├── Shadow Fill: ───●─── 0.3     [NEW - controls ground bounce]
├── [ ] Dynamic Lights           [For explosions, abilities]
│   └── Max Dynamic Lights: [4|8|16|32]
└── [ ] Emissive Objects Cast Light [GPU intensive]
```

#### Light Pool Implementation Sketch

```typescript
class LightPool {
  private pool: THREE.PointLight[] = [];
  private active: Map<string, THREE.PointLight> = new Map();

  constructor(scene: THREE.Scene, maxLights: number = 16) {
    for (let i = 0; i < maxLights; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10);
      light.visible = false;
      scene.add(light);
      this.pool.push(light);
    }
  }

  spawn(id: string, position: THREE.Vector3, color: THREE.Color, intensity: number, duration: number): void {
    const light = this.pool.find(l => !l.visible);
    if (!light) return; // Pool exhausted

    light.position.copy(position);
    light.color.copy(color);
    light.intensity = intensity;
    light.visible = true;
    this.active.set(id, light);

    // Auto-release after duration
    setTimeout(() => this.release(id), duration);
  }

  release(id: string): void {
    const light = this.active.get(id);
    if (light) {
      light.visible = false;
      light.intensity = 0;
      this.active.delete(id);
    }
  }
}

// Usage
lightPool.spawn('explosion_1', explosionPos, new THREE.Color(0xff6600), 5.0, 500);
lightPool.spawn('laser_hit', impactPos, new THREE.Color(0x00ffff), 3.0, 100);
```

---

### Summary: Recommended Implementation Order

1. **Immediate (This Session)** ✅ COMPLETED
   - ✅ Fix fog density default (done)
   - ✅ Wire up particle controls (done)
   - ✅ Volumetric fog system with quality levels (done - January 2025)
   - ✅ Implement emissive decoration system for crystals (done - January 2025)
   - Fix dark rocks: increase envMapIntensity on decoration materials

2. **Short Term**
   - Add "Shadow Fill" slider (hemisphere ground boost) - ✅ Already exists
   - Add per-model rendering hints to assets.json

3. **Medium Term**
   - Light pool for dynamic effects - ✅ Already implemented
   - Building smoke/geyser gas effects
   - Extend emissive system to InstancedDecorations

4. **Long Term**
   - Clustered deferred lighting
   - Full per-model light attachment system
   - Dynamic time-of-day

---

## Battle Effects System (January 2025)

### Overview

VOIDSTRIKE features a world-class battle effects system with:
- **Three.js 3D effects**: Projectile trails, explosions, impact decals, ground effects
- **Phaser 2D overlay**: Damage numbers, screen effects, kill streaks
- **Proper depth ordering**: Ground effects are now correctly occluded by units

### Architecture

```
┌────────────────────────────────────────────────────────┐
│                  PHASER 2D OVERLAY                      │
│  - DamageNumberSystem (consolidated damage display)     │
│  - ScreenEffectsSystem (chromatic aberration, shake)    │
│  - Kill streak announcements                            │
│  - Directional damage indicators                        │
├────────────────────────────────────────────────────────┤
│                THREE.JS 3D EFFECTS                      │
│  - BattleEffectsRenderer (projectiles, rings, decals)   │
│  - AdvancedParticleSystem (fire, smoke, sparks, debris) │
│  - Proper depth testing for ground/air effects          │
└────────────────────────────────────────────────────────┘
```

### Render Order

| Order | Layer | Description |
|-------|-------|-------------|
| 0-9 | Terrain | Ground geometry |
| 10-19 | Ground Decals | Scorch marks, impact craters |
| 20-29 | Ground Effects | Hit rings, shockwaves (`depthTest: true`) |
| 30-39 | Unit Shadows | Ground shadows |
| 40-59 | Ground Units | Marines, tanks, buildings |
| 60-69 | Projectiles | Tracers, plasma bolts, trails |
| 70-79 | Air Units | Wraiths, carriers |
| 80-89 | Air Effects | Hit effects at flying unit height |
| 90-99 | Glow Effects | Additive bloom-interacting effects |
| 100+ | UI | Damage numbers, indicators |

### Projectile System

**Faction-Specific Styles:**
| Faction | Primary Color | Trail Color | Glow |
|---------|---------------|-------------|------|
| Terran | Orange-yellow | Orange | Bright yellow |
| Protoss | Blue | Purple | Cyan |
| Zerg | Acid green | Dark green | Bright green |

**Features:**
- Ribbon trail geometry that follows projectile path
- Glow sprites with bloom interaction
- Muzzle flash at attack origin
- Impact sparks and decals

### Particle Types

| Type | Use Case | Features |
|------|----------|----------|
| FIRE | Explosions | Animated sprite, rises, orange→black |
| SMOKE | Aftermath | Large soft sprites, slow rise, fades |
| SPARK | Impacts | Small bright dots, arcs with gravity |
| DEBRIS | Destruction | Tumbling geometry, bounces on ground |
| ENERGY | Psionic | Pulsing, blue/purple |
| PLASMA | Acid | Dripping, green glow |
| DUST | Movement | Ground cloud, soft edges |
| ELECTRICITY | Shields | Rapid pulse, branching |

### Damage Numbers (Phaser 2D)

**Consolidation Logic:**
- Max one damage number per entity
- Hits within 500ms consolidate into existing number
- Total damage accumulates, number grows with intensity
- "Pop" animation on each new hit
- Float upward and fade over 800ms

**Color Coding:**
| Damage | Color | Trigger |
|--------|-------|---------|
| Normal | Yellow | < 30 damage |
| High | Orange | >= 30 damage |
| Critical | Red-orange | >= 50 damage |
| Killing Blow | Red | Target dies |

### Screen Effects (Phaser 2D)

| Effect | Trigger | Description |
|--------|---------|-------------|
| Chromatic Aberration | Heavy damage | RGB channel separation at screen edges |
| Directional Indicators | Damage received | Arrow pointing toward damage source |
| Kill Streak | 3/5/10/15/25 kills | "TRIPLE KILL", "RAMPAGE", etc. |
| Screen Cracks | Health < 30% | Fracture lines from screen edges |
| Explosion Rings | Building destroyed | Expanding white circles |
| Screen Flash | Major events | Brief color flash |

**Kill Streak Thresholds:**
1. 3 kills: "TRIPLE KILL" (orange)
2. 5 kills: "KILLING SPREE" (red-orange)
3. 10 kills: "RAMPAGE" (red)
4. 15 kills: "UNSTOPPABLE" (bright red)
5. 25 kills: "GODLIKE" (magenta)

### Performance Considerations

- Object pooling for all mesh types (150+ per pool)
- Vector3 pooling to avoid allocation in hot loops
- Instanced mesh particles for GPU efficiency
- Separate render groups for ground vs air effects
- Lazy geometry/material creation

### Files

| File | Purpose |
|------|---------|
| `src/rendering/effects/BattleEffectsRenderer.ts` | Core 3D battle effects |
| `src/rendering/effects/AdvancedParticleSystem.ts` | GPU particle system |
| `src/phaser/systems/DamageNumberSystem.ts` | Phaser damage numbers |
| `src/phaser/systems/ScreenEffectsSystem.ts` | Phaser screen effects |
| `src/engine/systems/CombatSystem.ts` | Emits `damage:dealt` event |

### Event Flow

```
CombatSystem.processAttack()
├── Emit 'combat:attack' → BattleEffectsRenderer creates projectile
├── Emit 'damage:dealt' → DamageNumberSystem shows/consolidates number
└── Emit 'player:damage' → ScreenEffectsSystem triggers effects
```
