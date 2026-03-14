/**
 * Regenerate map JSON files using the built-in ElevationMapGenerator.
 */

import { generateMapWithResult } from '../src/data/maps/core/ElevationMapGenerator';
import { mapDataToJson } from '../src/data/maps/serialization/serialize';
import type { MapBlueprint } from '../src/data/maps/core/ElevationMap';
import type { MapJson } from '../src/data/maps/schema/MapJsonSchema';
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'data', 'maps', 'json');

// ============================================================================
// 1. Battle Arena (256x64, 2p, ocean, special mode)
// ============================================================================
const battleArena: MapBlueprint = {
  meta: {
    id: 'battle_arena',
    name: 'Battle Arena',
    author: 'AI Generator',
    description:
      'Large arena for Battle Simulator mode. Top half for ground/air units, bottom half (water) for naval units.',
    players: 2,
  },
  canvas: { width: 256, height: 64, biome: 'ocean' },
  paint: [
    { cmd: 'fill', elevation: 60 },
    { cmd: 'water', x: 0, y: 34, width: 256, height: 30, depth: 'shallow' },
    { cmd: 'water', x: 0, y: 38, width: 256, height: 22, depth: 'deep' },
    { cmd: 'border', thickness: 4 },
  ],
  bases: [
    { x: 20, y: 16, type: 'main', playerSlot: 1, mineralDirection: 'right' },
    { x: 236, y: 16, type: 'main', playerSlot: 2, mineralDirection: 'left' },
  ],
  decorationRules: {
    border: { style: 'rocks', density: 0.5, scale: [1.0, 2.0], innerOffset: 8, outerOffset: 2 },
    scatter: { rocks: 0.05, debris: 0.05 },
    seed: 1001,
  },
};

// ============================================================================
// 2. Crystal Caverns (200x180, 2p, frozen, ranked)
// ============================================================================
const crystalCaverns: MapBlueprint = {
  meta: {
    id: 'crystal_caverns',
    name: 'Crystal Caverns',
    author: 'AI Generator',
    description:
      'A competitive 1v1 map set in frozen caverns. Horizontal spawns with crystal-lined cliffs.',
    players: 2,
  },
  canvas: { width: 200, height: 180, biome: 'frozen' },
  paint: [
    { cmd: 'fill', elevation: 60 },
    // P1 main (left)
    { cmd: 'plateau', x: 30, y: 90, radius: 24, elevation: 220 },
    // P1 natural (near main, MID)
    { cmd: 'plateau', x: 55, y: 55, radius: 20, elevation: 140 },
    { cmd: 'ramp', from: [38, 74], to: [46, 66], width: 10 },
    { cmd: 'ramp', from: [62, 48], to: [70, 42], width: 12 },
    // P2 main (right)
    { cmd: 'plateau', x: 170, y: 90, radius: 24, elevation: 220 },
    // P2 natural
    { cmd: 'plateau', x: 145, y: 125, radius: 20, elevation: 140 },
    { cmd: 'ramp', from: [162, 106], to: [154, 114], width: 10 },
    { cmd: 'ramp', from: [138, 132], to: [130, 138], width: 12 },
    // Third bases
    { cmd: 'plateau', x: 30, y: 30, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [30, 42], to: [30, 50], width: 10 },
    { cmd: 'plateau', x: 170, y: 150, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [170, 138], to: [170, 130], width: 10 },
    // Fourth bases (cross-map)
    { cmd: 'plateau', x: 30, y: 150, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [30, 138], to: [30, 130], width: 10 },
    { cmd: 'plateau', x: 170, y: 30, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [170, 42], to: [170, 50], width: 10 },
    // Gold center
    { cmd: 'plateau', x: 100, y: 90, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [90, 84], to: [82, 80], width: 10 },
    { cmd: 'ramp', from: [110, 96], to: [118, 100], width: 10 },
    // Void chasms
    { cmd: 'void', x: 100, y: 40, radius: 10 },
    { cmd: 'void', x: 100, y: 140, radius: 10 },
    { cmd: 'border', thickness: 12 },
  ],
  bases: [
    { x: 30, y: 90, type: 'main', playerSlot: 1, mineralDirection: 'left' },
    { x: 170, y: 90, type: 'main', playerSlot: 2, mineralDirection: 'right' },
    { x: 55, y: 55, type: 'natural', mineralDirection: 'up' },
    { x: 145, y: 125, type: 'natural', mineralDirection: 'down' },
    { x: 30, y: 30, type: 'third', mineralDirection: 'up' },
    { x: 170, y: 150, type: 'third', mineralDirection: 'down' },
    { x: 30, y: 150, type: 'fourth', mineralDirection: 'down' },
    { x: 170, y: 30, type: 'fourth', mineralDirection: 'up' },
    { x: 100, y: 90, type: 'gold', mineralDirection: 'down', isGold: true },
  ],
  watchTowers: [{ x: 100, y: 90, vision: 30 }],
  destructibles: [
    { x: 70, y: 70, health: 1000 },
    { x: 130, y: 110, health: 1000 },
  ],
  decorationRules: {
    border: { style: 'crystals', density: 0.8, scale: [1.5, 3.0], innerOffset: 15, outerOffset: 5 },
    scatter: { rocks: 0.1, crystals: 0.2, debris: 0.05 },
    baseRings: { rocks: 10, crystals: 8 },
    seed: 2042,
  },
};

