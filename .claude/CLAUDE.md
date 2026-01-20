# Claude Code Instructions for VOIDSTRIKE

## Project Overview

VOIDSTRIKE is a browser-based RTS game built with Next.js 14, Three.js r182, and TypeScript.

**Tech Stack:** Next.js 16 | Three.js (WebGPU/TSL) | TypeScript | ECS Architecture | P2P Multiplayer

---

DO NOT CREATE MD FILES UNLESS EXPLICITLY TOLD TO DO SO.

ALWAYS WRITE REFERENCE QUALITY PRODUCTION READY CODE. NEVER LEAVE THINGS INCOMPLETE, CREATE STUBS, ETC.

IF YOU NEED MORE CONTEXT, DO NOT CODE UNTIL YOU FIND IT. DO FREQUENT RESEARCH FOR THE LATEST TECHNIQUES

IF YOU SEE DEAD CODE, DUPLICATE IMPLEMENTATIONS, ETC -> SPEAK UP ABOUT IT NO MATTER IF IT IS RELATED TO YOUR CURRENT TASK.

LAUNCH SUBAGENTS FREQUENTLY, ALWAYS LAUNCH OPUS 4.5 SUBAGENTS

## Documentation Index

Load relevant documentation based on your current task. Don't load everything—be selective.

### Core Documentation (in `docs/`)

| Document | Path | Load When |
|----------|------|-----------|
| **Architecture Overview** | `docs/architecture/OVERVIEW.md` | Starting new features, understanding codebase structure, working with ECS |
| **Networking** | `docs/architecture/networking.md` | Multiplayer features, P2P, netcode, synchronization |
| **Rendering** | `docs/architecture/rendering.md` | Graphics, shaders, post-processing, visual effects |
| **Game Design** | `docs/design/GAME_DESIGN.md` | Units, buildings, factions, game mechanics, balance |
| **Audio Design** | `docs/design/audio.md` | Sound effects, music, audio systems |
| **Schema** | `docs/reference/schema.md` | Database changes, data persistence, entity schemas |
| **Models** | `docs/reference/models.md` | 3D models, GLTF specs, model requirements |
| **Textures** | `docs/reference/textures.md` | Texture specs, UV mapping, material setup |
| **Security** | `docs/security/SECURITY_AUDIT.md` | Security review, vulnerability assessment |

### Project Management (in `.claude/`)

| Document | Path | Purpose |
|----------|------|---------|
| **Templates** | `.claude/templates/` | Templates for new systems, components, tools, features |

### Tools Documentation (in `docs/tools/`)

| Tool | Path | Purpose |
|------|------|---------|
| **Blender Scripts** | `docs/tools/blender/` | Retopology, animation extraction, mesh processing |
| **Asset Pipeline** | `docs/tools/asset-pipeline/` | Meshy AI extraction, asset conversion |
| **Debug Tools** | `docs/tools/debug/` | Effect placement, visual debugging |

---

## Critical Rules

### After EVERY code change, you MUST update relevant documentation:

1. **`docs/reference/schema.md`** - When changing database tables, data structures, or entity schemas

2. **`docs/design/GAME_DESIGN.md`** - When adding units, buildings, abilities, or game mechanics

3. **`docs/architecture/OVERVIEW.md`** - When adding systems, modules, or changing architecture

4. **`docs/architecture/rendering.md`** - When adding shaders, effects, or graphics features

5. **`docs/architecture/networking.md`** - When changing multiplayer or networking code

### Use templates for consistency:
- New ECS system → `.claude/templates/system.md`
- New component → `.claude/templates/component.md`
- New tool/script → `.claude/templates/tool.md`
- New feature → `.claude/templates/feature.md`

---

## Code Standards

### TypeScript
- Strict TypeScript—no `any` unless absolutely necessary
- Prefer interfaces over types for object shapes
- Use enums for finite sets of values

### React Components
- Functional components with hooks
- Single-purpose, focused components
- `'use client'` directive only when needed

### Game Engine (ECS)
- All game state must be deterministic for multiplayer
- Logic in Systems, data in Components
- Use EventBus for cross-system communication
- Use `SeededRandom` from `utils/math.ts` for any randomness

### Singleton Pattern
Use class-based singletons with static methods for global managers:

