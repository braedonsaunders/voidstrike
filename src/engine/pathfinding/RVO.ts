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

export interface RVOAgent {
  id: number;
  x: number;
  y: number;
  vx: number; // Current velocity x
  vy: number; // Current velocity y
  prefVx: number; // Preferred velocity x
  prefVy: number; // Preferred velocity y
  radius: number;
  maxSpeed: number;
  // Output
  newVx: number;
  newVy: number;
}

interface ORCALine {
  // Point on the line
  px: number;
  py: number;
  // Direction of the line (unit vector, points into allowed half-plane)
  dx: number;
  dy: number;
}

// Constants
const TIME_HORIZON = 2.0; // How far ahead to look for collisions (seconds)
const TIME_HORIZON_OBSTACLE = 0.5; // Time horizon for static obstacles
const EPSILON = 0.00001;
const MAX_ORCA_LINES = 64; // Max lines per agent

/**
 * RVO2 Simulator for local collision avoidance
 */
export class RVOSimulator {
  private agents: Map<number, RVOAgent> = new Map();
  private orcaLines: ORCALine[] = [];

  constructor() {
    // Pre-allocate ORCA lines array
    for (let i = 0; i < MAX_ORCA_LINES; i++) {
      this.orcaLines.push({ px: 0, py: 0, dx: 0, dy: 0 });
    }
  }

  /**
   * Add or update an agent
   */
  public setAgent(agent: RVOAgent): void {
    this.agents.set(agent.id, agent);
  }

  /**
   * Remove an agent
   */
  public removeAgent(id: number): void {
    this.agents.delete(id);
  }

  /**
   * Get an agent by ID
   */
  public getAgent(id: number): RVOAgent | undefined {
    return this.agents.get(id);
  }

  /**
   * Compute new velocities for all agents using ORCA
   * @param neighborIds For each agent ID, array of neighbor agent IDs
   */
  public computeNewVelocities(neighborIds: Map<number, number[]>): void {
    for (const [agentId, neighbors] of neighborIds) {
      const agent = this.agents.get(agentId);
      if (!agent) continue;

      this.computeAgentVelocity(agent, neighbors);
    }
  }

  /**
   * Compute new velocity for a single agent
   */
  private computeAgentVelocity(agent: RVOAgent, neighborIds: number[]): void {
    let numOrcaLines = 0;

    // Create ORCA lines from neighboring agents
    for (const neighborId of neighborIds) {
      if (numOrcaLines >= MAX_ORCA_LINES) break;

      const neighbor = this.agents.get(neighborId);
      if (!neighbor) continue;

      const line = this.orcaLines[numOrcaLines];
      if (this.createORCALine(agent, neighbor, line)) {
        numOrcaLines++;
      }
    }

    // Find optimal velocity that satisfies all ORCA constraints
    const result = this.linearProgram2(
      agent,
      numOrcaLines,
      agent.prefVx,
      agent.prefVy
    );

    agent.newVx = result.vx;
    agent.newVy = result.vy;
  }

