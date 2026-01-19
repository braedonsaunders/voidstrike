/**
 * Type declarations for Three.js WebGPU and TSL modules
 *
 * These declarations provide type support for the Three.js
 * WebGPU renderer and TSL (Three.js Shading Language).
 * Updated for Three.js r182+
 *
 * This file extends the base Three.js types with WebGPU-specific APIs
 * that lack official TypeScript declarations.
 */

import type {
  Color,
  Vector2,
  Vector3,
  Vector4,
  Matrix3,
  Matrix4,
  Texture,
  Camera,
  Scene,
  ToneMapping,
  Material,
  Side,
  Blending,
  BufferGeometry,
  InstancedBufferAttribute,
  RenderTarget,
  PerspectiveCamera,
  Mesh,
} from 'three';

// ============================================
// TSL (Three.js Shading Language) Types
// ============================================

declare module 'three/tsl' {
  // Core shader node type with all operations
  export type ShaderNodeObject<T> = T & {
    // Assignment and conversion
    toVar(): ShaderNodeObject<T>;
    toInt(): ShaderNodeObject<any>;
    toFloat(): ShaderNodeObject<any>;
    toAtomic(): ShaderNodeObject<T>;
    assign(value: any): void;

    // Arithmetic operations
    add(value: any): ShaderNodeObject<T>;
    sub(value: any): ShaderNodeObject<T>;
    mul(value: any): ShaderNodeObject<T>;
    div(value: any): ShaderNodeObject<T>;
    mod(value: any): ShaderNodeObject<T>;
    negate(): ShaderNodeObject<T>;

    // Assignment operators
    addAssign(value: any): void;
    subAssign(value: any): void;
    mulAssign(value: any): void;
    divAssign(value: any): void;

    // Comparison operations
    lessThan(value: any): ShaderNodeObject<any>;
    lessThanEqual(value: any): ShaderNodeObject<any>;
    greaterThan(value: any): ShaderNodeObject<any>;
    greaterThanEqual(value: any): ShaderNodeObject<any>;
    equal(value: any): ShaderNodeObject<any>;
    notEqual(value: any): ShaderNodeObject<any>;

    // Logical operations
    and(value: any): ShaderNodeObject<any>;
    or(value: any): ShaderNodeObject<any>;
    not(): ShaderNodeObject<any>;

    // Conditional
    select(a: any, b: any): ShaderNodeObject<any>;

    // Swizzle components (scalars)
    x: ShaderNodeObject<any>;
    y: ShaderNodeObject<any>;
    z: ShaderNodeObject<any>;
    w: ShaderNodeObject<any>;

    // Swizzle components (colors)
    r: ShaderNodeObject<any>;
    g: ShaderNodeObject<any>;
    b: ShaderNodeObject<any>;
    a: ShaderNodeObject<any>;

    // Swizzle combinations (2 components)
    xy: ShaderNodeObject<any>;
    xz: ShaderNodeObject<any>;
    yz: ShaderNodeObject<any>;
    zw: ShaderNodeObject<any>;
    zy: ShaderNodeObject<any>;
    rg: ShaderNodeObject<any>;

    // Swizzle combinations (3 components)
    xyz: ShaderNodeObject<any>;
    rgb: ShaderNodeObject<any>;
    yzx: ShaderNodeObject<any>;

    // Swizzle combinations (4 components)
    rgba: ShaderNodeObject<any>;
    xyzw: ShaderNodeObject<any>;
    xzyw: ShaderNodeObject<any>;

    // Array/buffer element access
    element(index: any): ShaderNodeObject<any>;

    // Texture sampling (for texture nodes)
    sample(uv: any): ShaderNodeObject<any>;

    // Control flow helpers
    Else(fn: () => void): void;
  };

