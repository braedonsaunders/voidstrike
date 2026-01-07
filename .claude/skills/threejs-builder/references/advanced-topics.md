# Advanced Three.js Topics

Progressive disclosure reference for topics beyond basic scene creation.

---

## Model Loading (GLTF/GLB)

```javascript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
loader.load(
  '/models/character.glb',
  (gltf) => {
    scene.add(gltf.scene);

    // If animated
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]);
    action.play();
  },
  (progress) => console.log(`Loading: ${(progress.loaded / progress.total * 100).toFixed(0)}%`),
  (error) => console.error('Load error:', error)
);
```

> **Note**: Use import maps to resolve Three.js module paths correctly, avoiding long unpkg URLs.

---

## Post-Processing (Bloom Example)

```javascript
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.5,  // strength
  0.4,  // radius
  0.85  // threshold
);
composer.addPass(bloom);

// Replace renderer.render() with:
composer.render();
```

---

## Custom Shaders

```javascript
const material = new THREE.ShaderMaterial({
  uniforms: {
    time: { value: 0 },
    color: { value: new THREE.Color(0x4a90d9) }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float time;
    uniform vec3 color;
    varying vec2 vUv;
    void main() {
      float wave = sin(vUv.x * 10.0 + time) * 0.5 + 0.5;
      gl_FragColor = vec4(color * wave, 1.0);
    }
  `
});

// Update in animation loop
material.uniforms.time.value = performance.now() * 0.001;
```

---

## Text & Sprites

```javascript
function createTextSprite(text, options = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = options.fontSize || 48;
  const fontFamily = options.fontFamily || 'Arial';

  ctx.font = `${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(text);

  canvas.width = Math.ceil(metrics.width) + 20;
  canvas.height = fontSize + 20;

  ctx.fillStyle = options.backgroundColor || 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.fillStyle = options.color || '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture });
  const sprite = new THREE.Sprite(material);

  sprite.scale.set(canvas.width / 100, canvas.height / 100, 1);
  return sprite;
}
```

---

## Raycasting (Mouse Picking)

```javascript
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

window.addEventListener('click', (event) => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(scene.children, true);

  if (intersects.length > 0) {
    const hit = intersects[0];
    console.log('Clicked:', hit.object.name, 'at', hit.point);
  }
});
```

---

## Environment Mapping (Reflections)

```javascript
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

new RGBELoader().load('/hdri/studio.hdr', (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = texture;
  scene.background = texture; // Optional
});

// Material with reflections
const metalMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  metalness: 1.0,
  roughness: 0.1,
  envMapIntensity: 1.0
});
```

---

## InstancedMesh (Thousands of Objects)

```javascript
const COUNT = 10000;
const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const material = new THREE.MeshStandardMaterial({ color: 0x4a90d9 });
const mesh = new THREE.InstancedMesh(geometry, material, COUNT);

const dummy = new THREE.Object3D();
const color = new THREE.Color();

for (let i = 0; i < COUNT; i++) {
  dummy.position.set(
    Math.random() * 100 - 50,
    Math.random() * 100 - 50,
    Math.random() * 100 - 50
  );
  dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix);
  mesh.setColorAt(i, color.setHSL(Math.random(), 0.8, 0.5));
}

mesh.instanceMatrix.needsUpdate = true;
mesh.instanceColor.needsUpdate = true;
scene.add(mesh);
```

---

## Physics (Cannon.js Example)

```javascript
import * as CANNON from 'cannon-es';

// Physics world
const world = new CANNON.World();
world.gravity.set(0, -9.82, 0);

// Ground
const groundBody = new CANNON.Body({
  type: CANNON.Body.STATIC,
  shape: new CANNON.Plane()
});
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

// Falling box
const boxBody = new CANNON.Body({
  mass: 1,
  shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5))
});
boxBody.position.set(0, 10, 0);
world.addBody(boxBody);

// Sync mesh to physics
function animate() {
  world.step(1 / 60);

  cubeMesh.position.copy(boxBody.position);
  cubeMesh.quaternion.copy(boxBody.quaternion);

  renderer.render(scene, camera);
}
```

---

## npm Installation

```bash
npm install three
```

```javascript
// With bundler (Vite, webpack, etc.)
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
```

TypeScript types are included in the three package.

---

## Performance Tips

1. **Reuse geometries and materials** - Don't create duplicates
2. **Use frustum culling** - Enabled by default, don't fight it
3. **LOD (Level of Detail)** - Swap models based on distance
4. **Merge static geometry** - `BufferGeometryUtils.mergeGeometries()`
5. **Instancing** - For repeated objects (see InstancedMesh above)
6. **Avoid overdraw** - Sort transparent objects properly
7. **Profile with Stats.js** - Monitor FPS and draw calls

---

## Debug Helpers

```javascript
// Grid
scene.add(new THREE.GridHelper(10, 10));

// Axes (RGB = XYZ)
scene.add(new THREE.AxesHelper(5));

// Stats.js
import Stats from 'three/addons/libs/stats.module.js';
const stats = new Stats();
document.body.appendChild(stats.dom);
// Call stats.update() in animation loop
```
