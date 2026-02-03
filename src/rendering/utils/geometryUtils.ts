import * as THREE from 'three';

export interface CloneGeometryOptions {
  /** Skip vertex color attributes (AI models often bake AO into vertex colors causing artifacts) */
  skipVertexColors?: boolean;
  /** Always recompute normals from geometry (fixes AI model faceted/flat normals) */
  recomputeNormals?: boolean;
  /** Generate UVs if missing (required by many shaders) */
  generateMissingUVs?: boolean;
}

const DEFAULT_OPTIONS: CloneGeometryOptions = {
  skipVertexColors: true,
  recomputeNormals: true,
  generateMissingUVs: true,
};

/**
 * Clone geometry with completely fresh GPU buffers for WebGPU.
 * Creates new TypedArrays for all attributes and index to ensure zero shared state
 * with the source geometry. This prevents "setIndexBuffer" crashes when source
 * geometry is disposed while clones are still being rendered.
 *
 * Also handles common issues with AI-generated models:
 * - Missing UV coordinates causing "Vertex buffer slot" errors
 * - Faceted/flat normals causing triangular artifacts
 * - Vertex colors baking AO causing visual artifacts
 */
export function cloneGeometryForGPU(
  source: THREE.BufferGeometry,
  options: CloneGeometryOptions = {}
): THREE.BufferGeometry {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const cloned = new THREE.BufferGeometry();

  // Copy all attributes with fresh TypedArrays (no shared references)
  for (const name of Object.keys(source.attributes)) {
    // Skip vertex colors if configured (AI models bake AO into vertex colors causing artifacts)
    if (opts.skipVertexColors && (name === 'color' || name.match(/^_?color_?\d+$/i))) {
      continue;
    }
    const srcAttr = source.attributes[name];
    // Create a completely new TypedArray by slicing (creates a copy)
    const newArray = srcAttr.array.slice(0);
    const newAttr = new THREE.BufferAttribute(newArray, srcAttr.itemSize, srcAttr.normalized);
    newAttr.needsUpdate = true;
    cloned.setAttribute(name, newAttr);
  }

  // Copy index with fresh TypedArray if present
  if (source.index) {
    const srcIndex = source.index;
    const newIndexArray = srcIndex.array.slice(0);
    const newIndex = new THREE.BufferAttribute(
      newIndexArray,
      srcIndex.itemSize,
      srcIndex.normalized
    );
    newIndex.needsUpdate = true;
    cloned.setIndex(newIndex);
  }

  // Copy morph attributes if present
  if (source.morphAttributes) {
    for (const name of Object.keys(source.morphAttributes)) {
      const srcMorphArray = source.morphAttributes[name];
      cloned.morphAttributes[name] = srcMorphArray.map((srcAttr) => {
        const newArray = srcAttr.array.slice(0);
        const newAttr = new THREE.BufferAttribute(newArray, srcAttr.itemSize, srcAttr.normalized);
        newAttr.needsUpdate = true;
        return newAttr;
      });
    }
  }

  // Copy bounding volumes if computed
  if (source.boundingBox) {
    cloned.boundingBox = source.boundingBox.clone();
  }
  if (source.boundingSphere) {
    cloned.boundingSphere = source.boundingSphere.clone();
  }

  // Copy groups
  for (const group of source.groups) {
    cloned.addGroup(group.start, group.count, group.materialIndex);
  }

  // Generate UV coordinates if missing - required by many shaders (slot 1)
  // Some models from Tripo/Meshy AI lack UVs, causing "Vertex buffer slot 1" errors
  if (opts.generateMissingUVs && !cloned.attributes.uv && cloned.attributes.position) {
    const posCount = cloned.attributes.position.count;
    const uvArray = new Float32Array(posCount * 2);
    // Generate basic UV coords based on position (simple projection)
    const pos = cloned.attributes.position;
    for (let i = 0; i < posCount; i++) {
      uvArray[i * 2] = pos.getX(i) * 0.5 + 0.5;
      uvArray[i * 2 + 1] = pos.getZ(i) * 0.5 + 0.5;
    }
    cloned.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
  }

  // Handle normals based on options
  if (cloned.attributes.position) {
    if (opts.recomputeNormals) {
      // Always recompute smooth vertex normals - AI-generated models often have
      // faceted/flat normals that cause triangular artifacts visible at higher resolutions.
      cloned.deleteAttribute('normal');
      cloned.computeVertexNormals();
    } else if (!cloned.attributes.normal) {
      // Just add normals if missing
      cloned.computeVertexNormals();
    }
  }

  // Ensure normals are uploaded to GPU
  if (cloned.attributes.normal) {
    cloned.attributes.normal.needsUpdate = true;
  }

  return cloned;
}