// ============================================================================
// 3. Void Assault (220x220, 2p, void, ranked)
// ============================================================================
const voidAssault: MapBlueprint = {
  meta: {
    id: 'void_assault',
    name: 'Void Assault',
    author: 'AI Generator',
    description: 'A competitive 1v1 map with diagonal spawns across a shattered void landscape.',
    players: 2,
  },
  canvas: { width: 220, height: 220, biome: 'void' },
  paint: [
    { cmd: 'fill', elevation: 60 },
    // P1 (bottom-left)
    { cmd: 'plateau', x: 35, y: 185, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 65, y: 160, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [47, 173], to: [55, 167], width: 10 },
    { cmd: 'ramp', from: [77, 153], to: [87, 146], width: 12 },
    // P2 (top-right)
    { cmd: 'plateau', x: 185, y: 35, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 155, y: 60, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [173, 47], to: [165, 53], width: 10 },
    { cmd: 'ramp', from: [143, 67], to: [133, 74], width: 12 },
    // Third bases
    { cmd: 'plateau', x: 50, y: 70, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [56, 82], to: [62, 90], width: 10 },
    { cmd: 'plateau', x: 170, y: 150, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [164, 138], to: [158, 130], width: 10 },
    // Gold center
    { cmd: 'plateau', x: 110, y: 110, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [98, 104], to: [88, 98], width: 10 },
    { cmd: 'ramp', from: [122, 116], to: [132, 122], width: 10 },
    // Void chasms
    { cmd: 'void', x: 110, y: 55, radius: 16 },
    { cmd: 'void', x: 110, y: 165, radius: 16 },
    { cmd: 'void', x: 55, y: 110, radius: 14 },
    { cmd: 'void', x: 165, y: 110, radius: 14 },
    { cmd: 'road', from: [75, 150], to: [145, 70], width: 6 },
    { cmd: 'border', thickness: 12 },
  ],
  bases: [
    { x: 35, y: 185, type: 'main', playerSlot: 1, mineralDirection: 'down_left' },
    { x: 185, y: 35, type: 'main', playerSlot: 2, mineralDirection: 'up_right' },
    { x: 65, y: 160, type: 'natural', mineralDirection: 'left' },
    { x: 155, y: 60, type: 'natural', mineralDirection: 'right' },
    { x: 50, y: 70, type: 'third', mineralDirection: 'left' },
    { x: 170, y: 150, type: 'third', mineralDirection: 'right' },
    { x: 110, y: 110, type: 'gold', mineralDirection: 'down', isGold: true },
  ],
  watchTowers: [
    { x: 110, y: 110, vision: 35 },
    { x: 40, y: 130, vision: 25 },
    { x: 180, y: 90, vision: 25 },
  ],
  destructibles: [
    { x: 80, y: 130, health: 1500 },
    { x: 140, y: 90, health: 1500 },
  ],
  decorationRules: {
    border: { style: 'alien', density: 0.75, scale: [1.5, 3.0], innerOffset: 15, outerOffset: 5 },
    scatter: { rocks: 0.1, crystals: 0.15, alienTrees: 0.05, debris: 0.1 },
    baseRings: { rocks: 12, crystals: 6 },
    seed: 3077,
  },
};

