/**
 * Formation Types - Data-Driven Formation System
 *
 * This file defines all available unit formations. Formations control
 * how units arrange themselves when moving or holding position.
 *
 * Formation Types:
 * - box: Standard defensive formation (units surround ranged)
 * - line: Spread horizontal line
 * - column: Single-file for narrow paths
 * - wedge: V-shaped aggressive formation
 * - scatter: Random spread for anti-splash
 * - custom: Game-specific formations
 */

// ==================== FORMATION DEFINITIONS ====================

export type FormationShape = 'box' | 'line' | 'column' | 'wedge' | 'scatter' | 'circle' | 'custom';

export interface FormationSlot {
  offsetX: number; // Offset from formation center
  offsetY: number;
  priority: number; // Which units fill this slot first (higher = first)
  preferredCategories?: string[]; // Unit categories preferred for this slot
}

export interface FormationDefinition {
  id: string;
  name: string;
  description: string;
  icon?: string;
  shape: FormationShape;

  // Spacing
  unitSpacing: number; // Distance between units
  rowSpacing: number; // Distance between rows

  // Slot generation
  slots?: FormationSlot[]; // Predefined slots (for custom formations)
  maxUnitsPerRow?: number; // For auto-generated formations
  slotsPerUnit?: number; // Scaling factor for large groups

  // Behavior
  maintainFormation: boolean; // Units try to stay in formation while moving
  reformAfterCombat: boolean; // Reform formation after engagement
  allowRotation: boolean; // Formation rotates to face movement direction

  // Priorities
  meleeFront: boolean; // Melee units go to front
  rangedBack: boolean; // Ranged units go to back
  supportCenter: boolean; // Support units go to center
}

