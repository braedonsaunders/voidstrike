"""
VOIDSTRIKE Animation Renamer
=============================
Batch renames animations in GLB models to use semantic names (idle, walk, attack, death).

This script uses a modal operator so Blender stays responsive during use.

MODES:
1. INTERACTIVE - Panel-based UI with keyboard shortcuts for renaming
2. BY_INDEX - Automatic batch rename (no UI interaction needed)
3. PREVIEW - Just print what animations exist

USAGE:
1. Open Blender
2. Open this script in Text Editor
3. Configure INPUT_FOLDER and OUTPUT_FOLDER below
4. Click "Run Script"
5. A panel will appear in the 3D View sidebar (press N to show sidebar)
6. Use the panel buttons or keyboard shortcuts to rename animations

KEYBOARD SHORTCUTS (when panel is active):
  I = rename to "idle"
  W = rename to "walk"
  A = rename to "attack"
  D = rename to "death"
  SPACE = play/pause current animation
  RIGHT ARROW = next animation
  LEFT ARROW = previous animation
  N = next model
  ESC = finish/close
"""

import bpy
import os
from pathlib import Path
from bpy.types import Operator, Panel, PropertyGroup
from bpy.props import StringProperty, IntProperty, EnumProperty, CollectionProperty

# =============================================================================
# CONFIGURATION
# =============================================================================

# Input folder containing GLB models
INPUT_FOLDER = "/path/to/your/models/"

# Output folder (set same as INPUT_FOLDER to overwrite originals)
OUTPUT_FOLDER = "/path/to/output/"

# For batch mode: index to name mapping
INDEX_MAPPINGS_BY_COUNT = {
    1: {0: "idle"},
    2: {0: "idle", 1: "walk"},
    3: {0: "idle", 1: "walk", 2: "attack"},
    4: {0: "idle", 1: "walk", 2: "attack", 3: "death"},
    5: {0: "idle", 1: "walk", 2: "run", 3: "attack", 4: "death"},
}

# =============================================================================
# PROPERTY GROUP - Stores state
# =============================================================================

class AnimationEntry(PropertyGroup):
    name: StringProperty(name="Name")
    original_name: StringProperty(name="Original")
    frame_start: IntProperty(name="Start")
    frame_end: IntProperty(name="End")


class AnimRenamerState(PropertyGroup):
    input_folder: StringProperty(
        name="Input Folder",
        subtype='DIR_PATH',
        default=INPUT_FOLDER if not INPUT_FOLDER.startswith("/path/to") else ""
    )
    output_folder: StringProperty(
        name="Output Folder",
        subtype='DIR_PATH',
        default=OUTPUT_FOLDER if not OUTPUT_FOLDER.startswith("/path/to") else ""
    )
    current_file_index: IntProperty(name="File Index", default=0)
    current_anim_index: IntProperty(name="Animation Index", default=0)
    total_files: IntProperty(name="Total Files", default=0)
    current_filename: StringProperty(name="Filename", default="")
    is_playing: bpy.props.BoolProperty(name="Is Playing", default=False)
    is_active: bpy.props.BoolProperty(name="Is Active", default=False)
    animations: CollectionProperty(type=AnimationEntry)


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def clear_scene():
    """Clear entire scene."""
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


def get_glb_files(folder_path):
    """Get list of GLB files."""
    if not folder_path or not os.path.exists(folder_path):
        return []
    files = []
    for f in os.listdir(folder_path):
        if f.lower().endswith(('.glb', '.gltf')):
            files.append(os.path.join(folder_path, f))
    files.sort()
    return files


def get_armature():
    """Get the armature in the scene."""
    for obj in bpy.data.objects:
        if obj.type == 'ARMATURE':
            return obj
    return None


def get_animations(armature_obj):
    """Get animation info from armature."""
    animations = []
    if not armature_obj:
        return animations

    # Check NLA tracks
    if armature_obj.animation_data and armature_obj.animation_data.nla_tracks:
        for track in armature_obj.animation_data.nla_tracks:
            for strip in track.strips:
                if strip.action:
                    action = strip.action
                    animations.append({
                        "name": action.name,
                        "action": action,
                        "frame_start": int(action.frame_range[0]),
                        "frame_end": int(action.frame_range[1]),
                    })

    # Fallback: check all actions
    if not animations:
        for action in bpy.data.actions:
            has_bones = any(fc.data_path.startswith('pose.bones') for fc in action.fcurves)
            if has_bones:
                animations.append({
                    "name": action.name,
                    "action": action,
                    "frame_start": int(action.frame_range[0]),
                    "frame_end": int(action.frame_range[1]),
                })

    return animations