// ============================================================================
// 4. Scorched Basin (280x280, 4p, desert, ranked)
// ============================================================================
const scorchedBasin: MapBlueprint = {
  meta: {
    id: 'scorched_basin',
    name: 'Scorched Basin',
    author: 'AI Generator',
    description:
      'A balanced 4-player desert map with corner spawns surrounding a scorched central basin.',
    players: 4,
  },
  canvas: { width: 280, height: 280, biome: 'desert' },
  paint: [
    { cmd: 'fill', elevation: 60 },
    // P1 (top-left)
    { cmd: 'plateau', x: 40, y: 40, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 70, y: 55, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [55, 47], to: [63, 52], width: 10 },
    { cmd: 'ramp', from: [82, 60], to: [92, 68], width: 12 },
    // P2 (top-right)
    { cmd: 'plateau', x: 240, y: 40, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 210, y: 55, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [225, 47], to: [217, 52], width: 10 },
    { cmd: 'ramp', from: [198, 60], to: [188, 68], width: 12 },
    // P3 (bottom-left)
    { cmd: 'plateau', x: 40, y: 240, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 70, y: 225, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [55, 233], to: [63, 228], width: 10 },
    { cmd: 'ramp', from: [82, 220], to: [92, 212], width: 12 },
    // P4 (bottom-right)
    { cmd: 'plateau', x: 240, y: 240, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 210, y: 225, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [225, 233], to: [217, 228], width: 10 },
    { cmd: 'ramp', from: [198, 220], to: [188, 212], width: 12 },
    // Third bases (edges)
    { cmd: 'plateau', x: 140, y: 45, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [140, 57], to: [140, 67], width: 10 },
    { cmd: 'plateau', x: 140, y: 235, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [140, 223], to: [140, 213], width: 10 },
    { cmd: 'plateau', x: 45, y: 140, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [57, 140], to: [67, 140], width: 10 },
    { cmd: 'plateau', x: 235, y: 140, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [223, 140], to: [213, 140], width: 10 },
    // Center
    { cmd: 'mud', x: 140, y: 140, radius: 20 },
    { cmd: 'forest', x: 100, y: 100, radius: 12, density: 'light' },
    { cmd: 'forest', x: 180, y: 100, radius: 12, density: 'light' },
    { cmd: 'forest', x: 100, y: 180, radius: 12, density: 'light' },
    { cmd: 'forest', x: 180, y: 180, radius: 12, density: 'light' },
    { cmd: 'border', thickness: 12 },
  ],
  bases: [
    { x: 40, y: 40, type: 'main', playerSlot: 1, mineralDirection: 'up_left' },
    { x: 240, y: 40, type: 'main', playerSlot: 2, mineralDirection: 'up_right' },
    { x: 40, y: 240, type: 'main', playerSlot: 3, mineralDirection: 'down_left' },
    { x: 240, y: 240, type: 'main', playerSlot: 4, mineralDirection: 'down_right' },
    { x: 70, y: 55, type: 'natural', mineralDirection: 'up' },
    { x: 210, y: 55, type: 'natural', mineralDirection: 'up' },
    { x: 70, y: 225, type: 'natural', mineralDirection: 'down' },
    { x: 210, y: 225, type: 'natural', mineralDirection: 'down' },
    { x: 140, y: 45, type: 'third', mineralDirection: 'up' },
    { x: 140, y: 235, type: 'third', mineralDirection: 'down' },
    { x: 45, y: 140, type: 'third', mineralDirection: 'left' },
    { x: 235, y: 140, type: 'third', mineralDirection: 'right' },
    { x: 140, y: 140, type: 'gold', mineralDirection: 'down', isGold: true },
  ],
  watchTowers: [
    { x: 140, y: 140, vision: 35 },
    { x: 100, y: 140, vision: 25 },
    { x: 180, y: 140, vision: 25 },
  ],
  destructibles: [
    { x: 110, y: 45, health: 1000 },
    { x: 170, y: 45, health: 1000 },
    { x: 110, y: 235, health: 1000 },
    { x: 170, y: 235, health: 1000 },
  ],
  decorationRules: {
    border: { style: 'rocks', density: 0.75, scale: [1.5, 3.0], innerOffset: 15, outerOffset: 5 },
    scatter: { rocks: 0.15, deadTrees: 0.05, debris: 0.1 },
    baseRings: { rocks: 12, trees: 6 },
    seed: 4099,
  },
};