  // Node constructors - scalar and vector types
  export function float(value: number | ShaderNodeObject<any>): ShaderNodeObject<any>;
  export function int(value: number | ShaderNodeObject<any>): ShaderNodeObject<any>;
  export function uint(value: number | ShaderNodeObject<any>): ShaderNodeObject<any>;
  export function bool(value: boolean | ShaderNodeObject<any>): ShaderNodeObject<any>;
  export function vec2(x: any, y?: any): ShaderNodeObject<any>;
  export function vec3(x: any, y?: any, z?: any): ShaderNodeObject<any>;
  export function vec4(x: any, y?: any, z?: any, w?: any): ShaderNodeObject<any>;
  export function ivec2(x: any, y?: any): ShaderNodeObject<any>;
  export function ivec3(x: any, y?: any, z?: any): ShaderNodeObject<any>;
  export function ivec4(x: any, y?: any, z?: any, w?: any): ShaderNodeObject<any>;
  export function uvec2(x: any, y?: any): ShaderNodeObject<any>;
  export function uvec3(x: any, y?: any, z?: any): ShaderNodeObject<any>;
  export function uvec4(x: any, y?: any, z?: any, w?: any): ShaderNodeObject<any>;
  export function mat3(...args: any[]): ShaderNodeObject<any>;
  export function mat4(...args: any[]): ShaderNodeObject<any>;
  export function color(value: Color | number | string): ShaderNodeObject<any>;

  // Uniforms and attributes
  export function uniform<T>(value: T): { value: T } & ShaderNodeObject<any>;
  export function attribute(name: string, type?: string): ShaderNodeObject<any>;
  export function varying(type: string, name: string): ShaderNodeObject<any>;
  export function varyingProperty(type: string, name: string): ShaderNodeObject<any>;

  // Storage and instancing
  export function storage(buffer: any, type: string, count: number): ShaderNodeObject<any>;
  export function instancedArray(count: number, type: string): ShaderNodeObject<any>;

  // Atomic operations
  export function atomicAdd(storage: ShaderNodeObject<any>, value: ShaderNodeObject<any>): ShaderNodeObject<any>;
  export function atomicSub(storage: ShaderNodeObject<any>, value: ShaderNodeObject<any>): ShaderNodeObject<any>;
  export function atomicMax(storage: ShaderNodeObject<any>, value: ShaderNodeObject<any>): ShaderNodeObject<any>;
  export function atomicMin(storage: ShaderNodeObject<any>, value: ShaderNodeObject<any>): ShaderNodeObject<any>;
  export function atomicAnd(storage: ShaderNodeObject<any>, value: ShaderNodeObject<any>): ShaderNodeObject<any>;
  export function atomicOr(storage: ShaderNodeObject<any>, value: ShaderNodeObject<any>): ShaderNodeObject<any>;
  export function atomicXor(storage: ShaderNodeObject<any>, value: ShaderNodeObject<any>): ShaderNodeObject<any>;

  // Texture operations
  export function texture(tex: any, uv?: any): ShaderNodeObject<any>;
  export function textureStore(texture: any, coord: any, value: any): void;

  // Built-in nodes - geometry
  export const positionLocal: ShaderNodeObject<any>;
  export const positionWorld: ShaderNodeObject<any>;
  export const positionGeometry: ShaderNodeObject<any>;
  export const normalLocal: ShaderNodeObject<any>;
  export const normalWorld: ShaderNodeObject<any>;
  export const normalView: ShaderNodeObject<any>;

  // Built-in nodes - camera
  export const cameraPosition: ShaderNodeObject<any>;
  export const cameraProjectionMatrix: ShaderNodeObject<any>;
  export const cameraViewMatrix: ShaderNodeObject<any>;
  export const cameraNear: ShaderNodeObject<any>;
  export const cameraFar: ShaderNodeObject<any>;

  // Built-in nodes - matrices
  export const modelWorldMatrix: ShaderNodeObject<any>;
  export const modelViewMatrix: ShaderNodeObject<any>;
  export const normalMatrix: ShaderNodeObject<any>;

  // Built-in nodes - instancing
  export const instanceIndex: ShaderNodeObject<any>;
  export const vertexIndex: ShaderNodeObject<any>;

  // Built-in nodes - material properties
  export const materialColor: ShaderNodeObject<any>;
  export const materialMetalness: ShaderNodeObject<any>;
  export const materialRoughness: ShaderNodeObject<any>;
  export const materialOpacity: ShaderNodeObject<any>;
  export const materialEmissive: ShaderNodeObject<any>;

  // UV
  export function uv(index?: number): ShaderNodeObject<any>;

  // Math functions - basic
  export function abs(value: any): ShaderNodeObject<any>;
  export function floor(value: any): ShaderNodeObject<any>;
  export function fract(value: any): ShaderNodeObject<any>;
  export function ceil(value: any): ShaderNodeObject<any>;
  export function round(value: any): ShaderNodeObject<any>;
  export function sign(value: any): ShaderNodeObject<any>;
  export function mod(a: any, b: any): ShaderNodeObject<any>;

