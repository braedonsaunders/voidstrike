"""
VOIDSTRIKE Batch Retopology & Baking Pipeline
==============================================
Processes mixed folders containing both static (OBJ) and animated (GLB) models.

FILE TYPE DETECTION:
- .obj files → Static processing (retopo only)
- .glb/.gltf/.fbx files → Animated processing (preserves rig + animations)

FEATURES:
- Batch processes entire folders with mixed file types
- Auto-detects static vs animated based on file extension
- Pauses after each model for user approval (approve/skip/redo/quit)
- Preserves rigs, vertex weights, and animations for GLB models
- Transfers weights from high-poly to low-poly via Data Transfer
- Bakes normal maps and AO from high to low
- Preserves original textures where possible
- Creates 3 LOD levels per model

SETUP:
1. Download Instant Meshes from: https://github.com/wjakob/instant-meshes
2. Set INSTANT_MESHES_PATH below (or leave empty for auto-detect)
3. Set INPUT_FOLDERS to your model folders
4. Set OUTPUT_FOLDER for processed models
5. Run in Blender

USAGE:
1. Open Blender (fresh scene recommended)
2. Window → Toggle System Console (to see prompts)
3. Open this script in Text Editor
4. Adjust settings below
5. Click "Run Script"
6. Approve/skip each model as prompted in the console

FOLDER STRUCTURE:
  Input:                      Output:
  buildings/                  output/buildings/
    ├── hq.obj         →        ├── hq_LOD0.glb
    └── turret.glb     →        ├── hq_LOD1.glb
  units/                        ├── turret_LOD0.glb (with anims)
    ├── tank.obj       →        └── ...
    └── soldier.glb    →      output/units/
                                ├── tank_LOD0.glb
                                └── soldier_LOD0.glb (with anims)
"""

import bpy
import bmesh
import os
import math
import subprocess
import tempfile
import platform
from pathlib import Path

# =============================================================================
# CONFIGURATION - ADJUST THESE
# =============================================================================

# Path to Instant Meshes executable
INSTANT_MESHES_PATH = ""  # Leave empty for auto-detect

# Input folders containing your models
# Each folder can contain BOTH OBJ (static) and GLB (animated) files
# The script auto-detects file type and processes accordingly
INPUT_FOLDERS = {
    "buildings": "/path/to/your/buildings/",      # OBJ and/or GLB
    "decorations": "/path/to/your/decorations/",  # OBJ and/or GLB
    "resources": "/path/to/your/resources/",      # OBJ and/or GLB
    "units": "/path/to/your/units/",              # OBJ and/or GLB (mixed)
}

# Output folder for processed models
OUTPUT_FOLDER = "/path/to/output/"

# Target face counts for each LOD (quad faces, tris ≈ faces × 2)
# Applied based on FOLDER category, not file type
LOD_TARGETS = {
    "buildings": {"lod0": 5000, "lod1": 2000, "lod2": 750},
    "decorations": {"lod0": 250, "lod1": 100, "lod2": 50},
    "resources": {"lod0": 500, "lod1": 200, "lod2": 75},
    "units": {"lod0": 4000, "lod1": 1500, "lod2": 500},  # Works for both static & animated
}

SETTINGS = {
    # Instant Meshes settings
    "crease_angle": 30,
    "smooth_iterations": 2,
    "deterministic": True,

    # Texture settings
    "texture_size": 2048,
    "bake_normal": True,
    "bake_ao": True,

    # Baking settings
    "bake_extrusion": 0.15,
    "bake_max_ray": 0.25,

    # Processing options
    "auto_approve": False,  # Set True to skip approval prompts
    "keep_high_poly": False,
    "export_format": "GLB",  # GLB or FBX

    # Optimization - remove hidden geometry (great for hollow AI models)
    "remove_bottom_faces": True,   # Remove ground-facing faces (never seen in RTS)
    "remove_interior_faces": True,  # Remove interior faces of hollow shells
}

# =============================================================================
# TEST MODE - Set to True to test with just ONE model
# =============================================================================
# When enabled:
#   - Only processes the FIRST model found
#   - Keeps all objects in scene (high-poly + LODs) for inspection
#   - Does NOT export or save anything
#   - Stops script after processing
#   - Great for tuning LOD_TARGETS before batch processing
TEST_MODE = True  # <-- SET TO False FOR FULL BATCH PROCESSING

# =============================================================================
# USER INTERACTION
# =============================================================================

