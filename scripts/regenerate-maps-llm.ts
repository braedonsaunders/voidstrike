/**
 * Regenerate map JSON files using LLM-designed MapBlueprints.
 * These blueprints were crafted by an LLM map designer and then
 * fed into the ElevationMapGenerator for terrain/pathfinding generation.
 */

import { generateMapWithResult } from '../src/data/maps/core/ElevationMapGenerator';
import { mapDataToJson } from '../src/data/maps/serialization/serialize';
import type { MapBlueprint } from '../src/data/maps/core/ElevationMap';
import type { MapJson } from '../src/data/maps/schema/MapJsonSchema';
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'data', 'maps', 'json');

// ============================================================================
// 1. Crystal Caverns (200x180, 2p, frozen, ranked)
// ============================================================================
const crystalCaverns: MapBlueprint = {
  meta: {
    id: 'crystal_caverns',
    name: 'Crystal Caverns',
    author: 'AI Generator',
    description:
      'A frozen crystal cavern battlefield with dramatic elevation changes and crystal-lined chasms. Horizontal spawns battle across icy terrain, contesting an elevated central platform flanked by void fissures.',
    players: 2,
  },
  canvas: { width: 200, height: 180, biome: 'frozen' },
  paint: [
    { cmd: 'fill', elevation: 60 },
    // P1 main (upper-left)
    { cmd: 'plateau', x: 43, y: 39, radius: 24, elevation: 220 },
    // P1 natural
    { cmd: 'plateau', x: 72, y: 62, radius: 18, elevation: 140 },
    // Main→Natural ramp P1
    { cmd: 'ramp', from: [55, 46], to: [62, 56], width: 12 },
    // Natural→Low ramp P1
    { cmd: 'ramp', from: [85, 66], to: [92, 72], width: 11 },
    // Natural→Third path P1
    { cmd: 'ramp', from: [66, 72], to: [62, 80], width: 10 },

    // P2 main (lower-right) - rotational symmetry
    { cmd: 'plateau', x: 157, y: 141, radius: 24, elevation: 220 },
    // P2 natural
    { cmd: 'plateau', x: 128, y: 118, radius: 18, elevation: 140 },
    // Main→Natural ramp P2
    { cmd: 'ramp', from: [145, 134], to: [138, 124], width: 12 },
    // Natural→Low ramp P2
    { cmd: 'ramp', from: [115, 114], to: [108, 108], width: 11 },
    // Natural→Third path P2
    { cmd: 'ramp', from: [134, 108], to: [138, 100], width: 10 },

    // Central elevated platform (contested gold)
    { cmd: 'plateau', x: 100, y: 90, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [86, 90], to: [78, 90], width: 10 },
    { cmd: 'ramp', from: [114, 90], to: [122, 90], width: 10 },

    // Third bases (cross-map positions)
    { cmd: 'plateau', x: 32, y: 120, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [40, 114], to: [46, 106], width: 10 },
    { cmd: 'plateau', x: 168, y: 60, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [160, 66], to: [154, 74], width: 10 },

    // Gold bases (top-center and bottom-center)
    { cmd: 'plateau', x: 100, y: 36, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [100, 46], to: [100, 54], width: 10 },
    { cmd: 'plateau', x: 100, y: 144, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [100, 134], to: [100, 126], width: 10 },

    // Void chasms (crystal fissures)
    { cmd: 'void', x: 100, y: 64, radius: 8 },
    { cmd: 'void', x: 100, y: 116, radius: 8 },
    { cmd: 'void', x: 55, y: 142, radius: 7 },
    { cmd: 'void', x: 145, y: 38, radius: 7 },

    // Crystal forests for vision blocking
    { cmd: 'forest', x: 82, y: 56, radius: 8, density: 'medium' },
    { cmd: 'forest', x: 118, y: 124, radius: 8, density: 'medium' },
    { cmd: 'forest', x: 72, y: 88, radius: 6, density: 'light' },
    { cmd: 'forest', x: 128, y: 92, radius: 6, density: 'light' },
    { cmd: 'forest', x: 38, y: 105, radius: 7, density: 'sparse' },
    { cmd: 'forest', x: 162, y: 75, radius: 7, density: 'sparse' },

    { cmd: 'border', thickness: 12 },
  ],
  bases: [
    { x: 43, y: 39, type: 'main', playerSlot: 1, mineralDirection: 'left' },
    { x: 157, y: 141, type: 'main', playerSlot: 2, mineralDirection: 'right' },
    { x: 72, y: 62, type: 'natural', mineralDirection: 'up' },
    { x: 128, y: 118, type: 'natural', mineralDirection: 'down' },
    { x: 32, y: 120, type: 'third', mineralDirection: 'left' },
    { x: 168, y: 60, type: 'third', mineralDirection: 'right' },
    { x: 100, y: 36, type: 'gold', mineralDirection: 'up', isGold: true },
    { x: 100, y: 144, type: 'gold', mineralDirection: 'down', isGold: true },
    { x: 100, y: 90, type: 'fourth', mineralDirection: 'down' },
  ],
  watchTowers: [
    { x: 100, y: 90, vision: 30 },
    { x: 55, y: 110, vision: 25 },
    { x: 145, y: 70, vision: 25 },
    { x: 115, y: 40, vision: 22 },
    { x: 85, y: 140, vision: 22 },
  ],
  destructibles: [
    { x: 60, y: 74, health: 1000 },
    { x: 140, y: 106, health: 1000 },
    { x: 42, y: 98, health: 1200 },
    { x: 158, y: 82, health: 1200 },
  ],
  decorationRules: {
    border: { style: 'crystals', density: 0.8, scale: [1.5, 3.0], innerOffset: 15, outerOffset: 5 },
    scatter: { rocks: 0.1, crystals: 0.2, debris: 0.05 },
    baseRings: { rocks: 10, crystals: 8 },
    seed: 8472,
  },
};

