# System Template

Use this template when documenting a new ECS system in `docs/architecture/OVERVIEW.md`.

## Template

```markdown
### {SystemName}

**File:** `src/engine/systems/{filename}.ts`
**Priority:** {number} (lower = runs earlier)
**Dependencies:** {list of systems this depends on}

**Purpose:**
{One-line description of what this system does}

**Queries:**
- `{queryName}`: Entities with [{Component1}, {Component2}]

**Events Emitted:**
- `{eventName}`: {when emitted}

**Events Consumed:**
- `{eventName}`: {what it does in response}

**Key Methods:**
- `update(delta)`: {brief description}
- `{otherMethod}()`: {brief description}
```

## Example

```markdown
### MovementSystem

**File:** `src/engine/systems/MovementSystem.ts`
**Priority:** 100
**Dependencies:** PhysicsSystem

**Purpose:**
Applies velocity to entity positions each frame.

**Queries:**
- `movingEntities`: Entities with [Position, Velocity]

**Events Emitted:**
- `entityMoved`: When an entity's position changes

**Events Consumed:**
- `terrainUpdated`: Recalculates valid movement paths

**Key Methods:**
- `update(delta)`: Applies velocity * delta to positions
- `setVelocity(entity, vel)`: Updates entity velocity with validation
```