def play_animation(armature_obj, action, frame_start, frame_end):
    """Play a specific animation."""
    if not armature_obj:
        return

    if armature_obj.animation_data is None:
        armature_obj.animation_data_create()

    armature_obj.animation_data.action = action
    bpy.context.scene.frame_start = frame_start
    bpy.context.scene.frame_end = frame_end
    bpy.context.scene.frame_set(frame_start)
    bpy.ops.screen.animation_play()


def stop_animation():
    """Stop animation playback."""
    if bpy.context.screen.is_animation_playing:
        bpy.ops.screen.animation_cancel()


def frame_view():
    """Frame the camera on selected objects."""
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            for region in area.regions:
                if region.type == 'WINDOW':
                    with bpy.context.temp_override(area=area, region=region):
                        bpy.ops.view3d.view_selected()
                    return


# =============================================================================
# OPERATORS
# =============================================================================

class ANIMRENAME_OT_start(Operator):
    """Start the animation renamer"""
    bl_idname = "animrename.start"
    bl_label = "Start Renamer"

    def execute(self, context):
        state = context.scene.anim_renamer

        if not state.input_folder:
            self.report({'ERROR'}, "Please set Input Folder")
            return {'CANCELLED'}

        files = get_glb_files(state.input_folder)
        if not files:
            self.report({'ERROR'}, f"No GLB files found in {state.input_folder}")
            return {'CANCELLED'}

        state.total_files = len(files)
        state.current_file_index = 0
        state.is_active = True

        # Load first file
        bpy.ops.animrename.load_file()

        self.report({'INFO'}, f"Found {len(files)} GLB files")
        return {'FINISHED'}


class ANIMRENAME_OT_load_file(Operator):
    """Load current file"""
    bl_idname = "animrename.load_file"
    bl_label = "Load File"

    def execute(self, context):
        state = context.scene.anim_renamer
        files = get_glb_files(state.input_folder)

        if state.current_file_index >= len(files):
            state.is_active = False
            self.report({'INFO'}, "All files processed!")
            return {'FINISHED'}

        filepath = files[state.current_file_index]
        filename = Path(filepath).stem

        # Clear and import
        clear_scene()
        bpy.ops.import_scene.gltf(filepath=filepath)

        # Select all and frame
        bpy.ops.object.select_all(action='SELECT')
        frame_view()

        # Get animations
        armature = get_armature()
        animations = get_animations(armature)

        # Store in state
        state.current_filename = filename
        state.current_anim_index = 0
        state.animations.clear()

        for anim in animations:
            entry = state.animations.add()
            entry.name = anim["name"]
            entry.original_name = anim["name"]
            entry.frame_start = anim["frame_start"]
            entry.frame_end = anim["frame_end"]

        # Play first animation if exists
        if animations:
            bpy.ops.animrename.select_animation(index=0)

        self.report({'INFO'}, f"Loaded: {filename} ({len(animations)} animations)")
        return {'FINISHED'}


class ANIMRENAME_OT_select_animation(Operator):
    """Select and play animation"""
    bl_idname = "animrename.select_animation"
    bl_label = "Select Animation"

    index: IntProperty(default=0)

    def execute(self, context):
        state = context.scene.anim_renamer

        if self.index < 0 or self.index >= len(state.animations):
            return {'CANCELLED'}

        state.current_anim_index = self.index

        # Find and play the animation
        armature = get_armature()
        if armature:
            anim_entry = state.animations[self.index]
            for action in bpy.data.actions:
                if action.name == anim_entry.name:
                    play_animation(armature, action, anim_entry.frame_start, anim_entry.frame_end)
                    state.is_playing = True
                    break

        return {'FINISHED'}


class ANIMRENAME_OT_rename(Operator):
    """Rename current animation"""
    bl_idname = "animrename.rename"
    bl_label = "Rename Animation"

    new_name: StringProperty(default="")

    def execute(self, context):
        state = context.scene.anim_renamer

        if state.current_anim_index >= len(state.animations):
            return {'CANCELLED'}

        anim_entry = state.animations[state.current_anim_index]
        old_name = anim_entry.name

        # Find and rename the action
        for action in bpy.data.actions:
            if action.name == old_name:
                action.name = self.new_name
                anim_entry.name = self.new_name
                self.report({'INFO'}, f"Renamed: '{old_name}' -> '{self.new_name}'")
                break

        return {'FINISHED'}


class ANIMRENAME_OT_next_animation(Operator):
    """Go to next animation"""
    bl_idname = "animrename.next_animation"
    bl_label = "Next Animation"

    def execute(self, context):
        state = context.scene.anim_renamer
        if state.current_anim_index < len(state.animations) - 1:
            bpy.ops.animrename.select_animation(index=state.current_anim_index + 1)
        return {'FINISHED'}


