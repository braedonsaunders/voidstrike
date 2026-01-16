"""
VOIDSTRIKE Animation Renamer
=============================
Batch renames animations in GLB models to use semantic names (idle, walk, attack, death).

This script addresses the common issue where animations from Tripo3D, Meshy, or other
AI model generators have generic names like "NlaTrack", "NlaTrack.001", etc.

MODES:
1. INTERACTIVE - View each animation visually and assign names manually
2. BY_INDEX - Automatically rename based on position (assumes consistent ordering)
3. PREVIEW - Just show what animations exist without modifying

SETUP:
1. Set INPUT_FOLDER to your models folder
2. Set OUTPUT_FOLDER for renamed models (or same as input to overwrite)
3. Choose RENAME_MODE
4. Run in Blender

USAGE:
1. Open Blender (fresh scene recommended)
2. Window → Toggle System Console (to see prompts/output)
3. Open this script in Text Editor
4. Adjust settings below
5. Click "Run Script"
"""

import bpy
import os
import json
from pathlib import Path

# =============================================================================
# CONFIGURATION
# =============================================================================

# Input folder containing GLB models
INPUT_FOLDER = "/path/to/your/models/"

# Output folder (set same as INPUT_FOLDER to overwrite originals)
OUTPUT_FOLDER = "/path/to/output/"

# Rename mode: "INTERACTIVE", "BY_INDEX", or "PREVIEW"
RENAME_MODE = "INTERACTIVE"

# For BY_INDEX mode: what names to assign to each animation index
# Adjust based on how many animations your models typically have
INDEX_TO_NAME = {
    0: "idle",
    1: "walk",
    2: "attack",
    3: "death",
}

# For models with different animation counts, you can specify per-count mappings
# e.g., models with 3 animations might be: idle, walk, attack (no death)
INDEX_MAPPINGS_BY_COUNT = {
    1: {0: "idle"},
    2: {0: "idle", 1: "walk"},
    3: {0: "idle", 1: "walk", 2: "attack"},
    4: {0: "idle", 1: "walk", 2: "attack", 3: "death"},
    5: {0: "idle", 1: "walk", 2: "run", 3: "attack", 4: "death"},
}

# Export settings
EXPORT_SETTINGS = {
    "draco_compression": True,
    "draco_compression_level": 6,
}

# =============================================================================
# HELPER FUNCTIONS
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
    """Import a GLB file and return imported objects."""
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


def get_animation_info(armature_obj):
    """
    Get animation information from an armature.

    Returns list of dicts with animation details.
    The animation "name" that will be exported to glTF is the ACTION name,
    not the NLA track name.
    """
    animations = []

    if not armature_obj:
        return animations

    # Method 1: Check NLA tracks and their strips
    if armature_obj.animation_data and armature_obj.animation_data.nla_tracks:
        for track_idx, track in enumerate(armature_obj.animation_data.nla_tracks):
            for strip in track.strips:
                if strip.action:
                    action = strip.action
                    animations.append({
                        "index": len(animations),
                        "name": action.name,
                        "track_name": track.name,
                        "strip_name": strip.name,
                        "frame_start": int(action.frame_range[0]),
                        "frame_end": int(action.frame_range[1]),
                        "frame_count": int(action.frame_range[1] - action.frame_range[0]),
                        "action": action,
                        "track": track,
                        "strip": strip,
                    })

    # Method 2: If no NLA tracks, check for direct action assignment
    if not animations and armature_obj.animation_data and armature_obj.animation_data.action:
        action = armature_obj.animation_data.action
        animations.append({
            "index": 0,
            "name": action.name,
            "track_name": None,
            "strip_name": None,
            "frame_start": int(action.frame_range[0]),
            "frame_end": int(action.frame_range[1]),
            "frame_count": int(action.frame_range[1] - action.frame_range[0]),
            "action": action,
            "track": None,
            "strip": None,
        })

    # Method 3: Check all actions in the file (backup)
    if not animations:
        for action in bpy.data.actions:
            # Skip actions that don't seem to belong to this armature
            # (heuristic: check if action has bone channels)
            has_bone_channels = False
            for fcurve in action.fcurves:
                if fcurve.data_path.startswith('pose.bones'):
                    has_bone_channels = True
                    break

            if has_bone_channels:
                animations.append({
                    "index": len(animations),
                    "name": action.name,
                    "track_name": None,
                    "strip_name": None,
                    "frame_start": int(action.frame_range[0]),
                    "frame_end": int(action.frame_range[1]),
                    "frame_count": int(action.frame_range[1] - action.frame_range[0]),
                    "action": action,
                    "track": None,
                    "strip": None,
                })

    return animations


