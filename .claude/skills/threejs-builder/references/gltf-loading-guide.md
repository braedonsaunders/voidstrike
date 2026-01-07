# GLTF Loading Guide for Three.js

Modern patterns for loading and managing 3D models.

---

## Quick Start

```html
<!DOCTYPE html>
<html>
<head>
  <style>body { margin: 0; }</style>
</head>
<body>
  <script type="importmap">
    {
      "imports": {
        "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
        "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
      }
    }
  </script>
  <script type="module">
    import * as THREE from 'three';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
    camera.position.set(0, 2, 5);
    camera.lookAt(0, 1, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(5, 10, 5);
    scene.add(sun);

    // Load model
    const loader = new GLTFLoader();
    loader.load('/models/character.glb', (gltf) => {
      scene.add(gltf.scene);
    });

    renderer.setAnimationLoop(() => {
      renderer.render(scene, camera);
    });
  </script>
</body>
</html>
```

---

## Import Maps

Import maps resolve Three.js module paths correctly:

```html
<script type="importmap">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
      "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
    }
  }
</script>
```

This allows clean imports like:
```javascript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
```

---

## Loading Patterns

### 1. Basic Loading with Shadows

```javascript
loader.load('/models/model.glb', (gltf) => {
  gltf.scene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  scene.add(gltf.scene);
});
```

### 2. Promise-Based Loading

```javascript
function loadModel(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

// Usage
const gltf = await loadModel('/models/character.glb');
scene.add(gltf.scene);
```

### 3. Production-Ready with Fallback

```javascript
async function loadModelWithFallback(url, fallbackGeometry) {
  try {
    const gltf = await loadModel(url);
    return gltf.scene;
  } catch (error) {
    console.warn(`Failed to load ${url}, using fallback`);
    const material = new THREE.MeshStandardMaterial({ color: 0xff00ff });
    return new THREE.Mesh(fallbackGeometry, material);
  }
}
```

### 4. Batch Loading

```javascript
async function loadModels(urls) {
  const models = {};
  for (const [name, url] of Object.entries(urls)) {
    try {
      const gltf = await loadModel(url);
      models[name] = gltf;
    } catch (e) {
      console.error(`Failed to load ${name}:`, e);
    }
  }
  return models;
}

// Usage
const models = await loadModels({
  hero: '/models/hero.glb',
  enemy: '/models/enemy.glb',
  prop: '/models/prop.glb'
});
```

### 5. Caching and Reuse

```javascript
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';

const modelCache = new Map();

async function getCachedModel(url) {
  if (!modelCache.has(url)) {
    const gltf = await loadModel(url);
    modelCache.set(url, gltf);
  }
  return modelCache.get(url);
}

// For animated/skinned models, MUST use SkeletonUtils.clone()
async function spawnInstance(url) {
  const gltf = await getCachedModel(url);
  const instance = SkeletonUtils.clone(gltf.scene);
  const mixer = new THREE.AnimationMixer(instance);
  return { instance, mixer, clips: gltf.animations };
}
```

> **Critical**: `SkeletonUtils.clone()` is **required** for animated/skinned models. Regular `.clone()` breaks bone references!

### 6. Model Normalization

```javascript
function normalizeModel(root, targetHeight) {
  // Get bounds from VISIBLE geometry only
  const box = new THREE.Box3();
  root.traverse((child) => {
    if (child.isMesh && child.visible) {
      const childBox = new THREE.Box3().setFromObject(child);
      box.union(childBox);
    }
  });

  // Scale to target height
  const size = box.getSize(new THREE.Vector3());
  if (size.y > 0) {
    const scale = targetHeight / size.y;
    root.scale.setScalar(scale);
  }

  // Update and recalculate bounds
  root.updateMatrixWorld(true);
  box.setFromObject(root);

  // Ground the model (set bottom at y=0)
  root.position.y = -box.min.y;
}
```

> **Warning**: Using `Box3.setFromObject()` on animated models includes invisible skeleton bones, causing models to appear to float. Always compute bounds from visible mesh geometry only.

---

## Common Pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| 404 error | Wrong path | Check file location, use DevTools Network tab |
| Model invisible | Wrong scale or position | Log `gltf.scene.position` and `scale` |
| Model rotated wrong | Blender export faces -Z | Rotate: `model.rotation.y = Math.PI` |
| Animated model floats | Box3 includes bones | Use visible mesh geometry only |
| Cloned model breaks | Used `.clone()` on skinned mesh | Use `SkeletonUtils.clone()` |
| No shadows | Shadows not enabled | Set `castShadow`/`receiveShadow` |
| Performance issues | Too many draw calls | Use instancing or merge geometry |
| Black model | No lights in scene | Add ambient and directional lights |
| Colors wrong | Color space mismatch | Set `renderer.outputColorSpace = THREE.SRGBColorSpace` |

---

## Animations

```javascript
loader.load('/models/character.glb', (gltf) => {
  const model = gltf.scene;
  scene.add(model);

  // Create mixer
  const mixer = new THREE.AnimationMixer(model);

  // Log available animations
  console.log('Animations:', gltf.animations.map(a => a.name));

  // Play first animation
  if (gltf.animations.length > 0) {
    const action = mixer.clipAction(gltf.animations[0]);
    action.play();
  }

  // Update in animation loop
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    mixer.update(clock.getDelta());
    renderer.render(scene, camera);
  });
});
```

---

## Draco Compression

For compressed .glb files:

```javascript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);
```

---

## Best Practices

| Practice | Reason |
|----------|--------|
| Use import maps | Clean imports, easy version management |
| Normalize models | Consistent scale across assets |
| Cache loaded models | Avoid duplicate network requests |
| Use SkeletonUtils for animated | Preserves bone hierarchy |
| Handle loading errors | Graceful degradation |
| Enable shadows explicitly | Not on by default |
| Log animation names | Clips vary by export settings |

---

## GLTF Object Structure

```javascript
gltf = {
  scene: THREE.Group,      // Root of the model
  scenes: [...],           // All scenes (usually just one)
  animations: [...],       // AnimationClip array
  cameras: [...],          // Cameras defined in file
  asset: {...},            // Metadata (version, generator)
  parser: {...}            // Internal parser reference
}
```

### Callback Signatures

```javascript
loader.load(
  url,                          // string
  (gltf) => {},                 // onLoad
  (progress) => {},             // onProgress (ProgressEvent)
  (error) => {}                 // onError
);
```
