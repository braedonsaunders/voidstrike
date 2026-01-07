# Three.js Builder

> A comprehensive guide to creating simple, performant Three.js web applications using modern ES module patterns (r150+).

## Before You Build

Think in terms of the **scene graph mental model**:

- The scene is a tree of objects
- Parent transformations cascade to children
- Every visible item needs: geometry + material + added to scene

Ask yourself:

1. What's the **core visual element**?
2. What **interaction** do I need?
3. What **performance constraints** exist?
4. What **animation** brings it to life?

---

## Coordinate System (Critical!)

Three.js uses **right-handed coordinates**:

- **+Y** points up
- **+X** points right
- **+Z** points toward the camera

> **GLTF models exported from Blender/Maya face -Z (into the screen) by default.**

This means if you want a model to face +X (right), you need to rotate it by `Math.PI / 2` around Y.

### Camera-Relative Movement

If your camera is angled (like an isometric view), raw axis input will feel wrong. You need camera-relative directions:

```javascript
// Get camera's forward direction, projected onto ground (XZ plane)
const forward = new THREE.Vector3();
camera.getWorldDirection(forward);
forward.y = 0;
forward.normalize();

// Right is perpendicular to forward
const right = new THREE.Vector3();
right.crossVectors(forward, new THREE.Vector3(0, 1, 0));
right.normalize();

// Apply input relative to camera
const moveDir = new THREE.Vector3();
moveDir.addScaledVector(forward, inputZ); // W/S
moveDir.addScaledVector(right, inputX);   // A/D
```

---

## Minimal Setup Template

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; overflow: hidden; }
    canvas { display: block; }
  </style>
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

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    // Camera
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 2, 5);
    camera.lookAt(0, 0, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 1);
    directional.position.set(5, 10, 5);
    scene.add(directional);

    // Your content here
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x4a90d9 });
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);

    // Animation loop
    renderer.setAnimationLoop(() => {
      cube.rotation.y += 0.01;
      renderer.render(scene, camera);
    });

    // Resize handling
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  </script>
</body>
</html>
```

---

## Built-in Geometries

| Geometry | Constructor | Use Case |
|----------|-------------|----------|
| BoxGeometry | `(w, h, d)` | Cubes, buildings |
| SphereGeometry | `(r, wSeg, hSeg)` | Balls, planets |
| CylinderGeometry | `(rTop, rBot, h, seg)` | Pillars, cans |
| TorusGeometry | `(r, tube, radSeg, tubeSeg)` | Rings, donuts |
| PlaneGeometry | `(w, h)` | Ground, walls |
| ConeGeometry | `(r, h, seg)` | Arrows, trees |
| IcosahedronGeometry | `(r, detail)` | Low-poly spheres |

---

## Materials Quick Reference

| Material | Lighting | Use Case |
|----------|----------|----------|
| MeshBasicMaterial | None | UI, unlit effects |
| MeshStandardMaterial | PBR | Realistic surfaces |
| MeshPhysicalMaterial | PBR+ | Glass, clearcoat |
| MeshNormalMaterial | None | Debugging normals |
| MeshPhongMaterial | Phong | Fast legacy option |

```javascript
// Standard PBR material
const material = new THREE.MeshStandardMaterial({
  color: 0x4a90d9,
  roughness: 0.5,
  metalness: 0.5,
});
```

---

## Lighting Patterns

**Without lights, only BasicMaterial and NormalMaterial will render!**

```javascript
// Ambient: base illumination
const ambient = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambient);

// Directional: sun-like, parallel rays
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(5, 10, 5);
scene.add(sun);

// Point: bulb-like, radiates in all directions
const bulb = new THREE.PointLight(0xff6600, 1, 10);
bulb.position.set(0, 2, 0);
scene.add(bulb);

// Spot: cone of light with focus
const spot = new THREE.SpotLight(0xffffff, 1, 20, Math.PI / 6);
spot.position.set(0, 5, 0);
spot.target.position.set(0, 0, 0);
scene.add(spot);
scene.add(spot.target);
```

---

## Animation Patterns

```javascript
// Continuous rotation
mesh.rotation.y += 0.01;

// Bobbing motion
mesh.position.y = Math.sin(Date.now() * 0.002) * 0.5;

// Mouse tracking (rotation)
document.addEventListener('mousemove', (e) => {
  const x = (e.clientX / window.innerWidth) * 2 - 1;
  const y = (e.clientY / window.innerHeight) * 2 - 1;
  mesh.rotation.x = y * 0.5;
  mesh.rotation.y = x * 0.5;
});
```

---

## OrbitControls (Camera Interaction)

```javascript
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 2;
controls.maxDistance = 20;

// Update in animation loop
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
```

---

## Anti-Patterns (Don't Do This)

| Problem | Fix |
|---------|-----|
| Creating geometry in animation loop | Create once, transform it |
| Excessive segments (`new SphereGeometry(1, 128, 128)`) | Use defaults or lower |
| Forgetting pixel ratio cap | `Math.min(devicePixelRatio, 2)` |
| Hardcoding everything | Extract to config objects |
| Everything in one function | Separate init, animate, helpers |

---

## Further Reading

See the `references/` folder for detailed guides on:

- **gltf-loading-guide.md** - Loading 3D models
- **reference-frame-contract.md** - Calibrating assets
- **game-patterns.md** - Game-specific techniques
- **advanced-topics.md** - Post-processing, physics, etc.

See the `scripts/` folder for:

- **gltf-calibration-helpers.mjs** - Visual calibration tools
