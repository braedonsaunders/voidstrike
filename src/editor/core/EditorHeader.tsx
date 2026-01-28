/**
 * EditorHeader - Top bar with title, controls, and actions
 */

'use client';

import { useRef, useState, useMemo } from 'react';
import type { EditorConfig, EditorMapData } from '../config/EditorConfig';
import { debugInitialization } from '@/utils/debugLogger';

export interface MapListItem {
  id: string;
  name: string;
  thumbnail?: string;
}

export interface EditorHeaderProps {
  config: EditorConfig;
  mapName: string;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  musicEnabled: boolean;
  isFullscreen: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCancel: () => void;
  onPreview?: () => void;
  onImport?: (data: EditorMapData) => void;
  onExport?: () => void;
  onToggleMusic: () => void;
  onToggleFullscreen: () => void;
  // Load Map dropdown props
  mapList?: MapListItem[];
  currentMapId?: string;
  onLoadMap?: (mapId: string) => void;
  onNewMap?: () => void;
}

export function EditorHeader({
  config,
  mapName,
  isDirty,
  canUndo,
  canRedo,
  musicEnabled,
  isFullscreen,
  onUndo,
  onRedo,
  onCancel,
  onPreview,
  onImport,
  onExport,
  onToggleMusic,
  onToggleFullscreen,
  mapList,
  currentMapId,
  onLoadMap,
  onNewMap,
}: EditorHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showLoadDropdown, setShowLoadDropdown] = useState(false);
  const [mapSearch, setMapSearch] = useState('');

  const hasLoadMapFeature = mapList && onLoadMap && onNewMap;

  // Filter maps based on search
  const filteredMaps = useMemo(() => {
    if (!mapList) return [];
    if (!mapSearch.trim()) return mapList;
    const searchLower = mapSearch.toLowerCase();
    return mapList.filter(map => map.name.toLowerCase().includes(searchLower));
  }, [mapList, mapSearch]);

  // Handle file import
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImport) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        onImport(json);
      } catch (err) {
        debugInitialization.error('Failed to parse map JSON:', err);
        alert('Invalid map file. Please select a valid JSON map file.');
      }
    };
    reader.readAsText(file);

    // Reset input so same file can be selected again
    e.target.value = '';
  };

  return (
    <header
      className="flex-shrink-0 h-12 flex items-center px-4 border-b"
      style={{
        backgroundColor: 'var(--editor-surface)',
        borderColor: 'var(--editor-border)',
      }}
    >
      {/* Left section: Back and title */}
      <div className="flex items-center gap-4 flex-1">
        <button
          onClick={onCancel}
          className="text-sm transition-colors hover:opacity-80"
          style={{ color: 'var(--editor-text-secondary)' }}
        >
          &larr; Back
        </button>

        <div
          className="h-5 w-px"
          style={{ backgroundColor: 'var(--editor-border)' }}
        />

        <div className="flex items-center gap-2">
          <h1 className="text-sm font-medium" style={{ color: 'var(--editor-text)' }}>
            {mapName}
          </h1>
          {isDirty && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: 'var(--editor-warning)',
                color: 'var(--editor-bg)',
              }}
            >
              Unsaved
            </span>
          )}
        </div>
      </div>

      {/* Center section: Undo/Redo */}
      <div className="flex items-center gap-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className="w-8 h-8 rounded flex items-center justify-center text-sm transition-colors disabled:opacity-30"
          style={{
            backgroundColor: 'var(--editor-bg)',
            color: 'var(--editor-text-secondary)',
          }}
        >
          ↩
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          className="w-8 h-8 rounded flex items-center justify-center text-sm transition-colors disabled:opacity-30"
          style={{
            backgroundColor: 'var(--editor-bg)',
            color: 'var(--editor-text-secondary)',
          }}
        >
          ↪
        </button>
      </div>

      {/* Right section: Actions */}
      <div className="flex items-center gap-2 ml-4">
        {/* Load Map Dropdown */}
        {hasLoadMapFeature && (
          <div className="relative">
            <button
              onClick={() => setShowLoadDropdown(!showLoadDropdown)}
              className="px-3 py-1.5 text-sm font-medium rounded transition-colors hover:opacity-90 flex items-center gap-1.5"
              style={{
                backgroundColor: 'var(--editor-surface)',
                color: 'var(--editor-text)',
                border: '1px solid var(--editor-border)',
              }}
            >
              Load Map
              <svg
                className={`w-3 h-3 transition-transform ${showLoadDropdown ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showLoadDropdown && (
              <>
                {/* Click outside to close */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => {
                    setShowLoadDropdown(false);
                    setMapSearch('');
                  }}
                />
                <div
                  className="absolute top-full right-0 mt-1 w-64 rounded-lg shadow-xl z-50 flex flex-col"
                  style={{
                    backgroundColor: 'var(--editor-bg)',
                    border: '1px solid var(--editor-border)',
                    maxHeight: '400px',
                  }}
                >
                  {/* Search input */}
                  <div
                    className="p-2 flex-shrink-0"
                    style={{ borderBottom: '1px solid var(--editor-border)' }}
                  >
                    <div className="relative">
                      <svg
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        style={{ color: 'var(--editor-text-muted)' }}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        type="text"
                        placeholder="Search maps..."
                        value={mapSearch}
                        onChange={(e) => setMapSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-sm rounded outline-none"
                        style={{
                          backgroundColor: 'var(--editor-surface)',
                          color: 'var(--editor-text)',
                          border: '1px solid var(--editor-border)',
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>

                  {/* New Map option */}
                  <button
                    onClick={() => {
                      onNewMap();
                      setShowLoadDropdown(false);
                      setMapSearch('');
                    }}
                    className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors hover:opacity-80 flex-shrink-0"
                    style={{
                      color: 'var(--editor-text)',
                      borderBottom: '1px solid var(--editor-border)',
                    }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--editor-text-secondary)' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    New Blank Map
                  </button>

                  {/* Scrollable maps list */}
                  <div className="flex-1 overflow-y-auto min-h-0">
                    <div
                      className="px-3 py-1.5 text-xs uppercase tracking-wider sticky top-0"
                      style={{
                        color: 'var(--editor-text-muted)',
                        backgroundColor: 'var(--editor-bg)',
                      }}
                    >
                      {mapSearch.trim() ? `Results (${filteredMaps.length})` : 'Existing Maps'}
                    </div>
                    {filteredMaps.length === 0 ? (
                      <div
                        className="px-3 py-4 text-sm text-center"
                        style={{ color: 'var(--editor-text-muted)' }}
                      >
                        No maps found
                      </div>
                    ) : (
                      filteredMaps.map((map: MapListItem) => (
                        <button
                          key={map.id}
                          onClick={() => {
                            onLoadMap(map.id);
                            setShowLoadDropdown(false);
                            setMapSearch('');
                          }}
                          className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors hover:opacity-80"
                          style={{
                            backgroundColor: currentMapId === map.id ? 'var(--editor-selection)' : 'transparent',
                            color: currentMapId === map.id ? 'var(--editor-text)' : 'var(--editor-text-secondary)',
                          }}
                        >
                          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--editor-text-muted)' }}>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                          </svg>
                          <span className="truncate">{map.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Import button */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-3 py-1.5 text-sm font-medium rounded transition-colors hover:opacity-90"
          style={{
            backgroundColor: 'var(--editor-surface)',
            color: 'var(--editor-text-secondary)',
            border: `1px solid var(--editor-border)`,
          }}
          title="Import map from JSON file"
        >
          Import
        </button>

        {/* Export button */}
        {onExport && (
          <button
            onClick={onExport}
            className="px-3 py-1.5 text-sm font-medium rounded transition-colors hover:opacity-90"
            style={{
              backgroundColor: 'var(--editor-surface)',
              color: 'var(--editor-text-secondary)',
              border: `1px solid var(--editor-border)`,
            }}
            title="Export map as JSON file"
          >
            Export
          </button>
        )}

        {/* Divider */}
        <div
          className="h-5 w-px mx-1"
          style={{ backgroundColor: 'var(--editor-border)' }}
        />

        {/* Mute/Unmute button */}
        <button
          onClick={onToggleMusic}
          className="w-8 h-8 rounded flex items-center justify-center text-sm transition-colors hover:opacity-80"
          style={{
            backgroundColor: 'var(--editor-bg)',
            color: 'var(--editor-text-secondary)',
          }}
          title={musicEnabled ? 'Mute Music' : 'Unmute Music'}
        >
          {musicEnabled ? '🔊' : '🔇'}
        </button>

        {/* Fullscreen button */}
        <button
          onClick={onToggleFullscreen}
          className="w-8 h-8 rounded flex items-center justify-center text-sm transition-colors hover:opacity-80"
          style={{
            backgroundColor: 'var(--editor-bg)',
            color: 'var(--editor-text-secondary)',
          }}
          title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
        >
          ⛶
        </button>

        {/* Divider */}
        <div
          className="h-5 w-px mx-1"
          style={{ backgroundColor: 'var(--editor-border)' }}
        />

        {/* Cancel button */}
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm transition-colors hover:opacity-80"
          style={{ color: 'var(--editor-text-secondary)' }}
        >
          Cancel
        </button>

        {/* Preview button */}
        {onPreview && (
          <button
            onClick={onPreview}
            className="px-4 py-1.5 text-sm font-medium rounded transition-colors hover:opacity-90"
            style={{
              backgroundColor: 'var(--editor-primary)',
              color: 'var(--editor-text)',
            }}
            title="Preview map in game"
          >
            Preview
          </button>
        )}
      </div>
    </header>
  );
}

export default EditorHeader;
