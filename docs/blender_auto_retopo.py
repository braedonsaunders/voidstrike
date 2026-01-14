"""
Automated Retopology & Baking Script for VOIDSTRIKE
====================================================

This script automates the conversion of high-poly Meshy.ai models
to game-ready assets with LODs and baked normal maps.

USAGE:
1. Open Blender
2. Import your high-poly model (File → Import)
3. Select the imported mesh
4. Open this script in Blender's Text Editor
5. Adjust settings below
6. Click "Run Script"

The script will:
- Create clean low-poly versions using Quadriflow
- Generate LOD levels
- UV unwrap automatically
- Bake normal maps from high to low
- Export game-ready GLB files
"""

import bpy
import os
import math

# =============================================================================
# SETTINGS - Adjust these for your needs
# =============================================================================

SETTINGS = {
    # Target polygon counts for each LOD
    "lod0_faces": 4000,      # ~8K triangles (close-up)
    "lod1_faces": 1500,      # ~3K triangles (medium)
    "lod2_faces": 500,       # ~1K triangles (far)

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
    "bake_diffuse": True,    # Transfer existing textures

    # Cleanup
    "keep_high_poly": False,  # Delete high-poly after baking to save memory
}

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

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


def create_quadriflow_remesh(obj, target_faces, name_suffix):
    """
    Create a Quadriflow remeshed version of the object.
    Returns the new low-poly object.
    """
    # Duplicate the object
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.duplicate()
    low_poly = bpy.context.active_object
    low_poly.name = obj.name.replace("_highpoly", "") + name_suffix

    # First, do a voxel remesh to clean up the geometry
    # This helps Quadriflow work better
    voxel_mod = low_poly.modifiers.new(name="VoxelRemesh", type='REMESH')
    voxel_mod.mode = 'VOXEL'
    # Calculate voxel size based on object dimensions
    dims = low_poly.dimensions
    max_dim = max(dims)
    voxel_mod.voxel_size = max_dim / 100  # Adaptive voxel size
    voxel_mod.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier="VoxelRemesh")

    # Now apply Quadriflow remesh
    # Note: In Blender 4.0+, we use the operator directly
    bpy.context.view_layer.objects.active = low_poly

    try:
        # Try the newer Quadriflow operator
        bpy.ops.object.quadriflow_remesh(
            target_faces=target_faces,
            use_preserve_sharp=True,
            use_preserve_boundary=True,
            use_mesh_symmetry=False,
            smooth_normals=True
        )
        print(f"  Created {low_poly.name} with ~{target_faces} faces via Quadriflow")
    except:
        # Fallback: use decimate if Quadriflow fails
        print(f"  Quadriflow failed, using Decimate fallback")
        current_faces = len(low_poly.data.polygons)
        ratio = target_faces / current_faces if current_faces > 0 else 0.1

        decimate = low_poly.modifiers.new(name="Decimate", type='DECIMATE')
        decimate.ratio = min(ratio, 1.0)
        bpy.ops.object.modifier_apply(modifier="Decimate")

    return low_poly


def create_lods(high_poly_obj, base_name):
    """Create LOD0, LOD1, LOD2 from high-poly object."""
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
        print(f"Creating {suffix}...")
        lod = create_quadriflow_remesh(high_poly_obj, target_faces, suffix)
        lods.append(lod)

    return lods


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


def create_bake_image(name, size):
    """Create a new image for baking."""
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])

    img = bpy.data.images.new(
        name=name,
        width=size,
        height=size,
        alpha=False,
        float_buffer=True  # 32-bit for better quality
    )
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
    bake_img = create_bake_image(img_name, size)

    # Setup material on low-poly
    setup_bake_material(low_poly, bake_img)

    # Select high-poly, then add low-poly to selection (active)
    bpy.ops.object.select_all(action='DESELECT')
    high_poly.select_set(True)
    low_poly.select_set(True)
    bpy.context.view_layer.objects.active = low_poly

    # Configure bake settings
    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.device = 'GPU'  # Use GPU if available
    bpy.context.scene.cycles.samples = 64    # Lower samples for speed

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
    bake_img = create_bake_image(img_name, size)
    bake_img.colorspace_settings.name = 'sRGB'

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
    mat = obj.data.materials[0]
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

    # Add normal map
    normal_tex = nodes.new('ShaderNodeTexImage')
    normal_tex.image = normal_img
    normal_tex.image.colorspace_settings.name = 'Non-Color'

    normal_map = nodes.new('ShaderNodeNormalMap')
    links.new(normal_tex.outputs['Color'], normal_map.inputs['Color'])
    links.new(normal_map.outputs['Normal'], principled.inputs['Normal'])

    # Add AO to base color (multiply)
    if ao_img:
        ao_tex = nodes.new('ShaderNodeTexImage')
        ao_tex.image = ao_img

        mix = nodes.new('ShaderNodeMixRGB')
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Fac'].default_value = 0.5

        links.new(ao_tex.outputs['Color'], mix.inputs['Color2'])
        # Connect to base color through mix


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
    print("\n" + "="*60)
    print("VOIDSTRIKE Auto-Retopology Pipeline")
    print("="*60)

    # Get selected object
    if not bpy.context.selected_objects:
        print("ERROR: No object selected! Please select your high-poly mesh.")
        return

    high_poly = bpy.context.active_object
    if high_poly.type != 'MESH':
        print("ERROR: Selected object is not a mesh!")
        return

    base_name = high_poly.name.replace("_highpoly", "").replace(".001", "")
    print(f"\nProcessing: {base_name}")
    print(f"Original faces: {len(high_poly.data.polygons):,}")

    # Setup
    output_path = ensure_output_dir()
    print(f"Output directory: {output_path}")

    # Step 1: Clean the high-poly mesh
    print("\n[Step 1/6] Cleaning high-poly mesh...")
    clean_mesh(high_poly)
    apply_all_modifiers(high_poly)

    # Step 2: Create LOD levels
    print("\n[Step 2/6] Creating LOD levels...")
    lods = create_lods(high_poly, base_name)

    # Step 3: UV unwrap all LODs
    print("\n[Step 3/6] UV unwrapping LODs...")
    for lod in lods:
        smart_uv_unwrap(lod)

    # Step 4: Bake maps (only to LOD0, others share textures)
    print("\n[Step 4/6] Baking textures...")
    lod0 = lods[0]

    normal_img = None
    ao_img = None

    if SETTINGS["bake_normal"]:
        normal_img = bake_normal_map(high_poly, lod0, output_path, base_name)

    if SETTINGS["bake_ao"]:
        ao_img = bake_ao_map(high_poly, lod0, output_path, base_name)

    # Step 5: Apply textures to materials
    print("\n[Step 5/6] Applying baked textures to materials...")
    for lod in lods:
        if normal_img:
            apply_baked_textures(lod, normal_img, ao_img)

    # Step 6: Export
    print("\n[Step 6/6] Exporting GLB files...")

    # Export each LOD separately
    for lod in lods:
        export_glb([lod], output_path, lod.name)

    # Also export all LODs together
    export_glb(lods, output_path, f"{base_name}_all_lods")

    # Cleanup
    if not SETTINGS["keep_high_poly"]:
        bpy.data.objects.remove(high_poly, do_unlink=True)
        print("\nCleaned up high-poly mesh")

    print("\n" + "="*60)
    print("COMPLETE!")
    print(f"Output files in: {output_path}")
    print("="*60 + "\n")


# Run the script
if __name__ == "__main__":
    main()
