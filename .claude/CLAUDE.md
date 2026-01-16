# Claude Code Instructions for VOIDSTRIKE

## Project Overview

VOIDSTRIKE is a browser-based RTS game built with Next.js 14, Three.js, and TypeScript. This file contains instructions for LLMs working on this codebase.

## Critical Rules

### After EVERY code change, you MUST:

1. **Update the TODO.md file** in `.claude/TODO.md`:
   - Mark completed tasks as `[x]`
   - Add new tasks as `[ ]`
   - Move in-progress tasks to the current phase section
   - Remove obsolete or cancelled tasks

2. **Update the SCHEMA.md file** in `.claude/SCHEMA.md` when:
   - Adding new database tables or columns
   - Modifying existing schema
   - Adding new data structures that will be persisted
   - Changing relationships between entities

3. **Update the DESIGN.md file** in `.claude/DESIGN.md` when:
   - Adding new game mechanics
   - Changing existing gameplay systems
   - Adding new unit types, abilities, or buildings
   - Modifying the faction design
   - Changing UI/UX patterns

4. **Update the ARCHITECTURE.md file** in `.claude/ARCHITECTURE.md` when:
   - Adding new directories or major files
   - Creating new systems or modules
   - Changing data flow patterns
   - Adding new rendering pipelines
   - Modifying the ECS structure

5. **Update the GRAPHICS.md file** in `.claude/GRAPHICS.md` when:
   - Adding new post-processing effects
   - Modifying the render pipeline
   - Adding new shaders or TSL nodes
   - Changing graphics settings/options
   - Implementing new visual features (SSR, SSGI, etc.)

## File Organization

```
.claude/
├── CLAUDE.md       # This file - LLM instructions
├── DESIGN.md       # Game design document
├── SCHEMA.md       # Database schema documentation
├── TODO.md         # Development roadmap and task tracking
├── ARCHITECTURE.md # Technical architecture overview
└── GRAPHICS.md     # Graphics pipeline and effects documentation
```

## Code Standards

### TypeScript
- Use strict TypeScript - no `any` types unless absolutely necessary
- Prefer interfaces over types for object shapes
- Use enums for finite sets of values
- Document complex functions with JSDoc comments

### React Components
- Use functional components with hooks
- Keep components focused and single-purpose
- Use `'use client'` directive only when needed
- Prefer composition over prop drilling

### Game Engine
- All game state must be deterministic for multiplayer
- Use the ECS pattern for game entities
- Keep game logic in Systems, not Components
- Use the EventBus for cross-system communication

### Naming Conventions
- Components: PascalCase (e.g., `GameCanvas.tsx`)
- Utilities: camelCase (e.g., `gameSetup.ts`)
- Constants: SCREAMING_SNAKE_CASE
- Interfaces: PascalCase with `I` prefix optional
- Types: PascalCase

### Comments
Write professional, understated comments. Avoid marketing-speak and filler.

**Never use:**
- "World-class", "premium", "elegant", "robust", "comprehensive"
- "Beautiful", "stunning", "cutting-edge", "state-of-the-art"
- "This function does...", "This method handles..." (the code shows what it does)
- Overly promotional file headers

**Good comments explain WHY, not WHAT:**
```ts
// Bad: "World-Class Particle System for Premium Combat Effects"
// Good: "GPU Particle System"

// Bad: "// Get the player entity"
// Good: (no comment needed - code is self-explanatory)

// Bad: "// This elegant solution handles the edge case"
// Good: "// Edge case: entity may be destroyed mid-frame"
```

**Acceptable comment styles:**
- `// CRITICAL:` or `// IMPORTANT:` for non-obvious gotchas
- `// Note:` for explaining unexpected behavior
- `// TODO:` for future work (with context)
- Brief JSDoc for public APIs

## Common Tasks

### Adding a New Unit Type
1. Add definition to `src/data/units/{faction}.ts`
2. Update DESIGN.md with unit stats/abilities
3. Update TODO.md if this completes a roadmap item
4. Test spawning in `gameSetup.ts`

### Adding a New Building Type
1. Add definition to `src/data/buildings/{faction}.ts`
2. Update DESIGN.md with building details
3. Update SCHEMA.md if building has new data fields
4. Update TODO.md

### Adding a New System
1. Create system in `src/engine/systems/`
2. Register in `Game.ts` initializeSystems()
3. Update ARCHITECTURE.md with system description
4. Update TODO.md

### Adding UI Components
1. Create component in `src/components/game/` or `src/components/ui/`
2. Update ARCHITECTURE.md if significant
3. Update TODO.md

## Multiplayer Considerations

- All game logic must be deterministic
- Use `SeededRandom` from utils/math.ts for randomness
- Only player inputs should be transmitted, not state
- Test with checksums to detect desync

## Testing Changes

Before committing:
1. Run `npm run type-check` to verify TypeScript
2. Run `npm run lint` to check code style
3. Test in browser with `npm run dev`

## Commit Messages

Use conventional commits:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `style:` Formatting changes
- `test:` Adding tests
- `chore:` Maintenance tasks

## Remember

**ALWAYS update documentation after making changes!**

The documentation files in `.claude/` are the source of truth for project status and design decisions. Keeping them updated ensures continuity across sessions and helps maintain project organization.
