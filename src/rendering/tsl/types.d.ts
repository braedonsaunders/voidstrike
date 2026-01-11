/**
 * Type declarations for Three.js WebGPU and TSL modules
 *
 * These declarations provide type support for the Three.js
 * WebGPU renderer and TSL (Three.js Shading Language).
 * Updated for Three.js r172+
 */

declare module 'three/tsl' {
  import type { Color, Vector2, Vector3, Vector4, Matrix3, Matrix4, Texture } from 'three';

  // Core types
  export type ShaderNodeObject<T> = T & {
    toVar(): ShaderNodeObject<T>;
    assign(value: any): void;
    add(value: any): ShaderNodeObject<T>;
    sub(value: any): ShaderNodeObject<T>;
    mul(value: any): ShaderNodeObject<T>;
    div(value: any): ShaderNodeObject<T>;
    addAssign(value: any): void;
    subAssign(value: any): void;
    mulAssign(value: any): void;
    divAssign(value: any): void;
    negate(): ShaderNodeObject<T>;
    x: ShaderNodeObject<any>;
    y: ShaderNodeObject<any>;
    z: ShaderNodeObject<any>;
    w: ShaderNodeObject<any>;
    xy: ShaderNodeObject<any>;
    xz: ShaderNodeObject<any>;
    yz: ShaderNodeObject<any>;
    zy: ShaderNodeObject<any>;
    xzyw: ShaderNodeObject<any>;
    xyz: ShaderNodeObject<any>;
    rgb: ShaderNodeObject<any>;
    rgba: ShaderNodeObject<any>;
    r: ShaderNodeObject<any>;
    g: ShaderNodeObject<any>;
    b: ShaderNodeObject<any>;
    a: ShaderNodeObject<any>;
    zw: ShaderNodeObject<any>;
    yzx: ShaderNodeObject<any>;
    lessThan(value: any): ShaderNodeObject<any>;
    greaterThan(value: any): ShaderNodeObject<any>;
    select(a: any, b: any): ShaderNodeObject<any>;
  };

  // Node constructors
  export function float(value: number | ShaderNodeObject<any>): ShaderNodeObject<any>;
  export function int(value: number | ShaderNodeObject<any>): ShaderNodeObject<any>;
  export function vec2(x: any, y?: any): ShaderNodeObject<any>;
  export function vec3(x: any, y?: any, z?: any): ShaderNodeObject<any>;
  export function vec4(x: any, y?: any, z?: any, w?: any): ShaderNodeObject<any>;
  export function mat3(...args: any[]): ShaderNodeObject<any>;
  export function mat4(...args: any[]): ShaderNodeObject<any>;
  export function color(value: Color | number | string): ShaderNodeObject<any>;

  // Uniforms and attributes
  export function uniform(value: any): { value: any } & ShaderNodeObject<any>;
  export function attribute(name: string, type: string): ShaderNodeObject<any>;
  export function varying(type: string, name: string): ShaderNodeObject<any>;
  export function varyingProperty(type: string, name: string): ShaderNodeObject<any>;
  export function instancedArray(count: number, type: string): ShaderNodeObject<any>;
  export function storage(buffer: any, type: string, count: number): ShaderNodeObject<any>;

  // Built-in nodes
  export const positionLocal: ShaderNodeObject<any>;
  export const positionWorld: ShaderNodeObject<any>;
  export const normalLocal: ShaderNodeObject<any>;
  export const normalWorld: ShaderNodeObject<any>;
  export const cameraPosition: ShaderNodeObject<any>;
  export const modelWorldMatrix: ShaderNodeObject<any>;
  export const instanceIndex: ShaderNodeObject<any>;

  // UV
  export function uv(index?: number): ShaderNodeObject<any>;

  // Textures
  export function texture(tex: any, uv?: any): ShaderNodeObject<any>;

