/**
 * Utility functions for game setup components
 */

/**
 * Convert THREE.Color-like object to hex string
 */
export function colorToHex(color: { r: number; g: number; b: number }): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Convert hex number to CSS color string
 */
export function hexToCSS(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}
