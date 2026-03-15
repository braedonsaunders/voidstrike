import { Component } from '../ecs/Component';
import {
  deterministicMagnitude3D,
  deterministicNormalize3DWithMagnitude,
} from '@/utils/DeterministicMath';

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
    return deterministicMagnitude3D(this.x, this.y, this.z);
  }

  public normalize(): void {
    const { nx, ny, nz, magnitude } = deterministicNormalize3DWithMagnitude(this.x, this.y, this.z);
    if (magnitude > 0) {
      this.x = nx;
      this.y = ny;
      this.z = nz;
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