// ============================================================================
// 5. Contested Frontier (360x320, 6p, jungle, ranked)
// ============================================================================
const contestedFrontier: MapBlueprint = {
  meta: {
    id: 'contested_frontier',
    name: 'Contested Frontier',
    author: 'AI Generator',
    description:
      'A large 6-player jungle map for 3v3 team battles. Teams spawn on opposite sides with a contested jungle frontier running down the center. Dense vegetation, elevation changes, and strategic chokepoints create intense team warfare. Rivers of mud and clearings break up the dense jungle canopy.',
    players: 6,
  },
  canvas: { width: 360, height: 320, biome: 'jungle' },
  paint: [
    { cmd: 'fill', elevation: 60 },

    // === TEAM 1 (LEFT) MAIN BASES (HIGH=220) ===
    // P1 top-left
    { cmd: 'plateau', x: 55, y: 50, radius: 26, elevation: 220 },
    // P2 mid-left
    { cmd: 'plateau', x: 55, y: 160, radius: 26, elevation: 220 },
    // P3 bottom-left
    { cmd: 'plateau', x: 55, y: 270, radius: 26, elevation: 220 },

    // === TEAM 2 (RIGHT) MAIN BASES (HIGH=220) ===
    // P4 top-right
    { cmd: 'plateau', x: 305, y: 50, radius: 26, elevation: 220 },
    // P5 mid-right
    { cmd: 'plateau', x: 305, y: 160, radius: 26, elevation: 220 },
    // P6 bottom-right
    { cmd: 'plateau', x: 305, y: 270, radius: 26, elevation: 220 },

    // === TEAM 1 NATURALS (MID=140) ===
    { cmd: 'plateau', x: 90, y: 55, radius: 20, elevation: 140 },
    { cmd: 'plateau', x: 90, y: 160, radius: 20, elevation: 140 },
    { cmd: 'plateau', x: 90, y: 265, radius: 20, elevation: 140 },

    // === TEAM 2 NATURALS (MID=140) ===
    { cmd: 'plateau', x: 270, y: 55, radius: 20, elevation: 140 },
    { cmd: 'plateau', x: 270, y: 160, radius: 20, elevation: 140 },
    { cmd: 'plateau', x: 270, y: 265, radius: 20, elevation: 140 },

    // === RAMPS: MAIN → NATURAL (Team 1) ===
    { cmd: 'ramp', from: [72, 47], to: [80, 51], width: 10 },
    { cmd: 'ramp', from: [72, 160], to: [80, 160], width: 10 },
    { cmd: 'ramp', from: [72, 273], to: [80, 269], width: 10 },

    // === RAMPS: MAIN → NATURAL (Team 2) ===
    { cmd: 'ramp', from: [288, 47], to: [280, 51], width: 10 },
    { cmd: 'ramp', from: [288, 160], to: [280, 160], width: 10 },
    { cmd: 'ramp', from: [288, 273], to: [280, 269], width: 10 },

    // === RAMPS: NATURAL → LOW GROUND (Team 1) ===
    { cmd: 'ramp', from: [104, 60], to: [114, 68], width: 12 },
    { cmd: 'ramp', from: [104, 160], to: [114, 160], width: 12 },
    { cmd: 'ramp', from: [104, 258], to: [114, 250], width: 12 },

    // === RAMPS: NATURAL → LOW GROUND (Team 2) ===
    { cmd: 'ramp', from: [256, 60], to: [246, 68], width: 12 },
    { cmd: 'ramp', from: [256, 160], to: [246, 160], width: 12 },
    { cmd: 'ramp', from: [256, 258], to: [246, 250], width: 12 },

    // === TEAM THIRD BASES (between teammates, MID=140) ===
    // Team 1: between P1 and P2
    { cmd: 'plateau', x: 68, y: 105, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [78, 105], to: [88, 105], width: 10 },
    // Team 1: between P2 and P3
    { cmd: 'plateau', x: 68, y: 218, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [78, 218], to: [88, 218], width: 10 },
    // Team 2: between P4 and P5
    { cmd: 'plateau', x: 292, y: 105, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [282, 105], to: [272, 105], width: 10 },
    // Team 2: between P5 and P6
    { cmd: 'plateau', x: 292, y: 218, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [282, 218], to: [272, 218], width: 10 },

    // === FORWARD THIRD BASES (more contestable, MID=140) ===
    // Left forward top
    { cmd: 'plateau', x: 130, y: 80, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [140, 80], to: [148, 80], width: 10 },
    // Left forward bottom
    { cmd: 'plateau', x: 130, y: 240, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [140, 240], to: [148, 240], width: 10 },
    // Right forward top
    { cmd: 'plateau', x: 230, y: 80, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [220, 80], to: [212, 80], width: 10 },
    // Right forward bottom
    { cmd: 'plateau', x: 230, y: 240, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [220, 240], to: [212, 240], width: 10 },

    // === GOLD BASES (center, highly contested) ===
    // Top gold
    { cmd: 'plateau', x: 180, y: 100, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [168, 94], to: [158, 88], width: 10 },
    { cmd: 'ramp', from: [192, 106], to: [202, 112], width: 10 },
    // Bottom gold
    { cmd: 'plateau', x: 180, y: 220, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [168, 226], to: [158, 232], width: 10 },
    { cmd: 'ramp', from: [192, 214], to: [202, 208], width: 10 },

    // === CENTRAL FRONTIER RIDGE (main crossing area) ===
    { cmd: 'plateau', x: 180, y: 160, radius: 20, elevation: 140 },
    // Multiple ramps for attack paths (west, east, north, south)
    { cmd: 'ramp', from: [165, 153], to: [155, 146], width: 14 },
    { cmd: 'ramp', from: [195, 167], to: [205, 174], width: 14 },
    { cmd: 'ramp', from: [180, 144], to: [180, 134], width: 12 },
    { cmd: 'ramp', from: [180, 176], to: [180, 186], width: 12 },

    // === CENTRAL RIDGE OUTPOSTS (north and south approaches) ===
    { cmd: 'plateau', x: 180, y: 50, radius: 12, elevation: 140 },
    { cmd: 'ramp', from: [172, 56], to: [164, 62], width: 10 },
    { cmd: 'ramp', from: [188, 56], to: [196, 62], width: 10 },
    { cmd: 'plateau', x: 180, y: 270, radius: 12, elevation: 140 },
    { cmd: 'ramp', from: [172, 264], to: [164, 258], width: 10 },
    { cmd: 'ramp', from: [188, 264], to: [196, 258], width: 10 },

    // === LATERAL CORRIDORS (fast paths for teammate reinforcement) ===
    { cmd: 'road', from: [55, 78], to: [55, 132], width: 8 },
    { cmd: 'road', from: [55, 188], to: [55, 242], width: 8 },
    { cmd: 'road', from: [305, 78], to: [305, 132], width: 8 },
    { cmd: 'road', from: [305, 188], to: [305, 242], width: 8 },

    // === DENSE JUNGLE FORESTS (vision blocking, ambush potential) ===
    // Central frontier forests
    { cmd: 'forest', x: 148, y: 60, radius: 16, density: 'dense' },
    { cmd: 'forest', x: 212, y: 60, radius: 16, density: 'dense' },
    { cmd: 'forest', x: 148, y: 260, radius: 16, density: 'dense' },
    { cmd: 'forest', x: 212, y: 260, radius: 16, density: 'dense' },
    // Mid-frontier forests (flanking the main crossing)
    { cmd: 'forest', x: 150, y: 130, radius: 18, density: 'dense' },
    { cmd: 'forest', x: 210, y: 130, radius: 18, density: 'dense' },
    { cmd: 'forest', x: 150, y: 190, radius: 18, density: 'dense' },
    { cmd: 'forest', x: 210, y: 190, radius: 18, density: 'dense' },
    // Center jungle (around the main crossing point)
    { cmd: 'forest', x: 165, y: 160, radius: 10, density: 'medium' },
    { cmd: 'forest', x: 195, y: 160, radius: 10, density: 'medium' },
    // Flanking forests (near third bases)
    { cmd: 'forest', x: 120, y: 105, radius: 10, density: 'medium' },
    { cmd: 'forest', x: 240, y: 105, radius: 10, density: 'medium' },
    { cmd: 'forest', x: 120, y: 218, radius: 10, density: 'medium' },
    { cmd: 'forest', x: 240, y: 218, radius: 10, density: 'medium' },
    // Sparse forest near natural exits
    { cmd: 'forest', x: 110, y: 160, radius: 8, density: 'sparse' },
    { cmd: 'forest', x: 250, y: 160, radius: 8, density: 'sparse' },

    // === MUD AREAS (terrain variety, slowing movement) ===
    { cmd: 'mud', x: 180, y: 130, radius: 10 },
    { cmd: 'mud', x: 180, y: 190, radius: 10 },
    { cmd: 'mud', x: 155, y: 160, radius: 8 },
    { cmd: 'mud', x: 205, y: 160, radius: 8 },

    // === BORDER ===
    { cmd: 'border', thickness: 14 },
  ],
  bases: [
    // Team 1 mains
    { x: 55, y: 50, type: 'main', playerSlot: 1, mineralDirection: 'up_left' },
    { x: 55, y: 160, type: 'main', playerSlot: 2, mineralDirection: 'left' },
    { x: 55, y: 270, type: 'main', playerSlot: 3, mineralDirection: 'down_left' },
    // Team 2 mains
    { x: 305, y: 50, type: 'main', playerSlot: 4, mineralDirection: 'up_right' },
    { x: 305, y: 160, type: 'main', playerSlot: 5, mineralDirection: 'right' },
    { x: 305, y: 270, type: 'main', playerSlot: 6, mineralDirection: 'down_right' },
    // Team 1 naturals
    { x: 90, y: 55, type: 'natural', mineralDirection: 'right' },
    { x: 90, y: 160, type: 'natural', mineralDirection: 'right' },
    { x: 90, y: 265, type: 'natural', mineralDirection: 'right' },
    // Team 2 naturals
    { x: 270, y: 55, type: 'natural', mineralDirection: 'left' },
    { x: 270, y: 160, type: 'natural', mineralDirection: 'left' },
    { x: 270, y: 265, type: 'natural', mineralDirection: 'left' },
    // Team thirds (between teammates)
    { x: 68, y: 105, type: 'third', mineralDirection: 'left' },
    { x: 68, y: 218, type: 'third', mineralDirection: 'left' },
    { x: 292, y: 105, type: 'third', mineralDirection: 'right' },
    { x: 292, y: 218, type: 'third', mineralDirection: 'right' },
    // Forward thirds (more contestable)
    { x: 130, y: 80, type: 'third', mineralDirection: 'up' },
    { x: 130, y: 240, type: 'third', mineralDirection: 'down' },
    { x: 230, y: 80, type: 'third', mineralDirection: 'up' },
    { x: 230, y: 240, type: 'third', mineralDirection: 'down' },
    // Center gold bases
    { x: 180, y: 100, type: 'gold', mineralDirection: 'down', isGold: true },
    { x: 180, y: 220, type: 'gold', mineralDirection: 'up', isGold: true },
  ],
  watchTowers: [
    // Central frontier crossing
    { x: 180, y: 160, vision: 35 },
    // Gold base approaches
    { x: 180, y: 100, vision: 28 },
    { x: 180, y: 220, vision: 28 },
    // Flanking crossing points
    { x: 135, y: 160, vision: 25 },
    { x: 225, y: 160, vision: 25 },
    // Northern and southern approaches
    { x: 180, y: 50, vision: 22 },
    { x: 180, y: 270, vision: 22 },
  ],
  destructibles: [
    // Flanking paths (between third bases and center)
    { x: 140, y: 105, health: 1500 },
    { x: 220, y: 105, health: 1500 },
    { x: 140, y: 218, health: 1500 },
    { x: 220, y: 218, health: 1500 },
    // Northern and southern flanking rocks
    { x: 160, y: 55, health: 1000 },
    { x: 200, y: 55, health: 1000 },
    { x: 160, y: 265, health: 1000 },
    { x: 200, y: 265, health: 1000 },
  ],
  decorationRules: {
    border: { style: 'trees', density: 0.85, scale: [1.5, 3.5], innerOffset: 16, outerOffset: 5 },
    scatter: { rocks: 0.08, trees: 0.18, debris: 0.05 },
    baseRings: { rocks: 8, trees: 12 },
    seed: 5123,
  },
};

