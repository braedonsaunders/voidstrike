# Automated Retopology & Baking Workflow for Meshy.ai Models

This workflow takes a high-poly Meshy.ai model and produces game-ready assets with proper LODs - **no manual modeling required**.

## Overview

```
HIGH-POLY (1M tris)     AUTO-RETOPO          BAKE           EXPORT
from Meshy.ai      -->  Quadriflow     -->  Normals   -->  GLB with LODs
                        (5K-10K tris)       AO, etc.
```

## Prerequisites

- Blender 4.0+ (has improved Quadriflow)
- Your highest-quality Meshy.ai export (OBJ or GLB with max polygons)

---

## Method 1: Blender UI Workflow (Step-by-Step)

### Step 1: Import High-Poly Model

1. **File → Import → glTF 2.0 (.glb/.gltf)** or OBJ
2. Select your Meshy high-poly model
3. The model should have 500K-2M+ triangles

### Step 2: Clean Up the High-Poly

1. Select the mesh
2. **Tab** to enter Edit Mode
3. **M → Merge by Distance** (removes duplicate vertices)
4. Press **A** to select all
5. **Mesh → Normals → Recalculate Outside** (fixes inverted faces)
6. **Tab** to exit Edit Mode

### Step 3: Create Low-Poly with Quadriflow Remesh

This is the magic step - Quadriflow creates clean quad topology automatically.

1. Select your high-poly mesh
2. Go to **Properties Panel → Modifiers → Add Modifier → Remesh**
3. Set mode to **Voxel** first:
   - Voxel Size: Start with 0.02 (adjust based on model size)
   - Check "Smooth Shading"
   - Apply the modifier
4. Add another modifier: **Remesh** again
5. This time use **QuadriFlow** mode:
   - Target Face Count: **2500** (for 5K tris) or **5000** (for 10K tris)
   - Check "Smooth Normals"
   - Click **Apply**

**Alternative: Use Object → Quick Effects → Quick Remesh (QuadriFlow)**

### Step 4: Duplicate for LOD Levels

1. Select your new low-poly mesh
2. **Shift+D** to duplicate
3. Rename to `model_LOD0` (highest detail)
4. Duplicate again for `model_LOD1`, `model_LOD2`
5. For each LOD, add Decimate modifier:
   - LOD0: Keep as-is (~5K-10K)
   - LOD1: Decimate ratio 0.4 (~2K-4K)
   - LOD2: Decimate ratio 0.15 (~750-1.5K)

### Step 5: UV Unwrap the Low-Poly

1. Select your LOD0 mesh
2. **Tab** to Edit Mode
3. **A** to select all
4. **U → Smart UV Project**
   - Island Margin: 0.02
   - Check "Correct Aspect"
5. **Tab** to exit
6. Repeat for LOD1, LOD2 (or copy UVs)

### Step 6: Set Up Baking

1. Create a new image for baking:
   - **Image Editor → New**
   - Name: `model_normal`
   - Size: 2048x2048 (or 1024 for smaller objects)
   - Color: Leave as black
   - Check "32-bit Float" for normal maps

2. Assign image to low-poly:
   - Select low-poly mesh
   - Go to **Shader Editor**
   - Add **Image Texture** node
   - Select your new image
   - **Keep this node selected** (important for baking!)

### Step 7: Bake Normal Map

1. Select HIGH-POLY mesh first
2. **Shift+Click** to add LOW-POLY to selection (low-poly is now active)
3. Go to **Render Properties → Bake**
4. Settings:
   - Bake Type: **Normal**
   - Space: **Tangent**
   - Check **Selected to Active**
   - Extrusion: 0.1 (increase if you see artifacts)
   - Max Ray Distance: 0.2
5. Click **Bake**
6. Save the image: **Image → Save As** (use PNG 16-bit or EXR)

### Step 8: Bake Other Maps (Optional but Recommended)

**Ambient Occlusion:**
- Bake Type: Ambient Occlusion
- Samples: 128+

