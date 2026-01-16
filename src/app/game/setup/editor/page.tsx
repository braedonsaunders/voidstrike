'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EditorCore, VOIDSTRIKE_EDITOR_CONFIG } from '@/editor';
import { voidstrikeDataProvider } from '@/editor/providers/voidstrike';
import type { EditorMapData, MapListItem } from '@/editor';

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
    // Update URL without full navigation
    router.replace(`/game/setup/editor?map=${mapId}`);
  }, [router]);

  const handleNewMap = useCallback(() => {
    setCurrentMapId(undefined);
    setEditorKey((prev: number) => prev + 1);
    router.replace('/game/setup/editor?new=true');
  }, [router]);

  return (
    <EditorCore
      key={editorKey}
      config={VOIDSTRIKE_EDITOR_CONFIG}
      dataProvider={voidstrikeDataProvider}
      mapId={currentMapId}
      onSave={handleSave}
      onCancel={handleCancel}
      onPlay={handlePlay}
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
