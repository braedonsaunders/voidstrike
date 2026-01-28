/**
 * Map Export Utilities
 *
 * Functions for exporting map data to various formats.
 */

import type { MapData } from '@/data/maps/MapTypes';
import type { MapJson } from '@/data/maps/schema/MapJsonSchema';
import { mapDataToJson } from '@/data/maps/serialization/serialize';
import { debugInitialization } from '@/utils/debugLogger';

/**
 * Export MapData to JSON string
 * @param map The map to export
 * @param pretty Whether to format with indentation
 */
export function exportMapToJson(map: MapData, pretty = true): string {
  const json = mapDataToJson(map);
  return pretty ? JSON.stringify(json, null, 2) : JSON.stringify(json);
}

/**
 * Export MapData to JSON object
 */
export function exportMapToJsonObject(map: MapData): MapJson {
  return mapDataToJson(map);
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Fallback for older browsers
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch {
      debugInitialization.error('Failed to copy to clipboard:', err);
      return false;
    }
  }
}

/**
 * Download a string as a file
 */
export function downloadFile(content: string, filename: string, mimeType = 'application/json'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();

  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Download map as JSON file
 */
export function downloadMapAsJson(map: MapData, filename?: string): void {
  const json = exportMapToJson(map, true);
  const name = filename || `${map.id}.json`;
  downloadFile(json, name);
}

/**
 * Calculate approximate file size of JSON export
 */
export function estimateJsonSize(map: MapData): { bytes: number; formatted: string } {
  const json = exportMapToJson(map, true);
  const bytes = new Blob([json]).size;

  // Format size
  let formatted: string;
  if (bytes < 1024) {
    formatted = `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    formatted = `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    formatted = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return { bytes, formatted };
}
