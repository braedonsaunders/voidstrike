/**
 * Game Canvas Hooks
 *
 * These hooks extract the various concerns from WebGPUGameCanvas into
 * focused, testable, and maintainable units.
 */

export { useWebGPURenderer, type WebGPURendererRefs, type UseWebGPURendererProps, type UseWebGPURendererReturn } from './useWebGPURenderer';
export { useCameraControl, type UseCameraControlProps, type UseCameraControlReturn } from './useCameraControl';
export { useGameInput, type UseGameInputProps, type UseGameInputReturn } from './useGameInput';
export type { SelectionState } from '@/engine/input';
export { usePostProcessing, type UsePostProcessingProps } from './usePostProcessing';
export { useWorkerBridge, type UseWorkerBridgeProps, type UseWorkerBridgeReturn } from './useWorkerBridge';
export { usePhaserOverlay, type UsePhaserOverlayProps, type UsePhaserOverlayReturn } from './usePhaserOverlay';
export { useLoadingState, type UseLoadingStateProps, type UseLoadingStateReturn } from './useLoadingState';
