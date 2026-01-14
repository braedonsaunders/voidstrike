"""
Automated Retopology & Baking Script for VOIDSTRIKE
====================================================
Using Instant Meshes for superior auto-retopology

This script automates the conversion of high-poly Meshy.ai models
to game-ready assets with LODs and baked normal maps.

SETUP:
1. Download Instant Meshes from: https://github.com/wjakob/instant-meshes
2. Extract it somewhere (e.g., C:/Tools/InstantMeshes/ or ~/Applications/)
3. Update INSTANT_MESHES_PATH below to point to the executable

USAGE:
1. Open Blender
2. Import your high-poly model (File → Import)
3. Select the imported mesh
4. Open this script in Blender's Text Editor
5. Adjust settings below (especially INSTANT_MESHES_PATH!)
6. Click "Run Script"

The script will:
- Export high-poly to temp OBJ
- Run Instant Meshes to create clean quad topology
- Import the result back into Blender
- Generate LOD levels
- UV unwrap automatically
- Bake normal maps from high to low
- Export game-ready GLB files
"""

import bpy
import os
import math
import subprocess
import tempfile
import platform

# =============================================================================
# SETTINGS - ADJUST THESE FOR YOUR SETUP
# =============================================================================

# Path to Instant Meshes executable
# Windows: "C:/Tools/InstantMeshes/Instant Meshes.exe"
# Mac:     "/Applications/Instant Meshes.app/Contents/MacOS/Instant Meshes"
# Linux:   "/home/username/tools/instant-meshes/Instant Meshes"
INSTANT_MESHES_PATH = ""  # <-- SET THIS!

# Auto-detect common locations if not set
def find_instant_meshes():
    """Try to find Instant Meshes in common locations."""
    system = platform.system()

    common_paths = []

    if system == "Windows":
        common_paths = [
            "C:/Program Files/Instant Meshes/Instant Meshes.exe",
            "C:/Tools/InstantMeshes/Instant Meshes.exe",
            os.path.expanduser("~/Downloads/instant-meshes/Instant Meshes.exe"),
            os.path.expanduser("~/Desktop/instant-meshes/Instant Meshes.exe"),
        ]
    elif system == "Darwin":  # macOS
        common_paths = [
            "/Applications/Instant Meshes.app/Contents/MacOS/Instant Meshes",
            os.path.expanduser("~/Applications/Instant Meshes.app/Contents/MacOS/Instant Meshes"),
            os.path.expanduser("~/Downloads/instant-meshes/Instant Meshes"),
        ]
    else:  # Linux
        common_paths = [
            "/usr/local/bin/Instant Meshes",
            "/usr/bin/Instant Meshes",
            os.path.expanduser("~/tools/instant-meshes/Instant Meshes"),
            os.path.expanduser("~/Downloads/instant-meshes/Instant Meshes"),
            os.path.expanduser("~/.local/bin/Instant Meshes"),
        ]

    for path in common_paths:
        if os.path.exists(path):
            return path

    return None


SETTINGS = {
    # Target face counts for each LOD (Instant Meshes uses face count)
    # These are QUAD faces, so triangles ≈ faces × 2
    "lod0_faces": 4000,      # ~8K triangles (close-up)
    "lod1_faces": 1500,      # ~3K triangles (medium distance)
    "lod2_faces": 500,       # ~1K triangles (far distance)

    # Instant Meshes settings
    "crease_angle": 30,      # Degrees - edges sharper than this are preserved
    "smooth_iterations": 2,  # Post-smoothing iterations (0-10)
    "deterministic": True,   # Reproducible results (slightly slower)

    # Texture resolution for baked maps
    "texture_size": 2048,    # 1024, 2048, or 4096

    # Baking settings
    "bake_extrusion": 0.1,   # Increase if you see black spots
    "bake_max_ray": 0.2,     # Max ray distance for baking

    # Output directory (relative to blend file or absolute)
    "output_dir": "//retopo_output/",

    # What to bake
    "bake_normal": True,
    "bake_ao": True,
    "bake_diffuse": False,   # Transfer existing textures (if any)

    # Cleanup
    "keep_high_poly": False,  # Delete high-poly after baking to save memory
    "keep_temp_files": False, # Keep intermediate OBJ files for debugging
}

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_instant_meshes_path():
    """Get the path to Instant Meshes executable."""
    if INSTANT_MESHES_PATH and os.path.exists(INSTANT_MESHES_PATH):
        return INSTANT_MESHES_PATH

    auto_path = find_instant_meshes()
    if auto_path:
        print(f"  Found Instant Meshes at: {auto_path}")
        return auto_path

    return None