// ============================================================================
// 2. Void Assault (220x220, 2p, void, ranked)
// ============================================================================
const voidAssault: MapBlueprint = {
  meta: {
    id: 'void_assault',
    name: 'Void Assault',
    author: 'AI Generator',
    description:
      'A competitive 1v1 map with diagonal spawns across a shattered void landscape. Dramatic void chasms create natural barriers while multiple ramp paths offer strategic choices.',
    players: 2,
  },
  canvas: { width: 220, height: 220, biome: 'void' },
  paint: [
    { cmd: 'fill', elevation: 60 },
    // P1 main (bottom-left)
    { cmd: 'plateau', x: 45, y: 175, radius: 24, elevation: 220 },
    // P1 natural
    { cmd: 'plateau', x: 68, y: 152, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [55, 168], to: [61, 161], width: 10 },
    { cmd: 'ramp', from: [78, 144], to: [86, 137], width: 12 },
    // P1 third
    { cmd: 'plateau', x: 95, y: 175, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [95, 163], to: [95, 155], width: 10 },

    // P2 main (top-right) - rotational symmetry
    { cmd: 'plateau', x: 175, y: 45, radius: 24, elevation: 220 },
    // P2 natural
    { cmd: 'plateau', x: 152, y: 68, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [165, 52], to: [159, 59], width: 10 },
    { cmd: 'ramp', from: [142, 76], to: [134, 83], width: 12 },
    // P2 third
    { cmd: 'plateau', x: 125, y: 45, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [125, 57], to: [125, 65], width: 10 },

    // Center gold base
    { cmd: 'plateau', x: 110, y: 110, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [99, 104], to: [91, 98], width: 10 },
    { cmd: 'ramp', from: [121, 116], to: [129, 122], width: 10 },

    // Void chasms shaping the battlefield
    { cmd: 'void', x: 80, y: 55, radius: 16 },
    { cmd: 'void', x: 140, y: 165, radius: 16 },
    { cmd: 'void', x: 170, y: 115, radius: 13 },
    { cmd: 'void', x: 50, y: 105, radius: 13 },
    { cmd: 'void', x: 30, y: 50, radius: 8 },
    { cmd: 'void', x: 190, y: 170, radius: 8 },

    // Alien forests
    { cmd: 'forest', x: 130, y: 145, radius: 10, density: 'medium' },
    { cmd: 'forest', x: 90, y: 75, radius: 10, density: 'medium' },
    { cmd: 'forest', x: 35, y: 130, radius: 8, density: 'light' },
    { cmd: 'forest', x: 185, y: 90, radius: 8, density: 'light' },

    // Central road
    { cmd: 'road', from: [75, 150], to: [145, 70], width: 6 },

    { cmd: 'border', thickness: 12 },
  ],
  bases: [
    { x: 45, y: 175, type: 'main', playerSlot: 1, mineralDirection: 'down_left' },
    { x: 175, y: 45, type: 'main', playerSlot: 2, mineralDirection: 'up_right' },
    { x: 68, y: 152, type: 'natural', mineralDirection: 'left' },
    { x: 152, y: 68, type: 'natural', mineralDirection: 'right' },
    { x: 95, y: 175, type: 'third', mineralDirection: 'down' },
    { x: 125, y: 45, type: 'third', mineralDirection: 'up' },
    { x: 110, y: 110, type: 'gold', mineralDirection: 'down', isGold: true },
  ],
  watchTowers: [
    { x: 110, y: 110, vision: 35 },
    { x: 70, y: 100, vision: 25 },
    { x: 150, y: 120, vision: 25 },
  ],
  destructibles: [
    { x: 80, y: 138, health: 1500 },
    { x: 140, y: 82, health: 1500 },
    { x: 60, y: 60, health: 1000 },
    { x: 160, y: 160, health: 1000 },
  ],
  decorationRules: {
    border: { style: 'alien', density: 0.75, scale: [1.5, 3.0], innerOffset: 15, outerOffset: 5 },
    scatter: { rocks: 0.1, crystals: 0.15, alienTrees: 0.05, debris: 0.1 },
    baseRings: { rocks: 12, crystals: 6 },
    seed: 3077,
  },
};

