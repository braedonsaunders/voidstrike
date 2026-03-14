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

### `/launch`

Single-click local launch helpers:

- **launch-voidstrike.js** - Shared production launcher that builds first, picks the next open port starting at `3000`, opens the browser, and keeps logs attached to the terminal session
- **launch-voidstrike.command** - macOS single-click launcher wrapper
- **launch-voidstrike.bat** - Windows single-click launcher wrapper
- **launch-voidstrike.desktop** - Linux desktop entry that opens the launcher in a terminal window

## Adding New Tools

1. Place the tool in the appropriate subdirectory
2. Document it using the template at `.claude/templates/tool.md`
3. Update this README with a brief description