  /**
   * Create an ORCA half-plane from agent to neighbor
   * Returns true if line was created
   */
  private createORCALine(agent: RVOAgent, neighbor: RVOAgent, line: ORCALine): boolean {
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
      // No collision - compute velocity obstacle
      const w = {
        x: relVelX - relPosX / TIME_HORIZON,
        y: relVelY - relPosY / TIME_HORIZON,
      };

      const wLenSq = w.x * w.x + w.y * w.y;
      const dotProd1 = w.x * relPosX + w.y * relPosY;

      if (dotProd1 < 0 && dotProd1 * dotProd1 > combinedRadiusSq * wLenSq) {
        // Project on cut-off circle
        const wLen = Math.sqrt(wLenSq);
        const unitW = { x: w.x / wLen, y: w.y / wLen };
        lineDir = { x: unitW.y, y: -unitW.x };
        u = {
          x: unitW.x * (combinedRadius / TIME_HORIZON - wLen),
          y: unitW.y * (combinedRadius / TIME_HORIZON - wLen),
        };
      } else {
        // Project on legs
        const leg = Math.sqrt(distSq - combinedRadiusSq);
        const dist = Math.sqrt(distSq);

        if (this.det(relPosX, relPosY, w.x, w.y) > 0) {
          // Project on left leg
          lineDir = {
            x: (relPosX * leg - relPosY * combinedRadius) / distSq,
            y: (relPosX * combinedRadius + relPosY * leg) / distSq,
          };
        } else {
          // Project on right leg
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
      // Collision - project on cut-off circle at time step
      const dist = Math.sqrt(distSq);
      const invTimeStep = 1.0 / 0.025; // Assuming 40Hz update

      const w = {
        x: relVelX - relPosX * invTimeStep,
        y: relVelY - relPosY * invTimeStep,
      };

      const wLen = Math.sqrt(w.x * w.x + w.y * w.y);
      if (wLen < EPSILON) {
        // Velocities are same, pick arbitrary direction
        const unitW = { x: 1, y: 0 };
        lineDir = { x: unitW.y, y: -unitW.x };
        u = {
          x: unitW.x * (combinedRadius * invTimeStep - wLen),
          y: unitW.y * (combinedRadius * invTimeStep - wLen),
        };
      } else {
        const unitW = { x: w.x / wLen, y: w.y / wLen };
        lineDir = { x: unitW.y, y: -unitW.x };
        u = {
          x: unitW.x * (combinedRadius * invTimeStep - wLen),
          y: unitW.y * (combinedRadius * invTimeStep - wLen),
        };
      }
    }

    // ORCA line: Point is velocity + 0.5 * u (split responsibility)
    // Direction points into the allowed half-plane
    line.px = agent.vx + 0.5 * u.x;
    line.py = agent.vy + 0.5 * u.y;
    line.dx = lineDir.x;
    line.dy = lineDir.y;

    return true;
  }

  /**
   * 2D linear program to find optimal velocity
   */
  private linearProgram2(
    agent: RVOAgent,
    numLines: number,
    prefVx: number,
    prefVy: number
  ): { vx: number; vy: number } {
    // Start with preferred velocity
    let resultVx = prefVx;
    let resultVy = prefVy;

    // Process each line
    for (let i = 0; i < numLines; i++) {
      const line = this.orcaLines[i];

      // Check if current result satisfies this line
      const det = this.det(line.dx, line.dy, line.px - resultVx, line.py - resultVy);

      if (det > 0) {
        // Current result is on wrong side of line - project onto line
        const result = this.linearProgram1(
          agent,
          i,
          resultVx,
          resultVy
        );
        resultVx = result.vx;
        resultVy = result.vy;
      }
    }

    return { vx: resultVx, vy: resultVy };
  }

  /**
   * 1D linear program - project onto a line while satisfying previous constraints
   */
  private linearProgram1(
    agent: RVOAgent,
    lineIndex: number,
    optVx: number,
    optVy: number
  ): { vx: number; vy: number } {
    const line = this.orcaLines[lineIndex];

    // Find the furthest point along the line that satisfies all previous lines
    // while staying within speed limit

    // Project optimal velocity onto line
    const dotProduct = (optVx - line.px) * line.dx + (optVy - line.py) * line.dy;

    // Clamp to speed limit
    const discriminant = agent.maxSpeed * agent.maxSpeed - this.sqr(line.px) - this.sqr(line.py)
      + this.sqr(dotProduct);

    if (discriminant < 0) {
      // Speed limit circle doesn't intersect line - find closest point on circle
      const len = Math.sqrt(line.px * line.px + line.py * line.py);
      if (len > EPSILON) {
        return {
          vx: (line.px / len) * agent.maxSpeed,
          vy: (line.py / len) * agent.maxSpeed,
        };
      }
      return { vx: 0, vy: 0 };
    }

    const sqrtDiscriminant = Math.sqrt(discriminant);
    let tLeft = -sqrtDiscriminant - dotProduct;
    let tRight = sqrtDiscriminant - dotProduct;

    // Constrain by previous lines
    for (let i = 0; i < lineIndex; i++) {
      const prevLine = this.orcaLines[i];
      const denominator = this.det(line.dx, line.dy, prevLine.dx, prevLine.dy);
      const numerator = this.det(prevLine.dx, prevLine.dy, line.px - prevLine.px, line.py - prevLine.py);

      if (Math.abs(denominator) < EPSILON) {
        // Lines are parallel
        if (numerator < 0) {
          // Line is on wrong side - no feasible solution
          return this.projectOnCircle(agent, line.px, line.py);
        }
        continue;
      }

      const t = numerator / denominator;
      if (denominator >= 0) {
        tRight = Math.min(tRight, t);
      } else {
        tLeft = Math.max(tLeft, t);
      }

      if (tLeft > tRight) {
        // Infeasible - project onto circle
        return this.projectOnCircle(agent, line.px, line.py);
      }
    }

    // Find point on line closest to optimal velocity
    const t = Math.max(tLeft, Math.min(tRight, dotProduct));
    return {
      vx: line.px + t * line.dx,
      vy: line.py + t * line.dy,
    };
  }

  /**
   * Project a point onto the speed limit circle
   */
  private projectOnCircle(agent: RVOAgent, vx: number, vy: number): { vx: number; vy: number } {
    const len = Math.sqrt(vx * vx + vy * vy);
    if (len > EPSILON) {
      return {
        vx: (vx / len) * agent.maxSpeed,
        vy: (vy / len) * agent.maxSpeed,
      };
    }
    return { vx: 0, vy: 0 };
  }

  /**
   * 2D cross product / determinant
   */
  private det(x1: number, y1: number, x2: number, y2: number): number {
    return x1 * y2 - y1 * x2;
  }

  private sqr(x: number): number {
    return x * x;
  }

  /**
   * Clear all agents
   */
  public clear(): void {
    this.agents.clear();
  }
}

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