export const FORMATION_DEFINITIONS: Record<string, FormationDefinition> = {
  // === STANDARD FORMATIONS ===

  box: {
    id: 'box',
    name: 'Box Formation',
    description: 'Balanced defensive formation with ranged units protected in center.',
    shape: 'box',
    unitSpacing: 1.5,
    rowSpacing: 1.5,
    maxUnitsPerRow: 5,
    maintainFormation: true,
    reformAfterCombat: true,
    allowRotation: true,
    meleeFront: true,
    rangedBack: true,
    supportCenter: true,
  },

  line: {
    id: 'line',
    name: 'Line Formation',
    description: 'Units spread in a horizontal line for maximum coverage.',
    shape: 'line',
    unitSpacing: 2.0,
    rowSpacing: 0,
    maxUnitsPerRow: 999,
    maintainFormation: true,
    reformAfterCombat: false,
    allowRotation: true,
    meleeFront: false,
    rangedBack: false,
    supportCenter: false,
  },

  column: {
    id: 'column',
    name: 'Column Formation',
    description: 'Single-file column for navigating narrow paths.',
    shape: 'column',
    unitSpacing: 1.0,
    rowSpacing: 1.0,
    maxUnitsPerRow: 1,
    maintainFormation: true,
    reformAfterCombat: false,
    allowRotation: true,
    meleeFront: true,
    rangedBack: true,
    supportCenter: false,
  },

  wedge: {
    id: 'wedge',
    name: 'Wedge Formation',
    description: 'V-shaped aggressive formation for breaking enemy lines.',
    shape: 'wedge',
    unitSpacing: 1.5,
    rowSpacing: 1.2,
    maxUnitsPerRow: 7,
    maintainFormation: true,
    reformAfterCombat: true,
    allowRotation: true,
    meleeFront: true,
    rangedBack: true,
    supportCenter: false,
  },

  scatter: {
    id: 'scatter',
    name: 'Scatter Formation',
    description: 'Units spread randomly to minimize splash damage.',
    shape: 'scatter',
    unitSpacing: 3.0,
    rowSpacing: 3.0,
    maxUnitsPerRow: 999,
    maintainFormation: false,
    reformAfterCombat: false,
    allowRotation: false,
    meleeFront: false,
    rangedBack: false,
    supportCenter: false,
  },

  circle: {
    id: 'circle',
    name: 'Circle Formation',
    description: 'Units form a defensive circle around support units.',
    shape: 'circle',
    unitSpacing: 1.8,
    rowSpacing: 1.8,
    maxUnitsPerRow: 8,
    maintainFormation: true,
    reformAfterCombat: true,
    allowRotation: false,
    meleeFront: true,
    rangedBack: false,
    supportCenter: true,
  },

  // === SPECIALIZED FORMATIONS ===

  siege_line: {
    id: 'siege_line',
    name: 'Siege Line',
    description: 'Artillery in back, infantry in front for siege operations.',
    shape: 'custom',
    unitSpacing: 2.5,
    rowSpacing: 4.0,
    maxUnitsPerRow: 6,
    maintainFormation: true,
    reformAfterCombat: true,
    allowRotation: true,
    meleeFront: true,
    rangedBack: true,
    supportCenter: false,
    slots: [
      // Front row - melee/tanks
      { offsetX: -4, offsetY: 0, priority: 10, preferredCategories: ['vehicle', 'heavy_infantry'] },
      { offsetX: -2, offsetY: 0, priority: 10, preferredCategories: ['vehicle', 'heavy_infantry'] },
      { offsetX: 0, offsetY: 0, priority: 10, preferredCategories: ['vehicle', 'heavy_infantry'] },
      { offsetX: 2, offsetY: 0, priority: 10, preferredCategories: ['vehicle', 'heavy_infantry'] },
      { offsetX: 4, offsetY: 0, priority: 10, preferredCategories: ['vehicle', 'heavy_infantry'] },
      // Back row - artillery/ranged
      { offsetX: -3, offsetY: -4, priority: 5, preferredCategories: ['artillery', 'infantry'] },
      { offsetX: -1, offsetY: -4, priority: 5, preferredCategories: ['artillery', 'infantry'] },
      { offsetX: 1, offsetY: -4, priority: 5, preferredCategories: ['artillery', 'infantry'] },
      { offsetX: 3, offsetY: -4, priority: 5, preferredCategories: ['artillery', 'infantry'] },
    ],
  },

  air_cover: {
    id: 'air_cover',
    name: 'Air Cover',
    description: 'Air units positioned above ground forces.',
    shape: 'custom',
    unitSpacing: 3.0,
    rowSpacing: 2.0,
    maxUnitsPerRow: 4,
    maintainFormation: true,
    reformAfterCombat: false,
    allowRotation: true,
    meleeFront: false,
    rangedBack: false,
    supportCenter: false,
    slots: [
      // Air units spread above
      { offsetX: -3, offsetY: 3, priority: 5, preferredCategories: ['ship'] },
      { offsetX: 0, offsetY: 4, priority: 5, preferredCategories: ['ship'] },
      { offsetX: 3, offsetY: 3, priority: 5, preferredCategories: ['ship'] },
      // Ground units below
      { offsetX: -2, offsetY: 0, priority: 10, preferredCategories: ['infantry', 'vehicle'] },
      { offsetX: 0, offsetY: 0, priority: 10, preferredCategories: ['infantry', 'vehicle'] },
      { offsetX: 2, offsetY: 0, priority: 10, preferredCategories: ['infantry', 'vehicle'] },
    ],
  },
};

// ==================== FORMATION SYSTEM CONFIG ====================

export interface FormationConfig {
  // Movement
  reformSpeed: number; // How fast units move to formation positions
  reformThreshold: number; // Distance from position to trigger reform

  // Breaking formation
  combatBreakDistance: number; // Distance at which formation breaks for combat
  autoReformDelay: number; // Seconds after combat before reforming

  // Default formation
  defaultFormation: string;
  defaultAirFormation: string;

  // Keybinds (for UI reference)
  formationHotkeys: Record<string, string>;
}

