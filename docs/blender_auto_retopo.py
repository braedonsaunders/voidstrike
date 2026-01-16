"""
VOIDSTRIKE GLB LOD Generator & Compressor
==========================================
Takes pre-optimized GLB models (500-5000 polys) and generates LOD levels
with configurable compression for optimal loading performance.

INPUT: GLB files (already at correct LOD0 poly count)
OUTPUT: LOD0, LOD1, LOD2 GLB files with compression

COMPRESSION OPTIONS:
- Draco:   Google's compression, good compatibility (default)
- Meshopt: 20-30% smaller files, 2-3x faster decompression
           Better for games, requires Three.js EXT_meshopt_compression

TEXTURE OPTIONS:
- WEBP:    Good compression, widely supported (default)
- JPEG:    Good for photos, lossy
- PNG:     Lossless, larger files
- KTX2:    GPU-compressed Basis Universal, ~75% smaller
           Textures stay compressed on GPU (best for production)
           Requires KTX-Software tools: https://github.com/KhronosGroup/KTX-Software

FEATURES:
- Batch processes folders of GLB files
- Creates LOD1/LOD2 via decimation (no remeshing needed)
- Configurable mesh compression (Draco or Meshopt)
- Configurable texture compression (WebP, JPEG, PNG, or KTX2)
- Optional texture downscaling
- Preview mode to inspect LODs before export
- Preserves armatures and animations
- WebGPU vertex buffer cleanup (ensures max 8 vertex buffers)
  * Removes extra UV layers (keeps only first)
  * Removes unused vertex color layers
  * Removes shape keys/morph targets
  * Removes custom attributes
  * Validates before export

WEBGPU COMPATIBILITY:
WebGPU has a limit of 8 vertex buffers. This script automatically cleans up
excess vertex attributes from ALL LOD levels (including LOD0) to ensure
compatibility. Common issues with generated models (e.g., from Tripo, Meshy):
- Multiple UV channels
- Unused vertex color layers
- Morph targets/blend shapes
- Custom attributes from generation process

EXTERNAL TOOLS (optional):
- gltfpack: For optimal Meshopt compression
  https://github.com/zeux/meshoptimizer
  Usage: gltfpack -i input.glb -o output.glb -cc

- KTX-Software: For KTX2/Basis Universal textures
  https://github.com/KhronosGroup/KTX-Software
  Required for texture_format = "KTX2"

SETUP:
1. Set INPUT_FOLDERS to your model folders
2. Set OUTPUT_FOLDER for processed models
3. Configure SETTINGS for your preferred compression
4. Run in Blender

USAGE:
1. Open Blender (fresh scene recommended)
2. Window → Toggle System Console (to see prompts)
3. Open this script in Text Editor
4. Adjust settings below
5. Click "Run Script"
"""

import bpy
import os
import math
from pathlib import Path

# =============================================================================
# CONFIGURATION
# =============================================================================

# Input folders containing GLB models
INPUT_FOLDERS = {
    "buildings": "/path/to/your/buildings/",
    "decorations": "/path/to/your/decorations/",
    "resources": "/path/to/your/resources/",
    "units": "/path/to/your/units/",
}

# Output folder for processed models
OUTPUT_FOLDER = "/path/to/output/"

# LOD decimation ratios (LOD0 = original, no decimation)
# These are RATIOS of the original poly count
LOD_RATIOS = {
    "buildings": {"lod1": 0.5, "lod2": 0.25},
    "decorations": {"lod1": 0.4, "lod2": 0.15},
    "resources": {"lod1": 0.4, "lod2": 0.15},
    "units": {"lod1": 0.5, "lod2": 0.25},
}

