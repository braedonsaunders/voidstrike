// Phaser rendering constants

// Size of each grid cell in pixels
// The game world uses grid coordinates, but rendering uses pixel coordinates
// A 256x256 grid map becomes 256*32 = 8192 pixels wide/tall
export const CELL_SIZE = 32;

// Depth layers for z-ordering
export const DEPTH = {
  TERRAIN: 0,
  RESOURCES: 100,
  BUILDINGS: 200,
  UNITS: 300,
  EFFECTS: 400,
  SELECTION: 500,
  FOG_OF_WAR: 600,
  UI: 1000,
  MINIMAP: 2000,
};