// ============================================================================
// 3. Scorched Basin (280x280, 4p, desert, ranked)
// ============================================================================
const scorchedBasin: MapBlueprint = {
  meta: {
    id: 'scorched_basin',
    name: 'Scorched Basin',
    author: 'AI Generator',
    description:
      'A 4-player desert map with corner spawns surrounding a scorched central basin. Heat-cracked terrain and dried riverbeds create natural pathways between corners.',
    players: 4,
  },
  canvas: { width: 280, height: 280, biome: 'desert' },
  paint: [
    { cmd: 'fill', elevation: 60 },

    // P1 main (top-left)
    { cmd: 'plateau', x: 50, y: 50, radius: 26, elevation: 220 },
    // P1 natural (SE of main)
    { cmd: 'plateau', x: 79, y: 79, radius: 20, elevation: 140 },
    { cmd: 'ramp', from: [64, 64], to: [72, 72], width: 12 },
    { cmd: 'ramp', from: [92, 88], to: [102, 96], width: 12 },

    // P2 main (top-right)
    { cmd: 'plateau', x: 230, y: 50, radius: 26, elevation: 220 },
    { cmd: 'plateau', x: 201, y: 79, radius: 20, elevation: 140 },
    { cmd: 'ramp', from: [216, 64], to: [208, 72], width: 12 },
    { cmd: 'ramp', from: [188, 88], to: [178, 96], width: 12 },

    // P3 main (bottom-right)
    { cmd: 'plateau', x: 230, y: 230, radius: 26, elevation: 220 },
    { cmd: 'plateau', x: 201, y: 201, radius: 20, elevation: 140 },
    { cmd: 'ramp', from: [216, 216], to: [208, 208], width: 12 },
    { cmd: 'ramp', from: [188, 192], to: [178, 184], width: 12 },

    // P4 main (bottom-left)
    { cmd: 'plateau', x: 50, y: 230, radius: 26, elevation: 220 },
    { cmd: 'plateau', x: 79, y: 201, radius: 20, elevation: 140 },
    { cmd: 'ramp', from: [64, 216], to: [72, 208], width: 12 },
    { cmd: 'ramp', from: [92, 192], to: [102, 184], width: 12 },

    // Third bases along edges (between adjacent players)
    { cmd: 'plateau', x: 140, y: 50, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [140, 62], to: [140, 72], width: 10 },
    { cmd: 'plateau', x: 230, y: 140, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [218, 140], to: [208, 140], width: 10 },
    { cmd: 'plateau', x: 140, y: 230, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [140, 218], to: [140, 208], width: 10 },
    { cmd: 'plateau', x: 50, y: 140, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [62, 140], to: [72, 140], width: 10 },

    // Gold bases between player pairs
    { cmd: 'plateau', x: 140, y: 110, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [140, 120], to: [140, 128], width: 10 },
    { cmd: 'plateau', x: 170, y: 140, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [160, 140], to: [152, 140], width: 10 },
    { cmd: 'plateau', x: 140, y: 170, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [140, 160], to: [140, 152], width: 10 },
    { cmd: 'plateau', x: 110, y: 140, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [120, 140], to: [128, 140], width: 10 },

    // Central scorched basin
    { cmd: 'mud', x: 140, y: 140, radius: 22 },

    // Dried lava cracks (void)
    { cmd: 'void', x: 110, y: 110, radius: 6 },
    { cmd: 'void', x: 170, y: 110, radius: 6 },
    { cmd: 'void', x: 170, y: 170, radius: 6 },
    { cmd: 'void', x: 110, y: 170, radius: 6 },

    // Sparse desert forests
    { cmd: 'forest', x: 100, y: 80, radius: 8, density: 'sparse' },
    { cmd: 'forest', x: 200, y: 80, radius: 8, density: 'sparse' },
    { cmd: 'forest', x: 200, y: 200, radius: 8, density: 'sparse' },
    { cmd: 'forest', x: 100, y: 200, radius: 8, density: 'sparse' },
    { cmd: 'forest', x: 80, y: 100, radius: 6, density: 'sparse' },
    { cmd: 'forest', x: 200, y: 100, radius: 6, density: 'sparse' },
    { cmd: 'forest', x: 200, y: 180, radius: 6, density: 'sparse' },
    { cmd: 'forest', x: 80, y: 180, radius: 6, density: 'sparse' },

    { cmd: 'border', thickness: 12 },
  ],
  bases: [
    { x: 50, y: 50, type: 'main', playerSlot: 1, mineralDirection: 'up_left' },
    { x: 230, y: 50, type: 'main', playerSlot: 2, mineralDirection: 'up_right' },
    { x: 230, y: 230, type: 'main', playerSlot: 3, mineralDirection: 'down_right' },
    { x: 50, y: 230, type: 'main', playerSlot: 4, mineralDirection: 'down_left' },
    { x: 79, y: 79, type: 'natural', mineralDirection: 'down_right' },
    { x: 201, y: 79, type: 'natural', mineralDirection: 'down_left' },
    { x: 201, y: 201, type: 'natural', mineralDirection: 'up_left' },
    { x: 79, y: 201, type: 'natural', mineralDirection: 'up_right' },
    { x: 140, y: 50, type: 'third', mineralDirection: 'up' },
    { x: 230, y: 140, type: 'third', mineralDirection: 'right' },
    { x: 140, y: 230, type: 'third', mineralDirection: 'down' },
    { x: 50, y: 140, type: 'third', mineralDirection: 'left' },
    { x: 140, y: 140, type: 'gold', mineralDirection: 'down', isGold: true },
    { x: 140, y: 110, type: 'fourth', mineralDirection: 'up' },
    { x: 170, y: 140, type: 'fourth', mineralDirection: 'right' },
    { x: 140, y: 170, type: 'fourth', mineralDirection: 'down' },
    { x: 110, y: 140, type: 'fourth', mineralDirection: 'left' },
  ],
  watchTowers: [
    { x: 140, y: 140, vision: 35 },
    { x: 115, y: 115, vision: 25 },
    { x: 165, y: 115, vision: 25 },
    { x: 165, y: 165, vision: 25 },
    { x: 115, y: 165, vision: 25 },
  ],
  destructibles: [
    { x: 108, y: 108, health: 1000 },
    { x: 172, y: 108, health: 1000 },
    { x: 172, y: 172, health: 1000 },
    { x: 108, y: 172, health: 1000 },
  ],
  decorationRules: {
    border: { style: 'rocks', density: 0.75, scale: [1.5, 3.0], innerOffset: 15, outerOffset: 5 },
    scatter: { rocks: 0.15, deadTrees: 0.05, debris: 0.1 },
    baseRings: { rocks: 12, trees: 6 },
    seed: 48291,
  },
};