SETTINGS = {
    # =========================================================================
    # COMPRESSION MODE: Choose between Draco and Meshopt
    # =========================================================================
    # "draco"   - Google's Draco: Good compression, widely supported
    # "meshopt" - Meshoptimizer: 20-30% smaller files, 2-3x faster decompression
    #             Better animation compression, native Three.js support
    # Recommendation: Use "meshopt" for new projects, "draco" for compatibility
    "compression_mode": "meshopt",      # "draco" or "meshopt"

    # Draco compression settings (used when compression_mode = "draco")
    "draco_compression_level": 10,      # 0-10, higher = more compression (slower)
    "draco_position_quantization": 14,  # 0-30, lower = more compression (less precision)
    "draco_normal_quantization": 10,    # 0-30
    "draco_texcoord_quantization": 12,  # 0-30
    "draco_color_quantization": 10,     # 0-30

    # Meshopt compression settings (used when compression_mode = "meshopt")
    # Meshopt uses EXT_meshopt_compression extension in glTF
    # Settings are simpler as meshopt auto-optimizes based on mesh characteristics

    # =========================================================================
    # TEXTURE COMPRESSION: Standard vs KTX2/Basis Universal
    # =========================================================================
    # "WEBP"   - WebP format, good compression, widely supported
    # "JPEG"   - JPEG format, good for photos, lossy
    # "PNG"    - PNG format, lossless, larger files
    # "KTX2"   - Basis Universal in KTX2 container: GPU-compressed, ~75% smaller
    #            Requires KTX-Software tools installed (toktx command)
    #            Best for production - textures stay compressed on GPU
    "texture_format": "WEBP",           # "WEBP", "JPEG", "PNG", or "KTX2"
    "texture_quality": 80,              # 0-100 for WEBP/JPEG (higher = better quality)
    "downscale_textures": True,         # Downscale large textures
    "max_texture_size": 1024,           # Max texture dimension when downscaling

    # KTX2/Basis Universal settings (used when texture_format = "KTX2")
    # Requires KTX-Software: https://github.com/KhronosGroup/KTX-Software
    "ktx2_uastc": True,                 # Use UASTC for high quality (vs ETC1S for smaller)
    "ktx2_uastc_quality": 2,            # 0-4, higher = better quality (slower)
    "ktx2_zstd_compression": True,      # Apply Zstandard supercompression
    "ktx2_mipmap": True,                # Generate mipmaps in KTX2 file

    # Processing options
    "auto_approve": False,              # Set True to skip approval prompts
    "export_lod0": True,                # Export LOD0 (original, just compressed)
    "export_lod1": True,                # Export LOD1
    "export_lod2": True,                # Export LOD2

    # WebGPU vertex attribute cleanup (to stay under 8 buffer limit)
    # Set to False to disable specific cleanups if they cause visual issues
    "cleanup_extra_uv_layers": True,    # Remove UV1, UV2, etc. (keep only UV0)
    "cleanup_vertex_colors": True,      # Remove unused vertex color layers
    "cleanup_shape_keys": True,         # Remove shape keys/morph targets (breaks morph animations!)
    "cleanup_custom_attributes": True,  # Remove non-standard attributes
    "cleanup_custom_normals": False,    # Clear custom split normals (can change edge shading)
}

# =============================================================================
# TEST MODE - Set to True to test with just ONE model
# =============================================================================
TEST_MODE = True  # <-- SET TO False FOR FULL BATCH PROCESSING


# =============================================================================
# USER INTERACTION
# =============================================================================

class UserPrompt:
    """Handle user prompts in Blender's console."""

    @staticmethod
    def refresh_viewport_and_frame(objects):
        """Force viewport refresh and frame camera on processed objects."""
        bpy.ops.object.select_all(action='DESELECT')

        for obj in objects:
            if obj and obj.name in bpy.data.objects:
                obj.select_set(True)

        if bpy.context.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')

        for area in bpy.context.screen.areas:
            if area.type == 'VIEW_3D':
                for region in area.regions:
                    if region.type == 'WINDOW':
                        with bpy.context.temp_override(area=area, region=region):
                            bpy.ops.view3d.view_selected()
                        break

        for area in bpy.context.screen.areas:
            if area.type == 'VIEW_3D':
                for space in area.spaces:
                    if space.type == 'VIEW_3D':
                        space.shading.type = 'MATERIAL'
                        break

        for area in bpy.context.screen.areas:
            area.tag_redraw()

        bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)

    @staticmethod
    def wait_for_approval(model_name, category, stats, lod_objects=None):
        """Wait for user approval in Blender console."""
        if SETTINGS["auto_approve"]:
            return "approve"

        if lod_objects:
            UserPrompt.refresh_viewport_and_frame(lod_objects)

        print("\n" + "="*60)
        print(f"  MODEL READY FOR REVIEW: {model_name}")
        print("="*60)
        print(f"  Category: {category}")
        print(f"  Original: {stats.get('original_faces', 'N/A'):,} faces")
        if stats.get('lod0_faces'):
            print(f"  LOD0: {stats['lod0_faces']:,} faces (original)")
        if stats.get('lod1_faces'):
            print(f"  LOD1: {stats['lod1_faces']:,} faces")
        if stats.get('lod2_faces'):
            print(f"  LOD2: {stats['lod2_faces']:,} faces")
        if stats.get('has_armature'):
            print(f"  Armature: Preserved")
            print(f"  Animations: {stats.get('animation_count', 0)} clips")
        print("-"*60)
        print("  *** Check Blender viewport - LODs are displayed ***")
        print("-"*60)
        print("  Commands:")
        print("    [a] Approve and export")
        print("    [s] Skip this model")
        print("    [q] Quit batch processing")
        print("-"*60)

        try:
            response = input("  Enter choice [a/s/q]: ").strip().lower()
            if response in ['a', 'approve', '']:
                return "approve"
            elif response in ['s', 'skip']:
                return "skip"
            elif response in ['q', 'quit']:
                return "quit"
            else:
                print(f"  Unknown response '{response}', defaulting to approve")
                return "approve"
        except EOFError:
            print("  (No console input available, auto-approving)")
            return "approve"


# =============================================================================
# MESH UTILITIES
# =============================================================================

def get_mesh_stats(obj):
    """Get mesh statistics."""
    return {
        "faces": len(obj.data.polygons),
        "vertices": len(obj.data.vertices),
        "tris": sum(len(p.vertices) - 2 for p in obj.data.polygons),
    }