  // Math functions - trigonometry
  export function sin(value: any): ShaderNodeObject<any>;
  export function cos(value: any): ShaderNodeObject<any>;
  export function tan(value: any): ShaderNodeObject<any>;
  export function asin(value: any): ShaderNodeObject<any>;
  export function acos(value: any): ShaderNodeObject<any>;
  export function atan(y: any, x?: any): ShaderNodeObject<any>;
  export function atan2(y: any, x: any): ShaderNodeObject<any>;

  // Math functions - exponential
  export function sqrt(value: any): ShaderNodeObject<any>;
  export function pow(base: any, exp: any): ShaderNodeObject<any>;
  export function exp(value: any): ShaderNodeObject<any>;
  export function exp2(value: any): ShaderNodeObject<any>;
  export function log(value: any): ShaderNodeObject<any>;
  export function log2(value: any): ShaderNodeObject<any>;

  // Math functions - clamping and interpolation
  export function min(a: any, b: any): ShaderNodeObject<any>;
  export function max(a: any, b: any): ShaderNodeObject<any>;
  export function clamp(value: any, min: any, max: any): ShaderNodeObject<any>;
  export function saturate(value: any): ShaderNodeObject<any>;
  export function mix(a: any, b: any, t: any): ShaderNodeObject<any>;
  export function smoothstep(edge0: any, edge1: any, x: any): ShaderNodeObject<any>;
  export function step(edge: any, x: any): ShaderNodeObject<any>;

  // Vector functions
  export function dot(a: any, b: any): ShaderNodeObject<any>;
  export function cross(a: any, b: any): ShaderNodeObject<any>;
  export function normalize(value: any): ShaderNodeObject<any>;
  export function length(value: any): ShaderNodeObject<any>;
  export function distance(a: any, b: any): ShaderNodeObject<any>;
  export function reflect(incident: any, normal: any): ShaderNodeObject<any>;
  export function refract(incident: any, normal: any, eta: any): ShaderNodeObject<any>;
  export function faceforward(n: any, i: any, nRef: any): ShaderNodeObject<any>;

  // Matrix functions
  export function transpose(mat: any): ShaderNodeObject<any>;
  export function inverse(mat: any): ShaderNodeObject<any>;
  export function determinant(mat: any): ShaderNodeObject<any>;

  // Function definition
  export function Fn<T extends (...args: any[]) => any>(fn: T): (...args: any[]) => ShaderNodeObject<any>;

  // Control flow
  export function If(condition: any, thenFn: () => void): { Else: (elseFn: () => void) => void };
  export function Loop(count: number | ShaderNodeObject<any>, fn: (params?: { i: ShaderNodeObject<any> }) => void): void;
  export function Break(): void;
  export function Continue(): void;

  // Post-processing nodes
  export function pass(scene: Scene, camera: Camera, options?: { resolutionScale?: number }): ShaderNodeObject<any> & {
    setMRT(config: any): void;
    getTextureNode(name?: string): ShaderNodeObject<any>;
    getTexture(name?: string): Texture | null;
  };
  export function bloom(input: any, strength?: any, radius?: any): ShaderNodeObject<any> & {
    threshold: { value: number };
    strength: { value: number };
    radius: { value: number };
  };
  export function ao(depth: any, normal: any, camera?: Camera): ShaderNodeObject<any> & {
    radius: { value: number };
    getTextureNode(): ShaderNodeObject<any>;
  };
  export function fxaa(input: any): ShaderNodeObject<any>;
  export function output(): ShaderNodeObject<any>;
  export function mrt(config: Record<string, any>): any;
  export function depth(): ShaderNodeObject<any>;
}

// ============================================
// TRAANode - Temporal Reprojection Anti-Aliasing
// ============================================

// Declare for both import paths (three/addons/* maps to three/examples/jsm/*)
declare module 'three/examples/jsm/tsl/display/TRAANode.js' {
  import type { Camera } from 'three';
  export interface TRAANode {
    isTRAANode: boolean;
    depthThreshold: number;
    edgeDepthDiff: number;
    maxVelocityLength: number;
    useSubpixelCorrection: boolean;
    getTextureNode(): any;
    setSize(width: number, height: number): void;
    setViewOffset(width: number, height: number): void;
    clearViewOffset(): void;
    dispose(): void;
  }
  export function traa(beautyNode: any, depthNode: any, velocityNode: any, camera: Camera): TRAANode;
}

