import * as THREE from 'three';

/**
 * StarCraft 2-style selection circle renderer
 * Features:
 * - Team-colored glowing rings with animated pulse
 * - Inner solid ring with outer glow
 * - Pulsing animation when selected
 * - Different sizes for units vs buildings
 */

// Team color palette (SC2-inspired)
export const TEAM_COLORS = {
  player1: { primary: 0x00aaff, secondary: 0x0066cc, glow: 0x00ccff },
  player2: { primary: 0xff4444, secondary: 0xcc2222, glow: 0xff6666 },
  ai: { primary: 0xff4444, secondary: 0xcc2222, glow: 0xff6666 },
  player3: { primary: 0x44ff44, secondary: 0x22cc22, glow: 0x66ff66 },
  player4: { primary: 0xffff44, secondary: 0xcccc22, glow: 0xffff66 },
  neutral: { primary: 0xaaaaaa, secondary: 0x666666, glow: 0xcccccc },
};

export interface SelectionCircleConfig {
  radius: number;
  isBuilding: boolean;
  teamColors: { primary: number; secondary: number; glow: number };
}

/**
 * Creates an SC2-style selection circle with inner ring and outer glow
 */
export function createSC2SelectionCircle(config: SelectionCircleConfig): THREE.Group {
  const group = new THREE.Group();
  const { radius, teamColors } = config;

  // Inner solid ring - the main selection indicator
  const innerRingGeometry = new THREE.RingGeometry(
    radius * 0.92,
    radius,
    64
  );
  const innerRingMaterial = new THREE.MeshBasicMaterial({
    color: teamColors.primary,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const innerRing = new THREE.Mesh(innerRingGeometry, innerRingMaterial);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.name = 'innerRing';
  group.add(innerRing);

  // Outer glow ring - softer, larger
  const glowRingGeometry = new THREE.RingGeometry(
    radius,
    radius * 1.15,
    64
  );
  const glowRingMaterial = new THREE.MeshBasicMaterial({
    color: teamColors.glow,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const glowRing = new THREE.Mesh(glowRingGeometry, glowRingMaterial);
  glowRing.rotation.x = -Math.PI / 2;
  glowRing.name = 'glowRing';
  group.add(glowRing);

  // Animated pulse ring - expands outward periodically
  const pulseRingGeometry = new THREE.RingGeometry(
    radius * 0.95,
    radius * 1.05,
    64
  );
  const pulseRingMaterial = new THREE.MeshBasicMaterial({
    color: teamColors.glow,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const pulseRing = new THREE.Mesh(pulseRingGeometry, pulseRingMaterial);
  pulseRing.rotation.x = -Math.PI / 2;
  pulseRing.name = 'pulseRing';
  group.add(pulseRing);

  // Store initial radius for animation
  group.userData.baseRadius = radius;
  group.userData.pulseTime = Math.random() * Math.PI * 2; // Random start phase

  return group;
}

/**
 * Updates selection circle animation
 */
export function updateSelectionCircle(group: THREE.Group, deltaTime: number, isHovered: boolean = false): void {
  const baseRadius = group.userData.baseRadius || 1;
  group.userData.pulseTime = (group.userData.pulseTime || 0) + deltaTime * 3;

  const innerRing = group.getObjectByName('innerRing') as THREE.Mesh;
  const glowRing = group.getObjectByName('glowRing') as THREE.Mesh;
  const pulseRing = group.getObjectByName('pulseRing') as THREE.Mesh;

  if (innerRing) {
    // Subtle breathing animation on inner ring
    const breathe = 1 + Math.sin(group.userData.pulseTime) * 0.02;
    innerRing.scale.setScalar(breathe);

    // Brighter when hovered
    const mat = innerRing.material as THREE.MeshBasicMaterial;
    mat.opacity = isHovered ? 1.0 : 0.85;
  }

  if (glowRing) {
    // Glow pulses more visibly
    const glowPulse = 0.3 + Math.sin(group.userData.pulseTime * 1.5) * 0.15;
    const mat = glowRing.material as THREE.MeshBasicMaterial;
    mat.opacity = isHovered ? glowPulse + 0.2 : glowPulse;
  }

  if (pulseRing) {
    // Periodic expanding pulse effect
    const pulsePhase = (group.userData.pulseTime % (Math.PI * 2)) / (Math.PI * 2);

    if (pulsePhase < 0.3) {
      // Pulse is active
      const expandProgress = pulsePhase / 0.3;
      const scale = 1 + expandProgress * 0.3;
      pulseRing.scale.setScalar(scale);

      const mat = pulseRing.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - expandProgress) * 0.5;
    } else {
      // Pulse is inactive
      const mat = pulseRing.material as THREE.MeshBasicMaterial;
      mat.opacity = 0;
    }
  }
}

/**
 * Creates a unit shadow (blob shadow for grounding)
 */
export function createUnitShadow(radius: number): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(radius * 1.2, 32);
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(geometry, material);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02; // Just above ground
  shadow.name = 'unitShadow';
  return shadow;
}

/**
 * Creates a building placement ghost preview
 */
export function createBuildingGhost(
  width: number,
  height: number,
  buildingHeight: number
): THREE.Group {
  const group = new THREE.Group();

  // Main building shape (semi-transparent)
  const geometry = new THREE.BoxGeometry(width, buildingHeight, height);
  const material = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = buildingHeight / 2;
  mesh.name = 'ghostMesh';
  group.add(mesh);

  // Ground outline
  const outlineGeometry = new THREE.BufferGeometry();
  const halfW = width / 2;
  const halfH = height / 2;
  const outlineVertices = new Float32Array([
    -halfW, 0.1, -halfH,
    halfW, 0.1, -halfH,
    halfW, 0.1, -halfH,
    halfW, 0.1, halfH,
    halfW, 0.1, halfH,
    -halfW, 0.1, halfH,
    -halfW, 0.1, halfH,
    -halfW, 0.1, -halfH,
  ]);
  outlineGeometry.setAttribute('position', new THREE.BufferAttribute(outlineVertices, 3));
  const outlineMaterial = new THREE.LineBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.8,
  });
  const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
  outline.name = 'ghostOutline';
  group.add(outline);

  // Grid cells for placement validity
  const gridGroup = new THREE.Group();
  gridGroup.name = 'gridCells';
  for (let x = 0; x < Math.ceil(width); x++) {
    for (let z = 0; z < Math.ceil(height); z++) {
      const cellGeometry = new THREE.PlaneGeometry(0.9, 0.9);
      const cellMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const cell = new THREE.Mesh(cellGeometry, cellMaterial);
      cell.rotation.x = -Math.PI / 2;
      cell.position.set(
        x - width / 2 + 0.5,
        0.05,
        z - height / 2 + 0.5
      );
      cell.userData.gridX = x;
      cell.userData.gridZ = z;
      gridGroup.add(cell);
    }
  }
  group.add(gridGroup);

  return group;
}

/**
 * Updates building ghost color based on placement validity
 */
export function updateBuildingGhost(
  group: THREE.Group,
  isValid: boolean,
  invalidCells: Array<{ x: number; z: number }> = []
): void {
  const ghostMesh = group.getObjectByName('ghostMesh') as THREE.Mesh;
  const ghostOutline = group.getObjectByName('ghostOutline') as THREE.LineSegments;
  const gridCells = group.getObjectByName('gridCells') as THREE.Group;

  const validColor = 0x00ff00;
  const invalidColor = 0xff0000;

  const color = isValid ? validColor : invalidColor;

  if (ghostMesh) {
    (ghostMesh.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  if (ghostOutline) {
    (ghostOutline.material as THREE.LineBasicMaterial).color.setHex(color);
  }

  if (gridCells) {
    const invalidSet = new Set(invalidCells.map(c => `${c.x},${c.z}`));

    gridCells.children.forEach((cell) => {
      const mesh = cell as THREE.Mesh;
      const key = `${mesh.userData.gridX},${mesh.userData.gridZ}`;
      const cellValid = !invalidSet.has(key);
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(
        cellValid && isValid ? validColor : invalidColor
      );
    });
  }
}

/**
 * Creates a rally point flag indicator
 */
export function createRallyPointFlag(): THREE.Group {
  const group = new THREE.Group();

  // Flag pole
  const poleGeometry = new THREE.CylinderGeometry(0.05, 0.05, 2, 8);
  const poleMaterial = new THREE.MeshBasicMaterial({ color: 0x444444 });
  const pole = new THREE.Mesh(poleGeometry, poleMaterial);
  pole.position.y = 1;
  group.add(pole);

  // Flag (triangle)
  const flagGeometry = new THREE.BufferGeometry();
  const flagVertices = new Float32Array([
    0, 2, 0,
    0.8, 1.7, 0,
    0, 1.4, 0,
  ]);
  flagGeometry.setAttribute('position', new THREE.BufferAttribute(flagVertices, 3));
  flagGeometry.computeVertexNormals();
  const flagMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
  });
  const flag = new THREE.Mesh(flagGeometry, flagMaterial);
  flag.name = 'flag';
  group.add(flag);

  // Ground ring
  const ringGeometry = new THREE.RingGeometry(0.3, 0.5, 16);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.name = 'ring';
  group.add(ring);

  return group;
}

/**
 * Creates attack-move cursor indicator
 */
export function createAttackMoveCursor(): THREE.Group {
  const group = new THREE.Group();

  // Crosshair
  const linesMaterial = new THREE.LineBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.8,
  });

  // Horizontal line
  const hLineGeometry = new THREE.BufferGeometry();
  hLineGeometry.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([-0.5, 0.1, 0, 0.5, 0.1, 0]),
    3
  ));
  const hLine = new THREE.Line(hLineGeometry, linesMaterial);
  group.add(hLine);

  // Vertical line
  const vLineGeometry = new THREE.BufferGeometry();
  vLineGeometry.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([0, 0.1, -0.5, 0, 0.1, 0.5]),
    3
  ));
  const vLine = new THREE.Line(vLineGeometry, linesMaterial);
  group.add(vLine);

  // Outer ring
  const ringGeometry = new THREE.RingGeometry(0.4, 0.5, 16);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.1;
  group.add(ring);

  return group;
}
