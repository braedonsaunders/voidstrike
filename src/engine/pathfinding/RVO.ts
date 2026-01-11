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

/**
 * Simplified ORCA for game use - integrates with existing movement system
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
  timeHorizon: number = TIME_HORIZON
): { vx: number; vy: number } {
  if (neighbors.length === 0) {
    // No neighbors - use preferred velocity clamped to max speed
    const prefSpeed = Math.sqrt(agent.prefVx * agent.prefVx + agent.prefVy * agent.prefVy);
    if (prefSpeed > agent.maxSpeed) {
      return {
        vx: (agent.prefVx / prefSpeed) * agent.maxSpeed,
        vy: (agent.prefVy / prefSpeed) * agent.maxSpeed,
      };
    }
    return { vx: agent.prefVx, vy: agent.prefVy };
  }

  // Compute ORCA lines from neighbors
  const orcaLines: Array<{ px: number; py: number; dx: number; dy: number }> = [];

  for (const neighbor of neighbors) {
    const relPosX = neighbor.x - agent.x;
    const relPosY = neighbor.y - agent.y;
    const relVelX = agent.vx - neighbor.vx;
    const relVelY = agent.vy - neighbor.vy;
    const distSq = relPosX * relPosX + relPosY * relPosY;
    const combinedRadius = agent.radius + neighbor.radius;
    const combinedRadiusSq = combinedRadius * combinedRadius;

    let u: { x: number; y: number };
    let lineDir: { x: number; y: number };

    if (distSq > combinedRadiusSq) {
      // No collision
      const w = {
        x: relVelX - relPosX / timeHorizon,
        y: relVelY - relPosY / timeHorizon,
      };

      const wLenSq = w.x * w.x + w.y * w.y;
      const dotProd1 = w.x * relPosX + w.y * relPosY;

      if (dotProd1 < 0 && dotProd1 * dotProd1 > combinedRadiusSq * wLenSq) {
        // Project on cut-off circle
        const wLen = Math.sqrt(wLenSq);
        if (wLen < EPSILON) continue;
        const unitW = { x: w.x / wLen, y: w.y / wLen };
        lineDir = { x: unitW.y, y: -unitW.x };
        u = {
          x: unitW.x * (combinedRadius / timeHorizon - wLen),
          y: unitW.y * (combinedRadius / timeHorizon - wLen),
        };
      } else {
        // Project on legs
        const dist = Math.sqrt(distSq);
        if (dist < EPSILON) continue;
        const leg = Math.sqrt(Math.max(0, distSq - combinedRadiusSq));

        if (relPosX * relVelY - relPosY * relVelX > 0) {
          // Left leg
          lineDir = {
            x: (relPosX * leg - relPosY * combinedRadius) / distSq,
            y: (relPosX * combinedRadius + relPosY * leg) / distSq,
          };
        } else {
          // Right leg
          lineDir = {
            x: -(relPosX * leg + relPosY * combinedRadius) / distSq,
            y: -(-relPosX * combinedRadius + relPosY * leg) / distSq,
          };
        }

        const dotProd2 = relVelX * lineDir.x + relVelY * lineDir.y;
        u = {
          x: dotProd2 * lineDir.x - relVelX,
          y: dotProd2 * lineDir.y - relVelY,
        };
      }
    } else {
      // Already colliding - use emergency avoidance
      const dist = Math.sqrt(distSq);
      const invTimeStep = 40; // 40Hz

      const w = {
        x: relVelX - (dist > EPSILON ? relPosX * invTimeStep / dist * combinedRadius : 0),
        y: relVelY - (dist > EPSILON ? relPosY * invTimeStep / dist * combinedRadius : 0),
      };

      const wLen = Math.sqrt(w.x * w.x + w.y * w.y);
      if (wLen < EPSILON) {
        lineDir = { x: 0, y: 1 };
        u = { x: combinedRadius * invTimeStep, y: 0 };
      } else {
        const unitW = { x: w.x / wLen, y: w.y / wLen };
        lineDir = { x: unitW.y, y: -unitW.x };
        u = {
          x: unitW.x * (combinedRadius * invTimeStep - wLen),
          y: unitW.y * (combinedRadius * invTimeStep - wLen),
        };
      }
    }

    orcaLines.push({
      px: agent.vx + 0.5 * u.x,
      py: agent.vy + 0.5 * u.y,
      dx: lineDir.x,
      dy: lineDir.y,
    });
  }

  // Solve linear program
  let resultVx = agent.prefVx;
  let resultVy = agent.prefVy;

  for (let i = 0; i < orcaLines.length; i++) {
    const line = orcaLines[i];
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

  return { vx: resultVx, vy: resultVy };
}
