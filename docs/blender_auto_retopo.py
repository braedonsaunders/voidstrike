"""
VOIDSTRIKE GLB LOD Generator & Compressor
==========================================
Takes pre-optimized GLB models (500-5000 polys) and generates LOD levels
with aggressive Draco compression to reduce file sizes from ~15MB to ~500KB.

INPUT: GLB files (already at correct LOD0 poly count)
OUTPUT: LOD0, LOD1, LOD2 GLB files with Draco compression

FEATURES:
- Batch processes folders of GLB files
- Creates LOD1/LOD2 via decimation (no remeshing needed)
- Aggressive Draco mesh compression for tiny file sizes
- WebP texture compression
- Optional texture downscaling
- Preview mode to inspect LODs before export
- Preserves armatures and animations

SETUP:
1. Set INPUT_FOLDERS to your model folders
2. Set OUTPUT_FOLDER for processed models
3. Run in Blender

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
    # Draco compression settings (aggressive for small files)
    "draco_compression_level": 10,      # 0-10, higher = more compression (slower)
    "draco_position_quantization": 14,  # 0-30, lower = more compression (less precision)
    "draco_normal_quantization": 10,    # 0-30
    "draco_texcoord_quantization": 12,  # 0-30
    "draco_color_quantization": 10,     # 0-30

    # Texture settings
    "texture_format": "WEBP",           # WEBP for best compression, or JPEG/PNG
    "texture_quality": 80,              # 0-100 for WEBP/JPEG
    "downscale_textures": True,         # Downscale large textures
    "max_texture_size": 1024,           # Max texture dimension when downscaling

    # Processing options
    "auto_approve": False,              # Set True to skip approval prompts
    "export_lod0": True,                # Export LOD0 (original, just compressed)
    "export_lod1": True,                # Export LOD1
    "export_lod2": True,                # Export LOD2
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

    new_faces = len(lod.data.polygons)
    print(f"      Decimated: {original_faces:,} -> {new_faces:,} faces ({ratio:.0%})")

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


def export_glb(objects, armature, output_path):
    """
    Export objects as GLB with aggressive Draco compression.

    Args:
        objects: List of mesh objects to export
        armature: Armature object (or None)
        output_path: Output file path
    """
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

    # Export with Draco compression
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        use_selection=True,
        export_format='GLB',

        # Draco mesh compression (key for small file sizes)
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=SETTINGS["draco_compression_level"],
        export_draco_position_quantization=SETTINGS["draco_position_quantization"],
        export_draco_normal_quantization=SETTINGS["draco_normal_quantization"],
        export_draco_texcoord_quantization=SETTINGS["draco_texcoord_quantization"],
        export_draco_color_quantization=SETTINGS["draco_color_quantization"],

        # Texture compression
        export_image_format=SETTINGS["texture_format"],

        # Material export
        export_materials='EXPORT',

        # Animation (preserve if present)
        export_animations=True,
        export_animation_mode='ACTIONS',

        # Other optimizations
        export_apply=True,  # Apply modifiers
    )

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