def rename_animation(anim_info, new_name):
    """
    Rename an animation's action (which becomes the glTF animation name).
    """
    action = anim_info["action"]
    old_name = action.name
    action.name = new_name
    print(f"    Renamed: '{old_name}' -> '{new_name}'")
    return True


def play_animation(armature_obj, anim_info):
    """Play an animation for visual preview."""
    if not armature_obj or not anim_info["action"]:
        return

    # Set the action as active
    if armature_obj.animation_data is None:
        armature_obj.animation_data_create()

    armature_obj.animation_data.action = anim_info["action"]

    # Set frame range
    bpy.context.scene.frame_start = anim_info["frame_start"]
    bpy.context.scene.frame_end = anim_info["frame_end"]
    bpy.context.scene.frame_set(anim_info["frame_start"])

    # Start playback
    bpy.ops.screen.animation_play()


def stop_animation():
    """Stop animation playback."""
    bpy.ops.screen.animation_cancel()


def export_glb(output_path):
    """Export scene as GLB with compression."""
    bpy.ops.object.select_all(action='SELECT')

    export_args = {
        "filepath": output_path,
        "use_selection": True,
        "export_format": 'GLB',
        "export_animations": True,
        "export_animation_mode": 'ACTIONS',
    }

    if EXPORT_SETTINGS.get("draco_compression"):
        export_args["export_draco_mesh_compression_enable"] = True
        export_args["export_draco_mesh_compression_level"] = EXPORT_SETTINGS.get("draco_compression_level", 6)

    bpy.ops.export_scene.gltf(**export_args)
    print(f"    Exported: {output_path}")


# =============================================================================
# RENAME MODES
# =============================================================================

def preview_animations(filepath):
    """Preview mode - just show what animations exist."""
    filename = Path(filepath).stem
    print(f"\n  {filename}:")

    clear_scene()
    mesh_objects, armature_obj = import_glb(filepath)

    animations = get_animation_info(armature_obj)

    if not animations:
        print("    (no animations)")
        return

    for anim in animations:
        frames = f"{anim['frame_start']}-{anim['frame_end']} ({anim['frame_count']} frames)"
        print(f"    [{anim['index']}] {anim['name']} | {frames}")


def rename_by_index(filepath, output_folder):
    """Automatically rename animations by index position."""
    filename = Path(filepath).stem
    print(f"\n  Processing: {filename}")

    clear_scene()
    mesh_objects, armature_obj = import_glb(filepath)

    animations = get_animation_info(armature_obj)

    if not animations:
        print("    (no animations, skipping)")
        return

    # Get the appropriate mapping based on animation count
    anim_count = len(animations)
    mapping = INDEX_MAPPINGS_BY_COUNT.get(anim_count, INDEX_TO_NAME)

    print(f"    Found {anim_count} animations, using mapping for count={anim_count}")

    renamed_count = 0
    for anim in animations:
        idx = anim["index"]
        if idx in mapping:
            new_name = mapping[idx]
            if anim["name"] != new_name:
                rename_animation(anim, new_name)
                renamed_count += 1
            else:
                print(f"    [{idx}] '{anim['name']}' (already correct)")
        else:
            print(f"    [{idx}] '{anim['name']}' (no mapping, keeping)")

    if renamed_count > 0:
        output_path = os.path.join(output_folder, f"{filename}.glb")
        export_glb(output_path)
    else:
        print("    No changes needed")


