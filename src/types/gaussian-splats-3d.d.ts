declare module '@mkkellogg/gaussian-splats-3d' {
  import * as THREE from 'three';

  export enum RenderMode {
    Always = 0,
    OnChange = 1,
    Never = 2,
  }

  export enum SceneRevealMode {
    Default = 0,
    Gradual = 1,
    Instant = 2,
  }

  export enum LogLevel {
    None = 0,
    Error = 1,
    Warning = 2,
    Info = 3,
    Debug = 4,
  }

  export interface ViewerOptions {
    scene?: THREE.Scene;
    camera?: THREE.Camera;
    renderer?: THREE.WebGLRenderer;
    selfDrivenMode?: boolean;
    useBuiltInControls?: boolean;
    dynamicScene?: boolean;
    freeIntermediateSplatData?: boolean;
    inMemoryCompressionLevel?: number;
    renderMode?: RenderMode;
    sceneRevealMode?: SceneRevealMode;
    logLevel?: LogLevel;
    sharedMemoryForWorkers?: boolean;
    integerBasedSort?: boolean;
    halfPrecisionCovariancesOnGPU?: boolean;
    devicePixelRatio?: number;
    gpuAcceleratedSort?: boolean;
    antialiased?: boolean;
    sphericalHarmonicsDegree?: number;
  }

  export interface SplatSceneOptions {
    splatAlphaRemovalThreshold?: number;
    showLoadingUI?: boolean;
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    progressiveLoad?: boolean;
    streamView?: boolean;
  }

  export class Viewer {
    constructor(options?: ViewerOptions);
    addSplatScene(
      path: string,
      options?: SplatSceneOptions
    ): Promise<void>;
    removeSplatScene(index: number): Promise<void>;
    start(): Promise<void>;
    stop(): void;
    update(): void;
    render(): void;
    dispose(): void;
    resizeRenderer(): void;
    getSplatScene(index: number): unknown;
    getSplatCount(): number;
    setRenderMode(mode: RenderMode): void;
  }
}