// ============================================================================
// 4. Contested Frontier (360x320, 6p, jungle, ranked)
// ============================================================================
const contestedFrontier: MapBlueprint = {
  meta: {
    id: 'contested_frontier',
    name: 'Contested Frontier',
    author: 'AI Generator',
    description:
      'A large 6-player jungle map for 3v3 team battles. Teams spawn on opposite sides with a contested jungle frontier running down the center.',
    players: 6,
  },
  canvas: { width: 360, height: 320, biome: 'jungle' },
  paint: [
    { cmd: 'fill', elevation: 60 },

    // Team 1 mains (left side: P1 top, P2 mid, P3 bottom)
    { cmd: 'plateau', x: 55, y: 50, radius: 26, elevation: 220 },
    { cmd: 'plateau', x: 55, y: 160, radius: 26, elevation: 220 },
    { cmd: 'plateau', x: 55, y: 270, radius: 26, elevation: 220 },
    // Team 2 mains (right side: P4 top, P5 mid, P6 bottom)
    { cmd: 'plateau', x: 305, y: 50, radius: 26, elevation: 220 },
    { cmd: 'plateau', x: 305, y: 160, radius: 26, elevation: 220 },
    { cmd: 'plateau', x: 305, y: 270, radius: 26, elevation: 220 },

    // Naturals
    { cmd: 'plateau', x: 90, y: 55, radius: 20, elevation: 140 },
    { cmd: 'plateau', x: 90, y: 160, radius: 20, elevation: 140 },
    { cmd: 'plateau', x: 90, y: 265, radius: 20, elevation: 140 },
    { cmd: 'plateau', x: 270, y: 55, radius: 20, elevation: 140 },
    { cmd: 'plateau', x: 270, y: 160, radius: 20, elevation: 140 },
    { cmd: 'plateau', x: 270, y: 265, radius: 20, elevation: 140 },

    // Main→Natural ramps (Team 1)
    { cmd: 'ramp', from: [72, 47], to: [80, 51], width: 10 },
    { cmd: 'ramp', from: [72, 160], to: [80, 160], width: 10 },
    { cmd: 'ramp', from: [72, 273], to: [80, 269], width: 10 },
    // Main→Natural ramps (Team 2)
    { cmd: 'ramp', from: [288, 47], to: [280, 51], width: 10 },
    { cmd: 'ramp', from: [288, 160], to: [280, 160], width: 10 },
    { cmd: 'ramp', from: [288, 273], to: [280, 269], width: 10 },

    // Natural→Low ramps
    { cmd: 'ramp', from: [104, 60], to: [114, 68], width: 12 },
    { cmd: 'ramp', from: [104, 160], to: [114, 160], width: 12 },
    { cmd: 'ramp', from: [104, 258], to: [114, 250], width: 12 },
    { cmd: 'ramp', from: [256, 60], to: [246, 68], width: 12 },
    { cmd: 'ramp', from: [256, 160], to: [246, 160], width: 12 },
    { cmd: 'ramp', from: [256, 258], to: [246, 250], width: 12 },

    // Third bases between teammates
    { cmd: 'plateau', x: 68, y: 105, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [78, 105], to: [88, 105], width: 10 },
    { cmd: 'plateau', x: 68, y: 218, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [78, 218], to: [88, 218], width: 10 },
    { cmd: 'plateau', x: 292, y: 105, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [282, 105], to: [272, 105], width: 10 },
    { cmd: 'plateau', x: 292, y: 218, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [282, 218], to: [272, 218], width: 10 },

    // Forward thirds (contested)
    { cmd: 'plateau', x: 130, y: 80, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [140, 80], to: [148, 80], width: 10 },
    { cmd: 'plateau', x: 130, y: 240, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [140, 240], to: [148, 240], width: 10 },
    { cmd: 'plateau', x: 230, y: 80, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [220, 80], to: [212, 80], width: 10 },
    { cmd: 'plateau', x: 230, y: 240, radius: 14, elevation: 140 },
    { cmd: 'ramp', from: [220, 240], to: [212, 240], width: 10 },

    // Center gold bases
    { cmd: 'plateau', x: 180, y: 100, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [168, 94], to: [158, 88], width: 10 },
    { cmd: 'ramp', from: [192, 106], to: [202, 112], width: 10 },
    { cmd: 'plateau', x: 180, y: 220, radius: 16, elevation: 140 },
    { cmd: 'ramp', from: [168, 226], to: [158, 232], width: 10 },
    { cmd: 'ramp', from: [192, 214], to: [202, 208], width: 10 },

    // Central contested platform
    { cmd: 'plateau', x: 180, y: 160, radius: 20, elevation: 140 },
    { cmd: 'ramp', from: [165, 153], to: [155, 146], width: 14 },
    { cmd: 'ramp', from: [195, 167], to: [205, 174], width: 14 },
    { cmd: 'ramp', from: [180, 144], to: [180, 134], width: 12 },
    { cmd: 'ramp', from: [180, 176], to: [180, 186], width: 12 },

    // Map edge watch positions
    { cmd: 'plateau', x: 180, y: 50, radius: 12, elevation: 140 },
    { cmd: 'ramp', from: [172, 56], to: [164, 62], width: 10 },
    { cmd: 'ramp', from: [188, 56], to: [196, 62], width: 10 },
    { cmd: 'plateau', x: 180, y: 270, radius: 12, elevation: 140 },
    { cmd: 'ramp', from: [172, 264], to: [164, 258], width: 10 },
    { cmd: 'ramp', from: [188, 264], to: [196, 258], width: 10 },

    // Lateral roads for teammate reinforcement
    { cmd: 'road', from: [55, 78], to: [55, 132], width: 8 },
    { cmd: 'road', from: [55, 188], to: [55, 242], width: 8 },
    { cmd: 'road', from: [305, 78], to: [305, 132], width: 8 },
    { cmd: 'road', from: [305, 188], to: [305, 242], width: 8 },

    // Dense jungle areas
    { cmd: 'forest', x: 148, y: 60, radius: 16, density: 'dense' },
    { cmd: 'forest', x: 212, y: 60, radius: 16, density: 'dense' },
    { cmd: 'forest', x: 148, y: 260, radius: 16, density: 'dense' },
    { cmd: 'forest', x: 212, y: 260, radius: 16, density: 'dense' },
    { cmd: 'forest', x: 150, y: 130, radius: 18, density: 'dense' },
    { cmd: 'forest', x: 210, y: 130, radius: 18, density: 'dense' },
    { cmd: 'forest', x: 150, y: 190, radius: 18, density: 'dense' },
    { cmd: 'forest', x: 210, y: 190, radius: 18, density: 'dense' },
    { cmd: 'forest', x: 165, y: 160, radius: 10, density: 'medium' },
    { cmd: 'forest', x: 195, y: 160, radius: 10, density: 'medium' },

    // Mud crossings
    { cmd: 'mud', x: 180, y: 130, radius: 10 },
    { cmd: 'mud', x: 180, y: 190, radius: 10 },

    { cmd: 'border', thickness: 14 },
  ],
  bases: [
    { x: 55, y: 50, type: 'main', playerSlot: 1, mineralDirection: 'up_left' },
    { x: 55, y: 160, type: 'main', playerSlot: 2, mineralDirection: 'left' },
    { x: 55, y: 270, type: 'main', playerSlot: 3, mineralDirection: 'down_left' },
    { x: 305, y: 50, type: 'main', playerSlot: 4, mineralDirection: 'up_right' },
    { x: 305, y: 160, type: 'main', playerSlot: 5, mineralDirection: 'right' },
    { x: 305, y: 270, type: 'main', playerSlot: 6, mineralDirection: 'down_right' },
    { x: 90, y: 55, type: 'natural', mineralDirection: 'right' },
    { x: 90, y: 160, type: 'natural', mineralDirection: 'right' },
    { x: 90, y: 265, type: 'natural', mineralDirection: 'right' },
    { x: 270, y: 55, type: 'natural', mineralDirection: 'left' },
    { x: 270, y: 160, type: 'natural', mineralDirection: 'left' },
    { x: 270, y: 265, type: 'natural', mineralDirection: 'left' },
    { x: 68, y: 105, type: 'third', mineralDirection: 'left' },
    { x: 68, y: 218, type: 'third', mineralDirection: 'left' },
    { x: 292, y: 105, type: 'third', mineralDirection: 'right' },
    { x: 292, y: 218, type: 'third', mineralDirection: 'right' },
    { x: 130, y: 80, type: 'third', mineralDirection: 'up' },
    { x: 130, y: 240, type: 'third', mineralDirection: 'down' },
    { x: 230, y: 80, type: 'third', mineralDirection: 'up' },
    { x: 230, y: 240, type: 'third', mineralDirection: 'down' },
    { x: 180, y: 100, type: 'gold', mineralDirection: 'down', isGold: true },
    { x: 180, y: 220, type: 'gold', mineralDirection: 'up', isGold: true },
  ],
  watchTowers: [
    { x: 180, y: 160, vision: 35 },
    { x: 180, y: 100, vision: 28 },
    { x: 180, y: 220, vision: 28 },
    { x: 135, y: 160, vision: 25 },
    { x: 225, y: 160, vision: 25 },
    { x: 180, y: 50, vision: 22 },
    { x: 180, y: 270, vision: 22 },
  ],
  destructibles: [
    { x: 140, y: 105, health: 1500 },
    { x: 220, y: 105, health: 1500 },
    { x: 140, y: 218, health: 1500 },
    { x: 220, y: 218, health: 1500 },
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
// 5. Titan's Colosseum (400x400, 8p, volcanic, ranked)
// ============================================================================
const titansColosseum: MapBlueprint = {
  meta: {
    id: 'titans_colosseum',
    name: "Titan's Colosseum",
    author: 'AI Generator',
    description:
      'A massive 8-player volcanic map for epic battles. 8 bases arranged around a giant volcanic colosseum with a dangerous low-ground arena at center.',
    players: 8,
  },
  canvas: { width: 400, height: 400, biome: 'volcanic' },
  paint: [
    { cmd: 'fill', elevation: 60 },

    // Mid-level colosseum ring (r=80 to r=180 from center)
    { cmd: 'plateau', x: 200, y: 200, radius: 178, elevation: 140 },
    // Carve out center arena as LOW ground
    { cmd: 'plateau', x: 200, y: 200, radius: 75, elevation: 60 },

    // P1 North
    { cmd: 'plateau', x: 200, y: 45, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 200, y: 85, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [200, 63], to: [200, 73], width: 12 },
    { cmd: 'ramp', from: [200, 99], to: [200, 115], width: 10 },

    // P2 NE
    { cmd: 'plateau', x: 310, y: 90, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 280, y: 115, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [298, 98], to: [290, 106], width: 12 },
    { cmd: 'ramp', from: [268, 123], to: [256, 134], width: 10 },

    // P3 East
    { cmd: 'plateau', x: 355, y: 200, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 315, y: 200, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [337, 200], to: [327, 200], width: 12 },
    { cmd: 'ramp', from: [301, 200], to: [285, 200], width: 10 },

    // P4 SE
    { cmd: 'plateau', x: 310, y: 310, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 280, y: 285, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [298, 302], to: [290, 294], width: 12 },
    { cmd: 'ramp', from: [268, 277], to: [256, 266], width: 10 },

    // P5 South
    { cmd: 'plateau', x: 200, y: 355, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 200, y: 315, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [200, 337], to: [200, 327], width: 12 },
    { cmd: 'ramp', from: [200, 301], to: [200, 285], width: 10 },

    // P6 SW
    { cmd: 'plateau', x: 90, y: 310, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 120, y: 285, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [102, 302], to: [110, 294], width: 12 },
    { cmd: 'ramp', from: [132, 277], to: [144, 266], width: 10 },

    // P7 West
    { cmd: 'plateau', x: 45, y: 200, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 85, y: 200, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [63, 200], to: [73, 200], width: 12 },
    { cmd: 'ramp', from: [99, 200], to: [115, 200], width: 10 },

    // P8 NW
    { cmd: 'plateau', x: 90, y: 90, radius: 24, elevation: 220 },
    { cmd: 'plateau', x: 120, y: 115, radius: 18, elevation: 140 },
    { cmd: 'ramp', from: [102, 98], to: [110, 106], width: 12 },
    { cmd: 'ramp', from: [132, 123], to: [144, 134], width: 10 },

    // Central gold platform
    { cmd: 'plateau', x: 200, y: 200, radius: 20, elevation: 140 },
    { cmd: 'ramp', from: [200, 184], to: [200, 176], width: 12 },
    { cmd: 'ramp', from: [200, 216], to: [200, 224], width: 12 },
    { cmd: 'ramp', from: [184, 200], to: [176, 200], width: 12 },
    { cmd: 'ramp', from: [216, 200], to: [224, 200], width: 12 },

    // Lava void chasms in center arena
    { cmd: 'void', x: 165, y: 165, radius: 10 },
    { cmd: 'void', x: 235, y: 165, radius: 10 },
    { cmd: 'void', x: 235, y: 235, radius: 10 },
    { cmd: 'void', x: 165, y: 235, radius: 10 },

    // Outer lava between some player pairs
    { cmd: 'void', x: 260, y: 48, radius: 8 },
    { cmd: 'void', x: 352, y: 140, radius: 8 },
    { cmd: 'void', x: 260, y: 352, radius: 8 },
    { cmd: 'void', x: 48, y: 260, radius: 8 },

    // Mud in center arena
    { cmd: 'mud', x: 200, y: 200, radius: 14 },

    { cmd: 'border', thickness: 14 },
  ],
  bases: [
    { x: 200, y: 45, type: 'main', playerSlot: 1, mineralDirection: 'up' },
    { x: 310, y: 90, type: 'main', playerSlot: 2, mineralDirection: 'up_right' },
    { x: 355, y: 200, type: 'main', playerSlot: 3, mineralDirection: 'right' },
    { x: 310, y: 310, type: 'main', playerSlot: 4, mineralDirection: 'down_right' },
    { x: 200, y: 355, type: 'main', playerSlot: 5, mineralDirection: 'down' },
    { x: 90, y: 310, type: 'main', playerSlot: 6, mineralDirection: 'down_left' },
    { x: 45, y: 200, type: 'main', playerSlot: 7, mineralDirection: 'left' },
    { x: 90, y: 90, type: 'main', playerSlot: 8, mineralDirection: 'up_left' },
    // Naturals
    { x: 200, y: 85, type: 'natural', mineralDirection: 'down' },
    { x: 280, y: 115, type: 'natural', mineralDirection: 'down_left' },
    { x: 315, y: 200, type: 'natural', mineralDirection: 'left' },
    { x: 280, y: 285, type: 'natural', mineralDirection: 'up_left' },
    { x: 200, y: 315, type: 'natural', mineralDirection: 'up' },
    { x: 120, y: 285, type: 'natural', mineralDirection: 'up_right' },
    { x: 85, y: 200, type: 'natural', mineralDirection: 'right' },
    { x: 120, y: 115, type: 'natural', mineralDirection: 'down_right' },
    // Third bases between adjacent players
    { x: 255, y: 55, type: 'third', mineralDirection: 'up' },
    { x: 345, y: 145, type: 'third', mineralDirection: 'right' },
    { x: 345, y: 255, type: 'third', mineralDirection: 'right' },
    { x: 255, y: 345, type: 'third', mineralDirection: 'down' },
    { x: 145, y: 345, type: 'third', mineralDirection: 'down' },
    { x: 55, y: 255, type: 'third', mineralDirection: 'left' },
    { x: 55, y: 145, type: 'third', mineralDirection: 'left' },
    { x: 145, y: 55, type: 'third', mineralDirection: 'up' },
    // Center gold
    { x: 200, y: 200, type: 'gold', mineralDirection: 'down', isGold: true },
  ],
  watchTowers: [
    { x: 200, y: 200, vision: 40 },
    { x: 200, y: 140, vision: 25 },
    { x: 260, y: 200, vision: 25 },
    { x: 200, y: 260, vision: 25 },
    { x: 140, y: 200, vision: 25 },
  ],
  destructibles: [
    { x: 250, y: 65, health: 1500 },
    { x: 335, y: 150, health: 1500 },
    { x: 335, y: 250, health: 1500 },
    { x: 250, y: 335, health: 1500 },
    { x: 150, y: 335, health: 1500 },
    { x: 65, y: 250, health: 1500 },
    { x: 65, y: 150, health: 1500 },
    { x: 150, y: 65, health: 1500 },
  ],
  decorationRules: {
    border: { style: 'rocks', density: 0.8, scale: [2.0, 4.0], innerOffset: 16, outerOffset: 5 },
    scatter: { rocks: 0.15, debris: 0.15, deadTrees: 0.03 },
    baseRings: { rocks: 14, trees: 4 },
    seed: 6147,
  },
};

// ============================================================================
// GENERATE ALL MAPS
// ============================================================================

const allBlueprints: MapBlueprint[] = [
  crystalCaverns,
  voidAssault,
  scorchedBasin,
  contestedFrontier,
];

for (const bp of allBlueprints) {
  console.log(`Generating ${bp.meta.id}...`);
  try {
    const result = generateMapWithResult(bp, { validate: true, autoFix: true, verbose: false });
    const json: MapJson = mapDataToJson(result.mapData);
    fs.writeFileSync(path.join(OUTPUT_DIR, `${bp.meta.id}.json`), JSON.stringify(json, null, 2));
    console.log(
      `  -> ${bp.meta.id}: spawns=${json.spawns.length} expansions=${json.expansions.length} ` +
        `connectivity=${result.connectivity?.valid ? 'OK' : 'ISSUES'}`
    );
    if (result.connectivity && !result.connectivity.valid) {
      for (const issue of result.connectivity.issues) {
        console.log(`     ISSUE: ${issue}`);
      }
    }
  } catch (err) {
    console.error(`  FAILED: ${bp.meta.id}:`, err);
  }
}

// Titans separately (bigger map)
console.log('Generating titans_colosseum...');
try {
  const result = generateMapWithResult(titansColosseum, {
    validate: true,
    autoFix: true,
    verbose: false,
  });
  const json: MapJson = mapDataToJson(result.mapData);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'titans_colosseum.json'), JSON.stringify(json, null, 2));
  console.log(
    `  -> titans_colosseum: spawns=${json.spawns.length} expansions=${json.expansions.length} ` +
      `connectivity=${result.connectivity?.valid ? 'OK' : 'ISSUES'}`
  );
  if (result.connectivity && !result.connectivity.valid) {
    for (const issue of result.connectivity.issues) {
      console.log(`     ISSUE: ${issue}`);
    }
  }
} catch (err) {
  console.error('  FAILED: titans_colosseum:', err);
}

console.log('Done!');
