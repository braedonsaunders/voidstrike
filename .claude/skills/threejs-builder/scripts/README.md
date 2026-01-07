# GLTF Calibration Helpers

A small ES-module you can copy into your project to make the reference frame contract visible (axes, bounds, and mesh-forward arrow).

## Installation

### Option 1: Copy manually

Copy `gltf-calibration-helpers.mjs` to your project's scripts or utils folder.

### Option 2: Use the Python script

```bash
python install-gltf-calibration-helpers.py --out ./src/utils/gltf-calibration-helpers.mjs
```

## Usage

```javascript
import { attachGltfCalibrationHelpers } from './gltf-calibration-helpers.mjs';

// After loading and normalizing your model:
attachGltfCalibrationHelpers({
  scene,              // Optional: needed if showGrid is true
  root: modelRoot,    // Required: the Object3D root of your model
  label: 'Hero',      // Optional: label text
  showGrid: true,     // Optional: add a grid at y=0
});
```

## What It Shows

- **Axes helper**: RGB arrows showing local XYZ at the model root
- **Bounding box**: Magenta wireframe showing the model's bounds
- **Forward arrow**: Magenta arrow pointing in the model's local -Z direction (Three.js forward)
- **Label sprite**: Text label floating above the model

## Technical Notes

In Three.js, an `Object3D`'s "forward" direction is its **local `-Z` axis**.

- `getWorldDirection(target)` returns the object's -Z axis in world coordinates
- If your model faces the wrong way, apply a yaw offset before attaching helpers

## Options

```javascript
attachGltfCalibrationHelpers({
  scene: null,           // Scene (required if showGrid: true)
  root: modelRoot,       // Required: model root Object3D
  label: 'model',        // Label text
  axisSize: 0.6,         // Size of axes helper
  forwardArrowLength: 1.2,
  forwardArrowColor: 0xff00ff,
  boundsColor: 0xff00ff,
  anchorLocal: new THREE.Vector3(0, 1.2, 0),  // Arrow position
  showGrid: false,
  gridSize: 10,
  gridDivisions: 10,
  log: true,             // Console log diagnostics
  replaceExisting: true, // Remove previous helpers
});
```

## Returns

```javascript
const helpers = attachGltfCalibrationHelpers({ root: modelRoot });

helpers.layer;       // THREE.Group containing all helpers
helpers.axes;        // AxesHelper
helpers.boxHelper;   // Box3Helper
helpers.arrow;       // ArrowHelper (forward direction)
helpers.labelSprite; // Sprite with label text

// Recalculate bounds (e.g., after animation)
helpers.recomputeBounds();
```