class ANIMRENAME_OT_prev_animation(Operator):
    """Go to previous animation"""
    bl_idname = "animrename.prev_animation"
    bl_label = "Previous Animation"

    def execute(self, context):
        state = context.scene.anim_renamer
        if state.current_anim_index > 0:
            bpy.ops.animrename.select_animation(index=state.current_anim_index - 1)
        return {'FINISHED'}


class ANIMRENAME_OT_toggle_play(Operator):
    """Toggle animation playback"""
    bl_idname = "animrename.toggle_play"
    bl_label = "Play/Pause"

    def execute(self, context):
        state = context.scene.anim_renamer
        if bpy.context.screen.is_animation_playing:
            stop_animation()
            state.is_playing = False
        else:
            bpy.ops.animrename.select_animation(index=state.current_anim_index)
        return {'FINISHED'}


class ANIMRENAME_OT_save_and_next(Operator):
    """Save current model and load next"""
    bl_idname = "animrename.save_and_next"
    bl_label = "Save & Next Model"

    def execute(self, context):
        state = context.scene.anim_renamer

        # Check if any names changed
        changed = any(a.name != a.original_name for a in state.animations)

        if changed and state.output_folder:
            # Export
            output_path = os.path.join(state.output_folder, f"{state.current_filename}.glb")
            os.makedirs(state.output_folder, exist_ok=True)

            bpy.ops.object.select_all(action='SELECT')
            bpy.ops.export_scene.gltf(
                filepath=output_path,
                use_selection=True,
                export_format='GLB',
                export_animations=True,
                export_draco_mesh_compression_enable=True,
            )
            self.report({'INFO'}, f"Saved: {output_path}")

        # Next file
        state.current_file_index += 1
        bpy.ops.animrename.load_file()

        return {'FINISHED'}


class ANIMRENAME_OT_skip(Operator):
    """Skip current model without saving"""
    bl_idname = "animrename.skip"
    bl_label = "Skip Model"

    def execute(self, context):
        state = context.scene.anim_renamer
        state.current_file_index += 1
        bpy.ops.animrename.load_file()
        return {'FINISHED'}


class ANIMRENAME_OT_batch_rename(Operator):
    """Batch rename all files by index"""
    bl_idname = "animrename.batch_rename"
    bl_label = "Batch Rename (By Index)"

    def execute(self, context):
        state = context.scene.anim_renamer

        if not state.input_folder or not state.output_folder:
            self.report({'ERROR'}, "Set both Input and Output folders")
            return {'CANCELLED'}

        files = get_glb_files(state.input_folder)
        os.makedirs(state.output_folder, exist_ok=True)

        processed = 0
        for filepath in files:
            filename = Path(filepath).stem
            print(f"Processing: {filename}")

            clear_scene()
            bpy.ops.import_scene.gltf(filepath=filepath)

            armature = get_armature()
            animations = get_animations(armature)

            if not animations:
                print(f"  (no animations, skipping)")
                continue

            # Get mapping
            count = len(animations)
            mapping = INDEX_MAPPINGS_BY_COUNT.get(count, {0: "idle", 1: "walk", 2: "attack", 3: "death"})

            renamed = False
            for idx, anim in enumerate(animations):
                if idx in mapping:
                    new_name = mapping[idx]
                    if anim["action"].name != new_name:
                        print(f"  [{idx}] '{anim['action'].name}' -> '{new_name}'")
                        anim["action"].name = new_name
                        renamed = True

            if renamed:
                output_path = os.path.join(state.output_folder, f"{filename}.glb")
                bpy.ops.object.select_all(action='SELECT')
                bpy.ops.export_scene.gltf(
                    filepath=output_path,
                    use_selection=True,
                    export_format='GLB',
                    export_animations=True,
                    export_draco_mesh_compression_enable=True,
                )
                processed += 1

        self.report({'INFO'}, f"Batch processed {processed} files")
        return {'FINISHED'}


# =============================================================================
# PANEL
# =============================================================================