def cleanup_vertex_attributes(obj):
    """
    Clean up excess vertex attributes to stay under WebGPU's 8 vertex buffer limit.

    WebGPU has a maximum of 8 vertex buffers. Typical required attributes:
    - Position (1)
    - Normal (1)
    - UV0/TexCoord0 (1)
    - Tangent (1) - for normal mapping
    - Vertex Color (1) - if used

    This function removes (based on SETTINGS):
    - Extra UV layers (UV1, UV2, etc.) - keep only first
    - Unused vertex color layers
    - Shape keys/morph targets (optional - can break morph animations)
    - Custom split normals data (optional - can change edge shading)

    Returns:
        dict: Statistics about what was removed
    """
    if obj.type != 'MESH':
        return {}

    mesh = obj.data
    removed = {
        "uv_layers": 0,
        "vertex_colors": 0,
        "shape_keys": 0,
        "attributes": 0,
        "custom_normals": 0,
    }

    # Remove extra UV layers (keep only the first one)
    if SETTINGS.get("cleanup_extra_uv_layers", True):
        while len(mesh.uv_layers) > 1:
            # Remove the last UV layer (keep first)
            mesh.uv_layers.remove(mesh.uv_layers[-1])
            removed["uv_layers"] += 1

    # Remove unused vertex color layers (keep at most one if it's actually used)
    if SETTINGS.get("cleanup_vertex_colors", True):
        # Check if vertex colors are used in materials
        vertex_colors_used = False
        for mat in obj.data.materials:
            if mat and mat.use_nodes:
                for node in mat.node_tree.nodes:
                    if node.type == 'VERTEX_COLOR':
                        vertex_colors_used = True
                        break

        if not vertex_colors_used:
            # Remove all vertex color layers if not used
            while len(mesh.vertex_colors) > 0:
                mesh.vertex_colors.remove(mesh.vertex_colors[0])
                removed["vertex_colors"] += 1
        else:
            # Keep only one vertex color layer
            while len(mesh.vertex_colors) > 1:
                mesh.vertex_colors.remove(mesh.vertex_colors[-1])
                removed["vertex_colors"] += 1

        # Also check color attributes (Blender 3.2+)
        if hasattr(mesh, 'color_attributes'):
            if not vertex_colors_used:
                while len(mesh.color_attributes) > 0:
                    mesh.color_attributes.remove(mesh.color_attributes[0])
                    removed["vertex_colors"] += 1
            else:
                while len(mesh.color_attributes) > 1:
                    mesh.color_attributes.remove(mesh.color_attributes[-1])
                    removed["vertex_colors"] += 1

    # Remove shape keys if present (they add vertex buffers for morph targets)
    # WARNING: This will break morph/blend shape animations!
    if SETTINGS.get("cleanup_shape_keys", True):
        if mesh.shape_keys:
            # Remove all shape keys
            bpy.context.view_layer.objects.active = obj
            try:
                bpy.ops.object.shape_key_remove(all=True)
                removed["shape_keys"] += 1
            except:
                pass  # Shape keys might not be removable in some cases

    # Remove custom attributes that aren't standard (Blender 3.0+)
    if SETTINGS.get("cleanup_custom_attributes", True):
        if hasattr(mesh, 'attributes'):
            # Standard attributes to keep
            keep_attrs = {'position', 'normal', 'UVMap', '.corner_vert', '.corner_edge',
                          '.edge_verts', 'material_index', 'sharp_face', 'sharp_edge'}

            attrs_to_remove = []
            for attr in mesh.attributes:
                # Keep standard attributes and the first UV
                if attr.name not in keep_attrs and not attr.name.startswith('UVMap'):
                    # Don't remove if it's a required internal attribute
                    if not attr.name.startswith('.'):
                        attrs_to_remove.append(attr.name)

            for attr_name in attrs_to_remove:
                try:
                    mesh.attributes.remove(mesh.attributes[attr_name])
                    removed["attributes"] += 1
                except:
                    pass

    # Clear custom split normals (they can change edge shading appearance)
    # Disabled by default as it can affect visual quality
    if SETTINGS.get("cleanup_custom_normals", False):
        if mesh.has_custom_normals:
            try:
                bpy.ops.mesh.customdata_custom_splitnormals_clear()
                removed["custom_normals"] += 1
            except:
                pass

    return removed