declare module 'three/addons/tsl/display/TRAANode.js' {
  export interface TRAANode {
    isTRAANode: boolean;
    depthThreshold: number;
    edgeDepthDiff: number;
    maxVelocityLength: number;
    useSubpixelCorrection: boolean;
    getTextureNode(): any;
    setSize(width: number, height: number): void;
    setViewOffset(width: number, height: number): void;
    clearViewOffset(): void;
    dispose(): void;
  }

  export function traa(
    beautyNode: any,
    depthNode: any,
    velocityNode: any,
    camera: Camera
  ): TRAANode;
}

// ============================================
// SSR Node - Screen Space Reflections
// ============================================

declare module 'three/addons/tsl/display/SSRNode.js' {
  export interface SSRNode {
    maxDistance: { value: number };
    opacity: { value: number };
    thickness: { value: number };
    getTextureNode(): any;
  }

  export function ssr(
    colorNode: any,
    depthNode: any,
    normalNode: any,
    metalnessNode: any,
    roughnessNode: any,
    camera?: Camera
  ): SSRNode;
}

// ============================================
// SSGI Node - Screen Space Global Illumination
// ============================================

declare module 'three/examples/jsm/tsl/display/SSGINode.js' {
  import type { Camera } from 'three';
  export interface SSGINode {
    sliceCount: { value: number };
    stepCount: { value: number };
    radius: { value: number };
    giIntensity: { value: number };
    thickness: { value: number };
    aoIntensity: { value: number };
    useTemporalFiltering: boolean;
    getTextureNode(): any;
  }
  export function ssgi(colorNode: any, depthNode: any, normalNode: any, camera: Camera): SSGINode;
}

declare module 'three/addons/tsl/display/SSGINode.js' {
  export interface SSGINode {
    sliceCount: { value: number };
    stepCount: { value: number };
    radius: { value: number };
    giIntensity: { value: number };
    thickness: { value: number };
    aoIntensity: { value: number };
    useTemporalFiltering: boolean;
    getTextureNode(): any;
  }

  export function ssgi(
    colorNode: any,
    depthNode: any,
    normalNode: any,
    camera: Camera
  ): SSGINode;
}

// ============================================
// Other display nodes
// ============================================

declare module 'three/addons/tsl/display/BloomNode.js' {
  export function bloom(input: any, strength?: number, radius?: number): any & {
    threshold: { value: number };
    strength: { value: number };
    radius: { value: number };
  };
}

declare module 'three/addons/tsl/display/GTAONode.js' {
  export function ao(depthNode: any, normalNode: any | null, camera?: Camera): any & {
    radius: { value: number };
    getTextureNode(): any;
  };
}

declare module 'three/addons/tsl/display/FXAANode.js' {
  export function fxaa(input: any): any;
}

// ============================================
// WebGPU Renderer and Related Classes
// ============================================

declare module 'three/webgpu' {
  // WebGPURenderer
  interface WebGPURendererParameters {
    canvas?: HTMLCanvasElement;
    antialias?: boolean;
    powerPreference?: 'high-performance' | 'low-power' | 'default';
    forceWebGL?: boolean;
    logarithmicDepthBuffer?: boolean;
  }

  export class WebGPURenderer {
    constructor(parameters?: WebGPURendererParameters);

    // Initialization
    init(): Promise<void>;

    // Backend info
    backend?: { isWebGPUBackend?: boolean };

    // Size and display
    setSize(width: number, height: number, updateStyle?: boolean): void;
    setPixelRatio(ratio: number): void;
    getSize(target: Vector2): Vector2;

    // Render target
    setRenderTarget(target: RenderTarget | null): void;
    getRenderTarget(): RenderTarget | null;

    // Clipping
    localClippingEnabled: boolean;

    // Tone mapping
    toneMapping: ToneMapping;
    toneMappingExposure: number;

    // Rendering
    render(scene: Scene, camera: Camera): void;
    renderAsync(scene: Scene, camera: Camera): Promise<void>;

    // Compute
    compute(computeNode: any): void;
    computeAsync(computeNode: any): Promise<void>;

