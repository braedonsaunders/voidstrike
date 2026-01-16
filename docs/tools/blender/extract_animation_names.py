"""
VOIDSTRIKE Animation Name Extractor
====================================
Scans GLB/GLTF models and extracts all animation names.
Outputs a report of models with their associated animations.

SETUP:
1. Set INPUT_FOLDERS to your model folders
2. Run in Blender

USAGE:
1. Open Blender (fresh scene recommended)
2. Window → Toggle System Console (to see output)
3. Open this script in Text Editor
4. Adjust INPUT_FOLDERS below
5. Click "Run Script"

OUTPUT:
- Console output with all animations per model
- Optional JSON file with structured data
"""

import bpy
import os
import json
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

# Output JSON file (set to None to disable JSON output)
OUTPUT_JSON = "/path/to/output/animations.json"

# =============================================================================
# GLB IMPORT
# =============================================================================

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


def import_glb(filepath):
    """
    Import a GLB file.

    Returns:
        tuple: (mesh_objects, armature_obj)
    """
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.import_scene.gltf(filepath=filepath)

    mesh_objects = []
    armature_obj = None

    for obj in bpy.context.selected_objects:
        if obj.type == 'MESH':
            mesh_objects.append(obj)
        elif obj.type == 'ARMATURE':
            armature_obj = obj

    return mesh_objects, armature_obj


def get_animation_names():
    """
    Get all animation/action names currently loaded in Blender.

    Returns:
        list: List of animation names
    """
    animations = []

    if bpy.data.actions:
        for action in bpy.data.actions:
            animations.append(action.name)

    return sorted(animations)


def get_animation_details():
    """
    Get detailed information about all animations.

    Returns:
        list: List of dicts with animation details
    """
    details = []

    if bpy.data.actions:
        for action in bpy.data.actions:
            frame_start = action.frame_range[0]
            frame_end = action.frame_range[1]
            frame_count = int(frame_end - frame_start)

            details.append({
                "name": action.name,
                "frame_start": int(frame_start),
                "frame_end": int(frame_end),
                "frame_count": frame_count,
            })

    return details


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


# =============================================================================
# MAIN PROCESSING
# =============================================================================

def extract_animations_from_model(filepath):
    """
    Extract animation names from a single model.

    Args:
        filepath: Path to GLB/GLTF file

    Returns:
        dict: Model info with animations
    """
    filename = Path(filepath).stem

    # Clear scene and import
    clear_scene()
    mesh_objects, armature_obj = import_glb(filepath)

    # Get animation info
    animations = get_animation_details()

    return {
        "filename": filename,
        "filepath": filepath,
        "has_armature": armature_obj is not None,
        "armature_name": armature_obj.name if armature_obj else None,
        "bone_count": len(armature_obj.data.bones) if armature_obj else 0,
        "animation_count": len(animations),
        "animations": animations,
    }


def process_folder(folder_path, category):
    """
    Process all GLB files in a folder.

    Args:
        folder_path: Path to folder
        category: Category name

    Returns:
        list: List of model info dicts (only models with animations)
    """
    files = get_glb_files(folder_path)
    results = []

    print(f"\n{'='*60}")
    print(f"  SCANNING: {category.upper()}")
    print(f"  Files: {len(files)}")
    print(f"{'='*60}")

    for i, filepath in enumerate(files):
        filename = Path(filepath).stem
        print(f"  [{i+1}/{len(files)}] {filename}...", end=" ")

        try:
            info = extract_animations_from_model(filepath)

            if info["animation_count"] > 0:
                print(f"✓ {info['animation_count']} animation(s)")
                results.append(info)
            else:
                print("(no animations)")
        except Exception as e:
            print(f"ERROR: {e}")

    return results


def main():
    """Main entry point."""
    print("\n" + "="*70)
    print("  VOIDSTRIKE ANIMATION NAME EXTRACTOR")
    print("="*70)

    all_results = {}
    total_models_with_anims = 0
    total_animations = 0

    folder_order = ["buildings", "decorations", "resources", "units"]

    for folder_key in folder_order:
        if folder_key not in INPUT_FOLDERS:
            continue

        folder_path = INPUT_FOLDERS[folder_key]
        if not folder_path or folder_path.startswith("/path/to"):
            print(f"\n  Skipping {folder_key} (path not configured)")
            continue

        if not os.path.exists(folder_path):
            print(f"\n  Skipping {folder_key} (folder not found: {folder_path})")
            continue

        results = process_folder(folder_path, folder_key)

        if results:
            all_results[folder_key] = results
            total_models_with_anims += len(results)
            total_animations += sum(r["animation_count"] for r in results)

    # Print summary
    print("\n" + "="*70)
    print("  ANIMATION SUMMARY")
    print("="*70)

    if not all_results:
        print("\n  No models with animations found.")
        print("  Make sure INPUT_FOLDERS paths are configured correctly.")
        return

    for category, models in all_results.items():
        print(f"\n  {category.upper()}:")
        print(f"  {'-'*50}")

        for model in models:
            print(f"\n    {model['filename']}:")
            if model['armature_name']:
                print(f"      Armature: {model['armature_name']} ({model['bone_count']} bones)")

            for anim in model['animations']:
                duration_info = f"frames {anim['frame_start']}-{anim['frame_end']}"
                print(f"      - {anim['name']} ({duration_info})")

    print(f"\n{'='*70}")
    print(f"  TOTALS:")
    print(f"    Models with animations: {total_models_with_anims}")
    print(f"    Total animations: {total_animations}")
    print(f"{'='*70}")

    # Export to JSON if configured
    if OUTPUT_JSON and not OUTPUT_JSON.startswith("/path/to"):
        output_data = {
            "summary": {
                "models_with_animations": total_models_with_anims,
                "total_animations": total_animations,
            },
            "categories": all_results,
        }

        # Create output directory if needed
        os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)

        with open(OUTPUT_JSON, 'w') as f:
            json.dump(output_data, f, indent=2)

        print(f"\n  JSON output saved to: {OUTPUT_JSON}")

    print("\n  Done!\n")


if __name__ == "__main__":
    main()