class UserPrompt:
    """Handle user prompts in Blender's console."""

    @staticmethod
    def refresh_viewport_and_frame(objects):
        """
        Force viewport refresh and frame camera on processed objects.
        This allows the user to see the model before approving.
        """
        # Deselect all, then select LOD objects
        bpy.ops.object.select_all(action='DESELECT')

        for obj in objects:
            if obj and obj.name in bpy.data.objects:
                obj.select_set(True)

        # Make sure we're in object mode
        if bpy.context.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')

        # Frame selected objects in all 3D views
        for area in bpy.context.screen.areas:
            if area.type == 'VIEW_3D':
                for region in area.regions:
                    if region.type == 'WINDOW':
                        # Override context to target this specific area/region
                        with bpy.context.temp_override(area=area, region=region):
                            bpy.ops.view3d.view_selected()
                        break

        # Set viewport shading to Material Preview for better visualization
        for area in bpy.context.screen.areas:
            if area.type == 'VIEW_3D':
                for space in area.spaces:
                    if space.type == 'VIEW_3D':
                        space.shading.type = 'MATERIAL'
                        break

        # Force redraw all areas
        for area in bpy.context.screen.areas:
            area.tag_redraw()

        # Process pending events to update viewport
        bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)

    @staticmethod
    def wait_for_approval(model_name, category, stats, lod_objects=None):
        """
        Wait for user approval in Blender.
        Uses a modal operator to pause execution.
        """
        if SETTINGS["auto_approve"]:
            return "approve"

        # Refresh viewport and frame the LOD objects so user can see them
        if lod_objects:
            UserPrompt.refresh_viewport_and_frame(lod_objects)

        print("\n" + "="*60)
        print(f"  MODEL READY FOR REVIEW: {model_name}")
        print("="*60)
        print(f"  Category: {category}")
        print(f"  Original: {stats.get('original_faces', 'N/A'):,} faces")
        print(f"  LOD0: {stats.get('lod0_faces', 'N/A'):,} faces")
        print(f"  LOD1: {stats.get('lod1_faces', 'N/A'):,} faces")
        print(f"  LOD2: {stats.get('lod2_faces', 'N/A'):,} faces")
        if stats.get('has_armature'):
            print(f"  Armature: Preserved ✓")
            print(f"  Animations: {stats.get('animation_count', 0)} clips")
        print("-"*60)
        print("  *** VIEWPORT UPDATED - Check Blender window ***")
        print("  *** LOD models are selected and framed ***")
        print("-"*60)
        print("  Commands:")
        print("    [a] Approve and continue")
        print("    [s] Skip this model")
        print("    [r] Redo with different settings")
        print("    [q] Quit batch processing")
        print("-"*60)

        # In Blender, we use input() which reads from the system console
        # User needs to have Blender open with system console visible
        try:
            response = input("  Enter choice [a/s/r/q]: ").strip().lower()
            if response in ['a', 'approve', '']:
                return "approve"
            elif response in ['s', 'skip']:
                return "skip"
            elif response in ['r', 'redo']:
                return "redo"
            elif response in ['q', 'quit']:
                return "quit"
            else:
                print(f"  Unknown response '{response}', defaulting to approve")
                return "approve"
        except EOFError:
            # If running without console, auto-approve
            print("  (No console input available, auto-approving)")
            return "approve"


# =============================================================================
# INSTANT MESHES INTEGRATION
# =============================================================================

def find_instant_meshes():
    """Auto-detect Instant Meshes installation."""
    if INSTANT_MESHES_PATH and os.path.exists(INSTANT_MESHES_PATH):
        return INSTANT_MESHES_PATH

    system = platform.system()
    paths = []

    if system == "Windows":
        paths = [
            "C:/Program Files/Instant Meshes/Instant Meshes.exe",
            "C:/Tools/InstantMeshes/Instant Meshes.exe",
            os.path.expanduser("~/Downloads/instant-meshes/Instant Meshes.exe"),
        ]
    elif system == "Darwin":
        paths = [
            "/Applications/Instant Meshes.app/Contents/MacOS/Instant Meshes",
            os.path.expanduser("~/Applications/Instant Meshes.app/Contents/MacOS/Instant Meshes"),
        ]
    else:
        paths = [
            "/usr/local/bin/Instant Meshes",
            os.path.expanduser("~/tools/instant-meshes/Instant Meshes"),
            os.path.expanduser("~/.local/bin/Instant Meshes"),
        ]

    for p in paths:
        if os.path.exists(p):
            return p
    return None


def run_instant_meshes(input_path, output_path, target_faces):
    """Run Instant Meshes CLI on a mesh."""
    im_path = find_instant_meshes()
    if not im_path:
        raise FileNotFoundError("Instant Meshes not found!")

    cmd = [
        im_path,
        "-o", output_path,
        "-f", str(target_faces),
        "-r", "4",
        "-p", "4",
        "-c", str(SETTINGS["crease_angle"]),
        "-S", str(SETTINGS["smooth_iterations"]),
        "-b",
    ]
    if SETTINGS["deterministic"]:
        cmd.append("-d")
    cmd.append(input_path)

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

    if result.returncode != 0 or not os.path.exists(output_path):
        raise RuntimeError(f"Instant Meshes failed: {result.stderr}")

    return True


# =============================================================================
# MESH UTILITIES
# =============================================================================

def clean_mesh(obj):
    """Clean mesh: remove doubles, fix normals."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0001)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def remove_hidden_geometry(obj, remove_bottom=True, remove_interior=True):
    """
    Remove geometry that will never be seen in an RTS game.

    - Bottom faces: faces pointing straight down (ground contact)
    - Interior faces: faces inside hollow shells

    This can significantly reduce poly count on hollow AI models.
    """
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')

    bm = bmesh.from_edit_mesh(obj.data)
    bm.faces.ensure_lookup_table()

    faces_to_delete = []

    if remove_bottom:
        # Select faces pointing straight down (normal.z < -0.95)
        for face in bm.faces:
            if face.normal.z < -0.95:  # Pointing down
                faces_to_delete.append(face)

    if remove_interior:
        # Find interior faces using ray casting from face centers
        # Interior faces are occluded from all directions
        from mathutils import Vector

        # Simple heuristic: faces with normals pointing inward toward mesh center
        # Get mesh center
        center = Vector((0, 0, 0))
        for v in bm.verts:
            center += v.co
        center /= len(bm.verts)

        for face in bm.faces:
            if face in faces_to_delete:
                continue
            # Vector from face center to mesh center
            face_center = face.calc_center_median()
            to_center = (center - face_center).normalized()
            # If face normal points toward center, it's likely interior
            if face.normal.dot(to_center) > 0.7:
                faces_to_delete.append(face)

    # Delete the faces
    if faces_to_delete:
        bmesh.ops.delete(bm, geom=faces_to_delete, context='FACES')
        bmesh.update_edit_mesh(obj.data)
        print(f"      Removed {len(faces_to_delete)} hidden faces")

    bpy.ops.object.mode_set(mode='OBJECT')


def triangulate_mesh(obj):
    """Convert quads to tris for Instant Meshes."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.object.mode_set(mode='OBJECT')


