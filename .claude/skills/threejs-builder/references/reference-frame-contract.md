# Reference Frame Contract (Three.js)

## Calibration & Guardrails

Most production bugs in Three.js scenes are **reference-frame bugs**, not rendering bugs. If you lock a "contract" up front, you avoid weeks of symptom-chasing (floating models, inverted axes, broken animations, weird colors, hung state transitions).

---

## 1. The Contract (Write These Down)

### Axes

- **World axes**: +X right, +Y up, +Z ??? (your gameplay forward)
- **Camera conventions**: Do you treat camera forward as "player forward"?
- **Per-asset forward**: Does this asset pack face `-Z`, `+Z`, or something else?
  - Result: A single `MODEL_FORWARD_OFFSET` (radians) or a per-asset override

### Anchors ("What is ground?")

Define how each asset class is anchored relative to y=0:

- **Characters**: Bottom at y=0 (`minY = 0`)
- **Props**: Bottom at y=0 (`minY = 0`)
- **Ground tiles/blocks**: Walkable top at y=0 (`maxY = 0`) is often the right choice

### Units / Scale

- What is 1 unit? (meters-ish, tile-sized, etc.)
- Define target heights in world units:
  - `HERO_HEIGHT`, `ENEMY_HEIGHT`, etc.

### Color / Output

Set and keep consistent:

```javascript
renderer.outputColorSpace = THREE.SRGBColorSpace;
```

If you use atlas-textured GLTFs:
- Keep `material.color` near white (tinting by multiplication often corrupts the look)

### Loading Environment

- GLTF must be served over HTTP (avoid `file://`), or loaders may fail silently / behave differently

### State Transitions

- One state machine, one transition function, one-way latches for terminal events (`hasEnded`)

### UI Scaling

- Center via layout (flex/grid) and apply `scale()` only
- Avoid mixing `translate()` + `scale()` unless you're very deliberate about `transform-origin`

---

## 2. 60-Second Calibration Pass

Do this before gameplay:

### Step 1: Add Helpers

```javascript
scene.add(new THREE.AxesHelper(2));
scene.add(new THREE.GridHelper(10, 10));
// Add a known ground datum at y=0 (plane or your ground tile)
```

### Step 2: Load One GLTF Per Class

Character, enemy, ground tile, a prop.

### Step 3: Visualize Bounds + Pivot

```javascript
obj.add(new THREE.AxesHelper(0.5));
scene.add(new THREE.Box3Helper(new THREE.Box3().setFromObject(obj), 0xff00ff));
```

### Step 4: Print Animation Clip Names

```javascript
console.log(gltf.animations.map(a => a.name));
```

### Step 5: Confirm Output Color Space

```javascript
renderer.outputColorSpace = THREE.SRGBColorSpace;
```

### Step 6: Decide Constants

- `MODEL_FORWARD_OFFSET` (and/or per-asset overrides)
- Anchor mode per asset type (`minY` vs `maxY`)

---

## 3. Forward Direction Check

You want a deterministic answer to: **"Which way is forward for this mesh?"**

Three.js convention:
- An `Object3D`'s forward direction is its **local `-Z` axis**

### Visualize Forward

```javascript
// After normalization and any yaw offsets
const modelRoot = instanceRoot;

modelRoot.add(new THREE.AxesHelper(0.6));

// Visualize local forward (-Z) as a magenta arrow
const localForward = new THREE.Vector3(0, 0, -1);
const arrow = new THREE.ArrowHelper(
  localForward,
  new THREE.Vector3(0, 1.2, 0),
  1.2,
  0xff00ff
);
modelRoot.add(arrow);

// Log world-forward (the object's -Z axis in world coordinates)
const worldForward = new THREE.Vector3();
modelRoot.getWorldDirection(worldForward);
console.log('model world forward (-Z):', worldForward.toArray());
```

### Lock the Result

