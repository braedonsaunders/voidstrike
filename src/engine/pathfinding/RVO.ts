/**
 * RVO2 (Reciprocal Velocity Obstacles) Implementation
 *
 * Industry-standard local collision avoidance algorithm used in recast-navigation.
 * Each agent computes ORCA half-planes from neighbors and finds the optimal
 * collision-free velocity closest to their preferred velocity.
 *
 * Key features:
 * - Reciprocal: Both agents adjust, splitting responsibility
 * - Optimal: Finds velocity closest to preferred
 * - Scalable: O(n) per agent with spatial hashing
 * - Smooth: No jittering or oscillation
 */

// Constants
const TIME_HORIZON = 2.0; // How far ahead to look for collisions (seconds)
const EPSILON = 0.00001;

// PERF: Pre-allocated objects to avoid per-frame GC pressure
// These are reused across all computeORCAVelocity calls
const MAX_ORCA_LINES = 32; // Max neighbors typically handled
const _orcaLines: Array<{ px: number; py: number; dx: number; dy: number }> = [];
for (let i = 0; i < MAX_ORCA_LINES; i++) {
  _orcaLines.push({ px: 0, py: 0, dx: 0, dy: 0 });
}
let _orcaLineCount = 0;

// Pre-allocated result object (reused every call)
const _result = { vx: 0, vy: 0 };

/**
 * Simplified ORCA for game use - integrates with existing movement system
 * PERF: Optimized to avoid per-call allocations - uses pre-allocated objects
 * @param neighborCount Optional count to use instead of neighbors.length (for pre-allocated arrays)
 */
export function computeORCAVelocity(
  agent: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    prefVx: number;
    prefVy: number;
    radius: number;
    maxSpeed: number;
  },
  neighbors: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
  }>,
  timeHorizon: number = TIME_HORIZON,
  neighborCount?: number
): { vx: number; vy: number } {
  const actualNeighborCount = neighborCount !== undefined ? neighborCount : neighbors.length;
  if (actualNeighborCount === 0) {
    // No neighbors - use preferred velocity clamped to max speed
    const prefSpeed = Math.sqrt(agent.prefVx * agent.prefVx + agent.prefVy * agent.prefVy);
    if (prefSpeed > agent.maxSpeed) {
      _result.vx = (agent.prefVx / prefSpeed) * agent.maxSpeed;
      _result.vy = (agent.prefVy / prefSpeed) * agent.maxSpeed;
    } else {
      _result.vx = agent.prefVx;
      _result.vy = agent.prefVy;
    }
    return _result;
  }

  // PERF: Reset orca line count instead of creating new array
  _orcaLineCount = 0;

  // PERF: Use local variables instead of object literals
  let wX: number, wY: number;
  let uX: number, uY: number;
  let lineDirX: number, lineDirY: number;
  let unitWX: number, unitWY: number;

  for (let n = 0; n < actualNeighborCount; n++) {
    const neighbor = neighbors[n];
    const relPosX = neighbor.x - agent.x;
    const relPosY = neighbor.y - agent.y;
    const relVelX = agent.vx - neighbor.vx;
    const relVelY = agent.vy - neighbor.vy;
    const distSq = relPosX * relPosX + relPosY * relPosY;
    const combinedRadius = agent.radius + neighbor.radius;
    const combinedRadiusSq = combinedRadius * combinedRadius;

    if (distSq > combinedRadiusSq) {
      // No collision
      wX = relVelX - relPosX / timeHorizon;
      wY = relVelY - relPosY / timeHorizon;

      const wLenSq = wX * wX + wY * wY;
      const dotProd1 = wX * relPosX + wY * relPosY;

      if (dotProd1 < 0 && dotProd1 * dotProd1 > combinedRadiusSq * wLenSq) {
        // Project on cut-off circle
        const wLen = Math.sqrt(wLenSq);
        if (wLen < EPSILON) continue;
        unitWX = wX / wLen;
        unitWY = wY / wLen;
        lineDirX = unitWY;
        lineDirY = -unitWX;
        uX = unitWX * (combinedRadius / timeHorizon - wLen);
        uY = unitWY * (combinedRadius / timeHorizon - wLen);
      } else {
        // Project on legs
        const dist = Math.sqrt(distSq);
        if (dist < EPSILON) continue;
        const leg = Math.sqrt(Math.max(0, distSq - combinedRadiusSq));

        if (relPosX * relVelY - relPosY * relVelX > 0) {
          // Left leg
          lineDirX = (relPosX * leg - relPosY * combinedRadius) / distSq;
          lineDirY = (relPosX * combinedRadius + relPosY * leg) / distSq;
        } else {
          // Right leg
          lineDirX = -(relPosX * leg + relPosY * combinedRadius) / distSq;
          lineDirY = -(-relPosX * combinedRadius + relPosY * leg) / distSq;
        }

        const dotProd2 = relVelX * lineDirX + relVelY * lineDirY;
        uX = dotProd2 * lineDirX - relVelX;
        uY = dotProd2 * lineDirY - relVelY;
      }
    } else {
      // Already colliding - use emergency avoidance
      const dist = Math.sqrt(distSq);
      const invTimeStep = 40; // 40Hz

      wX = relVelX - (dist > EPSILON ? relPosX * invTimeStep / dist * combinedRadius : 0);
      wY = relVelY - (dist > EPSILON ? relPosY * invTimeStep / dist * combinedRadius : 0);

      const wLen = Math.sqrt(wX * wX + wY * wY);
      if (wLen < EPSILON) {
        lineDirX = 0;
        lineDirY = 1;
        uX = combinedRadius * invTimeStep;
        uY = 0;
      } else {
        unitWX = wX / wLen;
        unitWY = wY / wLen;
        lineDirX = unitWY;
        lineDirY = -unitWX;
        uX = unitWX * (combinedRadius * invTimeStep - wLen);
        uY = unitWY * (combinedRadius * invTimeStep - wLen);
      }
    }

    // PERF: Reuse pre-allocated orca line object
    if (_orcaLineCount < MAX_ORCA_LINES) {
      const line = _orcaLines[_orcaLineCount];
      line.px = agent.vx + 0.5 * uX;
      line.py = agent.vy + 0.5 * uY;
      line.dx = lineDirX;
      line.dy = lineDirY;
      _orcaLineCount++;
    }
  }

  // Solve linear program
  let resultVx = agent.prefVx;
  let resultVy = agent.prefVy;

  for (let i = 0; i < _orcaLineCount; i++) {
    const line = _orcaLines[i];
    const det = line.dx * (line.py - resultVy) - line.dy * (line.px - resultVx);

    if (det > 0) {
      // Project onto line
      const dotProduct = (resultVx - line.px) * line.dx + (resultVy - line.py) * line.dy;
      resultVx = line.px + dotProduct * line.dx;
      resultVy = line.py + dotProduct * line.dy;
    }
  }

  // Clamp to max speed
  const speed = Math.sqrt(resultVx * resultVx + resultVy * resultVy);
  if (speed > agent.maxSpeed) {
    resultVx = (resultVx / speed) * agent.maxSpeed;
    resultVy = (resultVy / speed) * agent.maxSpeed;
  }

  // PERF: Reuse pre-allocated result object
  _result.vx = resultVx;
  _result.vy = resultVy;
  return _result;
}