// ============================================================================
// 6. Titan's Colosseum (400x400, 8p, volcanic, ranked)
// ============================================================================
const titansColosseum: MapBlueprint = {
  meta: {
    id: 'titans_colosseum',
    name: "Titan's Colosseum",
    author: 'AI Generator',
    description: 'A massive 8-player volcanic map for epic 4v4 battles or chaotic FFA.',
    players: 8,
  },
  canvas: { width: 400, height: 400, biome: 'volcanic' },
  paint: [
    { cmd: 'fill', elevation: 60 },
    // 8 players around perimeter
    // P1 North
    { cmd: 'plateau', x: 200, y: 50, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 200, y: 90, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [200, 68], to: [200, 78], width: 10 },
    { cmd: 'ramp', from: [200, 102], to: [200, 112], width: 12 },
    // P2 NE
    { cmd: 'plateau', x: 320, y: 80, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 290, y: 105, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [308, 90], to: [300, 98], width: 10 },
    { cmd: 'ramp', from: [278, 112], to: [268, 120], width: 12 },
    // P3 East
    { cmd: 'plateau', x: 350, y: 200, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 310, y: 200, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [332, 200], to: [322, 200], width: 10 },
    { cmd: 'ramp', from: [298, 200], to: [288, 200], width: 12 },
    // P4 SE
    { cmd: 'plateau', x: 320, y: 320, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 290, y: 295, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [308, 310], to: [300, 302], width: 10 },
    { cmd: 'ramp', from: [278, 288], to: [268, 280], width: 12 },
    // P5 South
    { cmd: 'plateau', x: 200, y: 350, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 200, y: 310, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [200, 332], to: [200, 322], width: 10 },
    { cmd: 'ramp', from: [200, 298], to: [200, 288], width: 12 },
    // P6 SW
    { cmd: 'plateau', x: 80, y: 320, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 110, y: 295, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [92, 310], to: [100, 302], width: 10 },
    { cmd: 'ramp', from: [122, 288], to: [132, 280], width: 12 },
    // P7 West
    { cmd: 'plateau', x: 50, y: 200, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 90, y: 200, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [68, 200], to: [78, 200], width: 10 },
    { cmd: 'ramp', from: [102, 200], to: [112, 200], width: 12 },
    // P8 NW
    { cmd: 'plateau', x: 80, y: 80, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 110, y: 105, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [92, 90], to: [100, 98], width: 10 },
    { cmd: 'ramp', from: [122, 112], to: [132, 120], width: 12 },
    // Center colosseum
    { cmd: 'plateau', x: 200, y: 200, radius: 30, elevation: 140 },
    { cmd: 'ramp', from: [200, 175], to: [200, 165], width: 12 },
    { cmd: 'ramp', from: [200, 225], to: [200, 235], width: 12 },
    { cmd: 'ramp', from: [175, 200], to: [165, 200], width: 12 },
    { cmd: 'ramp', from: [225, 200], to: [235, 200], width: 12 },
    // Lava
    { cmd: 'void', x: 145, y: 145, radius: 10 },
    { cmd: 'void', x: 255, y: 145, radius: 10 },
    { cmd: 'void', x: 145, y: 255, radius: 10 },
    { cmd: 'void', x: 255, y: 255, radius: 10 },
    { cmd: 'border', thickness: 14 },
  ],
  bases: [
    { x: 200, y: 50, type: 'main', playerSlot: 1, mineralDirection: 'up' },
    { x: 320, y: 80, type: 'main', playerSlot: 2, mineralDirection: 'up_right' },
    { x: 350, y: 200, type: 'main', playerSlot: 3, mineralDirection: 'right' },
    { x: 320, y: 320, type: 'main', playerSlot: 4, mineralDirection: 'down_right' },
    { x: 200, y: 350, type: 'main', playerSlot: 5, mineralDirection: 'down' },
    { x: 80, y: 320, type: 'main', playerSlot: 6, mineralDirection: 'down_left' },
    { x: 50, y: 200, type: 'main', playerSlot: 7, mineralDirection: 'left' },
    { x: 80, y: 80, type: 'main', playerSlot: 8, mineralDirection: 'up_left' },
    { x: 200, y: 90, type: 'natural', mineralDirection: 'up' },
    { x: 290, y: 105, type: 'natural', mineralDirection: 'right' },
    { x: 310, y: 200, type: 'natural', mineralDirection: 'right' },
    { x: 290, y: 295, type: 'natural', mineralDirection: 'right' },
    { x: 200, y: 310, type: 'natural', mineralDirection: 'down' },
    { x: 110, y: 295, type: 'natural', mineralDirection: 'left' },
    { x: 90, y: 200, type: 'natural', mineralDirection: 'left' },
    { x: 110, y: 105, type: 'natural', mineralDirection: 'left' },
    { x: 200, y: 200, type: 'gold', mineralDirection: 'down', isGold: true },
    // Third bases between pairs
    { x: 260, y: 55, type: 'third', mineralDirection: 'up' },
    { x: 345, y: 140, type: 'third', mineralDirection: 'right' },
    { x: 345, y: 260, type: 'third', mineralDirection: 'right' },
    { x: 260, y: 345, type: 'third', mineralDirection: 'down' },
    { x: 140, y: 345, type: 'third', mineralDirection: 'down' },
    { x: 55, y: 260, type: 'third', mineralDirection: 'left' },
    { x: 55, y: 140, type: 'third', mineralDirection: 'left' },
    { x: 140, y: 55, type: 'third', mineralDirection: 'up' },
  ],
  watchTowers: [
    { x: 200, y: 200, vision: 40 },
    { x: 200, y: 140, vision: 25 },
    { x: 260, y: 200, vision: 25 },
    { x: 200, y: 260, vision: 25 },
    { x: 140, y: 200, vision: 25 },
  ],
  destructibles: [
    { x: 155, y: 130, health: 1500 },
    { x: 245, y: 130, health: 1500 },
    { x: 155, y: 270, health: 1500 },
    { x: 245, y: 270, health: 1500 },
  ],
  decorationRules: {
    border: { style: 'rocks', density: 0.8, scale: [2.0, 4.0], innerOffset: 16, outerOffset: 5 },
    scatter: { rocks: 0.15, debris: 0.15, deadTrees: 0.03 },
    baseRings: { rocks: 14, trees: 4 },
    seed: 6147,
  },
};