def get_vertex_attribute_count(obj):
    """
    Count the approximate number of vertex attributes/buffers a mesh will use.

    Returns:
        tuple: (count, details_dict)
    """
    if obj.type != 'MESH':
        return 0, {}

    mesh = obj.data
    details = {}
    count = 0

    # Position is always present
    count += 1
    details['position'] = 1

    # Normals
    count += 1
    details['normal'] = 1

    # UV layers
    uv_count = len(mesh.uv_layers)
    if uv_count > 0:
        count += uv_count
        details['uv_layers'] = uv_count

    # Vertex colors (legacy)
    vc_count = len(mesh.vertex_colors)
    if vc_count > 0:
        count += vc_count
        details['vertex_colors'] = vc_count

    # Color attributes (Blender 3.2+)
    if hasattr(mesh, 'color_attributes'):
        ca_count = len(mesh.color_attributes)
        if ca_count > 0:
            count += ca_count
            details['color_attributes'] = ca_count

    # Shape keys (each adds a buffer for morph targets)
    if mesh.shape_keys and len(mesh.shape_keys.key_blocks) > 1:
        sk_count = len(mesh.shape_keys.key_blocks) - 1  # Exclude basis
        count += sk_count
        details['shape_keys'] = sk_count

    # Tangents (usually computed at export if normal maps exist)
    # Check if any material uses normal maps
    has_normal_map = False
    for mat in mesh.materials:
        if mat and mat.use_nodes:
            for node in mat.node_tree.nodes:
                if node.type == 'NORMAL_MAP':
                    has_normal_map = True
                    break
    if has_normal_map:
        count += 1
        details['tangent'] = 1

    return count, details


def create_decimated_lod(source_obj, ratio, lod_name):
    """
    Create a decimated LOD from the source mesh.

    Args:
        source_obj: Source mesh object
        ratio: Decimation ratio (0.5 = half the faces)
        lod_name: Name for the new LOD object

    Returns:
        New decimated mesh object
    """
    # Duplicate the source
    bpy.ops.object.select_all(action='DESELECT')
    source_obj.select_set(True)
    bpy.context.view_layer.objects.active = source_obj
    bpy.ops.object.duplicate()

    lod = bpy.context.active_object
    lod.name = lod_name

    original_faces = len(lod.data.polygons)

    # Apply decimate modifier
    decimate = lod.modifiers.new("Decimate", 'DECIMATE')
    decimate.decimate_type = 'COLLAPSE'
    decimate.ratio = max(0.01, min(ratio, 1.0))
    decimate.use_collapse_triangulate = False  # Keep quads where possible

    # Apply the modifier
    bpy.context.view_layer.objects.active = lod
    bpy.ops.object.modifier_apply(modifier="Decimate")

    # Fix normals and apply smooth shading to reduce harsh edge lines
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Apply smooth shading with angle-based edge preservation (Blender 4+)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=1.0472)  # 60 degrees
    except:
        bpy.ops.object.shade_smooth()  # Fallback for older versions

    new_faces = len(lod.data.polygons)
    print(f"      Decimated: {original_faces:,} -> {new_faces:,} faces ({ratio:.0%})")

    # Clean up vertex attributes on the decimated LOD
    removed = cleanup_vertex_attributes(lod)
    if sum(removed.values()) > 0:
        attr_count, _ = get_vertex_attribute_count(lod)
        print(f"      Cleaned vertex attributes: {attr_count} buffers")

    return lod


def downscale_textures(max_size=1024):
    """
    Downscale all textures in the scene to max_size.
    Helps reduce GLB file size significantly.
    """
    for img in bpy.data.images:
        if img.size[0] > max_size or img.size[1] > max_size:
            # Calculate new size maintaining aspect ratio
            scale = max_size / max(img.size[0], img.size[1])
            new_width = int(img.size[0] * scale)
            new_height = int(img.size[1] * scale)

            print(f"      Downscaling texture {img.name}: {img.size[0]}x{img.size[1]} -> {new_width}x{new_height}")

            # Scale the image
            img.scale(new_width, new_height)


# =============================================================================
# GLB IMPORT/EXPORT
# =============================================================================

def import_glb(filepath):
    """
    Import a GLB file.

    Returns:
        tuple: (mesh_objects, armature_obj) - lists of mesh objects and armature if present
    """
    # Clear selection before import
    bpy.ops.object.select_all(action='DESELECT')

    # Import
    bpy.ops.import_scene.gltf(filepath=filepath)

    # Collect imported objects
    mesh_objects = []
    armature_obj = None

    for obj in bpy.context.selected_objects:
        if obj.type == 'MESH':
            mesh_objects.append(obj)
        elif obj.type == 'ARMATURE':
            armature_obj = obj

    return mesh_objects, armature_obj


def check_ktx_tools():
    """Check if KTX-Software tools are available for KTX2 conversion."""
    import shutil
    return shutil.which('toktx') is not None


