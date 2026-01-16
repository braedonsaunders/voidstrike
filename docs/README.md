# VOIDSTRIKE Documentation

Technical and design documentation for the VOIDSTRIKE RTS game.

## Directory Structure

```
docs/
├── architecture/       # Technical architecture and systems
│   ├── OVERVIEW.md     # Complete architecture overview
│   ├── networking.md   # P2P multiplayer architecture
│   └── rendering.md    # Graphics pipeline and effects
├── design/             # Game design documentation
│   ├── GAME_DESIGN.md  # Core game design document
│   └── audio.md        # Audio system design
├── reference/          # Technical reference material
│   ├── schema.md       # Database schema
│   ├── models.md       # 3D model specifications
│   └── textures.md     # Texture specifications
├── security/           # Security documentation
│   └── SECURITY_AUDIT.md
├── tools/              # Development tools and scripts
│   ├── blender/        # Blender scripts and workflows
│   ├── asset-pipeline/ # Asset processing tools
│   └── debug/          # Debug and testing tools
└── AI_ANALYSIS.md      # AI-generated codebase analysis
```

## Quick Links

### For New Contributors
1. Start with [Architecture Overview](architecture/OVERVIEW.md)
2. Review [Game Design](design/GAME_DESIGN.md)
3. Check the [TODO list](../.claude/TODO.md) for current tasks

### For Specific Tasks

| Task | Read This |
|------|-----------|
| Adding a new unit | [Game Design](design/GAME_DESIGN.md), [Models Reference](reference/models.md) |
| Multiplayer features | [Networking](architecture/networking.md) |
| Visual effects | [Rendering](architecture/rendering.md) |
| Audio/sound | [Audio Design](design/audio.md) |
| Database changes | [Schema](reference/schema.md) |
| Asset creation | [Tools - Blender](tools/blender/README.md) |

## Documentation Standards

- Keep docs up to date when making code changes
- Use templates from `.claude/templates/` for consistency
- Focus on "why" over "what" - code shows what, docs explain why