  // Math functions
  export function abs(value: any): ShaderNodeObject<any>;
  export function floor(value: any): ShaderNodeObject<any>;
  export function fract(value: any): ShaderNodeObject<any>;
  export function ceil(value: any): ShaderNodeObject<any>;
  export function round(value: any): ShaderNodeObject<any>;
  export function sin(value: any): ShaderNodeObject<any>;
  export function cos(value: any): ShaderNodeObject<any>;
  export function tan(value: any): ShaderNodeObject<any>;
  export function atan(y: any, x?: any): ShaderNodeObject<any>;
  export function atan2(y: any, x: any): ShaderNodeObject<any>;
  export function sqrt(value: any): ShaderNodeObject<any>;
  export function pow(base: any, exp: any): ShaderNodeObject<any>;
  export function exp(value: any): ShaderNodeObject<any>;
  export function log(value: any): ShaderNodeObject<any>;
  export function min(a: any, b: any): ShaderNodeObject<any>;
  export function max(a: any, b: any): ShaderNodeObject<any>;
  export function clamp(value: any, min: any, max: any): ShaderNodeObject<any>;
  export function saturate(value: any): ShaderNodeObject<any>;
  export function mix(a: any, b: any, t: any): ShaderNodeObject<any>;
  export function smoothstep(edge0: any, edge1: any, x: any): ShaderNodeObject<any>;
  export function step(edge: any, x: any): ShaderNodeObject<any>;
  export function sign(value: any): ShaderNodeObject<any>;
  export function mod(a: any, b: any): ShaderNodeObject<any>;

  // Vector functions
  export function dot(a: any, b: any): ShaderNodeObject<any>;
  export function cross(a: any, b: any): ShaderNodeObject<any>;
  export function normalize(value: any): ShaderNodeObject<any>;
  export function length(value: any): ShaderNodeObject<any>;
  export function distance(a: any, b: any): ShaderNodeObject<any>;
  export function reflect(incident: any, normal: any): ShaderNodeObject<any>;
  export function refract(incident: any, normal: any, eta: any): ShaderNodeObject<any>;

  // Matrix functions
  export function transpose(mat: any): ShaderNodeObject<any>;
  export function inverse(mat: any): ShaderNodeObject<any>;

  // Function definition - accepts any function signature
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function Fn<T extends (...args: any[]) => any>(fn: T): (...args: any[]) => ShaderNodeObject<any>;

  // Control flow
  export function If(condition: any, thenFn: () => void): { Else: (elseFn: () => void) => void };
  export function Loop(count: number | ShaderNodeObject<any>, fn: () => void): void;

  // Post-processing nodes (used with PostProcessing class)
  export function pass(scene: any, camera: any): ShaderNodeObject<any> & {
    setMRT(config: any): void;
    getTextureNode(name: string): ShaderNodeObject<any>;
  };
  export function bloom(input: any, strength?: any, radius?: any): ShaderNodeObject<any>;
  export function ao(depth: any, normal: any, camera?: any): ShaderNodeObject<any>;
  export function fxaa(input: any): ShaderNodeObject<any>;
  export function output(): ShaderNodeObject<any>;
  export function mrt(config: Record<string, any>): any;
  export function normalView(): ShaderNodeObject<any>;
  export function depth(): ShaderNodeObject<any>;
}

declare module 'three/webgpu' {
  import { Camera, Scene, ToneMapping, Material, Side, Blending } from 'three';

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
    getSize(target: { width: number; height: number }): { width: number; height: number };

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

  // Node Materials
  export class MeshBasicNodeMaterial extends Material {
    transparent: boolean;
    side: Side;
    depthWrite: boolean;
    blending: Blending;
    colorNode: any;
    positionNode: any;
    opacity: number;
  }

  export class MeshStandardNodeMaterial extends Material {
    transparent: boolean;
    side: Side;
    depthWrite: boolean;
    blending: Blending;
    colorNode: any;
    positionNode: any;
    normalNode: any;
    roughnessNode: any;
    metalnessNode: any;
    emissiveNode: any;
    opacity: number;
  }
}