export const FORMATION_CONFIG: FormationConfig = {
  reformSpeed: 1.2, // Multiplier on unit speed
  reformThreshold: 0.5,
  combatBreakDistance: 8,
  autoReformDelay: 3,
  defaultFormation: 'box',
  defaultAirFormation: 'scatter',
  formationHotkeys: {
    box: 'F1',
    line: 'F2',
    column: 'F3',
    wedge: 'F4',
    scatter: 'F5',
    circle: 'F6',
  },
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Get all formation IDs.
 */
export function getFormationIds(): string[] {
  return Object.keys(FORMATION_DEFINITIONS);
}

/**
 * Get a formation definition by ID.
 */
export function getFormation(formationId: string): FormationDefinition | undefined {
  return FORMATION_DEFINITIONS[formationId];
}

/**
 * Get the default formation.
 */
export function getDefaultFormation(): FormationDefinition {
  return FORMATION_DEFINITIONS[FORMATION_CONFIG.defaultFormation];
}

/**
 * Generate formation positions for a group of units.
 */
export function generateFormationPositions(
  formationId: string,
  unitCount: number,
  centerX: number,
  centerY: number,
  facingAngle: number = 0
): Array<{ x: number; y: number; slot: number }> {
  const formation = getFormation(formationId);
  if (!formation) return [];

  const positions: Array<{ x: number; y: number; slot: number }> = [];
  const cos = Math.cos(facingAngle);
  const sin = Math.sin(facingAngle);

  // Use predefined slots if available
  if (formation.slots && formation.slots.length > 0) {
    const sortedSlots = [...formation.slots].sort((a, b) => b.priority - a.priority);
    for (let i = 0; i < Math.min(unitCount, sortedSlots.length); i++) {
      const slot = sortedSlots[i];
      // Rotate slot position by facing angle
      const rotX = slot.offsetX * cos - slot.offsetY * sin;
      const rotY = slot.offsetX * sin + slot.offsetY * cos;
      positions.push({
        x: centerX + rotX,
        y: centerY + rotY,
        slot: i,
      });
    }
    return positions;
  }

  // Generate positions based on shape
  switch (formation.shape) {
    case 'box':
      return generateBoxPositions(formation, unitCount, centerX, centerY, facingAngle);
    case 'line':
      return generateLinePositions(formation, unitCount, centerX, centerY, facingAngle);
    case 'column':
      return generateColumnPositions(formation, unitCount, centerX, centerY, facingAngle);
    case 'wedge':
      return generateWedgePositions(formation, unitCount, centerX, centerY, facingAngle);
    case 'scatter':
      return generateScatterPositions(formation, unitCount, centerX, centerY);
    case 'circle':
      return generateCirclePositions(formation, unitCount, centerX, centerY);
    default:
      return generateBoxPositions(formation, unitCount, centerX, centerY, facingAngle);
  }
}

function generateBoxPositions(
  formation: FormationDefinition,
  unitCount: number,
  centerX: number,
  centerY: number,
  facingAngle: number
): Array<{ x: number; y: number; slot: number }> {
  const positions: Array<{ x: number; y: number; slot: number }> = [];
  const cols = Math.min(unitCount, formation.maxUnitsPerRow ?? 5);
  const rows = Math.ceil(unitCount / cols);

  const totalWidth = (cols - 1) * formation.unitSpacing;
  const totalHeight = (rows - 1) * formation.rowSpacing;

  const cos = Math.cos(facingAngle);
  const sin = Math.sin(facingAngle);

  let slot = 0;
  for (let row = 0; row < rows && slot < unitCount; row++) {
    const unitsInRow = Math.min(cols, unitCount - row * cols);
    const rowWidth = (unitsInRow - 1) * formation.unitSpacing;

    for (let col = 0; col < unitsInRow && slot < unitCount; col++) {
      const localX = col * formation.unitSpacing - rowWidth / 2;
      const localY = row * formation.rowSpacing - totalHeight / 2;

      const rotX = localX * cos - localY * sin;
      const rotY = localX * sin + localY * cos;

      positions.push({
        x: centerX + rotX,
        y: centerY + rotY,
        slot: slot++,
      });
    }
  }

  return positions;
}

function generateLinePositions(
  formation: FormationDefinition,
  unitCount: number,
  centerX: number,
  centerY: number,
  facingAngle: number
): Array<{ x: number; y: number; slot: number }> {
  const positions: Array<{ x: number; y: number; slot: number }> = [];
  const totalWidth = (unitCount - 1) * formation.unitSpacing;

  const cos = Math.cos(facingAngle + Math.PI / 2); // Perpendicular to facing
  const sin = Math.sin(facingAngle + Math.PI / 2);

  for (let i = 0; i < unitCount; i++) {
    const localX = i * formation.unitSpacing - totalWidth / 2;
    positions.push({
      x: centerX + localX * cos,
      y: centerY + localX * sin,
      slot: i,
    });
  }

  return positions;
}

function generateColumnPositions(
  formation: FormationDefinition,
  unitCount: number,
  centerX: number,
  centerY: number,
  facingAngle: number
): Array<{ x: number; y: number; slot: number }> {
  const positions: Array<{ x: number; y: number; slot: number }> = [];
  const totalLength = (unitCount - 1) * formation.rowSpacing;

  const cos = Math.cos(facingAngle);
  const sin = Math.sin(facingAngle);

  for (let i = 0; i < unitCount; i++) {
    const localY = i * formation.rowSpacing - totalLength / 2;
    positions.push({
      x: centerX - localY * sin,
      y: centerY + localY * cos,
      slot: i,
    });
  }

  return positions;
}

function generateWedgePositions(
  formation: FormationDefinition,
  unitCount: number,
  centerX: number,
  centerY: number,
  facingAngle: number
): Array<{ x: number; y: number; slot: number }> {
  const positions: Array<{ x: number; y: number; slot: number }> = [];
  const cos = Math.cos(facingAngle);
  const sin = Math.sin(facingAngle);

  // Leader at front
  positions.push({ x: centerX, y: centerY, slot: 0 });

  // Wings spread back
  let slot = 1;
  let row = 1;
  while (slot < unitCount) {
    const rowY = -row * formation.rowSpacing;

    // Left wing
    if (slot < unitCount) {
      const localX = -row * formation.unitSpacing;
      positions.push({
        x: centerX + localX * cos - rowY * sin,
        y: centerY + localX * sin + rowY * cos,
        slot: slot++,
      });
    }

    // Right wing
    if (slot < unitCount) {
      const localX = row * formation.unitSpacing;
      positions.push({
        x: centerX + localX * cos - rowY * sin,
        y: centerY + localX * sin + rowY * cos,
        slot: slot++,
      });
    }

    row++;
  }

  return positions;
}

function generateScatterPositions(
  formation: FormationDefinition,
  unitCount: number,
  centerX: number,
  centerY: number
): Array<{ x: number; y: number; slot: number }> {
  const positions: Array<{ x: number; y: number; slot: number }> = [];
  const radius = Math.sqrt(unitCount) * formation.unitSpacing;

  // Use deterministic positions based on slot number
  for (let i = 0; i < unitCount; i++) {
    const angle = (i * 2.399) % (Math.PI * 2); // Golden angle
    const r = Math.sqrt(i / unitCount) * radius;
    positions.push({
      x: centerX + Math.cos(angle) * r,
      y: centerY + Math.sin(angle) * r,
      slot: i,
    });
  }

  return positions;
}

function generateCirclePositions(
  formation: FormationDefinition,
  unitCount: number,
  centerX: number,
  centerY: number
): Array<{ x: number; y: number; slot: number }> {
  const positions: Array<{ x: number; y: number; slot: number }> = [];
  const circumference = unitCount * formation.unitSpacing;
  const radius = circumference / (Math.PI * 2);

  for (let i = 0; i < unitCount; i++) {
    const angle = (i / unitCount) * Math.PI * 2;
    positions.push({
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      slot: i,
    });
  }

  return positions;
}

/**
 * Sort units for formation assignment based on formation preferences.
 */
export function sortUnitsForFormation(
  formationId: string,
  units: Array<{ id: number; category: string; isRanged: boolean; isMelee: boolean; isSupport: boolean }>
): Array<{ id: number; category: string; isRanged: boolean; isMelee: boolean; isSupport: boolean }> {
  const formation = getFormation(formationId);
  if (!formation) return units;

  return [...units].sort((a, b) => {
    // Melee front preference
    if (formation.meleeFront) {
      if (a.isMelee && !b.isMelee) return -1;
      if (!a.isMelee && b.isMelee) return 1;
    }

    // Ranged back preference
    if (formation.rangedBack) {
      if (a.isRanged && !b.isRanged) return 1;
      if (!a.isRanged && b.isRanged) return -1;
    }

    // Support center (handled during position assignment)
    return 0;
  });
}