def ensure_output_dir():
    """Create output directory if it doesn't exist."""
    output_path = bpy.path.abspath(SETTINGS["output_dir"])
    if not os.path.exists(output_path):
        os.makedirs(output_path)
    return output_path


def clean_mesh(obj):
    """Clean up mesh - merge doubles, fix normals."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0001)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    print(f"  Cleaned mesh: {obj.name}")


def apply_all_modifiers(obj):
    """Apply all modifiers on an object."""
    bpy.context.view_layer.objects.active = obj
    for modifier in obj.modifiers[:]:
        try:
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        except:
            print(f"  Warning: Could not apply modifier {modifier.name}")


def export_obj_for_instant_meshes(obj, filepath):
    """Export object as OBJ for Instant Meshes processing."""
    # Select only this object
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    # Export as OBJ
    bpy.ops.wm.obj_export(
        filepath=filepath,
        export_selected_objects=True,
        export_uv=False,  # We'll UV unwrap after retopo
        export_normals=True,
        export_materials=False,
        export_triangulated_mesh=True,  # Instant Meshes works better with tris
        forward_axis='NEGATIVE_Z',
        up_axis='Y',
    )
    print(f"  Exported high-poly to: {filepath}")


def run_instant_meshes(input_path, output_path, target_faces):
    """
    Run Instant Meshes on the input file.

    Command: InstantMeshes -o output.obj -f <faces> -r 4 -p 4 -c <crease> input.obj

    Args:
        input_path: Path to input OBJ file
        output_path: Path for output OBJ file
        target_faces: Target number of quad faces
    """
    im_path = get_instant_meshes_path()
    if not im_path:
        raise FileNotFoundError(
            "Instant Meshes not found! Please set INSTANT_MESHES_PATH at the top of the script.\n"
            "Download from: https://github.com/wjakob/instant-meshes"
        )

    # Build command
    cmd = [
        im_path,
        "-o", output_path,           # Output file (triggers batch mode)
        "-f", str(target_faces),     # Target face count
        "-r", "4",                   # Rosy: 4-fold rotational symmetry (quads)
        "-p", "4",                   # Posy: 4-fold positional symmetry (quads)
        "-c", str(SETTINGS["crease_angle"]),  # Crease angle
        "-S", str(SETTINGS["smooth_iterations"]),  # Smoothing
        "-b",                        # Align to boundaries
    ]

    if SETTINGS["deterministic"]:
        cmd.append("-d")             # Deterministic mode

    cmd.append(input_path)           # Input file (must be last)

    print(f"  Running Instant Meshes...")
    print(f"  Command: {' '.join(cmd)}")

    # Run the command
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )

        if result.returncode != 0:
            print(f"  STDERR: {result.stderr}")
            raise RuntimeError(f"Instant Meshes failed with code {result.returncode}")

        if not os.path.exists(output_path):
            raise RuntimeError("Instant Meshes did not produce output file")

        print(f"  Instant Meshes completed successfully")

    except subprocess.TimeoutExpired:
        raise RuntimeError("Instant Meshes timed out after 5 minutes")


def import_obj_result(filepath, name):
    """Import the OBJ result from Instant Meshes."""
    bpy.ops.wm.obj_import(
        filepath=filepath,
        forward_axis='NEGATIVE_Z',
        up_axis='Y',
    )

    # Get the imported object (should be the active one)
    imported = bpy.context.active_object
    imported.name = name

    print(f"  Imported retopo result: {name}")
    return imported


def create_instant_meshes_retopo(high_poly_obj, target_faces, name_suffix, temp_dir):
    """
    Create a retopologized version using Instant Meshes.
    Returns the new low-poly object.
    """
    base_name = high_poly_obj.name.replace("_highpoly", "")

    # File paths
    input_obj = os.path.join(temp_dir, f"{base_name}_highpoly.obj")
    output_obj = os.path.join(temp_dir, f"{base_name}{name_suffix}.obj")

    # Export high-poly (only do this once, reuse for all LODs)
    if not os.path.exists(input_obj):
        export_obj_for_instant_meshes(high_poly_obj, input_obj)

    # Run Instant Meshes
    run_instant_meshes(input_obj, output_obj, target_faces)

    # Import result
    new_name = base_name + name_suffix
    low_poly = import_obj_result(output_obj, new_name)

    # Clean up temp file if not keeping
    if not SETTINGS["keep_temp_files"]:
        try:
            os.remove(output_obj)
        except:
            pass

    # Match transform to original
    low_poly.location = high_poly_obj.location
    low_poly.rotation_euler = high_poly_obj.rotation_euler
    low_poly.scale = high_poly_obj.scale

    actual_faces = len(low_poly.data.polygons)
    print(f"  Created {new_name}: {actual_faces:,} faces ({actual_faces * 2:,} tris)")

    return low_poly


def create_lods_with_instant_meshes(high_poly_obj, base_name, temp_dir):
    """Create LOD0, LOD1, LOD2 using Instant Meshes."""
    lods = []

    # Rename high-poly for clarity
    high_poly_obj.name = base_name + "_highpoly"

    # Create each LOD level
    lod_settings = [
        (SETTINGS["lod0_faces"], "_LOD0"),
        (SETTINGS["lod1_faces"], "_LOD1"),
        (SETTINGS["lod2_faces"], "_LOD2"),
    ]

    for target_faces, suffix in lod_settings:
        print(f"\nCreating {suffix} ({target_faces} target faces)...")
        try:
            lod = create_instant_meshes_retopo(high_poly_obj, target_faces, suffix, temp_dir)
            lods.append(lod)
        except Exception as e:
            print(f"  ERROR creating {suffix}: {e}")
            print(f"  Falling back to Blender Decimate...")
            lod = create_decimate_fallback(high_poly_obj, target_faces * 2, suffix)
            lods.append(lod)

    return lods


def create_decimate_fallback(obj, target_tris, name_suffix):
    """Fallback: use Blender's Decimate if Instant Meshes fails."""
    # Duplicate the object
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.duplicate()
    low_poly = bpy.context.active_object
    low_poly.name = obj.name.replace("_highpoly", "") + name_suffix

    # Calculate decimation ratio
    current_faces = len(low_poly.data.polygons)
    ratio = (target_tris / 2) / current_faces if current_faces > 0 else 0.1

    # Apply decimate modifier
    decimate = low_poly.modifiers.new(name="Decimate", type='DECIMATE')
    decimate.ratio = min(max(ratio, 0.01), 1.0)
    bpy.ops.object.modifier_apply(modifier="Decimate")

    actual_faces = len(low_poly.data.polygons)
    print(f"  Fallback created {low_poly.name}: {actual_faces:,} faces")

    return low_poly


