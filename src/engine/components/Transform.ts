import { Component } from '../ecs/Component';

export class Transform extends Component {
  public readonly type = 'Transform';

  public x: number;
  public y: number;
  public z: number;
  public rotation: number;
  public scaleX: number;
  public scaleY: number;
  public scaleZ: number;

  // Previous position for interpolation
  public prevX: number;
  public prevY: number;
  public prevZ: number;

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
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  public distanceToPoint(x: number, y: number): number {
    const dx = this.x - x;
    const dy = this.y - y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  public lookAt(x: number, y: number): void {
    this.rotation = Math.atan2(y - this.y, x - this.x);
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