def rename_interactive(filepath, output_folder):
    """Interactive mode - view each animation and assign names manually."""
    filename = Path(filepath).stem
    print(f"\n{'='*60}")
    print(f"  MODEL: {filename}")
    print(f"{'='*60}")

    clear_scene()
    mesh_objects, armature_obj = import_glb(filepath)

    animations = get_animation_info(armature_obj)

    if not animations:
        print("  (no animations, skipping)")
        return "continue"

    # Frame camera on the model
    bpy.ops.object.select_all(action='DESELECT')
    for obj in mesh_objects:
        obj.select_set(True)
    if armature_obj:
        armature_obj.select_set(True)

    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            for region in area.regions:
                if region.type == 'WINDOW':
                    with bpy.context.temp_override(area=area, region=region):
                        bpy.ops.view3d.view_selected()
                    break

    print(f"\n  Found {len(animations)} animations:")
    print("-"*60)

    renamed_any = False

    for anim in animations:
        frames = f"{anim['frame_start']}-{anim['frame_end']} ({anim['frame_count']} frames)"
        print(f"\n  Animation [{anim['index']}]: '{anim['name']}'")
        print(f"  Frames: {frames}")
        print("-"*40)
        print("  Commands:")
        print("    [i] = idle    [w] = walk    [a] = attack    [d] = death")
        print("    [k] = keep current name")
        print("    [p] = play animation (press any key to stop)")
        print("    [s] = skip this model    [q] = quit")
        print("-"*40)

        while True:
            try:
                choice = input(f"  Rename '{anim['name']}' to: ").strip().lower()
            except EOFError:
                print("  (No console input, keeping name)")
                break

            if choice == 'p':
                print("  Playing animation... (press Enter to stop)")
                play_animation(armature_obj, anim)
                input()
                stop_animation()
                continue
            elif choice == 'i':
                rename_animation(anim, 'idle')
                renamed_any = True
                break
            elif choice == 'w':
                rename_animation(anim, 'walk')
                renamed_any = True
                break
            elif choice == 'a':
                rename_animation(anim, 'attack')
                renamed_any = True
                break
            elif choice == 'd':
                rename_animation(anim, 'death')
                renamed_any = True
                break
            elif choice == 'k' or choice == '':
                print(f"    Keeping: '{anim['name']}'")
                break
            elif choice == 's':
                print("  Skipping model...")
                return "continue"
            elif choice == 'q':
                return "quit"
            else:
                # Custom name
                if len(choice) > 0:
                    rename_animation(anim, choice)
                    renamed_any = True
                    break

    if renamed_any:
        output_path = os.path.join(output_folder, f"{filename}.glb")
        export_glb(output_path)
    else:
        print("\n  No changes made, skipping export")

    return "continue"


# =============================================================================
# MAIN
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


def main():
    print("\n" + "="*70)
    print("  VOIDSTRIKE ANIMATION RENAMER")
    print(f"  Mode: {RENAME_MODE}")
    print("="*70)

    if INPUT_FOLDER.startswith("/path/to"):
        print("\n  ERROR: Please configure INPUT_FOLDER in the script!")
        return

    if not os.path.exists(INPUT_FOLDER):
        print(f"\n  ERROR: Input folder not found: {INPUT_FOLDER}")
        return

    files = get_glb_files(INPUT_FOLDER)
    print(f"\n  Found {len(files)} GLB files in: {INPUT_FOLDER}")

    if not files:
        return

    # Create output folder
    if RENAME_MODE != "PREVIEW":
        os.makedirs(OUTPUT_FOLDER, exist_ok=True)

    # Process based on mode
    if RENAME_MODE == "PREVIEW":
        print("\n  PREVIEW MODE - Showing animations without modifying:")
        print("-"*60)
        for filepath in files:
            preview_animations(filepath)

    elif RENAME_MODE == "BY_INDEX":
        print("\n  BY_INDEX MODE - Auto-renaming by position:")
        print("-"*60)
        for filepath in files:
            rename_by_index(filepath, OUTPUT_FOLDER)

    elif RENAME_MODE == "INTERACTIVE":
        print("\n  INTERACTIVE MODE - Visual review and rename:")
        print("-"*60)
        for filepath in files:
            result = rename_interactive(filepath, OUTPUT_FOLDER)
            if result == "quit":
                print("\n  Quitting...")
                break

    print("\n" + "="*70)
    print("  DONE!")
    print("="*70 + "\n")


if __name__ == "__main__":
    main()