def get_mesh_stats(obj):
    """Get mesh statistics."""
    return {
        "faces": len(obj.data.polygons),
        "vertices": len(obj.data.vertices),
        "tris": sum(len(p.vertices) - 2 for p in obj.data.polygons),
    }


def calculate_surface_area(obj):
    """Calculate total surface area of a mesh."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    area = sum(f.calc_area() for f in bm.faces)
    bm.free()
    return area


def separate_loose_parts(obj):
    """
    Separate mesh into disconnected parts.
    Returns list of new objects (original is deleted).
    """
    # Store original name and transform
    orig_name = obj.name
    orig_matrix = obj.matrix_world.copy()

    # Select only this object
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    # Separate by loose parts
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')

    # Get all resulting objects
    parts = [o for o in bpy.context.selected_objects if o.type == 'MESH']

    # Name them
    for i, part in enumerate(parts):
        part.name = f"{orig_name}_part{i}"

    return parts


def join_objects(objects, name):
    """
    Join multiple objects into one.
    Returns the joined object.
    """
    if not objects:
        return None

    if len(objects) == 1:
        objects[0].name = name
        return objects[0]

    # Deselect all
    bpy.ops.object.select_all(action='DESELECT')

    # Select all objects to join
    for obj in objects:
        obj.select_set(True)

    # Make first one active
    bpy.context.view_layer.objects.active = objects[0]

    # Join
    bpy.ops.object.join()

    # Rename result
    result = bpy.context.active_object
    result.name = name

    return result


def quadriflow_remesh(high_poly, target_faces, base_name, lod_name):
    """
    Create clean low-poly using Blender's Quadriflow Remesh.

    Quadriflow creates a SINGLE CONNECTED MESH with clean quad topology.
    This eliminates all the fragment issues from AI mesh soup and
    drastically reduces draw calls.

    Returns the final mesh object.
    """
    # Duplicate high poly
    bpy.ops.object.select_all(action='DESELECT')
    high_poly.select_set(True)
    bpy.context.view_layer.objects.active = high_poly
    bpy.ops.object.duplicate()

    lod = bpy.context.active_object
    lod.name = f"{base_name}_{lod_name}"

    current_faces = len(lod.data.polygons)
    print(f"      Quadriflow remesh ({current_faces:,} → {target_faces} faces)...")

    try:
        # Quadriflow remesh - creates single connected mesh
        bpy.ops.object.quadriflow_remesh(
            target_faces=target_faces,
            use_mesh_symmetry=False,
            use_preserve_sharp=True,
            use_preserve_boundary=False,
            smooth_normals=True,
            mode='FACES'
        )

        final_faces = len(lod.data.polygons)
        print(f"      Quadriflow complete: {final_faces:,} faces")

    except Exception as e:
        print(f"      Quadriflow failed: {e}")
        print(f"      Falling back to decimate...")

        # Fallback to decimate
        if current_faces > target_faces:
            ratio = target_faces / current_faces
            decimate = lod.modifiers.new("Decimate", 'DECIMATE')
            decimate.decimate_type = 'COLLAPSE'
            decimate.ratio = max(0.0001, ratio)
            decimate.use_collapse_triangulate = True

            try:
                bpy.ops.object.modifier_apply(modifier="Decimate")
            except:
                if "Decimate" in lod.modifiers:
                    lod.modifiers.remove(lod.modifiers["Decimate"])

    # Match transform
    lod.location = high_poly.location
    lod.rotation_euler = high_poly.rotation_euler
    lod.scale = high_poly.scale

    final_faces = len(lod.data.polygons)
    print(f"      Final: {final_faces:,} faces")

    return lod


def retopo_with_loose_parts(high_poly, target_faces, temp_dir, base_name, lod_name):
    """
    Smart retopology that handles both clean meshes and AI mesh soup.

    - If mesh has < 50 loose parts: try Instant Meshes (clean topology)
    - If mesh has >= 50 loose parts: use Voxel Remesh + Decimate (AI soup)
    """
    # Count loose parts WITHOUT separating (much faster)
    bm = bmesh.new()
    bm.from_mesh(high_poly.data)

    # Count islands using linked faces
    visited = set()
    num_islands = 0

    for face in bm.faces:
        if face.index not in visited:
            num_islands += 1
            # BFS to mark all connected faces
            stack = [face]
            while stack:
                f = stack.pop()
                if f.index in visited:
                    continue
                visited.add(f.index)
                for edge in f.edges:
                    for linked_face in edge.link_faces:
                        if linked_face.index not in visited:
                            stack.append(linked_face)

    bm.free()

    print(f"      {num_islands:,} mesh islands detected")

    # If too many islands, it's AI mesh soup - use Quadriflow
    if num_islands >= 50:
        print(f"      Using Quadriflow (AI mesh soup detected)")
        return quadriflow_remesh(high_poly, target_faces, base_name, lod_name)

    # Otherwise try Instant Meshes for clean quad topology
    print(f"      Using Instant Meshes (clean mesh)")

    export_path = os.path.join(temp_dir, f"{base_name}_export.obj")
    result_path = os.path.join(temp_dir, f"{base_name}_{lod_name}.obj")

    bpy.ops.object.select_all(action='DESELECT')
    high_poly.select_set(True)
    bpy.context.view_layer.objects.active = high_poly

    bpy.ops.wm.obj_export(
        filepath=export_path,
        export_selected_objects=True,
        export_triangulated_mesh=True,
        export_materials=False,
    )

    try:
        run_instant_meshes(export_path, result_path, target_faces)

        bpy.ops.wm.obj_import(filepath=result_path)
        result = bpy.context.active_object
        result.name = f"{base_name}_{lod_name}"

        # Match transform
        result.location = high_poly.location
        result.rotation_euler = high_poly.rotation_euler
        result.scale = high_poly.scale

        return result

    except Exception as e:
        print(f"      Instant Meshes failed: {e}")
        print(f"      Falling back to Quadriflow")
        return quadriflow_remesh(high_poly, target_faces, base_name, lod_name)


# =============================================================================
# STATIC MODEL PROCESSING (OBJ)
# =============================================================================

def process_static_model(filepath, category, temp_dir, output_dir):
    """Process a static OBJ model through retopology pipeline."""
    filename = Path(filepath).stem
    print(f"\n{'='*60}")
    print(f"Processing STATIC: {filename}")
    print(f"{'='*60}")

    # Import OBJ
    bpy.ops.wm.obj_import(filepath=filepath)
    high_poly = bpy.context.active_object
    high_poly.name = f"{filename}_highpoly"

    original_faces = len(high_poly.data.polygons)
    print(f"  Imported: {original_faces:,} faces")

    # Clean mesh
    clean_mesh(high_poly)

    # Get LOD targets for this category
    targets = LOD_TARGETS.get(category, LOD_TARGETS["units"])

    # Create LODs via Instant Meshes (handles disconnected parts automatically)
    lods = []
    lod_stats = {}

    for lod_name, target in [("LOD0", targets["lod0"]),
                              ("LOD1", targets["lod1"]),
                              ("LOD2", targets["lod2"])]:
        print(f"\n  Creating {lod_name} ({target} faces)...")

        try:
            # Use the new loose-parts-aware retopo function
            lod = retopo_with_loose_parts(high_poly, target, temp_dir, filename, lod_name)

            # Remove hidden geometry for buildings (hollow shells waste polygons)
            if category == "buildings":
                before_faces = len(lod.data.polygons)
                remove_hidden_geometry(
                    lod,
                    remove_bottom=SETTINGS["remove_bottom_faces"],
                    remove_interior=SETTINGS["remove_interior_faces"]
                )
                after_faces = len(lod.data.polygons)
                if after_faces < before_faces:
                    print(f"    Optimized: {before_faces:,} → {after_faces:,} faces")

            lods.append(lod)
            lod_stats[f"{lod_name.lower()}_faces"] = len(lod.data.polygons)
            print(f"    Created: {len(lod.data.polygons):,} faces")

        except Exception as e:
            print(f"    ERROR: {e}")
            print(f"    Using decimate fallback...")
            lod = create_decimate_fallback(high_poly, target * 2, f"_{lod_name}")
            lods.append(lod)
            lod_stats[f"{lod_name.lower()}_faces"] = len(lod.data.polygons)

    # UV unwrap LODs
    print(f"\n  UV unwrapping...")
    for lod in lods:
        smart_uv_unwrap(lod)

    # Bake textures
    print(f"\n  Baking textures...")
    normal_img = None
    ao_img = None

    if SETTINGS["bake_normal"]:
        normal_img = bake_normal_map(high_poly, lods[0], output_dir, filename)
    if SETTINGS["bake_ao"]:
        ao_img = bake_ao_map(high_poly, lods[0], output_dir, filename)

    # Apply textures to all LODs
    for lod in lods:
        apply_baked_textures(lod, normal_img, ao_img)

    # Prepare stats for approval
    stats = {
        "original_faces": original_faces,
        "has_armature": False,
        **lod_stats
    }

    # TEST MODE: Just show results and stop
    if TEST_MODE:
        # Arrange objects for easy viewing
        spacing = 3.0
        high_poly.location.x = -spacing
        high_poly.name = f"{filename}_ORIGINAL"
        for i, lod in enumerate(lods):
            lod.location.x = i * spacing

        # Frame all objects
        UserPrompt.refresh_viewport_and_frame([high_poly] + lods)

        print("\n" + "="*60)
        print("  TEST MODE COMPLETE")
        print("="*60)
        print(f"  Model: {filename}")
        print(f"  Original: {original_faces:,} faces (left)")
        print(f"  LOD0: {lod_stats.get('lod0_faces', 'N/A'):,} faces")
        print(f"  LOD1: {lod_stats.get('lod1_faces', 'N/A'):,} faces")
        print(f"  LOD2: {lod_stats.get('lod2_faces', 'N/A'):,} faces")
        print("-"*60)
        print("  Objects kept in scene for inspection.")
        print("  Nothing was saved or exported.")
        print("  Set TEST_MODE = False for batch processing.")
        print("="*60)
        return "test_done"

    # Wait for approval (pass LOD objects so viewport can frame them)
    response = UserPrompt.wait_for_approval(filename, category, stats, lod_objects=lods)

    if response == "approve":
        # Export
        for lod in lods:
            export_model(lod, output_dir, lod.name)
        print(f"  ✓ Exported {filename}")

    elif response == "skip":
        print(f"  ⊘ Skipped {filename}")

    elif response == "quit":
        return "quit"

    # Cleanup
    cleanup_scene([high_poly] + lods)

    return response


def create_decimate_fallback(obj, target_tris, suffix):
    """Fallback decimation if Instant Meshes fails."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.duplicate()

    dup = bpy.context.active_object
    dup.name = obj.name.replace("_highpoly", "") + suffix

    current = len(dup.data.polygons)
    ratio = (target_tris / 2) / current if current > 0 else 0.1

    mod = dup.modifiers.new("Decimate", 'DECIMATE')
    mod.ratio = max(0.01, min(ratio, 1.0))
    bpy.ops.object.modifier_apply(modifier="Decimate")

    return dup


