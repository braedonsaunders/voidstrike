# Contributing to VOIDSTRIKE

Thank you for your interest in contributing to VOIDSTRIKE. This document outlines the process for contributing to the project.

## Getting Started

```bash
git clone https://github.com/your-username/voidstrike.git
cd voidstrike
npm install
npm run dev
```

Open http://localhost:3000 in Chrome 113+ (WebGPU) or any modern browser (WebGL2 fallback).

## Development Workflow

1. **Fork** the repository
2. **Create a branch** for your feature or fix: `git checkout -b feature/my-feature`
3. **Make your changes** following the code standards below
4. **Test locally**: `npm run type-check && npm run lint && npm run dev`
5. **Commit** with a conventional commit message
6. **Push** and open a Pull Request

## Code Standards

### TypeScript

- Strict TypeScript - avoid `any` unless absolutely necessary
- Prefer interfaces over types for object shapes
- Use enums for finite sets of values

### Naming Conventions

- Components: `PascalCase.tsx`
- Utilities: `camelCase.ts`
- Constants: `SCREAMING_SNAKE_CASE`
- Interfaces/Types: `PascalCase`

### Comments

Professional and understated. Explain WHY, not WHAT.

```typescript
// Bad: "World-Class Particle System"
// Good: "GPU Particle System"

// Bad: "// Get the player entity"
// Good: (no comment needed - code is self-explanatory)

// Good: "// Edge case: entity may be destroyed mid-frame"
```

### Game Engine (ECS)

- All game state must be deterministic for multiplayer
- Logic in Systems, data in Components
- Use `EventBus` for cross-system communication
- Use `SeededRandom` from `utils/math.ts` for any randomness

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `refactor:` - Code change that neither fixes a bug nor adds a feature
- `style:` - Formatting, missing semicolons, etc.
- `test:` - Adding or updating tests
- `chore:` - Build process, dependencies, etc.

Examples:
```
feat: add siege mode to Dominion tanks
fix: prevent units from clumping at rally points
docs: update networking architecture diagram
refactor: extract spatial grid to separate module
```

## Project Structure

```
src/
├── engine/          # Reusable game engine (ECS, systems, networking)
├── rendering/       # Three.js WebGPU rendering pipeline
├── data/            # Game configuration (units, buildings, maps)
└── components/      # React UI layer
```

**Key principle:** Everything in `src/engine/` should be game-agnostic. Everything in `src/data/` is VOIDSTRIKE-specific.

## Areas Where Contributions Are Welcome

### High Priority

- **Unit tests** for ECS core, fixed-point math, and networking
- **Performance benchmarks** with reproducible metrics
- **Bug fixes** with clear reproduction steps

### Medium Priority

- **AI improvements** - better micro, smarter macro decisions
- **New TSL shader effects** - weather, time of day, etc.
- **Accessibility** - keyboard navigation, screen reader support

### Lower Priority

- Additional factions or units (discuss in an issue first)
- Major architectural changes (discuss in an issue first)

## Before Submitting

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] Changes work in both WebGPU and WebGL2 modes
- [ ] Multiplayer changes maintain determinism
- [ ] Documentation updated if adding new systems

## Questions?

Open an issue for:
- Bug reports (include reproduction steps)
- Feature proposals (describe the use case)
- Architecture questions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
