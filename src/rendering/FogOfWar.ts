import * as THREE from 'three';
import { VisionSystem, VisionState } from '@/engine/systems/VisionSystem';

export interface FogOfWarConfig {
  mapWidth: number;
  mapHeight: number;
  cellSize?: number;
  unexploredColor?: THREE.Color;
  exploredColor?: THREE.Color;
}

export class FogOfWar {
  public mesh: THREE.Mesh;

  private mapWidth: number;
  private mapHeight: number;
  private cellSize: number;
  private gridWidth: number;
  private gridHeight: number;

  private geometry: THREE.PlaneGeometry;
  private material: THREE.ShaderMaterial;
  private texture: THREE.DataTexture;
  private textureData: Uint8Array;

  private visionSystem: VisionSystem | null = null;
  private playerId: string = 'player1';

  constructor(config: FogOfWarConfig) {
    this.mapWidth = config.mapWidth;
    this.mapHeight = config.mapHeight;
    this.cellSize = config.cellSize ?? 2;
    this.gridWidth = Math.ceil(this.mapWidth / this.cellSize);
    this.gridHeight = Math.ceil(this.mapHeight / this.cellSize);

    // Create texture data (RGBA, one byte per channel)
    this.textureData = new Uint8Array(this.gridWidth * this.gridHeight * 4);
    // Initialize all to unexplored (black, full opacity)
    for (let i = 0; i < this.gridWidth * this.gridHeight; i++) {
      this.textureData[i * 4 + 0] = 0; // R
      this.textureData[i * 4 + 1] = 0; // G
      this.textureData[i * 4 + 2] = 0; // B
      this.textureData[i * 4 + 3] = 255; // A (full opacity = unexplored)
    }

    // Create texture
    this.texture = new THREE.DataTexture(
      this.textureData as unknown as BufferSource,
      this.gridWidth,
      this.gridHeight,
      THREE.RGBAFormat
    );
    this.texture.needsUpdate = true;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    // Create shader material for smooth fog effect
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        fogTexture: { value: this.texture },
        unexploredColor: { value: new THREE.Color(0x000000) },
        exploredColor: { value: new THREE.Color(0x1a1a2e) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D fogTexture;
        uniform vec3 unexploredColor;
        uniform vec3 exploredColor;
        varying vec2 vUv;

        void main() {
          vec4 fogData = texture2D(fogTexture, vUv);
          float visibility = 1.0 - fogData.a;

          // visibility: 0 = unexplored, 0.5 = explored, 1 = visible
          if (visibility < 0.01) {
            // Unexplored - solid black
            gl_FragColor = vec4(unexploredColor, 0.95);
          } else if (visibility < 0.75) {
            // Explored - dark transparent overlay
            gl_FragColor = vec4(exploredColor, 0.6);
          } else {
            // Visible - no fog
            discard;
          }
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Create geometry - plane covering the entire map
    this.geometry = new THREE.PlaneGeometry(this.mapWidth, this.mapHeight);

    // Create mesh
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(this.mapWidth / 2, 0.5, this.mapHeight / 2);
    this.mesh.renderOrder = 100; // Render after terrain
  }

  public setVisionSystem(visionSystem: VisionSystem): void {
    this.visionSystem = visionSystem;
  }

  public setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }

  public update(): void {
    if (!this.visionSystem) return;

    const visionGrid = this.visionSystem.getVisionGridForPlayer(this.playerId);
    if (!visionGrid) return;

    // Update texture data based on vision
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const i = y * this.gridWidth + x;
        const state = visionGrid[y]?.[x] ?? 'unexplored';

        // Alpha determines fog level: 255 = full fog, 0 = no fog
        let alpha: number;
        switch (state) {
          case 'visible':
            alpha = 0; // No fog
            break;
          case 'explored':
            alpha = 128; // Partial fog (can see terrain but not units)
            break;
          case 'unexplored':
          default:
            alpha = 255; // Full fog
            break;
        }

        this.textureData[i * 4 + 3] = alpha;
      }
    }

    this.texture.needsUpdate = true;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

// Helper class for minimap fog overlay
export class MinimapFog {
  public canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private visionSystem: VisionSystem | null = null;
  private playerId: string = 'player1';

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
  }

  public setVisionSystem(visionSystem: VisionSystem): void {
    this.visionSystem = visionSystem;
  }

  public setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }

  public update(): void {
    if (!this.visionSystem) return;

    const width = this.canvas.width;
    const height = this.canvas.height;

    // Get vision mask
    const mask = this.visionSystem.getVisionMask(this.playerId, width, height);

    // Create image data
    const imageData = this.ctx.createImageData(width, height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const pixelIndex = i * 4;
        const visibility = mask[i];

        if (visibility >= 0.9) {
          // Visible - transparent
          imageData.data[pixelIndex + 0] = 0;
          imageData.data[pixelIndex + 1] = 0;
          imageData.data[pixelIndex + 2] = 0;
          imageData.data[pixelIndex + 3] = 0;
        } else if (visibility >= 0.4) {
          // Explored - semi-transparent
          imageData.data[pixelIndex + 0] = 0;
          imageData.data[pixelIndex + 1] = 0;
          imageData.data[pixelIndex + 2] = 0;
          imageData.data[pixelIndex + 3] = 128;
        } else {
          // Unexplored - opaque black
          imageData.data[pixelIndex + 0] = 0;
          imageData.data[pixelIndex + 1] = 0;
          imageData.data[pixelIndex + 2] = 0;
          imageData.data[pixelIndex + 3] = 220;
        }
      }
    }

    this.ctx.putImageData(imageData, 0, 0);
  }
}
