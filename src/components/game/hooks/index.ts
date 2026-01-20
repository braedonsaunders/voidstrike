/**
 * Game Canvas Hooks
 *
 * These hooks extract the various concerns from WebGPUGameCanvas into
 * focused, testable, and maintainable units.
 */

export { useWebGPURenderer, type WebGPURendererRefs, type UseWebGPURendererProps, type UseWebGPURendererReturn } from './useWebGPURenderer';
export { useCameraControl, type UseCameraControlProps, type UseCameraControlReturn } from './useCameraControl';
export { useGameInput, type UseGameInputProps, type SelectionState, type UseGameInputReturn } from './useGameInput';
export { usePostProcessing, type UsePostProcessingProps } from './usePostProcessing';
