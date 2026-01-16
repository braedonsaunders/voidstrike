# Component Template

Use this template when documenting a new ECS component.

## Template

```markdown
### {ComponentName}

**File:** `src/engine/components/{filename}.ts`
**Category:** {Core | Rendering | Physics | AI | UI | Network}

**Purpose:**
{One-line description}

**Properties:**
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| {name} | {type} | {default} | {description} |

**Used By Systems:**
- {SystemName}: {how it uses this component}

**Serialization:**
- Networked: {yes/no}
- Persisted: {yes/no}
```

## Example

```markdown
### Health

**File:** `src/engine/components/Health.ts`
**Category:** Core

**Purpose:**
Tracks entity health and damage state.

**Properties:**
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| current | number | 100 | Current health points |
| max | number | 100 | Maximum health points |
| armor | number | 0 | Damage reduction |
| lastDamageTime | number | 0 | Timestamp of last damage taken |

**Used By Systems:**
- CombatSystem: Applies damage and checks for death
- HealthBarSystem: Renders health bar UI
- RegenerationSystem: Applies health regen over time

**Serialization:**
- Networked: yes
- Persisted: yes
```