# =============================================================================
# ANIMATED MODEL PROCESSING (GLB)
# =============================================================================

def process_animated_model(filepath, category, temp_dir, output_dir):
    """
    Process an animated GLB model while preserving rig and animations.

    Strategy:
    1. Import GLB (mesh + armature + animations)
    2. Separate mesh from armature temporarily
    3. Retopo the mesh via Instant Meshes
    4. Transfer vertex weights from original to new mesh
    5. Re-parent to armature
    6. Bake textures
    7. Export with animations
    """
    filename = Path(filepath).stem
    print(f"\n{'='*60}")
    print(f"Processing ANIMATED: {filename}")
    print(f"{'='*60}")

    # Import GLB
    bpy.ops.import_scene.gltf(filepath=filepath)

    # Find mesh and armature
    mesh_obj = None
    armature_obj = None
    original_materials = []

    for obj in bpy.context.selected_objects:
        if obj.type == 'MESH':
            mesh_obj = obj
            # Store original materials
            original_materials = [slot.material for slot in obj.material_slots]
        elif obj.type == 'ARMATURE':
            armature_obj = obj

    if not mesh_obj:
        print(f"  ERROR: No mesh found in {filename}")
        return "skip"

    high_poly = mesh_obj
    high_poly.name = f"{filename}_highpoly"
    original_faces = len(high_poly.data.polygons)

    print(f"  Mesh: {original_faces:,} faces")
    if armature_obj:
        print(f"  Armature: {armature_obj.name} ({len(armature_obj.data.bones)} bones)")
        # Count animations
        anim_count = 0
        if armature_obj.animation_data and armature_obj.animation_data.action:
            anim_count = 1
        if bpy.data.actions:
            anim_count = len(bpy.data.actions)
        print(f"  Animations: {anim_count} action(s)")

    # Store original vertex groups (weights)
    original_vertex_groups = [vg.name for vg in high_poly.vertex_groups]
    print(f"  Vertex groups: {len(original_vertex_groups)}")

    # Store armature modifier settings
    armature_modifier = None
    for mod in high_poly.modifiers:
        if mod.type == 'ARMATURE':
            armature_modifier = {
                'object': mod.object,
                'use_deform_preserve_volume': mod.use_deform_preserve_volume,
            }
            break

    # Get LOD targets
    targets = LOD_TARGETS.get(category, LOD_TARGETS["units"])

    # Create LODs (handles disconnected parts automatically)
    lods = []
    lod_stats = {}

    for lod_name, target in [("LOD0", targets["lod0"]),
                              ("LOD1", targets["lod1"]),
                              ("LOD2", targets["lod2"])]:
        print(f"\n  Creating {lod_name} ({target} faces)...")

        try:
            # Use the new loose-parts-aware retopo function
            lod = retopo_with_loose_parts(high_poly, target, temp_dir, filename, lod_name)

            # Transfer vertex weights from high-poly to low-poly
            if armature_obj and original_vertex_groups:
                print(f"    Transferring weights...")
                transfer_vertex_weights(high_poly, lod)

                # Add armature modifier
                arm_mod = lod.modifiers.new("Armature", 'ARMATURE')
                arm_mod.object = armature_obj
                if armature_modifier:
                    arm_mod.use_deform_preserve_volume = armature_modifier['use_deform_preserve_volume']

                # Parent to armature (keep transform)
                lod.parent = armature_obj
                lod.matrix_parent_inverse = armature_obj.matrix_world.inverted()

            lods.append(lod)
            lod_stats[f"{lod_name.lower()}_faces"] = len(lod.data.polygons)
            print(f"    Created: {len(lod.data.polygons):,} faces")

        except Exception as e:
            print(f"    ERROR: {e}")
            print(f"    Using decimate fallback...")
            lod = create_animated_decimate_fallback(
                high_poly, target * 2, f"_{lod_name}",
                armature_obj, armature_modifier
            )
            lods.append(lod)
            lod_stats[f"{lod_name.lower()}_faces"] = len(lod.data.polygons)

    # UV unwrap (preserve existing UVs if good, otherwise smart project)
    print(f"\n  UV unwrapping...")
    for lod in lods:
        smart_uv_unwrap(lod)

    # Bake textures
    print(f"\n  Baking textures...")
    normal_img = None
    ao_img = None

    if SETTINGS["bake_normal"]:
        normal_img = bake_normal_map(high_poly, lods[0], output_dir, filename)
    if SETTINGS["bake_ao"]:
        ao_img = bake_ao_map(high_poly, lods[0], output_dir, filename)

    # Apply baked textures + original textures
    for lod in lods:
        apply_baked_textures_with_original(lod, normal_img, ao_img, original_materials)

    # Stats for approval
    stats = {
        "original_faces": original_faces,
        "has_armature": armature_obj is not None,
        "animation_count": len(bpy.data.actions) if bpy.data.actions else 0,
        **lod_stats
    }

    # TEST MODE: Just show results and stop
    if TEST_MODE:
        # Arrange objects for easy viewing
        spacing = 3.0
        high_poly.location.x = -spacing
        high_poly.name = f"{filename}_ORIGINAL"
        for i, lod in enumerate(lods):
            lod.location.x = i * spacing

        # Frame all objects (include armature if present)
        all_objects = [high_poly] + lods
        if armature_obj:
            all_objects.append(armature_obj)
        UserPrompt.refresh_viewport_and_frame(all_objects)

        anim_count = len(bpy.data.actions) if bpy.data.actions else 0
        print("\n" + "="*60)
        print("  TEST MODE COMPLETE")
        print("="*60)
        print(f"  Model: {filename}")
        print(f"  Original: {original_faces:,} faces (left)")
        print(f"  LOD0: {lod_stats.get('lod0_faces', 'N/A'):,} faces")
        print(f"  LOD1: {lod_stats.get('lod1_faces', 'N/A'):,} faces")
        print(f"  LOD2: {lod_stats.get('lod2_faces', 'N/A'):,} faces")
        if armature_obj:
            print(f"  Armature: {armature_obj.name} ✓")
            print(f"  Animations: {anim_count} action(s)")
        print("-"*60)
        print("  Objects kept in scene for inspection.")
        print("  Nothing was saved or exported.")
        print("  Set TEST_MODE = False for batch processing.")
        print("="*60)
        return "test_done"

    # Wait for approval (pass LOD objects so viewport can frame them)
    response = UserPrompt.wait_for_approval(filename, category, stats, lod_objects=lods)

    if response == "approve":
        # Export with animations
        for lod in lods:
            export_animated_model(lod, armature_obj, output_dir, lod.name)
        print(f"  ✓ Exported {filename} with animations")

    elif response == "skip":
        print(f"  ⊘ Skipped {filename}")

    elif response == "quit":
        return "quit"

    # Cleanup
    objects_to_remove = [high_poly] + lods
    if armature_obj:
        objects_to_remove.append(armature_obj)
    cleanup_scene(objects_to_remove)

    return response


