import { RTSCamera } from '@/rendering/Camera';

// Global camera reference for UI components to control edge scrolling
let cameraRef: RTSCamera | null = null;

export function setCameraRef(camera: RTSCamera | null): void {
  cameraRef = camera;
}

export function getCameraRef(): RTSCamera | null {
  return cameraRef;
}

// Convenience function to enable/disable edge scrolling
export function setEdgeScrollEnabled(enabled: boolean): void {
  if (cameraRef) {
    cameraRef.setEdgeScrollEnabled(enabled);
  }
}
