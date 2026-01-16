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
6. **Volumetric Fog** - Raymarched atmospheric scattering (if enabled)
7. **Color Grading** - Exposure, saturation, contrast, vignette
8. **TAA/FXAA** - Anti-aliasing

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

### WebGPU Vertex Buffer Limit (Max 8)

**Problem:** WebGPU has a hard limit of 8 vertex buffers per render pipeline. Models from AI generators (Tripo AI, Meshy) often exceed this with extra attributes.

**Error Message:**
```
THREE.Vertex buffer count (11) exceeds the maximum number of vertex buffers (8).
[Invalid RenderPipeline "renderPipeline_tripo_mat_xxx"] is invalid.
```

**Solution:** Runtime vertex attribute cleanup in `AssetManager.ts` (January 2025)

The `cleanupModelAttributes()` function automatically removes excess vertex attributes when loading GLB models:
- Keeps essential attributes: `position`, `normal`, `uv`, `tangent`, `color`
- For skinned meshes also keeps: `skinIndex`, `skinWeight`
- Removes: extra UV layers (`uv1`, `uv2`, `texcoord_1`), extra color layers, morph targets, custom attributes

**Standard Attribute Budget:**
| Type | Attributes | Count |
|------|------------|-------|
| Static Mesh | position, normal, uv, tangent, color | 5 |
| Skinned Mesh | position, normal, uv, tangent, skinIndex, skinWeight | 6 |
| Static + Color | position, normal, uv, tangent, color | 5 |

**Note:** The Blender script (`docs/blender_auto_retopo.py`) should also clean up attributes during export. Runtime cleanup is a safety net for models that weren't processed or have attributes added by Three.js at load time.

### Velocity Tracking Limitation

The per-instance velocity system for TAA requires 8 vertex attributes (4 for current matrix, 4 for previous). Combined with a minimal mesh (position + normal + uv = 3 attributes), this totals 11 - exceeding WebGPU's 8 buffer limit.

**Current Behavior:**
- `setupInstancedVelocity()` checks attribute count before adding velocity
- If adding velocity would exceed 8 buffers, velocity setup is skipped
- TAA falls back to depth-only reprojection for these meshes
- This may cause slight ghosting on fast-moving units but prevents render crashes

**Future Options:**
1. **Compact velocity encoding** - Store only position delta (2 vec3 = 2 attrs) instead of full matrices (8 attrs)
2. **Uniform buffer arrays** - Store matrices in uniform buffers indexed by instance ID
3. **Selective velocity** - Only add velocity to simpler meshes that have budget

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
