# Development Tools

Scripts and utilities for VOIDSTRIKE development.

## Directories

### `/blender`
Blender scripts for 3D asset creation and processing:
- **auto_retopo.py** - Automatic retopology for game-ready meshes
- **extract_animation_names.py** - Extract animation data from files
- **rename_animations.py** - Batch rename animations

See [Blender README](blender/README.md) for detailed workflows.

### `/asset-pipeline`
Asset processing and conversion tools:
- **extract_meshy_zips.py** - Extract and organize Meshy AI outputs

### `/debug`
Debugging and testing utilities:
- **effect-placer.html** - Visual tool for positioning effects in-game

## Adding New Tools

1. Place the tool in the appropriate subdirectory
2. Document it using the template at `.claude/templates/tool.md`
3. Update this README with a brief description
