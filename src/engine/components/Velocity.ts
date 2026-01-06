import { Component } from '../ecs/Component';

export class Velocity extends Component {
  public readonly type = 'Velocity';

  public x: number;
  public y: number;
  public z: number;

  constructor(x = 0, y = 0, z = 0) {
    super();
    this.x = x;
    this.y = y;
    this.z = z;
  }

  public set(x: number, y: number, z = 0): void {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  public setFromAngle(angle: number, magnitude: number): void {
    this.x = Math.cos(angle) * magnitude;
    this.y = Math.sin(angle) * magnitude;
  }

  public getMagnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  public normalize(): void {
    const mag = this.getMagnitude();
    if (mag > 0) {
      this.x /= mag;
      this.y /= mag;
      this.z /= mag;
    }
  }

  public scale(factor: number): void {
    this.x *= factor;
    this.y *= factor;
    this.z *= factor;
  }

  public zero(): void {
    this.x = 0;
    this.y = 0;
    this.z = 0;
  }
}
