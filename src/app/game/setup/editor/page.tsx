'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EditorCore, VOIDSTRIKE_EDITOR_CONFIG } from '@/editor';
import { voidstrikeDataProvider } from '@/editor/providers/voidstrike';
import { useGameSetupStore, getEditorMapData } from '@/store/gameSetupStore';
import type { EditorMapData } from '@/editor';
import type { MapListItem } from '@/editor/core/EditorHeader';
import type { MapData } from '@/data/maps/MapTypes';

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

function EditorPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNewMap = searchParams.get('new') === 'true';
  const mapIdParam = searchParams.get('map');

  // State for map selection
  const [mapList, setMapList] = useState<MapListItem[]>([]);
  const [currentMapId, setCurrentMapId] = useState<string | undefined>(
    isNewMap ? undefined : (mapIdParam || undefined)
  );
  const [editorKey, setEditorKey] = useState(0); // Key to force re-render EditorCore

  // Check for stored editor map data (returning from preview)
  const storedEditorMapData = getEditorMapData();
  const [initialMapData, setInitialMapData] = useState<EditorMapData | undefined>(
    storedEditorMapData || undefined
  );
  const hasRestoredFromPreview = useRef(false);

  // Track current map data for preview
  const currentMapDataRef = useRef<EditorMapData | null>(null);

  // Load available maps list
  useEffect(() => {
    const loadMapList = async () => {
      const maps = await voidstrikeDataProvider.getMapList();
      setMapList(maps);
    };
    loadMapList();
  }, []);

  // Clear stored editor map data after restoring from preview
  useEffect(() => {
    if (storedEditorMapData && !hasRestoredFromPreview.current) {
      hasRestoredFromPreview.current = true;
      // Clear the stored data after we've used it for initial load
      useGameSetupStore.getState().clearEditorPreviewState();
    }
  }, [storedEditorMapData]);

  const handleCancel = () => {
    // Navigate back to home if came from home page (new=true), otherwise to setup
    if (isNewMap) {
      router.push('/');
    } else {
      router.push('/game/setup');
    }
  };

  // Track map changes for preview
  const handleMapChange = useCallback((data: EditorMapData) => {
    currentMapDataRef.current = data;
  }, []);

  const handlePreview = (data: EditorMapData) => {
    // Convert editor format to game format
    const gameData = voidstrikeDataProvider.exportForGame?.(data) as MapData;
    if (!gameData) {
      console.error('Failed to convert map to game format');
      return;
    }

    // Ensure map has required fields for spawning
    if (!gameData.spawns || gameData.spawns.length < 2) {
      alert('Map needs at least 2 spawn points (main bases) to preview. Add main bases to your map.');
      return;
    }

    console.log('Preview map:', gameData);

    // Store custom map in game setup store
    const store = useGameSetupStore.getState();

    // Store the editor map data so we can restore it when returning from preview
    store.setEditorMapData(data);

    store.setCustomMap(gameData);

    // Configure for preview: 1 human vs 1 AI
    store.reset();
    store.setCustomMap(gameData); // Re-set after reset
    store.setEditorMapData(data); // Re-set after reset
    store.setEditorPreview(true); // Mark as editor preview for "Back to Editor" button
    store.setFogOfWar(false); // Disable fog for easier testing
    store.startGame();

    // Navigate to game
    router.push('/game');
  };

  const handleLoadMap = useCallback((mapId: string) => {
    setCurrentMapId(mapId);
    setInitialMapData(undefined); // Clear restored data when loading a different map
    setEditorKey((prev: number) => prev + 1); // Force EditorCore to re-mount
    // Update URL without full navigation
    router.replace(`/game/setup/editor?map=${mapId}`);
  }, [router]);

  const handleNewMap = useCallback(() => {
    setCurrentMapId(undefined);
    setInitialMapData(undefined); // Clear restored data when creating a new map
    setEditorKey((prev: number) => prev + 1);
    router.replace('/game/setup/editor?new=true');
  }, [router]);

  return (
    <EditorCore
      key={editorKey}
      config={VOIDSTRIKE_EDITOR_CONFIG}
      dataProvider={voidstrikeDataProvider}
      mapId={initialMapData ? undefined : currentMapId}
      initialMapData={initialMapData}
      onCancel={handleCancel}
      onPlay={handlePreview}
      onChange={handleMapChange}
      mapList={mapList}
      onLoadMap={handleLoadMap}
      onNewMap={handleNewMap}
    />
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