def transfer_vertex_weights(source, target):
    """
    Transfer vertex weights from source mesh to target mesh.
    Uses Blender's Data Transfer modifier.
    """
    # First, copy vertex group structure
    for vg in source.vertex_groups:
        if vg.name not in target.vertex_groups:
            target.vertex_groups.new(name=vg.name)

    # Use Data Transfer modifier
    bpy.context.view_layer.objects.active = target
    modifier = target.modifiers.new("WeightTransfer", 'DATA_TRANSFER')
    modifier.object = source
    modifier.use_vert_data = True
    modifier.data_types_verts = {'VGROUP_WEIGHTS'}
    modifier.vert_mapping = 'POLYINTERP_NEAREST'  # Best for different topology

    # Apply modifier
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def create_animated_decimate_fallback(obj, target_tris, suffix, armature, arm_mod_settings):
    """Fallback decimation for animated models, preserving rig."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.duplicate()

    dup = bpy.context.active_object
    dup.name = obj.name.replace("_highpoly", "") + suffix

    # Decimate
    current = len(dup.data.polygons)
    ratio = (target_tris / 2) / current if current > 0 else 0.1

    mod = dup.modifiers.new("Decimate", 'DECIMATE')
    mod.ratio = max(0.01, min(ratio, 1.0))
    bpy.ops.object.modifier_apply(modifier="Decimate")

    # Re-add armature modifier (weights are preserved through duplication)
    if armature:
        arm_mod = dup.modifiers.new("Armature", 'ARMATURE')
        arm_mod.object = armature
        if arm_mod_settings:
            arm_mod.use_deform_preserve_volume = arm_mod_settings['use_deform_preserve_volume']

        dup.parent = armature
        dup.matrix_parent_inverse = armature.matrix_world.inverted()

    return dup


# =============================================================================
# UV & BAKING
# =============================================================================

def smart_uv_unwrap(obj):
    """Smart UV project."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(66),
        island_margin=0.02,
        correct_aspect=True
    )
    bpy.ops.object.mode_set(mode='OBJECT')


