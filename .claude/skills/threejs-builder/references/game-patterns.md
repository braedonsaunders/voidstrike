# Three.js Game Patterns

Techniques and patterns for building games with Three.js.

---

## Animation System

### Safe Animation Selection

```javascript
const DANGEROUS_ANIMATIONS = ['death', 'die', 'dead'];

function selectSafeAnimation(clips, preferredNames) {
  for (const name of preferredNames) {
    const clip = clips.find(c =>
      c.name.toLowerCase().includes(name.toLowerCase()) &&
      !DANGEROUS_ANIMATIONS.some(d => c.name.toLowerCase().includes(d))
    );
    if (clip) return clip;
  }
  return clips[0]; // Fallback to first clip
}
```

### Animation Crossfading

> **Warning**: Calling `reset()` on an already-playing action causes frame freezing!

```javascript
function crossfadeTo(mixer, currentAction, nextAction, duration = 0.3) {
  nextAction.enabled = true;
  nextAction.setEffectiveTimeScale(1);
  nextAction.setEffectiveWeight(1);
  nextAction.time = 0;

  if (currentAction) {
    currentAction.crossFadeTo(nextAction, duration, true);
  }

  nextAction.play();
  return nextAction;
}
```

---

## Game State Management

```javascript
const GameState = {
  LOADING: 'loading',
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAME_OVER: 'game_over'
};

class GameManager {
  constructor() {
    this.state = GameState.LOADING;
    this.mixer = null;
  }

  update(deltaTime) {
    // Always update animations regardless of state
    if (this.mixer) {
      this.mixer.update(deltaTime);
    }

    switch (this.state) {
      case GameState.PLAYING:
        this.updateGameplay(deltaTime);
        break;
      case GameState.PAUSED:
        // Still render, but don't update game logic
        break;
      case GameState.GAME_OVER:
        this.updateGameOver(deltaTime);
        break;
    }
  }
}
```

---

## Visual Effects

### Camera Shake

```javascript
class CameraShake {
  constructor(camera) {
    this.camera = camera;
    this.originalPosition = camera.position.clone();
    this.intensity = 0;
    this.decay = 0.9;
  }

  trigger(intensity = 0.5) {
    this.intensity = intensity;
  }

  update() {
    if (this.intensity > 0.01) {
      this.camera.position.x = this.originalPosition.x + (Math.random() - 0.5) * this.intensity;
      this.camera.position.y = this.originalPosition.y + (Math.random() - 0.5) * this.intensity;
      this.intensity *= this.decay;
    } else {
      this.camera.position.copy(this.originalPosition);
      this.intensity = 0;
    }
  }
}
```

### Screen Flash

```javascript
function createFlashOverlay() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: white;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.1s;
  `;
  document.body.appendChild(overlay);

  return {
    flash(duration = 100) {
      overlay.style.opacity = '0.8';
      setTimeout(() => {
        overlay.style.opacity = '0';
      }, duration);
    }
  };
}
```

### Zoom Pulse

```javascript
function zoomPulse(camera, intensity = 1.2, duration = 200) {
  const originalFov = camera.fov;
  const targetFov = originalFov / intensity;

  camera.fov = targetFov;
  camera.updateProjectionMatrix();

  setTimeout(() => {
    camera.fov = originalFov;
    camera.updateProjectionMatrix();
  }, duration);
}
```

### Squash and Stretch

```javascript
function squashStretch(mesh, axis = 'y', factor = 0.8) {
  const originalScale = mesh.scale.clone();

  // Squash along axis, stretch on others to maintain volume
  if (axis === 'y') {
    mesh.scale.y = originalScale.y * factor;
    mesh.scale.x = originalScale.x * (1 / Math.sqrt(factor));
    mesh.scale.z = originalScale.z * (1 / Math.sqrt(factor));
  }

  // Animate back
  const tween = () => {
    mesh.scale.lerp(originalScale, 0.2);
    if (mesh.scale.distanceTo(originalScale) > 0.01) {
      requestAnimationFrame(tween);
    } else {
      mesh.scale.copy(originalScale);
    }
  };
  tween();
}
```

---

## Object Pooling

```javascript
class ObjectPool {
  constructor(factory, initialSize = 10) {
    this.factory = factory;
    this.pool = [];
    this.active = new Set();

    for (let i = 0; i < initialSize; i++) {
      this.pool.push(factory());
    }
  }

