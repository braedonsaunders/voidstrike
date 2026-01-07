import * as Phaser from 'phaser';
import { MapData, MapCell } from '@/data/maps/MapTypes';
import { BiomeType } from '@/rendering/Biomes';
import { CELL_SIZE, DEPTH } from '../constants';

// Simple 2D biome config for Phaser (without THREE.js dependencies)
interface SimpleBiomeConfig {
  groundColor: string;
  highlightColor: string;
  waterColor?: string;
  vegetationColor?: string;
}

const BIOME_CONFIGS: Record<BiomeType, SimpleBiomeConfig> = {
  grassland: {
    groundColor: '#3a6b35',
    highlightColor: '#5a9a55',
    waterColor: '#3080c0',
    vegetationColor: '#228822',
  },
  desert: {
    groundColor: '#c4a35a',
    highlightColor: '#e4c37a',
    waterColor: '#80c0a0',
    vegetationColor: '#a08040',
  },
  frozen: {
    groundColor: '#c8d8e8',
    highlightColor: '#e0f0ff',
    waterColor: '#4080a0',
    vegetationColor: '#8898a8',
  },
  volcanic: {
    groundColor: '#2a2a2a',
    highlightColor: '#ff6020',
    waterColor: '#ff4010',
    vegetationColor: '#804020',
  },
  void: {
    groundColor: '#1a1030',
    highlightColor: '#8040ff',
    waterColor: '#4020a0',
    vegetationColor: '#6020c0',
  },
  jungle: {
    groundColor: '#2a4a25',
    highlightColor: '#5a8a50',
    waterColor: '#406050',
    vegetationColor: '#3a5a30',
  },
};

export class TerrainRenderer {
  private scene: Phaser.Scene;
  private mapData: MapData;