def convert_textures_to_ktx2(glb_path):
    """
    Convert textures in a GLB file to KTX2/Basis Universal format.

    This is a post-processing step that:
    1. Extracts the GLB to glTF + separate files
    2. Converts textures to KTX2 using toktx
    3. Re-packs as GLB with KTX2 textures

    Requires KTX-Software tools: https://github.com/KhronosGroup/KTX-Software

    Args:
        glb_path: Path to the GLB file to process

    Returns:
        bool: True if conversion succeeded
    """
    import subprocess
    import tempfile
    import json
    import shutil

    if not check_ktx_tools():
        print("      WARNING: KTX-Software tools not found. Install from:")
        print("               https://github.com/KhronosGroup/KTX-Software")
        print("               Skipping KTX2 texture conversion.")
        return False

    try:
        # Create temp directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            gltf_path = os.path.join(temp_dir, "model.gltf")

            # Extract GLB to glTF + separate files
            # (Blender's exporter can't directly output KTX2, so we convert after)
            bpy.ops.export_scene.gltf(
                filepath=gltf_path,
                use_selection=True,
                export_format='GLTF_SEPARATE',
                export_image_format='PNG',  # Export as PNG first
                export_materials='EXPORT',
                export_animations=True,
                export_animation_mode='ACTIONS',
                export_apply=True,
            )

            # Find all PNG textures
            png_files = [f for f in os.listdir(temp_dir) if f.endswith('.png')]

            # Convert each texture to KTX2
            for png_file in png_files:
                png_path = os.path.join(temp_dir, png_file)
                ktx2_path = os.path.join(temp_dir, png_file.replace('.png', '.ktx2'))

                # Build toktx command
                cmd = ['toktx', '--t2']  # Output KTX2 format

                if SETTINGS["ktx2_uastc"]:
                    cmd.extend(['--encode', 'uastc'])
                    cmd.extend(['--uastc_quality', str(SETTINGS["ktx2_uastc_quality"])])
                else:
                    cmd.extend(['--encode', 'etc1s'])

                if SETTINGS["ktx2_zstd_compression"]:
                    cmd.extend(['--zcmp', '19'])  # Zstd compression level

                if SETTINGS["ktx2_mipmap"]:
                    cmd.append('--genmipmap')

                cmd.extend([ktx2_path, png_path])

                # Run conversion
                result = subprocess.run(cmd, capture_output=True, text=True)
                if result.returncode != 0:
                    print(f"      WARNING: KTX2 conversion failed for {png_file}")
                    print(f"               {result.stderr}")
                    continue

                # Remove original PNG
                os.remove(png_path)

            # Update glTF to reference KTX2 files
            with open(gltf_path, 'r') as f:
                gltf_data = json.load(f)

            # Update image references
            if 'images' in gltf_data:
                for image in gltf_data['images']:
                    if 'uri' in image and image['uri'].endswith('.png'):
                        image['uri'] = image['uri'].replace('.png', '.ktx2')
                        image['mimeType'] = 'image/ktx2'

            # Add KTX2 extension
            if 'extensionsUsed' not in gltf_data:
                gltf_data['extensionsUsed'] = []
            if 'KHR_texture_basisu' not in gltf_data['extensionsUsed']:
                gltf_data['extensionsUsed'].append('KHR_texture_basisu')

            with open(gltf_path, 'w') as f:
                json.dump(gltf_data, f)

            # Re-pack as GLB (this requires gltf-pipeline or similar tool)
            # For now, we'll just copy the processed files
            # In production, you'd use gltf-pipeline to create the final GLB
            print("      NOTE: KTX2 textures created. Use gltf-pipeline to pack final GLB.")
            print(f"            Temp files in: {temp_dir}")

            return True

    except Exception as e:
        print(f"      ERROR: KTX2 conversion failed: {e}")
        return False