**Curvature (via Pointiness):**
- Requires geometry nodes or baking from vertex colors

**Base Color (transfer existing texture):**
- Bake Type: Diffuse
- Uncheck Direct/Indirect lighting

### Step 9: Apply Normal Map to Low-Poly

1. Select low-poly mesh
2. In Shader Editor, set up:
```
[Image Texture: normal_map] → [Normal Map Node] → [Principled BSDF: Normal input]
     Color Space: Non-Color
```

### Step 10: Export

1. Select all LOD meshes
2. **File → Export → glTF 2.0**
3. Settings:
   - Format: GLB
   - Include: Selected Objects
   - Transform: +Y Up
   - Mesh: Apply Modifiers
   - Material: Export
   - Compression: Check Draco

---

## Method 2: Python Script (Automated)

Save this script and run it in Blender's Text Editor for batch processing.

See: `auto_retopo.py` in this directory.

---

## Recommended Poly Counts for VOIDSTRIKE

| Asset Type | LOD0 | LOD1 | LOD2 | LOD3 |
|------------|------|------|------|------|
| Infantry | 2,000 | 800 | 300 | - |
| Vehicles | 5,000 | 2,000 | 600 | - |
| Large Units | 7,000 | 3,000 | 1,000 | - |
| Major Buildings | 8,000 | 3,000 | 1,000 | - |
| Minor Buildings | 4,000 | 1,500 | 500 | - |
| Decorations | 500 | 150 | 50 | Billboard |

---

## Troubleshooting

### "Black spots on normal map"
- Increase Extrusion value in bake settings
- Make sure high-poly completely covers low-poly
- Check face normals are consistent (blue = outside)

### "Bake takes forever"
- Reduce bake resolution to 1024x1024
- Use GPU baking (Cycles → GPU Compute)
- Reduce high-poly with Decimate first (to 100K-200K)

### "Quadriflow crashes"
- Reduce high-poly first with Decimate (ratio 0.2)
- Then run Quadriflow on the reduced mesh
- Voxel Remesh first can help stabilize

### "Thin parts (antennas) disappear"
- Lower the Voxel size (e.g., 0.005)
- Or manually separate thin parts before remesh, process separately

### "UVs are terrible"
- Try different UV methods:
  - Smart UV Project (good for hard surface)
  - Lightmap Pack (good for baking)
  - Use UV Squares addon for cleaner layout

---

## Quick Reference: Bake Settings

```
NORMAL MAP BAKE:
├── Bake Type: Normal
├── Space: Tangent
├── Selected to Active: ✓
├── Extrusion: 0.05 - 0.2
├── Max Ray Distance: 0.1 - 0.3
└── Output: 2048x2048, Non-Color, 16-bit PNG

AO MAP BAKE:
├── Bake Type: Ambient Occlusion
├── Samples: 128-256
└── Output: 1024x1024, sRGB, 8-bit PNG

DIFFUSE BAKE (texture transfer):
├── Bake Type: Diffuse
├── Contributions: Color only (uncheck Direct/Indirect)
└── Output: 2048x2048, sRGB, 8-bit PNG
```

---

## Expected Results

| Metric | Before (Meshy Decimated) | After (This Workflow) |
|--------|--------------------------|------------------------|
| Triangles | 30,000 | 5,000-8,000 |
| Visual Quality | Medium (broken details) | High (clean silhouette) |
| Normal Map | Auto-generated, flat | Baked from high-poly |
| Thin Features | Destroyed | Preserved in normal |
| Game Performance | Poor | Good |

---

## Alternative Tools

If Blender's Quadriflow isn't giving good results:

1. **Instant Meshes** (free) - External tool, often better than Quadriflow
   - Export high-poly as OBJ
   - Run through Instant Meshes
   - Import result back to Blender for baking

2. **Quad Remesher** ($110 addon) - Professional quality, worth it for many models

3. **ZBrush ZRemesher** - Industry standard but expensive

4. **RizomUV** - For better UV unwrapping specifically