  private terrainGraphics: Phaser.GameObjects.Graphics;
  private decorationContainer: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, mapData: MapData) {
    this.scene = scene;
    this.mapData = mapData;

    // Create terrain graphics layer
    this.terrainGraphics = scene.add.graphics();
    this.terrainGraphics.setDepth(DEPTH.TERRAIN);

    // Create decoration container
    this.decorationContainer = scene.add.container(0, 0);
    this.decorationContainer.setDepth(DEPTH.TERRAIN + 10);

    // Render initial terrain
    this.renderTerrain();
    this.renderDecorations();
  }

  private renderTerrain(): void {
    const { width, height, terrain, biome } = this.mapData;
    const biomeConfig = BIOME_CONFIGS[biome as BiomeType] ?? BIOME_CONFIGS.grassland;

    // Get colors from biome config (convert hex string to number)
    const groundColor = parseInt(biomeConfig.groundColor.replace('#', ''), 16);
    const highlightColor = parseInt(biomeConfig.highlightColor.replace('#', ''), 16);

    // Render terrain cells
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = terrain[y]?.[x];
        if (!cell) continue;

        this.renderCell(x, y, cell, groundColor, highlightColor, biomeConfig);
      }
    }

    // Render ramps
    for (const ramp of this.mapData.ramps || []) {
      this.renderRamp(ramp, groundColor);
    }

    // Render water/lava if present
    this.renderWaterBodies(biomeConfig);
  }

  private renderCell(
    x: number,
    y: number,
    cell: MapCell,
    groundColor: number,
    highlightColor: number,
    biomeConfig: typeof BIOME_CONFIGS.grassland
  ): void {
    let cellColor = groundColor;

    // Adjust color based on terrain type and elevation
    if (cell.terrain === 'unwalkable') {
      // Cliffs/walls/water - darker or water color based on biome
      cellColor = Phaser.Display.Color.IntegerToColor(groundColor).darken(40).color;
    } else if (cell.terrain === 'ramp') {
      // Ramps - slightly lighter
      cellColor = Phaser.Display.Color.IntegerToColor(groundColor).lighten(10).color;
    } else {
      // Ground - vary by elevation
      const elevation = cell.elevation ?? 0;
      if (elevation === 2) {
        cellColor = Phaser.Display.Color.IntegerToColor(groundColor).lighten(15).color;
      } else if (elevation === 1) {
        cellColor = Phaser.Display.Color.IntegerToColor(groundColor).lighten(5).color;
      }
    }

    // Draw cell (scaled by CELL_SIZE)
    this.terrainGraphics.fillStyle(cellColor, 1);
    this.terrainGraphics.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);

    // Add subtle noise/variation for visual interest
    if (Math.random() < 0.1 && cell.terrain === 'ground') {
      const variance = Math.random() * 10 - 5;
      const variedColor = Phaser.Display.Color.IntegerToColor(cellColor).lighten(variance).color;
      this.terrainGraphics.fillStyle(variedColor, 0.5);
      this.terrainGraphics.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }

  private renderRamp(
    ramp: { x: number; y: number; width: number; height: number; direction: string },
    baseColor: number
  ): void {
    // Draw ramp with gradient effect (scaled by CELL_SIZE)
    const rampColor = Phaser.Display.Color.IntegerToColor(baseColor).lighten(10).color;
    const px = ramp.x * CELL_SIZE;
    const py = ramp.y * CELL_SIZE;
    const pw = ramp.width * CELL_SIZE;
    const ph = ramp.height * CELL_SIZE;

    this.terrainGraphics.fillStyle(rampColor, 0.9);
    this.terrainGraphics.fillRect(px, py, pw, ph);

    // Add directional lines to indicate slope
    this.terrainGraphics.lineStyle(1, 0x000000, 0.2);

    if (ramp.direction === 'north' || ramp.direction === 'south') {
      for (let i = 0; i < ph; i += CELL_SIZE / 2) {
        this.terrainGraphics.lineBetween(px, py + i, px + pw, py + i);
      }
    } else {
      for (let i = 0; i < pw; i += CELL_SIZE / 2) {
        this.terrainGraphics.lineBetween(px + i, py, px + i, py + ph);
      }
    }
  }

  private renderWaterBodies(_biomeConfig: typeof BIOME_CONFIGS.grassland): void {
    // Water is represented as 'unwalkable' terrain in this engine
    // This method is kept for API compatibility but does nothing
    // since unwalkable terrain is already rendered in renderCell
  }

  private renderDecorations(): void {
    const { width, height, biome, terrain } = this.mapData;
    const biomeConfig = BIOME_CONFIGS[biome as BiomeType] ?? BIOME_CONFIGS.grassland;

    // Add scattered decorations based on biome
    const decorationDensity = 0.02; // 2% of tiles get decorations

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = terrain[y]?.[x];
        if (cell?.terrain !== 'ground') continue;

        if (Math.random() < decorationDensity) {
          this.addDecoration(x, y, biomeConfig);
        }
      }
    }
  }

  private addDecoration(
    x: number,
    y: number,
    biomeConfig: typeof BIOME_CONFIGS.grassland
  ): void {
    const graphics = this.scene.add.graphics();
    // Position in pixel space with some randomness within the cell
    const px = (x + Math.random()) * CELL_SIZE;
    const py = (y + Math.random()) * CELL_SIZE;
    graphics.setPosition(px, py);

    const decorType = Math.random();
    const scale = CELL_SIZE / 32; // Scale decorations relative to cell size

    if (decorType < 0.4) {
      // Small rock
      graphics.fillStyle(0x666666, 0.7);
      graphics.fillCircle(0, 0, (4 + Math.random() * 4) * scale);
    } else if (decorType < 0.7) {
      // Grass tuft (for grassland) or debris
      const color = parseInt(biomeConfig.vegetationColor?.replace('#', '') ?? '228822', 16);
      graphics.fillStyle(color, 0.6);
      const s = 8 * scale;
      graphics.fillTriangle(-s, 0, 0, -s * 2, s, 0);
    } else {
      // Small plant or crystal (biome specific)
      const color = parseInt(biomeConfig.highlightColor.replace('#', ''), 16);
      graphics.fillStyle(color, 0.5);
      graphics.fillCircle(0, 0, 3 * scale);
    }

    this.decorationContainer.add(graphics);
  }

  update(): void {
    // Terrain is static, no per-frame updates needed
    // Could add animated water here if desired
  }

  destroy(): void {
    this.terrainGraphics.destroy();
    this.decorationContainer.destroy();
  }
}