- Prefer `yawOffset` per asset class (hero vs enemies)
- Or one `MODEL_YAW_OFFSET` if the whole pack is consistent
- Keep this separate from gameplay heading (don't "fix" movement vectors to compensate for wrong mesh forward)

---

## 4. Anchoring Pattern

Normalize imported scenes once, into an anchor wrapper. Then position the wrapper in world space.

```javascript
function normalizeToAnchor(root, { targetHeight, anchor = 'minY' }) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());

  if (size.y > 0) {
    root.scale.setScalar(targetHeight / size.y);
  }

  root.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(root);
  const y = anchor === 'maxY' ? -box2.max.y : -box2.min.y;
  root.position.y += y;

  root.updateMatrixWorld(true);
}
```

### Rules

- Use **one anchor rule per asset class**
- Don't compensate by moving the entire world group
- Don't mix "surfaceY" computations with per-entity offsets unless you have a clearly defined second contract

---

## 5. Camera-Relative Movement Basis

Avoid inverted WASD:

```javascript
const up = new THREE.Vector3(0, 1, 0);
const forward = new THREE.Vector3();
camera.getWorldDirection(forward);
forward.y = 0;
forward.normalize();

// Right-handed: right = forward × up
const right = new THREE.Vector3().crossVectors(forward, up).normalize();
```

If left/right is inverted:
- Check the cross product order first
- If your camera points "backward" relative to gameplay forward, you may need `forward.negate()` — fix the convention, not the key mapping

---

## 6. GLTF Loading & Animation Reliability

### Animated Instancing

If a model has bones/skin, use:

```javascript
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';

const instance = SkeletonUtils.clone(gltf.scene);
const mixer = new THREE.AnimationMixer(instance);
```

### Clip Selection

- Select clips by exact name (log them first)
- Only use substring/heuristic matching as an explicit fallback strategy

### Atlas Tinting

If your pack uses atlas textures:
- Avoid `material.color.multiply(...)` tinting (can turn everything into flat tinted planes)
- Prefer emissive, lighting, or a carefully chosen single `material.color.setHex(...)` if the pack expects it

---

## 7. Timeout "Hang" Guardrail

**Symptoms**: Timer hits ~0.8s/0.0s and the game appears stuck.

**Common causes**:
- Multiple systems trigger end state (timer, slowmo, submit) without a latch
- `timeLeft` goes negative and your UI/logic path assumes `> 0`

**Fix pattern**:

```javascript
// Clamp time
timeLeft = Math.max(0, timeLeft - dt);

// One-way latch
if (hasEnded) return; // Early exit from timer/update

// End transition sets latch and runs exactly once
if (shouldEnd && !hasEnded) {
  hasEnded = true;
  triggerEndSequence();
}
```

---

## 8. Quick Troubleshooting Map

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Model floats / sinks | Anchor contract missing (minY vs maxY mismatch) | Normalize with correct anchor |
| Forward/back inverted | Asset pack forward differs from expected | Set `MODEL_FORWARD_OFFSET` after calibration |
| Left/right inverted | Wrong basis (`cross` order) or inconsistent forward convention | Check cross product order |
| Red/flat planes | Color space not set OR atlas materials tinted incorrectly OR load failed | Set `outputColorSpace`, check fallback geometry |
| Canvas not centered | transform-origin/translate+scale drift | Center via layout, scale only |
| Animation broken after clone | Used `.clone()` instead of `SkeletonUtils.clone()` | Use SkeletonUtils for skinned meshes |
| Game hangs at end | Multiple end triggers without latch | Use one-way `hasEnded` flag |

---

## Contract Checklist

Before starting gameplay code:

- [ ] Defined world coordinate conventions
- [ ] Set `MODEL_FORWARD_OFFSET` or per-asset yaw offsets
- [ ] Decided anchor mode per asset class
- [ ] Set target heights in world units
- [ ] Configured `renderer.outputColorSpace`
- [ ] Tested with calibration helpers (axes, bounds, forward arrow)
- [ ] Logged animation clip names
- [ ] Verified camera-relative movement works correctly