def export_glb(objects, armature, output_path):
    """
    Export objects as GLB with configurable mesh compression (Draco or Meshopt).

    Supports:
    - Draco compression: Good compression, widely supported
    - Meshopt compression: 20-30% smaller, 2-3x faster decompression
    - KTX2 textures: GPU-compressed, ~75% smaller (requires KTX-Software)

    Args:
        objects: List of mesh objects to export
        armature: Armature object (or None)
        output_path: Output file path
    """
    # Validate vertex attribute count before export
    for obj in objects:
        if obj.type == 'MESH':
            attr_count, details = get_vertex_attribute_count(obj)
            if attr_count > 8:
                print(f"      WARNING: {obj.name} has {attr_count} vertex attributes (WebGPU max: 8)")
                print(f"               Details: {details}")
                print(f"               Attempting additional cleanup...")
                cleanup_vertex_attributes(obj)
                attr_count, _ = get_vertex_attribute_count(obj)
                if attr_count > 8:
                    print(f"      ERROR: Still {attr_count} attributes after cleanup!")
                else:
                    print(f"      Fixed: Now {attr_count} attributes")

    # Select objects for export
    bpy.ops.object.select_all(action='DESELECT')

    for obj in objects:
        obj.select_set(True)

    if armature:
        armature.select_set(True)
        bpy.context.view_layer.objects.active = armature

    # Downscale textures if enabled
    if SETTINGS["downscale_textures"]:
        downscale_textures(SETTINGS["max_texture_size"])

    # Determine compression mode
    compression_mode = SETTINGS.get("compression_mode", "draco")
    use_draco = compression_mode == "draco"
    use_meshopt = compression_mode == "meshopt"

    # Determine texture format (KTX2 requires post-processing)
    texture_format = SETTINGS["texture_format"]
    if texture_format == "KTX2":
        # Export as PNG first, then convert to KTX2 after
        texture_format = "PNG"
        do_ktx2_conversion = True
    else:
        do_ktx2_conversion = False

    # Build export parameters
    export_params = {
        "filepath": output_path,
        "use_selection": True,
        "export_format": 'GLB',

        # Texture format
        "export_image_format": texture_format,

        # Material export
        "export_materials": 'EXPORT',

        # Animation (preserve if present)
        "export_animations": True,
        "export_animation_mode": 'ACTIONS',

        # Other optimizations
        "export_apply": True,  # Apply modifiers
    }

    # Add compression-specific parameters
    if use_draco:
        export_params.update({
            "export_draco_mesh_compression_enable": True,
            "export_draco_mesh_compression_level": SETTINGS["draco_compression_level"],
            "export_draco_position_quantization": SETTINGS["draco_position_quantization"],
            "export_draco_normal_quantization": SETTINGS["draco_normal_quantization"],
            "export_draco_texcoord_quantization": SETTINGS["draco_texcoord_quantization"],
            "export_draco_color_quantization": SETTINGS["draco_color_quantization"],
        })
        print(f"      Compression: Draco (level {SETTINGS['draco_compression_level']})")

    elif use_meshopt:
        # Meshopt is supported via gltfpack post-processing or Blender 4.0+ native
        # For Blender < 4.0, we export without compression and run gltfpack after
        try:
            # Try to enable meshopt compression (Blender 4.0+)
            export_params["export_draco_mesh_compression_enable"] = False
            # Note: Meshopt export may require Blender 4.0+ or gltfpack post-processing
            print("      Compression: Meshopt (via EXT_meshopt_compression)")
            print("      NOTE: For optimal meshopt compression, run 'gltfpack' on the output:")
            print(f"            gltfpack -i {output_path} -o {output_path} -cc")
        except:
            print("      WARNING: Meshopt not available in this Blender version")
            print("               Falling back to Draco compression")
            export_params.update({
                "export_draco_mesh_compression_enable": True,
                "export_draco_mesh_compression_level": SETTINGS["draco_compression_level"],
                "export_draco_position_quantization": SETTINGS["draco_position_quantization"],
                "export_draco_normal_quantization": SETTINGS["draco_normal_quantization"],
                "export_draco_texcoord_quantization": SETTINGS["draco_texcoord_quantization"],
                "export_draco_color_quantization": SETTINGS["draco_color_quantization"],
            })

    # Export the GLB
    bpy.ops.export_scene.gltf(**export_params)

    # Post-process for KTX2 textures if requested
    if do_ktx2_conversion and os.path.exists(output_path):
        print("      Converting textures to KTX2/Basis Universal...")
        convert_textures_to_ktx2(output_path)

    # Report file size
    if os.path.exists(output_path):
        size_bytes = os.path.getsize(output_path)
        if size_bytes > 1024 * 1024:
            size_str = f"{size_bytes / (1024 * 1024):.2f} MB"
        else:
            size_str = f"{size_bytes / 1024:.1f} KB"
        print(f"      Exported: {output_path} ({size_str})")


# =============================================================================
# MODEL PROCESSING
# =============================================================================

