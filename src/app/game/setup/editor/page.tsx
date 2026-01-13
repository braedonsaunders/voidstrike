'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EditorCore, VOIDSTRIKE_EDITOR_CONFIG } from '@/editor';
import { voidstrikeDataProvider } from '@/editor/providers/voidstrike';
import type { EditorMapData } from '@/editor';

/**
 * Map Editor Page
 *
 * Uses the reusable EditorCore component with VOIDSTRIKE-specific configuration.
 * The editor is fully config-driven and could be extracted to a separate library.
 */

function EditorPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapId = searchParams.get('map') || 'crystal_caverns';

  const handleSave = (data: EditorMapData) => {
    console.log('Map saved:', data);
    // TODO: Persist to storage or state
  };

  const handleCancel = () => {
    router.push('/game/setup');
  };

  const handlePlay = (data: EditorMapData) => {
    // Convert to game format and store in state
    const gameData = voidstrikeDataProvider.exportForGame?.(data);
    console.log('Playing with edited map:', gameData);

    // TODO: Store the edited map data in gameSetupStore
    // For now, just navigate back to setup
    router.push('/game/setup');
  };

  return (
    <EditorCore
      config={VOIDSTRIKE_EDITOR_CONFIG}
      dataProvider={voidstrikeDataProvider}
      mapId={mapId}
      onSave={handleSave}
      onCancel={handleCancel}
      onPlay={handlePlay}
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