```ts
export class MySingleton {
  private static instance: MySingleton | null = null;
  private static initPromise: Promise<MySingleton> | null = null;

  private constructor() { /* private constructor */ }

  // Async access (initializes on first call)
  public static async getInstance(): Promise<MySingleton> {
    if (MySingleton.initPromise) return MySingleton.initPromise;
    if (MySingleton.instance) return MySingleton.instance;
    MySingleton.initPromise = (async () => {
      const instance = new MySingleton();
      await instance.initialize();
      MySingleton.instance = instance;
      return instance;
    })();
    return MySingleton.initPromise;
  }

  // Sync access (returns null if not initialized)
  public static getInstanceSync(): MySingleton | null {
    return MySingleton.instance;
  }

  // Reset for game restart
  public static resetInstance(): void {
    MySingleton.instance = null;
    MySingleton.initPromise = null;
  }
}

// Convenience helpers for backward compatibility
export async function getMySingleton(): Promise<MySingleton> {
  return MySingleton.getInstance();
}
export function getMySingletonSync(): MySingleton | null {
  return MySingleton.getInstanceSync();
}
```

Examples: `RecastNavigation`, `WasmBoids`, `PerformanceMonitor`

### Naming Conventions
- Components: `PascalCase.tsx`
- Utilities: `camelCase.ts`
- Constants: `SCREAMING_SNAKE_CASE`
- Interfaces/Types: `PascalCase`

### Comments
Professional, understated. Explain WHY, not WHAT.

```ts
// Bad: "World-Class Particle System"
// Good: "GPU Particle System"

// Bad: "// Get the player entity"
// Good: (no comment needed)

// Bad: "// This elegant solution handles the edge case"
// Good: "// Edge case: entity may be destroyed mid-frame"
```

Acceptable: `// CRITICAL:`, `// Note:`, `// TODO:`, brief JSDoc

---

## Common Tasks Quick Reference

### Adding a New Unit
1. Add to `src/data/units/{faction}.ts`
2. Update `docs/design/GAME_DESIGN.md`
3. Update `.claude/TODO.md`
4. Test in `gameSetup.ts`

### Adding a New Building
1. Add to `src/data/buildings/{faction}.ts`
2. Update `docs/design/GAME_DESIGN.md`
3. Update `docs/reference/schema.md` if new data fields
4. Update `.claude/TODO.md`

### Adding a New System
1. Create in `src/engine/systems/`
2. Register in `Game.ts` → `initializeSystems()`
3. Document in `docs/architecture/OVERVIEW.md` (use `.claude/templates/system.md`)
4. Update `.claude/TODO.md`

### Adding Visual Effects
1. Read `docs/architecture/rendering.md` first
2. Create shader/effect code
3. Update `docs/architecture/rendering.md`
4. Update `.claude/TODO.md`

### Adding Multiplayer Features
1. Read `docs/architecture/networking.md` first
2. Ensure deterministic logic
3. Update `docs/architecture/networking.md`
4. Update `.claude/TODO.md`

---

## Testing

Before committing:
```bash
npm run type-check  # TypeScript validation
npm run lint        # Code style
npm run dev         # Browser test
```

## Commits

Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `style:`, `test:`, `chore:`

---

## File Structure Overview

```
.claude/
├── CLAUDE.md           # This file (always loaded)
├── TODO.md             # Task tracking (update frequently)
└── templates/          # Doc templates for consistency
    ├── system.md
    ├── component.md
    ├── tool.md
    └── feature.md

docs/
├── README.md           # Documentation overview
├── architecture/       # Technical architecture
│   ├── OVERVIEW.md     # System architecture (2600 lines)
│   ├── networking.md   # P2P multiplayer (1500 lines)
│   └── rendering.md    # Graphics pipeline (1100 lines)
├── design/             # Game design
│   ├── GAME_DESIGN.md  # Core design doc
│   └── audio.md        # Audio system
├── reference/          # Technical specs
│   ├── schema.md       # Database schema
│   ├── models.md       # 3D model specs
│   └── textures.md     # Texture specs
├── security/           # Security docs
│   └── SECURITY_AUDIT.md
├── tools/              # Development tools
│   ├── blender/        # Blender scripts
│   ├── asset-pipeline/ # Asset processing
│   └── debug/          # Debug utilities
└── AI_ANALYSIS.md      # AI codebase analysis
```

---

## Remember

**Documentation is the source of truth.** Always update docs when making changes. Load only the docs you need for your current task to preserve context.