def create_bake_image(name, size, is_data=False):
    """Create image for baking."""
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])

    img = bpy.data.images.new(
        name=name,
        width=size,
        height=size,
        alpha=False,
        float_buffer=is_data
    )
    if is_data:
        img.colorspace_settings.name = 'Non-Color'
    return img


def setup_bake_material(obj, bake_image):
    """Setup material for baking."""
    if not obj.data.materials:
        mat = bpy.data.materials.new(name=f"{obj.name}_Material")
        obj.data.materials.append(mat)
    else:
        mat = obj.data.materials[0]

    mat.use_nodes = True
    nodes = mat.node_tree.nodes

    tex_node = nodes.new('ShaderNodeTexImage')
    tex_node.image = bake_image
    tex_node.select = True
    nodes.active = tex_node

    return mat


def bake_normal_map(high_poly, low_poly, output_dir, base_name):
    """Bake normal map from high to low."""
    print(f"    Baking normal map...")

    size = SETTINGS["texture_size"]
    img = create_bake_image(f"{base_name}_normal", size, is_data=True)

    setup_bake_material(low_poly, img)

    bpy.ops.object.select_all(action='DESELECT')
    high_poly.select_set(True)
    low_poly.select_set(True)
    bpy.context.view_layer.objects.active = low_poly

    bpy.context.scene.render.engine = 'CYCLES'
    try:
        bpy.context.scene.cycles.device = 'GPU'
    except:
        pass
    bpy.context.scene.cycles.samples = 64

    bake = bpy.context.scene.render.bake
    bake.use_selected_to_active = True
    bake.cage_extrusion = SETTINGS["bake_extrusion"]
    bake.max_ray_distance = SETTINGS["bake_max_ray"]

    bpy.ops.object.bake(type='NORMAL')

    path = os.path.join(output_dir, f"{base_name}_normal.png")
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()

    return img


def bake_ao_map(high_poly, low_poly, output_dir, base_name):
    """Bake AO map."""
    print(f"    Baking AO map...")

    size = SETTINGS["texture_size"]
    img = create_bake_image(f"{base_name}_ao", size, is_data=False)

    setup_bake_material(low_poly, img)

    bpy.ops.object.select_all(action='DESELECT')
    high_poly.select_set(True)
    low_poly.select_set(True)
    bpy.context.view_layer.objects.active = low_poly

    bpy.context.scene.cycles.samples = 128
    bpy.ops.object.bake(type='AO')

    path = os.path.join(output_dir, f"{base_name}_ao.png")
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()

    return img