class ANIMRENAME_PT_panel(Panel):
    """Animation Renamer Panel"""
    bl_label = "Animation Renamer"
    bl_idname = "ANIMRENAME_PT_panel"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Anim Rename'

    def draw(self, context):
        layout = self.layout
        state = context.scene.anim_renamer

        # Folder settings
        box = layout.box()
        box.label(text="Folders:", icon='FILE_FOLDER')
        box.prop(state, "input_folder", text="Input")
        box.prop(state, "output_folder", text="Output")

        layout.separator()

        # Mode buttons
        row = layout.row(align=True)
        row.scale_y = 1.5
        row.operator("animrename.start", text="Interactive Mode", icon='PLAY')

        row = layout.row()
        row.operator("animrename.batch_rename", text="Batch Rename (Auto)", icon='FILE_REFRESH')

        # Show active session info
        if state.is_active:
            layout.separator()
            box = layout.box()

            # File info
            box.label(text=f"Model: {state.current_filename}", icon='MESH_DATA')
            box.label(text=f"File {state.current_file_index + 1} / {state.total_files}")

            layout.separator()

            # Animation list
            box = layout.box()
            box.label(text="Animations:", icon='ACTION')

            for idx, anim in enumerate(state.animations):
                row = box.row(align=True)

                # Highlight current
                if idx == state.current_anim_index:
                    row.alert = True

                # Select button
                op = row.operator("animrename.select_animation", text="", icon='PLAY')
                op.index = idx

                # Name (editable)
                row.label(text=f"[{idx}] {anim.name}")

                # Frame info
                row.label(text=f"({anim.frame_end - anim.frame_start}f)")

            if not state.animations:
                box.label(text="(no animations)", icon='INFO')

            layout.separator()

            # Rename buttons
            if state.animations:
                box = layout.box()
                box.label(text="Rename current to:", icon='SORTALPHA')

                row = box.row(align=True)
                row.scale_y = 1.3
                op = row.operator("animrename.rename", text="idle (I)")
                op.new_name = "idle"
                op = row.operator("animrename.rename", text="walk (W)")
                op.new_name = "walk"

                row = box.row(align=True)
                row.scale_y = 1.3
                op = row.operator("animrename.rename", text="attack (A)")
                op.new_name = "attack"
                op = row.operator("animrename.rename", text="death (D)")
                op.new_name = "death"

                # Navigation
                layout.separator()
                row = layout.row(align=True)
                row.operator("animrename.prev_animation", text="", icon='TRIA_LEFT')
                row.operator("animrename.toggle_play", text="Play/Pause", icon='PAUSE' if state.is_playing else 'PLAY')
                row.operator("animrename.next_animation", text="", icon='TRIA_RIGHT')

            # Model navigation
            layout.separator()
            row = layout.row(align=True)
            row.scale_y = 1.5
            row.operator("animrename.save_and_next", text="Save & Next", icon='CHECKMARK')
            row.operator("animrename.skip", text="Skip", icon='FORWARD')


# =============================================================================
# KEYMAP
# =============================================================================

addon_keymaps = []

def register_keymaps():
    wm = bpy.context.window_manager
    kc = wm.keyconfigs.addon
    if kc:
        km = kc.keymaps.new(name='3D View', space_type='VIEW_3D')

        kmi = km.keymap_items.new("animrename.rename", 'I', 'PRESS')
        kmi.properties.new_name = "idle"
        addon_keymaps.append((km, kmi))

        kmi = km.keymap_items.new("animrename.rename", 'W', 'PRESS')
        kmi.properties.new_name = "walk"
        addon_keymaps.append((km, kmi))

        kmi = km.keymap_items.new("animrename.rename", 'A', 'PRESS')
        kmi.properties.new_name = "attack"
        addon_keymaps.append((km, kmi))

        kmi = km.keymap_items.new("animrename.rename", 'D', 'PRESS')
        kmi.properties.new_name = "death"
        addon_keymaps.append((km, kmi))

        kmi = km.keymap_items.new("animrename.toggle_play", 'SPACE', 'PRESS')
        addon_keymaps.append((km, kmi))

        kmi = km.keymap_items.new("animrename.next_animation", 'RIGHT_ARROW', 'PRESS')
        addon_keymaps.append((km, kmi))

        kmi = km.keymap_items.new("animrename.prev_animation", 'LEFT_ARROW', 'PRESS')
        addon_keymaps.append((km, kmi))

        kmi = km.keymap_items.new("animrename.save_and_next", 'N', 'PRESS')
        addon_keymaps.append((km, kmi))


def unregister_keymaps():
    for km, kmi in addon_keymaps:
        km.keymap_items.remove(kmi)
    addon_keymaps.clear()


# =============================================================================
# REGISTRATION
# =============================================================================

classes = [
    AnimationEntry,
    AnimRenamerState,
    ANIMRENAME_OT_start,
    ANIMRENAME_OT_load_file,
    ANIMRENAME_OT_select_animation,
    ANIMRENAME_OT_rename,
    ANIMRENAME_OT_next_animation,
    ANIMRENAME_OT_prev_animation,
    ANIMRENAME_OT_toggle_play,
    ANIMRENAME_OT_save_and_next,
    ANIMRENAME_OT_skip,
    ANIMRENAME_OT_batch_rename,
    ANIMRENAME_PT_panel,
]


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.anim_renamer = bpy.props.PointerProperty(type=AnimRenamerState)
    register_keymaps()
    print("Animation Renamer registered! Open sidebar (N) in 3D View -> 'Anim Rename' tab")


def unregister():
    unregister_keymaps()
    del bpy.types.Scene.anim_renamer
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