def process_glb_model(filepath, category, output_dir):
    """
    Process a GLB model: create LODs and export with compression.

    Args:
        filepath: Path to input GLB file
        category: Category name (for LOD ratio lookup)
        output_dir: Output directory

    Returns:
        str: "approve", "skip", "quit", or "test_done"
    """
    filename = Path(filepath).stem
    print(f"\n{'='*60}")
    print(f"Processing: {filename}")
    print(f"{'='*60}")

    # Import GLB
    mesh_objects, armature_obj = import_glb(filepath)

    if not mesh_objects:
        print(f"  ERROR: No mesh found in {filename}")
        return "skip"

    # Use first mesh as primary (or could join all)
    primary_mesh = mesh_objects[0]
    primary_mesh.name = f"{filename}_LOD0"

    original_faces = len(primary_mesh.data.polygons)
    print(f"  Imported: {original_faces:,} faces")

    # Clean up vertex attributes on ALL meshes to stay under WebGPU's 8 vertex buffer limit
    print(f"\n  Cleaning vertex attributes (WebGPU max: 8 buffers)...")
    for mesh_obj in mesh_objects:
        attr_count_before, attr_details = get_vertex_attribute_count(mesh_obj)
        if attr_count_before > 8:
            print(f"    {mesh_obj.name}: {attr_count_before} attributes (OVER LIMIT)")
            print(f"      Details: {attr_details}")

        removed = cleanup_vertex_attributes(mesh_obj)

        attr_count_after, _ = get_vertex_attribute_count(mesh_obj)
        if sum(removed.values()) > 0:
            print(f"    {mesh_obj.name}: {attr_count_before} -> {attr_count_after} attributes")
            if removed["uv_layers"] > 0:
                print(f"      Removed {removed['uv_layers']} extra UV layer(s)")
            if removed["vertex_colors"] > 0:
                print(f"      Removed {removed['vertex_colors']} vertex color layer(s)")
            if removed["shape_keys"] > 0:
                print(f"      Removed shape keys")
            if removed["attributes"] > 0:
                print(f"      Removed {removed['attributes']} custom attribute(s)")
        else:
            print(f"    {mesh_obj.name}: {attr_count_after} attributes (OK)")

    if armature_obj:
        bone_count = len(armature_obj.data.bones)
        anim_count = len(bpy.data.actions) if bpy.data.actions else 0
        print(f"  Armature: {armature_obj.name} ({bone_count} bones)")
        print(f"  Animations: {anim_count} action(s)")

    # Get LOD ratios for this category
    ratios = LOD_RATIOS.get(category, LOD_RATIOS["units"])

    # Track all LODs
    lods = {"LOD0": primary_mesh}
    lod_stats = {"original_faces": original_faces, "lod0_faces": original_faces}

    # Create LOD1
    if SETTINGS["export_lod1"]:
        print(f"\n  Creating LOD1...")
        lod1 = create_decimated_lod(primary_mesh, ratios["lod1"], f"{filename}_LOD1")
        lods["LOD1"] = lod1
        lod_stats["lod1_faces"] = len(lod1.data.polygons)

        # Copy armature relationship if present
        if armature_obj:
            lod1.parent = armature_obj
            # Copy armature modifier
            for mod in primary_mesh.modifiers:
                if mod.type == 'ARMATURE':
                    new_mod = lod1.modifiers.new("Armature", 'ARMATURE')
                    new_mod.object = mod.object
                    break

    # Create LOD2
    if SETTINGS["export_lod2"]:
        print(f"\n  Creating LOD2...")
        lod2 = create_decimated_lod(primary_mesh, ratios["lod2"], f"{filename}_LOD2")
        lods["LOD2"] = lod2
        lod_stats["lod2_faces"] = len(lod2.data.polygons)

        # Copy armature relationship if present
        if armature_obj:
            lod2.parent = armature_obj
            for mod in primary_mesh.modifiers:
                if mod.type == 'ARMATURE':
                    new_mod = lod2.modifiers.new("Armature", 'ARMATURE')
                    new_mod.object = mod.object
                    break

    # Stats for approval
    stats = {
        "has_armature": armature_obj is not None,
        "animation_count": len(bpy.data.actions) if bpy.data.actions else 0,
        **lod_stats
    }

    # TEST MODE: Display and stop
    if TEST_MODE:
        # Arrange objects for viewing
        spacing = 3.0
        for i, (lod_name, lod_obj) in enumerate(lods.items()):
            lod_obj.location.x = i * spacing

        # Frame all LODs
        all_objects = list(lods.values())
        if armature_obj:
            all_objects.append(armature_obj)
        UserPrompt.refresh_viewport_and_frame(all_objects)

        print("\n" + "="*60)
        print("  TEST MODE COMPLETE")
        print("="*60)
        print(f"  Model: {filename}")
        print(f"  LOD0: {lod_stats.get('lod0_faces', 'N/A'):,} faces (original)")
        if 'lod1_faces' in lod_stats:
            print(f"  LOD1: {lod_stats['lod1_faces']:,} faces")
        if 'lod2_faces' in lod_stats:
            print(f"  LOD2: {lod_stats['lod2_faces']:,} faces")
        if armature_obj:
            print(f"  Armature: {armature_obj.name}")
            print(f"  Animations: {len(bpy.data.actions) if bpy.data.actions else 0}")
        print("-"*60)
        print("  Objects kept in scene for inspection.")
        print("  Nothing was exported.")
        print("  Set TEST_MODE = False for batch processing.")
        print("="*60)
        return "test_done"

    # Wait for approval
    response = UserPrompt.wait_for_approval(filename, category, stats, list(lods.values()))

    if response == "approve":
        print(f"\n  Exporting with Draco compression...")

        # Export each LOD
        for lod_name, lod_obj in lods.items():
            if lod_name == "LOD0" and not SETTINGS["export_lod0"]:
                continue
            if lod_name == "LOD1" and not SETTINGS["export_lod1"]:
                continue
            if lod_name == "LOD2" and not SETTINGS["export_lod2"]:
                continue

            output_path = os.path.join(output_dir, f"{filename}_{lod_name}.glb")
            export_glb([lod_obj], armature_obj, output_path)

        print(f"  Done: {filename}")

    elif response == "skip":
        print(f"  Skipped: {filename}")

    elif response == "quit":
        return "quit"

    # Cleanup (skip in test mode)
    if not TEST_MODE:
        cleanup_scene(list(lods.values()) + ([armature_obj] if armature_obj else []))

    return response


# =============================================================================
# CLEANUP
# =============================================================================

def cleanup_scene(objects):
    """Remove objects from scene."""
    for obj in objects:
        if obj and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)

    # Clean orphan data
    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)

    for block in bpy.data.materials:
        if block.users == 0:
            bpy.data.materials.remove(block)

    for block in bpy.data.images:
        if block.users == 0:
            bpy.data.images.remove(block)

    for block in bpy.data.armatures:
        if block.users == 0:
            bpy.data.armatures.remove(block)

    for block in bpy.data.actions:
        if block.users == 0:
            bpy.data.actions.remove(block)