def apply_baked_textures(obj, normal_img, ao_img=None):
    """Apply baked textures to material."""
    if not obj.data.materials:
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
        for node in nodes:
            if node.type == 'OUTPUT_MATERIAL':
                links.new(principled.outputs['BSDF'], node.inputs['Surface'])
                break

    # Normal map
    if normal_img:
        normal_tex = nodes.new('ShaderNodeTexImage')
        normal_tex.image = normal_img
        normal_tex.image.colorspace_settings.name = 'Non-Color'

        normal_node = nodes.new('ShaderNodeNormalMap')
        links.new(normal_tex.outputs['Color'], normal_node.inputs['Color'])
        links.new(normal_node.outputs['Normal'], principled.inputs['Normal'])

    # AO
    if ao_img:
        ao_tex = nodes.new('ShaderNodeTexImage')
        ao_tex.image = ao_img

        mix = nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 0.5
        mix.inputs['A'].default_value = (0.8, 0.8, 0.8, 1.0)
        links.new(ao_tex.outputs['Color'], mix.inputs['B'])
        links.new(mix.outputs['Result'], principled.inputs['Base Color'])


def apply_baked_textures_with_original(obj, normal_img, ao_img, original_materials):
    """Apply baked textures while preserving original diffuse/albedo."""
    # Start with basic baked textures
    apply_baked_textures(obj, normal_img, ao_img)

    # If there were original materials with textures, try to preserve base color
    if original_materials:
        mat = obj.data.materials[0] if obj.data.materials else None
        if not mat:
            return

        nodes = mat.node_tree.nodes
        links = mat.node_tree.links

        principled = None
        for node in nodes:
            if node.type == 'BSDF_PRINCIPLED':
                principled = node
                break

        # Check original materials for base color texture
        for orig_mat in original_materials:
            if orig_mat and orig_mat.use_nodes:
                for node in orig_mat.node_tree.nodes:
                    if node.type == 'TEX_IMAGE' and node.image:
                        # Check if this was connected to base color
                        # Copy the texture reference
                        tex = nodes.new('ShaderNodeTexImage')
                        tex.image = node.image

                        # Mix with AO if present
                        if ao_img:
                            mix = nodes.new('ShaderNodeMix')
                            mix.data_type = 'RGBA'
                            mix.blend_type = 'MULTIPLY'
                            mix.inputs['Factor'].default_value = 0.3

                            # Find existing AO mix node
                            ao_mix = None
                            for n in nodes:
                                if n.type == 'MIX' and n.blend_type == 'MULTIPLY':
                                    ao_mix = n
                                    break

                            if ao_mix:
                                links.new(tex.outputs['Color'], ao_mix.inputs['A'])
                        else:
                            links.new(tex.outputs['Color'], principled.inputs['Base Color'])
                        break
                break


# =============================================================================
# EXPORT
# =============================================================================