  get() {
    let obj = this.pool.pop();
    if (!obj) {
      obj = this.factory();
    }
    this.active.add(obj);
    return obj;
  }

  release(obj) {
    if (this.active.has(obj)) {
      this.active.delete(obj);
      this.pool.push(obj);
    }
  }

  update(callback) {
    for (const obj of this.active) {
      callback(obj);
    }
  }
}

// Usage
const bulletPool = new ObjectPool(() => {
  const geometry = new THREE.SphereGeometry(0.1);
  const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  return new THREE.Mesh(geometry, material);
}, 50);
```

> **Warning**: Don't create objects inside game loops—it causes memory leaks!

---

## Parallax Layers

```javascript
class ParallaxLayer {
  constructor(mesh, depth) {
    this.mesh = mesh;
    this.depth = depth; // 0 = foreground, 1 = background
    this.basePosition = mesh.position.clone();
  }

  update(cameraX, cameraY) {
    const parallaxFactor = 1 - this.depth * 0.8;
    this.mesh.position.x = this.basePosition.x - cameraX * parallaxFactor;
    this.mesh.position.y = this.basePosition.y - cameraY * parallaxFactor * 0.5;
  }
}
```

---

## Camera Setup for Games

**Don't use OrbitControls in games** - it's for 3D viewers, not gameplay.

### Fixed Camera (Side-scroller)

```javascript
// GLTF models typically face -Z
// Rotate to face +X (right) for side-scrollers
model.rotation.y = Math.PI / 2;

// Or face -X (left)
model.rotation.y = -Math.PI / 2;

// Fixed camera position
camera.position.set(0, 5, 15);
camera.lookAt(0, 2, 0);
```

### Follow Camera

```javascript
class FollowCamera {
  constructor(camera, target, offset = new THREE.Vector3(0, 5, 10)) {
    this.camera = camera;
    this.target = target;
    this.offset = offset;
    this.smoothing = 0.1;
  }

  update() {
    const targetPos = this.target.position.clone().add(this.offset);
    this.camera.position.lerp(targetPos, this.smoothing);
    this.camera.lookAt(this.target.position);
  }
}
```

---

## Near-Miss Detection

```javascript
function checkNearMiss(player, obstacle, threshold = 0.5) {
  const distance = player.position.distanceTo(obstacle.position);
  const wasClose = distance < threshold;
  const justPassed = player.position.x > obstacle.position.x; // Assuming left-to-right

  if (wasClose && justPassed && !obstacle.userData.nearMissTriggered) {
    obstacle.userData.nearMissTriggered = true;
    return true; // Near miss!
  }
  return false;
}
```

---

## Time Scaling (Slow Motion)

```javascript
class TimeController {
  constructor() {
    this.scale = 1;
    this.lastTime = performance.now();
  }

  update() {
    const now = performance.now();
    const realDelta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    return realDelta * this.scale;
  }

  slowMotion(duration = 1000, scale = 0.2) {
    this.scale = scale;
    setTimeout(() => {
      this.scale = 1;
    }, duration * scale); // Adjust for perceived time
  }
}
```

---

## Pattern Reference

| Pattern | Use Case |
|---------|----------|
| Object Pooling | Bullets, particles, obstacles |
| Camera Shake | Explosions, impacts |
| Screen Flash | Damage, pickups |
| Squash/Stretch | Jumps, bounces |
| Parallax | 2.5D depth |
| Time Scaling | Dramatic moments |
| Near Miss | Score bonuses |

---

## Anti-Patterns

| Don't | Do |
|-------|-----|
| Mix real-time and scaled-time | Use TimeController consistently |
| Create objects in update loop | Use object pooling |
| Use OrbitControls for gameplay | Write custom camera logic |
| Hardcode animation names | Use fuzzy matching with fallbacks |
| Call `action.reset()` carelessly | Use crossfade patterns |