// ============================================================================
// GENERATE
// ============================================================================
const allBlueprints: MapBlueprint[] = [
  battleArena,
  crystalCaverns,
  voidAssault,
  scorchedBasin,
  contestedFrontier,
];

for (const bp of allBlueprints) {
  console.log(`Generating ${bp.meta.id}...`);
  const result = generateMapWithResult(bp, { validate: false, autoFix: true, verbose: false });
  const json: MapJson & { isSpecialMode?: boolean } = mapDataToJson(result.mapData);

  if (bp.meta.id === 'battle_arena') {
    json.isSpecialMode = true;
    json.isRanked = false;
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, `${bp.meta.id}.json`), JSON.stringify(json, null, 2));
  console.log(
    `  -> ${bp.meta.id}: spawns=${json.spawns.length} expansions=${json.expansions.length}`
  );
}

// Titans separately (bigger, skip validation)
console.log('Generating titans_colosseum...');
const result = generateMapWithResult(titansColosseum, {
  validate: false,
  autoFix: false,
  verbose: false,
});
const json = mapDataToJson(result.mapData);
fs.writeFileSync(path.join(OUTPUT_DIR, 'titans_colosseum.json'), JSON.stringify(json, null, 2));
console.log(
  `  -> titans_colosseum: spawns=${json.spawns.length} expansions=${json.expansions.length}`
);

console.log('Done!');