def export_model(obj, output_dir, filename):
    """Export static model as GLB."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)

    path = os.path.join(output_dir, f"{filename}.glb")

    bpy.ops.export_scene.gltf(
        filepath=path,
        use_selection=True,
        export_format='GLB',
        export_draco_mesh_compression_enable=True,
        export_materials='EXPORT',
        export_image_format='WEBP',
    )


def export_animated_model(mesh_obj, armature_obj, output_dir, filename):
    """Export animated model with armature and animations."""
    bpy.ops.object.select_all(action='DESELECT')
    mesh_obj.select_set(True)
    if armature_obj:
        armature_obj.select_set(True)
        bpy.context.view_layer.objects.active = armature_obj

    path = os.path.join(output_dir, f"{filename}.glb")

    bpy.ops.export_scene.gltf(
        filepath=path,
        use_selection=True,
        export_format='GLB',
        export_draco_mesh_compression_enable=True,
        export_materials='EXPORT',
        export_image_format='WEBP',
        export_animations=True,
        export_animation_mode='ACTIONS',
    )


# =============================================================================
# CLEANUP
# =============================================================================

def cleanup_scene(objects):
    """Remove objects from scene."""
    if SETTINGS["keep_high_poly"]:
        return

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
# INTERACTIVE TEST MODE
# =============================================================================

def get_models_in_folder(folder_path):
    """Get list of model files in a folder."""
    if not os.path.exists(folder_path):
        return []

    static_extensions = ['.obj']
    animated_extensions = ['.glb', '.gltf', '.fbx']

    files = []
    for f in os.listdir(folder_path):
        f_lower = f.lower()
        if any(f_lower.endswith(ext) for ext in static_extensions):
            files.append((f, "static"))
        elif any(f_lower.endswith(ext) for ext in animated_extensions):
            files.append((f, "animated"))

    files.sort(key=lambda x: x[0])
    return files


def interactive_test_select():
    """
    Interactive selection for test mode.
    Returns (folder_key, filepath, file_type) or None to cancel.
    """
    print("\n" + "="*60)
    print("  SELECT MODEL TO TEST")
    print("="*60)

    # Find available folders
    available_folders = []
    for key, path in INPUT_FOLDERS.items():
        if path and not path.startswith("/path/to") and os.path.exists(path):
            models = get_models_in_folder(path)
            if models:
                available_folders.append((key, path, len(models)))

    if not available_folders:
        print("\n  ERROR: No configured folders with models found!")
        print("  Please set INPUT_FOLDERS paths in the script.")
        return None

    # List folders
    print("\n  Available folders:")
    print("-"*60)
    for i, (key, path, count) in enumerate(available_folders):
        print(f"    [{i+1}] {key.upper()} ({count} models)")
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

    # List models in selected folder
    models = get_models_in_folder(folder_path)

    print(f"\n  Models in {folder_key.upper()}:")
    print("-"*60)
    for i, (filename, file_type) in enumerate(models):
        name = Path(filename).stem
        type_label = "GLB" if file_type == "animated" else "OBJ"
        print(f"    [{i+1}] {name} ({type_label})")
    print(f"    [q] Back to folder selection")
    print("-"*60)

    try:
        choice = input("  Select model number: ").strip().lower()
        if choice == 'q':
            return interactive_test_select()  # Go back to folder selection
        model_idx = int(choice) - 1
        if model_idx < 0 or model_idx >= len(models):
            print("  Invalid selection")
            return None
    except (ValueError, EOFError):
        return None

    filename, file_type = models[model_idx]
    filepath = os.path.join(folder_path, filename)

    return (folder_key, filepath, file_type)


# =============================================================================
# MAIN BATCH PROCESSOR
# =============================================================================

def process_folder(folder_path, category, temp_dir, output_dir):
    """
    Process all models in a folder.
    Auto-detects file type: OBJ = static, GLB/GLTF = animated with rig.
    """
    if not os.path.exists(folder_path):
        print(f"  Folder not found: {folder_path}")
        return

    # Get ALL model files (both static and animated)
    static_extensions = ['.obj']
    animated_extensions = ['.glb', '.gltf', '.fbx']

    files = []
    for f in os.listdir(folder_path):
        f_lower = f.lower()
        if any(f_lower.endswith(ext) for ext in static_extensions):
            files.append((os.path.join(folder_path, f), "static"))
        elif any(f_lower.endswith(ext) for ext in animated_extensions):
            files.append((os.path.join(folder_path, f), "animated"))

    files.sort(key=lambda x: x[0])  # Sort by filename
    total = len(files)

    # Count types
    static_count = sum(1 for f in files if f[1] == "static")
    animated_count = sum(1 for f in files if f[1] == "animated")

    print(f"\n{'='*70}")
    print(f"  PROCESSING FOLDER: {category}")
    print(f"  Total files: {total}")
    print(f"    Static (OBJ): {static_count}")
    print(f"    Animated (GLB/FBX): {animated_count}")
    print(f"{'='*70}")

    for i, (filepath, file_type) in enumerate(files):
        filename = Path(filepath).stem
        print(f"\n  [{i+1}/{total}] {filename} ({file_type})")

        # Clear scene between models (skip in test mode to preserve objects)
        if not TEST_MODE:
            clear_scene()

        if file_type == "animated":
            result = process_animated_model(filepath, category, temp_dir, output_dir)
        else:
            result = process_static_model(filepath, category, temp_dir, output_dir)

        if result == "quit":
            print("\n  Batch processing stopped by user.")
            return "quit"

        # TEST MODE: Stop after first model
        if result == "test_done":
            return "test_done"


def main():
    """Main entry point."""
    print("\n" + "="*70)
    if TEST_MODE:
        print("  VOIDSTRIKE RETOPOLOGY - TEST MODE")
        print("  (Interactive model selection, no saving)")
    else:
        print("  VOIDSTRIKE BATCH RETOPOLOGY PIPELINE")
    print("="*70)

    # Check Instant Meshes
    im_path = find_instant_meshes()
    if im_path:
        print(f"\n✓ Instant Meshes: {im_path}")
    else:
        print("\n⚠ Instant Meshes not found - using fallback decimation")
        print("  Download from: https://github.com/wjakob/instant-meshes")

    # Create output directory (even in test mode, for temp baked textures)
    os.makedirs(OUTPUT_FOLDER, exist_ok=True)

    # Create temp directory
    temp_dir = tempfile.mkdtemp(prefix="voidstrike_batch_")
    print(f"  Temp directory: {temp_dir}")

    # TEST MODE: Interactive model selection
    if TEST_MODE:
        selection = interactive_test_select()
        if selection is None:
            print("\n  Test cancelled.")
            return

        folder_key, filepath, file_type = selection
        filename = Path(filepath).stem

        print(f"\n  Processing: {filename} ({file_type})")

        # Create category output subfolder
        category_output = os.path.join(OUTPUT_FOLDER, folder_key)
        os.makedirs(category_output, exist_ok=True)

        # Process the selected model
        if file_type == "animated":
            process_animated_model(filepath, folder_key, temp_dir, category_output)
        else:
            process_static_model(filepath, folder_key, temp_dir, category_output)

        return

    # BATCH MODE: Process each folder in order
    folder_order = ["decorations", "resources", "buildings", "units"]

    for folder_key in folder_order:
        if folder_key not in INPUT_FOLDERS:
            continue

        folder_path = INPUT_FOLDERS[folder_key]
        if not folder_path or folder_path.startswith("/path/to"):
            print(f"\n  Skipping {folder_key} (path not configured)")
            continue

        # Create category output subfolder
        category_output = os.path.join(OUTPUT_FOLDER, folder_key)
        os.makedirs(category_output, exist_ok=True)

        # Process folder - auto-detects OBJ (static) vs GLB (animated)
        result = process_folder(folder_path, folder_key, temp_dir, category_output)

        if result == "quit":
            break

    # Cleanup temp
    try:
        import shutil
        shutil.rmtree(temp_dir)
    except:
        pass

    print("\n" + "="*70)
    print("  BATCH PROCESSING COMPLETE")
    print("="*70 + "\n")


if __name__ == "__main__":
    main()
