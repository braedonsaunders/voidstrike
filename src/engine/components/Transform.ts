import { Component } from '../ecs/Component';
import { distance } from '@/utils/math';

export class Transform extends Component {
  public readonly type = 'Transform';

  public x: number;
  public y: number;
  public z: number;
  public rotation: number;
  public scaleX: number;
  public scaleY: number;
  public scaleZ: number;

  // Previous position and rotation for interpolation
  public prevX: number;
  public prevY: number;
  public prevZ: number;
  public prevRotation: number;

  constructor(
    x = 0,
    y = 0,
    z = 0,
    rotation = 0,
    scaleX = 1,
    scaleY = 1,
    scaleZ = 1
  ) {
    super();
    this.x = x;
    this.y = y;
    this.z = z;
    this.rotation = rotation;
    this.scaleX = scaleX;
    this.scaleY = scaleY;
    this.scaleZ = scaleZ;

    this.prevX = x;
    this.prevY = y;
    this.prevZ = z;
    this.prevRotation = rotation;
  }

  public setPosition(x: number, y: number, z?: number): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;

    this.x = x;
    this.y = y;
    if (z !== undefined) this.z = z;
  }

  public translate(dx: number, dy: number, dz = 0): void {
    this.setPosition(this.x + dx, this.y + dy, this.z + dz);
  }

  public distanceTo(other: Transform): number {
    return distance(this.x, this.y, other.x, other.y);
  }

  public distanceToPoint(x: number, y: number): number {
    return distance(this.x, this.y, x, y);
  }

  public setRotation(rotation: number): void {
    this.prevRotation = this.rotation;
    this.rotation = rotation;
  }

  public lookAt(x: number, y: number): void {
    this.prevRotation = this.rotation;
    this.rotation = Math.atan2(y - this.y, x - this.x);
  }

  /**
   * Sync previous position/rotation to current values.
   * Call this when a unit stops moving to ensure velocity-based
   * animation detection sees zero velocity.
   */
  public syncPrevious(): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
    this.prevRotation = this.rotation;
  }

  public clone(): Transform {
    return new Transform(
      this.x,
      this.y,
      this.z,
      this.rotation,
      this.scaleX,
      this.scaleY,
      this.scaleZ
    );
  }
}
