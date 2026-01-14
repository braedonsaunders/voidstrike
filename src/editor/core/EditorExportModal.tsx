/**
 * EditorExportModal - Modal for exporting map data
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import type { MapData } from '@/data/maps/MapTypes';
import {
  exportMapToJson,
  copyToClipboard,
  downloadMapAsJson,
  estimateJsonSize,
} from '../utils/mapExport';

export interface EditorExportModalProps {
  map: MapData;
  isOpen: boolean;
  onClose: () => void;
}

export function EditorExportModal({ map, isOpen, onClose }: EditorExportModalProps) {
  const [copied, setCopied] = useState(false);
  const [sizeInfo, setSizeInfo] = useState<{ bytes: number; formatted: string } | null>(null);

  // Calculate size on open
  useEffect(() => {
    if (isOpen && map) {
      setSizeInfo(estimateJsonSize(map));
    }
  }, [isOpen, map]);

  // Reset copied state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCopied(false);
    }
  }, [isOpen]);

  const handleCopy = useCallback(async () => {
    const json = exportMapToJson(map, true);
    const success = await copyToClipboard(json);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [map]);

  const handleDownload = useCallback(() => {
    downloadMapAsJson(map);
  }, [map]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
      onClick={handleClose}
    >
      <div
        className="rounded-lg shadow-xl max-w-md w-full mx-4"
        style={{
          backgroundColor: 'var(--editor-surface)',
          border: '1px solid var(--editor-border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b"
          style={{ borderColor: 'var(--editor-border)' }}
        >
          <h2 className="text-lg font-medium" style={{ color: 'var(--editor-text)' }}>
            Export Map
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--editor-text-secondary)' }}>
            Export &quot;{map.name}&quot; as JSON
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Map info */}
          <div
            className="p-3 rounded text-sm"
            style={{ backgroundColor: 'var(--editor-bg)' }}
          >
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span style={{ color: 'var(--editor-text-muted)' }}>ID:</span>{' '}
                <span style={{ color: 'var(--editor-text)' }}>{map.id}</span>
              </div>
              <div>
                <span style={{ color: 'var(--editor-text-muted)' }}>Size:</span>{' '}
                <span style={{ color: 'var(--editor-text)' }}>
                  {map.width} x {map.height}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--editor-text-muted)' }}>Players:</span>{' '}
                <span style={{ color: 'var(--editor-text)' }}>{map.playerCount}</span>
              </div>
              <div>
                <span style={{ color: 'var(--editor-text-muted)' }}>File Size:</span>{' '}
                <span style={{ color: 'var(--editor-text)' }}>
                  {sizeInfo?.formatted || 'Calculating...'}
                </span>
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="text-sm" style={{ color: 'var(--editor-text-secondary)' }}>
            <p className="mb-2">To update a map in the codebase:</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Copy the JSON to clipboard</li>
              <li>
                Paste into{' '}
                <code
                  className="px-1 py-0.5 rounded text-xs"
                  style={{ backgroundColor: 'var(--editor-bg)' }}
                >
                  public/data/maps/{map.id}.json
                </code>
              </li>
              <li>Commit and push</li>
            </ol>
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleCopy}
              className="flex-1 px-4 py-2.5 text-sm font-medium rounded transition-colors"
              style={{
                backgroundColor: copied ? 'var(--editor-success)' : 'var(--editor-primary)',
                color: 'var(--editor-text)',
              }}
            >
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>

            <button
              onClick={handleDownload}
              className="flex-1 px-4 py-2.5 text-sm font-medium rounded transition-colors"
              style={{
                backgroundColor: 'var(--editor-surface)',
                color: 'var(--editor-text)',
                border: '1px solid var(--editor-border)',
              }}
            >
              Download .json
            </button>
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-6 py-3 border-t flex justify-end"
          style={{ borderColor: 'var(--editor-border)' }}
        >
          <button
            onClick={handleClose}
            className="px-4 py-1.5 text-sm transition-colors"
            style={{ color: 'var(--editor-text-secondary)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default EditorExportModal;