    // Clear
    setClearColor(color: any, alpha?: number): void;
    getClearColor(): any;
    setClearAlpha(alpha: number): void;
    getClearAlpha(): number;
    clear(color?: boolean, depth?: boolean, stencil?: boolean): void;

    // Capabilities
    capabilities: {
      isWebGPU: boolean;
      maxTextures: number;
      maxVertexUniformVectors: number;
    };

    // DOM element
    domElement: HTMLCanvasElement;

    // Dispose
    dispose(): void;

    // Info
    info: {
      autoReset: boolean;
      memory: { geometries: number; textures: number };
      render: { calls: number; triangles: number; points: number; lines: number };
      reset(): void;
    };

    // Output encoding
    outputColorSpace: string;

    // Shadow map
    shadowMap: {
      enabled: boolean;
      type: number;
    };

    // Auto clear
    autoClear: boolean;
    autoClearColor: boolean;
    autoClearDepth: boolean;
    autoClearStencil: boolean;
  }

  // PostProcessing
  export class PostProcessing {
    constructor(renderer: WebGPURenderer);
    outputNode: any;
    render(): void;
    renderAsync(): Promise<void>;
  }

  // Storage Buffer Attributes
  export class StorageBufferAttribute extends InstancedBufferAttribute {
    constructor(array: ArrayBufferView, itemSize: number);
    isStorageBufferAttribute: boolean;
  }

  export class StorageInstancedBufferAttribute extends InstancedBufferAttribute {
    constructor(array: ArrayBufferView, itemSize: number);
    isStorageInstancedBufferAttribute: boolean;
  }

  export class IndirectStorageBufferAttribute extends InstancedBufferAttribute {
    constructor(array: Uint32Array, itemSize: number);
    isIndirectStorageBufferAttribute: boolean;
  }

  // Node Materials
  export class NodeMaterial extends Material {
    constructor();

    // Standard material properties
    color?: Color;
    metalness?: number;
    roughness?: number;
    map?: Texture | null;
    normalMap?: Texture | null;
    emissiveMap?: Texture | null;

    // Node properties
    colorNode: any;
    positionNode: any;
    normalNode: any;
    roughnessNode: any;
    metalnessNode: any;
    emissiveNode: any;
    outputNode: any;

    // Common material properties
    transparent: boolean;
    side: Side;
    depthWrite: boolean;
    depthTest: boolean;
    blending: Blending;
    opacity: number;
  }

  export class MeshBasicNodeMaterial extends NodeMaterial {
    isMeshBasicNodeMaterial: boolean;
  }

  export class MeshStandardNodeMaterial extends NodeMaterial {
    isMeshStandardNodeMaterial: boolean;
  }

  export class MeshPhysicalNodeMaterial extends NodeMaterial {
    isMeshPhysicalNodeMaterial: boolean;
    clearcoat?: number;
    clearcoatRoughness?: number;
    transmission?: number;
    thickness?: number;
    ior?: number;
  }

  export class SpriteNodeMaterial extends NodeMaterial {
    isSpriteNodeMaterial: boolean;
  }

  export class PointsNodeMaterial extends NodeMaterial {
    isPointsNodeMaterial: boolean;
    size?: number;
    sizeAttenuation?: boolean;
  }

  export class LineBasicNodeMaterial extends NodeMaterial {
    isLineBasicNodeMaterial: boolean;
  }
}

// ============================================
// THREE namespace extensions
// ============================================

declare module 'three' {
  // StorageTexture for compute shaders
  export class StorageTexture extends Texture {
    constructor(width?: number, height?: number);
    isStorageTexture: boolean;
  }

  // Mesh extensions for indirect drawing
  export interface Mesh {
    /**
     * When set, enables indirect drawing for this mesh.
     * The attribute contains the draw arguments (indexCount, instanceCount, etc.)
     */
    drawIndirect?: InstancedBufferAttribute | null;
  }
}

// ============================================
// Material uniform extensions
// ============================================

// Extension for custom uniform storage on materials
declare module 'three' {
  export interface Material {
    /**
     * Custom uniform storage - used by TSL materials to store
     * references to uniform nodes for runtime updates.
     */
    _uniforms?: Record<string, { value: any }>;

    /**
     * Individual custom uniforms that may be attached to materials
     */
    _uOpacity?: { value: number };
    _uTime?: { value: number };
    _uColor?: { value: Color };
  }
}