def smart_uv_unwrap(obj):
    """Apply smart UV projection to object."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(66),
        island_margin=0.02,
        area_weight=0.0,
        correct_aspect=True
    )
    bpy.ops.object.mode_set(mode='OBJECT')
    print(f"  UV unwrapped: {obj.name}")


def create_bake_image(name, size, is_normal=True):
    """Create a new image for baking."""
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])

    img = bpy.data.images.new(
        name=name,
        width=size,
        height=size,
        alpha=False,
        float_buffer=is_normal  # 32-bit for normals
    )

    if is_normal:
        img.colorspace_settings.name = 'Non-Color'

    return img


def setup_bake_material(obj, bake_image):
    """Set up material with image texture node for baking."""
    # Create new material if needed
    if len(obj.data.materials) == 0:
        mat = bpy.data.materials.new(name=f"{obj.name}_Material")
        obj.data.materials.append(mat)
    else:
        mat = obj.data.materials[0]

    mat.use_nodes = True
    nodes = mat.node_tree.nodes

    # Clear existing image texture nodes to avoid confusion
    for node in nodes:
        if node.type == 'TEX_IMAGE' and node.image == bake_image:
            nodes.remove(node)

    # Add image texture node
    tex_node = nodes.new('ShaderNodeTexImage')
    tex_node.image = bake_image
    tex_node.select = True
    nodes.active = tex_node

    return mat, tex_node


def bake_normal_map(high_poly, low_poly, output_path, base_name):
    """Bake normal map from high-poly to low-poly."""
    print(f"  Baking normal map...")

    # Create bake image
    size = SETTINGS["texture_size"]
    img_name = f"{base_name}_normal"
    bake_img = create_bake_image(img_name, size, is_normal=True)

    # Setup material on low-poly
    setup_bake_material(low_poly, bake_img)

    # Select high-poly, then add low-poly to selection (active)
    bpy.ops.object.select_all(action='DESELECT')
    high_poly.select_set(True)
    low_poly.select_set(True)
    bpy.context.view_layer.objects.active = low_poly

    # Configure render settings
    bpy.context.scene.render.engine = 'CYCLES'

    # Try to use GPU if available
    try:
        bpy.context.scene.cycles.device = 'GPU'
        # Enable all GPU devices
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'CUDA'  # or 'OPTIX', 'HIP', 'METAL'
        for device in prefs.devices:
            device.use = True
    except:
        print("  (Using CPU for baking)")
        bpy.context.scene.cycles.device = 'CPU'

    bpy.context.scene.cycles.samples = 64  # Lower samples for speed

    # Configure bake settings
    bake_settings = bpy.context.scene.render.bake
    bake_settings.use_selected_to_active = True
    bake_settings.cage_extrusion = SETTINGS["bake_extrusion"]
    bake_settings.max_ray_distance = SETTINGS["bake_max_ray"]

    # Bake!
    bpy.ops.object.bake(type='NORMAL')

    # Save image
    img_path = os.path.join(output_path, f"{img_name}.png")
    bake_img.filepath_raw = img_path
    bake_img.file_format = 'PNG'
    bake_img.save()
    print(f"  Saved: {img_path}")

    return bake_img


def bake_ao_map(high_poly, low_poly, output_path, base_name):
    """Bake ambient occlusion map."""
    print(f"  Baking AO map...")

    size = SETTINGS["texture_size"]
    img_name = f"{base_name}_ao"
    bake_img = create_bake_image(img_name, size, is_normal=False)

    setup_bake_material(low_poly, bake_img)

    bpy.ops.object.select_all(action='DESELECT')
    high_poly.select_set(True)
    low_poly.select_set(True)
    bpy.context.view_layer.objects.active = low_poly

    bpy.context.scene.cycles.samples = 128
    bpy.ops.object.bake(type='AO')

    img_path = os.path.join(output_path, f"{img_name}.png")
    bake_img.filepath_raw = img_path
    bake_img.file_format = 'PNG'
    bake_img.save()
    print(f"  Saved: {img_path}")

    return bake_img


def apply_baked_textures(obj, normal_img, ao_img=None):
    """Apply baked textures to material."""
    if len(obj.data.materials) == 0:
        mat = bpy.data.materials.new(name=f"{obj.name}_Material")
        obj.data.materials.append(mat)
    else:
        mat = obj.data.materials[0]

    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    # Find or create Principled BSDF
    principled = None
    for node in nodes:
        if node.type == 'BSDF_PRINCIPLED':
            principled = node
            break

    if not principled:
        principled = nodes.new('ShaderNodeBsdfPrincipled')

        # Connect to output
        output = None
        for node in nodes:
            if node.type == 'OUTPUT_MATERIAL':
                output = node
                break
        if output:
            links.new(principled.outputs['BSDF'], output.inputs['Surface'])

    # Add normal map
    normal_tex = nodes.new('ShaderNodeTexImage')
    normal_tex.image = normal_img
    normal_tex.image.colorspace_settings.name = 'Non-Color'
    normal_tex.location = (-500, 0)

    normal_map = nodes.new('ShaderNodeNormalMap')
    normal_map.location = (-200, 0)

    links.new(normal_tex.outputs['Color'], normal_map.inputs['Color'])
    links.new(normal_map.outputs['Normal'], principled.inputs['Normal'])

    # Add AO if provided
    if ao_img:
        ao_tex = nodes.new('ShaderNodeTexImage')
        ao_tex.image = ao_img
        ao_tex.location = (-500, 300)

        # Multiply AO with base color
        mix = nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 0.5
        mix.location = (-200, 300)

        # Set base color
        mix.inputs['A'].default_value = (0.8, 0.8, 0.8, 1.0)
        links.new(ao_tex.outputs['Color'], mix.inputs['B'])
        links.new(mix.outputs['Result'], principled.inputs['Base Color'])


def export_glb(objects, output_path, filename):
    """Export objects as GLB."""
    # Select only the objects to export
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)

    filepath = os.path.join(output_path, f"{filename}.glb")

    bpy.ops.export_scene.gltf(
        filepath=filepath,
        use_selection=True,
        export_format='GLB',
        export_texcoords=True,
        export_normals=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_materials='EXPORT',
        export_image_format='WEBP',
    )
    print(f"  Exported: {filepath}")


# =============================================================================
# MAIN SCRIPT
# =============================================================================

def main():
    """Main function - run the full retopology pipeline."""
    print("\n" + "="*70)
    print("  VOIDSTRIKE Auto-Retopology Pipeline")
    print("  Using Instant Meshes for superior quad topology")
    print("="*70)

    # Check for Instant Meshes
    im_path = get_instant_meshes_path()
    if im_path:
        print(f"\n✓ Instant Meshes found: {im_path}")
    else:
        print("\n⚠ WARNING: Instant Meshes not found!")
        print("  The script will fall back to Blender's Decimate modifier.")
        print("  For better results, download Instant Meshes from:")
        print("  https://github.com/wjakob/instant-meshes")
        print("\n  Then set INSTANT_MESHES_PATH at the top of this script.")

    # Get selected object
    if not bpy.context.selected_objects:
        print("\n✗ ERROR: No object selected!")
        print("  Please select your high-poly mesh and run again.")
        return

    high_poly = bpy.context.active_object
    if high_poly.type != 'MESH':
        print("\n✗ ERROR: Selected object is not a mesh!")
        return

    base_name = high_poly.name.replace("_highpoly", "").replace(".001", "").replace(".000", "")
    original_faces = len(high_poly.data.polygons)

    print(f"\n▸ Processing: {base_name}")
    print(f"  Original: {original_faces:,} faces ({original_faces * 2:,} triangles)")

    # Setup directories
    output_path = ensure_output_dir()
    temp_dir = tempfile.mkdtemp(prefix="voidstrike_retopo_")
    print(f"  Output: {output_path}")
    print(f"  Temp: {temp_dir}")

    # Step 1: Clean the high-poly mesh
    print("\n" + "-"*50)
    print("[Step 1/6] Cleaning high-poly mesh...")
    clean_mesh(high_poly)
    apply_all_modifiers(high_poly)

    # Step 2: Create LOD levels with Instant Meshes
    print("\n" + "-"*50)
    print("[Step 2/6] Creating LOD levels with Instant Meshes...")

    if im_path:
        lods = create_lods_with_instant_meshes(high_poly, base_name, temp_dir)
    else:
        # Fallback to decimate
        print("  Using Decimate fallback (Instant Meshes not available)")
        high_poly.name = base_name + "_highpoly"
        lods = [
            create_decimate_fallback(high_poly, SETTINGS["lod0_faces"] * 2, "_LOD0"),
            create_decimate_fallback(high_poly, SETTINGS["lod1_faces"] * 2, "_LOD1"),
            create_decimate_fallback(high_poly, SETTINGS["lod2_faces"] * 2, "_LOD2"),
        ]

    # Step 3: UV unwrap all LODs
    print("\n" + "-"*50)
    print("[Step 3/6] UV unwrapping LODs...")
    for lod in lods:
        smart_uv_unwrap(lod)

    # Step 4: Bake maps
    print("\n" + "-"*50)
    print("[Step 4/6] Baking textures...")
    lod0 = lods[0]

    normal_img = None
    ao_img = None

    if SETTINGS["bake_normal"]:
        normal_img = bake_normal_map(high_poly, lod0, output_path, base_name)

    if SETTINGS["bake_ao"]:
        ao_img = bake_ao_map(high_poly, lod0, output_path, base_name)

    # Step 5: Apply textures to materials
    print("\n" + "-"*50)
    print("[Step 5/6] Applying baked textures to materials...")
    for lod in lods:
        if normal_img:
            apply_baked_textures(lod, normal_img, ao_img)

    # Step 6: Export
    print("\n" + "-"*50)
    print("[Step 6/6] Exporting GLB files...")

    # Export each LOD separately
    for lod in lods:
        export_glb([lod], output_path, lod.name)

    # Also export all LODs together
    export_glb(lods, output_path, f"{base_name}_all_lods")

    # Cleanup
    if not SETTINGS["keep_high_poly"]:
        bpy.data.objects.remove(high_poly, do_unlink=True)
        print("\n  Cleaned up high-poly mesh")

    if not SETTINGS["keep_temp_files"]:
        try:
            import shutil
            shutil.rmtree(temp_dir)
            print(f"  Cleaned up temp directory")
        except:
            pass

    # Summary
    print("\n" + "="*70)
    print("  ✓ COMPLETE!")
    print("="*70)
    print(f"\n  Output files in: {output_path}")
    print(f"\n  Results:")
    for lod in lods:
        if lod.name in [o.name for o in bpy.data.objects]:
            faces = len(bpy.data.objects[lod.name].data.polygons)
            print(f"    • {lod.name}: {faces:,} faces ({faces*2:,} tris)")

    reduction = (1 - (SETTINGS["lod0_faces"] / original_faces)) * 100
    print(f"\n  Polygon reduction: {reduction:.1f}% (LOD0 vs original)")
    print("\n" + "="*70 + "\n")


# Run the script
if __name__ == "__main__":
    main()
