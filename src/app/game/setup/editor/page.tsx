'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EditorCore, VOIDSTRIKE_EDITOR_CONFIG } from '@/editor';
import { voidstrikeDataProvider } from '@/editor/providers/voidstrike';
import { useGameSetupStore, loadEditorMapDataFromStorage } from '@/store/gameSetupStore';
import { debugInitialization } from '@/utils/debugLogger';
import { MapPreviewModal, type PreviewSettings } from '@/editor/core/MapPreviewModal';
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

  // State for restored editor map data (returning from preview)
  const [initialMapData, setInitialMapData] = useState<EditorMapData | undefined>(undefined);
  const [isLoadingStoredData, setIsLoadingStoredData] = useState(true);
  const hasRestoredFromPreview = useRef(false);

  // Track current map data for preview
  const currentMapDataRef = useRef<EditorMapData | null>(null);

  // Preview modal state
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [pendingPreviewData, setPendingPreviewData] = useState<{ editor: EditorMapData; game: MapData } | null>(null);

  // Load stored editor map data from IndexedDB (returning from preview)
  useEffect(() => {
    const loadStoredData = async () => {
      const storedData = await loadEditorMapDataFromStorage();
      if (storedData && !hasRestoredFromPreview.current) {
        hasRestoredFromPreview.current = true;
        setInitialMapData(storedData);
        // Clear the stored data after we've used it for initial load
        useGameSetupStore.getState().clearEditorPreviewState();
      }
      setIsLoadingStoredData(false);
    };
    loadStoredData();
  }, []);

  // Load available maps list
  useEffect(() => {
    const loadMapList = async () => {
      const maps = await voidstrikeDataProvider.getMapList();
      setMapList(maps);
    };
    loadMapList();
  }, []);

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
      debugInitialization.error('Failed to convert map to game format');
      return;
    }

    // Ensure map has required fields for spawning
    if (!gameData.spawns || gameData.spawns.length < 2) {
      alert('Map needs at least 2 spawn points (main bases) to preview. Add main bases to your map.');
      return;
    }

    // Show the preview settings modal
    setPendingPreviewData({ editor: data, game: gameData });
    setShowPreviewModal(true);
  };

  const handleLaunchPreview = useCallback((settings: PreviewSettings) => {
    if (!pendingPreviewData) return;

    const { editor: editorData, game: gameData } = pendingPreviewData;

    debugInitialization.log('Preview map with settings:', settings);

    const store = useGameSetupStore.getState();

    // Reset and configure
    store.reset();
    store.setCustomMap(gameData);
    store.setEditorMapData(editorData);
    store.setEditorPreview(true);
    store.setStartingResources(settings.startingResources);
    store.setGameSpeed(settings.gameSpeed);
    store.setFogOfWar(settings.fogOfWar);

    // Configure player slots: 1 human + (numPlayers - 1) AI
    // Slot 1 is already human from reset(). Add extra AI slots as needed.
    for (let i = 2; i < settings.numPlayers; i++) {
      store.addPlayerSlot();
    }

    // Set AI difficulty on all AI slots
    const currentSlots = useGameSetupStore.getState().playerSlots;
    for (const slot of currentSlots) {
      if (slot.type === 'ai') {
        store.setPlayerSlotAIDifficulty(slot.id, settings.aiDifficulty);
      }
    }

    store.startGame();

    setShowPreviewModal(false);
    setPendingPreviewData(null);
    router.push('/game');
  }, [pendingPreviewData, router]);

  const handleCancelPreview = useCallback(() => {
    setShowPreviewModal(false);
    setPendingPreviewData(null);
  }, []);

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

  // Show loading while checking for stored data from preview
  if (isLoadingStoredData) {
    return (
      <main className="h-screen bg-black flex items-center justify-center">
        <div className="text-void-400">Loading editor...</div>
      </main>
    );
  }

  return (
    <>
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

      {showPreviewModal && pendingPreviewData && (
        <MapPreviewModal
          maxPlayers={pendingPreviewData.game.spawns?.length ?? 2}
          onLaunch={handleLaunchPreview}
          onCancel={handleCancelPreview}
        />
      )}
    </>
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