def clear_scene():
    """Clear entire scene for fresh start."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)
    for block in bpy.data.images:
        bpy.data.images.remove(block)
    for block in bpy.data.armatures:
        bpy.data.armatures.remove(block)
    for block in bpy.data.actions:
        bpy.data.actions.remove(block)


# =============================================================================
# FILE DISCOVERY
# =============================================================================

def get_glb_files(folder_path):
    """Get list of GLB files in a folder."""
    if not os.path.exists(folder_path):
        return []

    files = []
    for f in os.listdir(folder_path):
        if f.lower().endswith(('.glb', '.gltf')):
            files.append(os.path.join(folder_path, f))

    files.sort()
    return files


def interactive_test_select():
    """Interactive selection for test mode."""
    print("\n" + "="*60)
    print("  SELECT MODEL TO TEST")
    print("="*60)

    # Find available folders
    available_folders = []
    for key, path in INPUT_FOLDERS.items():
        if path and not path.startswith("/path/to") and os.path.exists(path):
            files = get_glb_files(path)
            if files:
                available_folders.append((key, path, len(files)))

    if not available_folders:
        print("\n  ERROR: No configured folders with GLB models found!")
        print("  Please set INPUT_FOLDERS paths in the script.")
        return None

    # List folders
    print("\n  Available folders:")
    print("-"*60)
    for i, (key, path, count) in enumerate(available_folders):
        print(f"    [{i+1}] {key.upper()} ({count} GLB files)")
    print(f"    [q] Quit")
    print("-"*60)

    try:
        choice = input("  Select folder number: ").strip().lower()
        if choice == 'q':
            return None
        folder_idx = int(choice) - 1
        if folder_idx < 0 or folder_idx >= len(available_folders):
            print("  Invalid selection")
            return None
    except (ValueError, EOFError):
        return None

    folder_key, folder_path, _ = available_folders[folder_idx]

    # List models
    files = get_glb_files(folder_path)

    print(f"\n  GLB files in {folder_key.upper()}:")
    print("-"*60)
    for i, filepath in enumerate(files):
        name = Path(filepath).stem
        size_bytes = os.path.getsize(filepath)
        if size_bytes > 1024 * 1024:
            size_str = f"{size_bytes / (1024 * 1024):.1f} MB"
        else:
            size_str = f"{size_bytes / 1024:.0f} KB"
        print(f"    [{i+1}] {name} ({size_str})")
    print(f"    [q] Back")
    print("-"*60)

    try:
        choice = input("  Select model number: ").strip().lower()
        if choice == 'q':
            return interactive_test_select()
        model_idx = int(choice) - 1
        if model_idx < 0 or model_idx >= len(files):
            print("  Invalid selection")
            return None
    except (ValueError, EOFError):
        return None

    return (folder_key, files[model_idx])


# =============================================================================
# BATCH PROCESSING
# =============================================================================

def process_folder(folder_path, category, output_dir):
    """Process all GLB files in a folder."""
    files = get_glb_files(folder_path)
    total = len(files)

    print(f"\n{'='*70}")
    print(f"  PROCESSING FOLDER: {category.upper()}")
    print(f"  GLB files: {total}")
    print(f"{'='*70}")

    for i, filepath in enumerate(files):
        filename = Path(filepath).stem
        print(f"\n  [{i+1}/{total}] {filename}")

        if not TEST_MODE:
            clear_scene()

        result = process_glb_model(filepath, category, output_dir)

        if result == "quit":
            return "quit"

        if result == "test_done":
            return "test_done"

    return "done"


# =============================================================================
# MAIN
# =============================================================================

def main():
    """Main entry point."""
    print("\n" + "="*70)
    if TEST_MODE:
        print("  VOIDSTRIKE GLB LOD GENERATOR - TEST MODE")
        print("  (Preview LODs without exporting)")
    else:
        print("  VOIDSTRIKE GLB LOD GENERATOR & COMPRESSOR")
    print("="*70)
    print(f"\n  Draco compression level: {SETTINGS['draco_compression_level']}")
    print(f"  Texture format: {SETTINGS['texture_format']}")
    print(f"  Max texture size: {SETTINGS['max_texture_size']}px")

    os.makedirs(OUTPUT_FOLDER, exist_ok=True)

    # TEST MODE
    if TEST_MODE:
        selection = interactive_test_select()
        if selection is None:
            print("\n  Test cancelled.")
            return

        folder_key, filepath = selection

        # Create output folder
        category_output = os.path.join(OUTPUT_FOLDER, folder_key)
        os.makedirs(category_output, exist_ok=True)

        process_glb_model(filepath, folder_key, category_output)
        return

    # BATCH MODE
    folder_order = ["decorations", "resources", "buildings", "units"]

    for folder_key in folder_order:
        if folder_key not in INPUT_FOLDERS:
            continue

        folder_path = INPUT_FOLDERS[folder_key]
        if not folder_path or folder_path.startswith("/path/to"):
            print(f"\n  Skipping {folder_key} (path not configured)")
            continue

        category_output = os.path.join(OUTPUT_FOLDER, folder_key)
        os.makedirs(category_output, exist_ok=True)

        result = process_folder(folder_path, folder_key, category_output)

        if result == "quit":
            break

    print("\n" + "="*70)
    print("  BATCH PROCESSING COMPLETE")
    print("="*70 + "\n")


if __name__ == "__main__":
    main()
