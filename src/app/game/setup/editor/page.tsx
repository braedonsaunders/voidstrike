'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EditorCore, VOIDSTRIKE_EDITOR_CONFIG } from '@/editor';
import { voidstrikeDataProvider } from '@/editor/providers/voidstrike';
import type { EditorMapData } from '@/editor';

/**
 * Map Editor Page
 *
 * Uses the reusable EditorCore component with VOIDSTRIKE-specific configuration.
 * The editor is fully config-driven and could be extracted to a separate library.
 *
 * Query params:
 * - ?new=true - Creates a new blank map
 * - ?map=<mapId> - Loads an existing map for editing
 */

interface MapListItem {
  id: string;
  name: string;
  thumbnail?: string;
}

function EditorPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNewMap = searchParams.get('new') === 'true';
  const mapIdParam = searchParams.get('map');

  // State for map selection dropdown
  const [mapList, setMapList] = useState<MapListItem[]>([]);
  const [showMapDropdown, setShowMapDropdown] = useState(false);
  const [currentMapId, setCurrentMapId] = useState<string | undefined>(
    isNewMap ? undefined : (mapIdParam || undefined)
  );
  const [editorKey, setEditorKey] = useState(0); // Key to force re-render EditorCore

  // Load available maps list
  useEffect(() => {
    const loadMapList = async () => {
      const maps = await voidstrikeDataProvider.getMapList();
      setMapList(maps);
    };
    loadMapList();
  }, []);

  const handleSave = (data: EditorMapData) => {
    console.log('Map saved:', data);
    // TODO: Persist to storage or state
  };

  const handleCancel = () => {
    // Navigate back to home if came from home page (new=true), otherwise to setup
    if (isNewMap) {
      router.push('/');
    } else {
      router.push('/game/setup');
    }
  };

  const handlePlay = (data: EditorMapData) => {
    // Convert to game format and store in state
    const gameData = voidstrikeDataProvider.exportForGame?.(data);
    console.log('Playing with edited map:', gameData);

    // TODO: Store the edited map data in gameSetupStore
    // For now, just navigate back to setup
    router.push('/game/setup');
  };

  const handleLoadMap = useCallback((mapId: string) => {
    setCurrentMapId(mapId);
    setEditorKey((prev: number) => prev + 1); // Force EditorCore to re-mount
    setShowMapDropdown(false);
    // Update URL without full navigation
    router.replace(`/game/setup/editor?map=${mapId}`);
  }, [router]);

  const handleNewMap = useCallback(() => {
    setCurrentMapId(undefined);
    setEditorKey((prev: number) => prev + 1);
    setShowMapDropdown(false);
    router.replace('/game/setup/editor?new=true');
  }, [router]);

  return (
    <div className="relative h-screen">
      {/* Map Selection Dropdown */}
      <div className="absolute top-3 left-3 z-50">
        <div className="relative">
          <button
            onClick={() => setShowMapDropdown(!showMapDropdown)}
            className="flex items-center gap-2 px-3 py-1.5 bg-void-800/90 hover:bg-void-700/90
                       border border-void-600/50 rounded text-void-200 text-sm
                       backdrop-blur-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            Load Map
            <svg className={`w-3 h-3 transition-transform ${showMapDropdown ? 'rotate-180' : ''}`}
                 fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showMapDropdown && (
            <div className="absolute top-full left-0 mt-1 w-64 max-h-80 overflow-y-auto
                           bg-void-900/95 border border-void-600/50 rounded-lg shadow-xl backdrop-blur-sm">
              {/* New Map option */}
              <button
                onClick={handleNewMap}
                className="w-full px-3 py-2 text-left text-sm text-void-200 hover:bg-void-700/50
                           flex items-center gap-2 border-b border-void-700/50"
              >
                <svg className="w-4 h-4 text-void-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Blank Map
              </button>

              {/* Existing maps */}
              <div className="py-1">
                <div className="px-3 py-1 text-xs text-void-500 uppercase tracking-wider">
                  Existing Maps
                </div>
                {mapList.map((map: MapListItem) => (
                  <button
                    key={map.id}
                    onClick={() => handleLoadMap(map.id)}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-void-700/50 flex items-center gap-2
                               ${currentMapId === map.id ? 'bg-void-700/30 text-void-100' : 'text-void-300'}`}
                  >
                    <svg className="w-4 h-4 text-void-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    {map.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Click outside to close dropdown */}
      {showMapDropdown && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowMapDropdown(false)}
        />
      )}

      <EditorCore
        key={editorKey}
        config={VOIDSTRIKE_EDITOR_CONFIG}
        dataProvider={voidstrikeDataProvider}
        mapId={currentMapId}
        onSave={handleSave}
        onCancel={handleCancel}
        onPlay={handlePlay}
      />
    </div>
  );
}

export default function MapEditorPage() {
  return (
    <Suspense
      fallback={
        <main className="h-screen bg-black flex items-center justify-center">
          <div className="text-void-400">Loading editor...</div>
        </main>
      }
    >
      <EditorPageContent />
    </Suspense>
  );
}
