import { NextResponse } from 'next/server';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export interface MusicTrack {
  name: string;
  url: string;
}

export interface MusicDiscoveryResponse {
  menu: MusicTrack[];
  gameplay: MusicTrack[];
}

/**
 * GET /api/music
 * Discovers all MP3 files in the music/menu and music/gameplay folders
 * Returns a list of available music tracks for each category
 */
export async function GET() {
  const publicDir = path.join(process.cwd(), 'public');
  const menuDir = path.join(publicDir, 'audio', 'music', 'menu');
  const gameplayDir = path.join(publicDir, 'audio', 'music', 'gameplay');

  const discoverMp3Files = async (dir: string, urlPrefix: string): Promise<MusicTrack[]> => {
    if (!existsSync(dir)) {
      return [];
    }

    try {
      const files = await readdir(dir);
      return files
        .filter((file: string) => file.toLowerCase().endsWith('.mp3'))
        .map((file: string) => ({
          name: file.replace(/\.mp3$/i, ''),
          url: `${urlPrefix}/${file}`,
        }));
    } catch {
      return [];
    }
  };

  const [menuTracks, gameplayTracks] = await Promise.all([
    discoverMp3Files(menuDir, '/audio/music/menu'),
    discoverMp3Files(gameplayDir, '/audio/music/gameplay'),
  ]);

  const response: MusicDiscoveryResponse = {
    menu: menuTracks,
    gameplay: gameplayTracks,
  };

  return NextResponse.json(response);
}
